import { View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { Text } from './text'
import { Pressable } from 'react-native'
import { usePalette } from './palette'

/**
 * Settings select: same shape as TextField (small label, one underline) but the
 * value is picked rather than typed.
 *
 * A settings row should not become a card, and a full-screen picker for eight
 * options is a page for one decision — the chevron says "this opens something"
 * without claiming to be an input.
 */
export function SelectField({
  label,
  value,
  placeholder,
  onPress,
  hint,
  accessibilityLabel,
}: {
  label: string
  value: string
  placeholder: string
  onPress: () => void
  hint?: string
  accessibilityLabel?: string
}) {
  const p = usePalette()
  const empty = value.trim().length === 0

  return (
    <View>
      <Text className="text-[11px] font-semibold tracking-[1px] text-muted">{label}</Text>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label}>
        {({ pressed }) => (
          <View
            className="mt-1 flex-row items-center border-b border-line pb-1"
            style={{ opacity: pressed ? 0.6 : 1 }}
          >
            <Text
              className={empty ? 'h-9 flex-1 text-body-sm text-faint' : 'h-9 flex-1 text-body-sm text-ink'}
              numberOfLines={1}
              style={{ lineHeight: 36 }}
            >
              {empty ? placeholder : value}
            </Text>
            <Ionicons name="chevron-down" size={16} color={p.faint} />
          </View>
        )}
      </Pressable>
      {hint ? <Text className="mt-1 text-caption text-muted">{hint}</Text> : null}
    </View>
  )
}
