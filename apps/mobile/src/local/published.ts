/**
 * 原文发表日期。
 *
 * 只在页面自己声明了的情况下采信：meta、JSON-LD 的 datePublished、<time datetime>、
 * microdata 的 itemprop="datePublished"。拿不到就返回 null —— 用抓取时间冒充
 * 会让「发表于某天」给出假答案，比没有更糟。
 */
import { load } from 'cheerio/slim'

type CheerioDoc = ReturnType<typeof load>

function firstMatch(html: string, pattern: RegExp): string | null {
  const match = pattern.exec(html)
  return match?.[1] ? match[1].trim() : null
}

const PUBLISHED_META_KEYS = [
  'article:published_time',
  'og:published_time',
  'datepublished',
  'article:published',
  'publishdate',
  'pubdate',
  'dcterms.created',
  'dc.date',
  'date',
]

function validDay(year: number, month: number, day: number): string | null {
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null
  if (year < 1990 || year > new Date().getFullYear() + 1) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function normalizeDay(raw: string | null | undefined): string | null {
  if (!raw) return null
  const text = String(raw).trim()
  if (!text || text.length > 48) return null

  const direct = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/.exec(text)
  if (direct) return validDay(Number(direct[1]), Number(direct[2]), Number(direct[3]))

  // Unix 时间戳：10 位是秒，13 位是毫秒。
  if (/^\d{10}$|^\d{13}$/.test(text)) {
    const at = new Date(text.length === 10 ? Number(text) * 1000 : Number(text))
    return Number.isNaN(at.getTime()) ? null : validDay(at.getFullYear(), at.getMonth() + 1, at.getDate())
  }

  const parsed = Date.parse(text)
  if (Number.isNaN(parsed)) return null
  const at = new Date(parsed)
  return validDay(at.getFullYear(), at.getMonth() + 1, at.getDate())
}

export function publishedDateOf($: CheerioDoc, meta: Map<string, string>, html: string): string | null {
  const candidates: (string | null | undefined)[] = PUBLISHED_META_KEYS.map((key) => meta.get(key))
  candidates.push($('time[datetime]').first().attr('datetime'))
  candidates.push($('[itemprop="datePublished"]').first().attr('content'))
  candidates.push($('[itemprop="datePublished"]').first().text())
  candidates.push(firstMatch(html, /"datePublished"\s*:\s*"([^"]+)"/i))
  candidates.push(firstMatch(html, /"publish(?:ed)?(?:At|Time|Date)"\s*:\s*"([^"]+)"/i))

  for (const raw of candidates) {
    const day = normalizeDay(raw)
    if (day) return day
  }
  return null
}
