import type {
  ApiErrorBody,
  AuthResponse,
  CreateDocumentResponse,
  DocumentDetail,
  DocumentListParams,
  DocumentListResponse,
  DocumentStatusResponse,
  RelatedResponse,
  ReprocessResponse,
  SearchResponse,
  User,
} from '@trovia/shared'
import { ApiError, FRIENDLY_MESSAGES } from '@trovia/shared'

const DEFAULT_TIMEOUT_MS = 15_000
const NETWORK_FALLBACK = '网络连接失败，请稍后重试。'
const GENERIC_FALLBACK = '请求失败，请稍后重试。'

export interface ApiClientConfig {
  /** API 根地址，例如 Web 的 `/api/v1` 或移动端的 `http://192.168.1.10:8000/api/v1`。 */
  baseUrl: string
  /**
   * 每次请求读取当前 token；可以是异步的（移动端需要先等待 SecureStore 读取完成）。
   * 返回 null 表示未登录。
   */
  getToken: () => string | null | Promise<string | null>
  /**
   * 非登录/注册接口返回 401 时调用。tokenUsed 是本次请求实际使用的 token，
   * 平台适配层应据此忽略旧会话的迟到响应。
   */
  onUnauthorized?: (tokenUsed: string | null, path: string) => void
  /** 默认 15s；设为 0 可关闭超时。 */
  timeoutMs?: number
  /** 便于测试或平台注入；默认使用全局 fetch。 */
  fetchImpl?: typeof fetch
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  /** 网络层失败（无法连接/断网）时使用的兜底文案 */
  networkMessage?: string
}

function isAuthEndpoint(path: string): boolean {
  return path.startsWith('/auth/login') || path.startsWith('/auth/register')
}

/** 不使用 URLSearchParams，保证 Web 与 React Native 行为一致。 */
function buildQuery(params: DocumentListParams): string {
  const parts: string[] = []
  const add = (key: string, value: string | number | undefined | null) => {
    if (value === undefined || value === null || value === '') return
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  add('page', params.page)
  add('page_size', params.page_size)
  add('source_type', params.source_type)
  add('parse_status', params.parse_status)
  add('keyword', params.keyword)
  add('sort', params.sort)
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

export function createApiClient(config: ApiClientConfig) {
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const doFetch = config.fetchImpl ?? fetch
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, networkMessage } = options

    // 平台适配层可在这里等待本地凭据读取完成。
    const token = await config.getToken()
    const controller = new AbortController()
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined

    let res: Response
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new ApiError('NETWORK_ERROR', networkMessage ?? NETWORK_FALLBACK)
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }

    let payload: unknown = null
    if (res.status !== 204) {
      try {
        payload = await res.json()
      } catch {
        payload = null
      }
    }

    if (!res.ok) {
      const err = (payload as ApiErrorBody | null)?.error
      const code = err?.code ?? `HTTP_${res.status}`
      const message = err?.message || FRIENDLY_MESSAGES[code] || GENERIC_FALLBACK
      // 登录/注册自身的 401 是表单错误，不触发会话失效。
      if (res.status === 401 && !isAuthEndpoint(path)) {
        config.onUnauthorized?.(token, path)
      }
      throw new ApiError(code, message)
    }

    // 成功响应统一 {"data": ...} 信封；204 无 body 时 payload 为 null。
    return (payload as { data?: T } | null)?.data as T
  }

  const api = {
    register: (email: string, password: string) =>
      request<AuthResponse>('/auth/register', { method: 'POST', body: { email, password } }),
    login: (email: string, password: string) =>
      request<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } }),
    logout: () => request<void>('/auth/logout', { method: 'POST' }),
    me: () => request<User>('/auth/me'),

    createDocument: (url: string) =>
      request<CreateDocumentResponse>('/documents', { method: 'POST', body: { url } }),
    listDocuments: (params: DocumentListParams = {}) =>
      request<DocumentListResponse>(`/documents${buildQuery(params)}`),
    getDocument: (id: string) => request<DocumentDetail>(`/documents/${id}`),
    deleteDocument: (id: string) => request<void>(`/documents/${id}`, { method: 'DELETE' }),
    reprocessDocument: (id: string) =>
      request<ReprocessResponse>(`/documents/${id}/reprocess`, { method: 'POST' }),
    getDocumentStatus: (id: string) => request<DocumentStatusResponse>(`/documents/${id}/status`),
    getRelated: (id: string) => request<RelatedResponse>(`/documents/${id}/related`),

    search: (query: string, limit = 10) =>
      request<SearchResponse>('/search', {
        method: 'POST',
        body: { query, limit },
        networkMessage: '搜索暂时不可用，请稍后重试。',
      }),
  }

  return { api }
}

export type Api = ReturnType<typeof createApiClient>['api']
