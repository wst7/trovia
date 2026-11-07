/**
 * Turn plain human language into search conditions.
 *
 * Users do not type by field. They say things like:
 *   "find yesterday's"
 *   "the one I saved the day before yesterday about sleep"
 *   "articles about anxiety saved last month"
 *   "articles published on October 31"
 *   "stuff saved in the last three days"
 *
 * This module does one thing: recognise the time expressions in it and the saved / published intent,
 * leaving the remaining text as keywords. No network, no model calls, just local regexes + date arithmetic,
 * so it can be unit-tested, and it never produces odd ranges because a model misbehaved.
 */
import { getLocale, t } from '../i18n'

export type DateField = 'saved' | 'published'

export interface DateRange {
  field: DateField
  /** Millisecond timestamps, start inclusive and end exclusive. */
  from: number
  to: number
  /** A human-readable label such as "yesterday", "October 31" or "the last three days". */
  label: string
  /** Only present for single-day ranges, used for wording like "saved yesterday" and for exact ordering. */
  day: string | null
}

export interface ParsedQuery {
  /** The description left after removing time words and filler phrases, handed to keyword matching. */
  text: string
  ranges: DateRange[]
  /** The plain-language explanation at the top of the results, e.g. "saved yesterday". Null when there is no time condition. */
  summary: string | null
  /** A time condition only, with no keyword ("find yesterday's"). */
  onlyDate: boolean
}

const DAY_MS = 86_400_000

const WEEKDAY_INDEX: Record<string, number> = {
  一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6,
}

const CN_DIGIT: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

/** Convert Chinese numerals such as the characters for ten, twelve, twenty-three or three into numbers. */
export function cnNumber(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return Number(text)
  if (text === '几') return 7 // "the last few days" counts as a week: enough, and not too wide
  if (text.length === 1) return CN_DIGIT[text] ?? null
  const [tens, ones] = text.split('十')
  if (!text.includes('十')) return null
  const tensValue = tens ? (CN_DIGIT[tens] ?? null) : 1
  const onesValue = ones ? (CN_DIGIT[ones] ?? null) : 0
  if (tensValue === null || onesValue === null) return null
  return tensValue * 10 + onesValue
}

function startOfDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate())
}

function addDays(at: Date, days: number): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + days)
}

/** Monday is the start of the week, following the Chinese convention. */
function startOfWeek(at: Date): Date {
  const day = startOfDay(at)
  const weekday = (day.getDay() + 6) % 7
  return addDays(day, -weekday)
}

const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日']
const WEEKDAY_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** For phrasings like "Wednesday" and "last Wednesday", each language builds its own sentence. */
function weekdayLabel(index: number, prefix: '' | 'last' | 'lastlast' = ''): string {
  if (getLocale() === 'en') {
    const lead = prefix === 'last' ? 'last ' : prefix === 'lastlast' ? 'two weeks ago ' : ''
    return `${lead}${WEEKDAY_EN[index] ?? ''}`
  }
  const lead = prefix === 'last' ? '上' : prefix === 'lastlast' ? '上上' : ''
  return `${lead}周${WEEKDAY_CN[index] ?? ''}`
}

function dayLabel(at: Date): string {
  return t('query.monthDay', { month: at.getMonth() + 1, day: at.getDate() })
}

function rangeOfDay(at: Date, label: string, field: DateField): DateRange {
  const start = startOfDay(at)
  return {
    field,
    from: start.getTime(),
    to: addDays(start, 1).getTime(),
    label,
    day: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
  }
}

function rangeOfSpan(from: Date, to: Date, label: string, field: DateField): DateRange {
  return { field, from: from.getTime(), to: to.getTime(), label, day: null }
}

/** "published on day X" and "saved on day X" are two different questions, told apart by these words. */
const PUBLISHED_HINT = /(发表|发布|刊于|刊登|出版|写于|原文发于|上线于)/
const SAVED_HINT = /(收藏|保存|存了|存的|收了|加入|收藏的)/

export interface ParseOptions {
  /** Inject "now"; tests pin it to a fixed time. */
  now?: Date
}

