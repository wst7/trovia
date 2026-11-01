import { Pressable, Text, View } from 'react-native'
import type { DocumentSummary, ParseStatus, SearchResult } from '@xunji/shared'
import { domainOf, formatRelativeDate } from '@xunji/shared'

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

function titleOf(item: DocumentSummary | SearchResult): string {
  const title = item.title?.trim()
  if (!title || title === item.url) return urlTitleAndHost(item.url).title
  return title
}

function metaOf(item: DocumentSummary | SearchResult): string {
  const date = formatRelativeDate(item.saved_at)
  // 标题本身就是链接时，再写站名等于把同一件事说两遍；
  // 但只剩一个日期又会让这一行缺一条腿，所以统一叫「链接」。
  const titleIsUrl = !item.title || item.title.trim() === item.url
  // 标题位置已经是域名时，再写一遍没有意义，只留时间。
  if (titleIsUrl) {
    const { title, host } = urlTitleAndHost(item.url)
    return host && title !== host ? `${host} · ${date}` : date
  }
  // 站点名和域名经常是同一件事（「x.com · X (formerly Twitter)」），统一只写域名。
  const host = domainOf(item.url)
  return host ? `${host} · ${date}` : date
}

/**
 * 收藏列表的一行：标题在上、出处与时间在下，右侧一个状态标记。
 * 没有卡片、没有缩略图、没有箭头——一行就是一条内容。
 */
export function RecentRow({
  item,
  onPress,
  onTerminal,
}: {
  item: DocumentSummary
  onPress: () => void
  onTerminal?: (status: ParseStatus) => void
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={item.title || item.url}
      className="min-h-[60px] justify-center py-3"
    >
      {({ pressed }) => (
        <View style={{ opacity: pressed ? 0.55 : 1 }}>
          <Text className="text-body font-medium text-ink" numberOfLines={2}>
            {titleOf(item)}
          </Text>
          <View className="mt-1 flex-row items-center gap-2">
            <Text className="flex-shrink text-caption text-muted" numberOfLines={1}>
              {metaOf(item)}
            </Text>
            <LiveStatusMark
              docId={item.id}
              status={item.parse_status}
              errorCode={item.parse_error_code}
              onTerminal={onTerminal}
            />
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
}: {
  item: SearchResult
  onPress: () => void
  onTerminal?: (status: ParseStatus) => void
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
              {metaOf(item)}
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
