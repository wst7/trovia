/**
 * 「这条失败值不值得再试」的判定。
 *
 * 站点一侧的决定（登录墙、人机验证、只在 App 里给内容、正文靠脚本渲染）
 * 不会因为用户多点几次而改变，所以这些错误码不该出现重试入口。
 *
 * 跑法：npx tsx apps/mobile/src/local/__tests__/retry.test.mts
 */
import assert from 'node:assert/strict'
import { isRetryableError } from '../retry.ts'

assert.equal(isRetryableError('FETCH_FAILED'), true, '断网类失败可以重试')
assert.equal(isRetryableError('INTERNAL_ERROR'), true, '内部错误可以重试')
assert.equal(isRetryableError('PARSE_INCOMPLETE'), true, '只抓到一部分可以重试')
assert.equal(isRetryableError(null), true, '没有错误码时按可重试处理')

assert.equal(isRetryableError('FETCH_BLOCKED'), false, '站点拒绝读取，重试没有意义')
assert.equal(isRetryableError('APP_ONLY_LINK'), false, '只在 App 里给内容，重试没有意义')
assert.equal(isRetryableError('CONTENT_SCRIPT_ONLY'), false, '正文靠脚本渲染，重试没有意义')

console.log('isRetryableError：7 项断言全部通过')
