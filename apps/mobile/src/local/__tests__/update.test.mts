/**
 * Regression tests for the update check: version comparison, asset selection, bad data.
 * No network — the network layer is only a thin fetch wrapper; the logic lives in pure functions.
 *
 * How to run: npx tsx apps/mobile/src/local/__tests__/update.test.mts
 */
import assert from 'node:assert/strict'

// Version helpers live in their own module: update.ts imports AsyncStorage,
// which drags react-native in and cannot run under node.
import { isNewer, parseRelease, parseVersion, pickAsset } from '../version.ts'

// Version comparison
assert.equal(parseVersion('v0.11.2').join('.'), '0.11.2')
assert.equal(parseVersion('1.2.3-beta.1').join('.'), '1.2.3')
assert.equal(isNewer('0.11.2', '0.11.1'), true)
assert.equal(isNewer('0.12.0', '0.11.9'), true)
assert.equal(isNewer('1.0.0', '0.99.99'), true)
assert.equal(isNewer('0.11.1', '0.11.1'), false, '同版本不算更新')
assert.equal(isNewer('0.11.0', '0.11.1'), false, '旧版本不算更新')
assert.equal(isNewer('0.11.10', '0.11.9'), true, '按数字比，不按字符串')

// Asset selection: only apks count, arm64 preferred
const assets = [
  { name: 'notes.txt', browser_download_url: 'https://x/n.txt', size: 10 },
  { name: 'trovia-0.12.0-x86_64.apk', browser_download_url: 'https://x/x86.apk', size: 100 },
  { name: 'trovia-0.12.0-arm64.apk', browser_download_url: 'https://x/arm.apk', size: 200 },
]
assert.equal(pickAsset(assets)?.name, 'trovia-0.12.0-arm64.apk')
assert.equal(pickAsset([assets[0]]) , null, '没有 apk 就返回 null')
assert.equal(pickAsset(undefined), null)

// Release parsing
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

// The hot-update/version merge is gone: the two channels no longer share a
// version number (see update-state.test.mts for the row's decision table).

console.log('检查更新：版本比较、热更新合并、资产选择、Release 解析全部通过 ✓')
