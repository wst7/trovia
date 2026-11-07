/**
 * When a save fails, turn the low-level English stack message into one sentence the user can act on.
 *
 * There are only so many reasons a database write cannot go through, and the UI should not show “save failed, please try again later” for all of them —
 * that sentence helps nobody: when it is locked, waiting two seconds is enough; when the disk is full, waiting forever helps nothing.
 */
export type SaveFailure = 'busy' | 'storage' | 'corrupt' | 'duplicate' | 'unknown'

export function classifySaveError(error: unknown): SaveFailure {
  const text = [
    error instanceof Error ? error.message : String(error),
    typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (/SQLITE_BUSY|database is locked|locked/i.test(text)) return 'busy'
  if (/disk (is )?full|SQLITE_FULL|no space left|ENOSPC/i.test(text)) return 'storage'
  if (/SQLITE_CORRUPT|not a database|malformed|database disk image/i.test(text)) return 'corrupt'
  if (/SQLITE_CONSTRAINT|UNIQUE constraint/i.test(text)) return 'duplicate'
  return 'unknown'
}

/** Failure type → i18n key. */
export const SAVE_FAILURE_KEY: Record<SaveFailure, string> = {
  busy: 'save.err.busy',
  storage: 'save.err.storage',
  corrupt: 'save.err.corrupt',
  duplicate: 'save.err.duplicate',
  unknown: 'save.err.unknown',
}
