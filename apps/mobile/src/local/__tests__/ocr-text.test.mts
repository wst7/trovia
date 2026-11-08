/**
 * Characters recognised on an image are a search clue, not article text.
 *
 * They answer "I remember the figure on that screenshot"; they are not the
 * article's prose, so they must never reach the body, plain_text or a summary
 * written from that text.
 *
 * How to run: npx tsx src/local/__tests__/ocr-text.test.mts
 */
import assert from 'node:assert/strict'

import { appendOcrForSearch } from '../ocr-text.ts'

const body = { markdown: '# Title\n\nFirst paragraph.', plainText: 'Title First paragraph.' }
const search = appendOcrForSearch('title summary first paragraph', 'quote in the screenshot: $399')

assert.equal(body.markdown.includes('$399'), false, '正文 markdown 不含图上文字')
assert.equal(body.plainText.includes('$399'), false, 'plain_text 不含图上文字')
assert.ok(search.includes('$399'), '检索串必须带上图上的字')
assert.ok(search.startsWith('title summary'), '原有检索文本要留在前面')

// Nothing recognised: the search string is returned untouched
assert.equal(appendOcrForSearch('abc', '   '), 'abc')
assert.equal(appendOcrForSearch('abc', undefined), 'abc')

// Empty original text: no leading blank line is introduced
assert.equal(appendOcrForSearch('', 'only text on the image'), 'only text on the image')

console.log('OCR 文本：7 项断言通过（只进检索，不进正文）')
