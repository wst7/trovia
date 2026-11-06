/**
 * 导入解析：把「别的应用/浏览器导出的文件」变成链接列表。
 *
 * 支持四种真实存在的格式，都是用户手上大概率能拿到的：
 *   - Netscape 书签 HTML：Chrome / Edge / Firefox / Safari / Pocket 导出的都是这个
 *   - Chrome / Edge 的 Bookmarks JSON（有些同步盘里直接就是这个文件）
 *   - CSV：Raindrop、Instapaper 这类导出的表格
 *   - 纯文本：一行一个链接（很多人自己整理的清单）
 *
 * 这里只做「文本 → 条目」，不碰数据库，方便用真实导出文件做回归测试。
 */

export type ImportFormat =
  | 'bookmarks-html'
  | 'bookmarks-json'
  | 'csv'
  | 'urls'
  /** Trovia 自己的导出文件：不只是链接，正文、摘要、关键词、收藏时间都在里面。 */
  | 'trovia-json'
  | 'unknown'

/**
 * 备份里的一篇，字段与 documents 表对齐，恢复时不再重新抓取。
 *
 * 「导出再导入数据不能变」是硬要求，所以这里不只是内容字段：
 * id、原始链接、状态、时间戳、rev 全都带过来。老备份（v1）没有的字段留 null，
 * 落库时按新收藏处理，不会因为缺字段而报错。
 */
export interface RestoreDocument {
  /** 原样保留的链接：不做规范化，规范化后的结果在 dedupeKey 里用于判重。 */
  url: string
  /** 判重用的规范化链接。 */
  dedupeKey: string
  /** 备份里的主键；新库直接沿用，避免恢复后变成「另一条」。 */
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
  /** 导出文件里带的添加时间（毫秒），没有就是 null。 */
  addedAt: number | null
}

export interface ImportParseResult {
  format: ImportFormat
  items: ImportItem[]
  /** 只有 trovia-json 有：可以直接落库的完整内容。 */
  documents?: RestoreDocument[]
  /** 看着像链接但被跳过的行，附带原因，导入前要给用户看。 */
  skipped: { line: string; reason: string }[]
}

export const MAX_IMPORT_ITEMS = 500

/**
 * 备份恢复的上限另算：普通导入是「一堆链接要排队去抓」，500 条是给队列兜底；
 * 备份是直接落库、不抓网页，限 500 会让「1000 篇的备份恢复不全」，
 * 那就违背了「导出的东西一定导得回来」。
 */
export const MAX_RESTORE_ITEMS = 20000

/** 只保留 http(s)，其余（javascript:、chrome://、file://）都不是能收藏的内容。 */
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
  // 跟踪参数不参与去重，否则同一个页面会被当成两条
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
  // 自己的导出放在最前面判断：它里面也有 http 链接，落到 urls 会把正文和标题全丢掉。
  if (/"documents"\s*:\s*\[/.test(head)) return 'trovia-json'
  if (/<a\s+href=/i.test(head) && /<\/a>/i.test(head)) return 'bookmarks-html'
  if (/^\s*\[/.test(head) || /"roots"\s*:/.test(head) || /"bookmark_bar"\s*:/.test(head)) return 'bookmarks-json'
  if (/^\s*[^{[]/.test(head) && head.split('\n')[0].includes(',') && /url/i.test(head.split('\n')[0])) return 'csv'
  if (/https?:\/\//i.test(head)) return 'urls'
  return 'unknown'
}

/** Chrome / Edge 的 Bookmarks JSON：递归收集 type=url 的节点。 */
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
    // roots / bookmark_bar 这类是对象映射，不是数组，也要往下走
    Object.values(record).forEach((value) => {
      if (value && typeof value === 'object') walk(value, depth + 1)
    })
  }

  walk((root as Record<string, unknown>)?.roots ?? root)
  return items
}

/** Netscape 书签 HTML：<DT><A HREF="..." ADD_DATE="...">标题</A> */
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

/** 简易 CSV 解析：支持引号包裹与逗号转义，够读导出文件。 */
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

/** Pocket 的 time_added 是 Unix 秒，其他导出多半是 ISO 日期；认不出来就当没有。 */
function parseAddedAt(raw: string | undefined): number | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  // Pocket 的 time_added 是 Unix 秒
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
  // 各家的列名不一样：Pocket 用 given_url/given_title，Raindrop 用 url，
  // Instapaper 的 CSV 直接是 URL / Title，统一按别名找。
  const pick = (...names: string[]) => header.findIndex((cell) => names.includes(cell))
  const urlIndex = pick('url', 'link', 'href', 'given_url', '地址', '链接')
  // Pocket 同时给 given_url（短链）和 resolved_url（真实地址），优先用后者。
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
      // 有标题却没链接，多半是导出时漏了；空行则不算异常，不打扰用户。
      if (rawUrl.trim()) skipped.push({ line: rawUrl.slice(0, 80), reason: '不是可收藏的链接' })
      else if (title) skipped.push({ line: title.slice(0, 60), reason: '这一行没有链接' })
      continue
    }
    items.push({ url, title: title || null, addedAt: parseAddedAt(cells[addedIndex ?? -1]) })
  }
  return items
}

/**
 * 这批导入项的时间跨度，用来在预览里说清楚「2019-01 至 2025-01」。
 * 没有时间的导出（纯文本、部分书签）返回 null，不要显示成「今天」。
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

/** 纯文本：一行一个链接，允许「链接 标题」或 Markdown 链接。 */
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
 * Trovia 导出的 JSON：{ version, exported_at, count, documents: [...] }。
 *
 * 空链接或非法链接的条目跳过并记下原因；正文缺失的条目照样恢复，
 * 落库时会被标成待整理，交给解析队列重新抓。
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

/** 解析入口：自动识别格式，去重后按上限截断。 */
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
  // 用判重键匹配：documents 里存的是原样链接，判重用的是规范化之后的那个。
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
