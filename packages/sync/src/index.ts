/**
 * 寻迹 · 多端同步引擎（与传输无关）
 *
 * 设计上的关键取舍：**同步逻辑不认任何一家云盘**。引擎只对一个
 * `SyncTarget` 说话——能列目录、读文件、写文件、删文件，就够同步了。
 *
 * 于是同一套协议可以跑在：
 *   - WebDAV（坚果云 / Nextcloud / 群晖）
 *   - OneDrive / Google Drive / Dropbox（各自的 API 包一层）
 *   - iCloud Drive（本地 ubiquity 容器，苹果自己负责传输）
 *   - 我们自己的托管桶（S3 兼容 + 账号额度）
 * 换云盘 = 换一个 adapter，不动协议，不动数据库。
 *
 * 存储布局（一个文档一个文件，避免整库覆盖冲突）：
 *   trovia/docs/<doc_id>.json        文档本体 + 元信息
 *   trovia/blobs/<sha256>            图片等附件，按内容寻址，重复不重传
 *   trovia/devices/<device_id>.json  设备最后同步时间，仅用于排障
 */

export { WebDavTarget } from './webdav'
// LocalDirTarget 依赖 node:fs，只在桌面/测试里用，不从入口导出，
// 否则移动端一引 @trovia/sync 就会把 node 内置模块带进 RN 的类型检查。

export interface SyncTarget {
  /** 列出某个前缀下的文件；path 是相对根目录的路径，如 `docs/abc.json`。 */
  list(prefix: string): Promise<SyncEntry[]>
  read(path: string): Promise<string | null>
  write(path: string, body: string): Promise<void>
  remove(path: string): Promise<void>
}

export interface SyncEntry {
  path: string
  /** 有的云盘给 etag/mtime，用来跳过未变化的文件；没有就每次读。 */
  etag?: string
  size?: number
}

/** 一条要同步的收藏。正文与图片引用都在 payload 里，未来加解密只动这里。 */
export interface SyncRecord {
  id: string
  /** ISO 时间，冲突判定的主要依据。 */
  updated_at: string
  /** 非空表示这是墓碑（已删除），墓碑也要同步，否则别的设备会把它复活。 */
  deleted_at: string | null
  /** 每次本地改动 +1，用来区分「没变」和「两端都变了」。 */
  rev: number
  payload: Record<string, unknown>
}

/** 本地库的最小接口：引擎不碰 SQLite，测试里用内存实现。 */
export interface LocalStore {
  /** 自上次同步以来改动过（含新建、删除）的记录。 */
  listDirty(): Promise<SyncRecord[]>
  /** doc_id → 上次同步时看到的 rev。三方比较的「基准」，没有它就分不清谁先改。 */
  baseRevs(): Promise<Map<string, number>>
  /**
   * doc_id → 上次同步时远端文件的 etag。
   * 有它就能跳过没变过的文件，不必每轮把整个云端读一遍；没有就退回「每次都读」。
   */
  baseEtags?(): Promise<Map<string, string>>
  /** 按远端状态落库（顺带把基准 rev 更新成远端的）。 */
  applyRemote(records: SyncRecord[]): Promise<void>
  /** 推成功后调用：清 dirty，并把基准 rev 记为这条的 rev。 */
  markSynced(records: SyncRecord[], syncedAt: string, etags?: Map<string, string>): Promise<void>
}

export interface SyncReport {
  pushed: number
  pulled: number
  /** 远端墓碑落地（本机因此删除）条数。 */
  deleted: number
  /** 两端都改过、因此额外保留的副本。 */
  conflicts: number
  conflictNames: string[]
  /** 云端 docs/ 里到底有多少份文件：0 和「已是最新」不是一回事，界面要能说清。 */
  remoteFiles: number
  syncedAt: string
}

const DOCS_PREFIX = 'docs/'

function docPath(id: string): string {
  return `${DOCS_PREFIX}${encodeURIComponent(id)}.json`
}

function isRecord(value: unknown): value is SyncRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<SyncRecord>
  return (
    typeof record.id === 'string' &&
    typeof record.updated_at === 'string' &&
    typeof record.rev === 'number' &&
    (record.deleted_at === null || typeof record.deleted_at === 'string') &&
    typeof record.payload === 'object' &&
    record.payload !== null
  )
}

/** 谁更新就谁赢；时间一样时用 rev，再一样用内容长度做确定性兜底。 */
function newer(a: SyncRecord, b: SyncRecord): boolean {
  if (a.updated_at !== b.updated_at) return a.updated_at > b.updated_at
  if (a.rev !== b.rev) return a.rev > b.rev
  return JSON.stringify(a.payload).length >= JSON.stringify(b.payload).length
}

export interface SyncOptions {
  target: SyncTarget
  store: LocalStore
  deviceId: string
  /** 注入时钟，测试里固定时间，生产用 () => new Date().toISOString()。 */
  now: () => string
  /** 单次同步最多处理多少条，避免第一次同步把整库读进内存。 */
  limit?: number
}

/**
 * 跑一轮同步：先看远端，再决定推/拉/留副本。
 *
 * 冲突判定是三方比较：`local.rev > base && remote.rev > base`，
 * 也就是「我改过，而且你在我上次看到之后也改过」。这时不猜谁对：
 * 新的那份占主页，另一份以「冲突副本」留下——两份内容都不会被悄悄丢掉。
 */
