import { Pressable, Text, View } from 'react-native'
import type { DocumentSummary, ParseStatus, SearchResult } from '@xunji/shared'
import { formatRelativeDate, sourceLabel, SOURCE_TYPE_LABELS } from '@xunji/shared'

import { LiveStatusMark } from './LiveStatusMark'

function metaOf(item: DocumentSummary | SearchResult): string {
  const date = formatRelativeDate(item.saved_at)
  // 标题本身就是链接（没有抓到标题）时，元信息再写一遍站名等于把同一件事说两遍。
  const titleIsUrl = !item.title || item.title.trim() === item.url
  if (titleIsUrl) return date
  const site = sourceLabel(item.url, item.site_name, SOURCE_TYPE_LABELS[item.source_type])
  return `${site} · ${date}`
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
          <Text className="text-body font-medium text-ink" numberOfLines={1}>
            {item.title || item.url}
          </Text>
          <View className="mt-1 flex-row items-center gap-2">
            <Text className="flex-shrink text-caption text-muted" numberOfLines={1}>
              {metaOf(item)}
            </Text>
            <LiveStatusMark
              docId={item.id}
              status={item.parse_status}
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
