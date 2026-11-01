import { load } from 'cheerio/slim'
import type { AnyNode, Element } from 'domhandler'

import { publishedDateOf } from './published'
import { hostOf, oneLine } from './util'

/**
 * 在手机上抓取并抽取正文。
 *
 * 用 cheerio/slim（htmlparser2，纯 JS，不要 DOM 环境）解析 HTML：
 * 先按选择器挑正文容器，再去掉脚本/导航/按钮，最后把结构转成 Markdown。
 * 比正则切片可靠：嵌套标签、畸形 HTML、公众号的富文本都能正确走完。
 * 页面把正文藏在脚本 JSON 里时，还会再按 JSON-LD / Next / Nuxt 状态兜底。
 */
export interface ExtractedArticle {
  url: string
  title: string | null
  siteName: string | null
  author: string | null
  /** 原文发表日期（YYYY-MM-DD）。抓不到就是 null —— 不用收藏时间冒充。 */
  publishedAt: string | null
  description: string | null
  language: string | null
  markdown: string
  plainText: string
  /** 正文里出现过的图片（绝对地址，已去重、去图标）。图多字少时正文可能就是这些图。 */
  images: string[]
  /** 页面只是脚本外壳（内容靠 JS 渲染，或只是打开另一个 App 的桥），正文抓不到。 */
  scriptOnly: boolean
  /** 页面要求验证 / 登录，正文拿不到。 */
  blocked: boolean
  /** 这只是一张“打开飞书 / Lark 客户端”的跳转页，内容本身不在网页里。 */
  appOnly: boolean
}

type CheerioDoc = ReturnType<typeof load>

const MAX_HTML_CHARS = 2_000_000
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
 * 很多站点（Next.js / Nuxt / 各家 CMS）其实把正文整段塞在 <script> 的 JSON 里，
 * 只是页面外壳由 JS 渲染。这里把这些“已经跟着 HTML 发过来”的正文挖出来，
 * 网页自己没渲染出文字时也能存下内容。
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

/** 在任意 JSON 结构里找最长的一段正文；宁缺毋滥，太短或不像文章的字符串直接跳过。 */
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

    // JSON-LD 的 Article 节点字段最规整，先按它取元信息。
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

// ── HTML → Markdown（基于 cheerio 的 DOM 遍历）────────────────────────────

function isTag(node: AnyNode): node is Element {
  return node.type === 'tag'
}

function rawText(node: AnyNode): string {
  if (node.type === 'text') return node.data
  if (!('children' in node) || !node.children) return ''
  return node.children.map(rawText).join('')
}

/** 行内内容：保留粗体/斜体/行内代码/链接，压掉多余空白。 */
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
      const alt = node.attribs?.alt?.trim()
      return alt ? ` ${alt} ` : ' '
    }
    default:
      return inner()
  }
}

function inlineText(children: AnyNode[]): string {
  return children.map(renderInline).join('').replace(/[ \t ]+/g, ' ').trim()
}

// 公众号这类站点常拿 <section>/<div> 当段落，正文里根本没有 <p>。
// 没有块级子元素时，把整个容器当成一段，否则逐块递归。
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

/** 块级内容：标题、段落、列表、引用、代码块、表格。 */
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
      const alt = node.attribs?.alt?.trim()
      return alt ? `\n\n${alt}\n\n` : ''
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

// 公众号页面正文周围的固定按钮/提示，逐行完全匹配才删，避免误伤正文。
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
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^-\s+/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

// 正文容器：公众号固定 #js_content，其余按常见块挑“文字最多”的一个。
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

// 公众号底部的二维码、工具栏、赞赏、推荐卡片——都在正文容器里，但不是正文。
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

/** 链接文字几乎不计入正文：导航、相关阅读、页脚链接多的容器会被排到后面。 */
function proseLength($: CheerioDoc, node: AnyNode): number {
  const total = textLength($, node)
  const linked = $(node).find('a').text().replace(/\s+/g, '').length
  return total - linked
}

