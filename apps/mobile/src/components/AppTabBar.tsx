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
 * Bottom navigation: one hairline + three groups of icon and label.
 * No pill background and no indicator — selection shows only as “ink versus very pale ink”.
 */
export function AppTabBar() {
  const router = useRouter()
  const pathname = usePathname()
  // Rendered centrally by the navigator, so the current tab is inferred from the path and pages do not have to pass it in.
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

/** The total height the bottom navigation occupies (excluding the safe area); lists use it to leave clear space. */
export const TAB_BAR_HEIGHT = 56
