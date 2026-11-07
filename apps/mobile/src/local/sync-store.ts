/**
 * 同步引擎在本机的落地：把 SQLite 里的收藏喂给 LocalStore。
 *
 * 三个容易踩的点，都在这里一次性处理掉：
 *
 * 1. **rev 由触发器维护**。db.ts 里 documents_rev_bump 会在每次 UPDATE 且 rev 未变时
 *    自动 +1，所以所有写路径（解析、状态流转、删除）都不用自己改 rev。
 *    代价是「落地远端记录」时必须显式写 rev = 远端 rev，否则本地又变成「改过」，
 *    下一轮就会把刚拉下来的内容原样推回去，来回同步永不收敛。
 *
 * 2. **墓碑也要进 dirty**。已删除的条目如果不推上去，另一台设备会把它当「远端没有」而复活。
 *
 * 3. **不同步 image_files**。那是本机文件路径（documentDirectory 下的绝对路径），
 *    传到别的设备上是废字符串；图片本身按正文里的远程地址在新设备重新下载。
 */
import type { LocalStore, SyncRecord } from '@trovia/sync'

import { getDb } from './db'

/** 参与同步的字段：用户内容 + 元信息，不含本机路径与索引。 */
const PAYLOAD_FIELDS = [
  'url',
  'canonical_url',
  'title',
  'site_name',
  'source_type',
  'author',
  'published_at',
  'description',
  'summary_short',
  'summary_long',
  'keywords',
  'topics',
  'language',
  'content_markdown',
  'plain_text',
  'images',
  'saved_at',
  'metadata',
] as const

const JSON_FIELDS = new Set(['keywords', 'topics', 'images'])
const MAX_BODY_BYTES = 2 * 1024 * 1024

