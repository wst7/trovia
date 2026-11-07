/** Unified API error: carries the backend error code and the Chinese message. */
export class ApiError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    Object.setPrototypeOf(this, ApiError.prototype)
  }
}

// Fallback copy: shown by error code when the server supplies no message.
export const FRIENDLY_MESSAGES: Record<string, string> = {
  INVALID_URL: '请输入有效的网页链接。',
  FETCH_TIMEOUT: '已保存链接，但暂时无法读取网页。你可以稍后重试。',
  FETCH_ERROR: '已保存链接，但暂时无法读取网页。你可以稍后重试。',
  FETCH_BLOCKED: '页面需要登录或授权访问，暂时无法读取正文。',
  CONTENT_SCRIPT_ONLY: '页面正文由脚本动态渲染，本机只拿到公开的那部分；链接已保留，打开原文可看完整页面。',
  APP_ONLY_LINK: '这是飞书 App 内的消息链接，标题和链接已保存，打开原文即可回到飞书查看。',
  AI_PROVIDER_ERROR: '内容已保存，但智能索引暂时未完成。',
  EMBEDDING_ERROR: '内容已保存，但智能索引暂时未完成。',
  INDEX_WRITE_ERROR: '内容已保存，但智能索引暂时未完成。',
}
