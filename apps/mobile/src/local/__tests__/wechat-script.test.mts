/**
 * Regression for the new WeChat article template: the body is no longer in
 * #js_content but in a script object's `content_noencode` field. Reading the
 * DOM alone reports "only part of the article".
 *
 * Usage: npx tsx src/local/__tests__/wechat-script.test.mts
 */
import assert from 'node:assert/strict'

import { extractFromHtml } from '../article.ts'

const html = `<!doctype html>
<html><head>
<meta property="og:title" content="Ten prompts." />
<meta name="author" content="Test author" />
<title> </title>
</head><body>
<script>
  var appmsg = {
    title: 'Ten prompts.',
    content_noencode: 'First paragraph: start from first principles.\\x0a\\x0aSecond paragraph: align on the need before drafting.\\x0a\\x0a1. Fix the root cause.\\x0a\\x0a2. Trace second-order effects.',
  };
</script>
</body></html>`

const article = extractFromHtml(html, 'http://127.0.0.1/wechat.html')
assert.equal(article.title, 'Ten prompts.')
assert.equal(article.author, 'Test author')
assert.ok(article.plainText.includes('first principles'), 'must read content_noencode')
assert.ok(article.plainText.includes('second-order effects'), 'must not stop at the first paragraph')
assert.equal(article.blocked, false, 'body present means not blocked')
assert.equal(article.scriptOnly, false, 'body present means not script-only')

console.log('WeChat script body: content_noencode and metadata pass ✓')
