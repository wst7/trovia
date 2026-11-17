import { useMemo, useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native'
import { Text } from '../ui/text'
import { extractHttpUrl, isValidHttpUrl } from '@trovia/shared'

import { useT } from '../i18n'
import { titleHintFrom } from '../local/util'
import { recordProblem } from '../local/crash-log'
import { devLog, isDevMode } from '../local/dev-log'
import { classifySaveError, SAVE_FAILURE_KEY } from '../local/save-error'
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

/** Add https:// when only a domain was typed (no scheme), so the user is not stopped by “no link”. */
function withScheme(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 500 || /\s/.test(trimmed)) return null
  if (!/^[\w-]+(\.[\w-]+)+(:\\d+)?(\/\S*)?$/i.test(trimmed)) return null
  return `https://${trimmed}`
}

/**
 * v3: one 56dp search field, one vermilion arrow. No mode switch living in the
 * footer — asking the model is a separate entry card on the home screen.
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
    <View>
      <View
        className="flex-row items-center gap-2.5 rounded-[15px] border bg-surface px-3.5"
        style={{
          height: 56,
          borderColor: focused ? p.lineStrong : p.line,
          shadowColor: '#14130F',
          shadowOpacity: 0.04,
          shadowRadius: 2,
          shadowOffset: { width: 0, height: 1 },
          elevation: 1,
        }}
      >
        <Ionicons name="search" size={19} color={p.faint} />
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
          onSubmitEditing={() => void submit()}
          placeholder={t('composer.placeholder')}
          placeholderTextColor={p.faint}
          maxLength={4000}
          selectionColor={p.accent}
          cursorColor={p.accent}
          accessibilityLabel={t('composer.a11y')}
          editable={!saving}
          returnKeyType={saveMode ? 'done' : 'search'}
          className="flex-1 bg-transparent py-0 text-body text-ink"
        />
        {value.length > 0 ? (
          <Pressable
            onPress={() => onChangeText('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('list.clearFilter')}
            className="h-[26px] w-[26px] items-center justify-center rounded-full bg-sunken"
          >
            <Ionicons name="close" size={13} color={p.muted} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => void submit()}
          disabled={!ready}
          accessibilityRole="button"
          accessibilityLabel={saveMode ? t('composer.action.save') : t('composer.action.search')}
          accessibilityState={{ disabled: !ready, busy }}
          className={ready ? 'h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-accent' : 'h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-sunken'}
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
        </Pressable>
      </View>
      {error ? <Text className="mt-2 text-caption text-danger">{error}</Text> : null}
    </View>
  )
}
