import type { ReactNode } from 'react'
import { Linking, Text, View } from 'react-native'

/**
 * 受限 Markdown 渲染器：标题、段落、列表、引用、代码块、行内代码/粗体/斜体、
 * http(s) 链接。文本始终作为 Text 子节点输出，不解析原始 HTML，也不使用 WebView。
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
        <Text key={key} className="italic">
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

export function Markdown({ source }: { source: string }) {
  return <View>{renderBlocks(source)}</View>
}

const HEADING_CLASS = [
  'mt-6 mb-3 text-title font-semibold text-ink',
  'mt-6 mb-3 text-title font-semibold text-ink',
  'mt-6 mb-2 text-heading font-semibold text-ink',
  'mt-5 mb-2 text-heading font-semibold text-ink',
  'mt-4 mb-2 text-body font-semibold text-ink',
  'mt-4 mb-2 text-body-sm font-semibold text-ink',
]

function renderBlocks(source: string): ReactNode[] {
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
      <Text key={key} className="mb-4 text-body text-ink" style={{ lineHeight: 27 }}>
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
        <Text className="flex-1 text-body text-ink" style={{ lineHeight: 26 }}>
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
          <Text className="text-body-sm text-muted">{renderInline(quote[1], key)}</Text>
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
