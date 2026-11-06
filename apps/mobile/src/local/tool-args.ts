/**
 * 工具参数解析：小模型经常给出带前言、尾逗号的 JSON，尽量救回来。
 * 单独一个文件是因为它必须能在 node 里跑（不能带 expo / react-native）。
 */
/** 去掉尾逗号：`{"a":1,}` 这种 JSON.parse 是不认的，模型却常写。 */
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
