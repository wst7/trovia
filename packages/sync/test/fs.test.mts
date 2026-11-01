/**
 * 真实文件系统的同步测试：把「云盘」换成一个目录（LocalDirTarget），
 * 验证引擎不是只在内存里自洽——文件真的写到盘上，另一台设备真的读回来。
 *
 * 这个目录就是未来 iCloud Drive 容器路径的替身；换成 WebDAV 只是换 adapter。
 *
 * 跑法：npx tsx packages/sync/test/fs.test.mts
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
  const root = await mkdtemp(join(SCRATCH, 'xunji-sync-'))
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

    // 文件真的落盘了，名字就是 doc id
    const docsDir = join(root, 'docs')
    const files = await readdir(docsDir)
    assert.deepEqual(files, ['doc-a.json'], '应该在 docs/ 下生成一个文件')
    const onDisk = JSON.parse(await readFile(join(docsDir, 'doc-a.json'), 'utf8'))
    assert.equal(onDisk.payload.title, '为什么睡前刷手机更焦虑')
    console.log(`✓ 写进真实目录：docs/${files[0]}（${JSON.stringify(onDisk).length} 字节）`)

    // 另一台设备从同一个目录拉
    report = await syncOnce({ target: cloud, store: laptop, deviceId: 'laptop', now })
    assert.equal(report.pulled, 1)
    assert.equal(laptop.docs.get('doc-a')?.payload.url, 'https://example.com/a')
    console.log('✓ 第二台设备从同一目录读回，正文完整')

    // 电脑上改，手机同步后跟上
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

    // 空跑一次：不写任何东西
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
