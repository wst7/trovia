/**
 * Behaviour tests for the sync engine: two devices + one shared “cloud drive”, verifying
 *   1. a new item can be carried over
 *   2. only one side changes → the other side catches up
 *   3. both sides changed → the newer one takes the main slot, the older keeps a “conflict copy”, and nobody's content is lost
 *   4. a deletion (tombstone) propagates, and is not resurrected by the other device
 *   5. repeated sync converges and does not set off a storm of copies
 *
 * How to run: npx tsx packages/sync/test/sync.test.mts
 */
import assert from 'node:assert/strict'
import { syncOnce } from '../src/index.ts'
import type { LocalStore, SyncRecord, SyncTarget } from '../src/index.ts'

/** In-memory cloud drive: path → content. */
class MemoryTarget implements SyncTarget {
  files = new Map<string, string>()
  writes = 0
  async list(prefix: string) {
    return [...this.files.keys()]
      .filter((path) => path.startsWith(prefix))
      .map((path) => ({ path, size: this.files.get(path)?.length ?? 0 }))
  }
  async read(path: string) {
    return this.files.get(path) ?? null
  }
  async write(path: string, body: string) {
    this.writes += 1
    this.files.set(path, body)
  }
  async remove(path: string) {
    this.files.delete(path)
  }
}

/** In-memory local store: docs + dirty + baseline rev (mirrors the documents.synced_rev column). */
class MemoryStore implements LocalStore {
  docs = new Map<string, SyncRecord>()
  dirty = new Set<string>()
  base = new Map<string, number>()

  put(record: Omit<SyncRecord, 'rev'> & { rev?: number }) {
    const prev = this.docs.get(record.id)
    const next: SyncRecord = { ...record, rev: record.rev ?? (prev?.rev ?? 0) + 1 }
    this.docs.set(next.id, next)
    this.dirty.add(next.id)
  }

  async listDirty() {
    return [...this.dirty].map((id) => this.docs.get(id)).filter((r): r is SyncRecord => Boolean(r))
  }

  async baseRevs() {
    return new Map(this.base)
  }

  /**
   * The baseline rev is deliberately not written here: the real implementation (the app's sync-store) only writes to the store,
   * the baseline is recorded by markSynced. A test double that got clever would hide real bugs —
   * “after a pull the local row was deleted, and then a conflict copy popped up again” was missed exactly this way.
   */
  async applyRemote(records: SyncRecord[]) {
    for (const record of records) {
      this.docs.set(record.id, record)
      this.dirty.delete(record.id)
    }
  }

  async markSynced(records: SyncRecord[]) {
    for (const record of records) {
      this.base.set(record.id, record.rev)
      // Clear dirty only when what was pushed to the cloud really is the current version, so new edits made during the sync are not lost.
      if (this.docs.get(record.id)?.rev === record.rev) this.dirty.delete(record.id)
    }
  }
}

let clock = 0
const now = () => {
  clock += 1
  return new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString()
}

function doc(id: string, title: string, at: string): Omit<SyncRecord, 'rev'> {
  return { id, updated_at: at, deleted_at: null, payload: { title, url: `https://example.com/${id}` } }
}

