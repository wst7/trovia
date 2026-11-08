/**
 * Loading the model list from a provider.
 *
 * Typing a model name is the step people get wrong most often ("gpt-4o-mini" vs
 * "gpt-4o mini"), and every OpenAI-compatible service answers `GET /models`
 * with the ids it accepts. That is the list we offer instead.
 *
 * Pure parsing and endpoint building live here so they can be tested without a
 * network; the fetch itself stays in the screen.
 */

/** `{base}/models`, tolerating a base that already ends in a path segment or a slash. */
export function modelsEndpoint(baseUrl: string): string | null {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) return null
  // A chat endpoint pasted by mistake ends in /chat/completions; trim it back.
  const root = base.replace(/\/chat\/completions$/i, '')
  return `${root}/models`
}

/** Ids from an OpenAI-shaped `{ data: [{ id }] }` payload, sorted, de-duplicated. */
export function parseModelList(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  const ids = data
    .map((entry) => (entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim())
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}

/** Chat models worth offering first; embeddings and audio models cannot write a summary. */
export function isChatModel(id: string): boolean {
  return !/embedding|whisper|tts|dall-e|moderation|audio|rerank/i.test(id)
}
