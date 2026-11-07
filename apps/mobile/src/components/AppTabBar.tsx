import type { ComponentProps } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { usePathname, useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useT } from '../i18n'
import { usePalette } from '../ui/palette'

export type TabKey = 'home' | 'documents' | 'settings'

type IconName = ComponentProps<typeof Ionicons>['name']

const TABS: {
  key: TabKey
  labelKey: string
  href: '/' | '/documents' | '/settings'
  icon: IconName
  activeIcon: IconName
}[] = [
  { key: 'home', labelKey: 'tab.home', href: '/', icon: 'home-outline', activeIcon: 'home' },
  {
    key: 'documents',
    labelKey: 'tab.documents',
    href: '/documents',
    icon: 'albums-outline',
    activeIcon: 'albums',
  },
  {
    key: 'settings',
    labelKey: 'tab.settings',
    href: '/settings',
    icon: 'person-outline',
    activeIcon: 'person',
  },
]

/**
 * 底部导航：一条发丝线 + 三组图标与字。
 * 没有胶囊底色、没有指示器——选中只表现为「墨色 vs 极淡墨」。
 */
export function AppTabBar() {
  const router = useRouter()
  const pathname = usePathname()
  // 由导航器统一渲染，所以当前 Tab 从路径推断，页面不用再传。
  const active: TabKey = pathname.startsWith('/documents')
    ? 'documents'
    : pathname.startsWith('/settings')
      ? 'settings'
      : 'home'
  const insets = useSafeAreaInsets()
  const p = usePalette()
  const t = useT()

  return (
    <View
      className="absolute inset-x-0 bottom-0 border-t border-line bg-canvas"
      style={{ paddingBottom: insets.bottom }}
    >
      <View className="h-14 flex-row">
        {TABS.map((tab) => {
          const selected = tab.key === active
          return (
            <Pressable
              key={tab.key}
              onPress={() => {
                if (!selected) router.replace(tab.href)
              }}
              accessibilityRole="tab"
              accessibilityLabel={t(tab.labelKey)}
              accessibilityState={{ selected }}
              className="flex-1 items-center justify-center gap-1"
            >
              {({ pressed }) => (
                <View className="items-center gap-1" style={{ opacity: pressed ? 0.5 : 1 }}>
                  <Ionicons
                    name={selected ? tab.activeIcon : tab.icon}
                    size={21}
                    color={selected ? p.ink : p.faint}
                  />
                  <Text
                    className={
                      selected
                        ? 'text-[10px] font-medium tracking-[0.2px] text-ink'
                        : 'text-[10px] tracking-[0.2px] text-faint'
                    }
                  >
                    {t(tab.labelKey)}
                  </Text>
                </View>
              )}
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

/** 底部导航占总高度（不含安全区），列表用它留净空。 */
export const TAB_BAR_HEIGHT = 56
