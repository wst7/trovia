import type {
  DocumentDetail,
  DocumentSummary,
  ParseStage,
  ParseStatus,
  RelatedItem,
  SearchResult,
  SourceType,
} from '@xunji/shared'

import type { ExtractedArticle } from './article'
import { getDb } from './db'
import type { Completer } from './intent'
import { resolveIntent } from './intent'
import { chat, loadLlmKey, loadLlmState } from './llm'
import { matchRange, timeOf } from './query'
import type { DateRange } from './query'
import { newId, normalizeUrl, nowIso, oneLine, parseJsonArray, parseJsonObject, sourceTypeOf } from './util'

interface DocumentRow {
  id: string
  url: string
  canonical_url: string
  title: string | null
  site_name: string | null
  source_type: string
  author: string | null
  published_at: string | null
  description: string | null
  summary_short: string | null
  summary_long: string | null
  keywords: string
  topics: string
  language: string | null
  content_markdown: string | null
  plain_text: string | null
  images: string | null
  search_text: string
  parse_status: string
  parse_stage: string | null
  parse_error_code: string | null
  saved_at: string
  last_parsed_at: string | null
  updated_at: string
  deleted_at: string | null
  metadata: string
}

function toSummary(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    source_type: row.source_type as SourceType,
    site_name: row.site_name,
    summary_short: row.summary_short,
    parse_status: row.parse_status as ParseStatus,
    parse_error_code: row.parse_error_code,
    saved_at: row.saved_at,
  }
}

function toDetail(row: DocumentRow): DocumentDetail {
  return {
    ...toSummary(row),
    canonical_url: row.canonical_url,
    author: row.author,
    published_at: row.published_at,
    description: row.description,
    summary_long: row.summary_long,
    keywords: parseJsonArray(row.keywords),
    topics: parseJsonArray(row.topics),
    language: row.language,
    content_markdown: row.content_markdown,
    plain_text: row.plain_text,
    images: parseJsonArray(row.images ?? '[]'),
    metadata: parseJsonObject(row.metadata),
    last_parsed_at: row.last_parsed_at,
    parse_stage: row.parse_stage as ParseStage | null,
  }
}

/**
 * 保存一条链接；同一条链接（规范化后）已存在时返回已有条目。
 * titleHint 来自分享文字或剪贴板：抓不到正文时至少保留用户当时看到的标题。
 */
export async function createDocument(
  rawUrl: string,
  titleHint?: string | null,
): Promise<{ id: string; duplicate: boolean }> {
  const url = normalizeUrl(rawUrl)
  if (!url) throw new Error('INVALID_URL')
  const db = await getDb()
  const hint = titleHint ? oneLine(titleHint, 160) : null

  const existing = await db.getFirstAsync<{ id: string; title: string | null }>(
    'SELECT id, title FROM documents WHERE url = ? AND deleted_at IS NULL LIMIT 1',
    url,
  )
  if (existing) {
    if (hint && !existing.title) {
      await db.runAsync(
        'UPDATE documents SET title = ?, updated_at = ? WHERE id = ?',
        hint,
        nowIso(),
        existing.id,
      )
    }
    return { id: existing.id, duplicate: true }
  }

  const id = newId()
  const now = nowIso()
  await db.runAsync(
    `INSERT INTO documents (id, url, canonical_url, source_type, title, parse_status, parse_stage, saved_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 'fetch', ?, ?)`,
    id,
    url,
    url,
    sourceTypeOf(url),
    hint,
    now,
    now,
  )
  return { id, duplicate: false }
}

/** 剪贴板提示用：这条链接是否已经在收藏里（规范化后比较）。 */
export async function hasDocument(rawUrl: string): Promise<boolean> {
  const url = normalizeUrl(rawUrl)
  if (!url) return false
  const db = await getDb()
  const row = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM documents WHERE url = ? AND deleted_at IS NULL LIMIT 1',
    url,
  )
  return row !== null
}

/** 抓取失败或没有标题时，沿用保存时的标题种子。 */
export async function getSeededTitle(id: string): Promise<string | null> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ title: string | null }>(
    'SELECT title FROM documents WHERE id = ? AND deleted_at IS NULL',
    id,
  )
  return row?.title ?? null
}

