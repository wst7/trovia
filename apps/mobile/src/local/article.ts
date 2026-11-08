import { load } from 'cheerio/slim'
import type { AnyNode, Element } from 'domhandler'

import { scrubAppPrompts, stripNoiseLines, trimMarkdownEdges } from './noise'
import { publishedDateOf } from './published'
import { hostOf, oneLine } from './util'

/**
 * Fetch and extract the article body on the phone.
 *
 * Parse the HTML with cheerio/slim (htmlparser2, pure JS, no DOM environment needed):
 * first pick the body container by selector, then strip scripts/nav/buttons, and finally convert the structure to Markdown.
 * More reliable than slicing with regex: nested tags, malformed HTML and the rich text of WeChat official accounts all come through correctly.
 * When a page hides its body in script JSON, it falls back further to JSON-LD / Next / Nuxt state.
 */
export interface ExtractedArticle {
  url: string
  title: string | null
  siteName: string | null
  author: string | null
  /** Original publication date (YYYY-MM-DD). null when it cannot be found — never faked with the time it was saved. */
  publishedAt: string | null
  description: string | null
  language: string | null
  markdown: string
  plainText: string
  /** Images that appeared in the body (absolute URLs, de-duplicated, icons removed). When there are many images and little text, the body may be exactly these images. */
  images: string[]
  /**
   * Characters recognised inside those images. Search-only: they are a clue for
   * "I remember the number in that screenshot", not the article's own prose, so
   * they must never reach plain_text, the summary or the reader.
   */
  ocrText?: string
  /** The page is only a script shell (content rendered by JS, or just a bridge that opens another app), so no body could be fetched. */
  scriptOnly: boolean
  /** The page demanded verification / login, so the body was not obtainable. */
  blocked: boolean
  /** This is only a redirect page that opens the Feishu / Lark client; the content itself is not on the web page. */
  appOnly: boolean
}

type CheerioDoc = ReturnType<typeof load>

/**
 * URL of the page currently being parsed, used for relative <img> paths.
 * Parsing is synchronous and the queue runs one job at a time, so a module variable is the least fuss.
 */
let imageBaseUrl = ''

const MAX_HTML_CHARS = 2_000_000

/** A UA that calls itself a bot gets a flat 403 from more than half of all sites; uniformly use a real mobile Chrome. */
const REQUEST_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const FETCH_TIMEOUT_MS = 25_000

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  copy: '©',
  reg: '®',
  middot: '·',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith('#')) {
      const num = code[1]?.toLowerCase() === 'x'
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10)
      if (!Number.isFinite(num)) return whole
      try {
        return String.fromCodePoint(num)
      } catch {
        return whole
      }
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole
  })
}

function metaMap(html: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    const value = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]
    if (key && value) map.set(key.toLowerCase(), decodeEntities(value).trim())
  }
  return map
}

function firstMatch(html: string, pattern: RegExp): string | null {
  const match = pattern.exec(html)
  return match?.[1] ? match[1] : null
}

/**
 * Many sites (Next.js / Nuxt / assorted CMSs) actually stuff the whole body into JSON inside a <script>,
 * with only the page shell rendered by JS. This digs out the bodies that “already arrived along with the HTML”,
 * so the content can be saved even when the page itself rendered no text.
 */
interface EmbeddedArticleData {
  title: string | null
  author: string | null
  description: string | null
  body: string | null
}

const TEXT_KEYS = /^(?:articleBody|article_body|content|body|text|html|richText|rich_text|markdown)$/i

function looksLikeProse(text: string): boolean {
  const cjk = text.match(/[一-鿿]/g)?.length ?? 0
  if (cjk >= 30) return true
  return text.length >= 400 && (text.match(/\s+/g)?.length ?? 0) >= 50
}

