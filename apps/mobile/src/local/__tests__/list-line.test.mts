/**
 * List-line classification: WeChat text often puts text right after the dot
 * (`3.` then text, no space), while `3.5` is a decimal, not an item.
 *
 * Usage: npx tsx src/local/__tests__/list-line.test.mts
 */
import assert from 'node:assert/strict'

import { parseListLine } from '@trovia/shared'

assert.deepEqual(parseListLine('1. Start from first principles'), {
  ordered: true,
  marker: '1.',
  text: 'Start from first principles',
  depth: 0,
})

// No space after the dot is common in WeChat copy; decimals must not match.
assert.equal(parseListLine('3.Rewrite the question first')?.text, 'Rewrite the question first')
assert.equal(parseListLine('3.5 billion parameters'), null)
assert.equal(parseListLine('2026.11.18 release'), null)

// Chinese numbering and bracket numbering
assert.equal(parseListLine('2、Draft three options')?.marker, '2.')
assert.equal(parseListLine('（3）Wrap up')?.marker, '3.')

// Unordered items and nesting
assert.equal(parseListLine('- unordered item')?.ordered, false)
assert.equal(parseListLine('  - nested item')?.depth, 1)
assert.equal(parseListLine('    - one level deeper')?.depth, 2)

// A normal sentence is not a list
assert.equal(parseListLine('This afternoon I skimmed a few saved posts.'), null)

console.log('list lines: numbering, no-space, decimals and indent pass')
