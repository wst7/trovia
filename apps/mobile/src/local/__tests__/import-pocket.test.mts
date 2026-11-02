/**
 * Pocket 的 CSV 导出。
 *
 * Pocket 关停后大量用户导出的就是这张表：列名是 given_url / given_title /
 * time_added（Unix 秒），和 Raindrop、Instapaper 的 url/title 都不一样。
 * 时间要认出来，否则 2019 年存的东西会在时间线上全变成「今天」。
 *
 * 跑法：npx tsx apps/mobile/src/local/__tests__/import-pocket.test.mts
 */
import assert from 'node:assert/strict'
import { addedRange, parseImport } from '../import/parse.ts'

const csv = [
  'title,given_url,resolved_url,time_added,status,tags',
  '"Sleep is your superpower | Matt Walker",https://www.ted.com/talks/sleep,https://www.ted.com/talks/sleep,1577836800,0,"health,sleep"',
  '"被解析过的链接",https://example.com/a,https://example.com/a/final,1600000000,1,""',
  '"没有链接的行",,,1600000001,0,""',
].join('\n')

const parsed = parseImport(csv)
assert.equal(parsed.format, 'csv', '应当识别成 CSV')
assert.equal(parsed.items.length, 2, '没有链接的行要跳过')
assert.equal(parsed.items[0].url, 'https://ted.com/talks/sleep', '归一化会去掉 www')
assert.equal(parsed.items[0].title, 'Sleep is your superpower | Matt Walker')
assert.equal(
  parsed.items[0].addedAt,
  1577836800000,
  'time_added 是 Unix 秒，要转成毫秒时间戳',
)
assert.equal(parsed.skipped.length, 1, '跳过的行要有原因，不能静默丢')

// 表里只有 url/title 也要能读（Raindrop、Instapaper 的形态）
const simple = ['url,title', 'https://example.com/b,只有标题'].join('\n')
const simpleParsed = parseImport(simple)
assert.equal(simpleParsed.items.length, 1)
assert.equal(simpleParsed.items[0].addedAt, null, '没有时间列时不该编一个时间出来')

// 预览里的时间跨度：两行分别是 2020-01 与 2020-09（按本机时区显示），而不是「今天」
assert.equal(addedRange(parsed.items), '2020-01 至 2020-09')

// 没有时间列的导出不能编出一个日期来
assert.equal(addedRange(simpleParsed.items), null, '纯 url/title 的文件没有时间跨度')
assert.equal(addedRange([]), null, '空列表也不能崩')

console.log('Pocket CSV：11 项断言全部通过')
