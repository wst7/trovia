import type { ReactNode } from 'react'
import { View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

/**
 * 一屏的底：纸白画布 + 顶部安全区。底部安全区由各屏自己处理，
 * 因为列表要滚到导航栏下面去。
 */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-canvas">
      <View className="flex-1">{children}</View>
    </SafeAreaView>
  )
}

/** 页面左右 gutter：16dp。 */
export const GUTTER = 16
