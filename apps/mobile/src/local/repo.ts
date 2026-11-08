import type {
  DocumentDetail,
  DocumentSummary,
  ParseStage,
  ParseStatus,
  RelatedItem,
  SearchResult,
  SourceType,
} from '@trovia/shared'

import type { ExtractedArticle } from './article'
import { passesCoverage } from './coverage'
import { opLog } from './dev-log'
import { getDb } from './db'
import { resolveImportedSavedAt } from './import/dates'
import type { RestoreDocument } from './import/parse'
import { RETRYABLE_CODES } from './retry'
import { SEMANTIC_MIN_SCORE, cosine, embedTexts, loadEmbedConfig, loadVectors } from './embed'
import type { Completer } from './intent'
import { resolveIntent } from './intent'
import { chat, loadLlmKey, loadLlmState } from './llm'
import { matchRange, timeOf } from './query'
import type { DateRange } from './query'
import { hasContentTerm, queryTerms } from './terms'
import { newId, normalizeUrl, nowIso, oneLine, parseJsonArray, parseJsonObject, sourceTypeOf } from './util'
import { t } from '../i18n'

export { queryTerms } from './terms'

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
  image_files: string | null
  search_text: string
  parse_status: string
  parse_stage: string | null
  parse_error_code: string | null
  saved_at: string
  last_parsed_at: string | null
  updated_at: string
  rev: number
  imported_at: string | null
  deleted_at: string | null
  metadata: string
}

type SummaryRow = Pick<
  DocumentRow,
  | 'id'
  | 'url'
  | 'title'
  | 'site_name'
  | 'source_type'
  | 'summary_short'
  | 'parse_status'
  | 'parse_error_code'
  | 'saved_at'
  | 'images'
  | 'image_files'
>

function toSummary(row: SummaryRow): DocumentSummary {
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
    images: parseJsonArray(row.images ?? '[]'),
    image_files: parseJsonArray(row.image_files ?? '[]'),
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
    image_files: parseJsonArray(row.image_files ?? '[]'),
    metadata: parseJsonObject(row.metadata),
    last_parsed_at: row.last_parsed_at,
    parse_stage: row.parse_stage as ParseStage | null,
  }
}

/**
 * Save a link; if the same link (after normalization) already exists, return the existing entry.
 * titleHint comes from share text or the clipboard: when the body can't be fetched, at least keep the title the user saw.
 */
/**
 * Restore one article from Trovia's own export file: body, summary, keywords and saved time are all copied over,
 * without fetching the page again. If the site is down or the article is gone, the copy in the backup still exists.
 *
 * If the link is already in the library, skip it and return 'duplicate' — a restore must not overwrite a newer version.
 */
