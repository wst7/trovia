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
import { isNewer, parseRelease, versionFromReleaseUrl } from './version'

const REPO = 'wst7/trovia'
const API = `https://api.github.com/repos/${REPO}/releases/latest`
/**
 * Fallback that does not touch the API.
 *
 * api.github.com is the thing that fails most often on the networks this app is
 * used on (rate limits on a shared address, or the host being unreachable),
 * while github.com itself still works. The release page redirects to
 * /releases/tag/vX.Y.Z, and the asset name is deterministic, so the same answer
 * can be had without the API.
 */
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`
const ASSET_NAME = (version: string) => `trovia-${version}-arm64.apk`

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

class UpdateFetchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

/** GitHub's own words, so the row can say what actually went wrong. */
function describeApiFailure(error: unknown): string {
  if (error instanceof UpdateFetchError) {
    if (error.status === 403 || error.status === 429) return '被 GitHub 限流了，过一会儿再试'
    if (error.status === 404) return '找不到发布页'
    if (error.status) return `GitHub 返回 ${error.status}`
    return error.message
  }
  return '连不上 GitHub'
}

async function fetchFromApi(signal: AbortSignal): Promise<ReleaseInfo | null> {
  const response = await fetch(API, {
    headers: { Accept: 'application/vnd.github+json' },
    signal,
  })
  if (!response.ok) throw new UpdateFetchError('api', response.status)
  const payload = (await response.json()) as GitHubRelease
  return parseRelease(payload)
}

/**
 * Same answer without the API: follow the release page redirect and rebuild the
 * asset address from the tag. The download size is unknown on this path, which
 * the row says out loud instead of printing "0 MB".
 */
async function fetchFromReleasePage(signal: AbortSignal): Promise<ReleaseInfo | null> {
  const response = await fetch(RELEASES_PAGE, { signal, redirect: 'follow' })
  if (!response.ok) throw new UpdateFetchError('page', response.status)
  const version = versionFromReleaseUrl(response.url ?? '')
  if (!version) return null
  const name = ASSET_NAME(version)
  return {
    version,
    notes: '',
    publishedAt: '',
    asset: { name, url: `https://github.com/${REPO}/releases/download/v${version}/${name}`, size: 0 },
  }
}

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
  let apiReason: string | null = null
  try {
    let latest: ReleaseInfo | null = null
    try {
      latest = await fetchFromApi(controller.signal)
    } catch (apiError) {
      // Keep the API's own wording: it is what the user is troubleshooting.
      apiReason = describeApiFailure(apiError)
      latest = await fetchFromReleasePage(controller.signal)
    }
    if (!latest) {
      const reason = apiReason ?? '发布页里没有可安装的安装包'
      const stale = await readCache()
      if (stale) {
        return { ...stale, current, hasUpdate: stale.latest ? isNewer(stale.latest.version, current) : false, error: reason }
      }
      return { current, latest: null, hasUpdate: false, error: reason, checkedAt: new Date().toISOString() }
    }
    await opLog('update.check', { current, latest: latest.version, manual: force, via: apiReason ? 'page' : 'api' })
    const result: CheckResult = {
      current,
      latest,
      hasUpdate: isNewer(latest.version, current),
      error: null,
      checkedAt: new Date().toISOString(),
    }
    await writeCache(result)
    return result
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    const reason = aborted ? '请求超时，检查网络' : '连不上 GitHub，可能在当前网络下被挡住了'
    await opLog('update.fail', { current, reason, api: apiReason })
    return {
      current,
      latest: null,
      hasUpdate: false,
      error: reason,
      checkedAt: new Date().toISOString(),
    }
  } finally {
    clearTimeout(timer)
  }
}
