/**
 * 记录格式的对照测试。
 *
 * 期望值来自手机端 apps/mobile/src/local/util.ts 的实际输出——两边算出来的
 * 规范化链接必须逐字节相同，否则插件存的和手机存的会在云端变成两条。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildRecord, docId, normalizeUrl } from '../src/record.js'

const CASES = [
  // [输入, 手机端 normalizeUrl 的结果]
  ['https://Example.COM/Post/123/?utm_source=x&id=7#top', 'https://example.com/Post/123?id=7'],
  ['sspai.com/post/73145', 'https://sspai.com/post/73145'],
  ['http://localhost:3000/a/', 'http://localhost:3000/a'],
  // 手机端不清 isappinstalled，这里也跟着保留——判重要的是两边一致，不是谁更干净。
  ['https://mp.weixin.qq.com/s/abc?from=timeline&isappinstalled=0', 'https://mp.weixin.qq.com/s/abc?isappinstalled=0'],
  ['nonsense', null],
  ['', null],
]

test('规范化链接与手机端一致', () => {
  for (const [input, expected] of CASES) {
    assert.equal(normalizeUrl(input), expected, input)
  }
})

test('同一个链接的 id 稳定，不同链接的 id 不同', () => {
  const a = docId('https://example.com/post/123?utm_source=x')
  const b = docId('https://example.com/post/123/')
  assert.equal(a, b)
  assert.notEqual(a, docId('https://example.com/post/124'))
  assert.match(a, /^w[0-9a-f]{8}$/)
})

test('记录形状符合 SyncRecord', () => {
  const record = buildRecord({ url: 'https://sspai.com/post/73145', title: '一个标题' })
  assert.deepEqual(Object.keys(record).sort(), ['deleted_at', 'id', 'payload', 'rev', 'updated_at'])
  assert.equal(record.deleted_at, null)
  assert.equal(record.rev, 1)
  assert.equal(record.payload.title, '一个标题')
  assert.equal(record.payload.canonical_url, 'https://sspai.com/post/73145')
  // 正文留空，手机端据此标成待整理
  assert.equal(record.payload.content_markdown, null)
  assert.equal(record.payload.metadata.saved_by, 'extension')
})

test('没有标题时退回域名', () => {
  const record = buildRecord({ url: 'https://www.simonwillison.net/2026/Nov/6/' })
  assert.equal(record.payload.title, 'simonwillison.net')
})
