/**
 * Streaming: the frames arrive out of order, split in the middle, or carry only
 * half a tool call. These cases are what the parser exists for.
 *
 * How to run: npx tsx src/local/__tests__/sse.test.mts
 */
import assert from 'node:assert/strict'

import { applyOpenAiChunk, emptyStreamState, splitSseBuffer } from '../sse.ts'

// A chunk that ends mid-line must keep its tail for the next read.
const partial = splitSseBuffer('data: {"a":1}\n\ndata: {"b":')
assert.deepEqual(partial.payloads, ['{"a":1}'], '空的 data: 不当作载荷')
assert.equal(partial.rest, 'data: {"b":')

// CRLF from a Windows-side gateway.
assert.deepEqual(splitSseBuffer('data: x\r\ndata: y\r\n').payloads, ['x', 'y'])

// Comments and blank lines are not payloads.
assert.deepEqual(splitSseBuffer(': ping\ndata: z\n').payloads, ['z'])

// Text deltas accumulate.
const state = emptyStreamState()
assert.equal(applyOpenAiChunk(state, JSON.stringify({ choices: [{ delta: { content: '你' } }] })), '你')
assert.equal(applyOpenAiChunk(state, JSON.stringify({ choices: [{ delta: { content: '好' } }] })), '好')
assert.equal(state.content, '你好')

// Metadata-only chunks add nothing and must not throw.
assert.equal(applyOpenAiChunk(state, JSON.stringify({ choices: [{ delta: {} }] })), '')
assert.equal(applyOpenAiChunk(state, JSON.stringify({ choices: [] })), '')
assert.equal(applyOpenAiChunk(state, '[DONE]'), '')
assert.equal(applyOpenAiChunk(state, 'not json'), '')

// Tool calls arrive in pieces: name once, arguments over several chunks.
const tools = emptyStreamState()
const chunk = (delta: unknown) => JSON.stringify({ choices: [{ delta }] })
applyOpenAiChunk(tools, chunk({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search_library' } }] }))
applyOpenAiChunk(tools, chunk({ tool_calls: [{ index: 0, function: { arguments: '{"qu' } }] }))
applyOpenAiChunk(tools, chunk({ tool_calls: [{ index: 0, function: { arguments: 'ery":"x"}' } }] }))
assert.equal(tools.toolCalls.length, 1)
assert.equal(tools.toolCalls[0].id, 'call_1')
assert.equal(tools.toolCalls[0].name, 'search_library')
assert.equal(tools.toolCalls[0].args, '{"query":"x"}')

// Two calls in one response stay separate.
const two = emptyStreamState()
applyOpenAiChunk(two, chunk({ tool_calls: [
  { index: 0, id: 'a', function: { name: 'f' } },
  { index: 1, id: 'b', function: { name: 'g' } },
] }))
assert.deepEqual(two.toolCalls.map((call) => call.id), ['a', 'b'])

console.log('流式输出：分帧、增量、工具调用拼接 全部通过 ✓')
