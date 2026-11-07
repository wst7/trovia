/**
 * Retryable failures are quietly tried once more when the app returns to the foreground.
 *
 * "Could not connect to the site" is mostly a signal drop at the time: saving in the subway, on a plane, in a lift. The user should not have to
 * remember to come back and tap retry — but neither may we re-hit dozens of links every time the app comes to the foreground (that is rude
 * to the sites and drains the battery).
 *
 * So: only the categories that are "our side's problem", at most 20 per round, at least 30 minutes between rounds,
 * and failures stay silent. Entries the site refused to serve are not touched at all — their error codes are never in the retryable list.
 */
import { processPendingQueue } from './pipeline'
import { isRetryableError, RETRYABLE_CODES } from './retry'
import * as repo from './repo'
import { readSetting, writeSetting } from './settings'

const LAST_ATTEMPT_KEY = 'trovia.autoRetry.at'
/** Minimum gap between two rounds: retrying right after a failure mostly gives the same result. */
const MIN_INTERVAL_MS = 30 * 60 * 1000
/** Maximum per round: avoid hitting 40 sites in one go. */
const BATCH = 20

let running = false

/**
 * Only counts failures "this device can improve on", the same criterion the UI uses.
 */
export async function countRetryableFailures(): Promise<number> {
  return repo.countRetryableFailed()
}

/** Whether there are entries worth auto-retrying (query only, does not trigger a retry). */
export async function hasRetryableFailures(): Promise<boolean> {
  return (await countRetryableFailures()) > 0
}

export async function maybeRetryFailed(): Promise<number> {
  if (running) return 0
  if (!(await hasRetryableFailures())) return 0

  try {
    const raw = await readSetting(LAST_ATTEMPT_KEY)
    if (raw) {
      const age = Date.now() - new Date(raw).getTime()
      if (Number.isFinite(age) && age < MIN_INTERVAL_MS) return 0
    }
  } catch {
    // Treat an unreadable timestamp as never tried: one extra attempt does no harm.
  }

  running = true
  try {
    await writeSetting(LAST_ATTEMPT_KEY, new Date().toISOString())
    const queued = await repo.retryFailedBatch(BATCH)
    if (queued > 0) await processPendingQueue()
    return queued
  } catch {
    // Silent: an auto-retry failure must not show a dialog, the user never asked for it.
    return 0
  } finally {
    running = false
  }
}

/** For the settings screen: these are the error codes auto-retry will touch. */
export function autoRetryCodes(): string[] {
  return [...RETRYABLE_CODES]
}

export { isRetryableError }
