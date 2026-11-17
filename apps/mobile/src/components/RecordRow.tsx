import { useState } from 'react'
import { Image, Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import type { DocumentSummary, ParseStatus, SearchResult } from '@trovia/shared'
import { domainOf, formatRelativeDate } from '@trovia/shared'

import { Ionicons } from '@expo/vector-icons'

import { tileFor, useIsDark, usePalette } from '../ui/palette'
import { LiveStatusMark } from './LiveStatusMark'
import { useT } from '../i18n'
import { useTapGuard } from '../hooks/useTapGuard'

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

/** Placeholder when there is no thumbnail: the first letter of the site domain, in one of six quiet cover tints. */
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

function sourceOf(item: DocumentSummary | SearchResult): string {
  if (!item.title || item.title.trim() === item.url) return urlTitleAndHost(item.url).host
  return domainOf(item.url) ?? ''
}

function Cover({
  item,
  thumbnail,
  broken,
  onBroken,
  selecting,
  selected,
}: {
  item: DocumentSummary | SearchResult
  thumbnail?: string
  broken: boolean
  onBroken: () => void
  selecting: boolean
  selected?: boolean
}) {
  const p = usePalette()
  const dark = useIsDark()

  if (selecting) {
    return (
      <View className="h-[76px] w-[60px] items-center justify-center rounded-[10px] bg-sunken">
        <Ionicons
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={24}
          color={selected ? p.accent : p.faint}
        />
      </View>
    )
  }

  if (thumbnail && !broken) {
    return (
      <View className="h-[76px] w-[60px] overflow-hidden rounded-[10px]">
        <Image
          source={{ uri: thumbnail }}
          style={{ width: 60, height: 76, opacity: dark ? 0.72 : 1 }}
          resizeMode="cover"
          onError={onBroken}
        />
      </View>
    )
  }

  return (
    <View
      className="h-[76px] w-[60px] items-center justify-center rounded-[10px]"
      style={{ backgroundColor: tileFor(domainOf(item.url) ?? item.url, dark) }}
    >
      <Text className="text-[22px] font-semibold tracking-[-0.44px] text-white opacity-90">
        {initialOf(item)}
      </Text>
    </View>
  )
}

/**
 * One row of the saved-items list: a 60×76 cover, a 16.5dp title, source and time below, a quiet status mark on the right.
 * v3 keeps one row as one item — no card, no chevron.
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
  const tap = useTapGuard()
  const t = useT()
  const [imageBroken, setImageBroken] = useState(false)
  const thumbnail = (item.image_files ?? []).find((file) => Boolean(file)) ?? (item.images ?? [])[0]
  const source = sourceOf(item)
  const date = showDate ? formatRelativeDate(item.saved_at) : ''

  return (
    <Pressable
      onPressIn={tap.onPressIn}
      onPress={(event) => {
        if (tap.shouldPress(event)) onPress()
      }}
      onLongPress={() => {
        tap.markLongPress()
        onLongPress?.()
      }}
      delayLongPress={320}
      accessibilityRole="button"
      accessibilityState={selecting ? { selected: Boolean(selected) } : undefined}
      accessibilityLabel={
        selected ? t('row.selected', { title: item.title || item.url }) : item.title || item.url
      }
    >
      {({ pressed }) => (
        <View style={{ opacity: pressed ? 0.6 : 1 }} className="flex-row items-start gap-3.5 py-[13px]">
          <Cover
            item={item}
            thumbnail={thumbnail}
            broken={imageBroken}
            onBroken={() => setImageBroken(true)}
            selecting={selecting}
            selected={selected}
          />
          <View className="min-w-0 flex-1 pt-px">
            <Text
              className="text-[16.5px] font-semibold leading-[24px] tracking-[-0.25px] text-ink"
              numberOfLines={2}
            >
              {titleOf(item)}
            </Text>
            <View className="mt-1.5 flex-row items-center gap-[7px]">
              {source ? (
                <Text className="max-w-[52%] text-[12.5px] text-muted" numberOfLines={1}>
                  {source}
                </Text>
              ) : null}
              {source && date ? (
                <View className="h-[2px] w-[2px] rounded-full bg-line-strong" />
              ) : null}
              {date ? (
                <Text className="text-[12.5px] text-faint" numberOfLines={1}>
                  {date}
                </Text>
              ) : null}
              <View className="ml-auto flex-row items-center gap-2">
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
                    <Text className="text-[12.5px] text-ink">{t('common.retry')}</Text>
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

/**
 * One search result: cover + title, then the sentence the user remembers (a real hit excerpt),
 * then the evidence line. Nothing says “match type” in a heading — the excerpt does that work.
 */
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
  const tap = useTapGuard()
  const [imageBroken, setImageBroken] = useState(false)
  const source = sourceOf(item)
  const date = showDate ? formatRelativeDate(item.saved_at) : ''

  return (
    <Pressable
      onPressIn={tap.onPressIn}
      onPress={(event) => {
        if (tap.shouldPress(event)) onPress()
      }}
      onLongPress={() => tap.markLongPress()}
      delayLongPress={320}
      accessibilityRole="button"
      accessibilityLabel={item.title || item.url}
      className="py-4"
    >
      {({ pressed }) => (
        <View style={{ opacity: pressed ? 0.6 : 1 }}>
          <View className="flex-row items-start gap-3.5">
            <Cover
              item={item}
              broken={imageBroken}
              onBroken={() => setImageBroken(true)}
              selecting={false}
            />
            <View className="min-w-0 flex-1 pt-px">
              <Text
                className="text-[17px] font-semibold leading-[25px] tracking-[-0.3px] text-ink"
                numberOfLines={2}
              >
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
              <View className="mt-[7px] flex-row items-center gap-[7px]">
                {source ? (
                  <Text className="max-w-[52%] text-[12.5px] text-muted" numberOfLines={1}>
                    {source}
                  </Text>
                ) : null}
                {source && date ? (
                  <View className="h-[2px] w-[2px] rounded-full bg-line-strong" />
                ) : null}
                {date ? (
                  <Text className="text-[12.5px] text-faint" numberOfLines={1}>
                    {date}
                  </Text>
                ) : null}
                <View className="ml-auto">
                  <LiveStatusMark
                    docId={item.document_id}
                    status={item.parse_status}
                    errorCode={item.parse_error_code ?? null}
                    onTerminal={onTerminal}
                  />
                </View>
              </View>
            </View>
          </View>

          {item.matched_excerpt ? (
            <View className="relative mt-3 rounded-[12px] bg-sunken py-3 pl-[15px] pr-3.5">
              <View className="absolute bottom-[13px] left-0 top-[13px] w-0.5 rounded-full bg-accent" />
              <Text className="text-[14.5px] leading-[24px] tracking-[-0.06px] text-muted" numberOfLines={2}>
                {highlight(item.matched_excerpt, terms).map((part, i) =>
                  typeof part === 'string' ? (
                    <Text key={i}>{part}</Text>
                  ) : (
                    <Text key={i} className="font-semibold text-accent">
                      {part.hit}
                    </Text>
                  ),
                )}
              </Text>
            </View>
          ) : null}

          <View className="mt-[9px] flex-row items-center gap-2">
            <Text className="flex-shrink text-[12px] text-faint" numberOfLines={1}>
              {item.match_reason}
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  )
}
