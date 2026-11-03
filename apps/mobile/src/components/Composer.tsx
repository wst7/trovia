import { useMemo, useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { extractHttpUrl, isValidHttpUrl } from '@trovia/shared'

import { useT } from '../i18n'
import { titleHintFrom } from '../local/util'
import { cx } from '../ui/cx'
import { usePalette } from '../ui/palette'

export interface SaveResult {
  id: string
  duplicate: boolean
}

interface ComposerProps {
  value: string
  onChangeText: (text: string) => void
  onSearch: () => void
  onSave: (url: string, titleHint: string | null) => Promise<SaveResult | null>
  searching?: boolean
  onFocus?: () => void
}

/** 只输入了域名（没有协议）时补上 https://，避免用户被「没有链接」挡住。 */
function withScheme(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 500 || /\s/.test(trimmed)) return null
  if (!/^[\w-]+(\.[\w-]+)+(:\\d+)?(\/\S*)?$/i.test(trimmed)) return null
  return `https://${trimmed}`
}

/**
 * 一个输入框做两件事：看得出是链接就收下来，看不出就当成一句话去找。
 *
 * 这是首页「克制」的核心——不再并排摆放「提问」和「收藏」两张卡，
 * 因为用户心里只有一件事：我要找的那个东西。框下方那行小字随输入
 * 变化，告诉他这次会被当成保存还是检索。
 */
export function Composer({
  value,
  onChangeText,
  onSearch,
  onSave,
  searching = false,
  onFocus,
}: ComposerProps) {
  const p = usePalette()
  const t = useT()
  const [focused, setFocused] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const detectedUrl = useMemo(() => extractHttpUrl(value) ?? withScheme(value), [value])
  const saveMode = detectedUrl !== null
  const trimmed = value.trim()
  const busy = searching || saving
  const ready = trimmed.length > 0 && !busy

  const hint = error
    ? error
    : saveMode
      ? t('composer.hint.save')
      : trimmed.length > 0
        ? t('composer.hint.search')
        : ''

  async function submit() {
    if (!ready) return
    if (!saveMode) {
      onSearch()
      return
    }
    if (!isValidHttpUrl(detectedUrl)) {
      setError(t('composer.invalidUrl'))
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSave(detectedUrl, titleHintFrom(value, detectedUrl))
    } catch {
      setError(t('composer.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <View
      className={cx(
        'rounded-md border bg-surface',
        focused ? 'border-line-strong' : 'border-line',
      )}
    >
      <TextInput
        value={value}
        onChangeText={(text) => {
          onChangeText(text)
          if (error) setError(null)
        }}
        onFocus={() => {
          setFocused(true)
          onFocus?.()
        }}
        onBlur={() => setFocused(false)}
        placeholder={t('composer.placeholder')}
        placeholderTextColor={p.faint}
        multiline
        maxLength={4000}
        textAlignVertical="top"
        selectionColor={p.accent}
        cursorColor={p.accent}
        accessibilityLabel={t('composer.a11y')}
        editable={!saving}
        className="min-h-[52px] max-h-[132px] px-4 pt-4 text-body text-ink"
      />

      <View className="flex-row items-center justify-between gap-3 px-3 pb-2">
        <Text
          // 必须显式给颜色：Text 不写颜色时是系统黑，深色模式下等于隐形。
          className={cx('flex-1 text-caption', error ? 'text-danger' : 'text-muted')}
          numberOfLines={1}
        >
          {hint}
        </Text>
        <Pressable
          onPress={() => void submit()}
          disabled={!ready}
          accessibilityRole="button"
          accessibilityLabel={saveMode ? t('composer.action.save') : t('composer.action.search')}
          accessibilityState={{ disabled: !ready, busy }}
          hitSlop={8}
          className="h-9 w-9 items-center justify-center rounded-sm"
        >
          {({ pressed }) => (
            <View
              className={cx(
                'h-9 w-9 items-center justify-center rounded-sm',
                ready ? 'bg-accent' : 'bg-sunken',
              )}
              style={{ opacity: pressed ? 0.7 : 1 }}
            >
              {busy ? (
                <ActivityIndicator size="small" color={ready ? p.onAccent : p.faint} />
              ) : (
                <Ionicons
                  name={saveMode ? 'bookmark-outline' : 'arrow-up'}
                  size={17}
                  color={ready ? p.onAccent : p.faint}
                />
              )}
            </View>
          )}
        </Pressable>
      </View>
    </View>
  )
}
