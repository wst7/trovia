/**
 * What the version row should say, and what tapping it should do.
 *
 * Two independent delivery channels feed one row:
 *
 *   native  the installed package. Only a new APK changes its versionName, and
 *           installing it is the only way to get native changes.
 *   ota     JavaScript only. A few megabytes, applied on the next launch, and
 *           deliberately does not touch the version number.
 *
 * They used to be squeezed into a single version comparison, which is why a
 * downloaded-but-not-applied bundle could look like "already latest" while the
 * old code was still on screen. Keeping the decision pure also lets the whole
 * table be tested without a runtime.
 */

export interface UpdateSnapshot {
  phase: 'idle' | 'checking' | 'downloading' | 'installing' | 'error'
  /** A bundle is downloaded and waiting for a restart. */
  otaPending: boolean
  /** The OTA channel has something newer than what is running. */
  otaAvailable: boolean
  /** The installed package is behind the latest release. */
  nativeUpdate: { version: string; sizeBytes: number } | null
  /** Download progress for the full package, when one is running. */
  progress: { written: number; ratio: number } | null
}

export type UpdateView =
  | { kind: 'checking' }
  | { kind: 'downloading'; written: number; ratio: number }
  | { kind: 'installing' }
  | { kind: 'error' }
  | { kind: 'restart' }
  | { kind: 'ota' }
  | { kind: 'native'; version: string; sizeBytes: number }
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

  // A downloaded bundle outranks everything: the app is not running the newest
  // JavaScript yet, and only a restart fixes that.
  if (snapshot.otaPending) return { kind: 'restart' }

  // JavaScript first: it is a few megabytes and does not need the installer.
  if (snapshot.otaAvailable) return { kind: 'ota' }

  if (snapshot.nativeUpdate) {
    return { kind: 'native', version: snapshot.nativeUpdate.version, sizeBytes: snapshot.nativeUpdate.sizeBytes }
  }

  return { kind: 'latest' }
}

/** What a tap does, given what is on screen. */
export type UpdateAction = 'check' | 'download-ota' | 'restart' | 'download-apk' | 'none'

export function resolveUpdateAction(view: UpdateView): UpdateAction {
  switch (view.kind) {
    case 'restart':
      return 'restart'
    case 'ota':
      return 'download-ota'
    case 'native':
      return 'download-apk'
    case 'error':
      // Retry means "look again", not "start a download of unknown size".
      return 'check'
    case 'latest':
      return 'check'
    case 'checking':
    case 'downloading':
    case 'installing':
      return 'none'
  }
}
