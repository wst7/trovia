import { Image, Pressable, Text, View } from 'react-native'
import type { DocumentSummary, ParseStatus, SearchResult } from '@xunji/shared'
import { domainOf, formatRelativeDate } from '@xunji/shared'

import { Ionicons } from '@expo/vector-icons'

import { usePalette } from '../ui/palette'
import { LiveStatusMark } from './LiveStatusMark'

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
}) {
  const p = usePalette()
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
      accessibilityLabel={selected ? `${item.title || item.url}，已选中` : item.title || item.url}
      className="rounded-md border border-line bg-surface px-3 py-3"
    >
      {({ pressed }) => (
        // 结构固定：勾选圈只是「有没有」而不是「换一层父节点」。
        // 切换多选时改变树形状会让 Fabric 重新挂载原生视图，
        // 直接崩在 child already has a parent。
        <View style={{ opacity: pressed ? 0.55 : 1 }} className="flex-row items-center gap-3">
          {thumbnail ? (
            // 固定 44×44 让左列成一条线。圆角直接给 Image：
            // 用 overflow-hidden 的容器包一层会触发 Fabric 的
            // 「The specified child already has a parent」崩溃（ReactClippingViewManager）。
            <Image
              source={{ uri: thumbnail }}
              // 透明底图标（很多站点 favicon 就是）要压在浅灰上，才和字母占位同一重量。
              style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: p.sunken }}
              resizeMode="cover"
            />
          ) : (
            <View
              className="items-center justify-center rounded-sm border border-line bg-sunken"
              style={{ width: 44, height: 44 }}
            >
              <Text className="text-body-sm font-medium text-faint">{initialOf(item)}</Text>
            </View>
          )}
          {selecting ? (
            <Ionicons
              name={selected ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
              color={selected ? p.accent : p.faint}
            />
          ) : null}
          <View className="flex-1">
            <Text className="text-body font-medium text-ink" numberOfLines={2}>
              {titleOf(item)}
            </Text>
            <View className="mt-1 flex-row items-center gap-2">
              <Text className="flex-shrink text-caption text-muted" numberOfLines={1}>
                {metaOf(item, showDate)}
              </Text>
              <LiveStatusMark
                docId={item.id}
                status={item.parse_status}
                errorCode={item.parse_error_code}
                onTerminal={onTerminal}
              />
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
export function ResultRow({
  item,
  onPress,
  onTerminal,
  showDate = true,
}: {
  item: SearchResult
  onPress: () => void
  onTerminal?: (status: ParseStatus) => void
  showDate?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={item.title || item.url}
      className="py-4"
    >
      {({ pressed }) => (
        <View style={{ opacity: pressed ? 0.55 : 1 }}>
          <Text className="text-heading font-semibold text-ink" numberOfLines={2}>
            {item.title || item.url}
          </Text>
          <View className="mt-1 flex-row items-center gap-2">
            <Text className="flex-shrink text-caption text-muted" numberOfLines={1}>
              {metaOf(item, showDate)}
            </Text>
            <LiveStatusMark
              docId={item.document_id}
              status={item.parse_status}
              errorCode={item.parse_error_code ?? null}
              onTerminal={onTerminal}
            />
          </View>

          {item.summary ? (
            <Text className="mt-2 text-body-sm text-muted" numberOfLines={2}>
              {item.summary}
            </Text>
          ) : null}

          <Text className="mt-2 text-body-sm text-ink" numberOfLines={2}>
            {item.match_reason}
          </Text>
          {item.matched_excerpt ? (
            <Text className="mt-1 text-caption italic text-muted" numberOfLines={2}>
              {item.matched_excerpt}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  )
}
