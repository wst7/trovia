/**
 * Lists must survive extraction: <ol> keeps its numbers, nesting keeps its
 * indent. Flattened, the detail screen turns into a wall of equal paragraphs.
 *
 * Usage: npx tsx src/local/__tests__/article-lists.test.mts
 */
import assert from 'node:assert/strict'

import { extractFromHtml } from '../article.ts'

const html = `<!doctype html><html><head><title>Lists</title></head><body>
<article>
<ol><li>Align on the need<ol><li>Ask about the scenario</li></ol></li><li>Draft options</li></ol>
<ul><li>An unordered item</li></ul>
</article></body></html>`

const article = extractFromHtml(html, 'http://127.0.0.1/lists.html')
assert.ok(article.markdown.includes('1. Align on the need'), 'ordered lists keep numbers')
assert.ok(article.markdown.includes('  1. Ask about the scenario'), 'nested items keep a two-space indent')
assert.ok(article.markdown.includes('- An unordered item'), 'unordered lists use a dash')

console.log('article lists: ordered, unordered and nested indent pass')