export async function restoreDocument(
  doc: RestoreDocument,
  // The origin used to be written into metadata; that added a field to "export → import → export again", so it is no longer stored.
  _origin: string,
): Promise<'created' | 'duplicate'> {
  const db = await getDb()
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM documents WHERE (url = ? OR url = ?) AND deleted_at IS NULL LIMIT 1',
    doc.url,
    doc.dedupeKey,
  )
  if (existing) return 'duplicate'

  // Use the timestamps from the backup as they are and fill in the current time only when missing — "export then import must not change the data".
  const now = nowIso()
  const isoOr = (value: string | null | undefined) => (value && value.trim() ? value : null)
  const savedAt = doc.savedAt ? new Date(doc.savedAt).toISOString() : (isoOr(doc.updatedAt) ?? now)
  const updatedAt = isoOr(doc.updatedAt) ?? savedAt
  const body = doc.contentMarkdown ?? doc.plainText ?? null
  const hasBody = Boolean(body && body.trim())

  // The id is copied too: use it when the new library doesn't have it, and only replace it on a clash.
  let id = doc.id?.trim() || newId()
  const clash = await db.getFirstAsync<{ id: string }>('SELECT id FROM documents WHERE id = ?', id)
  if (clash) id = newId()

  const metadata = doc.metadata ?? {}
  await db.runAsync(
    `INSERT INTO documents (id, url, canonical_url, source_type, title, site_name, author,
       published_at, description, summary_short, summary_long, keywords, topics, language,
       content_markdown, plain_text, images, image_files, search_text, parse_status, parse_stage,
       parse_error_code, saved_at, last_parsed_at, updated_at, rev, metadata, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    doc.url,
    isoOr(doc.canonicalUrl) ?? doc.url,
    doc.sourceType ?? sourceTypeOf(doc.url),
    doc.title,
    doc.siteName,
    doc.author,
    doc.publishedAt,
    doc.description,
    doc.summaryShort,
    doc.summaryLong,
    JSON.stringify(doc.keywords),
    JSON.stringify(doc.topics),
    doc.language,
    doc.contentMarkdown,
    doc.plainText,
    JSON.stringify(doc.images),
    JSON.stringify(doc.imageFiles),
    searchTextOf({
      title: doc.title,
      siteName: doc.siteName,
      summary: doc.summaryLong ?? doc.summaryShort,
      keywords: doc.keywords,
      plainText: doc.plainText ?? '',
    }),
    // If the backup records a status, copy it (completed / failed / partial are all real history);
    // only when an old backup has none is it inferred from whether there is a body.
    doc.parseStatus ?? (hasBody ? 'completed' : 'pending'),
    doc.parseStage,
    doc.parseErrorCode,
    savedAt,
    // The parse time from the backup is copied (it may be null, and then it stays null);
    // only for very old backups with no status at all is it inferred as "has a body, so it was just parsed".
    isoOr(doc.lastParsedAt) ?? (doc.parseStatus ? null : hasBody ? now : null),
    updatedAt,
    doc.rev ?? 1,
    JSON.stringify(metadata),
    doc.importedAt ?? nowIso(),
  )
  return 'created'
}

export async function createDocument(
  rawUrl: string,
  titleHint?: string | null,
  /** Carry the original saved time on import: bookmarks saved in 2019 shouldn't all turn into "today". */
  savedAt?: number | null,
  /**
   * Origin. Only "which kind of origin + file name" is recorded; the wording is translated by the detail screen in the UI language —
   * assembling a Chinese sentence here would leak half a Chinese sentence into the English UI.
   */
  origin?: { kind: 'import' | 'restore'; file: string } | null,
  /** Whether the saved time came from the import file (a file without a time column must not claim so). */
  savedAtFromFile?: boolean,
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
  // Times in an import file can be very old; accept them only within a sensible range (see import/dates.ts).
  const saved = resolveImportedSavedAt(savedAt, Date.now())
  await db.runAsync(
    `INSERT INTO documents (id, url, canonical_url, source_type, title, parse_status, parse_stage, saved_at, updated_at, metadata, imported_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 'fetch', ?, ?, ?, ?)`,
    id,
    url,
    url,
    sourceTypeOf(url),
    hint,
    saved,
    now,
    JSON.stringify(
      origin
        ? { origin_kind: origin.kind, origin_file: origin.file, savedAtFromFile: Boolean(savedAtFromFile) }
        : {},
    ),
    origin ? now : null,
  )
  return { id, duplicate: false }
}

/** For the clipboard hint: whether this link is already saved (compared after normalization). */
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

/** When fetching fails or there is no title, reuse the title seed from when it was saved. */
export async function getSeededTitle(id: string): Promise<string | null> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ title: string | null }>(
    'SELECT title FROM documents WHERE id = ? AND deleted_at IS NULL',
    id,
  )
  return row?.title ?? null
}

export interface ListQuery {
  page: number
  pageSize: number
  keyword?: string
  /** Only items that couldn't be parsed: this is what the failure summary opens into. */
  failedOnly?: boolean
  /** Only items imported from a file: after importing 300 of them you still need a way to find that batch. */
  importedOnly?: boolean
}

/** The columns the list actually uses. Bodies run to tens of KB and `SELECT *` would read them too, pure waste. */
const SUMMARY_COLUMNS =
  'id, url, title, site_name, source_type, summary_short, parse_status, parse_error_code, saved_at, images, image_files'

function buildListWhere(options: ListQuery): { where: string; params: (string | number)[] } {
  const keyword = options.keyword?.trim() ?? ''
  const clauses: string[] = ['deleted_at IS NULL']
  const params: (string | number)[] = []
  if (options.failedOnly) clauses.push("parse_status = 'failed'")
  // imported_at is a new column; old rows only left origin/origin_kind in metadata, so both must be recognized.
  if (options.importedOnly) {
    clauses.push(
      "(imported_at IS NOT NULL OR metadata LIKE '%\"origin\"%' OR metadata LIKE '%\"origin_kind\"%')",
    )
  }
  if (keyword) {
    clauses.push('(title LIKE ? OR summary_short LIKE ? OR search_text LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }
  return { where: clauses.join(' AND '), params }
}

/**
 * Just one page. **Do not compute the total along the way**: that is an extra full table scan,
 * as expensive as fetching this page. countDocuments fills the total in asynchronously so the list comes first.
 */
export async function listDocuments(options: ListQuery): Promise<{ items: DocumentSummary[] }> {
  const db = await getDb()
  const { where, params } = buildListWhere(options)
  const page = Math.max(1, options.page)
  const pageSize = Math.max(1, options.pageSize)
  const rows = await db.getAllAsync<SummaryRow>(
    `SELECT ${SUMMARY_COLUMNS} FROM documents WHERE ${where} ORDER BY saved_at DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    (page - 1) * pageSize,
  )
  return { items: rows.map(toSummary) }
}

