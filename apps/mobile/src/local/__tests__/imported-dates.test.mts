/**
 * The check an imported time goes through before it hits the DB: use it only if it is plausible, otherwise fall back to now.
 *
 * How to run: npx tsx apps/mobile/src/local/__tests__/imported-dates.test.mts
 */
import assert from 'node:assert/strict'
import { resolveImportedSavedAt } from '../import/dates.ts'

const now = Date.parse('2026-11-03T00:00:00.000Z')

// 2019-01-01T00:00:00Z: an old bookmark must land in its own year
assert.equal(resolveImportedSavedAt(1546300800000, now), '2019-01-01T00:00:00.000Z')
// Yesterday: adopted as is
assert.equal(resolveImportedSavedAt(now - 86400000, now), '2026-11-02T00:00:00.000Z')

// A future time: the file is wrong, so it cannot be used
assert.equal(resolveImportedSavedAt(now + 86400000, now), '2026-11-03T00:00:00.000Z')
// 0 / negative / NaN / null / undefined: all fall back to now
for (const bad of [0, -1, Number.NaN, null, undefined]) {
  assert.equal(
    resolveImportedSavedAt(bad as number | null | undefined, now),
    '2026-11-03T00:00:00.000Z',
    `${String(bad)} 应当退回现在`,
  )
}

console.log('resolveImportedSavedAt：8 项断言通过')
