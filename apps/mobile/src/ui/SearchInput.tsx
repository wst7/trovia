import { useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { Pressable, TextInput, View } from 'react-native'

import { cx } from './cx'
import { usePalette } from './palette'
import { useT } from '../i18n'

interface SearchInputProps {
  value: string
  onChangeText: (text: string) => void
  placeholder?: string
  accessibilityLabel: string
  autoFocus?: boolean
}

/** v3 filter field: a 48dp filled box with a 12dp radius, matching the home search field's language. */
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
        'h-12 flex-row items-center gap-2.5 rounded-[12px] bg-sunken px-3.5',
        focused ? 'border border-line-strong' : 'border border-transparent',
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
        className="h-12 flex-1 text-body text-ink"
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('list.clearFilter')}
          className="h-6 w-6 items-center justify-center rounded-full bg-canvas"
        >
          <Ionicons name="close" size={13} color={p.muted} />
        </Pressable>
      ) : null}
    </View>
  )
}
