import type { ReactNode } from 'react'
import { View } from 'react-native'

import { cx } from './cx'

/**
 * 半扁平卡片：自身是纯白表面，靠一层几乎看不见的投影从画布上「抬起」。
 *
 * 为什么不是纯扁平：收藏页动辄几百行，行与行之间没有边界会糊成一片；
 * 为什么不是重阴影：投影只是分组手段，读内容时不该看见它。
 * 深色模式下投影消失（黑投影在深底上无效），靠 1px 发丝线兜底。
 */
export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  // 层次靠发丝线与留白，不靠阴影：Android 的 elevation 会带出灰边，也破坏「克制」。
  return (
    <View
      className={cx('rounded-md border border-line bg-surface', padded && 'p-3', className)}
    >
      {children}
    </View>
  )
}
