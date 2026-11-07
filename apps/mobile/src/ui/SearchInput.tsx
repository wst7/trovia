import { useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { TextInput, View } from 'react-native'

import { cx } from './cx'
import { usePalette } from './palette'
import { IconButton } from './Button'
import { useT } from '../i18n'

interface SearchInputProps {
  value: string
  onChangeText: (text: string) => void
  placeholder?: string
  accessibilityLabel: string
  autoFocus?: boolean
}

/** 收藏页的筛选框：一条下划线，不画框——框会把它变成一个「卡片里的组件」。 */
export function SearchInput({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  autoFocus = false,
}: SearchInputProps) {
  const t = useT()
  const p = usePalette()
  const [focused, setFocused] = useState(false)

  return (
    <View
      className={cx(
        'flex-row items-center gap-2 border-b  bg-canvas',
        focused ? 'border-accent' : 'border-line',
      )}
    >
      <Ionicons name="search" size={16} color={focused ? p.accent : p.faint} />
      <TextInput
                  value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder ?? t('list.filterA11y')}
        placeholderTextColor={p.faint}
        selectionColor={p.accent}
        cursorColor={p.accent}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        accessibilityLabel={accessibilityLabel}
        className="h-11 flex-1 text-body-sm text-ink"
      />
      {value.length > 0 ? (
        <IconButton
          name="close-circle"
          size={16}
          tone="muted"
          accessibilityLabel={t('list.clearFilter')}
          onPress={() => onChangeText('')}
        />
      ) : null}
    </View>
  )
}
