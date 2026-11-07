/**
 * Auto sync: run a round quietly when the app returns to the foreground.
 *
 * No background scheduling: background tasks on a phone are unreliable and make people suspect "it uploaded something without me knowing".
 * Sync only at this moment so the user can expect it: open the app and the content is current.
 */
import { loadConfig, loadPassword, lastSyncAt } from './sync-config'
import { syncNow } from './sync-runner'

/** Minimum interval between two auto syncs: do not hit the cloud drive again right after a sync. */
const MIN_INTERVAL_MS = 5 * 60 * 1000

let running = false

export async function isSyncConfigured(): Promise<boolean> {
  const config = await loadConfig()
  if (!config.baseUrl.trim() || !config.username.trim()) return false
  return (await loadPassword()).length > 0
}

/**
 * Sync only when the conditions hold; every failure is silent — an auto-sync error dialog is more annoying than not syncing at all.
 * Manual sync still explains errors clearly.
 */
/**
 * A record was just saved, so sync once along the way.
 *
 * Do not wait for the 5-minute throttle: right after saving, what the user most wants is "the other device can see it too".
 * But when several are saved in a row only the last round runs — multiple saves within 8 seconds merge into one sync.
 */
let saveTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleSyncAfterSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void syncAfterSave()
  }, 8000)
}

export async function syncAfterSave(): Promise<void> {
  if (running) return
  if (!(await isSyncConfigured())) return
  running = true
  try {
    await syncNow()
  } catch {
    // It is saved already, so a sync failure must not raise an error on the save path; the next foreground will try again.
  } finally {
    running = false
  }
}

export async function maybeAutoSync(): Promise<void> {
  if (running) return
  if (!(await isSyncConfigured())) return

  const last = await lastSyncAt()
  if (last) {
    const age = Date.now() - new Date(last).getTime()
    if (Number.isFinite(age) && age < MIN_INTERVAL_MS) return
  }

  running = true
  try {
    await syncNow()
  } catch {
    // Network down, cloud drive rate limiting, expired password: none of them bother the user, the next foreground will handle it.
  } finally {
    running = false
  }
}