export function parseQuery(input: string, options: ParseOptions = {}): ParsedQuery {
  const now = options.now ?? new Date()
  const field: DateField = PUBLISHED_HINT.test(input) && !SAVED_HINT.test(input) ? 'published' : 'saved'

  // Full-width digits and the Chinese full stop are normalised to half-width, so the regexes further down only handle one form.
  let rest = input
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')

  const ranges: DateRange[] = []
  /** Erase the matched fragment from the query so that what remains is the keyword; each match yields one range. */
  const take = (pattern: RegExp, build: (groups: string[]) => DateRange | null): void => {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    rest = rest.replace(new RegExp(pattern.source, flags), (...args: unknown[]) => {
      const groups = args.slice(0, -2) as string[]
      const range = build(groups)
      // If it does not parse as a time condition, keep it as is; do not eat the year out of the keywords.
      if (!range) return groups[0]
      ranges.push(range)
      return ' '
    })
  }

  // ---- Absolute dates: 2026-10-31 / 2026<year>10<month>31<day> / 10<month>31<day> / 10<month> ----
  take(/(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*[日号]?/, (m) => {
    const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return Number.isNaN(at.getTime()) ? null : rangeOfDay(at, dayLabel(at), field)
  })

  take(/(\d{4})\s*年\s*(\d{1,2})\s*月/, (m) => {
    const year = Number(m[1])
    const month = Number(m[2]) - 1
    return rangeOfSpan(
      new Date(year, month, 1),
      new Date(year, month + 1, 1),
      t('query.yearMonth', { year, month: month + 1 }),
      field,
    )
  })

  take(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/, (m) => {
    const month = Number(m[1]) - 1
    const day = Number(m[2])
    // No year given: take this year; if that lands in the future, they meant last year.
    let at = new Date(now.getFullYear(), month, day)
    if (startOfDay(at) > startOfDay(now)) at = new Date(now.getFullYear() - 1, month, day)
    return Number.isNaN(at.getTime()) ? null : rangeOfDay(at, dayLabel(at), field)
  })

  take(/(\d{1,2})\s*月份?/, (m) => {
    const month = Number(m[1]) - 1
    let year = now.getFullYear()
    if (month > now.getMonth()) year -= 1
    const first = new Date(year, month, 1)
    return rangeOfSpan(
      first,
      new Date(year, month + 1, 1),
      t('query.yearMonth', { year, month: month + 1 }),
      field,
    )
  })

  take(/(\d{4})\s*年(?!\s*\d)/, (m) => {
    // A bare year counts as a time condition only when the sentence clearly asks for things from a period;
    // otherwise a topic phrase containing "in 2022" would be mistaken for a published-date filter.
    if (!PUBLISHED_HINT.test(input) && !SAVED_HINT.test(input)) return null
    const year = Number(m[1])
    return rangeOfSpan(new Date(year, 0, 1), new Date(year + 1, 0, 1), t('query.year', { year }), field)
  })

  // ---- Relative date words ----
  const relative: Record<string, number> = { 大前天: -3, 前天: -2, 昨天: -1, 昨日: -1, 昨儿: -1, 今天: 0, 今日: 0, 当天: 0 }
  take(/(大前天|前天|昨天|昨日|昨儿|今天|今日|当天)/, (m) => {
    const at = addDays(now, relative[m[1]] ?? 0)
    const label = m[1].startsWith('昨')
      ? t('query.yesterday')
      : m[1] === '大前天'
        ? t('query.threeDaysAgo')
        : m[1].startsWith('前')
          ? t('query.twoDaysAgo')
          : t('query.today')
    return rangeOfDay(at, label, field)
  })

  take(/(\d{1,3}|[一二两三四五六七八九十]{1,3})\s*天(?:以)?前/, (m) => {
    const offset = cnNumber(m[1])
    if (!offset) return null
    const at = addDays(now, -offset)
    return rangeOfDay(at, t('query.daysAgo', { count: offset }), field)
  })

  take(/(?:最近|近|过去)\s*(\d{1,3}|[一二两三四五六七八九十]{1,3}|几)\s*[天日]/, (m) => {
    const span = cnNumber(m[1])
    if (!span) return null
    return rangeOfSpan(addDays(now, -(span - 1)), addDays(now, 1), t('query.lastNDays', { count: span }), field)
  })

  take(/(?:最近|近|过去)\s*(?:一|1)?\s*(?:个)?\s*(?:周|星期|礼拜)/, () => {
    return rangeOfSpan(addDays(now, -6), addDays(now, 1), t('query.last7days'), field)
  })

  take(/(?:最近|近|过去)\s*(?:一|1)?\s*(?:个)?\s*月/, () => {
    return rangeOfSpan(addDays(now, -29), addDays(now, 1), t('query.last30days'), field)
  })

  take(/(?:最近|近|过去)\s*(?:一|1)?\s*年/, () => {
    return rangeOfSpan(addDays(now, -364), addDays(now, 1), t('query.lastYear'), field)
  })

  // ---- Week / month / year ----
  // "Weekend" is handled separately, otherwise it would be read as "this week".
  take(/(上|这|本)?\s*(?:个)?\s*(?:周|星期|礼拜)末/, (m) => {
    const base = startOfWeek(now)
    const start = m[1] === '上' ? addDays(base, -2) : addDays(base, 5) // Saturday
    return rangeOfSpan(
      start,
      addDays(start, 2),
      m[1] === '上' ? t('query.lastWeekend') : t('query.thisWeekend'),
      field,
    )
  })

  // A whole week with a qualifier: "last week", "this week" and their variants.
  take(/(上上|上|这|本)\s*(?:个)?\s*(?:周|星期|礼拜)([一二三四五六日天])?/, (m) => {
    const thisWeek = startOfWeek(now)
    const weekStart = m[1] === '上' ? addDays(thisWeek, -7) : m[1] === '上上' ? addDays(thisWeek, -14) : thisWeek

    if (m[2]) {
      const at = addDays(weekStart, WEEKDAY_INDEX[m[2]] ?? 0)
      const prefix = m[1] === '上' ? 'last' : m[1] === '上上' ? 'lastlast' : ''
      return rangeOfDay(at, weekdayLabel(WEEKDAY_INDEX[m[2]] ?? 0, prefix), field)
    }

    const label =
      m[1] === '上'
        ? t('query.lastWeek')
        : m[1] === '上上'
          ? t('query.twoWeeksAgo')
          : t('query.thisWeek')
    return rangeOfSpan(weekStart, addDays(weekStart, 7), label, field)
  })

  // Just a weekday: "Wednesday", "Sunday" = that day of the current week.
  take(/(?:周|星期|礼拜)([一二三四五六日天])/, (m) => {
    const at = addDays(startOfWeek(now), WEEKDAY_INDEX[m[1]] ?? 0)
    return rangeOfDay(at, weekdayLabel(WEEKDAY_INDEX[m[1]] ?? 0), field)
  })

  // Phrases like "last month" must carry a qualifier, so the month character inside the word for "moon" is not eaten.
  take(/(上上|上|这|本)\s*个?月(?!\s*\d)/, (m) => {
    const offset = m[1] === '上' ? -1 : m[1] === '上上' ? -2 : 0
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const label =
      m[1] === '上'
        ? t('query.lastMonth')
        : m[1] === '上上'
          ? t('query.twoMonthsAgo')
          : t('query.thisMonth')
    return rangeOfSpan(first, new Date(first.getFullYear(), first.getMonth() + 1, 1), label, field)
  })

  take(/(前年|去年|今年|本年)/, (m) => {
    const year = m[1] === '前年' ? now.getFullYear() - 2 : m[1] === '去年' ? now.getFullYear() - 1 : now.getFullYear()
    return rangeOfSpan(new Date(year, 0, 1), new Date(year + 1, 0, 1), t('query.year', { year }), field)
  })

  // ---- Idiomatic English expressions (supported in passing, not advertised) ----
  take(
    /\b(day before yesterday|today|yesterday|last week|this week|last month|this month|last year|this year)\b/i,
    (m) => {
      const word = m[1].toLowerCase()
      if (word === 'today' || word === 'yesterday' || word === 'day before yesterday') {
        const offset = word === 'today' ? 0 : word === 'yesterday' ? -1 : -2
        const label =
          offset === 0 ? t('query.today') : offset === -1 ? t('query.yesterday') : t('query.twoDaysAgo')
        return rangeOfDay(addDays(now, offset), label, field)
      }
      if (word.includes('week')) {
        const start = word.startsWith('last') ? addDays(startOfWeek(now), -7) : startOfWeek(now)
        return rangeOfSpan(
          start,
          addDays(start, 7),
          word.startsWith('last') ? t('query.lastWeek') : t('query.thisWeek'),
          field,
        )
      }
      if (word.includes('year')) {
        const year = word.startsWith('last') ? now.getFullYear() - 1 : now.getFullYear()
        return rangeOfSpan(new Date(year, 0, 1), new Date(year + 1, 0, 1), t('query.year', { year }), field)
      }
      const offset = word.startsWith('last') ? -1 : 0
      const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
      return rangeOfSpan(
        first,
        new Date(first.getFullYear(), first.getMonth() + 1, 1),
        word.startsWith('last') ? t('query.lastMonth') : t('query.thisMonth'),
        field,
      )
    },
  )

  // ---- What remains is the keyword ----
  const text = rest
    .replace(/[，。！？、,.!?;；:："'“”‘’（）()[\]【】《》<>]/g, ' ')
    .replace(/(帮我|帮忙|找一下|找找|寻找|看看|查查|一下|我记得|记得|好像|大概|可能是|应该是|之前|以前|看过|看到过|收藏过的|收藏了|收藏的|收藏|保存的|保存|存过的|存的|存了|发表的|发布了|发表|那篇|这篇|一篇|一个|那个|这个|关于|讲的|说的|内容|文章|视频|链接|东西|里|中|有|吗|呢|吧|啊|我|在|的)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const onlyDate = text.replace(/[\s\p{P}]/gu, '').length === 0
  const summary =
    ranges.length > 0
      ? t(field === 'published' ? 'query.publishedOf' : 'query.savedOf', { label: ranges[0].label })
      : null

  return { text, ranges, summary, onlyDate }
}

/** Tell whether a timestamp falls inside any range; return the range that matched so the reason can be shown. */
export function matchRange(at: number | null, ranges: DateRange[]): DateRange | null {
  if (at === null || Number.isNaN(at)) return null
  for (const range of ranges) {
    if (at >= range.from && at < range.to) return range
  }
  return null
}

/** Parse a time string stored in the DB; a date with only year-month-day is treated as local midnight. */
export function timeOf(value: string | null | undefined): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split('-').map(Number)
    return new Date(year, month - 1, day).getTime()
  }
  const parsed = Date.parse(trimmed)
  return Number.isNaN(parsed) ? null : parsed
}

export const DAY_MS_EXPORT = DAY_MS
