import { useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import type { ParseStatus } from '@trovia/shared'
import { isTerminalStatus } from '@trovia/shared'

import { getStatus } from '../local/repo'

const POLL_INTERVAL_MS = 1200

/**
 * On-device parsing has no server push, so progress can only come from reading the local database:
 * poll only while the app is in the foreground and the status hasn't terminated; the terminal callback fires once.
 * The caller writes the new status back into its own state; the hook itself holds no document.
 */
export function useLiveStatus(
  documentId: string | undefined,
  status: ParseStatus | null | undefined,
  onStatus: (status: ParseStatus) => void,
  onSettled?: (status: ParseStatus) => void,
): void {
  const [active, setActive] = useState(AppState.currentState === 'active')
  const statusRef = useRef(status)
  const onStatusRef = useRef(onStatus)
  const onSettledRef = useRef(onSettled)

  statusRef.current = status
  onStatusRef.current = onStatus
  onSettledRef.current = onSettled

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'))
    return () => sub.remove()
  }, [])

  const terminal = status ? isTerminalStatus(status) : false

  useEffect(() => {
    if (!documentId || terminal || !active) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight = false

    const tick = async () => {
      if (cancelled) return
      if (!inFlight) {
        inFlight = true
        try {
          const row = await getStatus(documentId)
          if (cancelled) return
          if (row && row.status !== statusRef.current) {
            statusRef.current = row.status
            onStatusRef.current(row.status)
            if (isTerminalStatus(row.status)) {
              onSettledRef.current?.(row.status)
              return
            }
          }
        } catch {
          // Database read failed (e.g. the migration hasn't finished): keep polling silently.
        } finally {
          inFlight = false
        }
      }
      if (!cancelled) timer = setTimeout(tick, POLL_INTERVAL_MS)
    }

    timer = setTimeout(tick, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [documentId, terminal, active])
}
