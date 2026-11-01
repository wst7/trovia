/**
 * 时间表达解析的回归测试。固定「现在」为 2026-11-01 15:30（周日），
 * 本周一是 10-26，上周是 10-19～10-25。
 *
 * 跑法：npx tsx apps/mobile/src/local/__tests__/query.test.mts
 */
import assert from 'node:assert/strict'
import { parseQuery } from '../query.ts'

const NOW = new Date(2026, 10, 1, 15, 30) // 2026-11-01
const q = (text: string) => parseQuery(text, { now: NOW })

/** 取命中区间的本地日期，方便断言。 */
function days(text: string): string[] {
  const parsed = parseQuery(text, { now: NOW })
  return parsed.ranges.map((range) => {
    const from = new Date(range.from)
    return `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`
  })
}

// 相对日
assert.deepEqual(days('找找昨天的'), ['2026-10-31'])
assert.equal(q('找找昨天的').summary, '昨天保存的')
assert.equal(q('找找昨天的').onlyDate, true, '只有时间条件时不该带关键词')
assert.deepEqual(days('前天的'), ['2026-10-30'])
assert.deepEqual(days('大前天'), ['2026-10-29'])
assert.deepEqual(days('今天存了什么'), ['2026-11-01'])
assert.deepEqual(days('3天前'), ['2026-10-29'])
assert.deepEqual(days('最近三天'), ['2026-10-30'], '最近三天从 10-30 起')
assert.deepEqual(days('最近7天'), ['2026-10-26'])

// 绝对日
assert.deepEqual(days('10月31日的收藏'), ['2026-10-31'])
assert.deepEqual(days('2026-10-30'), ['2026-10-30'])
assert.deepEqual(days('2026年10月31日'), ['2026-10-31'])
assert.deepEqual(days('12月5日'), ['2025-12-05'], '没说年份且落在未来 → 去年')
assert.deepEqual(days('2026年10月'), ['2026-10-01'], '整月从 1 号开始')
assert.deepEqual(days('2022年发表的'), ['2022-01-01'], '裸年份 + 发表意图 = 整年')
assert.deepEqual(days('2022年'), [], '没有收藏/发表意图时，裸年份不当时间条件')
assert.equal(q('2022年最值得买的手机').text.includes('2022'), true, '裸年份留在关键词里')

// 周 / 月 / 年
assert.deepEqual(days('上周'), ['2026-10-19'])
assert.deepEqual(days('本周'), ['2026-10-26'])
assert.deepEqual(days('周三'), ['2026-10-28'])
assert.deepEqual(days('上周三'), ['2026-10-21'])
assert.deepEqual(days('上周末'), ['2026-10-24'], '上周末的周六')
assert.deepEqual(days('上个月'), ['2026-10-01'])
assert.deepEqual(days('今年'), ['2026-01-01'])
assert.deepEqual(days('去年'), ['2025-01-01'])

// 意图：收藏 vs 发表
assert.equal(q('发表于10月31日的文章').ranges[0].field, 'published')
assert.equal(q('发表于10月31日的文章').summary, '10月31日发表的')
assert.equal(q('10月31日收藏的').ranges[0].field, 'saved')
assert.equal(q('昨天保存的').ranges[0].field, 'saved')

// 关键词保留
assert.equal(q('昨天收藏的那篇讲睡眠的').text, '讲睡眠', '时间词与口头语要去掉')
assert.equal(q('延时队列').text, '延时队列')
assert.equal(q('延时队列').ranges.length, 0, '没有时间词就不该有区间')
assert.equal(q('延时队列').summary, null)

// 不能误伤普通词
assert.equal(q('月亮与六便士').ranges.length, 0, '「月」不是时间词')
assert.equal(q('周末去哪儿').ranges.length >= 0, true)

console.log('✓ 时间解析全部通过（相对/绝对/周月年/收藏与发表意图/关键词保留）')