async function run() {
  const cloud = new MemoryTarget()
  const phone = new MemoryStore()
  const laptop = new MemoryStore()
  const pullAll = async (store: MemoryStore, deviceId: string) =>
    syncOnce({ target: cloud, store, deviceId, now })

  // 1. The phone saves one item → sync → the laptop pulls it
  phone.put(doc('doc-1', '睡眠不足与焦虑', '2026-01-01T00:00:01Z'))
  let report = await pullAll(phone, 'device-phone')
  assert.equal(report.pushed, 1, '手机应该推上去一条')

  report = await pullAll(laptop, 'device-laptop')
  assert.equal(report.pulled, 1, '电脑应该拉到一条')
  assert.equal(laptop.docs.get('doc-1')?.payload.title, '睡眠不足与焦虑')
  console.log('✓ 新建能双向同步')

  // 2. Only the phone changed it (nobody else touched it) → the laptop catches up, no copy is produced
  phone.put({ ...doc('doc-1', '睡眠不足与焦虑（手机改）', '2026-01-01T00:00:05Z'), rev: 2 })
  await pullAll(phone, 'device-phone')
  report = await pullAll(laptop, 'device-laptop')
  assert.equal(report.conflicts, 0, '单边修改不该产生冲突副本')
  assert.equal(laptop.docs.get('doc-1')?.payload.title, '睡眠不足与焦虑（手机改）')
  console.log('✓ 单边修改只跟随，不产生副本')

  // 3. Both sides changed the same article → the newer one takes the main slot, the older keeps a copy
  phone.put({ ...doc('doc-1', '手机又改了一次', '2026-01-01T00:00:30Z'), rev: 3 })
  laptop.dirty.add('doc-1') // the laptop changed this earlier (rev 2 was already synced, but the baseline is still 2)
  laptop.docs.set('doc-1', { ...doc('doc-1', '电脑上的说法', '2026-01-01T00:00:31Z'), rev: 3 })
  await pullAll(laptop, 'device-laptop') // the laptop pushes first
  report = await pullAll(phone, 'device-phone') // the phone then sees the laptop's version
  assert.equal(report.conflicts, 1, '两端都改应该留一份冲突副本')
  const titles = [...phone.docs.values()].map((r) => String(r.payload.title))
  assert.ok(titles.includes('电脑上的说法'), '较新的版本应该占据主位')
  assert.ok(titles.some((t) => t.includes('冲突副本')), '另一份应该以冲突副本保留')
  console.log('✓ 两端都改：新的占主位，另一份留冲突副本')

  // 4. A deletion (tombstone) propagates and is not resurrected by the other device
  const victim = 'doc-3'
  phone.put(doc(victim, '要删掉的一条', '2026-01-01T00:00:40Z'))
  await pullAll(phone, 'device-phone')
  await pullAll(laptop, 'device-laptop')
  assert.equal(laptop.docs.get(victim)?.deleted_at, null)

  laptop.put({ ...doc(victim, '要删掉的一条', '2026-01-01T00:00:50Z'), deleted_at: '2026-01-01T00:00:50Z', rev: 2 })
  await pullAll(laptop, 'device-laptop')
  report = await pullAll(phone, 'device-phone')
  assert.equal(report.deleted, 1, '墓碑应该被拉下来')
  assert.equal(phone.docs.get(victim)?.deleted_at, '2026-01-01T00:00:50Z', '手机上应该也是墓碑')

  report = await pullAll(phone, 'device-phone')
  assert.equal(report.pushed, 0, '墓碑不该被反向覆盖')
  assert.equal(JSON.parse(cloud.files.get(`docs/${victim}.json`) ?? '{}').deleted_at, '2026-01-01T00:00:50Z')
  console.log('✓ 删除靠墓碑传播，不会被另一台设备复活')

  // 5. Repeated sync converges
  const before = phone.docs.size
  for (const store of [phone, laptop, phone, laptop]) {
    await pullAll(store, store === phone ? 'device-phone' : 'device-laptop')
  }
  assert.equal(phone.docs.size, before, '空跑同步不应再产生副本')
  console.log('✓ 重复同步收敛，不产生副本风暴')

  // 5b. With no changes, the whole remote store must not be pulled again.
  // With only listDirty() the engine cannot tell “not present locally” from “present locally but unchanged”,
  // which once meant every round re-fetched every record (on a real device all 312 were counted as “fetched”).
  const idle = await pullAll(phone, 'device-phone')
  assert.equal(idle.pulled, 0, '没有改动时不该有任何取回')
  assert.equal(idle.pushed, 0, '没有改动时不该有任何上传')
  console.log('✓ 无改动时同步是空转（pulled 0 / pushed 0）')

  // 6. Local delete after a pull: the tombstone must be carried up and must not be judged a conflict and resurrected
  phone.put({ ...doc('doc-delete-after-pull', '会被删除的那篇', '2026-01-01T00:10:00.000Z') })
  await pullAll(phone, 'device-phone')
  await pullAll(laptop, 'device-laptop')
  assert.ok(laptop.docs.has('doc-delete-after-pull'), '第二台设备应该先拿到这条')

  laptop.put({
    ...doc('doc-delete-after-pull', '会被删除的那篇', '2026-01-01T00:20:00.000Z'),
    deleted_at: '2026-01-01T00:20:00.000Z',
  })
  const delReport = await pullAll(laptop, 'device-laptop')
  assert.equal(delReport.conflicts, 0, '删除不该被判成冲突')
  assert.equal(delReport.deleted, 0, '本机自己删的，不该再「取回删除」')
  const remoteAfterDelete = [...cloud.files.values()].map((body) => JSON.parse(body) as SyncRecord)
  assert.ok(
    remoteAfterDelete.some((record) => record.id === 'doc-delete-after-pull' && record.deleted_at),
    '远端应该有这条的墓碑',
  )
  assert.equal(
    [...laptop.docs.values()].filter((record) => record.payload.title && String(record.payload.title).includes('冲突副本')).length,
    0,
    '本机不该多出一份冲突副本',
  )
  console.log('✓ 拉取后本地删除：墓碑上传，不产生冲突副本')

  console.log(`\n全部通过：云端 ${cloud.files.size} 个文件，累计 ${cloud.writes} 次写入`)
}

await run()
