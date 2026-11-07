/**
 * Guard test for the copy dictionaries.
 *
 * How to run: npx tsx src/local/__tests__/i18n.test.mts
 *
 * Three things:
 *  1. the keys of the two dictionaries must match one to one — one missing key means Chinese leaking into the English UI;
 *  2. the same string must use the same placeholders in both languages, otherwise count gets swallowed;
 *  3. UI files must no longer hard-code Chinese, comments aside.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { applyLocalePreference, en, zh } from '../../i18n/index.ts'
import { parseQuery } from '../query.ts'

const zhKeys = Object.keys(zh).sort()
const enKeys = Object.keys(en).sort()

const missingInEn = zhKeys.filter((key) => !(key in en))
const missingInZh = enKeys.filter((key) => !(key in zh))
assert.deepEqual(missingInEn, [], `en 缺这些键：${missingInEn.join(', ')}`)
assert.deepEqual(missingInZh, [], `zh 缺这些键：${missingInZh.join(', ')}`)

const placeholders = (text: string) => (text.match(/\{(\w+)\}/g) ?? []).sort()
for (const key of zhKeys) {
  assert.deepEqual(
    placeholders(zh[key]),
    placeholders(en[key]),
    `「${key}」的占位符两边不一致`,
  )
  assert.ok(zh[key].trim().length > 0, `「${key}」的中文是空的`)
  assert.ok(en[key].trim().length > 0, `「${key}」的英文是空的`)
}

// No Chinese characters should leak into English (the name of the Chinese language is the only exception)
for (const key of enKeys) {
  if (key === 'settings.language.zh') continue
  assert.equal(
    /[\u4e00-\u9fff]/.test(en[key]),
    false,
    `「${key}」的英文里还有中文：${en[key]}`,
  )
}

/** Collect hard-coded Chinese in UI files: only screens, components and ui are checked; the logic layer is handled elsewhere. */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sources(path))
    else if (/\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

const uiFiles = [
  ...sources(new URL('../../screens', import.meta.url).pathname),
  ...sources(new URL('../../components', import.meta.url).pathname),
  ...sources(new URL('../../ui', import.meta.url).pathname),
]

const CJK_STRING = /(['"`])(?:(?!\1).)*[\u4e00-\u9fff](?:(?!\1).)*\1/g
const offenders: string[] = []
for (const file of uiFiles) {
  const code = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  for (const match of code.matchAll(CJK_STRING)) {
    offenders.push(`${file.split('/src/')[1]}: ${match[0].slice(0, 40)}`)
  }
}
assert.deepEqual(offenders, [], `界面里还有写死的中文：\n${offenders.join('\n')}`)

// The example words offered in the English UI must really parse into a time condition, otherwise English and Chinese become two different experiences.
applyLocalePreference('en')
const now = new Date(2026, 10, 3, 12, 0, 0)
for (const [word, label] of [
  ['today', 'saved today'],
  ['yesterday', 'saved yesterday'],
  ['last week', 'saved last week'],
  ['this month', 'saved this month'],
] as const) {
  const parsed = parseQuery(word, { now })
  assert.equal(parsed.ranges.length, 1, `「${word}」没有解析出时间条件`)
  assert.equal(parsed.summary, label, `「${word}」的说法不对：${parsed.summary}`)
}
assert.match(parseQuery('上周存的', { now }).summary ?? '', /^saved last week/, '中文输入在英文界面下也说英文')
applyLocalePreference('zh')
assert.equal(parseQuery('上周存的', { now }).summary, '上周保存的', '中文界面不能被改坏')

console.log(`i18n：${zhKeys.length} 条文案，两份字典对齐，界面无写死中文，英文示例词可解析`)
