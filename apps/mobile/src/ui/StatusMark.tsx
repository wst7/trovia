import { View } from 'react-native'
import { Text } from './text'
import type { ParseStatus } from '@trovia/shared'
import { statusLabel } from '../i18n/status'

import { cx } from './cx'

const IN_FLIGHT: ParseStatus[] = ['pending', 'fetching', 'parsing', 'analyzing', 'indexing']

/**
 * Shape before color: filled = done, hollow = organizing, filled with a slash = partial/failed.
 * A finished stamp gets no text — the default state doesn't need to shout; only "not ready yet" earns attention.
 */
export function StatusMark({
  status,
  errorCode,
  withLabel = true,
  className,
}: {
  status: ParseStatus
  /** Failure reason: different reasons get different wording so the user knows what to do. */
  errorCode?: string | null
  withLabel?: boolean
  className?: string
}) {
  // Done needs no mark: a lone gray dot at the end of a row only makes the reader guess what it means.
  if (status === 'completed' && withLabel) return null

  const inFlight = IN_FLIGHT.includes(status)
  const partial = status === 'partial'
  const failed = status === 'failed'

  const dot = inFlight
    ? 'border border-muted bg-transparent'
    : failed
      ? 'bg-danger'
      : partial
        ? 'bg-warn'
        : 'bg-faint'

  return (
    <View className={cx('flex-row items-center gap-2', className)}>
      <View className={cx('h-1.5 w-1.5 rounded-full', dot)} />
      {withLabel && inFlight ? (
        <Text className="text-caption text-muted">整理中</Text>
      ) : withLabel && (partial || failed) ? (
        <Text className="text-[11px] text-muted" numberOfLines={1}>
          {statusLabel(status, errorCode)}
        </Text>
      ) : null}
    </View>
  )
}