interface SyncRow {
  id: string
  updated_at: string
  deleted_at: string | null
  rev: number
  [key: string]: unknown
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function truncateBody(markdown: unknown): unknown {
  if (typeof markdown !== 'string' || markdown.length <= MAX_BODY_BYTES) return markdown
  // 按字符截断即可，2MB 的正文已经是极端情况，不需要精确字节对齐。
  return `${markdown.slice(0, MAX_BODY_BYTES)}\n\n（正文过长，同步时已截断）`
}

function toRecord(row: SyncRow): SyncRecord {
  const payload: Record<string, unknown> = {}
  for (const field of PAYLOAD_FIELDS) {
    const value = row[field]
    if (field === 'content_markdown') {
      payload[field] = truncateBody(value)
      continue
    }
    payload[field] = JSON_FIELDS.has(field) ? (parseJson(value) ?? []) : field === 'metadata' ? (parseJson(value) ?? {}) : value
  }
  return {
    id: row.id,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? null,
    rev: typeof row.rev === 'number' ? row.rev : 1,
    payload,
  }
}

function stringOf(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function arrayAsJson(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  if (Array.isArray(value)) return JSON.stringify(value)
  if (typeof value === 'string' && value.trim().startsWith('[')) return value
  return '[]'
}

async function listDirty(): Promise<SyncRecord[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<SyncRow>(
    `SELECT d.* FROM documents d
      WHERE d.rev > COALESCE((SELECT b.rev FROM sync_base b WHERE b.doc_id = d.id), 0)
      ORDER BY d.updated_at ASC
      LIMIT 500`,
  )
  return rows.map(toRecord)
}

/**
 * 基准 rev 只认「本机确实还有这条」的。
 *
 * 老版本「清空全部收藏」只删 documents、没删 sync_base，于是清空之后
 * 云端的数据被当成「本机已经有了」而永远不再拉取——表现就是同步显示
 * 「两端已经一致」，本地却是空的。这里顺手把孤儿行清掉，让老用户自愈。
 */
/**
 * doc_id → 远端文件的 etag；没记过的条目不在表里。
 *
 * 同样只认「本机确实还有这条」。否则清空过库、或某条被物理删掉之后，
 * 这份 etag 会让引擎以为「这条已经同步过了」而跳过读取——
 * 表现就是云端 7 份、本地 6 份，同步却报「没有可同步的」。
 */
async function baseEtags(): Promise<Map<string, string>> {
  const db = await getDb()
  await db
    .runAsync('DELETE FROM sync_base WHERE doc_id NOT IN (SELECT id FROM documents)')
    .catch(() => undefined)
  const rows = await db.getAllAsync<{ doc_id: string; remote_etag: string }>(
    'SELECT b.doc_id AS doc_id, b.remote_etag AS remote_etag FROM sync_base b JOIN documents d ON d.id = b.doc_id WHERE b.remote_etag IS NOT NULL',
  )
  return new Map(rows.map((row) => [row.doc_id, row.remote_etag]))
}

async function baseRevs(): Promise<Map<string, number>> {
  const db = await getDb()
  await db
    .runAsync('DELETE FROM sync_base WHERE doc_id NOT IN (SELECT id FROM documents)')
    .catch(() => undefined)
  const rows = await db.getAllAsync<{ doc_id: string; rev: number }>('SELECT doc_id, rev FROM sync_base')
  return new Map(rows.map((row) => [row.doc_id, row.rev]))
}

async function applyRemote(records: SyncRecord[]): Promise<void> {
  const db = await getDb()
  for (const record of records) {
    try {
      await applyOne(db, record)
    } catch {
      // 单条落库失败（唯一索引、字段约束）不影响其他记录：
      // 冲突副本和原条目共用同一个链接是很正常的情况。
      //
      // 但必须把本地 rev 对齐到远端：引擎假定「applyRemote 之后本地 rev == 远端 rev」，
      // 不对齐的话这条会永远满足 rev > 基准，每一轮都被重新拉一次，永远收不敛。
      try {
        await db.runAsync('UPDATE documents SET rev = ? WHERE id = ?', record.rev, record.id)
      } catch {
        // 连对齐都失败就放弃这一条，至少别影响其他记录。
      }
    }
  }
}

async function applyOne(db: Awaited<ReturnType<typeof getDb>>, record: SyncRecord): Promise<void> {
  const payload = record.payload ?? {}
  const existing = await db.getFirstAsync<{ updated_at: string; deleted_at: string | null }>(
    'SELECT updated_at, deleted_at FROM documents WHERE id = ?',
    record.id,
  )

  // 墓碑：本机有就跟着删，没有就什么都不做（不留空壳）。
  if (record.deleted_at) {
    if (!existing || existing.deleted_at) return
    await db.runAsync(
      'UPDATE documents SET deleted_at = ?, updated_at = ?, rev = ? WHERE id = ?',
      record.deleted_at,
      record.updated_at,
      record.rev,
      record.id,
    )
    return
  }

  if (existing) {
    // 远端更旧或一样新就不动，避免把本机正在整理的正文覆盖掉。
    if (existing.updated_at >= record.updated_at) return
    // 刻意不改 url / canonical_url：条目身份由 id 决定，改链接只会撞上
    // 「同一链接只保留一条」的唯一索引，把整轮同步打断。
    await db.runAsync(
      `UPDATE documents SET
         title = ?, site_name = ?,
         source_type = COALESCE(?, source_type), author = ?, published_at = ?, description = ?,
         summary_short = ?, summary_long = ?, keywords = ?, topics = ?, language = ?,
         content_markdown = ?, plain_text = ?, images = ?,
         search_text = COALESCE(?, search_text),
         updated_at = ?, deleted_at = NULL, rev = ?
       WHERE id = ?`,
      stringOf(payload, 'title'),
      stringOf(payload, 'site_name'),
      stringOf(payload, 'source_type'),
      stringOf(payload, 'author'),
      stringOf(payload, 'published_at'),
      stringOf(payload, 'description'),
      stringOf(payload, 'summary_short'),
      stringOf(payload, 'summary_long'),
      arrayAsJson(payload, 'keywords'),
      arrayAsJson(payload, 'topics'),
      stringOf(payload, 'language'),
      stringOf(payload, 'content_markdown'),
      stringOf(payload, 'plain_text'),
      arrayAsJson(payload, 'images'),
      stringOf(payload, 'plain_text'),
      record.updated_at,
      record.rev,
      record.id,
    )
    return
  }

  // 本机没有：整条插入。
  await db.runAsync(
    `INSERT INTO documents (
       id, url, canonical_url, title, site_name, source_type, author, published_at, description,
       summary_short, summary_long, keywords, topics, language, content_markdown, plain_text,
       images, image_files, search_text, parse_status, parse_stage, parse_error_code,
       saved_at, last_parsed_at, updated_at, rev, deleted_at, metadata
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 'completed', NULL, NULL, ?, NULL, ?, ?, NULL, ?)`,
    record.id,
    stringOf(payload, 'url') ?? '',
    stringOf(payload, 'canonical_url') ?? '',
    stringOf(payload, 'title'),
    stringOf(payload, 'site_name'),
    stringOf(payload, 'source_type') ?? 'web',
    stringOf(payload, 'author'),
    stringOf(payload, 'published_at'),
    stringOf(payload, 'description'),
    stringOf(payload, 'summary_short'),
    stringOf(payload, 'summary_long'),
    arrayAsJson(payload, 'keywords'),
    arrayAsJson(payload, 'topics'),
    stringOf(payload, 'language'),
    stringOf(payload, 'content_markdown'),
    stringOf(payload, 'plain_text'),
    arrayAsJson(payload, 'images'),
    stringOf(payload, 'plain_text') ?? '',
    stringOf(payload, 'saved_at') ?? record.updated_at,
    record.updated_at,
    record.rev,
    stringOf(payload, 'metadata') ?? '{}',
  )
}

async function markSynced(
  records: SyncRecord[],
  syncedAt: string,
  etags?: Map<string, string>,
): Promise<void> {
  const db = await getDb()
  for (const record of records) {
    await db.runAsync(
      'INSERT OR REPLACE INTO sync_base (doc_id, rev, remote_etag) VALUES (?, ?, ?)',
      record.id,
      record.rev,
      etags?.get(record.id) ?? null,
    )
  }
  // 只读不改的条目也要记下 etag，否则下一轮还会再读它一遍。
  if (etags) {
    for (const [id, etag] of etags) {
      await db.runAsync(
        'UPDATE sync_base SET remote_etag = ? WHERE doc_id = ? AND (remote_etag IS NULL OR remote_etag != ?)',
        etag,
        id,
        etag,
      )
    }
  }
  await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('sync_last_at', ?)", syncedAt)
}

export function createSyncStore(): LocalStore {
  return { listDirty, baseRevs, baseEtags, applyRemote, markSynced }
}
