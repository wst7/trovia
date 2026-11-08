/**
 * Provider-specific request requirements that have nothing to do with the
 * OpenAI-compatible payload.
 *
 * OpenCode Go answers 400 with "MissingSessionID" unless the request carries a
 * stable `x-opencode-session` header: it uses the id for routing and prompt
 * caching. Its docs also ask clients to identify themselves with their own user
 * agent rather than a generic HTTP-library name. Zen has neither requirement.
 */

/** True for the Go subscription endpoint, which shares a host with Zen but not its rules. */
export function isOpenCodeGo(baseUrl: string): boolean {
  return /opencode\.ai\/inference\/go\//i.test(baseUrl.trim())
}

/**
 * Headers Go expects. The session id must stay stable across a conversation -
 * that is what makes caching work - but must not be the same on every install,
 * so the caller passes an id it generated and persisted.
 */
export function providerHeaders(baseUrl: string, sessionId: string): Record<string, string> {
  if (!isOpenCodeGo(baseUrl)) return {}
  const headers: Record<string, string> = { 'x-opencode-session': sessionId }
  // Generic names get deprioritised; a caller that says who it is does not.
  headers['User-Agent'] = 'Trovia/1.0 (+https://github.com/wst7/trovia)'
  return headers
}
