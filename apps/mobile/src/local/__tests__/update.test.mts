/**
 * 更新检查的回归测试：版本比较、asset 选择、坏数据。
 * 不联网——网络那层只是 fetch 一层壳，逻辑都在纯函数里。
 *
 * 跑法：npx tsx apps/mobile/src/local/__tests__/update.test.mts
 */
import assert from 'node:assert/strict'

import { isNewer, parseRelease, parseVersion, pickAsset } from '../update.ts'

// 版本比较
assert.equal(parseVersion('v0.11.2').join('.'), '0.11.2')
assert.equal(parseVersion('1.2.3-beta.1').join('.'), '1.2.3')
assert.equal(isNewer('0.11.2', '0.11.1'), true)
assert.equal(isNewer('0.12.0', '0.11.9'), true)
assert.equal(isNewer('1.0.0', '0.99.99'), true)
assert.equal(isNewer('0.11.1', '0.11.1'), false, '同版本不算更新')
assert.equal(isNewer('0.11.0', '0.11.1'), false, '旧版本不算更新')
assert.equal(isNewer('0.11.10', '0.11.9'), true, '按数字比，不按字符串')

// 资产选择：只认 apk，优先 arm64
const assets = [
  { name: 'notes.txt', browser_download_url: 'https://x/n.txt', size: 10 },
  { name: 'trovia-0.12.0-x86_64.apk', browser_download_url: 'https://x/x86.apk', size: 100 },
  { name: 'trovia-0.12.0-arm64.apk', browser_download_url: 'https://x/arm.apk', size: 200 },
]
assert.equal(pickAsset(assets)?.name, 'trovia-0.12.0-arm64.apk')
assert.equal(pickAsset([assets[0]]) , null, '没有 apk 就返回 null')
assert.equal(pickAsset(undefined), null)

// Release 解析
const release = parseRelease({
  tag_name: 'v0.12.0',
  body: '## 更新\n- 修了同步 409',
  published_at: '2026-11-06T08:00:00Z',
  assets,
})
assert.equal(release?.version, '0.12.0')
assert.equal(release?.asset?.url, 'https://x/arm.apk')
assert.ok(release?.notes.includes('同步 409'))

assert.equal(parseRelease({ tag_name: 'v0.12.0', assets: [] }), null, '没有安装包时视为不可更新')
assert.equal(parseRelease({}), null)

console.log('检查更新：版本比较、资产选择、Release 解析全部通过 ✓')
