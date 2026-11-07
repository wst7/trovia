/**
 * A fetch failure must not downgrade an entry that already has a body to "failed".
 *
 * Build a minimal table with node:sqlite and run the SQL from repo.markFailed directly:
 * what is verified here is the behavior of the SQL (the CASE condition), not the RN wrapper.
 *
 * Usage: npx tsx apps/mobile/src/local/__tests__/markfailed.test.mts
 */
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync(':memory:')
db.exec(`CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  plain_text TEXT,
  parse_status TEXT,
  parse_stage TEXT,
  parse_error_code TEXT,
  last_parsed_at TEXT,
  updated_at TEXT
)`)

db.prepare('INSERT INTO documents (id, plain_text, parse_status) VALUES (?, ?, ?)').run(
  'has-body',
  'x'.repeat(400),
  'completed',
)
db.prepare('INSERT INTO documents (id, plain_text, parse_status) VALUES (?, ?, ?)').run(
  'thin-body',
  '只有标题',
  'completed',
)
db.prepare('INSERT INTO documents (id, plain_text, parse_status) VALUES (?, ?, ?)').run(
  'no-body',
  null,
  'pending',
)

const markFailed = db.prepare(`UPDATE documents SET
   parse_status = CASE
     WHEN plain_text IS NOT NULL AND length(plain_text) >= 200 THEN 'completed'
     ELSE 'failed'
   END,
   parse_stage = NULL,
   parse_error_code = ?,
   last_parsed_at = ?,
   updated_at = ?
 WHERE id = ?`)

for (const id of ['has-body', 'thin-body', 'no-body']) {
  markFailed.run('FETCH_FAILED', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z', id)
}

const status = (id: string) =>
  (db.prepare('SELECT parse_status, parse_error_code FROM documents WHERE id = ?').get(id) as {
    parse_status: string
    parse_error_code: string | null
  })

assert.equal(status('has-body').parse_status, 'completed', '有正文的条目不该被降级')
assert.equal(status('has-body').parse_error_code, 'FETCH_FAILED', '错误码仍要记下来，用于排障')
assert.equal(status('thin-body').parse_status, 'failed', '只有标题的条目算失败')
assert.equal(status('no-body').parse_status, 'failed', '没有正文的条目算失败')

console.log('markFailed：4 项断言全部通过')
