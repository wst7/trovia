/**
 * Version comparison, with no imports.
 *
 * Kept apart from update.ts because that module pulls in AsyncStorage, which
 * drags react-native into the module graph and makes the pure logic untestable
 * under node. Nothing here needs a runtime.
 */

/** 1.2.3 → [1,2,3]; tolerates a v prefix and a suffix (-beta). */
export function parseVersion(input: string): number[] {
  const clean = input.trim().replace(/^v/i, '').split(/[-+]/)[0]
  return clean
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((value) => (Number.isFinite(value) ? value : 0))
}

/** Only a remote version newer than the current one counts as an update; equal or older never prompts. */
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

/**
 * Which version to compare against.
 *
 * The installed build's versionName only changes when a new APK is installed,
 * while a hot update swaps the JS without touching it. Comparing the native
 * version alone means a release that arrived by hot update still looks
 * "newer than installed" forever, so the app asks for the full package it no
 * longer needs. Whichever of the two is newer is the honest answer.
 */
export function effectiveVersion(native: string | null, otaTaken: string | null): string | null {
  if (!native) return otaTaken
  if (!otaTaken) return native
  return isNewer(otaTaken, native) ? otaTaken : native
}

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

export interface GitHubRelease {
  tag_name?: string
  body?: string
  published_at?: string
  assets?: { name?: string; browser_download_url?: string; size?: number }[]
}

/** Only Android apks count; prefer arm64 (the only kind we publish), otherwise take the first. */
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
