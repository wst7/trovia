/**
 * Import parsing: turn "files exported by other apps/browsers" into a list of links.
 *
 * Four formats that really exist are supported, all of them things users are likely to have at hand:
 *   - Netscape bookmark HTML: what Chrome / Edge / Firefox / Safari / Pocket all export
 *   - the Bookmarks JSON of Chrome / Edge (in some sync folders this is the very file you find)
 *   - CSV: the spreadsheets exported by the likes of Raindrop and Instapaper
 *   - plain text: one link per line (the lists many people put together themselves)
 *
 * This only does "text → items" and never touches the database, which makes it easy to regression-test with real export files.
 */

export type ImportFormat =
  | 'bookmarks-html'
  | 'bookmarks-json'
  | 'csv'
  | 'urls'
  /** Trovia's own export file: not just links, but body, summary, keywords and saved time as well. */
  | 'trovia-json'
  | 'unknown'

/**
 * One article inside a backup, with fields aligned to the documents table, so restoring never re-fetches.
 *
 * "Export then import must not change the data" is a hard requirement, so this is not content fields only:
 * id, original URL, status, timestamps and rev all come along. Fields missing from old (v1) backups stay null,
 * and are treated like a new save when stored, so a missing field never becomes an error.
 */
export interface RestoreDocument {
  /** The URL kept verbatim: not normalised; the normalised result lives in dedupeKey for duplicate detection. */
  url: string
  /** The normalised URL used for duplicate detection. */
  dedupeKey: string
  /** The primary key from the backup; the new database keeps it so a restore does not turn into "another entry". */
  id: string | null
  canonicalUrl: string | null
  title: string | null
  savedAt: number | null
  siteName: string | null
  author: string | null
  publishedAt: string | null
  description: string | null
  summaryShort: string | null
  summaryLong: string | null
  keywords: string[]
  topics: string[]
  language: string | null
  contentMarkdown: string | null
  plainText: string | null
  images: string[]
  imageFiles: string[]
  sourceType: string | null
  parseStatus: string | null
  parseStage: string | null
  parseErrorCode: string | null
  updatedAt: string | null
  lastParsedAt: string | null
  importedAt: string | null
  rev: number | null
  metadata: Record<string, unknown> | null
}

export interface ImportItem {
  url: string
  title: string | null
  /** The added time carried by the export file (in milliseconds); null when absent. */
  addedAt: number | null
}

export interface ImportParseResult {
  format: ImportFormat
  items: ImportItem[]
  /** Only present for trovia-json: the full content that can be written straight to the DB. */
  documents?: RestoreDocument[]
  /** Lines that looked like links but were skipped, with the reason; shown to the user before importing. */
  skipped: { line: string; reason: string }[]
}

export const MAX_IMPORT_ITEMS = 500

/**
 * Restoring a backup has its own limit: a normal import means "a pile of links queueing up to be fetched", where 500 is a fallback cap for the queue;
 * a backup goes straight into the DB without fetching pages, so capping it at 500 would mean "a 1000-article backup is only partly restored",
 * which would break the promise that whatever was exported can always be imported back.
 */
export const MAX_RESTORE_ITEMS = 20000

/** Keep http(s) only; everything else (javascript:, chrome://, file://) is not content that can be saved. */
export function normalizeUrl(raw: string): string | null {
  const text = decodeEntities(raw.trim()).replace(/^["'<]|["'>]$/g, '')
  if (!text) return null
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    return null
  }
  if (!/^https?:$/.test(parsed.protocol)) return null

  parsed.hash = ''
  // Tracking parameters take no part in de-duplication, otherwise the same page counts as two
  const drop = [...parsed.searchParams.keys()].filter((key) => /^(utm_|fbclid|gclid|spm|from|share_)/i.test(key))
  for (const key of drop) parsed.searchParams.delete(key)
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '')
  parsed.protocol = 'https:'
  const path = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.protocol}//${parsed.hostname}${path}${parsed.search}`
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

