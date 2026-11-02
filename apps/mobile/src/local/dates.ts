/**
 * 收藏列表的日期分组。
 *
 * 不按月分组：月初只有一两条的时候，「2026 年 10 月」这种标题比内容还多。
 * 只把「今天 / 昨天」说清楚，再往前一律给具体日期——用户记的是「大概什么时候存的」，
 * 具体的日月就是最好的刻度。
 */

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''

  const diff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  if (diff === 2) return '前天'

  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}
