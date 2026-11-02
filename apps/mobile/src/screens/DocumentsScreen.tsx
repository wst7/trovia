import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import { ActivityIndicator, FlatList, Keyboard, RefreshControl, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { DocumentSummary, ParseStatus } from '@xunji/shared'
import { errorMessage, STATUS_TEXT } from '@xunji/shared'

import { TAB_BAR_HEIGHT } from '../components/AppTabBar'
import { RecentRow } from '../components/RecordRow'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { subscribeChange } from '../local/bus'
import { dayLabel } from '../local/dates'
import { processPendingQueue } from '../local/pipeline'
import * as repo from '../local/repo'
import { useToast } from '../providers/ToastProvider'
import { Button, TextButton } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
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
  const [failed, setFailed] = useState(0)
  const [retrying, setRetrying] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [failedOnly, setFailedOnly] = useState(false)

  const keyword = useDebouncedValue(keywordInput.trim(), 300)
  const requestSeq = useRef(0)
  const bottomPad = insets.bottom + TAB_BAR_HEIGHT + 40

  const load = useCallback(
    async (nextPage: number, mode: 'replace' | 'append') => {
      const seq = requestSeq.current + 1
      requestSeq.current = seq
      if (mode === 'replace') setLoading(true)
      else setLoadingMore(true)

      try {
        const res = await repo.listDocuments({
          page: nextPage,
          pageSize: PAGE_SIZE,
          keyword,
          failedOnly,
        })
        if (seq !== requestSeq.current) return
        setItems((current) => (mode === 'replace' ? res.items : [...current, ...res.items]))
        setTotal(res.total)
        setPage(nextPage)
        setError(null)
        void repo
          .documentStats()
          .then((stats) => setFailed(stats.failed))
          .catch(() => undefined)
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
    [keyword, failedOnly],
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

  function enterSelection(id: string) {
    // 键盘会盖住底部操作条，长按进多选时先收起来。
    Keyboard.dismiss()
    setSelecting(true)
    setSelected(new Set([id]))
  }

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitSelection() {
    Keyboard.dismiss()
    setSelecting(false)
    setSelected(new Set())
  }

  async function deleteSelected() {
    const ids = [...selected]
    setConfirmingDelete(false)
    exitSelection()
    try {
      for (const id of ids) await repo.deleteDocument(id)
      toast(ids.length === 1 ? '已删除。' : `已删除 ${ids.length} 条。`, { type: 'success' })
    } catch {
      toast('删除没有全部完成，剩下的还在列表里。', { type: 'error' })
    } finally {
      reload()
    }
  }

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
      const skipped = Math.max(0, failed - count)
      toast(
        skipped > 0
          ? `已重新排队 ${count} 条；另外 ${skipped} 条被站点拒绝，重试没有意义。`
          : `已重新排队 ${count} 条，正在后台整理。`,
        { type: 'success' },
      )
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
  const unit = loading ? '正在加载…' : keyword || failedOnly ? '条匹配' : '条内容'

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(doc) => doc.id}
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: bottomPad }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // 关掉 Android 默认的裁剪：列表很长时它能省内存，但滚动中单元格被反复
        // 挂载/卸载，实测更卡，且曾让图片缩略图出现空白。崩溃与此无关。
        removeClippedSubviews={false}
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
            {selecting ? (
              <View className="mt-4 flex-row items-center justify-between">
                <Text className="text-heading font-semibold text-ink">已选 {selected.size} 条</Text>
                <View className="flex-row items-center gap-4">
                  <TextButton
                    label={selected.size === items.length ? '取消全选' : '全选本页'}
                    onPress={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((item) => item.id)))}
                    tone="muted"
                  />
                  <TextButton label="完成" onPress={exitSelection} />
                </View>
              </View>
            ) : (
              <View className="mt-4 flex-row items-baseline gap-2">
                <Text className="text-[24px] font-semibold leading-[30px] tracking-[-0.3px] text-ink">
                  {loading ? '—' : total}
                </Text>
                <Text className="text-body-sm text-muted">{unit}</Text>
              </View>
            )}

            {failed > 0 ? (
              <View className="mt-3 flex-row items-center justify-between">
                <Text className="flex-1 text-body-sm text-muted" onPress={() => setFailedOnly((on) => !on)}>
                  {failedOnly ? '只看没能整理的，点这里回到全部' : `${failed} 条没能整理（含在 ${total} 条里）`}
                </Text>
                <TextButton
                  label={retrying ? '正在排队…' : '重试全部'}
                  onPress={() => void handleRetryFailed()}
                  tone="muted"
                />
              </View>
            ) : null}

            {failedOnly ? (
              <Text className="mt-2 text-caption text-faint">
                站点拒绝读取的条目只能留下标题和链接，重试没有意义，所以它们没有重试入口。
              </Text>
            ) : null}

            <View className="mt-5">
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
          <View className="mb-2">
            {label && label !== previous ? (
              <View className={index === 0 ? 'mb-1' : 'mb-1 mt-6 border-t border-line pt-4'}>
                <Text className="text-caption font-medium text-faint">{label}</Text>
              </View>
            ) : null}
            <RecentRow
              item={item}
              onPress={() => {
                if (selecting) toggleSelected(item.id)
                else router.push(`/documents/${item.id}`)
              }}
              onLongPress={() => (selecting ? toggleSelected(item.id) : enterSelection(item.id))}
              onTerminal={handleTerminal}
              showDate={false}
              selecting={selecting}
              selected={selected.has(item.id)}
              onRetry={
                failedOnly && repo.isRetryableError(item.parse_error_code)
                  ? () => {
                      void (async () => {
                        await repo.markForRetry(item.id)
                        void processPendingQueue()
                        toast('已重新排队这一条。', { type: 'success' })
                        reload()
                      })()
                    }
                  : undefined
              }
            />
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
                {failedOnly ? '没有没能整理的内容。' : keyword ? '没有匹配的收藏。' : '还没有收藏。'}
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
      {selecting ? (
        <View
          className="absolute left-0 right-0 flex-row items-center justify-between border-t border-line bg-surface px-5"
          style={{ bottom: TAB_BAR_HEIGHT + insets.bottom, height: 64 }}
        >
          <Text className="text-body-sm text-muted">
            {selected.size > 0 ? `将删除 ${selected.size} 条` : '点一行来选中'}
          </Text>
          <Button
            label="删除"
            variant="destructive"
            size="sm"
            disabled={selected.size === 0}
            onPress={() => setConfirmingDelete(true)}
          />
        </View>
      ) : null}

      {confirmingDelete ? (
        <ConfirmDialog
          visible
          title={selected.size === 1 ? '删除这 1 条收藏？' : `删除这 ${selected.size} 条收藏？`}
          message="删除后无法恢复，其它设备下次同步时也会跟着删除。"
          confirmLabel="删除"
          destructive
          onConfirm={() => void deleteSelected()}
          onCancel={() => setConfirmingDelete(false)}
        />
      ) : null}
    </Screen>
  )
}
