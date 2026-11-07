/**
 * WebDAV adapter — covers Nutstore (Jianguoyun), Nextcloud, Synology, InfiniCLOUD and the like.
 *
 * This is the best-value option on the "bring your own cloud drive" route: it needs no OAuth app review, no
 * native module, and users just enter the server address + an app password. The cloud drives domestic users
 * actually have tend to fall into this category.
 *
 * Note: Nutstore requires an "app password" rather than the login password, and its WebDAV domain is
 * https://dav.jianguoyun.com/dav/。
 */
import type { SyncEntry, SyncTarget } from './index.ts'

/**
 * btoa exists in browsers and Node 20+, but not necessarily in Hermes, so we ship our own implementation.
 * Usernames and passwords are mostly ASCII, but Chinese passwords must encode too: convert to UTF-8 first, then look up the table.
 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(input: string): string {
  const bytes: number[] = []
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63))
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
    else
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      )
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += B64[b0 >> 2]
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]
    out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]
    out += b2 === undefined ? '=' : B64[b2 & 63]
  }
  return out
}

export interface WebDavOptions {
  /** E.g. https://dav.jianguoyun.com/dav/trovia (the root directory; a trailing slash is optional). */
  baseUrl: string
  username: string
  password: string
  /** Per-request timeout, 20s by default. */
  timeoutMs?: number
}

export class WebDavTarget implements SyncTarget {
  private readonly base: string
  private readonly auth: string
  private readonly timeoutMs: number

  constructor(options: WebDavOptions) {
    this.base = options.baseUrl.replace(/\/+$/, '')
    this.auth = `Basic ${base64(options.username + ':' + options.password)}`
    this.timeoutMs = options.timeoutMs ?? 20_000
  }

  private url(path: string): string {
    return `${this.base}/${path.split('/').map(encodeURIComponent).join('/')}`
  }

  private async request(method: string, path: string, body?: string): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await fetch(this.url(path), {
        method,
        headers: {
          Authorization: this.auth,
          ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
        },
        body,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Create the directory if it does not exist, building the whole chain at once.
   *
   * Two real-world pitfalls:
   *   1. The root directory the user typed (e.g. /dav/test) may not exist itself. Creating only docs/ returns 409,
   *      because WebDAV does not allow creating a child while skipping its parent — so create base itself first.
   *   2. MKCOL responses differ per server: for an existing collection Nutstore returns 201, Nextcloud 405
   *      and some return 301. None of these are errors; 409 is the one that means "the parent is missing" and must be reported.
   */
  async ensureDir(path: string): Promise<void> {
    const steps = ['', ...path.split('/').filter(Boolean).map((_, index, all) => all.slice(0, index + 1).join('/'))]
    for (const dir of steps) {
      const response = await this.request('MKCOL', dir)
      if ([201, 204, 301, 405].includes(response.status)) continue
      if (response.status === 409) {
        throw new Error(
          `服务器上没有 ${dir || '根'} 目录，且上级目录不存在（409）。检查设置里的地址与文件夹是否存在、有没有写权限。`,
        )
      }
      throw new Error(`MKCOL ${dir || '根'} 失败：${response.status} ${response.statusText}`)
    }
  }

  async list(prefix: string): Promise<SyncEntry[]> {
    const dir = prefix.replace(/\/+$/, '')
    const response = await this.request('PROPFIND', dir, undefined)
    // The directory was just created and has no files yet: there is no <d:response> in the 207, so treat it as empty.
    // 404 = the directory does not exist; 409 = even the parent is missing (Nutstore returns 409).
    // Both are treated as "there is no content yet"; do not let them abort the whole sync.
    if (response.status === 404 || response.status === 409) return []
    if (response.status !== 207) {
      throw new Error(`PROPFIND ${dir} 失败：${response.status} ${response.statusText}`)
    }
    const xml = await response.text()
    const entries: SyncEntry[] = []
    // Only href and content length are taken, which is enough for the engine; no XML parser is pulled in.
    const basePath = dir.replace(/^\/+|\/+$/g, '')
    const marker = `/${basePath}/`
    for (const block of xml.split(/<\/d:response>|<\/D:response>/i).slice(0, -1)) {
      const href = /<(?:d|D):href>([^<]+)</i.exec(block)?.[1]
      if (!href) continue
      const path = decodeURIComponent(href).split('?')[0]
      const trimmed = path.replace(/\/+$/, '')
      if (!trimmed) continue
      // The collection itself is in the 207 as well (Nutstore's href may even lack the trailing slash), so it must be skipped,
      // otherwise it becomes a fake entry whose path is the whole address, and sync would even GET it.
      if (trimmed === basePath || trimmed.endsWith(`/${basePath}`)) continue
      // Subdirectories do not take part in sync (only a single docs/ level is used).
      if (path.endsWith('/')) continue
      // Paths are returned relative to the **root directory** (docs/a.json), because the engine GETs them directly when reading;
      // stripping only up to docs/ would leave a.json, and that GET would hit the root instead.
      const index = path.indexOf(marker)
      const relative = index >= 0 ? path.slice(index + 1) : path.replace(/^\/+/, '')
      if (!relative) continue
      const size = Number(/<(?:d|D):getcontentlength>(\d+)</i.exec(block)?.[1] ?? 0)
      const etag = /<(?:d|D):getetag>([^<]+)</i.exec(block)?.[1]
      entries.push({ path: relative, size, etag })
    }
    return entries
  }

  async read(path: string): Promise<string | null> {
    const response = await this.request('GET', path)
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`GET ${path} 失败：${response.status}`)
    return response.text()
  }

  async write(path: string, body: string): Promise<void> {
    const response = await this.request('PUT', path, body)
    if (!response.ok) throw new Error(`PUT ${path} 失败：${response.status} ${response.statusText}`)
  }

  async remove(path: string): Promise<void> {
    const response = await this.request('DELETE', path)
    if (!response.ok && response.status !== 404) {
      throw new Error(`DELETE ${path} 失败：${response.status}`)
    }
  }
}
