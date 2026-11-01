import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { DocumentSummary, ParseStatus } from '@xunji/shared'
import { errorMessage, STATUS_TEXT } from '@xunji/shared'

import { AppTabBar, TAB_BAR_HEIGHT } from '../components/AppTabBar'
import { RecentRow } from '../components/RecordRow'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
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
              <Text className="text-display font-semibold text-ink">
                {loading ? '—' : total}
              </Text>
              <Text className="text-body-sm text-muted">{unit}</Text>
            </View>

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
        renderItem={({ item }) => (
          <View>
            <RecentRow
              item={item}
              onPress={() => router.push(`/documents/${item.id}`)}
              onTerminal={handleTerminal}
            />
            <Divider />
          </View>
        )}
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
                  : '回到首页粘贴第一个链接，寻迹会自动整理。'}
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
