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
 * How to show a save with no title without it looking odd:
 * the path goes where the title would be (r/programming) and the domain where the source goes (old.reddit.com).
 * That keeps the title + source structure consistent with other rows and avoids stating the same domain twice.
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

/** Placeholder when there is no thumbnail: the first letter of the site domain, which reads like an alphabetical index rather than something missing. */
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
  // When the list is grouped by day the date is already in the group header, so repeating it in the row states the same thing twice.
  const date = showDate ? formatRelativeDate(item.saved_at) : ''
  // When the title is itself the URL, repeating the site name states the same thing twice;
  // but leaving only a date would make the row lose a leg, so it is uniformly labelled "link".
  const titleIsUrl = !item.title || item.title.trim() === item.url
  // When the title slot already holds the domain, repeating it means nothing; keep the time only.
  if (titleIsUrl) {
    const { title, host } = urlTitleAndHost(item.url)
    if (!host || title === host) return date
    return date ? `${host} · ${date}` : host
  }
  // Site name and domain are often the same thing ("x.com · X (formerly Twitter)"), so only the domain is written.
  const host = domainOf(item.url)
  if (!host) return date
  return date ? `${host} · ${date}` : host
}

/**
 * One row of the saved-items list: title on top, source and time below, a status mark on the right.
 * No card, no thumbnail, no chevron — one row is one item.
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
  /** Pass false when the list is already grouped by day, to avoid repeating the date. */
  showDate?: boolean
  /** Selection state in multi-select mode; undefined means multi-select mode is not active. */
  selected?: boolean
  selecting?: boolean
  /** Single-item retry: offered only in the "could not be processed" filter; this entry point should not appear in other contexts. */
  onRetry?: () => void
}) {
  const p = usePalette()
  const t = useT()
  // On some sites the favicon URL opens but the content is empty (0 bytes / transparent image), leaving an empty box behind.
  // On load failure fall back to the first letter, so the left column at least still has something in it.
  const [imageBroken, setImageBroken] = useState(false)
  // Thumbnail priority: local file > remote URL > not shown (many sites have no body image).
  // Thumbnail priority: local file > remote URL > site initial placeholder
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
        // No background on the row: a row is a row in a table, and a fill turns the whole column into one white card after another.
        // Pressing only lowers opacity — the background-fill approach does not work on a canvas-coloured surface, where sunken is only 2/255 darker than canvas.
        <View style={{ opacity: pressed ? 0.6 : 1 }} className="flex-row items-center gap-3 py-3">
          {/* Real icons and letter placeholders share the same 34×34 container: favicons come in square and wide shapes,
              and without a container the left column looks "straight" but has uneven weight and jumps when scanning.
              In multi-select mode this container turns into a check circle in place, so the left column keeps its width and the text does not shift sideways. */}
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
              // Fill the tile: this is the article's lead image, not a site icon; shrinking it into a small block with padding makes it look like the image is missing.
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
                    {/* Inline retry does not use the accent colour: with seven red labels on one screen the accent stops meaning anything. */}
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
 * One row of search results: it carries an extra "why it was found" line.
 * The match reason is assembled only from genuine hit evidence; no icon or colour block is added — the evidence itself is light enough.
 */
/** Mark the query terms inside the text (case-insensitive; Chinese is matched as a plain substring). */
function highlight(text: string, terms: string[]): [...(string | { hit: string })[]] {
  if (!text || terms.length === 0) return [text]
  const escaped = terms
    .filter((term) => term.length >= 2)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
  if (escaped.length === 0) return [text]
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  // With a capturing group, split always puts the hits at odd indices — more reliable than testing every part again.
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
  /** The terms of the current query, used to highlight where the results matched. */
  terms?: string[]
}) {
  const t = useT()
  // Match kind first, title second: this screen has to answer "is it this one",
  // and the evidence is the sentence that matched, not whether the title looks similar.
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
                    <Text key={i} className="font-medium text-accent">
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
