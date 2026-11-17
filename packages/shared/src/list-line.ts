/**
 * List-line detection: decide whether one Markdown line is a list item.
 *
 * Extracted text is not well-formed: WeChat bodies often put a character right
 * after the dot (`3.` then text, no space), while `3.5` is a number, not an item.
 * This module only classifies; rendering lives in the Markdown components.
 */
export interface ListLine {
  ordered: boolean
  /** Keep the author's own number (`3.`) so a continuation is not renumbered. */
  marker: string
  text: string
  /** Nesting level: two spaces per level, capped at 3. */
  depth: number
}

const depthOf = (indent: string): number => {
  const width = indent.replace(/\t/g, '  ').length
  return width === 0 ? 0 : Math.min(3, Math.ceil(width / 2))
}

const UNORDERED = /^(\s*)[-*·•]\s+(.*)$/
const ORDERED = /^(\s*)(?:(\d{1,3})[.、)）]|（(\d{1,3})）)\s*(?![0-9])(.*)$/

export function parseListLine(raw: string): ListLine | null {
  const unordered = UNORDERED.exec(raw)
  if (unordered) {
    return { ordered: false, marker: '·', text: unordered[2], depth: depthOf(unordered[1]) }
  }
  const ordered = ORDERED.exec(raw)
  if (ordered) {
    return {
      ordered: true,
      marker: `${ordered[2] ?? ordered[3]}.`,
      text: ordered[4],
      depth: depthOf(ordered[1]),
    }
  }
  return null
}
