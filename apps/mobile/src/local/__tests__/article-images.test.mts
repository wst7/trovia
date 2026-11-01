/**
 * 正文里图片位置的回归测试：图片必须留在原来的位置，而不是被集中到底部。
 * 另外验证纯文本里不会混进图片 URL（否则搜索和摘要里会出现一串链接）。
 *
 * 跑法：npx tsx apps/mobile/src/local/__tests__/article-images.test.mts
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

// 图片按原位置出现在 markdown 里：段落在前、图在中间、下一段在后
const md = article.markdown
assert.ok(md.indexOf('第一段文字') < md.indexOf('diagram.png'), '图应在第一段之后')
assert.ok(md.indexOf('diagram.png') < md.indexOf('第二段文字'), '图应在第二段之前')
assert.ok(md.indexOf('第三段里夹着') < md.indexOf('inline.png'), '行内图应在所在段落之后')
assert.ok(md.indexOf('inline.png') < md.indexOf('后面还有字'), '行内图后面的文字应还在后面')

// 相对地址补全成绝对地址
assert.match(article.markdown, /!\[示意图\]\(https:\/\/example\.com\/images\/diagram\.png\)/)

// 行内图片也要单独成段，不能丢
assert.match(article.markdown, /!\[行内图\]\(https:\/\/cdn\.example\.com\/inline\.png\)/)

// 图标、1x1、data: 全部过滤掉
assert.doesNotMatch(article.markdown, /logo-avatar/, '图标不该进正文')
assert.doesNotMatch(article.markdown, /data:image/, '内联 data 图不该进正文')
assert.doesNotMatch(article.markdown, /small\.png/, '小尺寸图不该进正文')

// 纯文本里没有图片 markdown，也没有图片地址
assert.doesNotMatch(article.plainText, /!\[/, '纯文本不该含图片标记')
assert.doesNotMatch(article.plainText, /diagram\.png/, '纯文本不该含图片地址')
assert.match(article.plainText, /第一段文字/)

// 发表日期照常解析
assert.equal(article.publishedAt, '2026-10-31')

// images 数组仍然给 OCR 与老版本兜底用
assert.deepEqual(article.images, [
  'https://example.com/images/diagram.png',
  'https://cdn.example.com/inline.png',
])

console.log('✓ 图片留在原位：段落 → 图 → 段落 → 行内图，图标与 data: 图被过滤')
