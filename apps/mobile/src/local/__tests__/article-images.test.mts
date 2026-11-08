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


// A video page has no body images; the cover is in the metadata. Without the
// fallback these entries were saved with no thumbnail at all.
{
  const videoHtml = `<!doctype html><html><head>
<meta property="og:title" content="某场演讲">
<meta property="og:description" content="一场关于分布式系统的演讲">
<meta property="og:image" content="https://i.ytimg.com/vi/abc123/hqdefault.jpg">
<meta property="og:site_name" content="YouTube">
</head><body><div id="player"></div></body></html>`
  const article = extractFromHtml(videoHtml, 'https://www.youtube.com/watch?v=abc123')
  assert.deepEqual(article.images, ['https://i.ytimg.com/vi/abc123/hqdefault.jpg'], '视频页应取封面图')

  // Relative cover URLs are resolved against the page address.
  const relativeHtml = `<html><head><meta property="og:image" content="/cover.png"></head><body><p>短</p></body></html>`
  const relative = extractFromHtml(relativeHtml, 'https://example.com/post/1')
  assert.deepEqual(relative.images, ['https://example.com/cover.png'])

  // twitter:image is used when og:image is absent.
  const twitterHtml = `<html><head><meta name="twitter:image" content="https://cdn.example.com/t.jpg"></head><body><p>短</p></body></html>`
  assert.deepEqual(extractFromHtml(twitterHtml, 'https://example.com/x').images, ['https://cdn.example.com/t.jpg'])

  // A data: URI is not a usable cover.
  const dataHtml = `<html><head><meta property="og:image" content="data:image/png;base64,AAAA"></head><body><p>短</p></body></html>`
  assert.deepEqual(extractFromHtml(dataHtml, 'https://example.com/y').images, [])
}

console.log('图片：原位保留、图标过滤、视频封面回退 全部通过 ✓')
