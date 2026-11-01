/**
 * 用大模型理解搜索意图。
 *
 * 规则层（query.ts）能覆盖「昨天」「上周三」「2022年发表」这些写法，
 * 但「上次跟你说的那个」「前阵子存的讲睡眠的」它认不出来。模型擅长后者，
 * 代价是慢、且结果不总是稳定 —— 所以：
 *
 *   1. 只把**这一句话**发给模型，不发收藏内容（本来也没必要）；
 *   2. 模型只负责翻译成 {关键词, 时间区间, 字段}，不负责给结果；
 *   3. 返回的日期要过校验（合理年份、from < to），不合规就退回规则层；
 *   4. 同一次会话里同一句话只问一次，缓存住；
 *   5. 超时 / 未配置 / 报错一律退回规则层，不让搜索变不可用。
 */
import type { DateField, ParsedQuery } from './query'
import { parseQuery, timeOf } from './query'

export interface ModelDate {
  kind: 'day' | 'range' | 'year' | 'month' | 'none'
  /** YYYY-MM-DD，含当天。 */
  from: string | null
  /** YYYY-MM-DD，不含当天。 */
  to: string | null
}

export interface ModelIntent {
  keywords: string
  field: DateField
  date: ModelDate
  /** 给用户看的说法，例如「昨天保存的」。 */
  label: string | null
}

const DAY_MS = 86_400_000
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function addDaysStr(from: Date, days: number): string {
  return dayString(new Date(from.getFullYear(), from.getMonth(), from.getDate() + days))
}

function example(
  query: string,
  keywords: string,
  kind: string,
  from: string | null,
  to: string | null,
  label: string | null,
  field: DateField = 'saved',
): string {
  return `  输入「${query}」→ ${JSON.stringify({ keywords, field, date: { kind, from, to }, label })}`
}

function dayString(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

export function intentSystemPrompt(now: Date): string {
  return [
    '你是个人收藏库的检索意图解析器。把用户的一句话翻译成一个 JSON 对象，只输出 JSON，不要解释，不要代码块。',
    '字段：',
    '  keywords: 要检索的字面关键词，删掉时间词和口头语（"我记得""帮我找"等），没有就空字符串',
    '  field: "published" 表示用户问的是原文发表时间，"saved" 表示收藏/保存时间；默认 "saved"',
    '  date: {kind: "day"|"range"|"year"|"month"|"none", from: "YYYY-MM-DD"（含）, to: "YYYY-MM-DD"（不含）}',
    '  label: 一句不超过 12 字的中文说明，例如 "昨天保存的" / "2022年发表的"',
    `今天是 ${dayString(now)}（${WEEKDAY_NAMES[now.getDay()]}）。相对时间要换算成具体日期；`,
    '口语时间要照常换算：「前两天」「前几天」「前阵子」「上次」「这些天」「那天」都算时间条件，按上下文取最合理的一段；',
    '确实没有时间线索时才用 "none"。不要编造关键词。',
    '示例：',
    example('找找昨天的', '', 'day', addDaysStr(now, -1), dayString(now), '昨天保存的'),
    example('上周发表的关于焦虑的文章', '焦虑', 'range', addDaysStr(now, -13), addDaysStr(now, -6), '上周发表的', 'published'),
    example('延时队列', '延时队列', 'none', null, null, null),
  ].join('\n')
}

function validDay(text: unknown, now: Date): string | null {
  if (typeof text !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim())
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (year < 1990 || year > now.getFullYear() + 1) return null
  return `${match[1]}-${match[2]}-${match[3]}`
}

/** 解析模型返回的 JSON；字段不合规就丢弃那一部分，不整体失败。 */
export function parseIntentJson(raw: string, now: Date): ModelIntent | null {
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }

  const keywords = typeof parsed.keywords === 'string' ? parsed.keywords.trim() : ''
  const field: DateField = parsed.field === 'published' ? 'published' : 'saved'
  const label = typeof parsed.label === 'string' ? parsed.label.trim().slice(0, 24) : null

  const rawDate = (parsed.date ?? {}) as Record<string, unknown>
  const kind = rawDate.kind
  const dateKind: ModelDate['kind'] =
    kind === 'day' || kind === 'range' || kind === 'year' || kind === 'month' ? kind : 'none'
  const from = validDay(rawDate.from, now)
  const to = validDay(rawDate.to, now)

  let date: ModelDate = { kind: 'none', from: null, to: null }
  if (dateKind !== 'none' && from && to) {
    date = timeOf(to)! > timeOf(from)! ? { kind: dateKind, from, to } : { kind: 'none', from: null, to: null }
  } else if (dateKind !== 'none' && from && !to) {
    // 只给了起点：按 kind 补一个合理的终点。
    const startMs = timeOf(from)!
    const endMs =
      dateKind === 'day' ? startMs + DAY_MS : dateKind === 'month' ? startMs + 31 * DAY_MS : dateKind === 'year' ? startMs + 366 * DAY_MS : null
    if (endMs) date = { kind: dateKind, from, to: dayString(new Date(endMs)) }
  }

  if (!keywords && date.kind === 'none' && !label) return null
  return { keywords, field, date, label }
}

