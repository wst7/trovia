import type { ParseStatus } from '@trovia/shared'
import { STATUS_TEXT, statusTone } from '@trovia/shared'

/**
 * Status appears only when the user needs to pay attention:
 * completed is the default outcome and no longer adds visual noise to the list.
 */
export function StatusBadge({ status }: { status: ParseStatus }) {
  if (status === 'completed') return null
  return <span className={`badge badge--${statusTone(status)}`}>{STATUS_TEXT[status]}</span>
}
