/**
 * Cleanup of the “ad shell” lines inside the body. Real source: the SaveFrom article had the rating bar, badges and
 * Advertising labels pulled into the body along with the rest, reading like leftovers from the web page.
 *
 * Two red lines: a sentence that mentions advertising must not be deleted; not one character inside a code block may move.
 *
 * How to run: npx tsx apps/mobile/src/local/__tests__/noise-inline.test.mts
 */
import assert from 'node:assert/strict'
import { stripNoiseLines } from '../noise.ts'

// 1. The real shape of the SaveFrom article
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

// 2. These words inside a sentence must not delete it (going past the length cap means there is context)
const prose = 'The report found that advertising revenue fell 12% while subscription income grew, a shift the company called structural.'
assert.equal(stripNoiseLines(prose), prose, '正常句子不能被当成广告行')

// 3. Kept as-is inside a code block
const code = ['```', 'Advertising', '★★★★★ 4.8/5 · 55,196 reviews', '```'].join('\n')
assert.equal(stripNoiseLines(code), code, '代码块不能被清理')

// 4. List prefixes and link shells are recognised too
const linked = ['- [Scanned by Norton](https://x.com/norton)', '* Advertising'].join('\n')
assert.equal(stripNoiseLines(linked).trim(), '', '带列表前缀/链接壳的广告行也要删掉')

// 5. Only 4 stars does not count as a repeated rating bar, but 5 stars with a review count must be deleted
const stars = '★★★★☆ 4.4/5 · 202 reviews'
assert.equal(stripNoiseLines(stars), '', '四星半的评分条同样属于噪声')

// 6. The site recommendation-bar echo (CSDN's “latest recommended article published on …”)
const reco = ['最新推荐文章于 2026-10-12 14:14:03 发布', '', '正文第一段。'].join('\n')
assert.equal(stripNoiseLines(reco).includes('最新推荐'), false, '推荐栏回显应当删掉')
assert.equal(stripNoiseLines(reco).includes('正文第一段'), true, '正文要留着')

console.log('stripNoiseLines：6 项断言全部通过')