export async function syncOnce(options: SyncOptions): Promise<SyncReport> {
  const { target, store, deviceId, now, limit = 500 } = options
  const syncedAt = now()

  const dirty = await store.listDirty()
  const dirtyById = new Map(dirty.map((record) => [record.id, record]))
  const baseRevs = await store.baseRevs()

  const allEntries = await target.list(DOCS_PREFIX)
  const baseEtags = (await store.baseEtags?.()) ?? new Map<string, string>()
  const remoteById = new Map<string, SyncRecord>()
  const seenEtags = new Map<string, string>()

  // 扫的是全部条目，不是前 limit 条——否则第 N 条之后的文件永远轮不到。
  // limit 现在限制的是「这一轮最多读几个文件」，没变过的（etag 与基准一致、
  // 本地也没改动）直接跳过，不占额度也不发请求。
  let reads = 0
  for (const entry of allEntries) {
    const id = idFromPath(entry.path)
    if (!id) continue
    const unchanged = Boolean(entry.etag) && baseEtags.get(id) === entry.etag && !dirtyById.has(id)
    if (unchanged) {
      if (entry.etag) seenEtags.set(id, entry.etag)
      continue
    }
    if (reads >= limit) continue
    reads += 1
    if (entry.etag) seenEtags.set(id, entry.etag)
    const raw = await target.read(entry.path)
    if (!raw) continue
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isRecord(parsed)) remoteById.set(parsed.id, parsed)
    } catch {
      // 坏文件跳过：可能上次写到一半，下一轮会被正确版本覆盖。
    }
  }

  let pushed = 0
  let pulled = 0
  let deleted = 0
  let conflicts = 0
  const conflictNames: string[] = []
  const applied: SyncRecord[] = []
  const pushedRecords: SyncRecord[] = []

  /** 推一条上去，并记入待标记列表。 */
  const push = async (record: SyncRecord) => {
    await target.write(docPath(record.id), JSON.stringify(record))
    pushed += 1
    pushedRecords.push(record)
  }

  /** 拉一条下来，统计删除，顺带记人话名字。 */
  const pull = (record: SyncRecord) => {
    applied.push(record)
    pulled += 1
    if (record.deleted_at) deleted += 1
  }

  const ids = new Set<string>([...dirtyById.keys(), ...remoteById.keys()])

  for (const id of ids) {
    const local = dirtyById.get(id) ?? null
    const remote = remoteById.get(id) ?? null

    // 只在本地：推上去（含墓碑）。
    if (local && !remote) {
      await push(local)
      continue
    }

    // 只在远端：分两种情况。
    // 一是本机真的没有这条（拉取）；二是本机有、但自上次同步后没改过——
    // 这种不会出现在 listDirty 里，只能靠基准 rev 认出来，否则每轮都会把整库重拉一遍。
    if (!local && remote) {
      const base = baseRevs.get(id) ?? 0
      if (base > 0) {
        if (remote.rev > base) pull(remote)
        // 相同 rev 说明两端一致，什么都不用做。
        continue
      }
      pull(remote)
      continue
    }

    if (!local || !remote) continue

    // 两边一致：只需把基准 rev 对齐。
    if (local.rev === remote.rev && local.updated_at === remote.updated_at) {
      pushedRecords.push(local)
      continue
    }

    const base = baseRevs.get(id) ?? 0
    const bothChanged = local.rev > base && remote.rev > base

    if (bothChanged) {
      const winner = newer(local, remote) ? local : remote
      const loser = winner === local ? remote : local
      const copy = conflictCopy(loser, deviceId, syncedAt)
      applied.push(copy)
      conflictNames.push(String(copy.payload.title ?? copy.id))
      conflicts += 1

      if (winner === local) await push(local)
      else pull(remote)
      continue
    }

    if (newer(local, remote)) {
      await push(local)
    } else {
      pull(remote)
    }
  }

  if (applied.length > 0) await store.applyRemote(applied)
  // 拉下来的记录也要记基准 rev：否则下一轮「本地 rev > 0 且远端 rev > 0」会被判成
  // 两端都改过——真机上表现为「本地删了一条从别的设备同步来的文章，它又变成冲突副本冒回来」。
  // 即使这次什么都没推进也要标记一次：界面上的「上次同步」应该是「上次尝试」。
  await store.markSynced([...pushedRecords, ...applied], syncedAt, seenEtags)

  return { pushed, pulled, deleted, conflicts, conflictNames, remoteFiles: allEntries.length, syncedAt }
}

/** `docs/<id>.json` → `<id>`；不是这个形状的条目直接忽略。 */
function idFromPath(path: string): string | null {
  const match = /^docs\/(.+)\.json$/.exec(path)
  return match ? match[1] : null
}

/** 冲突副本：新 id、标题带「冲突副本」，两端内容都不会被悄悄丢掉。 */
function conflictCopy(record: SyncRecord, deviceId: string, at: string): SyncRecord {
  const stamp = at.replace(/[-:.TZ]/g, '').slice(0, 14)
  const title = typeof record.payload.title === 'string' ? record.payload.title : ''
  return {
    id: `${record.id}-conflict-${stamp}-${deviceId.slice(0, 4)}`,
    updated_at: at,
    deleted_at: null,
    rev: 1,
    payload: { ...record.payload, title: title ? `${title}（冲突副本）` : '冲突副本' },
  }
}
