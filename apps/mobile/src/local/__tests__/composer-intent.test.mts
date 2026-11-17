/**
 * One field, three destinations. Only a question goes to the model; a wrong
 * guess must stay cheap, so everything else keeps searching locally.
 *
 * Usage: npx tsx src/local/__tests__/composer-intent.test.mts
 */
import assert from 'node:assert/strict'

import { detectIntent } from '@trovia/shared'

assert.equal(detectIntent('https://example.com/a', true), 'save')
assert.equal(detectIntent('My saved posts about browser automation disagree?', false), 'ask')
assert.equal(detectIntent('how did those two posts differ', false), 'ask')
assert.equal(detectIntent('playwright', false), 'search')
assert.equal(detectIntent('saved', false), 'search')
assert.equal(
  detectIntent('the vector search articles I saved last week', false),
  'search',
  'a long statement is not a question',
)

console.log('composer intent: save, ask and search split pass')
