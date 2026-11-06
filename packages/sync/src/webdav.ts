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

/**
 * btoa 在浏览器和 Node 20+ 有，Hermes 不一定有，所以自带一份实现。
 * 用户名密码都是 ASCII 为主，但中文密码也要能编码，先转 UTF-8 再查表。
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
  /** 例如 https://dav.jianguoyun.com/dav/trovia（根目录，末尾斜杠可有可无）。 */
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
   * 目录不存在就建，一次建整条链。
   *
   * 两个真实世界的坑：
   *   1. 用户填的根目录（例如 /dav/test）本身可能不存在。只建 docs/ 会得到 409，
   *      因为 WebDAV 不允许跳过父目录建子目录——所以先建 base 自己。
   *   2. MKCOL 的返回各服务器不一样：已存在时坚果云回 201、Nextcloud 回 405、
   *      有的回 301。这些都不算错误；409 才是「父目录没有」，必须报出来。
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
    // 目录刚建好、还没文件：207 里没有 <d:response>，当作空。
    // 404 = 没有这个目录；409 = 父目录都没有（坚果云就是 409）。
    // 两种情况都当成「暂时还没有内容」，不要让它把整次同步顶掉。
    if (response.status === 404 || response.status === 409) return []
    if (response.status !== 207) {
      throw new Error(`PROPFIND ${dir} 失败：${response.status} ${response.statusText}`)
    }
    const xml = await response.text()
    const entries: SyncEntry[] = []
    // 只取 href 与内容长度，够引擎用了；不引入 XML 解析器。
    const basePath = dir.replace(/^\/+|\/+$/g, '')
    const marker = `/${basePath}/`
    for (const block of xml.split(/<\/d:response>|<\/D:response>/i).slice(0, -1)) {
      const href = /<(?:d|D):href>([^<]+)</i.exec(block)?.[1]
      if (!href) continue
      const path = decodeURIComponent(href).split('?')[0]
      const trimmed = path.replace(/\/+$/, '')
      if (!trimmed) continue
      // 集合自己也在 207 里（坚果云的 href 末尾还可能没有斜杠），必须跳过，
      // 否则它会变成一条 path 为整串地址的假条目，同步时还会去 GET 它。
      if (trimmed === basePath || trimmed.endsWith(`/${basePath}`)) continue
      // 子目录不参与同步（我们只用一层 docs/）。
      if (path.endsWith('/')) continue
      // 路径相对**根目录**返回（docs/a.json），因为读取时引擎直接拿它去 GET；
      // 只剥到 docs/ 之后会变成 a.json，GET 就打到根上去了。
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
