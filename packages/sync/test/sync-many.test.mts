/**
 * Regression test for “once the cloud holds more than 500 entries, the tail can never be synced”.
 *
 * Old logic: entries = list().slice(0, limit). PROPFIND order is stable,
 * so everything after entry 501 was truncated every round and never got its turn.
 *
 * New logic: scan every entry; skip outright the ones that carry an etag matching the baseline and were not changed locally,
 * so limit only caps “how many files are read this round”.
 */
import assert from 'node:assert/strict'
import { syncOnce } from '../src/index.ts'
import type { LocalStore, SyncRecord, SyncTarget } from '../src/index.ts'

class MemoryTarget implements SyncTarget {
  files = new Map<string, string>()
  etags = new Map<string, string>()
  reads: string[] = []
  async list(prefix: string) {
    return [...this.files.keys()]
      .filter((path) => path.startsWith(prefix))
      .sort()
      .map((path) => ({ path, size: this.files.get(path)?.length ?? 0, etag: this.etags.get(path) }))
  }
  async read(path: string) {
    this.reads.push(path)
    return this.files.get(path) ?? null
  }
  async write(path: string, body: string) {
    this.files.set(path, body)
    this.etags.set(path, `e${this.files.size}`)
  }
  async remove(path: string) {
    this.files.delete(path)
  }
}

class MemoryStore implements LocalStore {
  revs = new Map<string, number>()
  etags = new Map<string, string>()
  applied: SyncRecord[] = []
  async listDirty() {
    return []
  }
  async baseRevs() {
    return new Map(this.revs)
  }
  async baseEtags() {
    return new Map(this.etags)
  }
  async applyRemote(records: SyncRecord[]) {
    for (const record of records) {
      this.applied.push(record)
      this.revs.set(record.id, record.rev)
    }
  }
  async markSynced(records: SyncRecord[], _at: string, etags?: Map<string, string>) {
    for (const record of records) this.revs.set(record.id, record.rev)
    for (const [id, etag] of etags ?? []) if (this.revs.has(id)) this.etags.set(id, etag)
  }
}

function makeRecord(id: string, title: string): SyncRecord {
  return {
    id,
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    rev: 1,
    payload: { title, url: `https://example.com/${id}` },
  }
}

const TOTAL = 600
const LIMIT = 100

const target = new MemoryTarget()
for (let i = 0; i < TOTAL; i += 1) {
  const id = `doc${String(i).padStart(3, '0')}`
  const path = `docs/${id}.json`
  target.files.set(path, JSON.stringify(makeRecord(id, `第 ${i} 篇`)))
  target.etags.set(path, `etag-${i}`)
}

const store = new MemoryStore()
// The first 500 are already in the baseline (etag matches, not changed locally); the last 100 are what this round should read.
for (let i = 0; i < 500; i += 1) {
  const id = `doc${String(i).padStart(3, '0')}`
  store.revs.set(id, 1)
  store.etags.set(id, `etag-${i}`)
}

const first = await syncOnce({
  target,
  store,
  deviceId: 'test',
  now: () => '2026-01-02T00:00:00.000Z',
  limit: LIMIT,
})

assert.equal(target.reads.length, LIMIT, `一轮最多读 ${LIMIT} 个文件，实际 ${target.reads.length}`)
assert.ok(
  store.applied.every((record) => Number(record.id.slice(3)) >= 500),
  '这一轮只该拉回没同步过的那 100 条',
)
assert.equal(first.pulled, LIMIT, '取回条数应等于本轮读取数')
assert.equal(first.remoteFiles, TOTAL, '报告的云端文件数必须是全量，不是被截断后的数量')

// Second round: the 100 read last round are already in the baseline, so they must not be read again this round.
target.reads = []
store.applied = []
const second = await syncOnce({
  target,
  store,
  deviceId: 'test',
  now: () => '2026-01-02T00:10:00.000Z',
  limit: LIMIT,
})
assert.equal(second.pulled, 0, '第二轮没有新内容，不该再拉')
assert.equal(target.reads.length, 0, 'etag 一致的条目不该再发 GET')

// Third round: change one remote file, and only that one should be read.
const changed = 'docs/doc042.json'
target.files.set(changed, JSON.stringify({ ...makeRecord('doc042', '改过的标题'), rev: 2 }))
target.etags.set(changed, 'etag-changed')
target.reads = []
const third = await syncOnce({
  target,
  store,
  deviceId: 'test',
  now: () => '2026-01-02T00:20:00.000Z',
  limit: LIMIT,
})
assert.deepEqual(target.reads, [changed], `只该重读被改的那一个，实际 ${target.reads.join(', ')}`)
assert.equal(third.pulled, 1, '改过的那条应该被拉回来')

/*
 * Another real failure: 7 copies in the cloud, 6 locally, yet sync reported “nothing to sync”.
 * The cause was the etag still being recorded while the baseline rev was lost (the store had been cleared, or that row physically deleted) —
 * so skipping the read on a matching etag alone meant that copy could never be pulled back.
 */
{
  const t2 = new MemoryTarget()
  t2.files.set('docs/only.json', JSON.stringify(makeRecord('only', '只存在本地记录里的那条')))
  t2.etags.set('docs/only.json', 'etag-only')
  const s2 = new MemoryStore()
  s2.etags.set('only', 'etag-only') // it has an etag but no rev — exactly the lost-baseline state
  s2.revs.set('keep', 1)

  const report = await syncOnce({ target: t2, store: s2, deviceId: 'test', now: () => '2026-01-03T00:00:00.000Z' })
  assert.equal(t2.reads.length, 1, '没有基准 rev 时必须照读，不能因为 etag 一样就跳过')
  assert.equal(report.pulled, 1, '这一条应该被拉回来')
}

console.log(`同步大库：${TOTAL} 条云端文件，一轮读 ${LIMIT} 个，未变的条目不再请求 —— 全部通过`)
