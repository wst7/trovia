/**
 * 「导出 → 导入，数据不能变」的回归测试。
 *
 * 三件事必须成立：
 *   1. 写出去的是 zip，体积明显小于原 JSON；
 *   2. 读回来之后，每一篇的每个字段都和导出时一致（包括 id、canonical_url、
 *      两个时间戳、rev、metadata、topics、image_files）；
 *   3. 过渡期的 .json.gz 和老版本的纯 .json 仍然读得进来。
 *
 * 跑法：npx tsx apps/mobile/src/local/__tests__/export-roundtrip.test.mts
 */
import assert from 'node:assert/strict'
import { gzipSync, strToU8 } from 'fflate'

import { bytesToBase64, decodeBackupBase64, encodeBackup } from '../export-codec.ts'
import type { ExportDocument } from '../repo.ts'
import { parseImport } from '../import/parse.ts'

function doc(overrides: Partial<ExportDocument> = {}): ExportDocument {
  return {
    id: 'doc-1',
    url: 'https://mp.weixin.qq.com/s/DEMO-1',
    canonical_url: 'https://mp.weixin.qq.com/s/DEMO-1',
    title: '画风 skill: 19 套手绘画风，一句话调用',
    site_name: 'mp.weixin.qq.com',
    source_type: 'web',
    author: '璟礼',
    published_at: '2026-10-28',
    description: null,
    summary_short: '一个手绘画风的提示词配方。',
    summary_long: null,
    keywords: ['画风', '提示词'],
    topics: ['AI'],
    language: 'zh',
    content_markdown: '# 一句「手绘风」\n\n模型接不住。',
    plain_text: '一句「手绘风」，模型接不住。',
    images: ['https://mmbiz.qpic.cn/a.png'],
    image_files: ['/data/images/doc-1/00-a.img'],
    metadata: { origin_kind: 'share', reading_time: 6 },
    parse_status: 'completed',
    parse_error_code: null,
    parse_stage: null,
    last_parsed_at: '2026-11-01T09:03:11.000Z',
    saved_at: '2026-11-01T09:00:00.000Z',
    updated_at: '2026-11-01T09:03:11.000Z',
    rev: 4,
    ...overrides,
  }
}

const docs: ExportDocument[] = [
  doc(),
  doc({ id: 'doc-2', url: 'https://sspai.com/post/73145', canonical_url: 'https://sspai.com/post/73145', title: '少数派早报', rev: 1 }),
  // 边界：没有正文、状态是失败、没有关键词与图片
  doc({
    id: 'doc-3',
    url: 'http://example.com/legacy',
    canonical_url: 'http://example.com/legacy',
    title: null,
    content_markdown: null,
    plain_text: null,
    keywords: [],
    images: [],
    image_files: [],
    metadata: {},
    parse_status: 'failed',
    parse_error_code: 'FETCH_BLOCKED',
    saved_at: '2026-10-02T03:04:05.000Z',
    updated_at: '2026-10-02T03:04:05.000Z',
    rev: 1,
  }),
]

const bundle = { version: 2, exported_at: '2026-11-06T00:00:00.000Z', count: docs.length, documents: docs }
const json = JSON.stringify(bundle)
const markdown = docs.map((d) => `## ${d.title ?? d.url}`).join('\n\n')

// 1. 写出去：zip，且明显更小
const encoded = encodeBackup(json, markdown)
assert.ok(encoded.zipBytes < encoded.rawBytes, '压缩后必须更小')
const ratio = encoded.zipBytes / encoded.rawBytes
console.log(`体积：${encoded.rawBytes} B → ${encoded.zipBytes} B（${(ratio * 100).toFixed(1)}%）`)
assert.ok(ratio < 0.6, `压缩率异常：${ratio}`)

// 2. 导回来：字段逐个对齐
const decoded = decodeBackupBase64(encoded.base64)
assert.equal(decoded.kind, 'zip')
assert.equal(decoded.text, json, 'JSON 文本必须逐字节一致')

const parsed = parseImport(decoded.text)
assert.equal(parsed.format, 'trovia-json')
assert.equal(parsed.documents?.length, docs.length, '条数必须一致')

const restored = new Map(parsed.documents!.map((item) => [item.id, item]))
for (const original of docs) {
  const got = restored.get(original.id) as (typeof parsed.documents)[number]
  assert.ok(got, `${original.id} 丢了`)
  assert.equal(got.url, original.url, `${original.id}.url`)
  assert.equal(got.canonicalUrl, original.canonical_url, `${original.id}.canonical_url`)
  assert.equal(got.title, original.title, `${original.id}.title`)
  assert.equal(got.siteName, original.site_name, `${original.id}.site_name`)
  assert.equal(got.author, original.author, `${original.id}.author`)
  assert.equal(got.publishedAt, original.published_at, `${original.id}.published_at`)
  assert.equal(got.description, original.description, `${original.id}.description`)
  assert.equal(got.summaryShort, original.summary_short, `${original.id}.summary_short`)
  assert.equal(got.summaryLong, original.summary_long, `${original.id}.summary_long`)
  assert.deepEqual(got.keywords, original.keywords, `${original.id}.keywords`)
  assert.deepEqual(got.topics, original.topics, `${original.id}.topics`)
  assert.equal(got.language, original.language, `${original.id}.language`)
  assert.equal(got.contentMarkdown, original.content_markdown, `${original.id}.content_markdown`)
  assert.equal(got.plainText, original.plain_text, `${original.id}.plain_text`)
  assert.deepEqual(got.images, original.images, `${original.id}.images`)
  assert.deepEqual(got.imageFiles, original.image_files, `${original.id}.image_files`)
  assert.equal(got.sourceType, original.source_type, `${original.id}.source_type`)
  assert.equal(got.parseStatus, original.parse_status, `${original.id}.parse_status`)
  assert.equal(got.parseStage, original.parse_stage, `${original.id}.parse_stage`)
  assert.equal(got.parseErrorCode, original.parse_error_code, `${original.id}.parse_error_code`)
  assert.equal(got.savedAt, Date.parse(original.saved_at), `${original.id}.saved_at`)
  assert.equal(got.updatedAt, original.updated_at, `${original.id}.updated_at`)
  assert.equal(got.rev, original.rev, `${original.id}.rev`)
  assert.deepEqual(got.metadata, original.metadata, `${original.id}.metadata`)
  // 判重键只用于跳过重复，不影响落库的值
  assert.ok(got.dedupeKey.startsWith('https://'), `${original.id}.dedupeKey`)
}

// 3. 过渡期格式：.json.gz 与纯 .json 都要能读
const gz = decodeBackupBase64(bytesToBase64(gzipSync(strToU8(json))))
assert.equal(gz.kind, 'gzip')
assert.equal(gz.text, json)

const plain = decodeBackupBase64(bytesToBase64(strToU8(json)))
assert.equal(plain.kind, 'plain')
assert.equal(plain.text, json)

// 4. 老备份（v1，没有 updated_at / rev）照样能读
const legacyDocs = docs.map(({ updated_at, rev, ...rest }) => rest)
const legacy = parseImport(JSON.stringify({ version: 1, exported_at: '2026-01-01T00:00:00.000Z', documents: legacyDocs }))
assert.equal(legacy.format, 'trovia-json')
assert.equal(legacy.documents?.length, docs.length)
assert.equal(legacy.documents?.[0].updatedAt, null)
assert.equal(legacy.documents?.[0].rev, null)

console.log('导出 → 导入：字段全部一致 ✓')
