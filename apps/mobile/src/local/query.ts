/**
 * 把「人话」解析成检索条件。
 *
 * 用户不会按字段输入。他会说：
 *   找找昨天的
 *   我前天收藏的那篇讲睡眠的
 *   上个月保存的关于焦虑的文章
 *   发表于 10 月 31 日的文章
 *   最近三天存的东西
 *
 * 这个模块只做一件事：认出里面的时间表达和「收藏 / 发表」的意图，
 * 把剩下的文字留作关键词。不联网、不调模型，纯本地正则 + 日期算术，
 * 所以可以单测，也不会因为模型抽风给出奇怪的区间。
 */
export type DateField = 'saved' | 'published'

export interface DateRange {
  field: DateField
  /** 毫秒时间戳，左闭右开。 */
  from: number
  to: number
  /** 给人看的说法，如「昨天」「10月31日」「最近三天」。 */
  label: string
  /** 只有单日范围才有，用于「昨天保存的」这类文案与精确排序。 */
  day: string | null
}

export interface ParsedQuery {
  /** 去掉时间词与口头语之后剩下的描述，交给关键词匹配。 */
  text: string
  ranges: DateRange[]
  /** 结果头部的人话解释，例如「昨天保存的」。没有时间条件时为 null。 */
  summary: string | null
  /** 只有时间条件、没有关键词（「找找昨天的」）。 */
  onlyDate: boolean
}

const DAY_MS = 86_400_000

const WEEKDAY_INDEX: Record<string, number> = {
  一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6,
}

const CN_DIGIT: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

