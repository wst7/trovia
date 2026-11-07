import type { ReactNode } from 'react'

/**
 * Restricted Markdown renderer: it only turns headings, paragraphs, lists, quotes, code blocks, bold, italics, inline code
 * and http(s) links into React elements. Text is always escaped by React and no raw HTML is parsed
 * (dangerouslySetInnerHTML is not used).
 */

const INLINE_PATTERN = /(`[^`]+`|\*\*[^*]+?\*\*|\*[^*]+?\*|\[[^\]]+\]\([^)\s]+\))/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const parts = text.split(INLINE_PATTERN)
  parts.forEach((part, i) => {
    if (!part) return
    const key = `${keyPrefix}-${i}`
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      nodes.push(<code key={key}>{part.slice(1, -1)}</code>)
    } else if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      nodes.push(<strong key={key}>{renderInline(part.slice(2, -2), key)}</strong>)
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      nodes.push(<em key={key}>{renderInline(part.slice(1, -1), key)}</em>)
    } else {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part)
      if (linkMatch && /^https?:\/\//.test(linkMatch[2])) {
        nodes.push(
          <a key={key} href={linkMatch[2]} target="_blank" rel="noopener noreferrer">
            {linkMatch[1]}
          </a>,
        )
      } else {
        nodes.push(<span key={key}>{part}</span>)
      }
    }
  })
  return nodes
}

export function Markdown({ source }: { source: string }) {
  return <>{renderBlocks(source)}</>
}

function renderBlocks(source: string): ReactNode[] {
  const lines = source.split(/\r?\n/)
  const blocks: ReactNode[] = []
  let paragraph: string[] = []
  let listItems: string[] = []
  let ordered = false
  let inFence = false
  let fenceBuffer: string[] = []
  let fenceKey = 0

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    const text = paragraph.join(' ')
    blocks.push(<p key={`p-${blocks.length}`}>{renderInline(text, `p${blocks.length}`)}</p>)
    paragraph = []
  }
  const flushList = () => {
    if (listItems.length === 0) return
    const items = listItems.map((li, i) => <li key={i}>{renderInline(li, `li${blocks.length}-${i}`)}</li>)
    blocks.push(
      ordered ? (
        <ol key={`ol-${blocks.length}`}>{items}</ol>
      ) : (
        <ul key={`ul-${blocks.length}`}>{items}</ul>
      ),
    )
    listItems = []
  }
  const flushAll = () => {
    flushParagraph()
    flushList()
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inFence) {
        blocks.push(
          <pre key={`code-${fenceKey++}`}>
            <code>{fenceBuffer.join('\n')}</code>
          </pre>,
        )
        fenceBuffer = []
        inFence = false
      } else {
        flushAll()
        inFence = true
      }
      continue
    }
    if (inFence) {
      fenceBuffer.push(line)
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
      const level = Math.min(heading[1].length + 3, 6) // In-body headings start at h4 so they do not clash with the page structure
      const Tag = `h${level}` as 'h4' | 'h5' | 'h6'
      blocks.push(<Tag key={`h-${blocks.length}`}>{renderInline(heading[2], `h${blocks.length}`)}</Tag>)
      continue
    }
    const quote = /^>\s?(.*)$/.exec(trimmed)
    if (quote) {
      flushAll()
      blocks.push(<blockquote key={`q-${blocks.length}`}>{renderInline(quote[1], `q${blocks.length}`)}</blockquote>)
      continue
    }
    const unorderedItem = /^[-*]\s+(.*)$/.exec(trimmed)
    if (unorderedItem) {
      flushParagraph()
      if (ordered) flushList()
      ordered = false
      listItems.push(unorderedItem[1])
      continue
    }
    const orderedItem = /^\d+\.\s+(.*)$/.exec(trimmed)
    if (orderedItem) {
      flushParagraph()
      if (!ordered) flushList()
      ordered = true
      listItems.push(orderedItem[1])
      continue
    }
    flushList()
    paragraph.push(trimmed)
  }
  if (inFence && fenceBuffer.length > 0) {
    blocks.push(
      <pre key={`code-${fenceKey++}`}>
        <code>{fenceBuffer.join('\n')}</code>
      </pre>,
    )
  }
  flushAll()
  return blocks
}
