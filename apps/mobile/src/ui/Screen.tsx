import type { ReactNode } from 'react'
import { View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

/**
 * The base of a screen: paper-white canvas plus the top safe area. Each screen handles the bottom safe area itself,
 * because lists need to scroll under the navigation bar.
 */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-canvas">
      <View className="flex-1">{children}</View>
    </SafeAreaView>
  )
}

/** Page left/right gutter: 16dp. */
export const GUTTER = 22
