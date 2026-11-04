import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { DocumentDetail, ParseStatus, RelatedItem } from '@trovia/shared'
import { domainOf, formatDate } from '@trovia/shared'

import { relativeTime } from '../local/dates'

const flat = (value: string) => value.replace(/\s+/g, '')
import { ImageViewer } from '../components/ImageViewer'
import { removeImages } from '../local/imageStore'
import { LiveStatusMark } from '../components/LiveStatusMark'
import { Markdown } from '../components/Markdown'
import { processPendingQueue } from '../local/pipeline'
import * as repo from '../local/repo'
import { useToast } from '../providers/ToastProvider'
import { Button, IconButton } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Divider } from '../ui/Divider'
import { GUTTER, Screen } from '../ui/Screen'
import { usePalette } from '../ui/palette'
import { useT } from '../i18n'
import { errorText } from '../i18n/errors'

function bodyFallback(code: string | null, t: (key: string) => string): string {
  const known = ['APP_ONLY_LINK', 'FETCH_BLOCKED', 'FETCH_FAILED', 'CONTENT_SCRIPT_ONLY', 'PARSE_INCOMPLETE']
  if (code && known.includes(code)) return t(`body.${code}`)
  return t('body.default')
}

export function DocumentDetailScreen() {
  const t = useT()
  const router = useRouter()
  const params = useLocalSearchParams<{ id?: string | string[] }>()
  const id = Array.isArray(params.id) ? params.id[0] : params.id
  const { toast } = useToast()
  const insets = useSafeAreaInsets()
  const p = usePalette()

  const [doc, setDoc] = useState<DocumentDetail | null>(null)
  const [related, setRelated] = useState<RelatedItem[]>([])
  const [status, setStatus] = useState<ParseStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reprocessing, setReprocessing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // 看图：整篇图片一起传，左右能翻。
  // 底部悬浮按钮挡不挡正文，取决于它的真实高度，所以量一次再决定留白。
  const [barHeight, setBarHeight] = useState(0)
  const [viewer, setViewer] = useState<{ open: boolean; index: number; images: string[] }>({
    open: false,
    index: 0,
    images: [],
  })

  const load = useCallback(async () => {
    if (!id) return
    try {
      const [detail, relatedItems] = await Promise.all([
        repo.getDocument(id),
        repo.relatedDocuments(id),
      ])
      if (!detail) {
        setError(t('detail.notFound'))
        return
      }
      setDoc(detail)
      setStatus(detail.parse_status)
      setRelated(relatedItems)
      setError(null)
    } catch (e) {
      setError(errorText(e, t('detail.loadFailed')))
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace('/documents')
  }, [router])

  async function handleReprocess() {
    if (!id || reprocessing) return
    setReprocessing(true)
    try {
      await repo.markForRetry(id)
      setStatus('pending')
      toast(t('detail.requeued'))
      void processPendingQueue()
    } catch (e) {
      toast(errorText(e, t('detail.reprocessFailed')), { type: 'error' })
    } finally {
      setReprocessing(false)
    }
  }

  async function doDelete() {
    if (!id) return
    setDeleting(true)
    try {
      await repo.deleteDocument(id)
      await removeImages(id)
      toast(t('detail.deleted'))
      if (router.canGoBack()) router.back()
      else router.replace('/documents')
    } catch (e) {
      toast(errorText(e, t('detail.deleteFailed')), { type: 'error' })
      setDeleting(false)
    }
  }

  async function openOriginal() {
    if (!doc) return
    try {
      await Linking.openURL(doc.url)
    } catch {
      toast(t('detail.openFailed'), { type: 'error' })
    }
  }

  const header = (
    <View className="h-14 flex-row items-center justify-between">
      <IconButton
        name="chevron-back"
        size={22}
        accessibilityLabel={t('detail.back')}
        onPress={goBack}
      />
      {doc ? (
        <IconButton
          name="trash-outline"
          size={19}
          tone="muted"
          accessibilityLabel={t('detail.deleteA11y')}
          disabled={deleting}
          onPress={() => setConfirmingDelete(true)}
        />
      ) : null}
    </View>
  )

  if (error) {
    return (
      <Screen>
        {header}
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-body text-ink">{error}</Text>
          <View className="mt-5">
            <Button label={t('common.retry')} onPress={() => void load()} size="sm" />
          </View>
        </View>
      </Screen>
    )
  }

  if (!doc || status === null) {
    return (
      <Screen>
        {header}
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" color={p.muted} />
        </View>
      </Screen>
    )
  }

  const rawBody = doc.content_markdown ?? doc.plain_text ?? ''
  // 抓取失败时站点只给了 <title>，正文就是标题本身。再排一遍等于把标题放大两次，
  // 读者会以为页面卡住了；这种情况按「没有正文」处理，交给下面的说明文案。
  const bodyIsJustTitle = flat(rawBody) === flat(doc.title ?? '') || !flat(rawBody)
  const bodySource = bodyIsJustTitle ? '' : rawBody
  // 图片落盘后同一张图有两个地址：本地文件优先，远程只作兜底。
  const localByRemote = new Map<string, string>()
  const remoteImages = doc.images ?? []
  const localFiles = doc.image_files ?? []
  remoteImages.forEach((remote, index) => {
    const local = localFiles[index]
    if (local) localByRemote.set(remote, local)
  })
  const resolveImage = (url: string) => localByRemote.get(url) ?? url
  // 被站点拒绝时重试没有意义（再点一次还是 403），别给用户假动作。
  const blockedBySite = doc?.parse_error_code === 'FETCH_BLOCKED' || doc?.parse_error_code === 'APP_ONLY_LINK'
  const canReprocess = status === 'partial' || (status === 'failed' && !blockedBySite)
  const rawShort = doc.summary_short?.trim() || null
  const rawLong = doc.summary_long?.trim() || null
  // 抽取式摘要常常两段一样：一样就只显示一次，别让同一句话占两块版面。
  const summaryShort = rawShort ?? (rawLong && rawLong.length <= 120 ? rawLong : null)
  const summaryLong = rawLong && rawLong !== summaryShort && rawLong !== rawShort ? rawLong : null
  const summary = summaryShort ?? summaryLong
  // 抽取式摘要对短文就等于全文：这时候摘要块只是把原文又说一遍，直接不显示。
  // 导入进来的条目要能说明来历：用户看到 2019 年的时间，得知道那不是 App 记错了。
  // 老的条目只存了一句写死的中文；新的存「来源类型 + 文件名」，按界面语言说。
  const originText = (() => {
    const kind = doc.metadata?.origin_kind
    const file = doc.metadata?.origin_file
    if (kind === 'import' || kind === 'restore') {
      const name = typeof file === 'string' ? file : ''
      return name ? t(`detail.origin.${kind}`, { file: name }) : t('detail.origin.backup')
    }
    return typeof doc.metadata?.origin === 'string' ? doc.metadata.origin : null
  })()
  const savedFromFile = doc.metadata?.savedAtFromFile === true
  const summaryRepeatsBody = Boolean(summary && bodySource && flat(bodySource).includes(flat(summary)))
  // 长摘要常常是短摘要的完整版，两句一起显示等于同一段话印两遍。
  const summaryShortText = doc.summary_short?.trim() ?? ''
  const summaryLongText = doc.summary_long?.trim() ?? ''
  // 短摘要常是长摘要截断到 120 字再加省略号，所以不能直接 includes 比较：
  // 比前 40 个字（去掉省略号）就够了，同一句话的开头不会撞车。
  const head = (text: string) => flat(text).replace(/[.…]+$/, '').slice(0, 40)
  const longRepeatsShort = Boolean(
    summaryShortText &&
      summaryLongText &&
      (head(summaryLongText).startsWith(head(summaryShortText)) ||
        head(summaryShortText).startsWith(head(summaryLongText))),
  )
  const showShort = Boolean(summaryShortText) && !longRepeatsShort
  const showLong = Boolean(summaryLongText)

  return (
    <Screen>
      {header}

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: GUTTER,
          // 读到最后一屏时最后一行不能被悬浮按钮压住。
          paddingBottom: (barHeight || 88) + 20,
        }}
        showsVerticalScrollIndicator={false}
      >
        {doc.title && doc.title.trim() !== doc.url ? (
          <Text className="text-caption text-faint" numberOfLines={1}>
            {domainOf(doc.url)}
          </Text>
        ) : null}

        {/* 标题用无衬线：中文衬线在大字号下笔画对比太强，读起来像印刷品而不是 App。 */}
        <Text className="mt-2 text-[26px] font-semibold leading-[35px] tracking-[-0.3px] text-ink">
          {doc.title || doc.url}
        </Text>

        {originText ? (
          <Text className="mt-2 text-caption text-faint">
            {originText}
            {savedFromFile ? t('detail.savedFromFile') : ''}
          </Text>
        ) : null}

        <Text className="mt-2 text-caption text-muted">
          {[
            doc.author,
            doc.published_at ? t('detail.published', { date: formatDate(doc.published_at) }) : null,
            t('detail.savedAt', { when: relativeTime(doc.saved_at) }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>


        {status !== 'completed' ? (
          <View className="mt-3 flex-row items-center gap-3">
            <LiveStatusMark
              docId={doc.id}
              status={status}
              errorCode={doc.parse_error_code}
              onTerminal={(next) => {
                setStatus(next)
                void load()
              }}
            />
            {canReprocess ? (
              <Pressable
                onPress={() => void handleReprocess()}
                disabled={reprocessing}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('detail.reprocess')}
                className={reprocessing ? 'opacity-40' : undefined}
              >
                <Text className="text-caption text-muted underline">
                  {reprocessing ? t('detail.reprocessing') : t('detail.reprocess')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* 已整理好的条目也给一个「重新整理」：抽取规则会改进，旧条目不该只能靠重装。
            做成淡墨小字，不抢「打开原文」的位置。 */}
        {status === 'completed' && !blockedBySite ? (
          <Pressable
            onPress={() => void handleReprocess()}
            disabled={reprocessing}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('detail.reprocessLong')}
            className={`mt-3 ${reprocessing ? 'opacity-40' : ''}`}
          >
            <Text className="text-caption text-faint underline">
              {reprocessing ? t('detail.reprocessingLong') : t('detail.reprocessLong')}
            </Text>
          </Pressable>
        ) : null}

        {summary && !summaryRepeatsBody ? (
          <View className="mt-6 border-l-2 border-accent pl-4">
            <Text className="text-[11px] font-semibold tracking-[1px] text-faint">
              {t('detail.summary')}
            </Text>
            {showShort ? (
              <Text className="mt-2 text-body text-ink">{summaryShortText}</Text>
            ) : null}
            {showLong ? (
              <Text className={summaryShort ? 'mt-2 text-body-sm text-muted' : 'mt-2 text-body text-ink'}>
                {summaryLong}
              </Text>
            ) : null}
          </View>
        ) : null}

        {doc.keywords.length > 0 ? (
          <Text className="mt-4 text-caption text-muted">
            {doc.keywords.join(' · ')}
          </Text>
        ) : null}

        <View className="mt-8">
          <Text className="text-[11px] font-semibold tracking-[1px] text-faint">
            {t('detail.original')}
          </Text>
          <View className="mt-3">
            {bodySource ? (
              <Markdown
                source={bodySource}
                resolveImage={resolveImage}
                onImagePress={(url, images) =>
                  setViewer({ open: true, index: Math.max(0, images.indexOf(url)), images })
                }
              />
            ) : (
              <Text className="text-body-sm text-muted">
                {bodyFallback(doc.parse_error_code, t)}
              </Text>
            )}
          </View>
        </View>

        {doc.images && doc.images.length > 0 && !bodySource.includes('![') ? (
          <View className="mt-8">
            <Text className="text-[11px] font-semibold tracking-[1px] text-faint">
              {t('detail.images')}
            </Text>
            <View className="mt-3 gap-2">
              {remoteImages.slice(0, 4).map((uri, i) => (
                <Pressable
                  key={uri}
                  onPress={() =>
                    setViewer({ open: true, index: i, images: remoteImages.map((remote) => resolveImage(remote)) })
                  }
                  accessibilityRole="imagebutton"
                  accessibilityLabel={t('detail.viewImage')}
                >
                  <Image
                    source={{ uri: resolveImage(uri) }}
                    className="w-full rounded-sm bg-sunken"
                    style={{ height: 200 }}
                    resizeMode="cover"
                    accessibilityIgnoresInvertColors
                  />
                </Pressable>
              ))}
            </View>
            {doc.images.length > 4 ? (
              <Text
                className="mt-2 text-caption text-faint"
                onPress={() => setViewer({ open: true, index: 0, images: remoteImages.map((remote) => resolveImage(remote)) })}
              >
                {t('detail.moreImages', { count: doc.images.length })}
              </Text>
            ) : null}
          </View>
        ) : null}

        {related.length > 0 ? (
          <View className="mt-8">
            <Divider />
            <Text className="mt-6 text-[11px] font-semibold tracking-[1px] text-faint">
              {t('detail.related')}
            </Text>
            <View className="mt-1">
              {related.map((item, index) => (
                <View key={item.document_id}>
                  <Text
                    className="py-3 text-body-sm text-ink"
                    numberOfLines={1}
                    onPress={() => router.push(`/documents/${item.document_id}`)}
                  >
                    {item.title || item.url}
                  </Text>
                  {index < related.length - 1 ? <Divider /> : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <ImageViewer
        visible={viewer.open}
        images={viewer.images}
        index={viewer.index}
        onClose={() => setViewer((prev) => ({ ...prev, open: false }))}
        onIndexChange={(next) => setViewer((prev) => ({ ...prev, index: next }))}
      />

      {/* 这一屏只有一个动作，所以它值得朱红。 */}
      <View
        className="absolute inset-x-0 bottom-0 border-t border-line bg-canvas px-4 pt-3"
        style={{ paddingBottom: insets.bottom + 12 }}
        onLayout={(event) => setBarHeight(event.nativeEvent.layout.height)}
      >
        <Button
          label={t('detail.openOriginal')}
          icon="open-outline"
          variant="primary"
          onPress={() => void openOriginal()}
          className="w-full"
        />
      </View>

      <ConfirmDialog
        visible={confirmingDelete}
        title={t('detail.deleteTitle')}
        message={t('detail.deleteBody')}
        confirmLabel={t('common.delete')}
        destructive
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setConfirmingDelete(false)
          void doDelete()
        }}
      />
    </Screen>
  )
}
