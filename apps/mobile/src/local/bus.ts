/** Tiny change notification: after a write to the local database, tells the UI to read again. */
type Listener = () => void

const listeners = new Set<Listener>()

export function emitChange(): void {
  for (const listener of [...listeners]) listener()
}

export function subscribeChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
