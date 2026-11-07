/**
 * Characters recognised on an image go only into search, never into the body.
 *
 * How to run: npx tsx apps/mobile/src/local/__tests__/ocr-text.test.mts
 */
import assert from 'node:assert/strict'
import { mergeOcrText } from '../ocr-text.ts'

const article = { markdown: '# 标题\n\n正文第一段。', plainText: '标题 正文第一段。' }
const merged = mergeOcrText(article, '截图里的报价：￥399')

assert.equal(merged.markdown, article.markdown, '正文 markdown 不能被 OCR 文本改动')
assert.equal(merged.markdown.includes('图片文字'), false, '不该再出现「图片文字」小节')
assert.equal(merged.plainText.includes('￥399'), true, '检索文本里必须带上图上的字')
assert.equal(merged.plainText.startsWith('标题'), true, '原有检索文本要留在前面')

// Returns the input unchanged when there is no recognition result
assert.deepEqual(mergeOcrText(article, '   '), article, '空结果不该改动任何东西')

// No stray blank lines left behind even when the original text is empty
const empty = mergeOcrText({ markdown: '', plainText: '' }, '图上的唯一文字')
assert.equal(empty.plainText, '图上的唯一文字')
assert.equal(empty.markdown, '')

console.log('mergeOcrText：6 项断言通过')
