import { useState } from 'react'
import { TextInput, View } from 'react-native'
import { Text } from './text'
import type { TextInputProps } from 'react-native'

import { cx } from './cx'
import { usePalette } from './palette'

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string
  hint?: string
}

/**
 * Settings input: a small label above, a single underline below, and the underline turns vermilion on focus.
 * No fill, no rounded box — a settings row is not a form card.
 */
export function TextField({ label, hint, ...input }: TextFieldProps) {
  const p = usePalette()
  const [focused, setFocused] = useState(false)

  return (
    <View>
      <Text className="text-[11px] font-semibold tracking-[1px] text-muted">{label}</Text>
      <View
        className={cx('mt-1 border-b', focused ? 'border-accent' : 'border-line')}
      >
        <TextInput
                    {...input}
          onFocus={(e) => {
            setFocused(true)
            input.onFocus?.(e)
          }}
          onBlur={(e) => {
            setFocused(false)
            input.onBlur?.(e)
          }}
          placeholderTextColor={p.faint}
          selectionColor={p.accent}
          cursorColor={p.accent}
          className="h-10 text-body-sm text-ink"
        />
      </View>
      {hint ? <Text className="mt-1 text-caption text-muted">{hint}</Text> : null}
    </View>
  )
}
