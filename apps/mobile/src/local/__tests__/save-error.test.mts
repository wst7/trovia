import assert from 'node:assert/strict'
import { classifySaveError, SAVE_FAILURE_KEY } from '../save-error'

const cases: Array<[string, unknown, string]> = [
  ['数据库锁住', new Error('Call to function ... has been rejected. Caused by: SQLITE_BUSY: database is locked'), 'busy'],
  ['磁盘满', new Error('SQLITE_FULL: disk I/O error, no space left on device'), 'storage'],
  ['库损坏', new Error('SQLITE_CORRUPT: database disk image is malformed'), 'corrupt'],
  ['唯一约束', new Error('UNIQUE constraint failed: documents.url'), 'duplicate'],
  ['带 code 字段', { code: 'SQLITE_BUSY' }, 'busy'],
  ['认不出来', new Error('boom'), 'unknown'],
]
let passed = 0
for (const [name, error, expected] of cases) {
  assert.equal(classifySaveError(error), expected, `${name} 判错了`)
  assert.ok(SAVE_FAILURE_KEY[expected as keyof typeof SAVE_FAILURE_KEY], `${name} 没有对应文案`)
  passed += 1
}
console.log(`保存失败归类：${passed} 项通过`)
