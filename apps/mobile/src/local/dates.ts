/**
 * 收藏列表的日期分组。
 *
 * 不按月分组：月初只有一两条的时候，「2026 年 10 月」这种标题比内容还多。
 * 只把「今天 / 昨天」说清楚，再往前一律给具体日期——用户记的是「大概什么时候存的」，
 * 具体的日月就是最好的刻度。
 *
 * 说法来自 i18n：英文下是 Today / Yesterday / 10/3。
 */
import { t } from '../i18n'

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''

  const diff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (diff === 0) return t('date.today')
  if (diff === 1) return t('date.yesterday')
  if (diff === 2) return t('date.dayBefore')

  const month = date.getMonth() + 1
  const day = date.getDate()
  if (date.getFullYear() === now.getFullYear()) return t('date.monthDay', { month, day })
  return t('date.fullDate', { year: date.getFullYear(), month, day })
}

/**
 * 「多久以前」：同步状态这类地方要的是跨度，不是日期。
 * 一小时内说分钟，当天说小时，再往前交给 dayLabel。
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''

  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000)
  if (minutes < 1) return t('date.justNow')
  if (minutes < 60) return t('date.minutesAgo', { count: minutes })

  const hours = Math.floor(minutes / 60)
  if (hours < 24 && startOfDay(now) === startOfDay(at)) return t('date.hoursAgo', { count: hours })

  return dayLabel(iso, now)
}
