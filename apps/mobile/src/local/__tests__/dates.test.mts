/**
 * 日期分组文案的回归测试。
 * 跑法：npx tsx apps/mobile/src/local/__tests__/dates.test.mts
 */
import assert from 'node:assert/strict'
import { dayLabel } from '../dates.ts'

const now = new Date('2026-11-02T10:00:00+08:00')

assert.equal(dayLabel('2026-11-02T08:00:00+08:00', now), '今天')
assert.equal(dayLabel('2026-11-02T00:05:00+08:00', now), '今天', '当天凌晨也算今天')
assert.equal(dayLabel('2026-11-01T23:59:00+08:00', now), '昨天')
assert.equal(dayLabel('2026-10-31T12:00:00+08:00', now), '前天')
assert.equal(dayLabel('2026-10-20T12:00:00+08:00', now), '10月20日', '同年给具体日期')
assert.equal(dayLabel('2025-12-31T12:00:00+08:00', now), '2025年12月31日', '跨年带年份')
assert.equal(dayLabel('not-a-date', now), '', '坏时间不编标签')
console.log('✓ 今天/昨天/前天/同年日期/跨年日期/坏时间都按预期')

// 同一天的两条必须给同一个标签，否则分组会碎
const a = dayLabel('2026-11-01T09:00:00+08:00', now)
const b = dayLabel('2026-11-01T21:00:00+08:00', now)
assert.equal(a, b)
console.log('✓ 同一天不同时间标签一致')
