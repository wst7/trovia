import type { ParseStatus } from '@trovia/shared'
import { STATUS_TEXT, statusTone } from '@trovia/shared'

/**
 * 状态只在需要用户注意时出现：
 * completed 是默认结果，不再占用列表的视觉噪音。
 */
export function StatusBadge({ status }: { status: ParseStatus }) {
  if (status === 'completed') return null
  return <span className={`badge badge--${statusTone(status)}`}>{STATUS_TEXT[status]}</span>
}
