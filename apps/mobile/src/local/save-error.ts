/**
 * 保存失败时，把底层那句英文堆栈翻成用户能行动的一句话。
 *
 * 数据库写不进去的原因就那么几种，界面不该统一显示「保存失败，请稍后重试」——
 * 那句话对谁都没用：锁着等两秒就好，磁盘满了再等也没用。
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

/** 失败类型 → i18n key。 */
export const SAVE_FAILURE_KEY: Record<SaveFailure, string> = {
  busy: 'save.err.busy',
  storage: 'save.err.storage',
  corrupt: 'save.err.corrupt',
  duplicate: 'save.err.duplicate',
  unknown: 'save.err.unknown',
}
