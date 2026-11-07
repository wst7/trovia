/**
 * 「云端超过 500 条就永远同步不到尾部」的回归测试。
 *
 * 老逻辑：entries = list().slice(0, limit)。PROPFIND 顺序是稳定的，
 * 所以第 501 条之后每一轮都被截掉，永远轮不到。
 *
 * 新逻辑：扫全部条目；带 etag 且与基准一致、本地也没改过的直接跳过，
 * limit 只限制「这一轮最多读几个文件」。
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
// 前 500 条已经在基准里（etag 一致、本地没改过）；后 100 条才是这一轮该读的。
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

// 第二轮：上一轮读完的 100 条已进基准，这一轮不该再读它们。
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

// 第三轮：改掉一个远端文件，只该读这一个。
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

console.log(`同步大库：${TOTAL} 条云端文件，一轮读 ${LIMIT} 个，未变的条目不再请求 —— 全部通过`)
