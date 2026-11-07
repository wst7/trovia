/**
 * Tools the LLM can use: all of them run on the local database, with no network and no sending data out.
 *
 * Each tool only answers "what is in your saved items" and offers no write operations —
 * letting the model modify data is a different matter, and when that goes wrong it is no longer "answered wrong" but "deleted".
 */
import type { ChatTool } from './llm'
import { parseToolArguments } from './tool-args'
import { getDb } from './db'

export { parseToolArguments }

export interface ToolRunResult {
  /** Text handed to the model (JSON or plain text), which goes into the context. */
  content: string
  /** Article ids touched by this call, used to render citations in the UI. */
  ids: string[]
}

interface SearchRow {
  id: string
  title: string | null
  site_name: string | null
  saved_at: string
  summary_short: string | null
  search_text: string | null
  parse_status: string
}

function snippet(text: string | null, keyword: string): string {
  if (!text) return ''
  const index = keyword ? text.toLowerCase().indexOf(keyword.toLowerCase()) : -1
  const start = index > 40 ? index - 40 : 0
  return text.slice(start, start + 180).replace(/\s+/g, ' ').trim()
}

async function searchLibrary(args: Record<string, unknown>): Promise<ToolRunResult> {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 20)
  if (!query) return { content: '{"error":"query 不能为空"}', ids: [] }

  const db = await getDb()
  const like = `%${query}%`
  const rows = await db.getAllAsync<SearchRow>(
    `SELECT id, title, site_name, saved_at, summary_short, search_text, parse_status
     FROM documents
     WHERE deleted_at IS NULL
       AND (title LIKE ? OR summary_short LIKE ? OR search_text LIKE ?)
     ORDER BY saved_at DESC
     LIMIT ?`,
    like,
    like,
    like,
    limit,
  )
  if (rows.length === 0) return { content: `[]（没有匹配「${query}」的收藏）`, ids: [] }

  const items = rows.map((row) => ({
    id: row.id,
    title: row.title,
    site: row.site_name,
    saved_at: row.saved_at.slice(0, 10),
    status: row.parse_status,
    snippet: snippet(row.search_text ?? row.summary_short, query),
  }))
  return { content: JSON.stringify(items), ids: rows.map((row) => row.id) }
}

async function readDocument(args: Record<string, unknown>): Promise<ToolRunResult> {
  const id = typeof args.id === 'string' ? args.id.trim() : ''
  const maxChars = Math.min(Math.max(Number(args.max_chars) || 4000, 500), 12000)
  if (!id) return { content: '{"error":"id 不能为空"}', ids: [] }

  const db = await getDb()
  const row = await db.getFirstAsync<{
    id: string
    title: string | null
    site_name: string | null
    url: string
    saved_at: string
    content_markdown: string | null
    plain_text: string | null
    summary_short: string | null
  }>(
    `SELECT id, title, site_name, url, saved_at, content_markdown, plain_text, summary_short
     FROM documents WHERE id = ? AND deleted_at IS NULL`,
    id,
  )
  if (!row) return { content: `{"error":"没有这个 id：${id}"}`, ids: [] }

  const body = (row.content_markdown ?? row.plain_text ?? '').replace(/\n{3,}/g, '\n\n')
  const truncated = body.length > maxChars
  return {
    content: JSON.stringify({
      id: row.id,
      title: row.title,
      site: row.site_name,
      url: row.url,
      saved_at: row.saved_at.slice(0, 10),
      summary: row.summary_short,
      truncated,
      text: body.slice(0, maxChars),
    }),
    ids: [row.id],
  }
}

async function listRecent(args: Record<string, unknown>): Promise<ToolRunResult> {
  const days = Math.min(Math.max(Number(args.days) || 7, 1), 365)
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 30)
  const since = new Date(Date.now() - days * 86400_000).toISOString()

  const db = await getDb()
  const rows = await db.getAllAsync<SearchRow>(
    `SELECT id, title, site_name, saved_at, summary_short, search_text, parse_status
     FROM documents WHERE deleted_at IS NULL AND saved_at >= ?
     ORDER BY saved_at DESC LIMIT ?`,
    since,
    limit,
  )
  const items = rows.map((row) => ({
    id: row.id,
    title: row.title,
    site: row.site_name,
    saved_at: row.saved_at.slice(0, 10),
    snippet: snippet(row.summary_short ?? row.search_text, ''),
  }))
  return { content: JSON.stringify(items), ids: rows.map((row) => row.id) }
}

async function libraryStats(): Promise<ToolRunResult> {
  const db = await getDb()
  const total = await db.getFirstAsync<{ total: number }>(
    'SELECT COUNT(*) AS total FROM documents WHERE deleted_at IS NULL',
  )
  const sites = await db.getAllAsync<{ site_name: string; count: number }>(
    `SELECT COALESCE(site_name, '未知') AS site_name, COUNT(*) AS count
     FROM documents WHERE deleted_at IS NULL
     GROUP BY site_name ORDER BY count DESC LIMIT 8`,
  )
  const span = await db.getFirstAsync<{ first: string | null; last: string | null }>(
    'SELECT MIN(saved_at) AS first, MAX(saved_at) AS last FROM documents WHERE deleted_at IS NULL',
  )
  return {
    content: JSON.stringify({
      total: total?.total ?? 0,
      earliest: span?.first?.slice(0, 10) ?? null,
      latest: span?.last?.slice(0, 10) ?? null,
      top_sites: sites,
    }),
    ids: [],
  }
}

interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  run: (args: Record<string, unknown>) => Promise<ToolRunResult>
}

/** Tool list: short names, few parameters, so even a small model gets it right in one shot. */
export const ASSISTANT_TOOLS: ToolDefinition[] = [
  {
    name: 'search_library',
    description:
      '在用户本地收藏里按关键词检索标题、摘要与正文。返回命中的文章 id、标题、来源、收藏日期和片段。找不到就换关键词再试。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词，尽量短（人名、名词、标题里的词）' },
        limit: { type: 'integer', description: '返回条数，默认 8，最多 20' },
      },
      required: ['query'],
    },
    run: searchLibrary,
  },
  {
    name: 'read_document',
    description: '按 id 读一篇文章的正文（会被截断）。需要细节、原话、清单时用。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'search_library 返回的 id' },
        max_chars: { type: 'integer', description: '最多读多少字，默认 4000' },
      },
      required: ['id'],
    },
    run: readDocument,
  },
  {
    name: 'list_recent',
    description: '列出最近 N 天收藏的文章（按收藏时间倒序）。问「最近存了什么」时用。',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: '天数，默认 7' },
        limit: { type: 'integer', description: '条数，默认 10' },
      },
    },
    run: listRecent,
  },
  {
    name: 'library_stats',
    description: '整个库的规模：总数、最早与最近收藏日期、收藏最多的站点。',
    parameters: { type: 'object', properties: {} },
    run: libraryStats,
  },
]

export function toolSchemas(): ChatTool[] {
  return ASSISTANT_TOOLS.map((tool) => ({
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }))
}

export async function runTool(name: string, args: Record<string, unknown>): Promise<ToolRunResult> {
  const tool = ASSISTANT_TOOLS.find((item) => item.name === name)
  if (!tool) return { content: `{"error":"没有这个工具：${name}"}`, ids: [] }
  try {
    return await tool.run(args)
  } catch (error) {
    return { content: `{"error":"工具执行失败：${String(error).slice(0, 120)}"}`, ids: [] }
  }
}
