/**
 * Tool-argument parsing: small models often emit JSON with a preamble or a trailing comma, so salvage it as far as possible.
 * It sits in its own file because it has to be able to run under node (it must not pull in expo / react-native).
 */
/** Strip the trailing comma: JSON.parse does not accept `{"a":1,}`, yet models write it all the time. */
function dropTrailingCommas(text: string): string {
  return text.replace(/,\s*([}\]])/g, '$1')
}

export function parseToolArguments(raw: string): Record<string, unknown> {
  const text = dropTrailingCommas((raw ?? '').trim())
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(dropTrailingCommas(text.slice(start, end + 1))) as Record<string, unknown>
      } catch {
        return {}
      }
    }
    return {}
  }
}
