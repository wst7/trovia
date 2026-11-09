/**
 * The outbox, as pure functions.
 *
 * The service worker can be killed at any moment, so the queue lives in
 * chrome.storage and every operation has to be safe to repeat. Keeping the
 * rules here means they can be tested without a browser.
 */

/** A queue entry: the record to send plus when it first failed. */
export function enqueue(queue, record, at = Date.now()) {
  const list = Array.isArray(queue) ? queue : []
  // Saving the same page twice while offline must not create two entries: the
  // record id is derived from the link, so it is the natural identity to merge on.
  const rest = list.filter((item) => item?.record?.id !== record.id)
  // Newest first: the retry pass sends in order, and the newest save is the one
  // whose title the user just saw.
  return [{ record, at }, ...rest].slice(0, 200)
}

/** How many records are waiting to be sent. */
export function pendingCount(queue) {
  return Array.isArray(queue) ? queue.length : 0
}

/** Remove one sent record; used by the retry pass. */
export function drop(queue, id) {
  return (Array.isArray(queue) ? queue : []).filter((item) => item?.record?.id !== id)
}

/** What the toolbar badge should show: saved tick, failure mark, or the pending count. */
export function badgeFor({ justSaved = false, justFailed = false, pending = 0 } = {}) {
  if (justFailed) return { text: '!', color: '#b3352b' }
  if (justSaved) return { text: '✓', color: '#2f6b47' }
  if (pending > 0) return { text: String(pending), color: '#b23a26' }
  return { text: '', color: '#b23a26' }
}

/** Keep the "recently saved" list small: it exists to answer "did I already save this page?". */
export function rememberSaved(index, record, at = Date.now()) {
  const list = Array.isArray(index) ? index : []
  const rest = list.filter((item) => item?.id !== record.id)
  return [{ id: record.id, url: record.payload?.url ?? '', title: record.payload?.title ?? '', at }, ...rest].slice(
    0,
    50,
  )
}

/** Was this link saved before, and when? */
export function findSaved(index, id) {
  if (!Array.isArray(index) || !id) return null
  return index.find((item) => item?.id === id) ?? null
}
