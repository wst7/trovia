/**
 * Inline Markdown parser.
 *
 * The regex this replaces could not cope with what the GitHub parser emits:
 * a README badge is `[![alt](image)](href)` — an image wrapped in a link — and
 * `\[[^\]]+\]` refuses text containing `]`, so the match failed and the raw
 * `](https://…)` tail leaked into the page as text.
 *
 * Scanning characters instead of matching patterns keeps three things honest:
 * brackets nest (badges), parentheses nest (Wikipedia URLs), and a `](` is
 * never emitted unless a real link consumed it.
 */

export type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'link'; value: string; href: string }
  | { type: 'image'; alt: string; src: string }

/** Index just past the bracket that closes `open`, or -1. Nested brackets are counted. */
function matchBracket(text: string, open: number, openChar: string, closeChar: string): number {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    const char = text[i]
    if (char === '\\') {
      i += 1
      continue
    }
    if (char === openChar) depth += 1
    else if (char === closeChar) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

type Parsed = { token: InlineToken; end: number }
type ParsedImage = { token: Extract<InlineToken, { type: 'image' }>; end: number }

/** `![alt](src)` starting at `start`, or null when this is not an image. */
function readImage(text: string, start: number): ParsedImage | null {
  if (!text.startsWith('![', start)) return null
  const textEnd = matchBracket(text, start + 1, '[', ']')
  if (textEnd === -1 || text[textEnd + 1] !== '(') return null
  const urlEnd = matchBracket(text, textEnd + 1, '(', ')')
  if (urlEnd === -1) return null
  return {
    token: { type: 'image', alt: text.slice(start + 2, textEnd), src: text.slice(textEnd + 2, urlEnd) },
    end: urlEnd + 1,
  }
}

/** `[value](href)` starting at `start`. A linked image becomes a link labelled by its alt text. */
function readLink(text: string, start: number): Parsed | null {
  if (text[start] !== '[') return null
  const textEnd = matchBracket(text, start, '[', ']')
  if (textEnd === -1 || text[textEnd + 1] !== '(') return null
  const urlEnd = matchBracket(text, textEnd + 1, '(', ')')
  if (urlEnd === -1) return null

  const label = text.slice(start + 1, textEnd)
  const href = text.slice(textEnd + 2, urlEnd).trim()

  // A badge is an image inside link text: show the alt text, not the `<img>` source.
  const inner = readImage(label, 0)
  const value = inner?.end === label.length ? inner.token.alt : label
  return { token: { type: 'link', value: value || href, href }, end: urlEnd + 1 }
}

function readDelimited(text: string, start: number, marker: string): Parsed | null {
  if (!text.startsWith(marker, start)) return null
  const close = text.indexOf(marker, start + marker.length)
  if (close === -1) return null
  const value = text.slice(start + marker.length, close)
  if (!value.trim()) return null
  // Bold takes precedence: `**x**` must not be read as italic `*x*`.
  const type = marker === '`' ? 'code' : marker === '**' ? 'bold' : 'italic'
  return { token: { type, value } as InlineToken, end: close + marker.length }
}

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let buffer = ''
  const flush = () => {
    if (buffer) tokens.push({ type: 'text', value: buffer })
    buffer = ''
  }

  let i = 0
  while (i < text.length) {
    const char = text[i]

    if (char === '\\' && i + 1 < text.length) {
      buffer += text[i + 1]
      i += 2
      continue
    }

    if (char === '!' || char === '[') {
      const parsed = readImage(text, i) ?? readLink(text, i)
      if (parsed) {
        flush()
        tokens.push(parsed.token)
        i = parsed.end
        continue
      }
    }

    if (char === '`' || char === '*') {
      const marker = text.startsWith('**', i) ? '**' : char
      const parsed = readDelimited(text, i, marker)
      if (parsed) {
        flush()
        tokens.push(parsed.token)
        i = parsed.end
        continue
      }
    }

    buffer += char
    i += 1
  }

  flush()
  return tokens
}

/**
 * Plain text of a token list: useful for previews and for tests.
 * Inline images contribute nothing — the footer badges they mostly are read as
 * noise in the middle of a sentence, and block-level images are rendered
 * separately by the component.
 */
export function inlineToText(tokens: InlineToken[]): string {
  return tokens
    .map((token) => {
      switch (token.type) {
        case 'text':
        case 'code':
        case 'bold':
        case 'italic':
          return token.value
        case 'link':
          return token.value
        case 'image':
          return ''
      }
    })
    .join('')
}

/**
 * Prepare a body for block rendering.
 *
 * Images get a paragraph of their own so they keep their place in the flow.
 * That split used to run before thinking about badges — an image inside a link
 * (`[![alt](img)](href)`) — and tore the link in half: `[` / image / `](href)`,
 * which printed the leftover `](href)` as text. Flatten badges to text links
 * first, then split the remaining images.
 */
export function normalizeBlockSource(source: string): string {
  const flattened = source.replace(/\[!\[([^\]]*)\]\([^)]*\)\]\(([^)\s]+)\)/g, '[$1]($2)')
  return flattened.replace(/(!\[[^\]]*\]\([^)\s]+\))/g, '\n\n$1\n\n')
}
