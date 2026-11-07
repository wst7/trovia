/**
 * Regression tests for failure copy: the same "failed" must say different things for different reasons.
 *
 * How to run: npx tsx apps/mobile/src/local/__tests__/status.test.mts
 */
import assert from 'node:assert/strict'
import { statusText } from '../../../../../packages/shared/src/format.ts'

assert.equal(statusText('failed', 'FETCH_BLOCKED'), '站点拒绝读取')
assert.equal(statusText('failed', 'APP_ONLY_LINK'), '需在 App 内打开')
assert.equal(statusText('failed', 'CONTENT_SCRIPT_ONLY'), '正文需脚本渲染')
assert.equal(statusText('failed', 'FETCH_FAILED'), '没能连上站点')
assert.equal(statusText('failed', null), '暂时无法解析', '没有原因时退回通用文案')
assert.equal(statusText('partial', 'PARSE_INCOMPLETE'), '只读到部分内容')
assert.equal(statusText('completed'), '已完成整理')
assert.equal(statusText('fetching'), '读取网页中')
console.log('✓ 失败原因各说各话，未知原因退回通用文案')
