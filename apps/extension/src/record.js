/**
 * Shared record format used by both the extension and the mobile app.
 *
 * The rules here must stay identical to apps/mobile/src/local/util.ts and sync-store.ts:
 * once the dedupe rules drift, the same link becomes two records in the cloud and the phone shows duplicate entries.
 * test/sync.test.mjs compares against the mobile app's normalization output, so changing this means changing the test as well.
 */

/** Tracking parameters, stripped on save; the mobile app uses the same regex. */
const TRACKING = /^(utm_|fbclid|gclid|spm|share_|ref$|source$|from$)/i

export function normalizeUrl(raw) {
  let input = String(raw ?? '').trim()
  if (!input) return null
  if (!/^https?:\/\//i.test(input)) input = `https://${input}`

  const match = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)(?:\?([^#\s]*))?/i.exec(input)
  if (!match) return null

  const protocol = `${match[1].toLowerCase()}:`
  const host = match[2].toLowerCase()
  if (!host.replace(/:\d+$/, '').includes('.') && !/^localhost(:\d+)?$/.test(host)) return null

  let path = match[3] || '/'
  const query = match[4] ?? ''
  const kept = query
    .split('&')
    .filter(Boolean)
    .filter((pair) => {
      const rawKey = pair.split('=')[0] ?? ''
      let key = rawKey
      try {
        key = decodeURIComponent(rawKey)
      } catch {
        // Judge malformed encoding on the raw text — a key must not become unsaveable because of it.
      }
      return !TRACKING.test(key)
    })

  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  const search = kept.length > 0 ? `?${kept.join('&')}` : ''
  return `${protocol}//${host}${path}${search}`
}

export function hostOf(url) {
  const match = /^https?:\/\/([^/?#\s]+)/i.exec(String(url ?? '').trim())
  return (match?.[1] ?? url).toLowerCase().replace(/^www\./, '')
}

/**
 * The document id is derived from the normalized link, not a random number.
 *
 * Creating a new entry with a random id is what the mobile app does, and the extension cannot (two machines each saving the same link would get two records).
 * Hashing the link means saving the same page again lands on the same file, rev increases, and it overwrites itself.
 */
export function docId(url) {
  const canonical = normalizeUrl(url)
  if (!canonical) return null
  let hash = 0x811c9dc5
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `w${hash.toString(16).padStart(8, '0')}`
}

/**
 * A record waiting to be fetched. payload holds only what the mobile app has right away:
 * link, title, source site. The body is left for the mobile app to fetch, otherwise the extension would have to maintain a second parser.
 */
export function buildRecord({ url, title, rev = 1, savedAt = new Date().toISOString() }) {
  const canonical = normalizeUrl(url)
  const id = docId(url)
  if (!id) return null
  return {
    id,
    updated_at: savedAt,
    deleted_at: null,
    rev,
    payload: {
      url: canonical,
      canonical_url: canonical,
      title: (title ?? '').trim() || hostOf(canonical),
      site_name: hostOf(canonical),
      source_type: 'web',
      author: null,
      published_at: null,
      description: null,
      summary_short: null,
      summary_long: null,
      keywords: [],
      topics: [],
      language: null,
      content_markdown: null,
      plain_text: null,
      images: [],
      saved_at: savedAt,
      metadata: { saved_by: 'extension' },
    },
  }
}
