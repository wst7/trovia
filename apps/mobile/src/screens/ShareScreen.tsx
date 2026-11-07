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

/** 分享进入后的保存结果页：保存到本机一次，然后跳到详情。 */
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
  // 失败后原地重试：分享进来的人已经没有原 App 的上下文了，逼他回首页等于丢一次收藏。
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
          // 存完稍后同步一次：另一台设备刷新就能看到。
          scheduleSyncAfterSave()
        }
        router.replace(`/documents/${res.id}`)
      } catch (e) {
        if (e instanceof Error && e.message === 'INVALID_URL') {
          setError(t('composer.invalidUrl'))
          return
        }
        // 原始堆栈留给 logcat，界面只说能行动的那一句。
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
