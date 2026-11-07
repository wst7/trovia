/**
 * 升级迁移的回归测试：老库缺列 → 补列 → 真实 INSERT 能过。
 *
 * 起因是一次真实故障：CREATE TABLE 里有 imported_at，可升级上来的库没有，
 * 每次保存都报 `table documents has no column named imported_at`，
 * 界面只显示「保存没有完成」。这个测试用 node:sqlite 造一个老结构，
 * 套用 db-columns.ts 的清单，再跑一遍真实的 INSERT。
 */
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { DOCUMENT_COLUMNS } from '../db-columns.ts'

const db = new DatabaseSync(':memory:')

// 0.10 时代的表结构：没有 imported_at、metadata、image_files……
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

// 迁移：与 db.ts 启动时同一份清单、同一段 SQL。
for (const [name, definition] of DOCUMENT_COLUMNS) {
  if (!has(name)) db.exec(`ALTER TABLE documents ADD COLUMN ${name} ${definition}`)
}
for (const [name] of DOCUMENT_COLUMNS) {
  assert.ok(has(name), `迁移之后应该有列 ${name}`)
}

// 迁移后跑真实 INSERT：这段 SQL 抄自 repo.createDocument。
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