/** Find the longest stretch of body text in an arbitrary JSON structure; better nothing than junk, so strings that are too short or do not look like an article are skipped outright. */
function findLongText(value: unknown, depth = 0, budget = { left: 4000 }): string | null {
  if (depth > 6 || value === null || typeof value !== 'object' || budget.left <= 0) return null
  budget.left -= 1
  let best: string | null = null

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 40)) {
      const found = findLongText(item, depth + 1, budget)
      if (found && (!best || found.length > best.length)) best = found
    }
    return best
  }

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') {
      if (TEXT_KEYS.test(key) && item.length >= 120 && looksLikeProse(item)) {
        if (!best || item.length > best.length) best = item
      }
    } else if (typeof item === 'object' && item !== null) {
      const found = findLongText(item, depth + 1, budget)
      if (found && (!best || found.length > best.length)) best = found
    }
  }
  return best
}

function stringField(node: Record<string, unknown>, key: string): string | null {
  const value = node[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function authorName(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = authorName(item)
      if (name) return name
    }
    return null
  }
  if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>
    return stringField(node, 'name') ?? stringField(node, 'author')
  }
  return null
}

function parseJsonLoose(raw: string): unknown {
  const text = raw.trim().replace(/^<!--|-->$/g, '').trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function embeddedArticleData(html: string): EmbeddedArticleData {
  const result: EmbeddedArticleData = { title: null, author: null, description: null, body: null }

  const scripts = [
    ...Array.from(html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/(?:ld\+json|json)["'][^>]*>([\s\S]*?)<\/script>/gi)),
    ...Array.from(html.matchAll(/<script\b[^>]*id\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi)),
    ...Array.from(html.matchAll(/(?:window\.)?__(?:INITIAL_STATE|NUXT|NUXT_DATA|PRELOADED_STATE|APOLLO_STATE)__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/gi)),
  ]

  for (const match of scripts) {
    const data = parseJsonLoose(match[1] ?? '')
    if (!data) continue

    // JSON-LD Article nodes have the most regular fields, so take the metadata from them first.
    const nodes: Record<string, unknown>[] = []
    const collect = (value: unknown, depth = 0) => {
      if (depth > 5 || nodes.length > 800 || value === null || typeof value !== 'object') return
      if (Array.isArray(value)) {
        value.slice(0, 40).forEach((item) => collect(item, depth + 1))
        return
      }
      nodes.push(value as Record<string, unknown>)
      Object.values(value as Record<string, unknown>).forEach((item) => collect(item, depth + 1))
    }
    collect(data)

    for (const node of nodes) {
      const type = node['@type']
      const types = Array.isArray(type) ? type.map(String) : [String(type ?? '')]
      const isArticle = types.some((t) => /article|posting|story/i.test(t))
      if (!isArticle) continue
      result.title ??= stringField(node, 'headline') ?? stringField(node, 'name')
      result.author ??= authorName(node.author)
      result.description ??= stringField(node, 'description')
      const body = stringField(node, 'articleBody')
      if (body && looksLikeProse(body) && (!result.body || body.length > result.body.length)) {
        result.body = body
      }
    }

    if (!result.body) result.body = findLongText(data)
  }

  return result
}

// ── HTML → Markdown (cheerio DOM traversal)────────────────────────────

function isTag(node: AnyNode): node is Element {
  return node.type === 'tag'
}

function rawText(node: AnyNode): string {
  if (node.type === 'text') return node.data
  if (!('children' in node) || !node.children) return ''
  return node.children.map(rawText).join('')
}

/** Inline content: keep bold/italic/inline code/links, squeeze out extra whitespace. */
function renderInline(node: AnyNode): string {
  if (node.type === 'text') return node.data.replace(/[ \t\r\n ]+/g, ' ')
  if (!isTag(node)) return ''
  const name = node.name.toLowerCase()
  const inner = () => node.children.map(renderInline).join('')
  const flat = () => inner().replace(/[ \t ]+/g, ' ').trim()

  switch (name) {
    case 'br':
      return '\n'
    case 'strong':
    case 'b': {
      const text = flat()
      return text ? `**${text}**` : ''
    }
    case 'em':
    case 'i': {
      const text = flat()
      return text ? `_${text}_` : ''
    }
    case 'code':
      return `\`${flat()}\``
    case 'a': {
      const text = flat()
      if (!text) return ''
      const href = node.attribs?.href ?? ''
      return /^https?:\/\//i.test(href) ? `[${text}](${href})` : text
    }
    case 'img': {
      const alt = node.attribs?.alt?.trim() ?? ''
      const image = imageMarkdownOf(node.attribs ?? {}, alt)
      // An image wedged inside a paragraph still gets its own block: where the image sits in the text matters more than continuity of layout.
      if (image) return `\n\n${image}\n\n`
      return alt ? ` ${alt} ` : ' '
    }
    default:
      return inner()
  }
}

/** Turn an <img> into a markdown image; the filter rules stay consistent with collectImages. */
function imageMarkdownOf(attrs: Record<string, string>, alt: string): string | null {
  const raw =
    attrs['data-src'] ??
    attrs['data-original'] ??
    attrs['data-actualsrc'] ??
    attrs['data-lazy-src'] ??
    attrs['src'] ??
    ''
  if (!raw || raw.startsWith('data:')) return null
  if (IMAGE_SKIP.test(raw) || IMAGE_SKIP.test(attrs['class'] ?? '')) return null
  const width = Number(attrs['width'] ?? 0)
  const height = Number(attrs['height'] ?? 0)
  if ((width > 0 && width <= 64) || (height > 0 && height <= 64)) return null
  let absolute: string
  try {
    absolute = new URL(raw, imageBaseUrl).toString()
  } catch {
    return null
  }
  if (!/^https?:/i.test(absolute)) return null
  return `![${alt.replace(/[[\]]/g, '')}](${absolute})`
}

function inlineText(children: AnyNode[]): string {
  return children.map(renderInline).join('').replace(/[ \t ]+/g, ' ').trim()
}

// Sites like WeChat official accounts often use <section>/<div> as paragraphs; the body has no <p> at all.
// With no block-level child elements, treat the whole container as one paragraph; otherwise recurse block by block.
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'aside',
  'nav',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'table',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'figure',
  'figcaption',
  'form',
  'dl',
  'dt',
  'dd',
])

function hasBlockChild(node: Element): boolean {
  return node.children.some((child) => isTag(child) && BLOCK_TAGS.has(child.name.toLowerCase()))
}

function renderTable(table: Element): string {
  const rows: string[] = []
  for (const tr of table.children) {
    if (!isTag(tr) || tr.name.toLowerCase() !== 'tr') continue
    const cells = tr.children
      .filter((cell): cell is Element => isTag(cell) && /^(?:td|th)$/i.test(cell.name))
      .map((cell) => inlineText(cell.children))
      .filter((text) => text.length > 0)
    if (cells.length > 0) rows.push(cells.join(' | '))
  }
  return rows.length > 0 ? `\n\n${rows.join('\n')}\n\n` : ''
}

/** Block content: headings, paragraphs, lists, quotes, code blocks, tables. */
function renderBlock(node: AnyNode): string {
  if (node.type === 'text') return node.data.replace(/[ \t\r\n ]+/g, ' ')
  if (!isTag(node)) return ''

  const name = node.name.toLowerCase()
  switch (name) {
    case 'h1':
    case 'h2':
    case 'h3': {
      const text = inlineText(node.children)
      return text ? `\n\n## ${text}\n\n` : ''
    }
    case 'h4':
    case 'h5':
    case 'h6': {
      const text = inlineText(node.children)
      return text ? `\n\n### ${text}\n\n` : ''
    }
    case 'p': {
      const text = inlineText(node.children)
      return text ? `\n\n${text}\n\n` : ''
    }
    case 'br':
      return '\n'
    case 'li': {
      const text = inlineText(node.children)
      return text ? `\n- ${text}` : ''
    }
    case 'blockquote': {
      const text = inlineText(node.children)
      return text ? `\n\n> ${text}\n\n` : ''
    }
    case 'pre': {
      const code = rawText(node).replace(/^\n+|\n+$/g, '')
      return code ? `\n\n\`\`\`\n${code}\n\`\`\`\n\n` : ''
    }
    case 'hr':
      return '\n\n---\n\n'
    case 'img': {
      const alt = node.attribs?.alt?.trim() ?? ''
      const image = imageMarkdownOf(node.attribs ?? {}, alt)
      return image ? `\n\n${image}\n\n` : ''
    }
    case 'figcaption': {
      const text = inlineText(node.children)
      return text ? `\n\n${text}\n\n` : ''
    }
    case 'table':
      return renderTable(node)
    default: {
      if (!hasBlockChild(node)) {
        const text = inlineText(node.children)
        return text ? `\n\n${text}\n\n` : ''
      }
      return node.children.map(renderBlock).join('')
    }
  }
}

function renderMarkdown(node: AnyNode): string {
  if ('children' in node && node.children) return node.children.map(renderBlock).join('')
  return renderBlock(node)
}

// The fixed buttons/prompts around the body on WeChat official-account pages; delete only on an exact whole-line match so the body is not damaged by mistake.
const WECHAT_NOISE_LINE =
  /^(?:原创|预览时标签不可点|微信扫一扫|关注该公众号|知道了|使用小程序|取消|允许|分析|不喜欢|轻点两下取消赞|轻点两下取消在看|使用完整服务|在小说阅读器读本章|去阅读|在公众号小说中沉浸阅读|赞|在看|分享|留言|收藏|听过|视频|小程序|上一篇|下一篇)[\s，。！？、]*$/
const PUNCT_ONLY_LINE = /^[\s，。、；：！？“”‘’"'·…—\-()（）【】]+$/

function tidyMarkdown(markdown: string, wechat: boolean): string {
  const lines: string[] = []
  let inFence = false
  for (const raw of markdown.split('\n')) {
    if (/^```/.test(raw.trim())) {
      inFence = !inFence
      lines.push('```')
      continue
    }
    if (inFence) {
      lines.push(raw.replace(/\s+$/, ''))
      continue
    }
    const line = raw.replace(/[ \t ]+/g, ' ').trim()
    if (!line) {
      lines.push('')
      continue
    }
    if (wechat && (WECHAT_NOISE_LINE.test(line) || PUNCT_ONLY_LINE.test(line))) continue
    lines.push(line)
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function toPlainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^-\s+/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

// Body containers: WeChat official accounts always use #js_content, everything else picks the “most textual” of the common blocks.
const CONTENT_SELECTORS = [
  'article',
  'main',
  '[class*="article-content"]',
  '[class*="article_content"]',
  '[class*="article-body"]',
  '[class*="article_body"]',
  '[class*="post-content"]',
  '[class*="post_content"]',
  '[class*="entry-content"]',
  '[class*="entry_content"]',
  '[class*="markdown-body"]',
  '[class*="rich_media_content"]',
  // Sites that each have their own kind of body container: cnblogs, SegmentFault, The Paper, Guokr, Tencent Cloud
  '#cnblogs_post_body',
  '.postBody',
  '#post_body',
  '.blogpost-body',
  '.article-detail',
  '.detail-body',
  '.news_content',
  '.post_area',
  '#content',
  '#article',
  '#main-content',
]

const NOISE_SELECTOR = [
  'script',
  'style',
  'noscript',
  'svg',
  'iframe',
  'form',
  'template',
  'nav',
  'header',
  'footer',
  'aside',
  'button',
  'input',
  'select',
  'textarea',
  'canvas',
  'video',
  'audio',
  '[hidden]',
].join(', ')

// QR codes, toolbars, tip jars and recommendation cards at the bottom of WeChat official-account pages — all inside the body container, but none of them body text.
const WECHAT_NOISE_SELECTOR = [
  '#js_pc_qr_code',
  '.qr_code_pc',
  '.rich_media_tool',
  '#js_article_bottom_bar',
  '.rich_media_area_extra',
  '#js_comment_area',
  '.discuss_container',
  '[class*="weui-"]',
  '[style*="display:none"]',
  '[style*="visibility:hidden"]',
].join(', ')

function textLength($: CheerioDoc, node: AnyNode): number {
  return $(node).text().replace(/\s+/g, '').length
}

/** Linked text barely counts towards the body: containers heavy with nav, related-reading and footer links get pushed to the back. */
function proseLength($: CheerioDoc, node: AnyNode): number {
  const total = textLength($, node)
  const linked = $(node).find('a').text().replace(/\s+/g, '').length
  return total - linked
}

function pickBody($: CheerioDoc): { node: AnyNode; wechat: boolean } {
  const wechat = $('#js_content').first()[0]
  if (wechat && textLength($, wechat) >= 80) return { node: wechat, wechat: true }

  // GitHub repo pages: the body is the README, but <main> also holds the entire file tree and commit list,
  // so picking the “biggest block” lands on the file tree and the body turns into a run of BranchesTags… junk.
  const readme = $('article.markdown-body').first()[0] ?? $('#readme .markdown-body').first()[0]
  if (readme && textLength($, readme) >= 80) return { node: readme, wechat: false }

  let best: AnyNode | null = null
  let bestLength = 0
  for (const selector of CONTENT_SELECTORS) {
    $(selector).each((_, element) => {
      const length = proseLength($, element)
      if (length > bestLength) {
        bestLength = length
        best = element
      }
    })
  }
  if (best && bestLength >= 200) return { node: best, wechat: false }

  // When a site uses custom classes every selector is wiped out: step back and scan all block-level containers by “non-link text volume”,
  // take the largest one, then let trimMarkdownEdges peel the shell off both ends.
  let fallback: AnyNode | null = null
  let fallbackLength = 0
  $('div, section, article, td').each((_, element) => {
    const length = proseLength($, element)
    if (length > fallbackLength) {
      fallbackLength = length
      fallback = element
    }
  })
  if (fallback && fallbackLength >= 300) return { node: fallback, wechat: false }

  return { node: $('body').first()[0] ?? $.root()[0], wechat: false }
}

function stripNoise($: CheerioDoc, node: AnyNode, wechat: boolean): void {
  const scope = $(node)
  scope.find(NOISE_SELECTOR).remove()
  if (wechat) scope.find(WECHAT_NOISE_SELECTOR).remove()
}

/** Very little body but many scripts: the content is rendered by JS, or the page is only a bridge that opens another app. */
function looksScriptOnly(html: string, plainText: string): boolean {
  if (plainText.length >= 120) return false
  const scripts = html.match(/<script\b/gi)?.length ?? 0
  return scripts >= 3
}

/** WeChat and some sites first return a verification or “please open in the client” notice page instead of the body. */
function looksBlocked(html: string, plainText: string): boolean {
  if (plainText.length >= 200) return false
  if (/环境异常/.test(html) && /验证/.test(html)) return true
  if (/请在微信客户端打开|访问过于频繁|完成验证后即可继续访问/.test(html)) return true
  // Cloudflare / Akamai / other WAF block pages: the body will never be obtainable, so do not treat this as a "script shell".
  if (/__waf_verification_challenge|cf-browser-verification|Just a moment\.\.\.|Attention Required!|Checking your browser before accessing/i.test(html)) {
    return true
  }
  if (/<title[^>]*>\s*(?:403|404|验证|安全验证|Access Denied)/i.test(html)) return true
  return false
}

// Feishu / Lark applinks: addresses like /client/message/link/open are only a springboard for “pulling up the client”,
// the body lives inside the app behind login and session permissions, and the web side distributes no content at all.
function looksAppOnly(url: string, plainText: string): boolean {
  if (plainText.length >= 200) return false
  const host = hostOf(url)
  if (/^applink\.(?:feishu\.cn|larksuite\.com)$/i.test(host)) return true
  return /^(?:feishu\.cn|larksuite\.com)$/i.test(host) && /\/client\//i.test(url)
}

/** Avatars, icons, QR codes, placeholder pixels: they sit inside the body container but are not content. */
const IMAGE_SKIP = /(?:avatar|icon|logo|emoji|spacer|blank|pixel|tracker|qrcode|qr_code|badge|\/1x1|blank\.gif)/i

/**
 * Images in the body. Content on WeChat official accounts and Xiaohongshu is often “the body is just a few long images”,
 * and when no text can be extracted the image URLs are the only clue to the content (handed to OCR to supply the text).
 */
function collectImages($: CheerioDoc, node: AnyNode, baseUrl: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  $(node)
    .find('img')
    .each((_, element) => {
      const attrs = (element as Element).attribs ?? {}
      const raw =
        attrs['data-src'] ??
        attrs['data-original'] ??
        attrs['data-actualsrc'] ??
        attrs['data-lazy-src'] ??
        attrs['src'] ??
        ''
      if (!raw || raw.startsWith('data:')) return
      if (IMAGE_SKIP.test(raw) || IMAGE_SKIP.test(attrs['class'] ?? '')) return
      const width = Number(attrs['width'] ?? 0)
      const height = Number(attrs['height'] ?? 0)
      if ((width > 0 && width <= 64) || (height > 0 && height <= 64)) return
      let absolute: string
      try {
        absolute = new URL(raw, baseUrl).toString()
      } catch {
        return
      }
      if (!/^https?:/i.test(absolute) || seen.has(absolute)) return
      seen.add(absolute)
      out.push(absolute)
    })
  return out.slice(0, 24)
}

export function extractFromHtml(html: string, url: string): ExtractedArticle {
  const meta = metaMap(html)
  const embedded = embeddedArticleData(html)
  const $ = load(html)
  const domText = (selector: string) => oneLine($(selector).first().text(), 220) || null

  const rawTitle =
    domText('#activity-name')
    ?? domText('h1[itemprop="headline"]')
    ?? meta.get('og:title')
    ?? meta.get('twitter:title')
    ?? domText('title')
    ?? domText('h1')
    ?? embedded.title
  const title = rawTitle ? oneLine(decodeEntities(rawTitle.replace(/<[^>]+>/g, ' ')), 220) : null

  const description =
    meta.get('og:description') ?? meta.get('description') ?? meta.get('twitter:description') ?? embedded.description ?? null
  const siteName = meta.get('og:site_name') ?? hostOf(url)
  const author =
    meta.get('article:author')
    ?? meta.get('author')
    ?? embedded.author
    ?? domText('#js_name')
  const language = firstMatch(html, /<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i)
  const publishedAt = publishedDateOf($, meta, html)

  // After parsing, content inside noscript may end up as ordinary nodes or as one blob of raw HTML text;
  // keep a copy as-is first and clean the body afterwards, so the cleanup pass does not delete it along with everything else.
  const noscriptRaw = $('noscript')
    .map((_, element) => $(element).text())
    .get()
    .join('\n')
    .trim()

  imageBaseUrl = url
  const picked = pickBody($)
  const images = collectImages($, picked.node, url)
  stripNoise($, picked.node, picked.wechat)
  let markdown = trimMarkdownEdges(tidyMarkdown(renderMarkdown(picked.node), picked.wechat), title)
  let plainText = toPlainText(markdown)

  // When the page shell rendered no body, try three more rounds ordered from the most to the least information already available.
  if (plainText.length < 120 && noscriptRaw.length >= 200 && /<\w+/.test(noscriptRaw)) {
    const inner = load(noscriptRaw)
    const node = inner('body').first()[0] ?? inner.root()[0]
    stripNoise(inner, node, false)
    const candidate = tidyMarkdown(renderMarkdown(node), false)
    const candidateText = toPlainText(candidate)
    if (candidateText.length > plainText.length + 80) {
      markdown = candidate
      plainText = candidateText
    }
  }

  if (plainText.length < 120 && embedded.body) {
    const asHtml = embedded.body.includes('<')
      ? embedded.body
      : embedded.body.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const inner = load(asHtml)
    const node = inner('body').first()[0] ?? inner.root()[0]
    const candidate = tidyMarkdown(renderMarkdown(node), false)
    const candidateText = toPlainText(candidate)
    if (candidateText.length > plainText.length) {
      markdown = candidate
      plainText = candidateText
    }
  }

  // When only the summary is obtainable, store it anyway so at least this saved item can be found by search and roughly understood.
  if (plainText.length < 80 && description && description.length >= 60) {
    markdown = description
    plainText = description
  }

  // Placed last: the “description fallback” along the way may shove a whole block of meta text into the markdown,
  // and that text also carries prompts like “log in to open the app”.
  // Beyond the two ends there is also whole-line noise (rating bars, badges, ad labels); that kind is deleted line by line across the whole document.
  markdown = stripNoiseLines(markdown)
  const cleaned = scrubAppPrompts(markdown)
  if (cleaned !== markdown) markdown = cleaned
  // Both ends have to be peeled again after cleaning: in the first round the site icons and stats bar still sat over the start,
  // so the body container looked like “the first line is the title” and that author-name line survived.
  markdown = trimMarkdownEdges(markdown, title)
  plainText = toPlainText(markdown)

  const blocked = looksBlocked(html, plainText)

  return {
    url,
    title,
    siteName: siteName ? oneLine(siteName, 80) : null,
    author: author ? oneLine(author, 80) : null,
    publishedAt,
    description: description ? oneLine(description, 300) : null,
    language: language ? language.slice(0, 16) : null,
    markdown,
    plainText,
    images,
    scriptOnly: !blocked && looksScriptOnly(html, plainText),
    blocked,
    appOnly: looksAppOnly(url, plainText),
  }
}


/**
 * X / Twitter: the page itself is a JS shell, but the official endpoints can still supply the body.
 *
 * Syndication comes first — clean fields (body, author, time, images); oembed is the fallback,
 * it returns a blockquote fragment with “— author date” hanging off the tail of the body, which has to be stripped.
 */
async function fetchTweet(url: string, id: string): Promise<ExtractedArticle> {
  const headers = { 'User-Agent': REQUEST_UA, Accept: 'application/json' }

  try {
    const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=zh-cn&token=a`, {
      headers,
    })
    if (res.ok) {
      const data = (await res.json()) as {
        text?: string
        created_at?: string
        user?: { name?: string; screen_name?: string }
        mediaDetails?: Array<{ media_url_https?: string }>
      }
      const text = (data.text ?? '').trim()
      if (text) {
        const images = (data.mediaDetails ?? [])
          .map((item) => item.media_url_https)
          .filter((src): src is string => typeof src === 'string')
        return {
          url,
          title: oneLine(text, 200),
          siteName: 'X',
          author: data.user?.name ?? data.user?.screen_name ?? null,
          publishedAt: data.created_at ?? null,
          description: oneLine(text, 300),
          language: null,
          markdown: text,
          plainText: text,
          images,
          scriptOnly: false,
          blocked: false,
          appOnly: false,
        }
      }
    }
  } catch {
    // Fall through to oembed.
  }

  const res = await fetch(
    `https://publish.twitter.com/oembed?url=${encodeURIComponent(`https://x.com/i/status/${id}`)}&omit_script=1&dnt=true`,
    { headers },
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { author_name?: string; html?: string }
  // The “— jack (@jack) March 21, 2006” line at the end of the fragment is a footer, not body text.
  const text = htmlToMarkdownLite(data.html ?? '')
    .split('\n')
    .filter((line) => !/^\s*—/.test(line))
    .join('\n')
    .trim()
  if (!text) throw new Error('这条推文没有可读的正文')
  return {
    url,
    title: oneLine(text, 200),
    siteName: 'X',
    author: data.author_name ?? null,
    publishedAt: null,
    description: oneLine(text, 300),
    language: null,
    markdown: text,
    plainText: text,
    images: [],
    scriptOnly: false,
    blocked: false,
    appOnly: false,
  }
}

/** oembed returns a blockquote fragment, which is good enough: drop the tags, keep the text. */
function htmlToMarkdownLite(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
}

/** Reddit: the HTML is a shell; `<post>.json` yields the title, body and images. */
async function fetchReddit(url: string): Promise<ExtractedArticle> {
  const jsonUrl = `${url.replace(/[?#].*$/, '').replace(/\/$/, '')}.json`
  try {
    const res = await fetch(jsonUrl, { headers: { 'User-Agent': REQUEST_UA, Accept: 'application/json' } })
    if (res.ok) {
      const data = (await res.json()) as Array<{
        data?: { children?: Array<{ data?: Record<string, unknown> }> }
      }>
      const post = data?.[0]?.data?.children?.[0]?.data as
        | { title?: string; selftext?: string; author?: string; created_utc?: number; url?: string; preview?: unknown }
        | undefined
      const title = post?.title?.trim()
      const body = (post?.selftext ?? '').trim()
      if (title) {
        const images = redditImages(post?.preview)
        const markdown = body ? `${title}\n\n${body}` : title
        return {
          url,
          title: oneLine(title, 200),
          siteName: 'Reddit',
          author: post?.author ?? null,
          publishedAt: post?.created_utc ? new Date(post.created_utc * 1000).toISOString() : null,
          description: body ? oneLine(body, 300) : null,
          language: null,
          markdown,
          plainText: toPlainText(markdown),
          images,
          scriptOnly: false,
          blocked: false,
          appOnly: false,
        }
      }
    }
  } catch {
    // Fall through to the “blocked” result below.
  }

  // Reddit only serves a shell to logged-out users: accept that and let the UI say “the site did not let us read the body” instead of storing an empty shell.
  return {
    url,
    title: hostOf(url),
    siteName: 'Reddit',
    author: null,
    publishedAt: null,
    description: null,
    language: null,
    markdown: '',
    plainText: '',
    images: [],
    scriptOnly: false,
    blocked: true,
    appOnly: false,
  }
}

function redditImages(preview: unknown): string[] {
  const images = (preview as { images?: Array<{ source?: { url?: string } }> } | undefined)?.images
  if (!Array.isArray(images)) return []
  return images
    .map((item) => item?.source?.url)
    .filter((src): src is string => typeof src === 'string')
    .map((src) => decodeEntities(src))
    .slice(0, 12)
}

export async function fetchArticle(url: string): Promise<ExtractedArticle> {
  // The pages of these two sites carry no readable body, so go through their own data endpoints first.
  const host = hostOf(url)
  if (/(^|\.)(x\.com|twitter\.com)$/i.test(host)) {
    const id = /\/status(?:es)?\/(\d+)/.exec(url)?.[1]
    if (id) return fetchTweet(url, id)
  }
  if (/(^|\.)reddit\.com$/i.test(host)) return fetchReddit(url)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Use a real mobile Chrome UA: a UA that calls itself a bot gets a flat 403 from more than half of all sites.
        'User-Agent': REQUEST_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
    })
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const contentType = response.headers.get('content-type') ?? ''
  const raw = (await response.text()).slice(0, MAX_HTML_CHARS)

  if (!/html|xml/i.test(contentType) && !/<html|<body|<article/i.test(raw.slice(0, 2000))) {
    const text = raw.trim()
    return {
      url,
      title: hostOf(url),
      siteName: hostOf(url),
      author: null,
      publishedAt: null,
      description: text ? oneLine(text, 300) : null,
      language: null,
      markdown: text,
      plainText: text,
      images: [],
      scriptOnly: false,
      blocked: false,
      appOnly: false,
    }
  }

  return extractFromHtml(raw, url)
}
