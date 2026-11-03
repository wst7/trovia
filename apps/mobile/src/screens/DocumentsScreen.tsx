import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { ActivityIndicator, FlatList, Keyboard, Pressable, RefreshControl, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { DocumentSummary, ParseStatus } from '@trovia/shared'
import { domainOf } from '@trovia/shared'

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
import { useT } from '../i18n'
import { errorText } from '../i18n/errors'

const PAGE_SIZE = 20

export function DocumentsScreen() {
  const t = useT()
  const routeParams = useLocalSearchParams<{ imported?: string }>()
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
  // 整库条数：筛选后 total 会变，但「含在 N 条里」说的应该是整个库。
  const [libraryTotal, setLibraryTotal] = useState(0)
  const [retrying, setRetrying] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [failedOnly, setFailedOnly] = useState(false)
  // 导入 300 条之后，用户需要能一眼找回「这一批」；来源写在 metadata 里。
  const [importedOnly, setImportedOnly] = useState(false)
  // 从导入页跳过来时带着 ?imported=1，直接停在「只看导入的」。
  useFocusEffect(
    useCallback(() => {
      if (routeParams.imported === '1') setImportedOnly(true)
    }, [routeParams.imported]),
  )
  // 313 条时按日期找还行，再多就得换一条线索：按站点分组能直接跳到「那篇少数派」。
  const [groupBy, setGroupBy] = useState<'day' | 'site'>('day')
  // 按站点分组时先排序：日期顺序下同一个站点散落在各处，组标题会重复出现。
  const displayItems =
    groupBy === 'site'
      ? [...items].sort((a, b) =>
          (a.site_name || domainOf(a.url)).localeCompare(b.site_name || domainOf(b.url), 'zh'),
        )
      : items

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
          importedOnly,
        })
        if (seq !== requestSeq.current) return
        setItems((current) => (mode === 'replace' ? res.items : [...current, ...res.items]))
        setTotal(res.total)
        setPage(nextPage)
        setError(null)
        void repo
          .documentStats()
          .then((stats) => {
            setFailed(stats.failed)
            setLibraryTotal(stats.total)
          })
          .catch(() => undefined)
      } catch (e) {
        if (seq !== requestSeq.current) return
        setError(errorText(e, t('list.loadFailed')))
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false)
          setLoadingMore(false)
          setRefreshing(false)
        }
      }
    },
    [keyword, failedOnly, importedOnly],
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
      toast(ids.length === 1 ? t('list.deletedOne') : t('list.deletedMany', { count: ids.length }), {
        type: 'success',
      })
    } catch {
      toast(t('list.deletePartial'), { type: 'error' })
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
        toast(t('list.retryNone'), { type: 'warning' })
        return
      }
      setRetrying(false)
      const skipped = Math.max(0, failed - count)
      toast(
        skipped > 0
          ? t('list.retriedSome', { count, skipped })
          : t('list.retriedAll', { count }),
        { type: 'success' },
      )
      reload()
      void processPendingQueue()
    } catch {
      toast(t('list.retryStartFailed'), { type: 'error' })
    } finally {
      setRetrying(false)
    }
  }

  function handleTerminal(status: ParseStatus) {
    if (status === 'completed') {
      toast(t('home.toast.completed'), { type: 'success' })
    } else if (status === 'failed') {
      toast(t('status.failed'), { type: 'error' })
    } else {
      toast(t('status.partial'), { type: 'warning' })
    }
    reload()
  }

  const hasMore = items.length < total
  const unit = loading
    ? t('list.unitLoading')
    : keyword || failedOnly || importedOnly
      ? t('list.unitMatch')
      : t('list.unitItem')

  return (
    <Screen>
      <FlatList
        data={displayItems}
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
                <Text className="text-heading font-semibold text-ink">
                  {t('list.selectedCount', { count: selected.size })}
                </Text>
                <View className="flex-row items-center gap-4">
                  <TextButton
                    label={selected.size === items.length ? t('list.clearAll') : t('list.selectAll')}
                    onPress={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((item) => item.id)))}
                    tone="muted"
                  />
                  <TextButton label={t('common.done')} onPress={exitSelection} />
                </View>
              </View>
            ) : (
              <View className="mt-4 flex-row items-baseline gap-2">
                <Text className="text-[24px] font-semibold leading-[30px] tracking-[-0.3px] text-ink">
                  {loading ? '—' : total}
                </Text>
                <Text className="flex-1 text-body-sm text-muted">{unit}</Text>
                <View className="flex-row items-center gap-3">
                  {(['day', 'site'] as const).map((mode) => (
                    <Pressable
                      key={mode}
                      onPress={() => setGroupBy(mode)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={mode === 'day' ? t('list.groupByDay') : t('list.groupBySite')}
                    >
                      <Text
                        className={
                          groupBy === mode
                            ? 'text-caption font-medium text-ink underline'
                            : 'text-caption text-faint'
                        }
                      >
                        {mode === 'day' ? t('list.day') : t('list.site')}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {failed > 0 ? (
              <View className="mt-3 flex-row items-center justify-between">
                <Text className="flex-1 text-body-sm text-muted" onPress={() => setFailedOnly((on) => !on)}>
                  {failedOnly
                    ? t('list.failedOnlyOn')
                    : t('list.failedCount', { count: failed, total: libraryTotal || total })}
                </Text>
                <TextButton
                  label={retrying ? t('list.requeuing') : t('list.retryAll')}
                  onPress={() => void handleRetryFailed()}
                  tone="muted"
                />
              </View>
            ) : null}

            <View className="mt-3 flex-row items-center gap-4">
              <Pressable
                onPress={() => {
                  setImportedOnly((on) => !on)
                  setFailedOnly(false)
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('list.importedOnly')}
              >
                <Text
                  className={
                    importedOnly ? 'text-caption font-medium text-ink underline' : 'text-caption text-faint'
                  }
                >
                  {t('list.importedOnly')}
                </Text>
              </Pressable>
              {importedOnly ? (
                <Text className="text-caption text-faint">
                  {t('list.importedHint')}
                </Text>
              ) : null}
            </View>

            {failedOnly ? (
              <Text className="mt-2 text-caption text-faint">
                {t('list.failedOnlyHint')}
              </Text>
            ) : null}

            <View className="mt-5">
              <SearchInput
                value={keywordInput}
                onChangeText={setKeywordInput}
                accessibilityLabel={t('list.filterA11y')}
              />
            </View>

            {error ? (
              <View className="mt-4 flex-row items-center justify-between">
                <Text className="flex-1 text-body-sm text-danger">{error}</Text>
                <TextButton label={t('common.retry')} onPress={reload} />
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => {
          const groupOf = (doc: { saved_at: string; site_name: string | null; url: string }) =>
            groupBy === 'day' ? dayLabel(doc.saved_at) : (doc.site_name || domainOf(doc.url))
          const label = groupOf(item)
          const previous = index > 0 ? groupOf(displayItems[index - 1]) : null
          // 组里有多少条，写在组标题后面：按站点分组时这个数字比标题本身有用。
          const groupSize = displayItems.filter((doc) => groupOf(doc) === label).length
          return (
          <View className="mb-2">
            {label && label !== previous ? (
              <View className={index === 0 ? 'mb-1' : 'mb-1 mt-6 border-t border-line pt-4'}>
                <Text className="text-caption font-medium text-faint">
                  {label}
                  {groupBy === 'site' && groupSize > 0 ? `  ${groupSize}` : ''}
                </Text>
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
                        toast(t('list.requeuedOne'), { type: 'success' })
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
                {importedOnly
                  ? t('list.emptyImported')
                  : failedOnly
                    ? t('list.emptyFailed')
                    : keyword
                      ? t('list.emptyKeyword')
                      : t('list.emptyAll')}
              </Text>
              <Text className="mt-1 text-body-sm text-muted">
                {keyword || failedOnly || importedOnly
                  ? t('list.emptyHintFiltered')
                  : t('list.emptyHintAll')}
              </Text>
              <View className="mt-4 self-start">
                <TextButton
                  label={keyword ? t('list.clearFilter') : t('list.backHome')}
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
                  label={t('list.loadMore')}
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
            {selected.size > 0
              ? t('list.willDelete', { count: selected.size })
              : t('list.tapToSelect')}
          </Text>
          <Button
            label={t('common.delete')}
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
          title={
            selected.size === 1
              ? t('list.deleteTitleOne')
              : t('list.deleteTitleMany', { count: selected.size })
          }
          message={t('list.deleteBody')}
          confirmLabel={t('common.delete')}
          destructive
          onConfirm={() => void deleteSelected()}
          onCancel={() => setConfirmingDelete(false)}
        />
      ) : null}
    </Screen>
  )
}
