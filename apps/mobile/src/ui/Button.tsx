import type { ComponentProps } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'

import { cx } from './cx'
import { usePalette } from './palette'

type IconName = ComponentProps<typeof Ionicons>['name']

const BASE = 'flex-row items-center justify-center rounded-sm'
const SIZES = {
  md: 'h-12 px-5',
  sm: 'h-10 px-4',
} as const
const VARIANTS = {
  // 朱红只给「当前可执行的那个动作」——一屏最多一个。
  primary: 'bg-accent',
  destructive: 'bg-danger',
  // 描边次级动作：分隔线色描边，透明底。
  secondary: 'border border-line-strong bg-surface',
  // 纯文字动作：不占视觉重量。
  quiet: 'bg-transparent',
} as const
const LABEL_VARIANTS = {
  primary: 'text-white dark:text-canvas',
  destructive: 'text-white dark:text-canvas',
  secondary: 'text-ink',
  quiet: 'text-accent',
} as const

interface ButtonProps {
  label: string
  onPress: () => void
  variant?: keyof typeof VARIANTS
  size?: keyof typeof SIZES
  icon?: IconName
  disabled?: boolean
  loading?: boolean
  className?: string
}

export function Button({
  label,
  onPress,
  variant = 'secondary',
  size = 'md',
  icon,
  disabled = false,
  loading = false,
  className,
}: ButtonProps) {
  const p = usePalette()
  const muted = disabled || loading
  const iconColor =
    variant === 'primary' || variant === 'destructive'
      ? p.onAccent
      : variant === 'quiet'
        ? p.accent
        : p.ink

  return (
    <Pressable
      onPress={onPress}
      disabled={muted}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: muted, busy: loading }}
      className={cx(BASE, SIZES[size], VARIANTS[variant], muted && 'opacity-40', className)}
    >
      {loading ? (
        <ActivityIndicator size="small" color={iconColor} />
      ) : (
        <View className="flex-row items-center gap-2">
          {icon ? <Ionicons name={icon} size={size === 'sm' ? 15 : 17} color={iconColor} /> : null}
          <Text className={cx('text-label', LABEL_VARIANTS[variant])}>{label}</Text>
        </View>
      )}
    </Pressable>
  )
}

interface TextButtonProps {
  label: string
  onPress: () => void
  tone?: 'accent' | 'muted' | 'danger'
  disabled?: boolean
}

/** 行内文字动作：加载更多、清除筛选、全部收藏。 */
export function TextButton({ label, onPress, tone = 'accent', disabled = false }: TextButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      className={cx('min-h-[44px] justify-center', disabled && 'opacity-40')}
    >
      {({ pressed }) => (
        <Text
          className={cx(
            'text-label',
            tone === 'accent' && 'text-accent',
            tone === 'muted' && 'text-muted',
            tone === 'danger' && 'text-danger',
            pressed && 'opacity-60',
          )}
        >
          {label}
        </Text>
      )}
    </Pressable>
  )
}

interface IconButtonProps {
  name: IconName
  onPress: () => void
  accessibilityLabel: string
  size?: number
  tone?: 'ink' | 'muted' | 'accent'
  disabled?: boolean
}

/** 48dp 触区的纯图标按钮，没有底色——没有底色就没有装饰。 */
export function IconButton({
  name,
  onPress,
  accessibilityLabel,
  size = 20,
  tone = 'ink',
  disabled = false,
}: IconButtonProps) {
  const p = usePalette()
  const color = tone === 'accent' ? p.accent : tone === 'muted' ? p.muted : p.ink

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      className={cx(
        'h-12 w-12 items-center justify-center rounded-full',
        disabled && 'opacity-40',
      )}
    >
      {({ pressed }) => (
        <Ionicons name={name} size={size} color={color} style={{ opacity: pressed ? 0.5 : 1 }} />
      )}
    </Pressable>
  )
}
