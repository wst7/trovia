/**
 * Cleanup of the site shell around both ends of the body (at the markdown level).
 *
 * Why not do it in the DOM: the body container is often “container > wrapper > [nav, body, footer]”,
 * so the direct children are all wrappers and nothing can be peeled; markdown is flat, so peeling it is both simpler and more reliable.
 *
 * Only the two ends are peeled, and only lines that obviously look like shell:
 *   - high share of links (nav, related reading)
 *   - matches boilerplate wording (published on / report / article copyright / editor-in-charge / follow the official account…)
 *   - repeats the title (title echo)
 *   - extremely short with no punctuation (section name, author name, tag cloud)
 * Stop as soon as a line looks like body text. Better to leave a little noise than to delete the body.
 */

const BOILERPLATE = /(发布于|发表于|编辑于|举报|阅读原文|特别声明|免责声明|本文参与|本文版权|版权属于|禁止转载|责任编辑|来源[:：]|作者[:：]|侵权|联系删除|扫码|关注公众号|分享自|同步曝光|APP 内打开|打开 App|前往查看|专栏|收录于|本文作者|阅读原文|分享到|相关阅读|推荐阅读|登录打开应用|在应用中查看|使用应用查看|Open in app|Copy link|Copy Markdown|Sign in to comment|Already have an account|participants?\b|Labels\b|发帖\b)/

/** Lines with no punctuation that are also very short: section names, author bylines, tags. */
function looksLikeLabel(line: string): boolean {
  const compact = line.replace(/\s+/g, '')
  if (compact.length === 0) return true
  if (/[，。！？、；：""'']/.test(compact)) return false
  return compact.length <= 8
}

/** Link-text share: nav bars and recommendation slots are mostly links. */
function linkRatio(line: string): number {
  const compact = line.replace(/\s+/g, '')
  if (compact.length === 0) return 1
  let linked = 0
  for (const match of line.matchAll(/\[([^\]]*)\]\([^)]+\)/g)) linked += (match[1] ?? '').replace(/\s+/g, '').length
  return linked / compact.length
}

function isShellLine(line: string, title: string | null, side: 'head' | 'tail'): boolean {
  const trimmed = line.trim()
  if (!trimmed) return true
  if (trimmed.startsWith('```')) return false

  // List items, headings and quotes can all carry body text, so strip the marker before judging.
  const isHeading = /^#{1,6}\s/.test(trimmed)
  const bare = trimmed.replace(/^(?:#{1,6}\s+|[-*]\s+|>\s*)/, '').trim()
  if (!bare) return true

  if (bare.startsWith('![')) {
    // Images at the start are basically always the site logo or the author avatar; inline images in the body are not stripped (this only takes effect at the head).
    return side === 'head'
  }

  const bareCompact = bare.replace(/\s+/g, '')
  if (title) {
    const titleCompact = title.replace(/\s+/g, '')
    if (bareCompact === titleCompact) return true
    // The title echo often carries only the first half (the site name was cut off)
    if (bareCompact.length >= 6 && titleCompact.startsWith(bareCompact)) return true
  }

  // The length must be counted after the URLs are removed, otherwise a single link stretches a short line out long.
  const visible = bare.replace(/\]\([^)]*\)/g, ']').replace(/!\[[^\]]*\]/g, '')
  if (BOILERPLATE.test(bare) && visible.length <= 120) return true
  if (linkRatio(bare) > 0.5 && visible.length <= 80) return true
  // A subheading (such as “Introduction”) is short, but it is body structure and must not be peeled off as a label.
  if (!isHeading && looksLikeLabel(bare)) return true
  return false
}

/**
 * The “only visible after opening the app” prompts.
 * Pages like X, Zhihu and Xiaohongshu squeeze the whole run of copy into one line, so line-level cleanup does not work; it can only be wiped out repeatedly at the text level.
 */
const APP_PROMPT = /(登录打开应用|在应用中查看此帖子|使用应用查看所有评论并发现更多帖子|打开 X\b|Open in app|发帖\s*)/g

/** GitHub / forum pages, where the body is mixed with the copy of action buttons (the whole run squeezed into one line; line-level cleanup does not work). */
const UI_LABEL = /(Copy link|Copy Markdown|Sign in to comment|Already have an account\?|join this conversation on GitHub|\b\d+ participants?\b|\bLabels\b|\bCLA\b|\bSigned\b)/g

