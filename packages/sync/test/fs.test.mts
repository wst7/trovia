/**
 * Sync test against a real filesystem: replace "the cloud drive" with a directory (LocalDirTarget),
 * to verify the engine is not merely self-consistent in memory — files really land on disk and another device really reads them back.
 *
 * This directory stands in for the future iCloud Drive container path; switching to WebDAV is just swapping the adapter.
 *
 * Usage: npx tsx packages/sync/test/fs.test.mts
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { syncOnce } from '../src/index.ts'
import { LocalDirTarget } from '../src/local-dir.ts'
import type { LocalStore, SyncRecord } from '../src/index.ts'

class MemoryStore implements LocalStore {
  docs = new Map<string, SyncRecord>()
  dirty = new Set<string>()
  base = new Map<string, number>()

  put(record: Omit<SyncRecord, 'rev'> & { rev?: number }) {
    const prev = this.docs.get(record.id)
    const next: SyncRecord = { ...record, rev: record.rev ?? (prev?.rev ?? 0) + 1 }
    this.docs.set(next.id, next)
    this.dirty.add(next.id)
  }
  async listDirty() {
    return [...this.dirty].map((id) => this.docs.get(id)).filter((r): r is SyncRecord => Boolean(r))
  }
  async baseRevs() {
    return new Map(this.base)
  }
  async applyRemote(records: SyncRecord[]) {
    for (const record of records) {
      this.docs.set(record.id, record)
      this.base.set(record.id, record.rev)
      this.dirty.delete(record.id)
    }
  }
  async markSynced(records: SyncRecord[]) {
    for (const record of records) {
      this.base.set(record.id, record.rev)
      if (this.docs.get(record.id)?.rev === record.rev) this.dirty.delete(record.id)
    }
  }
}

let clock = 0
const now = () => {
  clock += 1
  return new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString()
}

const SCRATCH = '/Users/wstreet7/.hermes/cache/scratch'

async function run() {
  const root = await mkdtemp(join(SCRATCH, 'trovia-sync-'))
  const cloud = new LocalDirTarget(root)
  const phone = new MemoryStore()
  const laptop = new MemoryStore()

  try {
    phone.put({
      id: 'doc-a',
      updated_at: '2026-01-01T00:00:01Z',
      deleted_at: null,
      payload: { title: '为什么睡前刷手机更焦虑', url: 'https://example.com/a', body: '正文'.repeat(50) },
    })
    let report = await syncOnce({ target: cloud, store: phone, deviceId: 'phone', now })
    assert.equal(report.pushed, 1)

    // The file really landed on disk, and its name is the doc id
    const docsDir = join(root, 'docs')
    const files = await readdir(docsDir)
    assert.deepEqual(files, ['doc-a.json'], '应该在 docs/ 下生成一个文件')
    const onDisk = JSON.parse(await readFile(join(docsDir, 'doc-a.json'), 'utf8'))
    assert.equal(onDisk.payload.title, '为什么睡前刷手机更焦虑')
    console.log(`✓ 写进真实目录：docs/${files[0]}（${JSON.stringify(onDisk).length} 字节）`)

    // The other device pulls from the same directory
    report = await syncOnce({ target: cloud, store: laptop, deviceId: 'laptop', now })
    assert.equal(report.pulled, 1)
    assert.equal(laptop.docs.get('doc-a')?.payload.url, 'https://example.com/a')
    console.log('✓ 第二台设备从同一目录读回，正文完整')

    // Changed on the computer, and the phone catches up after syncing
    laptop.put({
      id: 'doc-a',
      updated_at: '2026-01-01T00:00:20Z',
      deleted_at: null,
      payload: { title: '为什么睡前刷手机更焦虑（改过标题）', url: 'https://example.com/a' },
    })
    await syncOnce({ target: cloud, store: laptop, deviceId: 'laptop', now })
    await syncOnce({ target: cloud, store: phone, deviceId: 'phone', now })
    assert.equal(phone.docs.get('doc-a')?.payload.title, '为什么睡前刷手机更焦虑（改过标题）')
    console.log('✓ 改动经目录中转，另一台设备拿到新版本')

    // One empty run: nothing is written
    const before = (await readdir(docsDir)).length
    report = await syncOnce({ target: cloud, store: phone, deviceId: 'phone', now })
    assert.equal(report.pushed, 0)
    assert.equal((await readdir(docsDir)).length, before)
    console.log('✓ 无改动时不产生写操作')

    console.log(`\n全部通过：${root}`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

await run()
