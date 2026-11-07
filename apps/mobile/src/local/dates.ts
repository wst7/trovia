/**
 * Date grouping for the saved list.
 *
 * No month grouping: early in a month, when there are only one or two entries, a heading like "October 2026" outweighs the content.
 * Only "today / yesterday" get words; everything older gets a concrete date — users remember roughly when they saved something,
 * so a concrete day and month is the best scale.
 *
 * The wording comes from i18n: in English it is Today / Yesterday / 10/3.
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
 * "How long ago": places like sync status want a span, not a date.
 * Under an hour, minutes; same day, hours; anything older is handed to dayLabel.
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