export function scrubAppPrompts(markdown: string): string {
  // These prompts are often wrapped in a “launch the app” link (log in[open app](…launch_app…)),
  // so strip the link shell first, then clean by text.
  const unwrapped = markdown.replace(
    /\[([^\]]*)\]\([^)]*(?:launch_app|app_store|open\.x|intent|openapp)[^)]*\)/gi,
    '$1',
  )
  return unwrapped.replace(UI_LABEL, ' ')
    .replace(APP_PROMPT, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Those “ad shell” lines in the middle of the body.
 *
 * This can only be done at line level, and it must be high-confidence: these lines are whole-line noise in themselves (rating bars, badges,
 * ad labels), not “a sentence that mentions advertising”. So there is both a word whitelist and a
 * length cap; past the length cap it is body text with context, so keep it.
 */
const ADGEBRA_LINE =
  /^(?:advertising|advertisement|sponsored(?: by\b.*)?|scanned by\b.*|.*\bsafe web\b.*|share(?: this)?|tweet|copy link|read more|see more|show more|\d+\s*(?:comments?|reviews?|views?)|★★★★★.*)$/i

/** Site stats bar and badge copy: `reads 5.7k`, `saved 15`, `likes 3`, and the “original” mark at the tail of a title. */
const SITE_STAT_LINE =
  /^(?:(?:阅读量|阅读数|浏览|浏览量|收藏|点赞|评论|分享)\s*[:：]?\s*[\d.]+\s*[kw万]?|\d+\s*(?:赞|评论|收藏)|码龄\s*\d+\s*年|关注|已关注|粉丝\s*\d+)$|\s原创$/

/** The site's own icon/avatar images: they carry no information in the body, they only take up a large blank block. */
const SITE_ICON_IMAGE =
  /^!\[[^\]]*\]\(([^)\s]+)\)$/

function isIconImage(line: string): boolean {
  const match = SITE_ICON_IMAGE.exec(line.trim())
  if (!match) return false
  const url = match[1] ?? ''
  return /(?:\/release\/|\/mobile\/img\/|\/static\/(?:img|images)\/(?:icon|logo|sprite)|avatar|\bicon[-_]|\blogo[-_]|placeholder)/i.test(
    url,
  )
}

/** The site's own recommendation-bar echo: `latest recommended article published 2026-10-12 14:14:03`. */
const SITE_RECO_LINE = /^(?:最新推荐|推荐阅读|相关推荐|热门推荐|猜你喜欢).{0,40}(?:发布|更新)/

/** Rating bar + review count: the `★★★★★ 4.8/5 · 55,196 reviews` kind. */
const RATING_LINE = /^[★☆]{3,}\s*[\d.]+\s*\/\s*5(?:\s*[·|]?\s*[\d,]+\s*(?:reviews?|ratings?|votes?))?/i

function isAdgebraLine(line: string): boolean {
  // The link shell keeps only its text: [Scanned by Norton](…) → Scanned by Norton
  const bare = line
    .replace(/^(?:#{1,6}\s+|[-*]\s+|>\s*)/, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .trim()
  if (!bare || bare.length > 60) return false
  const compact = bare.replace(/\s+/g, ' ')
  return (
    RATING_LINE.test(compact) ||
    ADGEBRA_LINE.test(compact) ||
    SITE_RECO_LINE.test(compact) ||
    SITE_STAT_LINE.test(compact)
  )
}

/** Delete high-confidence ad/badge lines across the whole document (the two-end cleanup is left to trimMarkdownEdges). */
export function stripNoiseLines(markdown: string): string {
  const lines = markdown.split('\n')
  const dropped = new Array<boolean>(lines.length).fill(false)

  let inFence = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^```/.test(line.trim())) {
      inFence = !inFence
      continue
    }
    if (!inFence && (isAdgebraLine(line) || isIconImage(line))) dropped[i] = true
  }

  // The author name sits right against “8 years of coding / follow”: that line cannot be told apart from body text by itself,
  // but the combination “short, no punctuation, followed by site info” is certain enough.
  for (let i = 0; i + 1 < lines.length; i += 1) {
    if (dropped[i] || !dropped[i + 1]) continue
    const bare = lines[i].trim()
    if (!bare || bare.length > 12) continue
    if (/[，。！？、；：,.!?;:]/.test(bare)) continue
    if (isAdgebraLine(bare) || isIconImage(bare)) continue
    dropped[i] = true
  }

  const out = lines.filter((_, index) => !dropped[index])
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function trimMarkdownEdges(markdown: string, title: string | null): string {
  const lines = markdown.split('\n')
  if (lines.length === 0) return markdown

  let head = 0
  let strippedHead = 0
  while (head < lines.length && strippedHead < 40) {
    if (!isShellLine(lines[head], title, 'head')) break
    head += 1
    strippedHead += 1
  }

  let tail = lines.length - 1
  let strippedTail = 0
  while (tail > head && strippedTail < 40) {
    if (!isShellLine(lines[tail], title, 'tail')) break
    tail -= 1
    strippedTail += 1
  }

  // When the whole document is judged to be shell, leave it alone: better to keep noise than to delete everything.
  if (head > tail) return markdown

  return lines
    .slice(head, tail + 1)
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
}
