import { useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import type { TextInputProps } from 'react-native'

import { cx } from './cx'
import { usePalette } from './palette'

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string
  hint?: string
}

/**
 * 设置页的输入项：小号标签在上、一条下划线在下，聚焦时下划线变朱红。
 * 没有底色、没有圆角框——设置项不是表单卡片。
 */
export function TextField({ label, hint, ...input }: TextFieldProps) {
  const p = usePalette()
  const [focused, setFocused] = useState(false)

  return (
    <View>
      <Text className="text-[11px] font-semibold tracking-[1px] text-faint">{label}</Text>
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
