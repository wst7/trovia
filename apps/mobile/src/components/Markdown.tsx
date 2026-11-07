import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Image, Linking, Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import { t } from '../i18n'

/**
 * Restricted Markdown renderer: headings, paragraphs, lists, quotes, code blocks, inline code/bold/italic,
 * and http(s) links. Text is always emitted as Text children; raw HTML is never parsed and no WebView is used.
 */

const INLINE_PATTERN = /(`[^`]+`|\*\*[^*]+?\*\*|\*[^*]+?\*|\[[^\]]+\]\([^)\s]+\))/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const parts = text.split(INLINE_PATTERN)

  parts.forEach((part, i) => {
    if (!part) return
    const key = `${keyPrefix}-${i}`

    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      nodes.push(
        <Text key={key} className="text-body-sm text-ink">
          {part.slice(1, -1)}
        </Text>,
      )
      return
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      nodes.push(
        <Text key={key} className="font-semibold text-ink">
          {renderInline(part.slice(2, -2), key)}
        </Text>,
      )
      return
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      nodes.push(
        <Text key={key} className="italic text-ink">
          {renderInline(part.slice(1, -1), key)}
        </Text>,
      )
      return
    }

    const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part)
    if (linkMatch && /^https?:\/\//i.test(linkMatch[2])) {
      nodes.push(
        <Text
          key={key}
          className="text-accent underline"
          accessibilityRole="link"
          onPress={() => {
            void Linking.openURL(linkMatch[2]).catch(() => undefined)
          }}
        >
          {linkMatch[1]}
        </Text>,
      )
      return
    }

    nodes.push(part)
  })

  return nodes
}

/** Images in the body: full width, height from the real aspect ratio, so a tall image isn't cropped to a strip. */
function ArticleImage({ uri, alt, onPress }: { uri: string; alt?: string; onPress?: () => void }) {
  const [ratio, setRatio] = useState(16 / 10)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    Image.getSize(
      uri,
      (width, height) => {
        if (!cancelled && width > 0 && height > 0) setRatio(width / height)
      },
      () => {
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [uri])

  if (failed) return null

  // alt is often a filename (IMG_2043.png) or just the word for "image"; as a caption that is only noise.
  const caption = (alt ?? '').trim()
  // Sites like CSDN stuff a whole sentence such as "latest recommended article published on 2026-10-12" into alt,
  // which shows up as noise unrelated to the image and may also repeat the date from the page header.
  const captionIsNoise =
    caption.length < 4 ||
    caption.length > 80 ||
    /(?:发布|发表于|发布于|更新时间|版权|侵权|扫码)/.test(caption) ||
    /\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}/.test(caption) ||
    /^(?:图片|图像|image|photo|screenshot)$/i.test(caption) ||
    /^[\w-]+\.(?:png|jpe?g|gif|webp|avif)$/i.test(caption)

  return (
    <View className="mb-4">
    <Pressable
      onPress={onPress}
      className="mb-4 overflow-hidden rounded-sm bg-sunken"
      style={{ width: '100%', aspectRatio: ratio }}
      accessibilityRole="imagebutton"
      accessibilityLabel={t('detail.viewImage')}
    >
      <Image
        source={{ uri }}
        style={{ width: '100%', height: '100%' }}
        resizeMode="cover"
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
      />
    </Pressable>
    {!captionIsNoise ? (
      <Text className="mt-2 text-caption text-faint" numberOfLines={2}>
        {caption}
      </Text>
    ) : null}
    </View>
  )
}

export function Markdown({
  source,
  onImagePress,
  resolveImage,
}: {
  source: string
  /** Opening an image: hand over all the images in the article so they can be swiped side to side. */
  onImagePress?: (url: string, images: string[]) => void
  /** Remote URL → local file; once images are on disk the detail screen uses this to show them offline. */
  resolveImage?: (url: string) => string
}) {
  // Images always get a paragraph of their own: when a paragraph holds both text and images, the original order still holds.
  const normalized = source.replace(/(!\[[^\]]*\]\([^)\s]+\))/g, '\n\n$1\n\n')
  const images = [...new Set([...source.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((match) => match[1]))]
  const resolved = images.map((url) => resolveImage?.(url) ?? url)
  return <View>{renderBlocks(normalized, onImagePress, resolved, resolveImage)}</View>
}

const HEADING_CLASS = [
  'mt-6 mb-3 text-title font-semibold text-ink',
  'mt-6 mb-3 text-title font-semibold text-ink',
  'mt-6 mb-2 text-heading font-semibold text-ink',
  'mt-5 mb-2 text-heading font-semibold text-ink',
  'mt-4 mb-2 text-body font-semibold text-ink',
  'mt-4 mb-2 text-body-sm font-semibold text-ink',
]

function renderBlocks(
  source: string,
  onImagePress?: (url: string, images: string[]) => void,
  images: string[] = [],
  resolveImage?: (url: string) => string,
): ReactNode[] {
  const bodyFont = undefined
  const lines = source.split(/\r?\n/)
  const blocks: ReactNode[] = []
  const state = {
    paragraph: [] as string[],
    listItems: [] as string[],
    ordered: false,
    inFence: false,
    fenceBuffer: [] as string[],
    seq: 0,
  }

  const nextKey = (prefix: string) => {
    const key = `${prefix}-${state.seq}`
    state.seq += 1
    return key
  }

  const flushParagraph = () => {
    if (state.paragraph.length === 0) return
    const key = nextKey('p')
    blocks.push(
      // Long-form reading: line height one notch looser than UI copy, paragraph gaps larger than list gaps, so the eye doesn't stick on a line.
      <Text
        key={key}
        className="text-ink"
        style={[{ fontSize: 17, lineHeight: 31, marginBottom: 14 }, bodyFont]}
      >
        {renderInline(state.paragraph.join(' '), key)}
      </Text>,
    )
    state.paragraph = []
  }

  const flushList = () => {
    if (state.listItems.length === 0) return
    const key = nextKey('list')
    const items = state.listItems.map((item, i) => (
      <View key={`${key}-${i}`} className="mb-1.5 flex-row gap-2">
        <Text className={state.ordered ? 'w-6 text-body-sm text-muted' : 'w-3 text-body text-faint'}>
          {state.ordered ? `${i + 1}.` : '·'}
        </Text>
        <Text className="flex-1 text-ink" style={[{ fontSize: 16.5, lineHeight: 28 }, bodyFont]}>
          {renderInline(item, `${key}-${i}`)}
        </Text>
      </View>
    ))
    blocks.push(
      <View key={key} className="mb-4">
        {items}
      </View>,
    )
    state.listItems = []
  }

  const flushAll = () => {
    flushParagraph()
    flushList()
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (state.inFence) {
        const key = nextKey('code')
        blocks.push(
          <View key={key} className="mb-4 rounded-sm bg-sunken p-3">
            <Text className="text-mono text-ink" selectable>
              {state.fenceBuffer.join('\n')}
            </Text>
          </View>,
        )
        state.fenceBuffer = []
        state.inFence = false
      } else {
        flushAll()
        state.inFence = true
      }
      continue
    }

    if (state.inFence) {
      state.fenceBuffer.push(line)
      continue
    }

    const trimmed = line.trim()

    const imageMatch = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(trimmed)
    if (imageMatch) {
      flushAll()
      const key = nextKey('img')
      const alt = imageMatch[1]
      const remote = imageMatch[2]
      const uri = resolveImage?.(remote) ?? remote
      blocks.push(
        <ArticleImage
          key={key}
          uri={uri}
          alt={alt}
          onPress={onImagePress ? () => onImagePress(uri, images) : undefined}
        />,
      )
      continue
    }
    if (trimmed === '') {
      flushAll()
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flushAll()
      const level = heading[1].length
      const key = nextKey('h')
      blocks.push(
        <Text key={key} className={HEADING_CLASS[level - 1]}>
          {renderInline(heading[2], key)}
        </Text>,
      )
      continue
    }

    const quote = /^>\s?(.*)$/.exec(trimmed)
    if (quote) {
      flushAll()
      const key = nextKey('q')
      blocks.push(
        <View key={key} className="mb-4 border-l-2 border-line-strong pl-3">
          <Text className="text-muted" style={[{ fontSize: 16, lineHeight: 28 }, bodyFont]}>
            {renderInline(quote[1], key)}
          </Text>
        </View>,
      )
      continue
    }

    const unorderedItem = /^[-*]\s+(.*)$/.exec(trimmed)
    if (unorderedItem) {
      flushParagraph()
      if (state.ordered) flushList()
      state.ordered = false
      state.listItems.push(unorderedItem[1])
      continue
    }

    const orderedItem = /^\d+\.\s+(.*)$/.exec(trimmed)
    if (orderedItem) {
      flushParagraph()
      if (!state.ordered) flushList()
      state.ordered = true
      state.listItems.push(orderedItem[1])
      continue
    }

    flushList()
    state.paragraph.push(trimmed)
  }

  if (state.inFence && state.fenceBuffer.length > 0) {
    const key = nextKey('code')
    blocks.push(
      <View key={key} className="mb-4 rounded-sm bg-sunken p-3">
        <Text className="text-mono text-ink" selectable>
          {state.fenceBuffer.join('\n')}
        </Text>
      </View>,
    )
  }
  flushAll()

  return blocks
}
