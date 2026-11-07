/**
 * Inline Markdown: the parser that replaced a regex which leaked `](url)`.
 *
 * Run: npx tsx src/local/__tests__/markdown-inline.test.mts
 */
import assert from 'node:assert/strict'

import { inlineToText, normalizeBlockSource, parseInline } from '../markdown-inline.ts'

const kinds = (text: string) => parseInline(text).map((token) => token.type)

// The failure that shipped in 0.14.0: a GitHub README badge is an image inside
// a link, and the old regex gave up on the inner `]` and printed the tail.
const BADGE = '[![npm](https://img.shields.io/npm/v/react.svg)](https://www.npmjs.com/package/react)'
{
  const tokens = parseInline(BADGE)
  assert.deepEqual(kinds(BADGE), ['link'])
  assert.equal(tokens[0].type === 'link' && tokens[0].href, 'https://www.npmjs.com/package/react')
  assert.equal(inlineToText(tokens), 'npm', '徽章应显示 alt 文字')
  assert.ok(!inlineToText(tokens).includes(']('), '不能把 ](url) 印出来')
}

// The exact shape the GitHub page produced: a heading marker glued to a link
// and an image, no whitespace between them.
{
  const source = '##[React](https://react.dev/)![GitHub license](https://camo.example/x.png)'
  const tokens = parseInline(source)
  assert.deepEqual(
    tokens.map((token) => token.type),
    ['text', 'link', 'image'],
  )
  // Inline images contribute no text: as badges they are noise mid-sentence,
  // and standalone images have their own rendering path.
  assert.equal(inlineToText(tokens), '##React')
}

// URLs containing parentheses (Wikipedia) must stay whole.
{
  const tokens = parseInline('[Foo](https://en.wikipedia.org/wiki/Foo_(bar))')
  assert.equal(tokens.length, 1)
  assert.equal(
    tokens[0].type === 'link' && tokens[0].href,
    'https://en.wikipedia.org/wiki/Foo_(bar)',
  )
}

// Link text containing brackets: nested brackets are counted, not truncated.
{
  const tokens = parseInline('[a [b] c](https://example.com)')
  assert.deepEqual(kinds('[a [b] c](https://example.com)'), ['link'])
  assert.equal(inlineToText(tokens), 'a [b] c')
}

// A lone bracket is text, and must not swallow the rest of the line.
{
  assert.deepEqual(kinds('array[0] is fine'), ['text'])
  assert.equal(inlineToText(parseInline('array[0] is fine')), 'array[0] is fine')
}

// Escaped brackets are literal.
{
  assert.equal(inlineToText(parseInline('a \\[b\\](c)')), 'a [b](c)')
}

// Inline code, bold and italic still work, and bold wins over italic.
{
  const tokens = parseInline('use `npm i` and **bold** and *italic*')
  assert.deepEqual(tokens.map((token) => token.type), ['text', 'code', 'text', 'bold', 'text', 'italic'])
  assert.equal(inlineToText(tokens), 'use npm i and bold and italic')
}

// Unbalanced input stays literal instead of eating the paragraph.
{
  assert.equal(inlineToText(parseInline('[unclosed](https://example.com')), '[unclosed](https://example.com')
  assert.equal(inlineToText(parseInline('![no](url')), '![no](url')
}

// The 0.14.0 bug: the block splitter put blank lines around every image, which
// tore a badge (image inside a link) into `[` / image / `](href)`.
{
  const line = '## [React](https://react.dev/) · [![GitHub license](https://camo/x.png)](https://github.com/react/react/blob/main/LICENSE)'
  const out = normalizeBlockSource(line)
  assert.ok(!/^\]\(/m.test(out), '不能出现以 ]( 开头的行')
  assert.ok(out.includes('[GitHub license](https://github.com/react/react/blob/main/LICENSE)'), '徽章应降级成文字链接')
  assert.ok(!out.includes('![GitHub license]'), '徽章的图片语法应已消失')
  // A standalone image still gets a paragraph of its own.
  const standalone = normalizeBlockSource('text ![a](https://img.example/a.png) more')
  assert.ok(standalone.includes('\n\n![a](https://img.example/a.png)\n\n'))
}

console.log('inline markdown: 9 cases passed')
