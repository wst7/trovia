import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import type { ParseStatus } from '@xunji/shared'

import { useLiveStatus } from '../hooks/useLiveStatus'
import { StatusMark } from '../ui/StatusMark'
import { usePalette } from '../ui/palette'

interface LiveStatusMarkProps {
  docId: string
  status: ParseStatus
  onTerminal?: (status: ParseStatus) => void
  withLabel?: boolean
}

/**
 * 非终态每 1.5s 查询一次状态，到达终态后停止并回调。
 */
export function LiveStatusMark({
  docId,
  status: initialStatus,
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

  return <StatusMark status={status} withLabel={withLabel} />
}

/** 供只需要颜色时使用（详情页的分段、分割线等）。 */
export function useStatusColor(status: ParseStatus): string {
  const p = usePalette()
  if (status === 'failed') return p.danger
  if (status === 'partial') return p.warn
  if (status === 'completed') return p.faint
  return p.muted
}

/** 详情页顶部返回：图标 + 8dp 触区，交给页面自己放。 */
export function useBack(): () => void {
  const router = useRouter()
  return () => {
    if (router.canGoBack()) router.back()
    else router.replace('/documents')
  }
}
