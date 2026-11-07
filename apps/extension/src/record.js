/**
 * 插件与手机端共用的记录格式。
 *
 * 这里的规则必须和 apps/mobile/src/local/util.ts、sync-store.ts 保持一致：
 * 判重规则一旦漂移，同一个链接就会在云端变成两条，手机上出现重复条目。
 * test/sync.test.mjs 会拿手机端的规范化结果做对照，改这里要一起改测试。
 */

/** 跟踪参数，保存时去掉；手机端是同一份正则。 */
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
        // 非法编码按原文判断，不能让一条链接因此存不进去。
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
 * 文档 id 由规范化后的链接算出，不是随机数。
 *
 * 手机端新建条目用的是随机 id，插件做不到（两台机器各存同一个链接会得到两条）。
 * 用链接做散列，重复保存同一个页面就落在同一个文件上，rev 递增，覆盖的是自己。
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
 * 一条待抓取的记录。payload 里只放手机端立刻就有的东西：
 * 链接、标题、来源站点。正文留给手机端抓，否则插件里要再养一套解析器。
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
