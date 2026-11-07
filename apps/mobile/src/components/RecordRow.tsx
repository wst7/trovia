import { useState } from 'react'
import { Image, Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import type { DocumentSummary, ParseStatus, SearchResult } from '@trovia/shared'
import { domainOf, formatRelativeDate } from '@trovia/shared'

import { Ionicons } from '@expo/vector-icons'

import { usePalette } from '../ui/palette'
import { LiveStatusMark } from './LiveStatusMark'
import { useT } from '../i18n'

/**
 * 没有标题的收藏怎么显示才不别扭：
 * 标题位置放路径（r/programming），来源位置放域名（old.reddit.com）。
 * 这样「标题 + 来源」的结构和别的行一致，也不会把同一个域名说两遍。
 */
function urlTitleAndHost(url: string): { title: string; host: string } {
  try {
    const parsed = new URL(url)
    const host = parsed.host.replace(/^www\./, '')
    const path = parsed.pathname.replace(/^\/+|\/+$/g, '')
    return { title: path || host, host }
  } catch {
    return { title: url, host: '' }
  }
}

/** 没有缩略图时的占位字：站点域名首字母，读起来像一排字母索引，不像缺失。 */
function initialOf(item: DocumentSummary | SearchResult): string {
  const host = domainOf(item.url) ?? ''
  const first = host.replace(/^www\./, '').slice(0, 1)
  return first ? first.toUpperCase() : '·'
}

function titleOf(item: DocumentSummary | SearchResult): string {
  const title = item.title?.trim()
  if (!title || title === item.url) return urlTitleAndHost(item.url).title
  return title
}

function metaOf(item: DocumentSummary | SearchResult, showDate: boolean): string {
  // 列表按天分组时，日期已经在分组标题上，行里再写一遍就是同一件事说两遍。
  const date = showDate ? formatRelativeDate(item.saved_at) : ''
  // 标题本身就是链接时，再写站名等于把同一件事说两遍；
  // 但只剩一个日期又会让这一行缺一条腿，所以统一叫「链接」。
  const titleIsUrl = !item.title || item.title.trim() === item.url
  // 标题位置已经是域名时，再写一遍没有意义，只留时间。
  if (titleIsUrl) {
    const { title, host } = urlTitleAndHost(item.url)
    if (!host || title === host) return date
    return date ? `${host} · ${date}` : host
  }
  // 站点名和域名经常是同一件事（「x.com · X (formerly Twitter)」），统一只写域名。
  const host = domainOf(item.url)
  if (!host) return date
  return date ? `${host} · ${date}` : host
}

/**
 * 收藏列表的一行：标题在上、出处与时间在下，右侧一个状态标记。
 * 没有卡片、没有缩略图、没有箭头——一行就是一条内容。
 */
export function RecentRow({
  item,
  onPress,
  onLongPress,
  onTerminal,
  showDate = true,
  selected,
  selecting = false,
  onRetry,
}: {
  item: DocumentSummary
  onPress: () => void
  onLongPress?: () => void
  onTerminal?: (status: ParseStatus) => void
  /** 列表已经按天分组时传 false，避免日期重复。 */
  showDate?: boolean
  /** 多选模式下的选中状态；undefined 表示不在多选模式。 */
  selected?: boolean
  selecting?: boolean
  /** 单条重试：只有「没能整理」筛选里才给，其它场景不该出现这个入口。 */
  onRetry?: () => void
}) {
  const p = usePalette()
  const t = useT()
  // 有些站点的 favicon 地址能打开但内容是空的（0 字节/透明图），会留下一个空框。
  // 加载失败就退回首字母，左列至少还是「有东西」的。
  const [imageBroken, setImageBroken] = useState(false)
  // 缩略图优先级：本机文件 > 远程地址 > 不显示（很多站点没有正文图）。
  // 缩略图优先级：本机文件 > 远程地址 > 站点首字母占位
  const thumbnail = (item.image_files ?? []).find((file) => Boolean(file)) ?? (item.images ?? [])[0]
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={320}
      accessibilityRole="button"
      accessibilityState={selecting ? { selected: Boolean(selected) } : undefined}
      accessibilityLabel={
        selected ? t('row.selected', { title: item.title || item.url }) : item.title || item.url
      }
      className="min-h-[60px] justify-center"
    >
      {({ pressed }) => (
        // 不给行加底色：行是表格里的一行，铺底会让整列变成一张张白卡。
        // 按压只降透明度——底色方案在画布色上行不通，sunken 只比 canvas 深 2/255。
        <View style={{ opacity: pressed ? 0.6 : 1 }} className="flex-row items-center gap-3 py-3">
          {/* 真图标和字母占位共用同一个 34×34 容器：favicon 有方有横，
              不套容器时左列看着「直」但重量不齐，扫视时会跳。
              多选时这个容器原地换成勾选圈，左列宽度不变，整列文字不会横跳。 */}
          <View
            className={
              selecting
                ? 'items-center justify-center'
                : thumbnail && !imageBroken
                  ? 'items-center justify-center overflow-hidden rounded-sm'
                  : 'items-center justify-center overflow-hidden rounded-sm border border-line'
            }
            style={{ width: 34, height: 34 }}
          >
            {selecting ? (
              <Ionicons
                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={selected ? p.accent : p.faint}
              />
            ) : thumbnail && !imageBroken ? (
              // 铺满瓦片：这是文章首图，不是站点图标；缩成小块再留白反而像缺了图。
              <Image
                source={{ uri: thumbnail }}
                style={{ width: 34, height: 34 }}
                resizeMode="cover"
                onError={() => setImageBroken(true)}
              />
            ) : (
              <Text className="text-caption font-medium text-faint">{initialOf(item)}</Text>
            )}
          </View>
          <View className="flex-1">
            <Text className="text-body font-medium text-ink" numberOfLines={1}>
              {titleOf(item)}
            </Text>
            <View className="mt-1 flex-row items-center justify-between gap-2">
              <Text className="flex-1 text-caption text-muted" numberOfLines={1}>
                {metaOf(item, showDate)}
              </Text>
              <View className="flex-row items-center gap-2">
                <LiveStatusMark
                  docId={item.id}
                  status={item.parse_status}
                  errorCode={item.parse_error_code}
                  onTerminal={onTerminal}
                />
                {onRetry ? (
                  <Pressable
                    onPress={onRetry}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={t('row.retryOne')}
                  >
                    {/* 行内重试不用强调色：一屏七个红字，强调色就失效了。 */}
                    <Text className="text-caption text-ink">{t('common.retry')}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
        </View>
      )}
    </Pressable>
  )
}

/**
 * 搜索结果的一行：多一段「为什么找到它」。
 * 匹配理由只由真实命中证据拼出，不给它加图标或色块——证据本身够轻。
 */
/** 把查询词在文本里标出来（大小写不敏感，中文按子串）。 */
function highlight(text: string, terms: string[]): [...(string | { hit: string })[]] {
  if (!text || terms.length === 0) return [text]
  const escaped = terms
    .filter((term) => term.length >= 2)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
  if (escaped.length === 0) return [text]
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  // split 带捕获组时，命中项固定落在奇数下标——这比再 test 一遍可靠。
  return text.split(re).map((part, index) => (index % 2 === 1 ? { hit: part } : part))
}

export function ResultRow({
  item,
  onPress,
  onTerminal,
  showDate = true,
  terms = [],
}: {
  item: SearchResult
  onPress: () => void
  onTerminal?: (status: ParseStatus) => void
  showDate?: boolean
  /** 当前查询的词，用来在结果里标出命中位置。 */
  terms?: string[]
}) {
  const t = useT()
  // 命中类型先说，标题后说：这一屏要回答的是「是不是这一篇」，
  // 而判断依据是命中的那句话，不是标题像不像。
  const kind = item.match_kind === 'semantic' ? t('result.kind.semantic') : t('result.kind.literal')
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={item.title || item.url}
      className="py-4"
    >
      {({ pressed }) => (
        <View style={{ opacity: pressed ? 0.6 : 1 }}>
          <View className="flex-row items-baseline justify-between gap-3">
            <Text className="text-[11px] font-semibold tracking-[1px] text-faint">{kind}</Text>
            {showDate ? (
              <Text className="text-caption text-faint">{formatRelativeDate(item.saved_at)}</Text>
            ) : null}
          </View>

          <Text className="mt-2 text-body font-medium text-ink" numberOfLines={2}>
            {highlight(item.title || item.url, terms).map((part, i) =>
              typeof part === 'string' ? (
                <Text key={i}>{part}</Text>
              ) : (
                <Text key={i} className="font-semibold text-accent">
                  {part.hit}
                </Text>
              ),
            )}
          </Text>

          {item.matched_excerpt ? (
            <View className="mt-2 border-l-2 border-line-strong pl-3">
              <Text className="text-body-sm text-muted" numberOfLines={2}>
                {highlight(item.matched_excerpt, terms).map((part, i) =>
                  typeof part === 'string' ? (
                    <Text key={i}>{part}</Text>
                  ) : (
                    <Text key={i} className="text-ink">
                      {part.hit}
                    </Text>
                  ),
                )}
              </Text>
            </View>
          ) : null}

          <View className="mt-2 flex-row items-center gap-2">
            <Text className="flex-shrink text-caption text-muted" numberOfLines={1}>
              {item.match_reason}
            </Text>
            <LiveStatusMark
              docId={item.document_id}
              status={item.parse_status}
              errorCode={item.parse_error_code ?? null}
              onTerminal={onTerminal}
            />
          </View>
        </View>
      )}
    </Pressable>
  )
}
