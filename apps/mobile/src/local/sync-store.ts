/**
 * The local landing of the sync engine: feeding the saved items in SQLite to LocalStore.
 *
 * Three easy-to-trip points, all handled here once and for all:
 *
 * 1. **rev is maintained by a trigger**. documents_rev_bump in db.ts bumps it automatically by 1 on every UPDATE where rev did not change,
 *    so no write path (parsing, status transitions, deletion) has to update rev itself.
 *    The price is that when "landing a remote record" you must write rev = the remote rev explicitly, otherwise the local row counts as "modified" again,
 *    and the next round pushes the content just pulled down straight back up, so sync never converges.
 *
 * 2. **Tombstones must go into dirty too**. If a deleted entry is not pushed up, another device treats it as "absent remotely" and resurrects it.
 *
 * 3. **image_files are not synced**. Those are local file paths (absolute paths under documentDirectory),
 *    which are meaningless strings on another device; the images themselves are re-downloaded on the new device from the remote addresses in the body.
 */
import type { LocalStore, SyncRecord } from '@trovia/sync'

import { getDb } from './db'

/** Fields that take part in sync: user content + metadata, without local paths and indexes. */
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
  // Truncating by character is enough; a 2 MB body is already the extreme case, no exact byte alignment needed.
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
 * The base rev only counts entries "this device really still has".
 *
 * The old version's "clear all saved items" deleted only from documents and not from sync_base, so after clearing,
 * the cloud data was treated as "this device already has it" and never fetched again — the symptom being sync reporting
 * "both sides are already consistent" while the local database was empty. This cleans up the orphan rows along the way, so old users heal themselves.
 */
/**
 * doc_id → etag of the remote file; entries never recorded are not in the table.
 *
 * Again only entries "this device really still has". Otherwise, after the database was cleared, or a given entry was physically deleted,
 * this etag makes the engine think "this entry has already been synced" and skip reading it —
 * the symptom being seven files in the cloud and six locally, yet sync reports "nothing to sync".
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
      // One failed write (unique index, field constraint) does not affect the other records:
      // a conflict copy and the original entry sharing the same link is a perfectly normal situation.
      //
      // But the local rev must be aligned to the remote: the engine assumes "after applyRemote the local rev == the remote rev",
      // and without alignment this entry always satisfies rev > base, is pulled again every round, and never converges.
      try {
        await db.runAsync('UPDATE documents SET rev = ? WHERE id = ?', record.rev, record.id)
      } catch {
        // If even the alignment fails, give up on this entry — at least do not affect the other records.
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

  // Tombstone: delete it here too if this device has it, otherwise do nothing (leave no empty shell).
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
    // If the remote is older or equally new, leave it alone, so a body being reorganized on this device is not overwritten.
    if (existing.updated_at >= record.updated_at) return
    // Deliberately do not change url / canonical_url: an entry's identity is its id, and changing the link only collides with
    // the "one entry per link" unique index and interrupts the whole sync round.
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

  // The same link already has an entry on another device (the phone uses random ids, the extension hashes the link, so the two sides
  // necessarily compute different ids): land on that entry, otherwise the INSERT collides with the "one entry per link" unique index
  // and the entire sync round fails.
  if (!existing) {
    const canonical = stringOf(payload, 'canonical_url') ?? stringOf(payload, 'url')
    if (canonical) {
      const sameUrl = await db.getFirstAsync<{ id: string; updated_at: string }>(
        `SELECT id, updated_at FROM documents
          WHERE (url = ? OR canonical_url = ?) AND deleted_at IS NULL AND id != ?
          LIMIT 1`,
        stringOf(payload, 'url') ?? canonical,
        canonical,
        record.id,
      )
      if (sameUrl) {
        if (sameUrl.updated_at < record.updated_at) {
          await db.runAsync(
            `UPDATE documents SET title = ?, summary_short = ?, summary_long = ?,
               updated_at = ?, rev = rev + 1 WHERE id = ?`,
            stringOf(payload, 'title'),
            stringOf(payload, 'summary_short'),
            stringOf(payload, 'summary_long'),
            record.updated_at,
            sameUrl.id,
          )
        }
        return
      }
    }
  }

  // Not present locally: insert the whole row.
  await db.runAsync(
    `INSERT INTO documents (
       id, url, canonical_url, title, site_name, source_type, author, published_at, description,
       summary_short, summary_long, keywords, topics, language, content_markdown, plain_text,
       images, image_files, search_text, parse_status, parse_stage, parse_error_code,
       saved_at, last_parsed_at, updated_at, rev, deleted_at, metadata
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, NULL, ?, NULL, ?, ?, NULL, ?)`,
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
    // The extension stores only the link and title and leaves the body for this device to fetch; only marking it pending puts it in the queue.
    stringOf(payload, 'content_markdown') ? 'completed' : 'pending',
    stringOf(payload, 'content_markdown') ? null : 'fetch',
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
  // Entries that are read-only must still record their etag, otherwise the next round reads them again.
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
