import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { DocumentSummary, ParseStatus, SearchResult } from '@xunji/shared'
import { errorMessage, STATUS_TEXT } from '@xunji/shared'

import { AppTabBar, TAB_BAR_HEIGHT } from '../components/AppTabBar'
import { Composer } from '../components/Composer'
import type { SaveResult } from '../components/Composer'
import { RecentRow, ResultRow } from '../components/RecordRow'
import { processPendingQueue } from '../local/pipeline'
import * as repo from '../local/repo'
import { useLocalRevision } from '../local/useLocalRevision'
import { useToast } from '../providers/ToastProvider'
import { TextButton } from '../ui/Button'
import { Divider } from '../ui/Divider'
import { GUTTER, Screen } from '../ui/Screen'
import { usePalette } from '../ui/palette'

const RECENT_LIMIT = 4

function terminalToastContent(status: ParseStatus): {
  message: string
  type: 'success' | 'warning' | 'error'
} {
  switch (status) {
    case 'completed':
      return { message: '已完成整理，可以通过描述内容搜索它。', type: 'success' }
    case 'failed':
      return { message: STATUS_TEXT.failed, type: 'error' }
    default:
      return { message: STATUS_TEXT.partial, type: 'warning' }
  }
}

export function HomeScreen() {
  const router = useRouter()
  const { toast } = useToast()
  const revision = useLocalRevision()
  // 深链直接搜索：xunji:///?q=… 由分享扩展、快捷指令或浏览器扩展调用。
  const routeParams = useLocalSearchParams<{ q?: string }>()
  const insets = useSafeAreaInsets()
  const p = usePalette()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  // 引擎对这次查询的理解，例如「昨天保存的」；直接显示，用户才知道我按什么找的。
  const [interpretation, setInterpretation] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [lastQuery, setLastQuery] = useState('')
  const [recent, setRecent] = useState<DocumentSummary[]>([])
  const [writing, setWriting] = useState(false)

  const inResults = lastQuery.length > 0
  const bottomPad = insets.bottom + TAB_BAR_HEIGHT + 24

  // 首页聚焦时把积压的本机任务推进一轮（保存、分享、重试都走这里）。
  useFocusEffect(
    useCallback(() => {
      void processPendingQueue()
    }, []),
  )

  // 最近收藏：只在首页空态出现，四条，够「想起来」即可。
  useEffect(() => {
    if (inResults) return
    let cancelled = false
    void repo
      .listDocuments({ page: 1, pageSize: RECENT_LIMIT, keyword: '' })
      .then((res) => {
        if (!cancelled) setRecent(res.items)
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

  async function runSearch() {
    const q = query.trim()
    if (!q || searching) return
    setSearching(true)
    setSearchError(null)
    setLastQuery(q)
    setResults(null)
    try {
      const outcome = await repo.searchDocuments(q)
      setResults(outcome.results)
      setInterpretation(outcome.interpretation)
    } catch (e) {
      setSearchError(errorMessage(e, '搜索暂时不可用，请稍后重试。'))
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
        toast('这篇内容已经保存过了。', {
          action: {
            label: '打开已有收藏',
            onPress: () => router.push(`/documents/${res.id}`),
          },
        })
      } else {
        setQuery('')
        toast('已保存，正在本机整理内容……', { type: 'success' })
        void processPendingQueue()
      }
      return { id: res.id, duplicate: res.duplicate }
    } catch (e) {
      if (e instanceof Error && e.message === 'INVALID_URL') {
        toast('这不是一个可以保存的链接。', { type: 'error' })
      } else {
        toast(errorMessage(e, '保存失败，请稍后重试。'), { type: 'error' })
      }
      return null
    } finally {
      setWriting(false)
    }
  }

  function handleTerminal(status: ParseStatus) {
    const content = terminalToastContent(status)
    toast(content.message, { type: content.type })
  }

  const composer = (
    <Composer
      value={query}
      onChangeText={setQuery}
      onSearch={() => void runSearch()}
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
            <Text className="text-body-sm font-medium text-muted">寻迹</Text>
          </View>

          {inResults ? (
            <>
              <View className="mt-1 flex-row items-center justify-between">
                <Text className="text-body-sm text-muted">
                  {searching
                    ? '正在找回…'
                    : interpretation
                      ? `${interpretation} ${results?.length ?? 0} 条`
                      : `找到 ${results?.length ?? 0} 条`}
                </Text>
                <TextButton label="清除" onPress={clearSearch} tone="muted" />
              </View>
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
                    {interpretation ? `没有${interpretation}内容。` : '没有足够相关的内容。'}
                  </Text>
                  <Text className="mt-1 text-body-sm text-muted">
                    {interpretation
                      ? '换一天试试，或者直接描述你还记得的内容。'
                      : '换一种描述，或者把原链接粘到上面保存下来。'}
                  </Text>
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
                          onPress={() => router.push(`/documents/${item.document_id}`)}
                          onTerminal={handleTerminal}
                        />
                      </View>
                    ))}
                  {results.some((item) => item.match_kind === 'semantic') ? (
                    <View className="mt-5">
                      <Text className="text-caption text-faint">
                        意思相近，没有完全对上的词
                      </Text>
                      {results
                        .filter((item) => item.match_kind === 'semantic')
                        .map((item, index) => (
                          <View key={item.document_id}>
                            {index > 0 ? <Divider /> : null}
                            <ResultRow
                              item={item}
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
              <View className="mt-4">
                <Text className="text-heading font-semibold text-ink">想找点什么？</Text>
              </View>

              <View className="mt-6">{composer}</View>

              {recent.length > 0 ? (
                <View className="mt-10">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-body font-semibold text-ink">最近收藏</Text>
                  </View>
                  <View className="mt-1">
                    {recent.map((item, index) => (
                      <View key={item.id}>
                        {index > 0 ? <Divider /> : null}
                        <RecentRow
                          item={item}
                          onPress={() => router.push(`/documents/${item.id}`)}
                          onTerminal={handleTerminal}
                        />
                      </View>
                    ))}
                  </View>
                </View>
              ) : (
                <View className="mt-10">
                  <Text className="text-body-sm text-muted">
                    还没有收藏。把链接粘到上面，寻迹替你读完再存好。
                  </Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <AppTabBar active="home" />
    </Screen>
  )
}
