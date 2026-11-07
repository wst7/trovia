import { useEffect, useRef, useState } from 'react'
import type { ParseStatus } from '@trovia/shared'
import { isTerminalStatus } from '@trovia/shared'
import { api } from '../api/client'
import { StatusBadge } from './StatusBadge'

const POLL_INTERVAL_MS = 1500

/**
 * Status badge + automatic polling: while non-terminal, query /documents/{id}/status every 1.5s,
 * and stop with an onTerminal callback once a completed/partial/failed terminal state is reached.
 */
export function LiveStatusBadge({
  docId,
  status: initialStatus,
  onTerminal,
}: {
  docId: string
  status: ParseStatus
  onTerminal?: (status: ParseStatus) => void
}) {
  const [status, setStatus] = useState(initialStatus)
  const onTerminalRef = useRef(onTerminal)
  onTerminalRef.current = onTerminal

  useEffect(() => {
    setStatus(initialStatus)
  }, [initialStatus])

  useEffect(() => {
    if (isTerminalStatus(status)) return
    let cancelled = false
    const timer = window.setInterval(() => {
      api
        .getDocumentStatus(docId)
        .then((s) => {
          if (cancelled) return
          setStatus(s.status)
          if (isTerminalStatus(s.status)) onTerminalRef.current?.(s.status)
        })
        .catch(() => {
          // A failed poll does not interrupt the page; wait for the next round
        })
    }, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [docId, status])

  return <StatusBadge status={status} />
}
