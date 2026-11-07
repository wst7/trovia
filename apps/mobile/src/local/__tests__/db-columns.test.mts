/**
 * Regression test for the upgrade migration: old database missing columns → add them → a real INSERT passes.
 *
 * It started from a real outage: CREATE TABLE had imported_at, but databases that were upgraded did not,
 * so every save failed with `table documents has no column named imported_at`,
 * and the UI only showed "the save did not complete". This test builds an old schema with node:sqlite,
 * applies the column list from db-columns.ts, and runs a real INSERT again.
 */
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { DOCUMENT_COLUMNS } from '../db-columns.ts'

const db = new DatabaseSync(':memory:')

// The table schema of the 0.10 era: no imported_at, metadata, image_files…
db.exec(`
  CREATE TABLE documents (
    id TEXT PRIMARY KEY NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    site_name TEXT,
    author TEXT,
    description TEXT,
    summary_short TEXT,
    summary_long TEXT,
    content_markdown TEXT,
    plain_text TEXT,
    parse_status TEXT NOT NULL DEFAULT 'pending',
    parse_stage TEXT,
    saved_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`)

function has(name: string): boolean {
  return db.prepare('PRAGMA table_info(documents)').all().some((column) => (column as { name: string }).name === name)
}

assert.equal(has('imported_at'), false, '起步状态：老库确实没有 imported_at')

// Migration: the same list and the same SQL that db.ts runs at startup.
for (const [name, definition] of DOCUMENT_COLUMNS) {
  if (!has(name)) db.exec(`ALTER TABLE documents ADD COLUMN ${name} ${definition}`)
}
for (const [name] of DOCUMENT_COLUMNS) {
  assert.ok(has(name), `迁移之后应该有列 ${name}`)
}

// Run a real INSERT after migrating: this SQL is copied from repo.createDocument.
db.prepare(
  `INSERT INTO documents (id, url, canonical_url, source_type, title, parse_status, parse_stage, saved_at, updated_at, metadata, imported_at)
   VALUES (?, ?, ?, ?, ?, 'pending', 'fetch', ?, ?, ?, ?)`,
).run(
  'doc-1',
  'https://mp.weixin.qq.com/s/sgHX2VxtrNbyesXn-mzZqQ',
  'https://mp.weixin.qq.com/s/sgHX2VxtrNbyesXn-mzZqQ',
  'wechat',
  '两件事挺意外的',
  '2026-11-07T03:45:00.000Z',
  '2026-11-07T03:45:00.000Z',
  '{}',
  null,
)

const row = db.prepare('SELECT id, title, rev FROM documents WHERE id = ?').get('doc-1') as
  | { id: string; title: string; rev: number }
  | undefined
assert.equal(row?.id, 'doc-1')
assert.equal(row?.title, '两件事挺意外的')
assert.equal(row?.rev, 1, '新增的 rev 列要有默认值 1')

db.close()
console.log(`升级迁移：${DOCUMENT_COLUMNS.length} 个补列，老库 INSERT 通过`)
