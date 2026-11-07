/**
 * Restoring Trovia's own backup: it must not be treated as a plain "link list".
 *
 * How to run: npx tsx apps/mobile/src/local/__tests__/import-trovia-backup.test.mts
 */
import assert from 'node:assert/strict'

import { detectFormat, parseImport } from '../import/parse.ts'

const bundle = {
  version: 1,
  exported_at: '2026-11-02T08:18:00.000Z',
  count: 2,
  documents: [
    {
      id: 'doc-1',
      url: 'https://blog.example.com/posts/sleep',
      title: '关于睡眠的一篇长文',
      site_name: 'Example Blog',
      author: '某人',
      published_at: '2025-03-02T00:00:00.000Z',
      saved_at: '2026-10-30T09:00:00.000Z',
      summary_short: '睡眠与记忆的关系。',
      summary_long: '睡眠与记忆的关系，以及为什么补觉没有用。',
      keywords: ['睡眠', '记忆'],
      content_markdown: '# 关于睡眠\n\n正文第一段。',
      plain_text: '关于睡眠 正文第一段。',
      images: ['https://img.example.com/a.jpg'],
      source_type: 'web',
    },
    {
      id: 'doc-2',
      url: 'https://example.com/no-body',
      title: '只有标题的一条',
      saved_at: '2026-10-31T09:00:00.000Z',
      keywords: [],
      images: [],
    },
  ],
}

const content = JSON.stringify(bundle)

// 1. It is recognised as its own backup, not as a "link list"
assert.equal(detectFormat(content), 'trovia-json', '备份文件必须识别成 trovia-json')

const parsed = parseImport(content)
assert.equal(parsed.format, 'trovia-json')
assert.equal(parsed.items.length, 2)
assert.equal(parsed.documents?.length, 2, '要带出可恢复的正文')

// 2. Body, summary, keywords and time must all survive
const withBody = parsed.documents![0]
assert.equal(withBody.title, '关于睡眠的一篇长文')
assert.equal(withBody.contentMarkdown, '# 关于睡眠\n\n正文第一段。')
assert.equal(withBody.summaryLong, '睡眠与记忆的关系，以及为什么补觉没有用。')
assert.deepEqual(withBody.keywords, ['睡眠', '记忆'])
assert.equal(new Date(withBody.savedAt!).toISOString(), '2026-10-30T09:00:00.000Z')

// 3. The entry without a body is restored too, it is only handed to the queue for a refetch
const noBody = parsed.documents![1]
assert.equal(noBody.contentMarkdown, null)
assert.equal(noBody.plainText, null)

// 4. Invalid links are skipped with a stated reason and do not vanish silently
const mixed = parseImport(
  JSON.stringify({
    version: 1,
    documents: [
      { url: 'javascript:void(0)', title: '书签脚本' },
      { url: 'https://example.com/ok', title: '正常' },
    ],
  }),
)
assert.equal(mixed.format, 'trovia-json')
assert.equal(mixed.items.length, 1, 'javascript: 不该被当成可收藏链接')
assert.equal(mixed.skipped.length, 1)
assert.match(mixed.skipped[0].reason, /网页链接/)

// 5. A broken file produces a readable reason instead of throwing
const broken = parseImport('{"documents": [')
assert.equal(broken.format, 'trovia-json')
assert.equal(broken.items.length, 0)
assert.match(broken.skipped[0].reason, /JSON/)

console.log('Trovia 备份恢复：12 项断言通过')
