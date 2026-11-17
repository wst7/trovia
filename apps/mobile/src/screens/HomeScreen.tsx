import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { DocumentSummary, ParseStatus, SearchResult } from '@trovia/shared'
import { queryTerms } from '../local/terms'
import { scheduleSyncAfterSave } from '../local/auto-sync'
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
import { opLog } from '../local/dev-log'
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
  // Deep link straight into search: trovia:///?q=…, called by the share extension, Shortcuts or the browser extension.
  const routeParams = useLocalSearchParams<{ q?: string }>()
  const insets = useSafeAreaInsets()
  const p = usePalette()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  // The engine's reading of this query, e.g. "saved yesterday"; show it directly so the user knows what it searched by.
  const [interpretation, setInterpretation] = useState<string | null>(null)
  // Items that failed to fetch or were blocked have no body and can only match on the title — the results must say so.
  const bodylessCount = (results ?? []).filter((item) => item.parse_status === 'failed').length
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [lastQuery, setLastQuery] = useState('')
  // Results mark "why this one counts as a hit"; the terms come from the user's own input, not the model's explanation.
  const highlightTerms = useMemo(() => queryTerms(lastQuery), [lastQuery])
  const [recent, setRecent] = useState<DocumentSummary[]>([])
  const [stats, setStats] = useState<repo.DocumentStats | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [writing, setWriting] = useState(false)
  // The model entry card is shown on home; whether it is configured decides whether tapping it opens chat or settings.
  const [llmReady, setLlmReady] = useState(false)

  const inResults = lastQuery.length > 0
  const bottomPad = insets.bottom + TAB_BAR_HEIGHT + 24

  // On home focus, push the backlog of on-device jobs forward one round (save, share and retry all go through here).
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

  // Recent saves: shown only in the home empty state, four of them, enough to jog the memory.
  useEffect(() => {
    if (inResults) return
    let cancelled = false
    void Promise.all([
      repo.listDocuments({ page: 1, pageSize: RECENT_LIMIT, keyword: '' }),
      repo.documentStats(),
      repo.suggestSearchTerms(),
    ])
      .then(([res, nextStats, nextSuggestions]) => {
        if (cancelled) return
        setRecent(res.items)
        setStats(nextStats)
        setSuggestions(nextSuggestions)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [revision, inResults])

  // The single place a search runs: on a new query, and again when local data
  // changes (the article just saved finished parsing). It used to be started
  // here and inside runSearch, so every query ran twice — the diagnostics log
  // shows identical op.search lines a few hundred milliseconds apart.
  useEffect(() => {
    if (!lastQuery) return
    let cancelled = false
    setSearching(true)
    setSearchError(null)
    void repo
      .searchDocuments(lastQuery)
      .then((next) => {
        if (cancelled) return
        setResults(next.results)
        setInterpretation(next.interpretation)
      })
      .catch((error) => {
        if (cancelled) return
        setSearchError(errorText(error, t('home.toast.searchFailed')))
      })
      .finally(() => {
        if (!cancelled) setSearching(false)
      })
    return () => {
      cancelled = true
    }
  }, [revision, lastQuery, t])

  useEffect(() => {
    const seeded = typeof routeParams.q === 'string' ? routeParams.q.trim() : ''
    if (!seeded) return
    setQuery(seeded)
    setResults(null)
    setLastQuery(seeded)
  }, [routeParams.q])

  function runSearch(text?: string) {
    const q = (text ?? query).trim()
    if (!q || searching) return
    // Setting the query is enough; the effect above performs the search once.
    setResults(null)
    setLastQuery(q)
  }

  function clearSearch() {
    setResults(null)
    setInterpretation(null)
    setSearchError(null)
    setLastQuery('')
    setQuery('')
  }

  async function handleSave(url: string, titleHint: string | null): Promise<SaveResult | null> {
    // Taps are the one thing the log never recorded, which is exactly what makes
    // "I did something and nothing happened" impossible to reconstruct later.
    await opLog('save.start', { url })
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
        // Sync once a bit after saving: several saves within 8 seconds are merged into one round.
        scheduleSyncAfterSave()
      }
      await opLog('save.done', { id: res.id, duplicate: res.duplicate })
      return { id: res.id, duplicate: res.duplicate }
    } catch (e) {
      await opLog('save.fail', { url }, e)
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
          <View className="flex-row items-center justify-between" style={{ height: 52 }}>
            <Text className="text-[19px] font-semibold tracking-[-0.38px] text-ink">Trovia</Text>
            <Text className="text-[13px] text-faint">
              {inResults
                ? t('home.found', { count: results?.length ?? 0 })
                : stats
                  ? t('home.total', { count: stats.total })
                  : ''}
            </Text>
          </View>

          {inResults ? (
            <>
              <View className="mt-3">{composer}</View>
              <View className="mt-3 flex-row items-center justify-between">
                <Text className="flex-1 text-[12.5px] text-faint">
                  {searching
                    ? t('home.searching')
                    : interpretation
                      ? t('home.foundUnderstood', {
                          interpretation,
                          count: results?.length ?? 0,
                        })
                      : ''}
                </Text>
                <TextButton label={t('common.clear')} onPress={clearSearch} tone="muted" />
              </View>
              {!searching && (results?.length ?? 0) > 0 && bodylessCount > 0 ? (
                <Text className="mt-1 text-caption text-faint">
                  {t('home.bodyless', { count: bodylessCount })}
                </Text>
              ) : null}

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
                  {/* Users won't guess that "today" or "last week" work as conditions, so offer a few tappable phrases on an empty result. */}
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
                          onPress={() =>
                            router.push(
                              `/documents/${item.document_id}${
                                item.matched_excerpt
                                  ? `?hit=${encodeURIComponent(item.matched_excerpt)}`
                                  : ''
                              }`,
                            )
                          }
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
                              onPress={() =>
                            router.push(
                              `/documents/${item.document_id}${
                                item.matched_excerpt
                                  ? `?hit=${encodeURIComponent(item.matched_excerpt)}`
                                  : ''
                              }`,
                            )
                          }
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
              <View className="mt-1.5">
                <Text className="text-label uppercase text-faint">{t('home.kicker')}</Text>
                <Text className="mt-2.5 text-display font-semibold text-ink">
                  {t('home.title')}
                </Text>
                <Text className="mt-2.5 text-body-sm text-muted">{t('home.subtitle')}</Text>
              </View>

              <View className="mt-5">{composer}</View>

              {stats && stats.total > 0 ? (
                <View className="mt-4 flex-row items-center gap-2">
                  <Text className="text-[12.5px] text-faint">
                    {t('home.stats.saved', { count: stats.total })}
                  </Text>
                  {stats.processing > 0 ? (
                    <>
                      <View className="h-0.5 w-0.5 rounded-full bg-line-strong" />
                      <Text className="text-[12.5px] text-faint">
                        {t('home.stats.processing', { count: stats.processing }).replace(/^·\s*/, '')}
                      </Text>
                    </>
                  ) : null}
                  {stats.failed > 0 ? (
                    <>
                      <View className="h-0.5 w-0.5 rounded-full bg-line-strong" />
                      <Text className="text-[12.5px] text-faint">
                        {t('home.stats.failed', { count: stats.failed }).replace(/^·\s*/, '')}
                      </Text>
                    </>
                  ) : null}
                </View>
              ) : null}

              <Pressable
                onPress={() => {
                  if (!llmReady) {
                    toast(t('ask.off'), {
                      action: {
                        label: t('ask.openSettings'),
                        onPress: () => router.push('/settings/llm'),
                      },
                    })
                    return
                  }
                  router.push('/ask')
                }}
                accessibilityRole="button"
                accessibilityLabel={t('home.ask.title')}
                className="mt-3.5 flex-row items-center gap-3 rounded-[14px] bg-sunken px-[15px] py-3.5"
              >
                <View className="h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-surface">
                  <Ionicons name="sparkles-outline" size={16} color={p.muted} />
                </View>
                <View className="flex-1">
                  <Text className="text-[14px] font-semibold tracking-[-0.14px] text-ink">
                    {t('home.ask.title')}
                  </Text>
                  <Text className="mt-0.5 text-[12px] text-faint">{t('home.ask.subtitle')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={p.faint} />
              </Pressable>

              {recent.length > 0 ? (
                <View className="mt-8">
                  <View className="flex-row items-baseline justify-between">
                    <Text className="text-[15px] font-semibold tracking-[-0.15px] text-ink">
                      {t('home.recent')}
                    </Text>
                    <Pressable
                      onPress={() => router.push('/documents')}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={t('home.all', { count: stats?.total ?? recent.length })}
                    >
                      <Text className="text-[13px] text-faint">
                        {t('home.all', { count: stats?.total ?? recent.length })}
                      </Text>
                    </Pressable>
                  </View>
                  <View className="mt-1">
                    {recent.map((item, index) => (
                      // Same hairline as the saved list: rows of one component should
                      // not look like cards on one screen and a table on another.
                      <View key={item.id}>
                        <RecentRow
                          item={item}
                          onPress={() => router.push(`/documents/${item.id}`)}
                          onTerminal={handleTerminal}
                        />
                        {index === recent.length - 1 ? null : <View className="h-px bg-line" />}
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
              {suggestions.length > 0 ? (
                <View className="mt-7">
                  <Text className="text-label uppercase text-faint">{t('home.suggestions')}</Text>
                  <View className="mt-2 flex-row flex-wrap gap-2">
                    {suggestions.map((term) => (
                      <Pressable
                        key={term}
                        onPress={() => {
                          setQuery(term)
                          void runSearch(term)
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={t('home.suggestionA11y', { term })}
                        className="h-[33px] justify-center rounded-[10px] bg-sunken px-[13px]"
                      >
                        <Text className="text-[13px] text-muted">{term}</Text>
                      </Pressable>
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
