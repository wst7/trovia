/**
 * WebDAV adapter —— 覆盖坚果云、Nextcloud、群晖、InfiniCLOUD 等。
 *
 * 这是「自带云盘」路线里最划算的一家：不需要 OAuth 应用审核，不需要
 * 原生模块，用户填服务器地址 + 应用密码就能用。国内用户真正手上有的
 * 云盘，多半属于这一类。
 *
 * 注意：坚果云要求使用「应用密码」而不是登录密码，且 WebDAV 域名是
 * https://dav.jianguoyun.com/dav/。
 */
import type { SyncEntry, SyncTarget } from './index.ts'

export interface WebDavOptions {
  /** 例如 https://dav.jianguoyun.com/dav/xunji（根目录，末尾斜杠可有可无）。 */
  baseUrl: string
  username: string
  password: string
  /** 单次请求超时，默认 20s。 */
  timeoutMs?: number
}

export class WebDavTarget implements SyncTarget {
  private readonly base: string
  private readonly auth: string
  private readonly timeoutMs: number

  constructor(options: WebDavOptions) {
    this.base = options.baseUrl.replace(/\/+$/, '')
    // btoa 在 RN 和浏览器都有；Node 侧由测试注入 globalThis.btoa。
    this.auth = `Basic ${btoa(`${options.username}:${options.password}`)}`
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

  /** 目录不存在就建（WebDAV 的 MKCOL 是幂等的，405/301 都算已存在）。 */
  async ensureDir(path: string): Promise<void> {
    const parts = path.split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i += 1) {
      const dir = parts.slice(0, i).join('/')
      const response = await this.request('MKCOL', dir)
      if (![201, 405, 301, 409].includes(response.status)) {
        throw new Error(`MKCOL ${dir} 失败：${response.status} ${response.statusText}`)
      }
    }
  }

  async list(prefix: string): Promise<SyncEntry[]> {
    const dir = prefix.replace(/\/+$/, '')
    const response = await this.request('PROPFIND', dir, undefined)
    // 目录刚建好、还没文件：207 里没有 <d:response>，当作空。
    if (response.status === 404) return []
    if (response.status !== 207) {
      throw new Error(`PROPFIND ${dir} 失败：${response.status} ${response.statusText}`)
    }
    const xml = await response.text()
    const entries: SyncEntry[] = []
    // 只取 href 与内容长度，够引擎用了；不引入 XML 解析器。
    for (const block of xml.split(/<\/d:response>|<\/D:response>/i).slice(0, -1)) {
      const href = /<(?:d|D):href>([^<]+)</i.exec(block)?.[1]
      if (!href) continue
      const decoded = decodeURIComponent(href)
      if (decoded.endsWith('/')) continue
      const marker = `/${dir}/`
      const index = decoded.indexOf(marker)
      const relative = index >= 0 ? decoded.slice(index + 1) : decoded.replace(/^\/+/, '')
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