export async function listDocuments(options: {
  page: number
  pageSize: number
  keyword?: string
}): Promise<{ items: DocumentSummary[]; total: number }> {
  const db = await getDb()
  const keyword = options.keyword?.trim() ?? ''
  const page = Math.max(1, options.page)
  const pageSize = Math.max(1, options.pageSize)
  const offset = (page - 1) * pageSize

  const where = keyword
    ? 'deleted_at IS NULL AND (title LIKE ? OR summary_short LIKE ? OR search_text LIKE ?)'
    : 'deleted_at IS NULL'
  const params: (string | number)[] = keyword ? [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`] : []

  const totalRow = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM documents WHERE ${where}`,
    ...params,
  )
  const rows = await db.getAllAsync<DocumentRow>(
    `SELECT * FROM documents WHERE ${where} ORDER BY saved_at DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    offset,
  )
  return { items: rows.map(toSummary), total: totalRow?.total ?? 0 }
}

export async function getDocument(id: string): Promise<DocumentDetail | null> {
  const db = await getDb()
  const row = await db.getFirstAsync<DocumentRow>(
    'SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL',
    id,
  )
  return row ? toDetail(row) : null
}

export async function getStatus(
  id: string,
): Promise<{ status: ParseStatus; stage: ParseStage | null; errorCode: string | null } | null> {
  const db = await getDb()
  const row = await db.getFirstAsync<{
    parse_status: string
    parse_stage: string | null
    parse_error_code: string | null
  }>('SELECT parse_status, parse_stage, parse_error_code FROM documents WHERE id = ? AND deleted_at IS NULL', id)
  if (!row) return null
  return {
    status: row.parse_status as ParseStatus,
    stage: row.parse_stage as ParseStage | null,
    errorCode: row.parse_error_code,
  }
}

export async function nextPending(): Promise<{ id: string; url: string } | null> {
  const db = await getDb()
  return db.getFirstAsync<{ id: string; url: string }>(
    "SELECT id, url FROM documents WHERE deleted_at IS NULL AND parse_status = 'pending' ORDER BY saved_at ASC LIMIT 1",
  )
}

export async function setStatus(
  id: string,
  status: ParseStatus,
  stage: ParseStage | null,
  errorCode: string | null = null,
): Promise<void> {
  const db = await getDb()
  await db.runAsync(
    'UPDATE documents SET parse_status = ?, parse_stage = ?, parse_error_code = ?, updated_at = ? WHERE id = ?',
    status,
    stage,
    errorCode,
    nowIso(),
    id,
  )
}

function searchTextOf(fields: {
  title: string | null
  siteName: string | null
  summary: string | null
  keywords: string[]
  plainText: string
}): string {
  return [
    fields.title ?? '',
    fields.siteName ?? '',
    fields.summary ?? '',
    fields.keywords.join(' '),
    fields.plainText.slice(0, 8000),
  ]
    .join('\n')
    .toLowerCase()
}

/** 抓取、摘要成功后的落库。 */
export async function saveParsed(
  id: string,
  article: ExtractedArticle,
  summary: string,
  summaryShort: string,
  keywords: string[],
): Promise<void> {
  const db = await getDb()
  const now = nowIso()
  await db.runAsync(
    `UPDATE documents SET
       title = ?, site_name = ?, author = ?, published_at = COALESCE(?, published_at), description = ?, language = ?,
       summary_short = ?, summary_long = ?, keywords = ?,
       content_markdown = ?, plain_text = ?, images = ?, search_text = ?,
       parse_status = 'completed', parse_stage = NULL, parse_error_code = NULL,
       last_parsed_at = ?, updated_at = ?
     WHERE id = ?`,
    article.title,
    article.siteName,
    article.author,
    article.publishedAt,
    article.description,
    article.language,
    summaryShort,
    summary,
    JSON.stringify(keywords),
    article.markdown,
    article.plainText,
    JSON.stringify(article.images),
    searchTextOf({
      title: article.title,
      siteName: article.siteName,
      summary,
      keywords,
      plainText: article.plainText,
    }),
    now,
    now,
    id,
  )
}

/** 只拿到元信息、正文不足时的部分成功。 */
export async function savePartial(id: string, article: ExtractedArticle): Promise<void> {
  const db = await getDb()
  const now = nowIso()
  const summary = article.description ?? null
  const errorCode = article.blocked
    ? 'FETCH_BLOCKED'
    : article.appOnly
      ? 'APP_ONLY_LINK'
      : article.scriptOnly
        ? 'CONTENT_SCRIPT_ONLY'
        : 'PARSE_INCOMPLETE'
  await db.runAsync(
    `UPDATE documents SET
       title = COALESCE(?, title), site_name = ?, author = ?, published_at = COALESCE(?, published_at),
       description = ?, language = ?,
       summary_short = ?, plain_text = ?, content_markdown = ?, images = ?, search_text = ?,
       parse_status = 'partial', parse_stage = NULL, parse_error_code = ?,
       last_parsed_at = ?, updated_at = ?
     WHERE id = ?`,
    article.title,
    article.siteName,
    article.author,
    article.publishedAt,
    article.description,
    article.language,
    summary,
    article.plainText,
    article.markdown,
    JSON.stringify(article.images),
    searchTextOf({
      title: article.title,
      siteName: article.siteName,
      summary,
      keywords: [],
      plainText: article.plainText,
    }),
    errorCode,
    now,
    now,
    id,
  )
}

export async function markFailed(id: string, errorCode: string): Promise<void> {
  const db = await getDb()
  const now = nowIso()
  await db.runAsync(
    `UPDATE documents SET parse_status = 'failed', parse_stage = NULL,
       parse_error_code = ?, last_parsed_at = ?, updated_at = ? WHERE id = ?`,
    errorCode,
    now,
    now,
    id,
  )
}

/** 重新解析：回到 pending，清掉上一轮的错误。 */
export async function markForRetry(id: string): Promise<void> {
  const db = await getDb()
  await db.runAsync(
    `UPDATE documents SET parse_status = 'pending', parse_stage = 'fetch',
       parse_error_code = NULL, updated_at = ? WHERE id = ?`,
    nowIso(),
    id,
  )
}

/**
 * 删除写墓碑而不是物理删除：本机不再显示，但保留更新与删除时间，
 * 以后接入多端同步时可以直接传播这次删除。
 */
export async function deleteDocument(id: string): Promise<void> {
  const db = await getDb()
  const now = nowIso()
  await db.runAsync(
    'UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ?',
    now,
    now,
    id,
  )
}

export async function countDocuments(): Promise<number> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ total: number }>(
    'SELECT COUNT(*) AS total FROM documents WHERE deleted_at IS NULL',
  )
  return row?.total ?? 0
}

export interface DocumentStats {
  total: number
  /** completed 与 partial 都写入了 search_text，可以被检索到。 */
  searchable: number
  processing: number
  failed: number
}

/** 设置页的深色统计面板只需要这四个数。 */
export async function documentStats(): Promise<DocumentStats> {
  const db = await getDb()
  const row = await db.getFirstAsync<{
    total: number
    searchable: number
    processing: number
    failed: number
  }>(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN parse_status IN ('completed', 'partial') THEN 1 ELSE 0 END) AS searchable,
       SUM(CASE WHEN parse_status IN ('pending', 'fetching', 'parsing', 'analyzing') THEN 1 ELSE 0 END) AS processing,
       SUM(CASE WHEN parse_status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM documents WHERE deleted_at IS NULL`,
  )
  return {
    total: row?.total ?? 0,
    searchable: row?.searchable ?? 0,
    processing: row?.processing ?? 0,
    failed: row?.failed ?? 0,
  }
}