/** 把「十」「十二」「二十三」「三」这类中文数字转成数值。 */
export function cnNumber(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return Number(text)
  if (text === '几') return 7 // 「最近几天」按一周算，够用且不会太宽
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

/** 周一为一周之首，符合中文习惯。 */
function startOfWeek(at: Date): Date {
  const day = startOfDay(at)
  const weekday = (day.getDay() + 6) % 7
  return addDays(day, -weekday)
}

function dayLabel(at: Date): string {
  return `${at.getMonth() + 1}月${at.getDate()}日`
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

/** 「发表于 X 日」和「X 日收藏的」是两种不同的问题，靠这几个词分辨。 */
const PUBLISHED_HINT = /(发表|发布|刊于|刊登|出版|写于|原文发于|上线于)/
const SAVED_HINT = /(收藏|保存|存了|存的|收了|加入|收藏的)/

export interface ParseOptions {
  /** 注入"现在"，测试里固定时间。 */
  now?: Date
}

export function parseQuery(input: string, options: ParseOptions = {}): ParsedQuery {
  const now = options.now ?? new Date()
  const field: DateField = PUBLISHED_HINT.test(input) && !SAVED_HINT.test(input) ? 'published' : 'saved'

  // 全角数字、中文句号统一成半角，后面的正则只处理一种写法。
  let rest = input
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')

  const ranges: DateRange[] = []
  /** 匹配到的片段从查询里抹掉，剩下的就是关键词；一次匹配产出一个区间。 */
  const take = (pattern: RegExp, build: (groups: string[]) => DateRange | null): void => {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    rest = rest.replace(new RegExp(pattern.source, flags), (...args: unknown[]) => {
      const groups = args.slice(0, -2) as string[]
      const range = build(groups)
      // 没识别成时间条件就原样留下，别把「2022年」从关键词里吃掉。
      if (!range) return groups[0]
      ranges.push(range)
      return ' '
    })
  }

  // ---- 绝对日期：2026-10-31 / 2026年10月31日 / 10月31日 / 10月 ----
  take(/(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*[日号]?/, (m) => {
    const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return Number.isNaN(at.getTime()) ? null : rangeOfDay(at, dayLabel(at), field)
  })

  take(/(\d{4})\s*年\s*(\d{1,2})\s*月/, (m) => {
    const year = Number(m[1])
    const month = Number(m[2]) - 1
    return rangeOfSpan(new Date(year, month, 1), new Date(year, month + 1, 1), `${year}年${month + 1}月`, field)
  })

  take(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/, (m) => {
    const month = Number(m[1]) - 1
    const day = Number(m[2])
    // 没说年份：取今年；如果落在未来，说明说的是去年。
    let at = new Date(now.getFullYear(), month, day)
    if (startOfDay(at) > startOfDay(now)) at = new Date(now.getFullYear() - 1, month, day)
    return Number.isNaN(at.getTime()) ? null : rangeOfDay(at, dayLabel(at), field)
  })

  take(/(\d{1,2})\s*月份?/, (m) => {
    const month = Number(m[1]) - 1
    let year = now.getFullYear()
    if (month > now.getMonth()) year -= 1
    const first = new Date(year, month, 1)
    return rangeOfSpan(first, new Date(year, month + 1, 1), `${year}年${month + 1}月`, field)
  })

  take(/(\d{4})\s*年(?!\s*\d)/, (m) => {
    // 裸年份只有在句子里看得出是「找某段时间的东西」时才算时间条件；
    // 否则「2022年最值得买的手机」会被误当成发表时间的过滤条件。
    if (!PUBLISHED_HINT.test(input) && !SAVED_HINT.test(input)) return null
    const year = Number(m[1])
    return rangeOfSpan(new Date(year, 0, 1), new Date(year + 1, 0, 1), `${year}年`, field)
  })

  // ---- 相对日期词 ----
  const relative: Record<string, number> = { 大前天: -3, 前天: -2, 昨天: -1, 昨日: -1, 昨儿: -1, 今天: 0, 今日: 0, 当天: 0 }
  take(/(大前天|前天|昨天|昨日|昨儿|今天|今日|当天)/, (m) => {
    const at = addDays(now, relative[m[1]] ?? 0)
    const label = m[1].startsWith('昨') ? '昨天' : m[1].startsWith('前') ? '前天' : m[1] === '大前天' ? '大前天' : '今天'
    return rangeOfDay(at, label, field)
  })

  take(/(\d{1,3}|[一二两三四五六七八九十]{1,3})\s*天(?:以)?前/, (m) => {
    const offset = cnNumber(m[1])
    if (!offset) return null
    const at = addDays(now, -offset)
    return rangeOfDay(at, `${offset}天前`, field)
  })

  take(/(?:最近|近|过去)\s*(\d{1,3}|[一二两三四五六七八九十]{1,3}|几)\s*[天日]/, (m) => {
    const span = cnNumber(m[1])
    if (!span) return null
    return rangeOfSpan(addDays(now, -(span - 1)), addDays(now, 1), `最近${span}天`, field)
  })

  take(/(?:最近|近|过去)\s*(?:一|1)?\s*(?:个)?\s*(?:周|星期|礼拜)/, () => {
    return rangeOfSpan(addDays(now, -6), addDays(now, 1), '最近七天', field)
  })

  take(/(?:最近|近|过去)\s*(?:一|1)?\s*(?:个)?\s*月/, () => {
    return rangeOfSpan(addDays(now, -29), addDays(now, 1), '最近三十天', field)
  })

  take(/(?:最近|近|过去)\s*(?:一|1)?\s*年/, () => {
    return rangeOfSpan(addDays(now, -364), addDays(now, 1), '最近一年', field)
  })

  // ---- 周 / 月 / 年 ----
  // 「周末」单列，否则会被当成「这一周」。
  take(/(上|这|本)?\s*(?:个)?\s*(?:周|星期|礼拜)末/, (m) => {
    const base = startOfWeek(now)
    const start = m[1] === '上' ? addDays(base, -2) : addDays(base, 5) // 周六
    return rangeOfSpan(start, addDays(start, 2), m[1] === '上' ? '上周末' : '本周末', field)
  })

  // 带限定词的一整周：「上周」「这个星期」「本礼拜」。
  take(/(上上|上|这|本)\s*(?:个)?\s*(?:周|星期|礼拜)([一二三四五六日天])?/, (m) => {
    const thisWeek = startOfWeek(now)
    const weekStart = m[1] === '上' ? addDays(thisWeek, -7) : m[1] === '上上' ? addDays(thisWeek, -14) : thisWeek

    if (m[2]) {
      const at = addDays(weekStart, WEEKDAY_INDEX[m[2]] ?? 0)
      const label = m[1] === '上' ? `上周${m[2]}` : m[1] === '上上' ? `上上周${m[2]}` : `周${m[2]}`
      return rangeOfDay(at, label, field)
    }

    const label = m[1] === '上' ? '上周' : m[1] === '上上' ? '上上周' : '本周'
    return rangeOfSpan(weekStart, addDays(weekStart, 7), label, field)
  })

  // 光说星期几：「周三」「星期天」= 本周那天。
  take(/(?:周|星期|礼拜)([一二三四五六日天])/, (m) => {
    const at = addDays(startOfWeek(now), WEEKDAY_INDEX[m[1]] ?? 0)
    return rangeOfDay(at, `周${m[1]}`, field)
  })

  // 「上个月」这类必须带限定词，避免把「月亮」里的「月」吃掉。
  take(/(上上|上|这|本)\s*个?月(?!\s*\d)/, (m) => {
    const offset = m[1] === '上' ? -1 : m[1] === '上上' ? -2 : 0
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const label = m[1] === '上' ? '上个月' : m[1] === '上上' ? '上上个月' : '本月'
    return rangeOfSpan(first, new Date(first.getFullYear(), first.getMonth() + 1, 1), label, field)
  })

  take(/(前年|去年|今年|本年)/, (m) => {
    const year = m[1] === '前年' ? now.getFullYear() - 2 : m[1] === '去年' ? now.getFullYear() - 1 : now.getFullYear()
    return rangeOfSpan(new Date(year, 0, 1), new Date(year + 1, 0, 1), `${year}年`, field)
  })

  // ---- 英文习惯说法（顺手支持，不额外宣传） ----
  take(/\b(today|yesterday|last week|this week|last month|this month)\b/i, (m) => {
    const word = m[1].toLowerCase()
    if (word === 'today' || word === 'yesterday') {
      const at = addDays(now, word === 'today' ? 0 : -1)
      return rangeOfDay(at, word === 'today' ? '今天' : '昨天', field)
    }
    if (word.includes('week')) {
      const start = word.startsWith('last') ? addDays(startOfWeek(now), -7) : startOfWeek(now)
      return rangeOfSpan(start, addDays(start, 7), word.startsWith('last') ? '上周' : '本周', field)
    }
    const offset = word.startsWith('last') ? -1 : 0
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    return rangeOfSpan(first, new Date(first.getFullYear(), first.getMonth() + 1, 1), word.startsWith('last') ? '上个月' : '本月', field)
  })

  // ---- 剩下的是关键词 ----
  const text = rest
    .replace(/[，。！？、,.!?;；:："'“”‘’（）()[\]【】《》<>]/g, ' ')
    .replace(/(帮我|帮忙|找一下|找找|寻找|看看|查查|一下|我记得|记得|好像|大概|可能是|应该是|之前|以前|看过|看到过|收藏过的|收藏了|收藏的|收藏|保存的|保存|存过的|存的|存了|发表的|发布了|发表|那篇|这篇|一篇|一个|那个|这个|关于|讲的|说的|内容|文章|视频|链接|东西|里|中|有|吗|呢|吧|啊|我|在|的)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const onlyDate = text.replace(/[\s\p{P}]/gu, '').length === 0
  const summary = ranges.length > 0 ? `${ranges[0].label}${field === 'published' ? '发表' : '保存'}的` : null

  return { text, ranges, summary, onlyDate }
}

/** 判断某个时间戳是否落在任一区间里；返回命中的那个区间，便于显示原因。 */
export function matchRange(at: number | null, ranges: DateRange[]): DateRange | null {
  if (at === null || Number.isNaN(at)) return null
  for (const range of ranges) {
    if (at >= range.from && at < range.to) return range
  }
  return null
}

/** 解析库里存的时间字符串；日期只有年月日时按本地零点处理。 */
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
