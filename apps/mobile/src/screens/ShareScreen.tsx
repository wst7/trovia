import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { errorMessage, isValidHttpUrl } from '@xunji/shared'

import { processPendingQueue } from '../local/pipeline'
import * as repo from '../local/repo'
import { useToast } from '../providers/ToastProvider'
import { Button } from '../ui/Button'
import { Screen } from '../ui/Screen'
import { usePalette } from '../ui/palette'

/** 分享进入后的保存结果页：保存到本机一次，然后跳到详情。 */
export function ShareScreen() {
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

  useEffect(() => {
    if (!url) return
    if (started.current === url) return
    started.current = url

    void (async () => {
      try {
        const res = await repo.createDocument(url, rawHint ?? null)
        if (res.duplicate) {
          toast('这篇内容已经保存过了。')
        } else {
          toast('已保存，正在本机整理内容……', { type: 'success' })
          void processPendingQueue()
        }
        router.replace(`/documents/${res.id}`)
      } catch (e) {
        if (e instanceof Error && e.message === 'INVALID_URL') {
          setError('这不是一个可以保存的链接。')
          return
        }
        setError(errorMessage(e, '保存失败，请稍后重试。'))
      }
    })()
  }, [url, rawHint, router, toast])

  return (
    <Screen>
      <View className="flex-1 px-4" style={{ paddingBottom: insets.bottom }}>
        <View className="h-14" />
        {!url ? (
          <View className="mt-6">
            <Text className="text-title font-semibold text-ink">没有可保存的链接。</Text>
            <Text className="mt-2 text-body-sm text-muted">
              这次分享里没有找到网页地址。回到首页，可以手动粘贴链接或分享文字。
            </Text>
            <View className="mt-6 self-start">
              <Button label="回到首页" onPress={() => router.replace('/')} size="sm" />
            </View>
          </View>
        ) : error ? (
          <View className="mt-6">
            <Text className="text-title font-semibold text-ink">保存没有完成。</Text>
            <Text className="mt-2 text-body-sm text-muted">{error}</Text>
            <View className="mt-6 self-start">
              <Button label="回到首页" onPress={() => router.replace('/')} size="sm" />
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
