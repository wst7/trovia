/**
 * 「只看导入的」这条筛选依赖一句 SQL：metadata 里带 origin 的才算导入。
 *
 * 用 node:sqlite 建最小表跑那句 LIKE，确认不会把普通收藏也算进去、
 * 也不会漏掉导入的（metadata 是 TEXT，格式由 createDocument 决定）。
 *
 * 跑法：npx tsx apps/mobile/src/local/__tests__/imported-filter.test.mts
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

// 没有 metadata 的（NULL）不能因为 LIKE 返回 NULL 而被误判为命中
assert.equal(rows.some((row) => row.id === 'plain-null'), false, 'NULL metadata 不算导入')

console.log('importedOnly：2 项断言通过')
