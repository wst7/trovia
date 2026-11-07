import { useEffect, useMemo, useRef, useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { ActivityIndicator, Animated, Pressable, TextInput, View } from 'react-native'
import { Text } from '../ui/text'
import { extractHttpUrl, isValidHttpUrl } from '@trovia/shared'

import { useT } from '../i18n'
import { titleHintFrom } from '../local/util'
import { composerHint } from '../local/composer-hint'
import { recordProblem } from '../local/crash-log'
import { devLog, isDevMode } from '../local/dev-log'
import { classifySaveError, SAVE_FAILURE_KEY } from '../local/save-error'
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

  const hint = composerHint({ ask, saveMode, error }, { aiLink: t('composer.hint.aiLink') })

  // 开关的小方块：关在左，开在右，位移 16。
  const knob = useRef(new Animated.Value(ask ? 1 : 0)).current
  useEffect(() => {
    Animated.timing(knob, { toValue: ask ? 1 : 0, duration: 140, useNativeDriver: true }).start()
  }, [ask, knob])

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
    if (isDevMode()) await devLog('composer.save.start', { url: detectedUrl })
    try {
      await onSave(detectedUrl, titleHintFrom(value, detectedUrl))
      if (isDevMode()) await devLog('composer.save.ok', { url: detectedUrl })
    } catch (e) {
      console.warn('[composer] save failed', e)
      recordProblem('composer-save', e)
      await devLog('composer.save.failed', { url: detectedUrl }, e)
      setError(t(SAVE_FAILURE_KEY[classifySaveError(e)]))
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

      {/* 输入区与操作区之间一条发丝线：文字多了也不会跟开关、发送挤在一起。 */}
      <View className="mt-1 border-t border-line px-3 pt-2.5 pb-4">
        <View className="flex-row items-center">
          {/*
            左置开关：轨道 36×20，方块 12，位移 16。
            开关本身说明「有没有开」，紧挨着的词说明「开的是什么」——
            比并排两个词省一半宽度，也不会让人以为有两个地方能点。
          */}
          <Pressable
            onPress={() => {
              if (!ask && !askAvailable) {
                onAskNeedsSetup?.()
                return
              }
              onSelectMode?.(ask ? 'search' : 'ai')
            }}
            accessibilityRole="switch"
            accessibilityState={{ checked: ask, disabled: false }}
            accessibilityLabel={ask ? t('composer.mode.aiA11y') : t('composer.mode.searchA11y')}
            hitSlop={10}
            className="flex-row items-center gap-2 py-1"
          >
            <View
              className={cx(
                'h-[20px] w-[36px] justify-center rounded-full border px-[3px]',
                ask ? 'border-ink bg-ink' : 'border-line bg-transparent',
              )}
            >
              <Animated.View
                className="h-3 w-3 rounded-full"
                style={{
                  backgroundColor: ask ? p.surface : p.muted,
                  transform: [
                    {
                      translateX: knob.interpolate({ inputRange: [0, 1], outputRange: [0, 16] }),
                    },
                  ],
                }}
              />
            </View>
            <Text
              className={cx(
                'text-caption tracking-[0.02em]',
                ask ? 'font-semibold text-ink' : 'text-faint',
              )}
            >
              {ask ? t('composer.mode.ai') : t('composer.mode.search')}
            </Text>
          </Pressable>

          {hint ? (
            <Text
              // 必须显式给颜色：Text 不写颜色时是系统黑，深色模式下等于隐形。
              className={cx(
                'ml-3 flex-1 text-caption',
                error ? 'text-danger' : 'text-muted',
              )}
              numberOfLines={1}
            >
              {hint}
            </Text>
          ) : (
            <View className="flex-1" />
          )}

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
