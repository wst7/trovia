/**
 * 导入文件里的收藏时间能不能直接用。
 *
 * 只在合理范围内采用：负数、未来时间、NaN 都退回「现在」——
 * 一个错的时间比没有时间更糟，用户会以为自己的时间线乱了。
 */
export function resolveImportedSavedAt(savedAt: number | null | undefined, now: number): string {
  const usable =
    typeof savedAt === 'number' && Number.isFinite(savedAt) && savedAt > 0 && savedAt <= now
  return new Date(usable ? savedAt : now).toISOString()
}