/** Total hits: the "N items" in the filter bar. Kept apart from the list so being slow doesn't block content. */
export async function countMatchingDocuments(
  options: Omit<ListQuery, 'page' | 'pageSize'>,
): Promise<number> {
  const db = await getDb()
  const { where, params } = buildListWhere({ ...options, page: 1, pageSize: 1 })
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM documents WHERE ${where}`,
    ...params,
  )
  return row?.total ?? 0
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
  /** Recognised image text: appended to the search string only, never stored as body. */
  ocrText?: string
}): string {
  return [
    fields.title ?? '',
    fields.siteName ?? '',
    fields.summary ?? '',
    fields.keywords.join(' '),
    fields.plainText.slice(0, 8000),
    (fields.ocrText ?? '').slice(0, 4000),
  ]
    .join('\n')
    .toLowerCase()
}

/** Write to the database after a successful fetch and summary. */
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
      ocrText: article.ocrText,
    }),
    now,
    now,
    id,
  )
}

/** Partial success when only metadata was obtained and the body is too short. */
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
      ocrText: article.ocrText,
    }),
    errorCode,
    now,
    now,
    id,
  )
}

/**
 * A fetch failure.
 *
 * An item that already has a body (parsed successfully before) is not downgraded: a failed refetch only means "no new copy this time",
 * the content the user has is still there, and marking it "failed" would make them think it broke.
 * The error code is recorded anyway, which helps both debugging and answering "why didn't this update".
 */
export async function markFailed(id: string, errorCode: string): Promise<void> {
  const db = await getDb()
  const now = nowIso()
  await db.runAsync(
    `UPDATE documents SET
       parse_status = CASE
         WHEN plain_text IS NOT NULL AND length(plain_text) >= 200 THEN 'completed'
         ELSE 'failed'
       END,
       parse_stage = NULL,
       parse_error_code = ?,
       last_parsed_at = ?,
       updated_at = ?
     WHERE id = ?`,
    errorCode,
    now,
    now,
    id,
  )
}

/** Re-parse: back to pending, clearing the previous round's error. */
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
 * Deleting writes a tombstone instead of removing the row: it no longer shows on this device, but the update and delete times are kept,
 * so once multi-device sync lands this deletion can be propagated directly.
 */
/**
 * Saved items that have image URLs (ordered by most recently updated).
 *
 * Whether an image needs filling in can't be judged from the image_files column alone: it may list a path whose file has already
 * been removed or is 0 bytes (a 404 response also writes an empty file). The real decision lives in image-hydrate;
 * this only fishes out the candidates.
 */
export async function listWithImages(limit = 20): Promise<{ id: string; url: string; images: string[]; imageFiles: string[] }[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<{ id: string; url: string; images: string; image_files: string }>(
    `SELECT id, url, images, image_files FROM documents
      WHERE deleted_at IS NULL AND images <> '[]'
      ORDER BY updated_at DESC LIMIT ?`,
    limit,
  )
  return rows
    .map((row) => ({
      id: row.id,
      url: row.url,
      images: parseJsonArray(row.images),
      imageFiles: parseJsonArray(row.image_files ?? '[]'),
    }))
    .filter((row) => row.images.length > 0)
}

/** For import dedupe: every link already on this device. */
export async function listUrls(): Promise<string[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<{ url: string }>(
    'SELECT url FROM documents WHERE deleted_at IS NULL',
  )
  return rows.map((row) => row.url)
}

/** For export: all live saved items (with body and image paths), oldest saved first. */
/**
 * Full-row view just for backups: Detail plus updated_at and rev,
 * otherwise "export → import → export again" would drift on those two columns.
 */
export interface ExportDocument extends DocumentDetail {
  updated_at: string
  rev: number
  imported_at: string | null
}

export async function listAllForExportFidelity(): Promise<ExportDocument[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<DocumentRow>(
    'SELECT * FROM documents WHERE deleted_at IS NULL ORDER BY saved_at ASC',
  )
  return rows.map((row) => ({
    ...toDetail(row),
    updated_at: row.updated_at,
    rev: row.rev,
    imported_at: row.imported_at,
  }))
}

/** Write the local paths back once images are on disk, aligned by index with images. */
export async function setImageFiles(id: string, files: string[]): Promise<void> {
  const db = await getDb()
  await db.runAsync('UPDATE documents SET image_files = ? WHERE id = ?', JSON.stringify(files), id)
}

export async function deleteDocument(id: string): Promise<void> {
  await opLog('delete.one', { id })
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
  /** Both completed and partial write search_text, so they can be searched. */
  searchable: number
  processing: number
  failed: number
}

/**
 * Failures worth trying again: the network was down, the site misbehaved, or our own parser crashed.
 * Ones the site explicitly refused (FETCH_BLOCKED), that only open inside the App, or whose body needs a script to render,
 * give the same result a hundred times over and should not appear behind a "Retry" button.
 */
export { isRetryableError, RETRYABLE_CODES } from './retry'

export async function countRetryableFailed(): Promise<number> {
  const db = await getDb()
  const placeholders = RETRYABLE_CODES.map(() => '?').join(', ')
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM documents
      WHERE deleted_at IS NULL AND parse_status = 'failed'
        AND (parse_error_code IS NULL OR parse_error_code IN (${placeholders}))`,
    ...RETRYABLE_CODES,
  )
  return row?.total ?? 0
}

