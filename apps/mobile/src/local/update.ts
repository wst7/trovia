/**
 * Check whether a new version exists.
 *
 * Uses only public GitHub Releases: no backend, no account, and therefore no record of who runs which version.
 * The rate limit is 60 requests per hour per IP and one check is cached for 6 hours, so normal use never hits it.
 *
 * Pure logic (version comparison, asset parsing) is exported separately so tests need no network.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

import type { GitHubRelease, ReleaseInfo } from './version'
import { isNewer, parseRelease } from './version'

const REPO = 'wst7/trovia'
const API = `https://api.github.com/repos/${REPO}/releases/latest`
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_KEY = 'trovia.update.check.v1'
const TTL_MS = 6 * 60 * 60 * 1000

export interface CheckResult {
  current: string
  latest: ReleaseInfo | null
  hasUpdate: boolean
  /** Why the check itself failed (offline, rate limited, 404); the UI has to spell it out. */
  error: string | null
  checkedAt: string
}

// Re-exported so call sites keep importing from update.ts. These live in
// version.ts because they need no runtime, and update.ts imports AsyncStorage.
export type { ReleaseAsset, ReleaseInfo } from './version'
export { isNewer, parseRelease, parseVersion, pickAsset } from './version'

async function readCache(): Promise<CheckResult | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CheckResult
    if (!parsed?.checkedAt) return null
    if (Date.now() - Date.parse(parsed.checkedAt) > TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

async function writeCache(result: CheckResult): Promise<void> {
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(result)).catch(() => undefined)
}

/**
 * Run one check. When `force` is true the cache is ignored (the user tapped check for updates).
 * A network failure doesn't throw; the reason goes into error — a failed update check must not interrupt anything.
 */
import { opLog } from './dev-log'

export async function checkForUpdate(current: string, force = false): Promise<CheckResult> {
  if (!force) {
    const cached = await readCache()
    // The cache stays fresh only ten minutes: right after a release, the previously found "latest" would stay pinned next to the version number,
    // and tapping download would still get the previous build. On expiry it asks again; on network failure it still falls back to the cache.
    const fresh =
      cached?.checkedAt !== undefined && Date.now() - new Date(cached.checkedAt).getTime() < CACHE_TTL_MS
    // The cache holds "the latest version seen last time", not "should this device update":
    // the version changes (a new package was just installed), so whether to update is recomputed every time.
    if (cached && fresh) {
      return {
        ...cached,
        current,
        hasUpdate: cached.latest ? isNewer(cached.latest.version, current) : false,
      }
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      const reason =
        response.status === 403 || response.status === 429
          ? '被 GitHub 限流了，过一会儿再试'
          : response.status === 404
            ? '找不到发布页'
            : `GitHub 返回 ${response.status}`
      // On failure fall back to the previous result: better an old version number than that row suddenly saying "unknown".
      const stale = await readCache()
      if (stale) return { ...stale, current, hasUpdate: stale.latest ? isNewer(stale.latest.version, current) : false, error: reason }
      const result: CheckResult = { current, latest: null, hasUpdate: false, error: reason, checkedAt: new Date().toISOString() }
      return result
    }
    const payload = (await response.json()) as GitHubRelease
    const latest = parseRelease(payload)
    await opLog('update.check', { current, latest: latest?.version ?? null, manual: force })
    const result: CheckResult = {
      current,
      latest,
      hasUpdate: latest ? isNewer(latest.version, current) : false,
      error: latest ? null : '发布页里没有可安装的安装包',
      checkedAt: new Date().toISOString(),
    }
    await writeCache(result)
    return result
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return {
      current,
      latest: null,
      hasUpdate: false,
      error: aborted ? '请求超时，检查网络' : '连不上 GitHub，可能在当前网络下被挡住了',
      checkedAt: new Date().toISOString(),
    }
  } finally {
    clearTimeout(timer)
  }
}
