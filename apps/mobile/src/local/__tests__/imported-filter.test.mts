/**
 * The "only imported" filter relies on one SQL clause: only rows whose metadata carries origin count as imported.
 *
 * Build a minimal table with node:sqlite and run that LIKE, to confirm it does not count ordinary saves
 * and does not miss imported ones (metadata is TEXT, and its format is decided by createDocument).
 *
 * Usage: npx tsx apps/mobile/src/local/__tests__/imported-filter.test.mts
 */
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync(':memory:')
db.exec('CREATE TABLE documents (id TEXT PRIMARY KEY, metadata TEXT, deleted_at TEXT)')

const insert = db.prepare('INSERT INTO documents (id, metadata, deleted_at) VALUES (?, ?, NULL)')
insert.run('plain', '{}')
insert.run('plain-null', null)
insert.run('imported', JSON.stringify({ origin: '从 pocket.csv 导入', savedAtFromFile: true }))
insert.run('imported-no-date', JSON.stringify({ origin: '从 links.txt 导入', savedAtFromFile: false }))

const rows = db
  .prepare(`SELECT id FROM documents WHERE deleted_at IS NULL AND metadata LIKE '%"origin"%' ORDER BY id`)
  .all() as { id: string }[]

assert.deepEqual(
  rows.map((row) => row.id),
  ['imported', 'imported-no-date'],
  '只应命中带 origin 的条目',
)

// Rows without metadata (NULL) must not be counted as hits just because LIKE returns NULL
assert.equal(rows.some((row) => row.id === 'plain-null'), false, 'NULL metadata 不算导入')

console.log('importedOnly：2 项断言通过')
