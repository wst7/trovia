/**
 * The version row: what it says and what a tap does.
 *
 * One channel only — a release is an APK download. Every row here is a state a
 * user has hit, including "said latest while nothing was updated" and "tapped
 * again while a download was already running".
 *
 * How to run: npx tsx src/local/__tests__/update-state.test.mts
 */
import assert from 'node:assert/strict'

import { resolveUpdateAction, resolveUpdateView, type UpdateSnapshot } from '../update-state.ts'

const base: UpdateSnapshot = { phase: 'idle', update: null, progress: null }

assert.deepEqual(resolveUpdateView(base), { kind: 'latest' })
assert.equal(resolveUpdateAction(resolveUpdateView(base)), 'check')

// Work in progress beats everything else.
assert.deepEqual(resolveUpdateView({ ...base, phase: 'checking' }), { kind: 'checking' })
assert.equal(resolveUpdateAction({ kind: 'checking' }), 'none')

assert.deepEqual(
  resolveUpdateView({ ...base, phase: 'downloading', progress: { written: 0, ratio: -1 } }),
  { kind: 'downloading', written: 0, ratio: -1 },
)
assert.deepEqual(
  resolveUpdateView({ ...base, phase: 'downloading', progress: { written: 2048, ratio: 0.5 } }),
  { kind: 'downloading', written: 2048, ratio: 0.5 },
)
assert.equal(resolveUpdateAction({ kind: 'downloading', written: 0, ratio: -1 }), 'none')
assert.equal(resolveUpdateAction({ kind: 'installing' }), 'none')
assert.equal(resolveUpdateAction({ kind: 'error' }), 'check')

// A newer release: the row offers the package.
assert.deepEqual(
  resolveUpdateView({ ...base, update: { version: '0.15.0', sizeBytes: 50_000_000 } }),
  { kind: 'available', version: '0.15.0', sizeBytes: 50_000_000 },
)
assert.equal(
  resolveUpdateAction({ kind: 'available', version: '0.15.0', sizeBytes: 1 }),
  'download',
)

// An unknown size must not turn into an unknown download.
assert.deepEqual(resolveUpdateView({ ...base, phase: 'error' }), { kind: 'error' })

console.log('更新行：7 组状态判定通过（单一通道，只装包）')
