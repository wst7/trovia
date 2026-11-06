/**
 * 「问大模型」：把用户的问题交给模型，模型通过工具在本地库里找，再给答复。
 *
 * 关键约束：
 *   - 只能靠工具拿到的东西回答，工具查不到就说「没有」；
 *   - 工具全在本地执行，正文不外传（只有被读到的片段会进上下文）；
 *   - 最多 4 轮、最多 8 次工具调用，防止小模型来回打转；
 *   - 依赖可注入，测试里不用真网络。
 */
import type { ChatMessage, ChatStep } from './llm'
import { parseToolArguments } from './tool-args'
import type { ToolRunResult } from './assistant-tools'

export interface ToolStep {
  name: string
  args: Record<string, unknown>
  /** 这一步拿到几条结果；界面上用来交代「查了什么」。 */
  hits: number
  ok: boolean
}

export interface Citation {
  id: string
  title: string | null
  site: string | null
  savedAt: string | null
}

export interface AssistantResult {
  answer: string
  citations: Citation[]
  steps: ToolStep[]
}

export interface AssistantDeps {
  /** 走一轮模型。注入进来是为了让这一层不依赖 expo/网络，测试里能直接跑。 */
  step: (messages: ChatMessage[]) => Promise<ChatStep>
  run?: (name: string, args: Record<string, unknown>) => Promise<ToolRunResult>
  onStep?: (step: ToolStep) => void
  maxRounds?: number
  maxToolCalls?: number
}

const SYSTEM_PROMPT = `你在用户的本地收藏（Trovia）里找答案。

规则：
- 只能根据工具返回的内容回答，不要凭常识补齐；工具没查到就直说「收藏里没有」。
- 先给结论，再给一两句依据；总长不超过 200 字。
- 每个结论后面用 [1][2] 标注来自第几条工具结果，编号按出现的先后。
- 需要细节时用 read_document 读正文，不要一次读很多篇。
- 不要臆造文章标题或链接。`

/** 从工具返回的 JSON 里抠出可以做成引用卡片的条目。 */
export function citationsFrom(content: string, previous: Citation[]): Citation[] {
  // 除了 id，同标题同站点也只留一条：同一篇被重复收藏时不至于排成一列。
  const seen = new Set(previous.map((item) => item.id))
  const seenTitles = new Set(previous.map((item) => `${item.title ?? ''}|${item.site ?? ''}`))
  const next = [...previous]
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return previous
  }
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id : null
    if (!id || seen.has(id)) continue
    const title = typeof row.title === 'string' ? row.title : null
    const site = typeof row.site === 'string' ? row.site : null
    const key = `${title ?? ''}|${site ?? ''}`
    if (title && seenTitles.has(key)) continue
    seen.add(id)
    if (title) seenTitles.add(key)
    next.push({
      id,
      title,
      site,
      savedAt: typeof row.saved_at === 'string' ? row.saved_at : null,
    })
  }
  return next
}

export async function askLibrary(question: string, deps: AssistantDeps): Promise<AssistantResult> {
  const trimmed = question.trim()
  if (!trimmed) throw new Error('问题是空的')

  const step = deps.step
  const run = deps.run ?? (async () => ({ content: '{"error":"没有接入工具执行器"}', ids: [] }))
  const maxRounds = deps.maxRounds ?? 4
  const maxToolCalls = deps.maxToolCalls ?? 8

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: trimmed },
  ]

  let citations: Citation[] = []
  const steps: ToolStep[] = []
  let calls = 0

  for (let round = 0; round < maxRounds; round += 1) {
    const reply = await step(messages)
    if (reply.toolCalls.length === 0) {
      return { answer: (reply.content ?? '').trim() || '没有找到相关内容。', citations, steps }
    }

    messages.push({ role: 'assistant', content: reply.content ?? null, tool_calls: reply.toolCalls })

    for (const call of reply.toolCalls) {
      if (calls >= maxToolCalls) break
      calls += 1
      const args = parseToolArguments(call.function.arguments)
      const outcome = await run(call.function.name, args)
      citations = citationsFrom(outcome.content, citations)
      let hits = 0
      try {
        const parsed = JSON.parse(outcome.content)
        hits = Array.isArray(parsed) ? parsed.length : 1
      } catch {
        hits = outcome.content.startsWith('[]') ? 0 : 1
      }
      const record: ToolStep = { name: call.function.name, args, hits, ok: !outcome.content.includes('"error"') }
      steps.push(record)
      deps.onStep?.(record)
      messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: outcome.content })
    }
  }

  // 工具轮次用完还没收敛：让它拿着现有材料直接答，别把用户晾着。
  messages.push({ role: 'user', content: '就根据上面查到的内容给出结论，不要再调用工具。' })
  const final = await step(messages)
  return { answer: (final.content ?? '').trim() || '没有找到相关内容。', citations, steps }
}
