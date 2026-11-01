import type { ParseStatus, RelatedItem, SourceType } from './index'

export type StatusTone = 'accent' | 'success' | 'warning' | 'error'

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  web: '普通网页',
  wechat: '微信公众号',
  github: 'GitHub',
  youtube: 'YouTube',
  bilibili: 'Bilibili',
  twitter: 'X / Twitter',
}

// 状态文案映射（契约第 7 节）
export const STATUS_TEXT: Record<ParseStatus, string> = {
  pending: '等待整理',
  fetching: '读取网页中',
  parsing: '整理正文中',
  analyzing: '提取重点中',
  indexing: '建立索引中',
  completed: '已完成整理',
  partial: '部分内容无法读取',
  failed: '暂时无法解析',
}

/**
 * 失败也分原因：被站点拦下和网络不通，用户能做的事完全不同，
 * 所以不能都显示成「暂时无法解析」。
 */
export function statusText(status: ParseStatus, errorCode?: string | null): string {
  if (status === 'failed') {
    switch (errorCode) {
      case 'FETCH_BLOCKED':
        return '站点拒绝读取'
      case 'APP_ONLY_LINK':
        return '需在 App 内打开'
      case 'CONTENT_SCRIPT_ONLY':
        return '正文需脚本渲染'
      case 'FETCH_FAILED':
        return '没能连上站点'
      default:
        return STATUS_TEXT.failed
    }
  }
  if (status === 'partial' && errorCode === 'PARSE_INCOMPLETE') return '只读到部分内容'
  return STATUS_TEXT[status]
}

export const RELATION_LABELS: Record<string, string> = {
  semantic_similarity: '内容相近',
  shared_topic: '相同主题',
  same_source: '同一来源',
}

// 后端可能按不同关系类型重复返回同一篇文档；同一 document_id 只保留分数最高的一条。
export function dedupeRelated(items: RelatedItem[]): RelatedItem[] {
  const byId = new Map<string, RelatedItem>()
  for (const item of items) {
    const existing = byId.get(item.document_id)
    if (!existing || item.score > existing.score) byId.set(item.document_id, item)
  }
  return [...byId.values()]
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, '')
}

// 站点名与域名相同时只显示一次，避免 “example.org · example.org”。
export function sourceLabel(url: string, siteName: string | null | undefined, fallback: string): string {
  const domain = domainOf(url)
  if (!siteName) return `${domain} · ${fallback}`
  const sameHost =
    normalizeHost(siteName) === normalizeHost(domain) ||
    normalizeHost(siteName) === normalizeHost(domainOf(`https://${siteName}`))
  return sameHost ? domain : `${domain} · ${siteName}`
}

export function statusTone(status: ParseStatus): StatusTone {
  switch (status) {
    case 'completed':
      return 'success'
    case 'partial':
      return 'warning'
    case 'failed':
      return 'error'
    default:
      return 'accent'
  }
}

export function isTerminalStatus(status: ParseStatus): boolean {
  return status === 'completed' || status === 'partial' || status === 'failed'
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 列表里用相对时间，减少需要读取的数字。 */
export function formatRelativeDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'

  const now = new Date()
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate())
  const days = Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86_400_000)

  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  if (days < 30) return `${Math.floor(days / 7)} 周前`
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// 分享按钮常常会附带标题、描述和短链，而不是纯 URL；保存时取第一段 http(s) 链接。
const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"'“”‘’（）\[\]{}，。；：！？、]+/i
const TRAILING_URL_PUNCT_RE = /[.,;:!?，。；：！？、"'”’]+$/g

/** 从纯 URL 或分享文字中提取第一个可用的 http(s) URL。 */
export function extractHttpUrl(value: string): string | null {
  const match = value.match(URL_IN_TEXT_RE)
  if (!match) return null
  let candidate = match[0].replace(TRAILING_URL_PUNCT_RE, '')
  // 分享/Markdown 文本常在链接外再包一层括号；只裁掉不配对的尾部括号。
  while (candidate.endsWith(')') && candidate.split(')').length > candidate.split('(').length) {
    candidate = candidate.slice(0, -1)
  }
  return isValidHttpUrl(candidate) ? candidate : null
}

export function errorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string' && (e as Error).message) {
    return (e as Error).message
  }
  return fallback
}