export function detectFormat(content: string): ImportFormat {
  const head = content.slice(0, 4000)
  // Check our own export first: it also contains http links, and falling through to urls would throw away body and title.
  if (/"documents"\s*:\s*\[/.test(head)) return 'trovia-json'
  if (/<a\s+href=/i.test(head) && /<\/a>/i.test(head)) return 'bookmarks-html'
  if (/^\s*\[/.test(head) || /"roots"\s*:/.test(head) || /"bookmark_bar"\s*:/.test(head)) return 'bookmarks-json'
  if (/^\s*[^{[]/.test(head) && head.split('\n')[0].includes(',') && /url/i.test(head.split('\n')[0])) return 'csv'
  if (/https?:\/\//i.test(head)) return 'urls'
  return 'unknown'
}

/** The Bookmarks JSON of Chrome / Edge: recursively collect nodes with type=url. */
function parseBookmarksJson(content: string, skipped: ImportParseResult['skipped']): ImportItem[] {
  const items: ImportItem[] = []
  let root: unknown
  try {
    root = JSON.parse(content)
  } catch {
    skipped.push({ line: content.slice(0, 60), reason: 'JSON 解析失败' })
    return items
  }

  const walk = (node: unknown, depth = 0): void => {
    if (!node || typeof node !== 'object' || depth > 12) return
    const record = node as Record<string, unknown>
    if (record.type === 'url' && typeof record.url === 'string') {
      const url = normalizeUrl(record.url)
      if (url) {
        const added = typeof record.date_added === 'string' ? Number(record.date_added) : null
        items.push({
          url,
          title: typeof record.name === 'string' ? decodeEntities(record.name).trim() : null,
          addedAt: added && Number.isFinite(added) ? added : null,
        })
      } else {
        skipped.push({ line: record.url, reason: '不是可收藏的链接' })
      }
      return
    }
    const children = record.children
    if (Array.isArray(children)) {
      children.forEach((child) => walk(child, depth + 1))
      return
    }
    // Things like roots / bookmark_bar are object maps rather than arrays, and must be walked as well
    Object.values(record).forEach((value) => {
      if (value && typeof value === 'object') walk(value, depth + 1)
    })
  }

  walk((root as Record<string, unknown>)?.roots ?? root)
  return items
}

/** Netscape bookmark HTML: <DT><A HREF="..." ADD_DATE="...">title</A> */
function parseBookmarksHtml(content: string, skipped: ImportParseResult['skipped']): ImportItem[] {
  const items: ImportItem[] = []
  const pattern = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  for (const match of content.matchAll(pattern)) {
    const url = normalizeUrl(match[1])
    if (!url) {
      if (!/^(javascript|place|chrome|about|data|file):/i.test(match[1])) {
        skipped.push({ line: match[1].slice(0, 80), reason: '不是可收藏的链接' })
      }
      continue
    }
    const title = decodeEntities(match[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    items.push({ url, title: title || null, addedAt: null })
  }
  return items
}

/** Minimal CSV parsing: handles quoted fields and escaped commas, which is enough to read export files. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      cells.push(cell)
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell)
  return cells
}

/** Pocket's time_added is in Unix seconds while other exports are mostly ISO dates; anything unrecognised counts as absent. */
function parseAddedAt(raw: string | undefined): number | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  // Pocket's time_added is in Unix seconds
  if (/^\d{9,11}$/.test(value)) {
    const seconds = Number(value)
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseCsv(content: string, skipped: ImportParseResult['skipped']): ImportItem[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length === 0) return []
  const header = splitCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase())
  // Column names differ per vendor: Pocket uses given_url/given_title, Raindrop uses url,
  // and Instapaper's CSV is simply URL / Title, so everything is looked up by alias.
  const pick = (...names: string[]) => header.findIndex((cell) => names.includes(cell))
  const urlIndex = pick('url', 'link', 'href', 'given_url', '地址', '链接')
  // Pocket supplies both given_url (the short link) and resolved_url (the real address); prefer the latter.
  const resolvedIndex = pick('resolved_url')
  const titleIndex = pick('title', 'name', 'given_title', '标题')
  const addedIndex = pick('time_added', 'added', 'created', 'saved', '时间', '收藏时间')
  if (urlIndex < 0) {
    skipped.push({ line: lines[0].slice(0, 60), reason: 'CSV 里找不到 url 列' })
    return []
  }

  const items: ImportItem[] = []
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line)
    const title = titleIndex >= 0 ? (cells[titleIndex] ?? '').trim() : ''
    const rawUrl = (cells[resolvedIndex >= 0 ? resolvedIndex : -1] ?? '').trim() || (cells[urlIndex] ?? '')
    const url = normalizeUrl(rawUrl)
    if (!url) {
      // A title with no link usually means the export dropped it; blank lines are not an anomaly and do not bother the user.
      if (rawUrl.trim()) skipped.push({ line: rawUrl.slice(0, 80), reason: '不是可收藏的链接' })
      else if (title) skipped.push({ line: title.slice(0, 60), reason: '这一行没有链接' })
      continue
    }
    items.push({ url, title: title || null, addedAt: parseAddedAt(cells[addedIndex ?? -1]) })
  }
  return items
}

/**
 * The time span of this batch of imported items, used to state "2019-01 to 2025-01" clearly in the preview.
 * Exports with no times (plain text, some bookmark files) return null; do not display that as "today".
 */
export function addedRange(items: ImportItem[]): string | null {
  const times = items.map((item) => item.addedAt).filter((value): value is number => typeof value === 'number')
  if (times.length === 0) return null
  const format = (value: number) => {
    const date = new Date(value)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  }
  const earliest = format(Math.min(...times))
  const latest = format(Math.max(...times))
  return earliest === latest ? earliest : `${earliest} 至 ${latest}`
}

/** Plain text: one link per line, allowing "link title" or a Markdown link. */
function parseUrls(content: string, skipped: ImportParseResult['skipped']): ImportItem[] {
  const items: ImportItem[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const markdown = /^[-*]?\s*\[([^\]]+)\]\((https?:\/\/[^)]+)\)/.exec(line)
    if (markdown) {
      const url = normalizeUrl(markdown[2])
      if (url) items.push({ url, title: markdown[1].trim() || null, addedAt: null })
      continue
    }

    const match = /(https?:\/\/\S+)/.exec(line)
    if (!match) {
      skipped.push({ line: line.slice(0, 80), reason: '没有找到链接' })
      continue
    }
    const url = normalizeUrl(match[1])
    if (!url) {
      skipped.push({ line: line.slice(0, 80), reason: '不是可收藏的链接' })
      continue
    }
    const title = line.replace(match[1], '').replace(/^[-–—,:\s]+|[-–—,:\s]+$/g, '').trim()
    items.push({ url, title: title || null, addedAt: null })
  }
  return items
}

/**
 * The JSON Trovia exports: { version, exported_at, count, documents: [...] }.
 *
 * Entries with an empty or invalid link are skipped and the reason recorded; entries without a body are restored all the same,
 * get marked as pending processing when stored, and are handed to the parse queue for a refetch.
 */
export function parseTroviaJson(
  content: string,
  skipped: ImportParseResult['skipped'],
): { items: ImportItem[]; documents: RestoreDocument[] } {
  let bundle: unknown
  try {
    bundle = JSON.parse(content)
  } catch {
    skipped.push({ line: content.slice(0, 60), reason: '不是合法的 JSON' })
    return { items: [], documents: [] }
  }
  const raw = (bundle as { documents?: unknown }).documents
  if (!Array.isArray(raw)) {
    skipped.push({ line: content.slice(0, 60), reason: '文件里没有 documents 列表' })
    return { items: [], documents: [] }
  }

  const items: ImportItem[] = []
  const documents: RestoreDocument[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const doc = entry as Record<string, unknown>
    const rawUrl = typeof doc.url === 'string' ? doc.url : ''
    const url = normalizeUrl(rawUrl)
    if (!url) {
      skipped.push({ line: rawUrl || String(doc.title ?? ''), reason: '不是可以收藏的网页链接' })
      continue
    }
    const text = (value: unknown): string | null =>
      typeof value === 'string' && value.trim() ? value : null
    const strings = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
    const savedAt = typeof doc.saved_at === 'string' ? Date.parse(doc.saved_at) : Number.NaN
    const title = text(doc.title)
    documents.push({
      url: rawUrl,
      dedupeKey: url,
      id: text(doc.id),
      canonicalUrl: text(doc.canonical_url),
      title,
      savedAt: Number.isNaN(savedAt) ? null : savedAt,
      siteName: text(doc.site_name),
      author: text(doc.author),
      publishedAt: text(doc.published_at),
      description: text(doc.description),
      summaryShort: text(doc.summary_short),
      summaryLong: text(doc.summary_long),
      keywords: strings(doc.keywords),
      topics: strings(doc.topics),
      language: text(doc.language),
      contentMarkdown: text(doc.content_markdown),
      plainText: text(doc.plain_text),
      images: strings(doc.images),
      imageFiles: strings(doc.image_files),
      sourceType: text(doc.source_type),
      parseStatus: text(doc.parse_status),
      parseStage: text(doc.parse_stage),
      parseErrorCode: text(doc.parse_error_code),
      updatedAt: text(doc.updated_at),
      lastParsedAt: text(doc.last_parsed_at),
      importedAt: text(doc.imported_at),
      rev: typeof doc.rev === 'number' && Number.isFinite(doc.rev) ? doc.rev : null,
      metadata:
        doc.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata)
          ? (doc.metadata as Record<string, unknown>)
          : null,
    })
    items.push({ url, title, addedAt: Number.isNaN(savedAt) ? null : savedAt })
  }
  return { items, documents }
}

/** Parse entry point: detect the format automatically, de-duplicate, then truncate to the limit. */
export function parseImport(content: string): ImportParseResult {
  const format = detectFormat(content)
  const skipped: ImportParseResult['skipped'] = []
  let items: ImportItem[] = []
  let documents: RestoreDocument[] | undefined

  switch (format) {
    case 'trovia-json': {
      const parsed = parseTroviaJson(content, skipped)
      items = parsed.items
      documents = parsed.documents
      break
    }
    case 'bookmarks-html':
      items = parseBookmarksHtml(content, skipped)
      break
    case 'bookmarks-json':
      items = parseBookmarksJson(content, skipped)
      break
    case 'csv':
      items = parseCsv(content, skipped)
      break
    case 'urls':
      items = parseUrls(content, skipped)
      break
    default:
      return { format, items: [], skipped: [{ line: content.slice(0, 60), reason: '认不出这个文件的格式' }] }
  }

  const seen = new Set<string>()
  const unique: ImportItem[] = []
  for (const item of items) {
    if (seen.has(item.url)) continue
    seen.add(item.url)
    unique.push(item)
  }

  const limit = format === 'trovia-json' ? MAX_RESTORE_ITEMS : MAX_IMPORT_ITEMS
  if (unique.length > limit) {
    skipped.push({ line: `共 ${unique.length} 条`, reason: `单次最多导入 ${limit} 条，多余的先跳过` })
  }

  const kept = new Set(unique.slice(0, limit).map((item) => item.url))
  // Match on the dedupe key: documents store the link verbatim, while de-duplication uses the normalised one.
  const keptDocuments = documents?.filter((doc) => kept.has(doc.dedupeKey ?? doc.url))

  return {
    format,
    items: unique.slice(0, limit),
    documents: keptDocuments,
    skipped,
  }
}

export const FORMAT_LABELS: Record<ImportFormat, string> = {
  'bookmarks-html': '浏览器书签（HTML）',
  'bookmarks-json': 'Chrome / Edge 书签（JSON）',
  csv: '表格（CSV）',
  urls: '链接列表',
  'trovia-json': 'Trovia 备份（.zip）',
  unknown: '无法识别',
}
