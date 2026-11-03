/**
 * 状态与错误的说法。
 *
 * 状态码和错误码本身不翻译，翻译的是它们对应的那句话——码是逻辑，话是界面。
 */
import type { ParseStatus } from '@trovia/shared'
import { t } from './index'

/** 列表里显示的短状态。 */
export function statusLabel(status: ParseStatus, errorCode?: string | null): string {
  if (status === 'failed') {
    switch (errorCode) {
      case 'FETCH_BLOCKED':
        return t('status.failedBlocked')
      case 'APP_ONLY_LINK':
        return t('status.failedAppOnly')
      case 'CONTENT_SCRIPT_ONLY':
        return t('status.failedScriptOnly')
      case 'FETCH_FAILED':
      case 'FETCH_ERROR':
      case 'FETCH_TIMEOUT':
        return t('status.failedFetch')
      default:
        return t('status.failed')
    }
  }
  if (status === 'partial') return t('status.partialShort')
  return t(`status.${status}`)
}

/** 错误码对应的说明；没有对应文案就交给调用方的兜底句。 */
export function errorCodeText(code: string | null | undefined, fallback: string): string {
  if (!code) return fallback
  const key = `error.${code}`
  const text = t(key)
  return text === key ? fallback : text
}
