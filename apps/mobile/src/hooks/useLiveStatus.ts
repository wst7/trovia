import { useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import type { ParseStatus } from '@trovia/shared'
import { isTerminalStatus } from '@trovia/shared'

import { getStatus } from '../local/repo'

const POLL_INTERVAL_MS = 1200

/**
 * 本机解析没有服务端推送，只能读本地库看进度：
 * 仅在 App 前台且状态未终止时轮询；终态回调只触发一次。
 * 调用方负责把新状态写回自己的状态，hook 本身不持有文档。
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
          // 读库失败（例如迁移尚未完成）：继续静默轮询。
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
