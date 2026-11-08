/**
 * Go's extra request headers.
 *
 * A Go key against Zen's address answers 401; a correct Go request without the
 * session header answers 400 MissingSessionID. Both are configuration errors the
 * app must not produce on its own.
 *
 * How to run: npx tsx src/local/__tests__/llm-endpoints.test.mts
 */
import assert from 'node:assert/strict'

import { isOpenCodeGo, providerHeaders } from '../llm-endpoints.ts'

assert.equal(isOpenCodeGo('https://opencode.ai/inference/go/openai/v1'), true)
assert.equal(isOpenCodeGo('  https://opencode.ai/inference/go/openai/v1  '), true)
// Zen shares the host but not the requirement.
assert.equal(isOpenCodeGo('https://opencode.ai/inference/openai/v1'), false)
assert.equal(isOpenCodeGo('https://api.deepseek.com/v1'), false)
assert.equal(isOpenCodeGo(''), false)

const goHeaders = providerHeaders('https://opencode.ai/inference/go/openai/v1', 'sess-123')
assert.equal(goHeaders['x-opencode-session'], 'sess-123')
assert.match(goHeaders['User-Agent'], /Trovia/)
// Zen adds nothing: an unknown header there is noise at best.
assert.deepEqual(providerHeaders('https://opencode.ai/inference/openai/v1', 'sess-123'), {})
assert.deepEqual(providerHeaders('https://api.openai.com/v1', 'sess-123'), {})

console.log('OpenCode Go：session 头与标识 UA 判定通过 ✓')
