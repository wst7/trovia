/**
 * A thin wrapper around hot updates (expo-updates).
 *
 * It does three things only: tell whether the embedded bundle or an update is running, check whether there is a new one, download and restart.
 * When no EAS project is configured (a locally built bundle) the whole thing turns itself off quietly without bothering the user.
 */
import { readSetting, writeSetting } from './settings'

let updatesModule: typeof import('expo-updates') | null = null

/** The release version a hot update already delivered. Kept so the update row stops offering the same version again. */
const OTA_TAKEN_KEY = 'update.otaTakenVersion'
/** A bundle downloaded but not started into yet: the row must keep offering "restart", even after a remount. */
const OTA_PENDING_KEY = 'update.otaPending'
/** Which release that waiting bundle belongs to. Recorded when it is downloaded, promoted to "taken" only once it runs. */
const OTA_PENDING_VERSION_KEY = 'update.otaPendingVersion'

export async function readOtaPending(): Promise<boolean> {
  try {
    return (await readSetting(OTA_PENDING_KEY)) === '1'
  } catch {
    return false
  }
}

export async function readOtaPendingVersion(): Promise<string | null> {
  try {
    return await readSetting(OTA_PENDING_VERSION_KEY)
  } catch {
    return null
  }
}

export async function writeOtaPendingVersion(version: string | null | undefined): Promise<void> {
  try {
    await writeSetting(OTA_PENDING_VERSION_KEY, version ?? '')
  } catch {
    // Only affects the restart hint text.
  }
}

export async function writeOtaPending(pending: boolean): Promise<void> {
  try {
    await writeSetting(OTA_PENDING_KEY, pending ? '1' : '0')
  } catch {
    // Only affects whether the restart hint survives a remount.
  }
}

export async function readOtaTakenVersion(): Promise<string | null> {
  try {
    return await readSetting(OTA_TAKEN_KEY)
  } catch {
    return null
  }
}

export async function recordOtaTakenVersion(version: string | null | undefined): Promise<void> {
  if (!version) return
  try {
    await writeSetting(OTA_TAKEN_KEY, version)
  } catch {
    // Losing this only means an extra prompt later; never fail the update over it.
  }
}

async function updates(): Promise<typeof import('expo-updates') | null> {
  if (updatesModule) return updatesModule
  try {
    updatesModule = await import('expo-updates')
    return updatesModule
  } catch {
    return null
  }
}

export interface OtaState {
  /** Whether this build has update capability at all. */
  enabled: boolean
  /** Whether it is currently running on an update (false = embedded bundle). */
  runningUpdate: boolean
  /** The first 6 characters of the current update id, for matching against logs. */
  updateId: string | null
  /** When this update was published (ISO). */
  createdAt: string | null
}

export async function readOtaState(): Promise<OtaState> {
  const expo = await updates()
  if (!expo?.isEnabled) {
    return { enabled: false, runningUpdate: false, updateId: null, createdAt: null }
  }
  const id = typeof expo.updateId === 'string' ? expo.updateId : null
  return {
    enabled: true,
    runningUpdate: expo.isEmbeddedLaunch === false,
    updateId: id ? id.slice(0, 6) : null,
    createdAt: expo.createdAt ? expo.createdAt.toISOString() : null,
  }
}

/** Turn expo-updates' raw error into plain language: only "never published yet" needs explaining, everything else means retry. */
export function describeOtaError(error: unknown): 'noChannel' | 'misconfigured' | 'network' | 'other' {
  const text = error instanceof Error ? error.message : String(error)
  if (/no channel named|channel.*not found/i.test(text)) return 'noChannel'
  if (/HTTP 400|expo-channel-name|expo-runtime-version/i.test(text)) return 'misconfigured'
  if (/network|timeout|Unable to resolve host|Failed to fetch/i.test(text)) return 'network'
  return 'other'
}

export type OtaOutcome =
  | { kind: 'unavailable' }
  | { kind: 'latest' }
  | { kind: 'downloaded'; id: string | null }

/**
 * Is there a JavaScript update waiting on the channel?
 *
 * Cheap and side-effect free: no download, no restart. This is the only thing
 * the app should ask when deciding "is there a hot update for me", because the
 * channel does not move the version number and GitHub knows nothing about it.
 */
export async function checkOtaAvailability(): Promise<{ available: boolean; id: string | null }> {
  const expo = await updates()
  if (!expo?.isEnabled) return { available: false, id: null }
  try {
    const check = await expo.checkForUpdateAsync()
    return { available: Boolean(check.isAvailable), id: check.manifest?.id?.slice(0, 6) ?? null }
  } catch {
    // No channel, offline, or a broken manifest: no hot update to offer.
    return { available: false, id: null }
  }
}

/** Check + download; once downloaded, the caller decides when to restart (reload). */
export async function checkOta(): Promise<OtaOutcome> {
  const expo = await updates()
  if (!expo?.isEnabled) return { kind: 'unavailable' }
  const check = await expo.checkForUpdateAsync()
  if (!check.isAvailable) return { kind: 'latest' }
  const fetched = await expo.fetchUpdateAsync()
  return { kind: 'downloaded', id: fetched.manifest?.id?.slice(0, 6) ?? null }
}

/** Restart into the new bundle. */
export async function applyOta(): Promise<void> {
  const expo = await updates()
  if (!expo?.isEnabled) throw new Error('这个包没有开启热更新')
  await expo.reloadAsync()
}
