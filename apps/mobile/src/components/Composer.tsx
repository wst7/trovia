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
  /** 当前模式：普通检索，还是交给 AI 在库里找。 */
  ask?: boolean
  onSelectMode?: (mode: 'search' | 'ai') => void
  /** AI 是否可用（设置里打开且填了地址）。不可用时点它去设置。 */
  askAvailable?: boolean
  /** 大模型没配好时，点 AI 直接去设置。 */
  onAskNeedsSetup?: () => void
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
  ask = false,
  onSelectMode,
  onAskNeedsSetup,
  askAvailable = false,
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

      {/* 输入区与操作区之间一条发丝线：文字多了也不会跟模式、发送挤在一起。 */}
      <View className="mt-1 border-t border-line px-3 pt-2.5 pb-4">
        {hint ? (
          <Text
            // 必须显式给颜色：Text 不写颜色时是系统黑，深色模式下等于隐形。
            className={cx('mb-2 text-caption', error ? 'text-danger' : 'text-muted')}
            numberOfLines={1}
          >
            {hint}
          </Text>
        ) : null}

        <View className="flex-row items-center justify-between">
          {/* 模式用两段文字，选中那段下面一条发丝线——和落地页的语言切换同一套。 */}
          <View className="flex-row items-center gap-5">
            {(['search', 'ai'] as const).map((mode) => {
              const active = mode === 'ai' ? ask : !ask
              return (
                <Pressable
                  key={mode}
                  onPress={() => {
                    if (mode === 'ai' && !askAvailable) {
                      onAskNeedsSetup?.()
                      return
                    }
                    onSelectMode?.(mode)
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={
                    mode === 'ai' ? t('composer.mode.aiA11y') : t('composer.mode.searchA11y')
                  }
                  hitSlop={8}
                  className="items-center py-1"
                >
                  <Text
                    className={cx(
                      'text-caption tracking-[0.08em]',
                      active ? 'text-ink' : 'text-faint',
                    )}
                  >
                    {mode === 'ai' ? t('composer.mode.ai') : t('composer.mode.search')}
                  </Text>
                  <View
                    className={cx('mt-1.5 h-[2px] w-full', active ? 'bg-accent' : 'bg-transparent')}
                  />
                </Pressable>
              )
            })}
          </View>

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
    </View>
  )
}
