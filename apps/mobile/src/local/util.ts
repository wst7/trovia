/** Small helpers for the local layer: URL normalization, ids, time. No dependency on the DOM or on Node. */

export function nowIso(): string {
  return new Date().toISOString()
}

/** Stable id within the device. Falls back to timestamp + random number when crypto.randomUUID is unavailable. */
export function newId(): string {
  const rnd = () => Math.random().toString(36).slice(2, 10)
  return `${Date.now().toString(36)}-${rnd()}-${rnd()}`
}

/**
 * The normalized URL used to de-duplicate saves: lowercase scheme and host, fragment removed, trailing slash removed,
 * common tracking parameters removed. null means it is not a saveable http(s) link.
 *
 * URL / URLSearchParams are not used here: React Native's polyfill support for the latter
 * is incomplete, and hand-written parsing behaves identically on iOS / Android / Hermes.
 */
export function normalizeUrl(raw: string): string | null {
  let input = raw.trim()
  if (!input) return null
  if (!/^https?:\/\//i.test(input)) input = `https://${input}`

  const match = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)(?:\?([^#\s]*))?/i.exec(input)
  if (!match) return null

  const protocol = `${match[1].toLowerCase()}:`
  const host = match[2].toLowerCase()
  // The domain needs a suffix, but LAN-style addresses such as localhost are allowed too.
  if (!host.replace(/:\d+$/, '').includes('.') && !/^localhost(:\d+)?$/.test(host)) return null

  let path = match[3] || '/'
  const query = match[4] ?? ''

  const junk = /^(utm_|fbclid|gclid|spm|share_|ref$|source$|from$)/i
  const kept = query
    .split('&')
    .filter(Boolean)
    .filter((pair) => {
      const rawKey = pair.split('=')[0] ?? ''
      let key = rawKey
      try {
        key = decodeURIComponent(rawKey)
      } catch {
        // Invalid percent-encoding is judged on the raw text; the whole link must not fail to save because of it.
      }
      return !junk.test(key)
    })

  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  const search = kept.length > 0 ? `?${kept.join('&')}` : ''
  return `${protocol}//${host}${path}${search}`
}

export function hostOf(url: string): string {
  const match = /^https?:\/\/([^/?#\s]+)/i.exec(url.trim())
  return (match?.[1] ?? url).toLowerCase().replace(/^www\./, '')
}

export function parseJsonArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** Squash arbitrary text onto one line, for single-line display such as a title/summary. */
export function oneLine(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * Share sheets / the clipboard usually carry the title and the link together. Take the first non-empty line of text that is not the link,
 * as the title seed; when no body can be fetched it can at least show “what this is” instead of a bare URL.
 */
export function titleHintFrom(text: string, url: string): string | null {
  const withoutUrl = text.split(url).join('\n').replace(/https?:\/\/\S+/g, '\n')
  for (const raw of withoutUrl.split('\n')) {
    const line = raw
      .replace(/^(?:分享|分享自|来自|文章|标题|链接)\s*[：:]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (line.length < 2) continue
    if (/^[\s，。、；：！？·…—\-()（）【】“”‘’"'.,;:!?]+$/.test(line)) continue
    return oneLine(line, 140)
  }
  return null
}

/** Derive the source type from the domain; this only affects display and does not change the fetch logic. */
export function sourceTypeOf(url: string): 'web' | 'wechat' | 'github' | 'youtube' | 'bilibili' | 'twitter' {
  const host = hostOf(url).replace(/:\d+$/, '')
  if (host === 'mp.weixin.qq.com') return 'wechat'
  if (host === 'github.com' || host.endsWith('.github.com') || host === 'gist.github.com') return 'github'
  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') return 'youtube'
  if (host === 'bilibili.com' || host.endsWith('.bilibili.com') || host === 'b23.tv') return 'bilibili'
  if (host === 'x.com' || host === 'twitter.com' || host.endsWith('.twitter.com')) return 'twitter'
  return 'web'
}
