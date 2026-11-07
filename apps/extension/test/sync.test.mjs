/**
 * Cross-check tests for the record format.
 *
 * The expected values come from the actual output of apps/mobile/src/local/util.ts on the phone —
 * the normalized links must be byte-identical, or the extension's record and the phone's become two in the cloud.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildRecord, docId, normalizeUrl } from '../src/record.js'

const CASES = [
  // [input, what normalizeUrl returns on the phone]
  ['https://Example.COM/Post/123/?utm_source=x&id=7#top', 'https://example.com/Post/123?id=7'],
  ['sspai.com/post/73145', 'https://sspai.com/post/73145'],
  ['http://localhost:3000/a/', 'http://localhost:3000/a'],
  // The phone doesn't strip isappinstalled, so we keep it too — what matters is that both sides agree, not which is cleaner.
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
  // Content is left empty; the phone uses that to mark it as needing cleanup
  assert.equal(record.payload.content_markdown, null)
  assert.equal(record.payload.metadata.saved_by, 'extension')
})

test('没有标题时退回域名', () => {
  const record = buildRecord({ url: 'https://www.simonwillison.net/2026/Nov/6/' })
  assert.equal(record.payload.title, 'simonwillison.net')
})
