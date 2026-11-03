/**
 * 文案字典的守门测试。
 *
 * 跑法：npx tsx src/local/__tests__/i18n.test.mts
 *
 * 三件事：
 *  1. 两份字典的键必须一一对应——少一条就是英文界面里冒出中文；
 *  2. 同一条文案在两种语言里的占位符必须一样，否则 count 会被吃掉；
 *  3. 界面文件里不能再写死中文，除了注释。
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

// 英文里不该混进中文字符（语言名「中文」是唯一例外）
for (const key of enKeys) {
  if (key === 'settings.language.zh') continue
  assert.equal(
    /[\u4e00-\u9fff]/.test(en[key]),
    false,
    `「${key}」的英文里还有中文：${en[key]}`,
  )
}

/** 收集界面文件里写死的中文：只查屏幕、组件和 ui，逻辑层另有安排。 */
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

// 英文界面上给出的示例词必须真能解析出时间条件，否则中英文体验是两套。
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
