/**
 * 检查落地页的英文覆盖率。
 *
 * i18n.js 用「中文原文」做键，所以 HTML 里改了文案却忘了补字典时，
 * 英文模式会静默地留下一句中文——只有人眼切过去才看得见。
 * 这个脚本把它变成构建前就能发现的错误。
 *
 * 用法：node tools/check-i18n.mjs [--strict]
 *   --strict  发现漏翻时以非零码退出（CI 用）
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const html = await readFile(join(root, 'index.html'), 'utf8')
const i18n = await readFile(join(root, 'public/i18n.js'), 'utf8')

/** 只保留 <body> 里、不在 script/style 内的文本节点。 */
function textNodes(source) {
  const body = source.slice(source.indexOf('<body'))
  const nodes = []
  let skip = 0
  const re = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>|<\/(script|style)>|<[^>]+>|([^<]+)/gi
  let m
  while ((m = re.exec(body))) {
    if (m[0].startsWith('<!--')) continue
    if (m[1]) {
      skip += 1
      continue
    }
    if (m[2]) {
      skip = Math.max(0, skip - 1)
      continue
    }
    if (m[3] && skip === 0) {
      const key = m[3].replace(/\s+/g, ' ').trim()
      if (key) nodes.push(key)
    }
  }
  return nodes
}

/** 取出 EN 字典的键；值里可能含引号和转义，按行首的 'key': 形态匹配。 */
function dictKeys(source) {
  const dict = source.slice(source.indexOf('var EN = {'), source.indexOf('var META = {'))
  const keys = new Set()
  const re = /^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*:\s*\n?\s*(?:'|")/gm
  let m
  while ((m = re.exec(dict))) {
    const raw = m[1] !== undefined ? m[1] : m[2]
    keys.add(raw.replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim())
  }
  return keys
}

/** 这些是本来就不该翻译的：品牌名、语言开关、英文标语、纯标点。 */
const IGNORE = new Set([
  'Trovia',
  '中文',
  'EN',
  'Save anything. Find it by memory.',
  'Trovia · Save anything. Find it by memory.',
])

const keys = dictKeys(i18n)
const nodes = [...new Set(textNodes(html))]
const missing = nodes.filter((n) => !IGNORE.has(n) && !keys.has(n))
const unused = [...keys].filter((k) => !nodes.includes(k))

console.log(`HTML 文本节点 ${nodes.length} 条，字典 ${keys.size} 条`)
console.log(`漏翻 ${missing.length} 条` + (unused.length ? `，字典里已无对应原文 ${unused.length} 条` : ''))

for (const text of missing) console.log(`  漏翻: ${text.slice(0, 100)}`)
for (const text of unused) console.log(`  无对应原文: ${text.slice(0, 100)}`)

const strict = process.argv.includes('--strict')
if (missing.length > 0) {
  if (strict) process.exitCode = 1
  else console.log('\n提示：CI 里加 --strict 会让漏翻直接失败。')
}
