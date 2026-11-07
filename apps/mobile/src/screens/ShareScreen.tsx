import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Text } from '../ui/text'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { isValidHttpUrl } from '@trovia/shared'

import { scheduleSyncAfterSave } from '../local/auto-sync'
import { processPendingQueue } from '../local/pipeline'
import * as repo from '../local/repo'
import { useToast } from '../providers/ToastProvider'
import { Button } from '../ui/Button'
import { Screen } from '../ui/Screen'
import { usePalette } from '../ui/palette'
import { useT } from '../i18n'
import { recordProblem } from '../local/crash-log'
import { devLog, isDevMode } from '../local/dev-log'
import { classifySaveError, SAVE_FAILURE_KEY } from '../local/save-error'

/** The save-result page after arriving via share: save to this device once, then jump to the detail screen. */
export function ShareScreen() {
  const t = useT()
  const router = useRouter()
  const params = useLocalSearchParams<{ url?: string | string[]; hint?: string | string[] }>()
  const rawUrl = Array.isArray(params.url) ? params.url[0] : params.url
  const rawHint = Array.isArray(params.hint) ? params.hint[0] : params.hint
  const url = rawUrl && isValidHttpUrl(rawUrl) ? rawUrl : null
  const { toast } = useToast()
  const insets = useSafeAreaInsets()
  const p = usePalette()

  const started = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Retry in place after a failure: someone arriving via share no longer has the original app's context, and sending them back to the home screen loses a save.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!url) return
    if (started.current === `${url}#${attempt}`) return
    started.current = `${url}#${attempt}`

    void (async () => {
      try {
        if (isDevMode()) await devLog('share.save.start', { url, hint: rawHint ?? null })
        const res = await repo.createDocument(url, rawHint ?? null)
        if (isDevMode()) await devLog('share.save.ok', { id: res.id, duplicate: res.duplicate })
        if (res.duplicate) {
          toast(t('home.toast.duplicate'))
        } else {
          toast(t('home.toast.saved'), { type: 'success' })
          void processPendingQueue()
          // Sync a little later once saved, so the other device sees it on refresh.
          scheduleSyncAfterSave()
        }
        router.replace(`/documents/${res.id}`)
      } catch (e) {
        if (e instanceof Error && e.message === 'INVALID_URL') {
          setError(t('composer.invalidUrl'))
          return
        }
        // The raw stack goes to logcat; the UI only says the one thing the user can act on.
        console.warn('[share] save failed', e)
        recordProblem('share-save', e)
        await devLog('share.save.failed', { url }, e)
        setError(t(SAVE_FAILURE_KEY[classifySaveError(e)]))
      }
    })()
  }, [url, rawHint, router, toast, attempt])

  return (
    <Screen>
      <View className="flex-1 px-4" style={{ paddingBottom: insets.bottom }}>
        <View className="h-14" />
        {!url ? (
          <View className="mt-6">
            <Text className="text-title font-semibold text-ink">{t('share.noUrlTitle')}</Text>
            <Text className="mt-2 text-body-sm text-muted">{t('share.noUrlBody')}</Text>
            <View className="mt-6 self-start">
              <Button label={t('list.backHome')} onPress={() => router.replace('/')} size="sm" />
            </View>
          </View>
        ) : error ? (
          <View className="mt-6">
            <Text className="text-title font-semibold text-ink">{t('share.failedTitle')}</Text>
            <Text className="mt-2 text-body-sm text-muted">{error}</Text>
            <View className="mt-6 flex-row items-center gap-3">
              <Button
                label={t('share.retry')}
                onPress={() => {
                  setError(null)
                  setAttempt((n) => n + 1)
                }}
                size="sm"
              />
              <Button
                label={t('list.backHome')}
                onPress={() => router.replace('/')}
                size="sm"
                variant="quiet"
              />
            </View>
          </View>
        ) : (
          <View className="mt-6 flex-row items-center gap-3">
            <ActivityIndicator size="small" color={p.muted} />
            <Text className="text-body-sm text-muted">正在保存到本机……</Text>
          </View>
        )}
      </View>
    </Screen>
  )
}
