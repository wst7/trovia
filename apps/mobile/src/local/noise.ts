/**
 * 正文两头的站点外壳清理（markdown 层）。
 *
 * 为什么不在 DOM 里做：正文容器常常是「容器 > 包裹层 > [导航, 正文, 页脚]」，
 * 直接子节点全是包裹层，剥不动；而 markdown 是扁平的，剥起来简单也可靠。
 *
 * 只剥两头、只剥明显像外壳的行：
 *   - 链接占比高（导航、相关阅读）
 *   - 命中样板语（发布于/举报/本文版权/责任编辑/关注公众号…）
 *   - 和标题重复（标题回显）
 *   - 极短且没有标点（栏目名、作者名、标签云）
 * 一旦遇到像正文的行就停。宁可留一点噪声，也不能把正文删掉。
 */

const BOILERPLATE = /(发布于|发表于|编辑于|举报|阅读原文|特别声明|免责声明|本文参与|本文版权|版权属于|禁止转载|责任编辑|来源[:：]|作者[:：]|侵权|联系删除|扫码|关注公众号|分享自|同步曝光|APP 内打开|打开 App|前往查看|专栏|收录于|本文作者|阅读原文|分享到|相关阅读|推荐阅读|登录打开应用|在应用中查看|使用应用查看|Open in app|Copy link|Copy Markdown|Sign in to comment|Already have an account|participants?\b|Labels\b|发帖\b)/

/** 没有标点、又很短的行：栏目名、作者署名、标签。 */
function looksLikeLabel(line: string): boolean {
  const compact = line.replace(/\s+/g, '')
  if (compact.length === 0) return true
  if (/[，。！？、；：""'']/.test(compact)) return false
  return compact.length <= 8
}

/** 链接文字占比：导航、推荐位里大半是链接。 */
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

  // 列表项、标题、引用都可能承载正文，判断前先把标记去掉。
  const isHeading = /^#{1,6}\s/.test(trimmed)
  const bare = trimmed.replace(/^(?:#{1,6}\s+|[-*]\s+|>\s*)/, '').trim()
  if (!bare) return true

  if (bare.startsWith('![')) {
    // 开头的图基本都是站点 logo 或作者头像；正文里的配图不会被剥（只在头部生效）。
    return side === 'head'
  }

  const bareCompact = bare.replace(/\s+/g, '')
  if (title) {
    const titleCompact = title.replace(/\s+/g, '')
    if (bareCompact === titleCompact) return true
    // 标题回显常常只写前半段（站点名被截掉）
    if (bareCompact.length >= 6 && titleCompact.startsWith(bareCompact)) return true
  }

  // 长度要按「去掉 URL 之后」的字数算，否则一条链接就能把短行撑得很长。
  const visible = bare.replace(/\]\([^)]*\)/g, ']').replace(/!\[[^\]]*\]/g, '')
  if (BOILERPLATE.test(bare) && visible.length <= 120) return true
  if (linkRatio(bare) > 0.5 && visible.length <= 80) return true
  // 小标题（如「前言」）虽然短，但它是正文结构，不能当标签剥掉。
  if (!isHeading && looksLikeLabel(bare)) return true
  return false
}

/**
 * 「打开 App 才看得到」的提示语。
 * X、知乎、小红书这类页面会把整段文案挤成一行，按行清理无效，只能在文本层反复抹掉。
 */
const APP_PROMPT = /(登录打开应用|在应用中查看此帖子|使用应用查看所有评论并发现更多帖子|打开 X\b|Open in app|发帖\s*)/g

/** GitHub / 论坛这类页面，正文里混着操作按钮的文案（整段挤成一行，按行清理无效）。 */
const UI_LABEL = /(Copy link|Copy Markdown|Sign in to comment|Already have an account\?|join this conversation on GitHub|\b\d+ participants?\b|\bLabels\b|\bCLA\b|\bSigned\b)/g

export function scrubAppPrompts(markdown: string): string {
  // 这些提示语常常被包在「唤起 App」的链接里（登录[打开应用](…launch_app…)），
  // 先把链接壳去掉，再按文字清理。
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
 * 正文中间那类「广告壳」行。
 *
 * 只能在行级做，而且必须高置信：这些行本身就是整行噪声（评分条、徽章、
 * 广告标签），而不是「句子里提到了 advertising」。所以既有白名单词，也有
 * 长度上限，长度超了就说明是有上下文的正文，留着。
 */
const ADGEBRA_LINE =
  /^(?:advertising|advertisement|sponsored(?: by\b.*)?|scanned by\b.*|.*\bsafe web\b.*|share(?: this)?|tweet|copy link|read more|see more|show more|\d+\s*(?:comments?|reviews?|views?)|★★★★★.*)$/i

/** 站点的统计条与徽章文案：`阅读量5.7k`、`收藏 15`、`点赞 3`、标题尾巴的「原创」。 */
const SITE_STAT_LINE =
  /^(?:(?:阅读量|阅读数|浏览|浏览量|收藏|点赞|评论|分享)\s*[:：]?\s*[\d.]+\s*[kw万]?|\d+\s*(?:赞|评论|收藏)|码龄\s*\d+\s*年|关注|已关注|粉丝\s*\d+)$|\s原创$/

/** 站点自己的图标/头像图片：它们在正文里没有信息量，只会占一大块空白。 */
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

/** 站点自己的推荐栏回显：`最新推荐文章于 2026-10-12 14:14:03 发布`。 */
const SITE_RECO_LINE = /^(?:最新推荐|推荐阅读|相关推荐|热门推荐|猜你喜欢).{0,40}(?:发布|更新)/

/** 评分条 + 评价数：`★★★★★ 4.8/5 · 55,196 reviews` 这类。 */
const RATING_LINE = /^[★☆]{3,}\s*[\d.]+\s*\/\s*5(?:\s*[·|]?\s*[\d,]+\s*(?:reviews?|ratings?|votes?))?/i

function isAdgebraLine(line: string): boolean {
  // 链接壳只留文字：[Scanned by Norton](…) → Scanned by Norton
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

/** 整篇范围内删掉高置信的广告/徽章行（两头的清理交给 trimMarkdownEdges）。 */
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

  // 作者名紧挨着「码龄 8 年 / 关注」：那一行本身没法和正文区分，
  // 但「短、无标点、后面跟着站点信息」这个组合足够确定。
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

  // 整篇都被判成外壳时不动手：宁可留噪声，也不能删空。
  if (head > tail) return markdown

  return lines
    .slice(head, tail + 1)
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
}
