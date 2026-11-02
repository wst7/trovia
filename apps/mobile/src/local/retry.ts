/**
 * 哪些失败值得再试。
 *
 * 这个模块刻意不 import 数据库或 React Native：它要在 node 里被单测直接跑，
 * 也要被 repo（写库）和界面（决定是否显示重试入口）同时引用。
 */

export const RETRYABLE_CODES = ['FETCH_FAILED', 'INTERNAL_ERROR', 'PARSE_INCOMPLETE']

/**
 * 站点一侧的决定——登录墙、人机验证、只在 App 里给内容、正文靠脚本渲染——
 * 不会因为用户多点几次而改变，给它们摆重试按钮等于让人反复做一件注定失败的事。
 */
export function isRetryableError(code: string | null | undefined): boolean {
  if (!code) return true
  return RETRYABLE_CODES.includes(code)
}
