import type { ReactNode } from 'react'
import { View } from 'react-native'

import { cx } from './cx'
import { usePalette } from './palette'

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
  const p = usePalette()
  return (
    <View
      className={cx('rounded-md border border-line bg-surface', padded && 'p-3', className)}
      style={{
        shadowColor: p.ink,
        shadowOpacity: 0.05,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
      }}
    >
      {children}
    </View>
  )
}
