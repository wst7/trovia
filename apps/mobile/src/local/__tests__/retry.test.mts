/**
 * Deciding whether a given failure is worth retrying.
 *
 * Decisions made on the site's side (login wall, CAPTCHA, content only inside the App, body rendered by script)
 * don't change just because the user taps a few more times, so those error codes should not offer a retry entry point.
 *
 * How to run: npx tsx apps/mobile/src/local/__tests__/retry.test.mts
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
