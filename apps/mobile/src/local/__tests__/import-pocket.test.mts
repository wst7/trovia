/**
 * Pocket's CSV export.
 *
 * This is the table a great many users exported after Pocket shut down: the column names are given_url / given_title /
 * time_added (Unix seconds), which is nothing like Raindrop's and Instapaper's url/title.
 * The time has to be recognised, otherwise everything saved in 2019 turns into “today” on the timeline.
 *
 * How to run: npx tsx apps/mobile/src/local/__tests__/import-pocket.test.mts
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

// A table with only url/title has to be readable too (the Raindrop and Instapaper shape)
const simple = ['url,title', 'https://example.com/b,只有标题'].join('\n')
const simpleParsed = parseImport(simple)
assert.equal(simpleParsed.items.length, 1)
assert.equal(simpleParsed.items[0].addedAt, null, '没有时间列时不该编一个时间出来')

// The time span in the preview: the two rows are 2020-01 and 2020-09 respectively (shown in the device's timezone), not “today”
assert.equal(addedRange(parsed.items), '2020-01 至 2020-09')

// An export with no time column must not make a date up
assert.equal(addedRange(simpleParsed.items), null, '纯 url/title 的文件没有时间跨度')
assert.equal(addedRange([]), null, '空列表也不能崩')

console.log('Pocket CSV：11 项断言全部通过')
