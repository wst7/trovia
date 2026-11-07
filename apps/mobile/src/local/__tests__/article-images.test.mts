/**
 * Regression test for image placement in the body: images must stay where they were, not be collected at the bottom.
 * It also verifies that plain text does not pick up image URLs (otherwise a string of links shows up in search and summaries).
 *
 * How to run: npx tsx apps/mobile/src/local/__tests__/article-images.test.mts
 */
import assert from 'node:assert/strict'
import { extractFromHtml } from '../article.ts'

const html = `<!doctype html><html><head>
<meta property="og:title" content="测试文章">
<meta property="article:published_time" content="2026-10-31T09:00:00+08:00">
</head><body>
<article>
  <h2>第一节</h2>
  <p>第一段文字，说的是某种现象。</p>
  <img src="/images/diagram.png" alt="示意图">
  <p>第二段文字，紧接着上面的图。</p>
  <p>第三段里夹着一张图 <img src="https://cdn.example.com/inline.png" alt="行内图"> 后面还有字。</p>
  <img src="/static/logo-avatar.png" alt="图标">
  <img src="data:image/png;base64,AAAA" alt="内联数据">
  <img src="/images/small.png" width="32" height="32" alt="小图标">
  <p>最后一段。</p>
</article>
</body></html>`

const article = extractFromHtml(html, 'https://example.com/posts/1')

// Images appear in place in the markdown: the paragraph before, the image in the middle, the next paragraph after
const md = article.markdown
assert.ok(md.indexOf('第一段文字') < md.indexOf('diagram.png'), '图应在第一段之后')
assert.ok(md.indexOf('diagram.png') < md.indexOf('第二段文字'), '图应在第二段之前')
assert.ok(md.indexOf('第三段里夹着') < md.indexOf('inline.png'), '行内图应在所在段落之后')
assert.ok(md.indexOf('inline.png') < md.indexOf('后面还有字'), '行内图后面的文字应还在后面')

// Relative URLs are completed into absolute URLs
assert.match(article.markdown, /!\[示意图\]\(https:\/\/example\.com\/images\/diagram\.png\)/)

// Inline images must become their own paragraph too, never dropped
assert.match(article.markdown, /!\[行内图\]\(https:\/\/cdn\.example\.com\/inline\.png\)/)

// Icons, 1x1 images and data: URLs are all filtered out
assert.doesNotMatch(article.markdown, /logo-avatar/, '图标不该进正文')
assert.doesNotMatch(article.markdown, /data:image/, '内联 data 图不该进正文')
assert.doesNotMatch(article.markdown, /small\.png/, '小尺寸图不该进正文')

// Plain text has no image markdown and no image URLs
assert.doesNotMatch(article.plainText, /!\[/, '纯文本不该含图片标记')
assert.doesNotMatch(article.plainText, /diagram\.png/, '纯文本不该含图片地址')
assert.match(article.plainText, /第一段文字/)

// The publication date is parsed as usual
assert.equal(article.publishedAt, '2026-10-31')

// The images array still backs OCR and older versions
assert.deepEqual(article.images, [
  'https://example.com/images/diagram.png',
  'https://cdn.example.com/inline.png',
])

console.log('✓ 图片留在原位：段落 → 图 → 段落 → 行内图，图标与 data: 图被过滤')
