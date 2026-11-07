import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import type { ParseStatus } from '@trovia/shared'

import { useLiveStatus } from '../hooks/useLiveStatus'
import { StatusMark } from '../ui/StatusMark'
import { usePalette } from '../ui/palette'

interface LiveStatusMarkProps {
  docId: string
  status: ParseStatus
  errorCode?: string | null
  onTerminal?: (status: ParseStatus) => void
  withLabel?: boolean
}

/**
 * Polls the status every 1.2s while non-terminal (see useLiveStatus), and stops with a callback once a terminal state is reached.
 */
export function LiveStatusMark({
  docId,
  status: initialStatus,
  errorCode,
  onTerminal,
  withLabel = true,
}: LiveStatusMarkProps) {
  const [status, setStatus] = useState<ParseStatus>(initialStatus)
  const onTerminalRef = useRef(onTerminal)
  onTerminalRef.current = onTerminal

  useEffect(() => {
    setStatus(initialStatus)
  }, [initialStatus])

  useLiveStatus(docId, status, setStatus, (next) => {
    setStatus(next)
    onTerminalRef.current?.(next)
  })

  return <StatusMark status={status} errorCode={errorCode} withLabel={withLabel} />
}

/** For callers that only need the color (detail screen sections, dividers, etc.). */
export function useStatusColor(status: ParseStatus): string {
  const p = usePalette()
  if (status === 'failed') return p.danger
  if (status === 'partial') return p.warn
  if (status === 'completed') return p.faint
  return p.muted
}

/** Detail screen top back button: icon + 8dp touch area, placed by the page itself. */
export function useBack(): () => void {
  const router = useRouter()
  return () => {
    if (router.canGoBack()) router.back()
    else router.replace('/documents')
  }
}
