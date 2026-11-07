import type { ReactNode } from 'react'
import { View } from 'react-native'

import { cx } from './cx'

/**
 * Semi-flat card: a plain white surface lifted off the canvas by an almost invisible shadow.
 *
 * Why not fully flat: the saved page runs to hundreds of rows, and with no boundary between rows they smear together;
 * why not heavy shadows: a shadow is only a way to group things and shouldn't be noticed while reading.
 * In dark mode the shadow disappears (a black shadow does nothing on a dark background), so a 1px hairline takes over.
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
  // Hierarchy from hairlines and whitespace, not shadows: Android elevation drags in a gray edge and breaks the restraint.
  return (
    <View
      className={cx('rounded-md border border-line bg-surface', padded && 'p-3', className)}
    >
      {children}
    </View>
  )
}
