/**
 * 正文中间「广告壳」行的清理。真实来源：SaveFrom 那篇把评分条、徽章、
 * Advertising 标签一起抓进了正文，读起来像网页残留。
 *
 * 红线两条：句子里提到 advertising 不能删；代码块里一个字都不能动。
 *
 * 跑法：npx tsx apps/mobile/src/local/__tests__/noise-inline.test.mts
 */
import assert from 'node:assert/strict'
import { stripNoiseLines } from '../noise.ts'

// 1. SaveFrom 那篇的真实形态
const savefrom = [
  'Scanned by',
  '',
  'NortonTM Safe Web',
  '',
  'Advertising',
  '',
  '★★★★★ 4.8/5 · 55,196 reviews',
  '',
  'Free Online Video Downloader',
  '',
  'Download videos from popular platforms with SaveFrom.net, the leading free online video downloader.',
].join('\n')
const cleaned = stripNoiseLines(savefrom)
assert.equal(cleaned.includes('Scanned by'), false, '徽章行应当删掉')
assert.equal(cleaned.includes('Advertising'), false, '广告标签应当删掉')
assert.equal(cleaned.includes('★★★★★'), false, '评分条应当删掉')
assert.equal(cleaned.includes('Free Online Video Downloader'), true, '标题要留着')
assert.equal(cleaned.includes('Download videos from popular platforms'), true, '正文要留着')

// 2. 句子里出现这些词不能删（长度超过上限就说明有上下文）
const prose = 'The report found that advertising revenue fell 12% while subscription income grew, a shift the company called structural.'
assert.equal(stripNoiseLines(prose), prose, '正常句子不能被当成广告行')

// 3. 代码块里原样保留
const code = ['```', 'Advertising', '★★★★★ 4.8/5 · 55,196 reviews', '```'].join('\n')
assert.equal(stripNoiseLines(code), code, '代码块不能被清理')

// 4. 列表前缀和链接壳也能识别
const linked = ['- [Scanned by Norton](https://x.com/norton)', '* Advertising'].join('\n')
assert.equal(stripNoiseLines(linked).trim(), '', '带列表前缀/链接壳的广告行也要删掉')

// 5. 只有 4 颗星也不算评分条重复，但 5 星带评价数要删
const stars = '★★★★☆ 4.4/5 · 202 reviews'
assert.equal(stripNoiseLines(stars), '', '四星半的评分条同样属于噪声')

console.log('stripNoiseLines：5 项断言全部通过')
