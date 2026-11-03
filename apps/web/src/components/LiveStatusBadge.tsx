import { useEffect, useRef, useState } from 'react'
import type { ParseStatus } from '@trovia/shared'
import { isTerminalStatus } from '@trovia/shared'
import { api } from '../api/client'
import { StatusBadge } from './StatusBadge'

const POLL_INTERVAL_MS = 1500

/**
 * 状态徽章 + 自动轮询：非终态时每 1.5s 查询 /documents/{id}/status，
 * 到达 completed/partial/failed 终态后停止并回调 onTerminal。
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
          // 轮询失败不打断页面，等下一轮
        })
    }, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [docId, status])

  return <StatusBadge status={status} />
}