// ---------------------------------------------------------------------------
// 本地检索
// ---------------------------------------------------------------------------

/** 叙述性的口头语，匹配前先去掉，避免「我记得那篇……」污染关键词。 */
const FILLER = /(我记得|记得|好像|大概|可能是|应该是|之前|以前|看过|看到过|收藏过|收藏了|帮我找|找一下|找找|那篇|这篇|一篇|一个|那个|这个|关于|讲的|说的|也就是|内容|文章|视频|链接)/g

export function queryTerms(query: string): string[] {
  const cleaned = query
    .toLowerCase()
    .replace(FILLER, ' ')
    .replace(/[，。！？、,.!?;；:："'“”‘’（）()[\]【】《》<>]/g, ' ')
  const terms = new Set<string>()

  for (const word of cleaned.match(/[a-z0-9][a-z0-9.+#_-]*/g) ?? []) {
    if (word.length >= 2) terms.add(word)
  }
  for (const run of cleaned.match(/[一-鿿]+/g) ?? []) {
    if (run.length <= 2) {
      terms.add(run)
    } else {
      // 中文没有分词：用二元组换取召回，长词额外保留整词以提高精度。
      for (let i = 0; i < run.length - 1; i += 1) terms.add(run.slice(i, i + 2))
      if (run.length <= 6) terms.add(run)
    }
  }
  return [...terms].slice(0, 24)
}

function excerptAround(text: string, terms: string[]): string | null {
  const lower = text.toLowerCase()
  let best: { index: number; term: string } | null = null
  for (const term of terms) {
    const index = lower.indexOf(term)
    if (index >= 0 && (!best || term.length > best.term.length)) best = { index, term }
  }
  if (!best) return null
  const start = Math.max(0, best.index - 40)
  const end = Math.min(text.length, best.index + best.term.length + 80)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return `${prefix}${oneLine(text.slice(start, end), 140)}${suffix}`
}

export interface SearchOutcome {
  results: SearchResult[]
  /** 人话解释，例如「昨天保存的」；没有时间条件时为 null。 */
  interpretation: string | null
}

/** 这一行命中的时间区间（按收藏时间或发表时间），没命中返回 null。 */
function dateHitOf(row: DocumentRow, ranges: DateRange[]): DateRange | null {
  if (ranges.length === 0) return null
  for (const range of ranges) {
    const at = range.field === 'published' ? timeOf(row.published_at) : timeOf(row.saved_at)
    const hit = matchRange(at, [range])
    if (hit) return hit
  }
  return null
}

function dateLabelOf(range: DateRange): string {
  return `${range.label}${range.field === 'published' ? '发表' : '保存'}的`
}

/** 用于排序的参考时间：有时间条件时用命中的那天，否则用收藏时间。 */
function sortTimeOf(row: DocumentRow, hit: DateRange | null): number {
  const field = hit?.field ?? 'saved'
  return timeOf(field === 'published' ? row.published_at : row.saved_at) ?? 0
}

/**
 * 配置了大模型（且开了「理解搜索意图」）时，把这句话交给模型翻译；
 * 没配、超时、报错都返回 null，搜索退回规则层，不会因此变慢或失败。
 */
async function intentCompleter(): Promise<Completer | null> {
  try {
    const state = await loadLlmState()
    if (!state.enabled || !state.intent) return null
    const key = await loadLlmKey()
    if (!key) return null
    return (messages, maxTokens) => chat(state, key, messages, maxTokens, 6_000)
  } catch {
    return null
  }
}

export async function searchDocuments(query: string, limit = 20): Promise<SearchOutcome> {
  const parsed = await resolveIntent(query, { complete: await intentCompleter() })
  const terms = queryTerms(parsed.text)
  // 「找找昨天的」没有关键词，也必须出结果——所以不能因为 terms 为空就直接返回。
  if (terms.length === 0 && parsed.ranges.length === 0) return { results: [], interpretation: null }

  const db = await getDb()
  const rows = await db.getAllAsync<DocumentRow>(
    'SELECT * FROM documents WHERE deleted_at IS NULL ORDER BY saved_at DESC LIMIT 2000',
  )

  const dateOnly = terms.length === 0
  const scored: { row: DocumentRow; score: number; reason: string; excerpt: string | null; at: number }[] = []

  for (const row of rows) {
    const hit = dateHitOf(row, parsed.ranges)
    if (parsed.ranges.length > 0 && !hit) continue
    const title = (row.title ?? '').toLowerCase()
    const keywordsText = parseJsonArray(row.keywords).join(' ').toLowerCase()
    const summary = (row.summary_long ?? row.summary_short ?? '').toLowerCase()
    const body = (row.plain_text ?? '').toLowerCase()
    const site = (row.site_name ?? '').toLowerCase()

    let score = 0
    const hitTitle: string[] = []
    const hitKeywords: string[] = []
    const hitSummary: string[] = []
    const hitBody: string[] = []
    const hitSite: string[] = []

    for (const term of terms) {
      if (title.includes(term)) {
        score += 10
        if (hitTitle.length < 3) hitTitle.push(term)
      }
      if (keywordsText.includes(term)) {
        score += 7
        if (hitKeywords.length < 3) hitKeywords.push(term)
      }
      if (summary.includes(term)) {
        score += 4
        if (hitSummary.length < 3) hitSummary.push(term)
      }
      if (body.includes(term)) {
        score += 2
        if (hitBody.length < 3) hitBody.push(term)
      }
      if (site.includes(term)) {
        score += 3
        if (hitSite.length < 2) hitSite.push(term)
      }
    }

    // 只有时间条件时，区间内的每条都算命中，靠时间排序。
    if (!dateOnly && score <= 0) continue

    const parts: string[] = []
    if (hit) parts.unshift(dateLabelOf(hit))
    if (hitTitle.length) parts.push(`标题命中「${hitTitle.join('」「')}」`)
    if (hitKeywords.length) parts.push(`关键词命中「${hitKeywords.join('」「')}」`)
    if (hitSummary.length) parts.push(`摘要命中「${hitSummary.join('」「')}」`)
    if (hitBody.length) parts.push(`正文命中「${hitBody.join('」「')}」`)
    if (hitSite.length) parts.push(`来源匹配「${hitSite.join('」「')}」`)

    scored.push({
      row,
      score: dateOnly ? 1 : score / (terms.length * 10),
      reason: parts.slice(0, 3).join('；'),
      excerpt: dateOnly ? null : excerptAround(row.plain_text ?? '', terms),
      at: sortTimeOf(row, hit),
    })
  }

  // 有时间条件时按那条时间倒序；否则相关度优先，同分再看时间。
  scored.sort((a, b) => (dateOnly ? b.at - a.at : b.score - a.score || b.at - a.at))

  const results = scored.slice(0, limit).map(({ row, score, reason, excerpt }) => ({
    document_id: row.id,
    title: row.title,
    url: row.url,
    source_type: row.source_type as SourceType,
    site_name: row.site_name,
    summary: row.summary_short ?? row.summary_long,
    score: Math.min(1, Math.round(score * 100) / 100),
    match_reason: reason,
    matched_excerpt: excerpt,
    saved_at: row.saved_at,
    parse_status: row.parse_status as ParseStatus,
  }))

  return { results, interpretation: parsed.summary }
}

function bigrams(text: string): Set<string> {
  const compact = text.toLowerCase().replace(/\s+/g, '')
  const grams = new Set<string>()
  for (let i = 0; i < compact.length - 1; i += 1) grams.add(compact.slice(i, i + 2))
  return grams
}

/** 相关收藏：共享关键词 + 标题相似度，完全是本地计算。 */
export async function relatedDocuments(id: string, limit = 5): Promise<RelatedItem[]> {
  const db = await getDb()
  const target = await db.getFirstAsync<DocumentRow>(
    'SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL',
    id,
  )
  if (!target) return []

  const others = await db.getAllAsync<DocumentRow>(
    'SELECT * FROM documents WHERE id != ? AND deleted_at IS NULL ORDER BY saved_at DESC LIMIT 300',
    id,
  )

  const targetKeywords = new Set(parseJsonArray(target.keywords).map((k) => k.toLowerCase()))
  const targetTitle = bigrams(target.title ?? '')

  const scored = others
    .map((row) => {
      const keywords = parseJsonArray(row.keywords).map((k) => k.toLowerCase())
      const shared = keywords.filter((k) => targetKeywords.has(k))
      const grams = bigrams(row.title ?? '')
      let overlap = 0
      for (const gram of grams) if (targetTitle.has(gram)) overlap += 1
      const titleScore = grams.size > 0 ? overlap / Math.max(grams.size, targetTitle.size) : 0
      const score = shared.length * 0.5 + titleScore
      return {
        row,
        score,
        relationType: shared.length > 0 ? 'keyword' : 'similar',
      }
    })
    .filter((item) => item.score > 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return scored.map(({ row, score, relationType }) => ({
    document_id: row.id,
    title: row.title,
    url: row.url,
    score: Math.min(1, Math.round(score * 100) / 100),
    relation_type: relationType,
  }))
}
