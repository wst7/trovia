/**
 * Whether the saved time from an import file can be used as is.
 *
 * It is adopted only when plausible: negative values, future times and NaN all fall back to "now" —
 * a wrong time is worse than no time, because users think their timeline is scrambled.
 */
export function resolveImportedSavedAt(savedAt: number | null | undefined, now: number): string {
  const usable =
    typeof savedAt === 'number' && Number.isFinite(savedAt) && savedAt > 0 && savedAt <= now
  return new Date(usable ? savedAt : now).toISOString()
}
