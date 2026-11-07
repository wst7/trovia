/**
 * Regression tests for the export format: the export must contain "the user's own things",
 * and it must be readable by other tools (one JSON, one Markdown).
 *
 * How to run: npx tsx apps/mobile/src/local/__tests__/export.test.mts
 */
import assert from 'node:assert/strict'
import { buildExportMarkdown } from '../exporter.ts'
import type { DocumentDetail } from '../../../../../packages/shared/src/index.ts'

function doc(overrides: Partial<DocumentDetail>): DocumentDetail {
  return {
    id: 'doc-1',
    url: 'https://example.com/a',
    canonical_url: 'https://example.com/a',
    title: '为什么睡前刷手机更焦虑',
    site_name: 'example.com',
    source_type: 'web',
    author: '某人',
    published_at: '2026-10-30',
    description: null,
    summary_short: '睡前蓝光与情绪的关系。',
    summary_long: null,
    keywords: ['睡眠', '焦虑'],
    topics: [],
    language: 'zh',
    content_markdown: '# 小标题\n\n正文第一段。',
    plain_text: '正文第一段。',
    images: ['https://example.com/1.png'],
    image_files: ['/data/images/doc-1/00-abc.img'],
    metadata: {},
    parse_status: 'completed',
    parse_error_code: null,
    parse_stage: null,
    saved_at: '2026-11-01T09:00:00.000Z',
    updated_at: '2026-11-01T09:00:00.000Z',
    last_parsed_at: '2026-11-01T09:00:00.000Z',
    ...overrides,
  } as DocumentDetail
}

const md = buildExportMarkdown([doc({})], '2026-11-01T12:00:00.000Z')

assert.ok(md.startsWith('# Trovia 导出'), '导出文件要有明确标题')
assert.ok(md.includes('共 1 条'))
assert.ok(md.includes('## 为什么睡前刷手机更焦虑'), '每篇要有标题')
assert.ok(md.includes('链接：https://example.com/a'), '要能追溯原文')
assert.ok(md.includes('发表于：2026-10-30'), '发表时间要带上')
assert.ok(md.includes('关键词：睡眠、焦虑'))
assert.ok(md.includes('正文第一段。'), '正文要完整导出')

// A missing body must not silently stay blank either
const empty = buildExportMarkdown([doc({ content_markdown: null, plain_text: null })], '2026-11-01T12:00:00.000Z')
assert.ok(empty.includes('（没有保存到正文）'), '缺正文要有明确说明')

// Separate articles with a rule so a human can read it
const two = buildExportMarkdown([doc({ id: 'a' }), doc({ id: 'b', title: '第二篇' })], '2026-11-01T12:00:00.000Z')
assert.equal(two.split('\n\n---\n\n').length, 3, '两篇之间要有一条分隔线')

console.log('✓ 导出包含标题、链接、时间、关键词与正文；空正文有说明；多篇有分隔')
