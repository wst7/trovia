/**
 * Use an LLM to understand search intent.
 *
 * The rule layer (query.ts) covers phrasings like "yesterday", "last Wednesday" or "published in 2022",
 * but not "that one I told you about" or "the one about sleep I saved a while back". The model is good at the latter,
 * at the cost of being slow and not always stable — so:
 *
 *   1. send the model **only this one sentence**, never the saved content (which isn't needed anyway);
 *   2. the model only translates into {keywords, time range, field}; it does not produce results;
 *   3. returned dates are validated (plausible year, from < to); anything invalid falls back to the rule layer;
 *   4. the same sentence is asked about once per session and cached;
 *   5. timeout / not configured / error always falls back to the rule layer, so search never becomes unusable.
 */
import type { DateField, ParsedQuery } from './query'
import { parseQuery, timeOf } from './query'

export interface ModelDate {
  kind: 'day' | 'range' | 'year' | 'month' | 'none'
  /** YYYY-MM-DD, inclusive of that day. */
  from: string | null
  /** YYYY-MM-DD, exclusive of that day. */
  to: string | null
}

export interface ModelIntent {
  keywords: string
  field: DateField
  date: ModelDate
  /** The user-facing wording, e.g. "saved yesterday". */
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

/** Parse the JSON the model returns; drop any field that is invalid rather than failing the whole thing. */
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
    // Only a start was given: fill in a sensible end based on kind.
    const startMs = timeOf(from)!
    const endMs =
      dateKind === 'day' ? startMs + DAY_MS : dateKind === 'month' ? startMs + 31 * DAY_MS : dateKind === 'year' ? startMs + 366 * DAY_MS : null
    if (endMs) date = { kind: dateKind, from, to: dayString(new Date(endMs)) }
  }

  if (!keywords && date.kind === 'none' && !label) return null
  return { keywords, field, date, label }
}

/** The model's own wording may say "found today" — normalize it to "saved today / published yesterday". */
function labelOf(date: ModelDate, field: DateField, modelLabel: string | null, now: Date): string | null {
  const action = field === 'published' ? '发表' : '保存'
  // If the model's wording already reads naturally ("saved last month"), keep it; if the verb is inconsistent ("found today"), recompute it.
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

/** Merge the model result with the rule result: trust the model for time (it handles hard sentences better), and let the rules fill in what the model missed. */
export function mergeIntent(rule: ParsedQuery, intent: ModelIntent | null, now: Date): ParsedQuery {
  if (!intent) return rule

  // A time the rules can pin down (yesterday/last week/last month) wins: it is exact and stable, and the model only fills in phrasings the rules can't read.
  const modelHasDate = intent.date.kind !== 'none' && Boolean(intent.date.from) && Boolean(intent.date.to)
  const fromModel = rule.ranges.length === 0 && modelHasDate
  // The display wording is always computed from the dates; the model's own sentence is not trusted (small models like to stuff keywords into label).
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
  // When the time condition hasn't changed, keep the grammatical wording ("saved yesterday") instead of degrading it to "yesterday".
  const summary = fromModel ? modelLabel : rule.summary
  const onlyDate = text.replace(/[\s\p{P}]/gu, '').length === 0
  void now
  return { text, ranges, summary, onlyDate }
}

export type Completer = (messages: unknown[], maxTokens: number) => Promise<string>

/**
 * Phrasings that clearly carry a time clue but for which the model returned no range.
 * Small models miss these easily, so in that case ask once more and explicitly demand a range; it costs only one extra call.
 */
const FUZZY_TIME = /(前阵子|前段时间|上次|上回|那天|这些天|这几天|前几天|前两天|最近一阵|有一阵|早些时候)/

/** Ask the model for the intent; any exception returns null and the caller falls back to the rule layer. */
export async function detectIntent(query: string, now: Date, complete: Completer): Promise<ModelIntent | null> {
  try {
    const messages: unknown[] = [
      { role: 'system', content: intentSystemPrompt(now) },
      { role: 'user', content: query },
    ]
    const first = parseIntentJson(await complete(messages, 220), now)
    if (first && first.date.kind !== 'none') return first
    if (!FUZZY_TIME.test(query)) return first

    // Second attempt: state plainly that a range is required, still JSON.
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

// The same sentence is asked only once per session: repeated searches shouldn't cost repeatedly or give inconsistent answers.
const cache = new Map<string, ParsedQuery>()
// The same sentence can be triggered twice at once (a search plus an automatic refresh after local data changes),
// so the requests are merged to avoid double billing and inconsistency.
const inflight = new Map<string, Promise<ParsedQuery>>()
const CACHE_LIMIT = 60

function cacheKey(query: string, now: Date): string {
  return `${dayString(now)}|${query}`
}

/** Search entry point: rules first, then the model corrects it if one is configured. */
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

/** Tests only: clear the cache. */
export function clearIntentCache(): void {
  cache.clear()
  inflight.clear()
}
