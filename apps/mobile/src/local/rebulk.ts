/**
 * Re-fetch the body of the entire library.
 *
 * The extraction rules improve, but old entries hold the body fetched on the day they were saved, so they could only be fixed by tapping "refresh" one by one —
 * doing that by hand for 313 entries is not realistic. So this is an interruptible job: queued one at a time, reporting progress after each one,
 * so the user can stop whenever they want.
 *
 * Deliberately not run in concurrent batches: hitting a dozen sites in a row both invites rate limiting and leaves the user unable to tell how far the progress actually got.
 */
import { processPendingQueue } from './pipeline'
import { markForRetry } from './repo'
import { getDb } from './db'

export interface ReprocessProgress {
  done: number
  total: number
  /** Title of the entry just finished, so it is clear it is working rather than stuck. */
  current: string | null
}

/** Entries that need re-fetching: all documents that exist normally (failed ones have their own entry point). */
async function listTargets(): Promise<{ id: string; title: string | null }[]> {
  const db = await getDb()
  return db.getAllAsync<{ id: string; title: string | null }>(
    `SELECT id, title FROM documents
      WHERE deleted_at IS NULL
      ORDER BY saved_at DESC`,
  )
}

export async function countReprocessTargets(): Promise<number> {
  return (await listTargets()).length
}

/**
 * @param onProgress called back after each entry is processed
 * @param shouldStop stop before the next entry when it returns true (the user tapped stop)
 */
export async function reprocessAll(
  onProgress: (progress: ReprocessProgress) => void,
  shouldStop: () => boolean = () => false,
): Promise<{ processed: number; stopped: boolean }> {
  const targets = await listTargets()
  const total = targets.length
  let done = 0

  for (const target of targets) {
    if (shouldStop()) return { processed: done, stopped: true }
    onProgress({ done, total, current: target.title })
    try {
      await markForRetry(target.id)
      await processPendingQueue()
    } catch {
      // A single failure (network, site refusal) does not affect the batch: it is recorded on that entry's own status.
    }
    done += 1
  }

  onProgress({ done, total, current: null })
  return { processed: done, stopped: false }
}
