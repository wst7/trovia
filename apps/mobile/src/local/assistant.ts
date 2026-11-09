/**
 * "Ask the model": hand the user's question to the model, which searches the local library through tools and answers.
 *
 * Key constraints:
 *   - answer only from what the tools return; if the tools find nothing, say there is nothing;
 *   - all tools run locally and the body text never leaves the device (only the excerpts read enter the context);
 *   - at most 4 rounds and at most 8 tool calls, so a small model can't spin in circles;
 *   - dependencies are injectable, so tests need no real network.
 */
import type { ChatMessage, ChatStep } from './llm'
import { parseToolArguments } from './tool-args'
import type { ToolRunResult } from './assistant-tools'

export interface ToolStep {
  name: string
  args: Record<string, unknown>
  /** How many results this step got; the UI uses it to explain "what was searched". */
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
  /**
   * Run one model round. It is injected so this layer depends neither on expo
   * nor the network and can run directly in tests.
   *
   * `onDelta` receives the text so far whenever a round streams; a round that
   * ends in tool calls streams its preamble, which the caller discards.
   */
  step: (messages: ChatMessage[], onDelta?: (textSoFar: string) => void) => Promise<ChatStep>
  run?: (name: string, args: Record<string, unknown>) => Promise<ToolRunResult>
  /** Earlier turns of the same conversation, oldest first. */
  history?: { question: string; answer: string }[]
  onStep?: (step: ToolStep) => void
  /** Called repeatedly while the answer is being written. */
  onAnswerDelta?: (textSoFar: string) => void
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

/** Pull the entries that can become citation cards out of the JSON the tools return. */
export function citationsFrom(content: string, previous: Citation[]): Citation[] {
  // Besides id, keep one per title+site too, so the same article saved twice doesn't fill a column.
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

  // Earlier turns go in as ordinary user/assistant pairs: a follow-up like
  // A bare follow-up is meaningless unless the model can see what came before.
  const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  for (const turn of deps.history ?? []) {
    if (!turn.question.trim() || !turn.answer.trim()) continue
    messages.push({ role: 'user', content: turn.question })
    messages.push({ role: 'assistant', content: turn.answer })
  }
  messages.push({ role: 'user', content: trimmed })

  let citations: Citation[] = []
  const steps: ToolStep[] = []
  let calls = 0

  for (let round = 0; round < maxRounds; round += 1) {
    const reply = await step(messages, deps.onAnswerDelta)
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

  // Tool rounds ran out without converging: have it answer from the material at hand rather than leaving the user hanging.
  messages.push({ role: 'user', content: '就根据上面查到的内容给出结论，不要再调用工具。' })
  const final = await step(messages, deps.onAnswerDelta)
  return { answer: (final.content ?? '').trim() || '没有找到相关内容。', citations, steps }
}
