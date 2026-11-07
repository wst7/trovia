import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { DocumentSummary, ParseStatus, SearchResult } from '@trovia/shared'
import { queryTerms } from '../local/terms'
import { useT } from '../i18n'
import { errorText } from '../i18n/errors'

import { TAB_BAR_HEIGHT } from '../components/AppTabBar'
import { Composer } from '../components/Composer'
import type { SaveResult } from '../components/Composer'
import { RecentRow, ResultRow } from '../components/RecordRow'
import { loadLlmState } from '../local/llm'
import { processPendingQueue } from '../local/pipeline'
import * as repo from '../local/repo'
import { useLocalRevision } from '../local/useLocalRevision'
import { useToast } from '../providers/ToastProvider'
import { TextButton } from '../ui/Button'
import { Divider } from '../ui/Divider'
import { GUTTER, Screen } from '../ui/Screen'
import { usePalette } from '../ui/palette'

const RECENT_LIMIT = 4

export function HomeScreen() {
  const t = useT()
  const router = useRouter()
  const { toast } = useToast()
  const revision = useLocalRevision()
  // 深链直接搜索：trovia:///?q=… 由分享扩展、快捷指令或浏览器扩展调用。
  const routeParams = useLocalSearchParams<{ q?: string }>()
  const insets = useSafeAreaInsets()
  const p = usePalette()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  // 引擎对这次查询的理解，例如「昨天保存的」；直接显示，用户才知道我按什么找的。
  const [interpretation, setInterpretation] = useState<string | null>(null)
  // 抓取失败/被站点拦下的条目没有正文，只能按标题命中——搜索结果里要说清楚。
  const bodylessCount = (results ?? []).filter((item) => item.parse_status === 'failed').length
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [lastQuery, setLastQuery] = useState('')
  // 结果里要标出「为什么这条算命中」，词来自用户输入本身，不用模型的解释。
  const highlightTerms = useMemo(() => queryTerms(lastQuery), [lastQuery])
  const [recent, setRecent] = useState<DocumentSummary[]>([])
  const [stats, setStats] = useState<repo.DocumentStats | null>(null)
  const [writing, setWriting] = useState(false)
  // 「问模型」开关：默认关，交给用户显式打开（大模型是可选项）。
  const [askMode, setAskMode] = useState(false)
  const [llmReady, setLlmReady] = useState(false)

  const inResults = lastQuery.length > 0
  const bottomPad = insets.bottom + TAB_BAR_HEIGHT + 24

  // 首页聚焦时把积压的本机任务推进一轮（保存、分享、重试都走这里）。
  useFocusEffect(
    useCallback(() => {
      void processPendingQueue()
    }, []),
  )

  useEffect(() => {
    void loadLlmState()
      .then((state) => setLlmReady(state.enabled))
      .catch(() => setLlmReady(false))
  }, [revision])

  // 最近收藏：只在首页空态出现，四条，够「想起来」即可。
  useEffect(() => {
    if (inResults) return
    let cancelled = false
    void Promise.all([
      repo.listDocuments({ page: 1, pageSize: RECENT_LIMIT, keyword: '' }),
      repo.documentStats(),
    ])
      .then(([res, nextStats]) => {
        if (cancelled) return
        setRecent(res.items)
        setStats(nextStats)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [revision, inResults])

  // 本地数据变化（例如刚保存的那篇解析完成）时，刷新当前搜索结果。
  useEffect(() => {
    if (!lastQuery) return
    let cancelled = false
    void repo
      .searchDocuments(lastQuery)
      .then((next) => {
        if (cancelled) return
        setResults(next.results)
        setInterpretation(next.interpretation)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [revision, lastQuery])

  useEffect(() => {
    const seeded = typeof routeParams.q === 'string' ? routeParams.q.trim() : ''
    if (!seeded) return
    setQuery(seeded)
    setLastQuery(seeded)
    void repo.searchDocuments(seeded).then((outcome) => {
      setResults(outcome.results)
      setInterpretation(outcome.interpretation)
    })
  }, [routeParams.q])

  async function runSearch(text?: string) {
    const q = (text ?? query).trim()
    if (!q || searching) return
    // 开了「问模型」：不像链接的输入交给模型，在收藏里找完再答。
    if (askMode) {
      router.push(`/ask?q=${encodeURIComponent(q)}`)
      return
    }
    setSearching(true)
    setSearchError(null)
    setLastQuery(q)
    setResults(null)
    try {
      const outcome = await repo.searchDocuments(q)
      setResults(outcome.results)
      setInterpretation(outcome.interpretation)
    } catch (e) {
      setSearchError(errorText(e, t('home.toast.searchFailed')))
    } finally {
      setSearching(false)
    }
  }

  function clearSearch() {
    setResults(null)
    setInterpretation(null)
    setSearchError(null)
    setLastQuery('')
    setQuery('')
  }

  async function handleSave(url: string, titleHint: string | null): Promise<SaveResult | null> {
    setWriting(true)
    try {
      const res = await repo.createDocument(url, titleHint)
      if (res.duplicate) {
        toast(t('home.toast.duplicate'), {
          action: {
            label: t('home.toast.openExisting'),
            onPress: () => router.push(`/documents/${res.id}`),
          },
        })
      } else {
        setQuery('')
        toast(t('home.toast.saved'), { type: 'success' })
        void processPendingQueue()
      }
      return { id: res.id, duplicate: res.duplicate }
    } catch (e) {
      if (e instanceof Error && e.message === 'INVALID_URL') {
        toast(t('composer.invalidUrl'), { type: 'error' })
      } else {
        toast(errorText(e, t('composer.saveFailed')), { type: 'error' })
      }
      return null
    } finally {
      setWriting(false)
    }
  }

  function handleTerminal(status: ParseStatus) {
    if (status === 'completed') {
      toast(t('home.toast.completed'), { type: 'success' })
      return
    }
    if (status === 'failed') {
      toast(t('status.failed'), { type: 'error' })
      return
    }
    toast(t('status.partial'), { type: 'warning' })
  }

  const composer = (
    <Composer
      value={query}
      onChangeText={setQuery}
      onSearch={() => void runSearch()}
      ask={askMode}
      askAvailable={llmReady}
      onSelectMode={(mode) => setAskMode(mode === 'ai')}
      onAskNeedsSetup={() =>
        toast(t('ask.off'), {
          action: { label: t('ask.openSettings'), onPress: () => router.push('/settings/llm') },
        })
      }
      onSave={handleSave}
      searching={searching || writing}
    />
  )

  return (
    <Screen>
      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: bottomPad }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View className="h-14 justify-center">
            <Text className="text-body-sm font-medium text-muted">Trovia</Text>
          </View>

          {inResults ? (
            <>
              <View className="mt-1 flex-row items-center justify-between">
                <Text className="text-body-sm text-muted">
                  {searching
                    ? t('home.searching')
                    : interpretation
                      ? t('home.foundUnderstood', {
                          interpretation,
                          count: results?.length ?? 0,
                        })
                      : t('home.found', { count: results?.length ?? 0 })}
                </Text>
                <TextButton label={t('common.clear')} onPress={clearSearch} tone="muted" />
              </View>
              {!searching && (results?.length ?? 0) > 0 && bodylessCount > 0 ? (
                <Text className="mt-1 text-caption text-faint">
                  {t('home.bodyless', { count: bodylessCount })}
                </Text>
              ) : null}
              <View className="mt-1">{composer}</View>

              {searchError ? (
                <Text className="mt-4 text-body-sm text-danger">{searchError}</Text>
              ) : null}

              {searching && results === null ? (
                <View className="mt-10 items-center">
                  <ActivityIndicator size="small" color={p.muted} />
                </View>
              ) : results !== null && results.length === 0 ? (
                <View className="mt-10">
                  <Text className="text-body text-ink">
                    {interpretation
                      ? t('home.emptyWithInterpretation', { interpretation })
                      : t('home.empty')}
                  </Text>
                  <Text className="mt-1 text-body-sm text-muted">
                    {interpretation
                      ? t('home.emptyHintWithInterpretation')
                      : t('home.emptyHint')}
                  </Text>
                  {/* 用户不会猜出「今天」「上周」这种说法能当条件用，空结果时给几个能点的话。 */}
                  <View className="mt-5 flex-row flex-wrap items-center">
                    {(interpretation
                      ? [
                          t('home.example.thisMonth'),
                          t('home.example.anyTime'),
                          t('home.example.lastWeek'),
                        ]
                      : [
                          t('home.example.today'),
                          t('home.example.lastWeek'),
                          t('home.example.thisMonth'),
                        ]
                    ).map((example) => (
                      <View key={example} className="mr-5">
                        <TextButton
                          label={example}
                          onPress={() => {
                            setQuery(example)
                            void runSearch(example)
                          }}
                          tone="muted"
                        />
                      </View>
                    ))}
                  </View>
                </View>
              ) : results ? (
                <View className="mt-2">
                  {results
                    .filter((item) => item.match_kind !== 'semantic')
                    .map((item, index) => (
                      <View key={item.document_id}>
                        {index > 0 ? <Divider /> : null}
                        <ResultRow
                          item={item}
                          terms={highlightTerms}
                          onPress={() => router.push(`/documents/${item.document_id}`)}
                          onTerminal={handleTerminal}
                        />
                      </View>
                    ))}
                  {results.some((item) => item.match_kind === 'semantic') ? (
                    <View className="mt-5">
                      <Text className="text-caption text-faint">
                        {t('home.semantic')}
                      </Text>
                      {results
                        .filter((item) => item.match_kind === 'semantic')
                        .map((item, index) => (
                          <View key={item.document_id}>
                            {index > 0 ? <Divider /> : null}
                            <ResultRow
                              item={item}
                              terms={highlightTerms}
                              onPress={() => router.push(`/documents/${item.document_id}`)}
                              onTerminal={handleTerminal}
                            />
                          </View>
                        ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </>
          ) : (
            <>
              {/* 首页只有一句话要有重量：它是这个 App 唯一的产品说明。 */}
              <View className="mt-6">
                <Text className="text-[30px] font-semibold leading-[38px] tracking-[-0.4px] text-ink">
                  {t('home.title')}
                </Text>
              </View>

              <View className="mt-7">{composer}</View>


              {stats && stats.total > 0 ? (
                <View className="mt-8 flex-row items-baseline gap-2">
                  <Text className="text-body-sm text-muted">
                    {t('home.stats.saved', { count: stats.total })}
                  </Text>
                  {stats.processing > 0 ? (
                    <Text className="text-body-sm text-muted">
                      {t('home.stats.processing', { count: stats.processing })}
                    </Text>
                  ) : null}
                  {stats.failed > 0 ? (
                    <Text className="text-body-sm text-muted">
                      {t('home.stats.failed', { count: stats.failed })}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {recent.length > 0 ? (
                <View className="mt-10">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-body font-semibold text-ink">{t('home.recent')}</Text>
                  </View>
                  <View className="mt-1">
                    {recent.map((item) => (
                      <View key={item.id} className="mb-2">
                        <RecentRow
                          item={item}
                          onPress={() => router.push(`/documents/${item.id}`)}
                          onTerminal={handleTerminal}
                          showDate={false}
                        />
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}
