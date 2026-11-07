/**
 * Tests for the pure logic of semantic search: request shape, return order, similarity ranking, thresholds.
 * Uses a local mock /v1/embeddings server over real HTTP and never touches SQLite.
 *
 * How to run: npx tsx apps/mobile/src/local/__tests__/embed.test.mts
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  SEMANTIC_MIN_SCORE,
  cosine,
  embedTexts,
  embeddingEndpoint,
  embeddingInputOf,
  rankBySimilarity,
} from '../embed-core.ts'

// ---- endpoint joining ----
assert.equal(embeddingEndpoint('https://api.openai.com/v1'), 'https://api.openai.com/v1/embeddings')
assert.equal(embeddingEndpoint('https://api.openai.com/v1/'), 'https://api.openai.com/v1/embeddings')
assert.equal(embeddingEndpoint('http://127.0.0.1:11434/v1/embeddings'), 'http://127.0.0.1:11434/v1/embeddings')
console.log('✓ 端点拼接对 /v1 与已带 /embeddings 两种写法都正确')

// ---- similarity ----
assert.equal(cosine(Float32Array.from([1, 0]), Float32Array.from([1, 0])), 1)
assert.equal(cosine(Float32Array.from([1, 0]), Float32Array.from([0, 1])), 0)
assert.equal(cosine(Float32Array.from([0, 0]), Float32Array.from([1, 1])), 0, '零向量不能除零')
console.log('✓ 余弦相似度正确，零向量返回 0')

// ---- ranking and thresholds ----
const vectors = [
  { id: 'close', vec: Float32Array.from([1, 0.1]) },
  { id: 'far', vec: Float32Array.from([0, 1]) },
  { id: 'mid', vec: Float32Array.from([0.8, 0.6]) },
]
const query = Float32Array.from([1, 0])
const ranked = rankBySimilarity(vectors, query, { limit: 5 })
assert.equal(ranked[0].id, 'close')
assert.ok(ranked.every((row) => row.score >= SEMANTIC_MIN_SCORE), '低于绝对下限的不该出现')
assert.ok(!ranked.some((row) => row.id === 'far'), '离最高分太远的会被相对差距挡掉')
assert.equal(rankBySimilarity(vectors, query, { exclude: new Set(['close']) })[0].id, 'mid')
assert.equal(rankBySimilarity(vectors, query, { limit: 1 }).length, 1)
console.log('✓ 排序、阈值、排除已展示结果都正确')

// ---- the text handed to the model ----
const input = embeddingInputOf({
  title: '为什么睡前刷手机更焦虑',
  summary: '睡前蓝光与情绪的关系。',
  keywords: ['睡眠', '焦虑'],
  plainText: '正文'.repeat(1000),
})
assert.ok(input.startsWith('为什么睡前刷手机更焦虑'))
assert.ok(input.length <= 2000, '输入要有上限，别把整篇文章塞进去')
console.log('✓ 向量输入包含标题/摘要/关键词，且限制长度')

// ---- real HTTP round trip: verify the request body and out-of-order responses ----
function startMock(): Promise<{ port: number; close: () => void; bodies: string[] }> {
  const bodies: string[] = []
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      bodies.push(raw)
      if (req.headers.authorization !== 'Bearer test-key') {
        res.writeHead(401).end('{"error":"unauthorized"}')
        return
      }
      const payload = JSON.parse(raw) as { input: string[] }
      // Deliberately shuffle the order to verify results are filled back in by index
      const data = payload.input.map((text, index) => ({
        index,
        embedding: [text.length, index + 1, 0.5],
      }))
      data.reverse()
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ port, close: () => server.close(), bodies })
    })
  })
}

const mock = await startMock()
try {
  const config = { baseUrl: `http://127.0.0.1:${mock.port}/v1`, model: 'text-embedding-3-small', key: 'test-key' }
  const vectorsOut = await embedTexts(['一二三', '四五'], config)
  assert.equal(vectorsOut.length, 2)
  assert.equal(vectorsOut[0][0], 3, '第一条应是「一二三」的长度（顺序被打乱也要回填正确）')
  assert.equal(vectorsOut[1][0], 2)

  const body = JSON.parse(mock.bodies[0]) as { model: string; input: string[] }
  assert.equal(body.model, 'text-embedding-3-small')
  assert.deepEqual(body.input, ['一二三', '四五'])
  console.log('✓ 真实 HTTP：请求体正确，返回顺序打乱也能按 index 回填')

  await assert.rejects(
    () => embedTexts(['x'], { ...config, key: 'wrong' }),
    /embeddings 401/,
    '鉴权失败要抛出，由上层降级',
  )
  console.log('✓ 鉴权失败抛出可识别的错误')
} finally {
  mock.close()
}

console.log('\n全部通过：语义检索的请求、排序、阈值与容错')
