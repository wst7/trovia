import { Text, View } from 'react-native'
import type { ParseStatus } from '@trovia/shared'
import { statusText } from '@trovia/shared'

import { cx } from './cx'

const IN_FLIGHT: ParseStatus[] = ['pending', 'fetching', 'parsing', 'analyzing', 'indexing']

/**
 * 形状先于颜色：实心＝已完成、空心＝整理中、实心带划＝部分/失败。
 * 已完成的票不给文字——默认状态不需要喊出来，只有「还没好」才占用眼力。
 */
export function StatusMark({
  status,
  errorCode,
  withLabel = true,
  className,
}: {
  status: ParseStatus
  /** 失败原因：不同原因给不同的说法，用户才知道该做什么。 */
  errorCode?: string | null
  withLabel?: boolean
  className?: string
}) {
  // 已完成不需要标记：一行末尾孤零零一个灰点，读者还得猜它是什么意思。
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
          {statusText(status, errorCode)}
        </Text>
      ) : null}
    </View>
  )
}
