import { createApiClient } from '@trovia/api'

const API_BASE = '/api/v1'
const TOKEN_KEY = 'trovia_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export const api = createApiClient({
  baseUrl: API_BASE,
  getToken,
  onUnauthorized: (tokenUsed) => {
    // Ignore a late 401 from an old session: a re-login may have happened meanwhile and swapped in a new token.
    if (getToken() !== tokenUsed) return
    clearToken()
    if (!window.location.pathname.startsWith('/login')) {
      window.location.assign('/login')
    }
  },
  timeoutMs: 15_000,
}).api