function pickBody($: CheerioDoc): { node: AnyNode; wechat: boolean } {
  const wechat = $('#js_content').first()[0]
  if (wechat && textLength($, wechat) >= 80) return { node: wechat, wechat: true }

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

  return { node: $('body').first()[0] ?? $.root()[0], wechat: false }
}

function stripNoise($: CheerioDoc, node: AnyNode, wechat: boolean): void {
  const scope = $(node)
  scope.find(NOISE_SELECTOR).remove()
  if (wechat) scope.find(WECHAT_NOISE_SELECTOR).remove()
}

/** 正文极少、脚本却很多：内容由 JS 渲染，或者页面只是打开另一个 App 的桥。 */
function looksScriptOnly(html: string, plainText: string): boolean {
  if (plainText.length >= 120) return false
  const scripts = html.match(/<script\b/gi)?.length ?? 0
  return scripts >= 3
}

/** 微信/部分站点会先返回验证或“请在客户端打开”的提示页，而不是正文。 */
function looksBlocked(html: string, plainText: string): boolean {
  if (plainText.length >= 200) return false
  if (/环境异常/.test(html) && /验证/.test(html)) return true
  if (/请在微信客户端打开|访问过于频繁|完成验证后即可继续访问/.test(html)) return true
  // Cloudflare / Akamai / 各家 WAF 的拦截页：正文永远拿不到，别把它当成"脚本外壳"。
  if (/__waf_verification_challenge|cf-browser-verification|Just a moment\.\.\.|Attention Required!|Checking your browser before accessing/i.test(html)) {
    return true
  }
  if (/<title[^>]*>\s*(?:403|404|验证|安全验证|Access Denied)/i.test(html)) return true
  return false
}

// 飞书 / Lark 的 applink：/client/message/link/open 这类地址只是“拉起客户端”的跳板，
// 正文在 App 内、需要登录和会话权限，网页端不分发任何内容。
function looksAppOnly(url: string, plainText: string): boolean {
  if (plainText.length >= 200) return false
  const host = hostOf(url)
  if (/^applink\.(?:feishu\.cn|larksuite\.com)$/i.test(host)) return true
  return /^(?:feishu\.cn|larksuite\.com)$/i.test(host) && /\/client\//i.test(url)
}

/** 头像、图标、二维码、占位像素：它们在正文容器里，但不是内容。 */
const IMAGE_SKIP = /(?:avatar|icon|logo|emoji|spacer|blank|pixel|tracker|qrcode|qr_code|badge|\/1x1|blank\.gif)/i

/**
 * 正文里的图片。公众号和小红书这类内容常常「正文就是几张长图」，
 * 抽不到文字时，图片地址本身就是唯一的内容线索（交给 OCR 补文字）。
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

  // noscript 里的内容在解析后可能被当成普通节点，也可能是一整段原始 HTML 文本；
  // 先原样留一份，再清理正文，避免清理时把它一起删掉。
  const noscriptRaw = $('noscript')
    .map((_, element) => $(element).text())
    .get()
    .join('\n')
    .trim()

  const picked = pickBody($)
  const images = collectImages($, picked.node, url)
  stripNoise($, picked.node, picked.wechat)
  let markdown = tidyMarkdown(renderMarkdown(picked.node), picked.wechat)
  let plainText = toPlainText(markdown)

  // 页面外壳没渲染出正文时，按“已有信息量”从大到小再试三轮。
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

  // 只有摘要可拿时也存下来，至少让这条收藏能被搜到、能看懂大概。
  if (plainText.length < 80 && description && description.length >= 60) {
    markdown = description
    plainText = description
  }

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

export async function fetchArticle(url: string): Promise<ExtractedArticle> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // 用一个真实的移动 Chrome UA：自称 bot 的 UA 会被一大半站点直接 403。
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
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
