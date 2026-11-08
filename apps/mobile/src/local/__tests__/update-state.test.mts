/**
 * The version row: what it says and what a tap does.
 *
 * The table matters more than the code — every row here is a state a user has
 * reported at some point, including "says latest while running old JavaScript".
 *
 * How to run: npx tsx src/local/__tests__/update-state.test.mts
 */
import assert from 'node:assert/strict'

import { resolveUpdateAction, resolveUpdateView, type UpdateSnapshot } from '../update-state.ts'

const base: UpdateSnapshot = {
  phase: 'idle',
  otaPending: false,
  otaAvailable: false,
  nativeUpdate: null,
  progress: null,
}

// Nothing anywhere: latest, and a tap re-checks.
assert.deepEqual(resolveUpdateView(base), { kind: 'latest' })
assert.equal(resolveUpdateAction(resolveUpdateView(base)), 'check')

// Work in progress beats everything queued behind it.
assert.deepEqual(resolveUpdateView({ ...base, phase: 'checking' }), { kind: 'checking' })
assert.equal(resolveUpdateAction({ kind: 'checking' }), 'none')

assert.deepEqual(
  resolveUpdateView({ ...base, phase: 'downloading', progress: { written: 0, ratio: -1 } }),
  { kind: 'downloading', written: 0, ratio: -1 },
)
assert.deepEqual(
  resolveUpdateView({ ...base, phase: 'downloading', progress: { written: 1024, ratio: 0.5 } }),
  { kind: 'downloading', written: 1024, ratio: 0.5 },
)
assert.equal(resolveUpdateAction({ kind: 'downloading', written: 0, ratio: -1 }), 'none')
assert.equal(resolveUpdateAction({ kind: 'installing' }), 'none')
assert.equal(resolveUpdateAction({ kind: 'error' }), 'check')

// The regression this file exists for: a downloaded bundle is not applied yet,
// so it must win over both "new JS available" and "new APK available".
assert.deepEqual(
  resolveUpdateView({ ...base, otaPending: true, otaAvailable: true, nativeUpdate: { version: '0.15.0', sizeBytes: 1 } }),
  { kind: 'restart' },
)
assert.equal(resolveUpdateAction({ kind: 'restart' }), 'restart')

// JavaScript first: a small bundle does not need the installer.
assert.deepEqual(
  resolveUpdateView({ ...base, otaAvailable: true, nativeUpdate: { version: '0.15.0', sizeBytes: 1 } }),
  { kind: 'ota' },
)
assert.equal(resolveUpdateAction({ kind: 'ota' }), 'download-ota')

// Only native changes left: that is what the APK is for.
assert.deepEqual(
  resolveUpdateView({ ...base, nativeUpdate: { version: '0.15.0', sizeBytes: 50_000_000 } }),
  { kind: 'native', version: '0.15.0', sizeBytes: 50_000_000 },
)
assert.equal(resolveUpdateAction({ kind: 'native', version: '0.15.0', sizeBytes: 1 }), 'download-apk')

// A hot fix that never bumped the version: native says current, OTA has news.
assert.deepEqual(resolveUpdateView({ ...base, otaAvailable: true }), { kind: 'ota' })

console.log('更新行：8 组状态判定通过（JS 通道与安装包通道分开）')
