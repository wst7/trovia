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
  /** Current mode: an ordinary search, or handed to the AI to search inside the library. */
  ask?: boolean
  onSelectMode?: (mode: 'search' | 'ai') => void
  /** Whether the AI is available (switched on in settings and an address filled in). When it is not usable, tapping it goes to settings. */
  askAvailable?: boolean
  /** When the LLM is not set up, tapping AI goes straight to settings. */
  onAskNeedsSetup?: () => void
}

/** Add https:// when only a domain was typed (no scheme), so the user is not stopped by “no link”. */
function withScheme(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 500 || /\s/.test(trimmed)) return null
  if (!/^[\w-]+(\.[\w-]+)+(:\\d+)?(\/\S*)?$/i.test(trimmed)) return null
  return `https://${trimmed}`
}

/**
 * One input field does two jobs: if it looks like a link it is taken as one, if not it is treated as a sentence to search for.
 *
 * This is the heart of the home screen's “restraint” — no longer setting the “ask” and “save” cards side by side,
 * because there is only one thing on the user's mind: the thing I want to find. The small line under the field
 * changes with what is typed and tells them whether this will be treated as a save or a search.
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

  // The switch knob: off on the left, on on the right, moved by 16.
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

      {/* One hairline between the input area and the action area: even with a lot of text it will not crowd the switch and the send button. */}
      <View className="mt-1 border-t border-line px-3 pt-2.5 pb-4">
        <View className="flex-row items-center">
          {/*
            Left-placed switch: track 36×20, knob 12, travel 16.
            The switch itself says “whether it is on”, and the word right next to it says “what is on” —
            that saves half the width of two side-by-side words, and nobody thinks there are two places to tap.
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
            {/* Both modes stay visible, the active one in ink: a lone word next to
                a switch never told anyone that a second mode existed. */}
            <View className="flex-row items-center gap-1">
              <Text
                className={cx(
                  'text-caption tracking-[0.02em]',
                  ask ? 'text-faint' : 'font-semibold text-ink',
                )}
              >
                {t('composer.mode.search')}
              </Text>
              <Text className="text-caption text-faint">/</Text>
              <Text
                className={cx(
                  'text-caption tracking-[0.02em]',
                  ask ? 'font-semibold text-ink' : 'text-faint',
                )}
              >
                {t('composer.mode.ai')}
              </Text>
            </View>
          </Pressable>

          {hint ? (
            <Text
              // The colour has to be given explicitly: a Text with no colour is system black, which amounts to invisible in dark mode.
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
