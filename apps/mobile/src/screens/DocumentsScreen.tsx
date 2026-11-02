import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { DocumentSummary, ParseStatus } from '@xunji/shared'
import { errorMessage, STATUS_TEXT } from '@xunji/shared'

import { AppTabBar, TAB_BAR_HEIGHT } from '../components/AppTabBar'
import { RecentRow } from '../components/RecordRow'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { subscribeChange } from '../local/bus'
import { dayLabel } from '../local/dates'
import { processPendingQueue } from '../local/pipeline'
import * as repo from '../local/repo'
import { useToast } from '../providers/ToastProvider'
import { TextButton } from '../ui/Button'
import { Divider } from '../ui/Divider'
import { GUTTER, Screen } from '../ui/Screen'
import { SearchInput } from '../ui/SearchInput'
import { usePalette } from '../ui/palette'

const PAGE_SIZE = 20

export function DocumentsScreen() {
  const router = useRouter()
  const { toast } = useToast()
  const insets = useSafeAreaInsets()
  const p = usePalette()

  const [keywordInput, setKeywordInput] = useState('')
  const [items, setItems] = useState<DocumentSummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryable, setRetryable] = useState(0)
  const [retrying, setRetrying] = useState(false)

  const keyword = useDebouncedValue(keywordInput.trim(), 300)
  const requestSeq = useRef(0)
  const bottomPad = insets.bottom + TAB_BAR_HEIGHT + 24

  const load = useCallback(
    async (nextPage: number, mode: 'replace' | 'append') => {
      const seq = requestSeq.current + 1
      requestSeq.current = seq
      if (mode === 'replace') setLoading(true)
      else setLoadingMore(true)

      try {
        const res = await repo.listDocuments({ page: nextPage, pageSize: PAGE_SIZE, keyword })
        if (seq !== requestSeq.current) return
        setItems((current) => (mode === 'replace' ? res.items : [...current, ...res.items]))
        setTotal(res.total)
        setPage(nextPage)
        setError(null)
        void repo.countRetryableFailed().then(setRetryable).catch(() => undefined)
      } catch (e) {
        if (seq !== requestSeq.current) return
        setError(errorMessage(e, '加载收藏列表失败，请稍后重试。'))
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false)
          setLoadingMore(false)
          setRefreshing(false)
        }
      }
    },
    [keyword],
  )

  useEffect(() => {
    void load(1, 'replace')
  }, [load])

  const reload = useCallback(() => {
    void load(1, 'replace')
  }, [load])

  // 从详情页返回时刷新，删除或重新解析后的状态才能反映到列表。
  const loadRef = useRef(load)
  loadRef.current = load
  const firstFocus = useRef(true)
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false
        return
      }
      void loadRef.current(1, 'replace')
    }, []),
  )

  // 后台整理会改状态，列表跟着变，不用手动下拉。
  // 只在第一页自动刷新：用户翻到很后面时把列表冲回顶部比不刷新更烦。
  const pageRef = useRef(1)
  pageRef.current = page
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    return subscribeChange(() => {
      if (pageRef.current !== 1) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void loadRef.current(1, 'replace'), 800)
    })
  }, [])

  async function handleRetryFailed() {
    if (retrying) return
    setRetrying(true)
    try {
      const count = await repo.retryFailedBatch()
      if (count === 0) {
        toast('没有可以重试的条目。', { type: 'warning' })
        return
      }
      setRetrying(false)
      toast(`已重新排队 ${count} 条，正在后台整理。`, { type: 'success' })
      reload()
      void processPendingQueue()
    } catch {
      toast('重试没有启动，请稍后再试。', { type: 'error' })
    } finally {
      setRetrying(false)
    }
  }

  function handleTerminal(status: ParseStatus) {
    if (status === 'completed') {
      toast('已完成整理，可以通过描述内容搜索它。', { type: 'success' })
    } else if (status === 'failed') {
      toast(STATUS_TEXT.failed, { type: 'error' })
    } else {
      toast(STATUS_TEXT.partial, { type: 'warning' })
    }
    reload()
  }

  const hasMore = items.length < total
  const unit = loading ? '正在加载…' : keyword ? '条匹配' : '条内容'

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(doc) => doc.id}
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: bottomPad }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true)
              void load(1, 'replace')
            }}
            tintColor={p.muted}
            colors={[p.accent]}
            progressBackgroundColor={p.surface}
          />
        }
        ListHeaderComponent={
          <View>
            <View className="mt-4 flex-row items-baseline gap-2">
              <Text className="text-heading font-semibold text-ink">
                {loading ? '—' : total}
              </Text>
              <Text className="text-body-sm text-muted">{unit}</Text>
            </View>

            {retryable > 0 ? (
              <View className="mt-3 flex-row items-center justify-between">
                <Text className="flex-1 text-caption text-muted">
                  {retryable} 条没整理成功，多数是当时没能连上站点
                </Text>
                <TextButton
                  label={retrying ? '正在排队…' : '重试'}
                  onPress={() => void handleRetryFailed()}
                />
              </View>
            ) : null}

            <View className="mt-6">
              <SearchInput
                value={keywordInput}
                onChangeText={setKeywordInput}
                accessibilityLabel="按关键词筛选"
              />
            </View>

            {error ? (
              <View className="mt-4 flex-row items-center justify-between">
                <Text className="flex-1 text-body-sm text-danger">{error}</Text>
                <TextButton label="重试" onPress={reload} />
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => {
          const label = dayLabel(item.saved_at)
          const previous = index > 0 ? dayLabel(items[index - 1].saved_at) : null
          return (
          <View>
            {label && label !== previous ? (
              <Text className="mt-5 mb-2 text-caption font-medium text-faint">{label}</Text>
            ) : null}
            <RecentRow
              item={item}
              onPress={() => router.push(`/documents/${item.id}`)}
              onTerminal={handleTerminal}
              showDate={false}
            />
            <Divider />
          </View>
          )
        }}
        ListEmptyComponent={
          loading ? (
            <View className="mt-10 items-center">
              <ActivityIndicator size="small" color={p.muted} />
            </View>
          ) : error ? undefined : (
            <View className="mt-10">
              <Text className="text-body text-ink">
                {keyword ? '没有匹配的收藏。' : '还没有收藏。'}
              </Text>
              <Text className="mt-1 text-body-sm text-muted">
                {keyword
                  ? '换一个关键词，或者清除筛选。'
                  : '回到首页粘贴第一个链接，Trovia 会自动整理。'}
              </Text>
              <View className="mt-4 self-start">
                <TextButton
                  label={keyword ? '清除筛选' : '回到首页'}
                  onPress={() => (keyword ? setKeywordInput('') : router.replace('/'))}
                />
              </View>
            </View>
          )
        }
        ListFooterComponent={
          hasMore ? (
            <View className="mt-4 items-center">
              {loadingMore ? (
                <ActivityIndicator size="small" color={p.muted} />
              ) : (
                <TextButton
                  label="加载更多"
                  onPress={() => {
                    if (!loadingMore && !loading) void load(page + 1, 'append')
                  }}
                  tone="muted"
                />
              )}
            </View>
          ) : undefined
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (hasMore && !loading && !loadingMore) void load(page + 1, 'append')
        }}
      />
      <AppTabBar active="documents" />
    </Screen>
  )
}
