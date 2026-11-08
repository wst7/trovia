/**
 * What the version row should say, and what tapping it should do.
 *
 * There is one channel: a new build is a new APK. The row therefore only has to
 * describe "a download is running", "a package is waiting", or "nothing to do".
 *
 * Keeping the decision pure means the whole table is testable without a
 * runtime, which matters because every one of these states has been reported as
 * a bug at some point.
 */

export interface UpdateSnapshot {
  phase: 'idle' | 'checking' | 'downloading' | 'installing' | 'error'
  /** The latest release is newer than the installed package. */
  update: { version: string; sizeBytes: number } | null
  /** Download progress, when one is running. */
  progress: { written: number; ratio: number } | null
}

export type UpdateView =
  | { kind: 'checking' }
  | { kind: 'downloading'; written: number; ratio: number }
  | { kind: 'installing' }
  | { kind: 'error' }
  | { kind: 'available'; version: string; sizeBytes: number }
  | { kind: 'latest' }

export function resolveUpdateView(snapshot: UpdateSnapshot): UpdateView {
  // Work in progress wins: whatever was queued before, this is what is happening.
  if (snapshot.phase === 'checking') return { kind: 'checking' }
  if (snapshot.phase === 'downloading') {
    const p = snapshot.progress
    return { kind: 'downloading', written: p?.written ?? 0, ratio: p?.ratio ?? -1 }
  }
  if (snapshot.phase === 'installing') return { kind: 'installing' }
  if (snapshot.phase === 'error') return { kind: 'error' }
  if (snapshot.update) {
    return { kind: 'available', version: snapshot.update.version, sizeBytes: snapshot.update.sizeBytes }
  }
  return { kind: 'latest' }
}

/** What a tap does, given what is on screen. */
export type UpdateAction = 'check' | 'download' | 'none'

export function resolveUpdateAction(view: UpdateView): UpdateAction {
  switch (view.kind) {
    case 'available':
      return 'download'
    case 'error':
    case 'latest':
      // Retry means "look again", not "start a download of unknown size".
      return 'check'
    case 'checking':
    case 'downloading':
    case 'installing':
      return 'none'
  }
}
