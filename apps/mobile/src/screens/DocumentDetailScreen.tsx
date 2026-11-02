import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { DocumentDetail, ParseStatus, RelatedItem } from '@xunji/shared'
import {
  domainOf,
  errorMessage,
  formatDate,
} from '@xunji/shared'

import { relativeTime } from '../local/dates'

const flat = (value: string) => value.replace(/\s+/g, '')
import { ImageViewer } from '../components/ImageViewer'
import { removeImages } from '../local/imageStore'
import { LiveStatusMark } from '../components/LiveStatusMark'
import { Markdown } from '../components/Markdown'
import { processPendingQueue } from '../local/pipeline'
import * as repo from '../local/repo'
import { useToast } from '../providers/ToastProvider'
import { Button, IconButton, TextButton } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Divider } from '../ui/Divider'
import { GUTTER, Screen } from '../ui/Screen'
import { usePalette } from '../ui/palette'

function bodyFallback(code: string | null): string {
  if (code === 'APP_ONLY_LINK') {
    return '这条内容在飞书 App 里。标题和链接已经保存，点下方「打开原文」可以直接回到飞书查看。'
  }
  if (code === 'FETCH_BLOCKED') {
    return '这个站点拒绝本机读取（要求登录、人机验证或屏蔽了非浏览器请求），所以正文读不到。链接和标题已经保留，点下方「打开原文」可以去看。'
  }
  if (code === 'FETCH_FAILED') {
    return '这次没连上站点，可能是网络问题。链接已经保存，可以点「重新解析」再试一次。'
  }
  if (code === 'CONTENT_SCRIPT_ONLY') {
    return '页面正文由脚本动态渲染，本机只拿到公开的那部分。链接保留着，点下方「打开原文」看完整页面。'
  }
  if (code === 'PARSE_INCOMPLETE') {
    return '只读到了页面的一部分正文，可能是站点分批加载。链接已经保存，可以点「重新解析」再试一次。'
  }
  return '正文暂时无法读取，原始链接始终为你保留。'
}

export function DocumentDetailScreen() {
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
        setError('这篇收藏不存在，可能已经被删除。')
        return
      }
      setDoc(detail)
      setStatus(detail.parse_status)
      setRelated(relatedItems)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, '加载收藏详情失败，请稍后重试。'))
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
      toast('已重新排入本机解析队列，正在整理内容……')
      void processPendingQueue()
    } catch (e) {
      toast(errorMessage(e, '重新解析失败，请稍后重试。'), { type: 'error' })
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
      toast('已删除这篇收藏。')
      if (router.canGoBack()) router.back()
      else router.replace('/documents')
    } catch (e) {
      toast(errorMessage(e, '删除失败，请稍后重试。'), { type: 'error' })
      setDeleting(false)
    }
  }

  async function openOriginal() {
    if (!doc) return
    try {
      await Linking.openURL(doc.url)
    } catch {
      toast('无法打开原始链接。', { type: 'error' })
    }
  }

  const header = (
    <View className="h-14 flex-row items-center justify-between">
      <IconButton
        name="chevron-back"
        size={22}
        accessibilityLabel="返回"
        onPress={goBack}
      />
      {doc ? (
        <IconButton
          name="trash-outline"
          size={19}
          tone="muted"
          accessibilityLabel="删除这篇收藏"
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
            <Button label="重试" onPress={() => void load()} size="sm" />
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
  const summaryRepeatsBody = Boolean(summary && bodySource && flat(bodySource).includes(flat(summary)))

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

        <Text className="mt-2 text-title font-semibold text-ink">{doc.title || doc.url}</Text>

        <Text className="mt-2 text-caption text-muted">
          {doc.author ? `${doc.author} · ` : ''}
          {doc.published_at ? `${formatDate(doc.published_at)} 发表 · ` : ''}
          收藏于 {relativeTime(doc.saved_at)}
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
                accessibilityLabel="重新解析"
                className={reprocessing ? 'opacity-40' : undefined}
              >
                <Text className="text-caption text-muted underline">
                  {reprocessing ? '提交中…' : '重新解析'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {summary && !summaryRepeatsBody ? (
          <View className="mt-6 rounded-md border border-line bg-surface p-4">
            <Text className="text-[11px] font-semibold tracking-[1px] text-faint">摘要</Text>
            {summaryShort ? (
              <Text className="mt-2 text-body text-ink">{summaryShort}</Text>
            ) : null}
            {summaryLong ? (
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
          <Text className="text-[11px] font-semibold tracking-[1px] text-faint">原文</Text>
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
              <Text className="text-body-sm text-muted">{bodyFallback(doc.parse_error_code)}</Text>
            )}
          </View>
        </View>

        {doc.images && doc.images.length > 0 && !bodySource.includes('![') ? (
          <View className="mt-8">
            <Text className="text-[11px] font-semibold tracking-[1px] text-faint">图片</Text>
            <View className="mt-3 gap-2">
              {remoteImages.slice(0, 4).map((uri, i) => (
                <Pressable
                  key={uri}
                  onPress={() =>
                    setViewer({ open: true, index: i, images: remoteImages.map((remote) => resolveImage(remote)) })
                  }
                  accessibilityRole="imagebutton"
                  accessibilityLabel="查看大图"
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
                共 {doc.images.length} 张，点开可放大查看
              </Text>
            ) : null}
          </View>
        ) : null}

        {related.length > 0 ? (
          <View className="mt-8">
            <Divider />
            <Text className="mt-6 text-[11px] font-semibold tracking-[1px] text-faint">相关</Text>
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
          label="打开原文"
          icon="open-outline"
          variant="primary"
          onPress={() => void openOriginal()}
          className="w-full"
        />
      </View>

      <ConfirmDialog
        visible={confirmingDelete}
        title="删除这篇收藏？"
        message="删除后无法恢复。"
        confirmLabel="删除"
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
