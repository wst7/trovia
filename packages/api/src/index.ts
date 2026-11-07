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
  /** API root, e.g. `/api/v1` for the web or `http://192.168.1.10:8000/api/v1` for mobile. */
  baseUrl: string
  /**
   * Read the current token on every request; this may be async (mobile has to await the SecureStore read first).
   * Returning null means signed out.
   */
  getToken: () => string | null | Promise<string | null>
  /**
   * Called when a non-login/register endpoint returns 401. tokenUsed is the token this request actually used,
   * and the platform adapter should use it to ignore late responses from an old session.
   */
  onUnauthorized?: (tokenUsed: string | null, path: string) => void
  /** 15s by default; set to 0 to disable the timeout. */
  timeoutMs?: number
  /** For tests or platform injection; global fetch is used by default. */
  fetchImpl?: typeof fetch
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  /** Fallback message used when the network layer fails (cannot connect / offline) */
  networkMessage?: string
}

function isAuthEndpoint(path: string): boolean {
  return path.startsWith('/auth/login') || path.startsWith('/auth/register')
}

/** Does not use URLSearchParams, so Web and React Native behave the same. */
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

    // The platform adapter can wait for the local credentials to load here.
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
      // A 401 from login/register itself is a form error and does not invalidate the session.
      if (res.status === 401 && !isAuthEndpoint(path)) {
        config.onUnauthorized?.(token, path)
      }
      throw new ApiError(code, message)
    }

    // Successful responses are wrapped in a {"data": ...} envelope; for a 204 with no body the payload is null.
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
