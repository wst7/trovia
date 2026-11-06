/**
 * 检查有没有新版本。
 *
 * 只用 GitHub 的公开 Release：没有后端、没有账号，也就没有「谁在用什么版本」的记录。
 * 限流是每小时 60 次（按 IP），一次检查要缓存 6 小时，正常使用碰不到。
 *
 * 纯逻辑（版本比较、解析 asset）单独导出来，测试里不联网。
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

const REPO = 'wst7/trovia'
const API = `https://api.github.com/repos/${REPO}/releases/latest`
const CACHE_KEY = 'trovia.update.check.v1'
const TTL_MS = 6 * 60 * 60 * 1000

export interface ReleaseAsset {
  name: string
  url: string
  size: number
}

export interface ReleaseInfo {
  version: string
  notes: string
  publishedAt: string
  asset: ReleaseAsset | null
}

export interface CheckResult {
  current: string
  latest: ReleaseInfo | null
  hasUpdate: boolean
  /** 检查本身失败（离线、限流、404）时的原因，界面上要说清楚。 */
  error: string | null
  checkedAt: string
}

/** 1.2.3 → [1,2,3]；容忍 v 前缀、后缀（-beta）。 */
export function parseVersion(input: string): number[] {
  const clean = input.trim().replace(/^v/i, '').split(/[-+]/)[0]
  return clean
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((value) => (Number.isFinite(value) ? value : 0))
}

/** 远端版本比当前新才算更新；相等或更旧都不提示。 */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left > right) return true
    if (left < right) return false
  }
  return false
}

interface GitHubRelease {
  tag_name?: string
  body?: string
  published_at?: string
  assets?: { name?: string; browser_download_url?: string; size?: number }[]
}

/** 只认安卓的 apk；优先 arm64（我们只发布这一种），否则取第一个。 */
export function pickAsset(assets: GitHubRelease['assets']): ReleaseAsset | null {
  const apks = (assets ?? []).filter(
    (asset): asset is { name: string; browser_download_url: string; size?: number } =>
      typeof asset.name === 'string' &&
      asset.name.toLowerCase().endsWith('.apk') &&
      typeof asset.browser_download_url === 'string',
  )
  if (apks.length === 0) return null
  const best = apks.find((asset) => /arm64|universal/i.test(asset.name)) ?? apks[0]
  return { name: best.name, url: best.browser_download_url, size: best.size ?? 0 }
}

export function parseRelease(payload: GitHubRelease): ReleaseInfo | null {
  const version = typeof payload.tag_name === 'string' ? payload.tag_name.replace(/^v/i, '') : ''
  if (!version) return null
  const asset = pickAsset(payload.assets)
  if (!asset) return null
  return {
    version,
    notes: (payload.body ?? '').trim(),
    publishedAt: payload.published_at ?? '',
    asset,
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
 * 查一次。`force` 为真时忽略缓存（用户手动点了检查更新）。
 * 网络失败不会抛错，而是把原因放进 error——检查更新失败不该打断任何事。
 */
export async function checkForUpdate(current: string, force = false): Promise<CheckResult> {
  if (!force) {
    const cached = await readCache()
    // 缓存里存的是「上次查到的最新版」，不是「这台机器该不该更新」：
    // 版本会变（刚装了新包），是否更新每次都要现算。
    if (cached) {
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
      const result: CheckResult = { current, latest: null, hasUpdate: false, error: reason, checkedAt: new Date().toISOString() }
      return result
    }
    const payload = (await response.json()) as GitHubRelease
    const latest = parseRelease(payload)
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
