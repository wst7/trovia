/**
 * 错误码 → 当前语言的一句话。
 *
 * 不看 Error.message：那句话是抓取/解析层写下的中文，英文界面下会露馅。
 * 有码就按码说话，没码就用调用方给的那句兜底。
 */
import { t } from './index'

export function errorText(error: unknown, fallback: string): string {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : ''
  if (!code) return fallback
  const key = `error.${code}`
  const text = t(key)
  return text === key ? fallback : text
}
