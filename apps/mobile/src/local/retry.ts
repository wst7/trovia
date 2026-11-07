/**
 * Which failures are worth another try.
 *
 * This module deliberately does not import the database or React Native: it has to be run directly in node by unit tests,
 * and also referenced by repo (writing to the database) and the UI (deciding whether to show the retry entry point).
 */

export const RETRYABLE_CODES = ['FETCH_FAILED', 'INTERNAL_ERROR', 'PARSE_INCOMPLETE']

/**
 * Decisions on the site's side — login walls, human verification, content only inside the app, bodies rendered by script —
 * do not change because the user taps a few more times, and giving them a retry button means making people repeat something bound to fail.
 */
export function isRetryableError(code: string | null | undefined): boolean {
  if (!code) return true
  return RETRYABLE_CODES.includes(code)
}
