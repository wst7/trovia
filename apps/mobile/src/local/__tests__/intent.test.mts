/**
 * Regression test for model intent parsing: everything goes through an injected completer, no network involved.
 * The focus is that junk data from the model must not break search.
 *
 * How to run: npx tsx apps/mobile/src/local/__tests__/intent.test.mts
 */
import assert from 'node:assert/strict'
import { clearIntentCache, detectIntent, mergeIntent, parseIntentJson, resolveIntent } from '../intent.ts'
import { parseQuery } from '../query.ts'

const NOW = new Date(2026, 10, 1, 15, 30) // 2026-11-01

const validJson = JSON.stringify({
  keywords: '睡眠',
  field: 'saved',
  date: { kind: 'range', from: '2026-09-30', to: '2026-10-31' },
  label: '上个月存的',
})

// Normal response
const parsed = parseIntentJson(validJson, NOW)
assert.ok(parsed)
assert.equal(parsed?.keywords, '睡眠')
assert.equal(parsed?.date.from, '2026-09-30')
assert.equal(parsed?.label, '上个月存的')
console.log('✓ 正常 JSON 能解析出关键词与区间')

// A markdown code fence must still parse
assert.ok(parseIntentJson('```json\n' + validJson + '\n```', NOW), '代码块包裹应能解析')
console.log('✓ 容忍 ```json 包裹')

// Junk output: not JSON / empty object / all empty
assert.equal(parseIntentJson('抱歉，我无法理解', NOW), null)
assert.equal(parseIntentJson('{}', NOW), null)
assert.equal(parseIntentJson('', NOW), null)
console.log('✓ 非 JSON 与空结果返回 null')

// Bad dates: reversed order, absurd year, wrong format
const reversed = parseIntentJson(JSON.stringify({ keywords: '', field: 'saved', date: { kind: 'range', from: '2026-10-31', to: '2026-10-01' }, label: 'x' }), NOW)
assert.equal(reversed?.date.kind, 'none', 'from > to 应被丢弃')
const futureYear = parseIntentJson(JSON.stringify({ keywords: 'x', field: 'saved', date: { kind: 'day', from: '3021-01-01', to: '3021-01-02' }, label: null }), NOW)
assert.equal(futureYear?.date.kind, 'none', '不合理年份应被丢弃')
const badFormat = parseIntentJson(JSON.stringify({ keywords: 'x', field: 'saved', date: { kind: 'day', from: '10/31', to: null }, label: null }), NOW)
assert.equal(badFormat?.date.kind, 'none')
console.log('✓ 坏日期被丢弃，但关键词仍然保留')

// Only a start is given: fill in the end according to kind
const onlyFrom = parseIntentJson(JSON.stringify({ keywords: '', field: 'saved', date: { kind: 'day', from: '2026-10-31', to: null }, label: '昨天' }), NOW)
assert.equal(onlyFrom?.date.to, '2026-11-01', 'day 类型应补成第二天')
console.log('✓ 只给 from 时按 kind 自动补 to')

// Merge: trust the model for time; if the model's keywords are empty, keep the rule-based ones
const rule = parseQuery('昨天收藏的讲睡眠的', { now: NOW })
const merged = mergeIntent(rule, parsed, NOW)
// When the rules already recognised "yesterday", the rules win; the model only covers phrasings the rules cannot recognise.
assert.equal(merged.ranges[0].from, new Date(2026, 9, 31).getTime(), '规则能确定时以规则为准')
assert.equal(merged.text, '睡眠')
assert.equal(merged.summary, '昨天保存的')

const rule2 = parseQuery('昨天收藏的讲睡眠的', { now: NOW })
const merged2 = mergeIntent(rule2, { ...parsed!, keywords: '' }, NOW)
assert.equal(merged2.text, '讲睡眠', '模型没给关键词时退回规则')
console.log('✓ 合并策略：规则优先、模型补位、关键词互补')

// Phrasings the rules cannot recognise are filled in by the model
const fuzzy = parseQuery('前阵子存的那篇讲睡眠的', { now: NOW })
assert.equal(fuzzy.ranges.length, 0, '规则认不出「前阵子」')
clearIntentCache()
const resolved = await resolveIntent('前阵子存的那篇讲睡眠的', {
  now: NOW,
  complete: async () => validJson,
})
assert.equal(resolved.ranges.length, 1, '模型补上了区间')
assert.equal(resolved.text, '睡眠')
console.log('✓ 规则认不出的「前阵子」由模型补上')

// Model failure / timeout: fall back to the rules, do not throw
clearIntentCache()
const fallback = await resolveIntent('昨天收藏的讲睡眠的', {
  now: NOW,
  complete: async () => {
    throw new Error('请求超时')
  },
})
assert.equal(fallback.ranges[0].from, new Date(2026, 9, 31).getTime(), '失败时用规则结果')
assert.equal(fallback.summary, '昨天保存的')
console.log('✓ 模型报错时退回规则层')

// Model returns garbage: fall back to the rules the same way
clearIntentCache()
const garbage = await resolveIntent('昨天收藏的讲睡眠的', { now: NOW, complete: async () => '嗯，大概是上个月吧' })
assert.equal(garbage.summary, '昨天保存的')
console.log('✓ 模型返回垃圾时退回规则层')

// The same phrase asks the model only once
clearIntentCache()
let calls = 0
const counted = async () => {
  calls += 1
  return validJson
}
await resolveIntent('上个月存的', { now: NOW, complete: counted })
await resolveIntent('上个月存的', { now: NOW, complete: counted })
assert.equal(calls, 1, '重复搜索应命中缓存')
console.log('✓ 同一句话只调用一次模型')

// The model gave a label but no range: keep the rule's wording, do not degrade it to "yesterday"
clearIntentCache()
const labelOnly = await resolveIntent('昨天保存的', {
  now: NOW,
  complete: async () => JSON.stringify({ keywords: '', field: 'saved', date: { kind: 'none', from: null, to: null }, label: '昨天' }),
})
assert.equal(labelOnly.summary, '昨天保存的', '时间条件没变时用规则的说法')
console.log('✓ 模型只给 label 不给区间时，沿用规则文案')

// Fuzzy time cue: no range on the first answer, so it should ask again automatically
clearIntentCache()
let attempts = 0
const lazy = async () => {
  attempts += 1
  return attempts === 1 ? JSON.stringify({ keywords: '延时队列', field: 'saved', date: { kind: 'none' }, label: null }) : validJson
}
const fuzzyRetry = await resolveIntent('前阵子存的延时队列', { now: NOW, complete: lazy })
assert.equal(attempts, 2, '应重试一次')
assert.equal(fuzzyRetry.ranges.length, 1, '重试后拿到了区间')
console.log('✓ 模糊时间线索会追问一次')

// With no time cue, no second call is made
clearIntentCache()
let plainCalls = 0
await resolveIntent('延时队列', { now: NOW, complete: async () => { plainCalls += 1; return JSON.stringify({ keywords: '延时队列', field: 'saved', date: { kind: 'none' }, label: null }) } })
assert.equal(plainCalls, 1, '无时间线索不该重试')
console.log('✓ 没有时间线索时不浪费第二次调用')

// With no model configured, no request is sent at all
clearIntentCache()
let unreachable = 0
const noModel = await resolveIntent('昨天的', {
  now: NOW,
  complete: null,
})
void unreachable
assert.equal(noModel.ranges[0].from, new Date(2026, 9, 31).getTime())
console.log('✓ 未配置模型时只用规则')

console.log('\n全部通过：模型意图解析 + 降级 + 缓存')
