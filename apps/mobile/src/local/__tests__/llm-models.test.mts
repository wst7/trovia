/**
 * Model list loading: endpoint building and payload parsing.
 *
 * How to run: npx tsx src/local/__tests__/llm-models.test.mts
 */
import assert from 'node:assert/strict'

import { isChatModel, modelsEndpoint, parseModelList } from '../llm-models.ts'

// Endpoint building
assert.equal(modelsEndpoint('https://api.deepseek.com/v1'), 'https://api.deepseek.com/v1/models')
assert.equal(modelsEndpoint('https://api.deepseek.com/v1/'), 'https://api.deepseek.com/v1/models')
assert.equal(modelsEndpoint('  https://api.openai.com/v1  '), 'https://api.openai.com/v1/models')
// A chat endpoint pasted by mistake still resolves to the models list.
assert.equal(
  modelsEndpoint('https://api.deepseek.com/v1/chat/completions'),
  'https://api.deepseek.com/v1/models',
)
// Not an address yet: nothing to ask.
assert.equal(modelsEndpoint('api.deepseek.com'), null)
assert.equal(modelsEndpoint(''), null)

// Parsing
assert.deepEqual(
  parseModelList({ data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'a-model' }] }),
  ['a-model', 'b-model'],
  '去重并排序',
)
assert.deepEqual(parseModelList({ data: [] }), [])
assert.deepEqual(parseModelList({}), [])
assert.deepEqual(parseModelList(null), [])
assert.deepEqual(parseModelList({ data: [{ id: 42 }, { id: '   ' }, { nope: 1 }] }), [], '非字符串 id 忽略')

// Which entries are worth showing
assert.equal(isChatModel('deepseek-chat'), true)
assert.equal(isChatModel('text-embedding-3-small'), false)
assert.equal(isChatModel('whisper-1'), false)
assert.equal(isChatModel('dall-e-3'), false)
assert.equal(isChatModel('bge-reranker-v2'), false)

console.log('模型列表：端点构造、解析与过滤全部通过 ✓')
