/**
 * 「问模型」这一屏：问一句，模型在本地收藏里找，然后给答复并列出出处。
 *
 * 不追求聊天记录：一次问一个问题，答案和出处都在同一屏，
 * 看完了点一条出处就能回到原文。工具调用的过程也摆出来——
 * 用户得知道模型到底翻了什么，才敢信它说的话。
 */
import { useCallback, useEffect, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native'
import { Text } from '../ui/text'

import { useT } from '../i18n'
import { askLibraryLive } from '../local/assistant-live'
import type { AssistantResult, Citation, ToolStep } from '../local/assistant'
import { Screen, GUTTER } from '../ui/Screen'
import { Divider } from '../ui/Divider'
import { usePalette } from '../ui/palette'

function stepLabel(step: ToolStep, t: ReturnType<typeof useT>): string {
  if (step.name === 'search_library') {
    const q = typeof step.args.query === 'string' ? step.args.query : ''
    return t('ask.step.search', { q, n: step.hits })
  }
  if (step.name === 'read_document') return t('ask.step.read', { title: String(step.args.id ?? '').slice(0, 18) })
  if (step.name === 'list_recent') return t('ask.step.recent', { days: String(step.args.days ?? 7) })
  return t('ask.step.stats')
}

export function AskScreen() {
  const t = useT()
  const router = useRouter()
  const p = usePalette()
  const params = useLocalSearchParams<{ q?: string }>()
  const question = typeof params.q === 'string' ? params.q : ''

  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<ToolStep[]>([])
  const [result, setResult] = useState<AssistantResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    if (!question.trim()) return
    setRunning(true)
    setError(null)
    setResult(null)
    setSteps([])
    try {
      const outcome = await askLibraryLive(question, (step) =>
        setSteps((current) => [...current, step]),
      )
      setResult(outcome)
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      setError(t('ask.failed', { reason }))
    } finally {
      setRunning(false)
    }
  }, [question, t])

  useEffect(() => {
    void run()
  }, [run])

  return (
    <Screen>
      <View className="flex-row items-center justify-between px-[22px] pt-2">
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Text className="text-body text-muted">{t('detail.back')}</Text>
        </Pressable>
        <Text className="text-caption tracking-[0.14em] text-faint">{t('ask.title').toUpperCase()}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 48 }}>
        <Text className="mt-5 font-serif text-[26px] leading-[36px] text-ink">{question}</Text>

        {steps.length > 0 ? (
          <View className="mt-5">
            {steps.map((step, index) => (
              <Text key={`${step.name}-${index}`} className="text-caption text-muted">
                · {stepLabel(step, t)}
              </Text>
            ))}
          </View>
        ) : null}

        {running ? (
          <View className="mt-6 flex-row items-center gap-2">
            <ActivityIndicator size="small" color={p.accent} />
            <Text className="text-body-sm text-muted">{t('ask.thinking')}</Text>
          </View>
        ) : null}

        {error ? (
          <View className="mt-6">
            <Text className="text-body text-ink">{error}</Text>
            <View className="mt-4 flex-row gap-5">
              <Pressable onPress={() => void run()} hitSlop={8}>
                <Text className="text-body text-accent">{t('ask.retry')}</Text>
              </Pressable>
              <Pressable onPress={() => router.replace(`/?q=${encodeURIComponent(question)}`)} hitSlop={8}>
                <Text className="text-body text-muted">{t('ask.fallback')}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {result ? (
          <>
            <Text className="mt-6 text-[17px] leading-[28px] text-ink">
              {result.answer || t('ask.empty')}
            </Text>

            {result.citations.length > 0 ? (
              <View className="mt-8">
                <Text className="text-caption tracking-[0.14em] text-faint">
                  {t('ask.citations')}
                </Text>
                <Divider className="mt-2" />
                {result.citations.map((item: Citation, index) => (
                  <Pressable
                    key={item.id}
                    onPress={() => router.push(`/documents/${item.id}`)}
                    className="border-b border-line py-3"
                  >
                    <Text className="text-body text-ink" numberOfLines={2}>
                      {index + 1}. {item.title ?? item.id}
                    </Text>
                    <Text className="mt-1 text-caption text-muted">
                      {[item.site, item.savedAt].filter(Boolean).join(' · ')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View className="mt-8 flex-row gap-5">
              <Pressable onPress={() => void run()} hitSlop={8}>
                <Text className="text-body text-accent">{t('ask.retry')}</Text>
              </Pressable>
              <Pressable onPress={() => router.replace(`/?q=${encodeURIComponent(question)}`)} hitSlop={8}>
                <Text className="text-body text-muted">{t('ask.fallback')}</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  )
}
