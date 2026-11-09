/**
 * Parsing for OpenAI-style streaming responses.
 *
 * Kept free of fetch and react-native so the awkward parts — a chunk that ends
 * mid-line, a chunk that ends mid-JSON, tool calls arriving in pieces — can be
 * tested with strings instead of a network.
 */

export interface StreamToolCall {
  id: string
  name: string
  /** Arguments arrive as a JSON string, typically a few characters per chunk. */
  args: string
}

export interface StreamState {
  content: string
  toolCalls: StreamToolCall[]
}

export function emptyStreamState(): StreamState {
  return { content: '', toolCalls: [] }
}

/**
 * Split a buffer into complete `data:` payloads, keeping the unfinished tail.
 *
 * SSE frames are separated by a blank line, but OpenAI-compatible servers also
 * send one `data:` line per chunk, so splitting on newlines and keeping the last
 * partial line is enough — and far less brittle than waiting for a blank line.
 */
export function splitSseBuffer(buffer: string): { payloads: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const rest = lines.pop() ?? ''
  const payloads: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload) continue
    payloads.push(payload)
  }
  return { payloads, rest }
}

/**
 * Apply one chunk to the state and return the text it added (empty when the
 * chunk only carried tool-call arguments or metadata).
 */
export function applyOpenAiChunk(state: StreamState, payload: string): string {
  if (payload === '[DONE]') return ''
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    // A truncated frame: the next one usually completes it.
    return ''
  }
  const choice = (parsed as { choices?: unknown[] })?.choices?.[0] as
    | { delta?: { content?: unknown; tool_calls?: unknown[] } }
    | undefined
  const delta = choice?.delta
  if (!delta) return ''

  let added = ''
  if (typeof delta.content === 'string' && delta.content) {
    state.content += delta.content
    added = delta.content
  }

  if (Array.isArray(delta.tool_calls)) {
    for (const raw of delta.tool_calls) {
      const call = raw as {
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }
      // The index is what keeps pieces of different calls apart; without it a
      // single call is assumed, which is what most providers send.
      const index = typeof call.index === 'number' ? call.index : 0
      const target = (state.toolCalls[index] ??= { id: '', name: '', args: '' })
      if (typeof call.id === 'string' && call.id) target.id = call.id
      if (typeof call.function?.name === 'string' && call.function.name) target.name += call.function.name
      if (typeof call.function?.arguments === 'string') target.args += call.function.arguments
    }
  }

  return added
}