export async function retryFailedBatch(limit = 60): Promise<number> {
  const db = await getDb()
  const placeholders = RETRYABLE_CODES.map(() => '?').join(', ')
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM documents
      WHERE deleted_at IS NULL AND parse_status = 'failed'
        AND (parse_error_code IS NULL OR parse_error_code IN (${placeholders}))
      ORDER BY saved_at DESC LIMIT ?`,
    ...RETRYABLE_CODES,
    limit,
  )
  for (const row of rows) await markForRetry(row.id)
  return rows.length
}

/** The settings page's dark stats panel needs only these four numbers. */
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
// Local search
// ---------------------------------------------------------------------------

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
  /** Plain-language explanation, e.g. "saved yesterday"; null when there is no time condition. */
  interpretation: string | null
}

/** The time range this row matched (by saved or published time); null when nothing matched. */
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

/** Reference time for sorting: the matched day when there is a time condition, otherwise the saved time. */
function sortTimeOf(row: DocumentRow, hit: DateRange | null): number {
  const field = hit?.field ?? 'saved'
  return timeOf(field === 'published' ? row.published_at : row.saved_at) ?? 0
}

/**
 * When an LLM is configured (and "understand search intent" is on), hand the sentence to the model to translate;
 * not configured, timed out, or errored all return null, and search falls back to the rule layer without getting slower or failing.
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

/** Only compute vectors when literal results are fewer than this: a query that already suffices doesn't pay for an extra model call. */
const LITERAL_ENOUGH = 3
const SEMANTIC_LIMIT = 5

/**
 * Semantic fallback: only fills in what literal search missed, and must clear the similarity threshold.
 * Any failure at any step returns an empty array — search must not get worse because the model is unavailable.
 */
async function semanticMatches(text: string, exclude: Set<string>, limit: number): Promise<SearchResult[]> {
  if (!text.trim() || exclude.size >= 500) return []
  try {
    const config = await loadEmbedConfig()
    if (!config) return []
    const vectors = await loadVectors(config.model)
    if (vectors.length === 0) return []

    const [queryVec] = await embedTexts([text], config)
    const ranked = vectors
      .filter((row) => !exclude.has(row.id))
      .map((row) => ({ id: row.id, score: cosine(queryVec, row.vec) }))
      .filter((row) => row.score >= SEMANTIC_MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
    if (ranked.length === 0) return []

    const db = await getDb()
    const placeholders = ranked.map(() => '?').join(',')
    const rows = await db.getAllAsync<DocumentRow>(
      `SELECT * FROM documents WHERE deleted_at IS NULL AND id IN (${placeholders})`,
      ...ranked.map((row) => row.id),
    )
    const byId = new Map(rows.map((row) => [row.id, row]))

    return ranked.flatMap(({ id, score }) => {
      const row = byId.get(id)
      if (!row) return []
      return [
        {
          document_id: row.id,
          title: row.title,
          url: row.url,
          source_type: row.source_type as SourceType,
          site_name: row.site_name,
          summary: row.summary_short ?? row.summary_long,
          score: Math.min(1, Math.round(score * 100) / 100),
          // State only the fact as the reason: this is semantic similarity, not "matched a word".
          match_reason: '内容与这句话的意思相近',
          matched_excerpt: null,
          saved_at: row.saved_at,
          parse_status: row.parse_status as ParseStatus,
          parse_error_code: row.parse_error_code,
          match_kind: 'semantic' as const,
        },
      ]
    })
  } catch {
    return []
  }
}

export async function searchDocuments(query: string, limit = 20): Promise<SearchOutcome> {
  const startedAt = Date.now()
  const outcome = await searchDocumentsInner(query, limit)
  await opLog('search', {
    q: query,
    hits: outcome.results.length,
    interpreted: outcome.interpretation ?? null,
    ms: Date.now() - startedAt,
  })
  return outcome
}

async function searchDocumentsInner(query: string, limit = 20): Promise<SearchOutcome> {
  const parsed = await resolveIntent(query, { complete: await intentCompleter() })
  const terms = queryTerms(parsed.text)
  // "Find yesterday's" has no keywords and must still return results — so an empty terms list must not short-circuit.
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
    let matchedTerms = 0
    const hitTitle: string[] = []
    const hitKeywords: string[] = []
    const hitSummary: string[] = []
    const hitBody: string[] = []
    const hitSite: string[] = []

    for (const term of terms) {
      let matchedThisTerm = false
      if (title.includes(term)) {
        matchedThisTerm = true
        score += 10
        if (hitTitle.length < 3) hitTitle.push(term)
      }
      if (keywordsText.includes(term)) {
        score += 7
        if (hitKeywords.length < 3) hitKeywords.push(term)
        matchedThisTerm = true
      }
      if (summary.includes(term)) {
        score += 4
        if (hitSummary.length < 3) hitSummary.push(term)
        matchedThisTerm = true
      }
      if (body.includes(term)) {
        score += 2
        if (hitBody.length < 3) hitBody.push(term)
        matchedThisTerm = true
      }
      if (site.includes(term)) {
        score += 3
        if (hitSite.length < 2) hitSite.push(term)
        matchedThisTerm = true
      }
      if (matchedThisTerm) matchedTerms += 1
    }

    // With a time condition only, every item in the range counts as a hit, and time does the ordering.
    if (!dateOnly && score <= 0) continue
    // Coverage: Chinese bigrams let an unrelated sentence graze one term ("...this kind of thing" hits "this kind").
    // At least half the terms must match for the row to relate to the query, otherwise it is noise.
    if (!dateOnly && !passesCoverage(matchedTerms, terms.length)) continue

    // The match reason is read by humans, so it is assembled in the UI language; never hard-code Chinese in the data layer.
    const sep = t('search.reason.sep')
    const why = (kind: string, words: string[]) =>
      words.length ? t(`search.reason.${kind}`, { terms: words.join(sep) }) : null
    const parts: string[] = []
    if (hit) parts.unshift(dateLabelOf(hit))
    for (const [kind, words] of [
      ['title', hitTitle],
      ['keywords', hitKeywords],
      ['summary', hitSummary],
      ['body', hitBody],
      ['site', hitSite],
    ] as const) {
      const line = why(kind, words)
      if (line) parts.push(line)
    }

    scored.push({
      row,
      score: dateOnly ? 1 : score / (terms.length * 10),
      reason: parts.slice(0, 3).join(t('search.reason.join')),
      excerpt: dateOnly ? null : excerptAround(row.plain_text ?? '', terms),
      at: sortTimeOf(row, hit),
    })
  }

  // With a time condition, sort descending by that time; otherwise relevance first, then time for ties.
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
    parse_error_code: row.parse_error_code,
  }))

  // Only top up with semantics when literal results are thin; a time condition is a hard filter, and searching semantically within one day means nothing.
  // Also, no semantic fallback when the sentence has no content words: otherwise "zzzz no such thing" would also get a few "roughly similar" hits.
  let extra: SearchResult[] = []
  if (!dateOnly && hasContentTerm(parsed.text) && results.length < LITERAL_ENOUGH) {
    const shown = new Set(results.map((item) => item.document_id))
    extra = await semanticMatches(parsed.text || query, shown, SEMANTIC_LIMIT)
  }

  return { results: [...results, ...extra], interpretation: parsed.summary }
}

function bigrams(text: string): Set<string> {
  const compact = text.toLowerCase().replace(/\s+/g, '')
  const grams = new Set<string>()
  for (let i = 0; i < compact.length - 1; i += 1) grams.add(compact.slice(i, i + 2))
  return grams
}

/** Related saved items: shared keywords plus title similarity, computed entirely locally. */
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
