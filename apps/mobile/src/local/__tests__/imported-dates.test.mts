/**
 * 导入时间落库前的那道判断：合理才用，否则退回现在。
 *
 * 跑法：npx tsx apps/mobile/src/local/__tests__/imported-dates.test.mts
 */
import assert from 'node:assert/strict'
import { resolveImportedSavedAt } from '../import/dates.ts'

const now = Date.parse('2026-11-03T00:00:00.000Z')

// 2019-01-01T00:00:00Z：老书签要落在它自己的年份
assert.equal(resolveImportedSavedAt(1546300800000, now), '2019-01-01T00:00:00.000Z')
// 昨天：正常采用
assert.equal(resolveImportedSavedAt(now - 86400000, now), '2026-11-02T00:00:00.000Z')

// 未来时间：文件里写错了，不能用
assert.equal(resolveImportedSavedAt(now + 86400000, now), '2026-11-03T00:00:00.000Z')
// 0 / 负数 / NaN / null / undefined：都退回现在
for (const bad of [0, -1, Number.NaN, null, undefined]) {
  assert.equal(
    resolveImportedSavedAt(bad as number | null | undefined, now),
    '2026-11-03T00:00:00.000Z',
    `${String(bad)} 应当退回现在`,
  )
}

console.log('resolveImportedSavedAt：8 项断言通过')