/** 模型自带的说法可能写成「今天找到的」——统一成「今天保存的 / 昨天发表的」。 */
function labelOf(date: ModelDate, field: DateField, modelLabel: string | null, now: Date): string | null {
  const action = field === 'published' ? '发表' : '保存'
  // 模型自己写得像人话（「上个月存的」）就留着；写成「今天找到的」这种动词不一致的就重算。
  if (modelLabel && /(保存|收藏|存的|存了|发表|发布)/.test(modelLabel) && !/(找到|搜到)/.test(modelLabel)) {
    return modelLabel
  }
  if (!date.from || !date.to) return modelLabel

  const fromMs = timeOf(date.from)!
  const toMs = timeOf(date.to)!
  const span = toMs - fromMs
  const from = new Date(fromMs)
  const lastDay = new Date(toMs - 1)

  if (Math.abs(span - DAY_MS) < 1000) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const daysAgo = Math.round((today - fromMs) / DAY_MS)
    const name = daysAgo === 0 ? '今天' : daysAgo === 1 ? '昨天' : daysAgo === 2 ? '前天' : `${from.getMonth() + 1}月${from.getDate()}日`
    return `${name}${action}的`
  }
  if (span <= 8 * DAY_MS) return `最近${Math.round(span / DAY_MS)}天${action}的`
  const wholeYear =
    from.getMonth() === 0 && from.getDate() === 1 && toMs === new Date(from.getFullYear() + 1, 0, 1).getTime()
  if (wholeYear) return `${from.getFullYear()}年${action}的`
  const wholeMonth =
    from.getDate() === 1 && toMs === new Date(from.getFullYear(), from.getMonth() + 1, 1).getTime()
  if (wholeMonth) return `${from.getFullYear()}年${from.getMonth() + 1}月${action}的`
  return `${from.getMonth() + 1}月${from.getDate()}日到${lastDay.getMonth() + 1}月${lastDay.getDate()}日${action}的`
}

/** 模型结果与规则结果合并：时间以模型为准（它更懂难句），规则补齐模型漏掉的部分。 */
export function mergeIntent(rule: ParsedQuery, intent: ModelIntent | null, now: Date): ParsedQuery {
  if (!intent) return rule

  // 规则能确定的时间（昨天/上周/上个月）优先：它精确且稳定，模型只补规则认不出的说法。
  const modelHasDate = intent.date.kind !== 'none' && Boolean(intent.date.from) && Boolean(intent.date.to)
  const fromModel = rule.ranges.length === 0 && modelHasDate
  // 显示文案一律按日期算，不采信模型自己写的句子（小模型爱把关键词塞进 label）。
  const modelLabel = fromModel ? labelOf(intent.date, intent.field, null, now) : null
  const ranges = fromModel
    ? [
        {
          field: intent.field,
          from: timeOf(intent.date.from!)!,
          to: timeOf(intent.date.to!)!,
          label: modelLabel ?? '',
          day: intent.date.kind === 'day' ? intent.date.from : null,
        },
      ]
    : rule.ranges

  const text = intent.keywords || rule.text
  // 时间条件没变时就沿用语法的说法（「昨天保存的」），不要降级成「昨天」。
  const summary = fromModel ? modelLabel : rule.summary
  const onlyDate = text.replace(/[\s\p{P}]/gu, '').length === 0
  void now
  return { text, ranges, summary, onlyDate }
}

export type Completer = (messages: unknown[], maxTokens: number) => Promise<string>

/**
 * 句子里明显带时间线索、但模型没给区间的说法。
 * 小模型容易漏，这种情况再问一次并点名要求给区间，代价只有一次调用。
 */
const FUZZY_TIME = /(前阵子|前段时间|上次|上回|那天|这些天|这几天|前几天|前两天|最近一阵|有一阵|早些时候)/

/** 问模型要意图；任何异常都返回 null，由调用方退回规则层。 */
export async function detectIntent(query: string, now: Date, complete: Completer): Promise<ModelIntent | null> {
  try {
    const messages: unknown[] = [
      { role: 'system', content: intentSystemPrompt(now) },
      { role: 'user', content: query },
    ]
    const first = parseIntentJson(await complete(messages, 220), now)
    if (first && first.date.kind !== 'none') return first
    if (!FUZZY_TIME.test(query)) return first

    // 第二次：把「必须给出区间」说清楚，仍然要 JSON。
    const retry = parseIntentJson(
      await complete(
        [
          ...messages,
          { role: 'assistant', content: JSON.stringify(first ?? {}) },
          { role: 'user', content: '这句话里有时间线索（例如「前阵子」「上次」），请给出最合理的一段具体日期区间，只输出 JSON。' },
        ],
        220,
      ),
      now,
    )
    return retry && retry.date.kind !== 'none' ? retry : first
  } catch {
    return null
  }
}

// 同一句话在一次会话里只问一次：反复搜索不该反复计费，也不该出现前后不一致。
const cache = new Map<string, ParsedQuery>()
// 同一句话可能被同时触发两次（搜索 + 本地数据变化后的自动刷新），
// 合并成一个请求，避免重复计费与前后不一致。
const inflight = new Map<string, Promise<ParsedQuery>>()
const CACHE_LIMIT = 60

function cacheKey(query: string, now: Date): string {
  return `${dayString(now)}|${query}`
}

/** 搜索入口：规则先行，配置了模型再用模型修正。 */
export async function resolveIntent(
  query: string,
  options: { now?: Date; complete?: Completer | null } = {},
): Promise<ParsedQuery> {
  const now = options.now ?? new Date()
  const rule = parseQuery(query, { now })
  const complete = options.complete ?? null
  if (!complete) return rule

  const key = cacheKey(query, now)
  const hit = cache.get(key)
  if (hit) return hit
  const pending = inflight.get(key)
  if (pending) return pending

  const request = detectIntent(query, now, complete)
    .then((intent) => mergeIntent(rule, intent, now))
    .then((merged) => {
      if (cache.size >= CACHE_LIMIT) cache.clear()
      cache.set(key, merged)
      inflight.delete(key)
      return merged
    })
  inflight.set(key, request)
  return request
}

/** 仅测试用：清空缓存。 */
export function clearIntentCache(): void {
  cache.clear()
  inflight.clear()
}
