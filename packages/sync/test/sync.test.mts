/**
 * 同步引擎的行为测试：两台设备 + 一个共享「云盘」，验证
 *   1. 新建能传过去
 *   2. 只有一边改 → 另一边跟上
 *   3. 两端都改过 → 新的占主页，旧的留「冲突副本」，谁的内容都不丢
 *   4. 删除（墓碑）能传播，且不会被另一台设备复活
 *   5. 重复同步收敛，不产生副本风暴
 *
 * 跑法：npx tsx packages/sync/test/sync.test.mts
 */
import assert from 'node:assert/strict'
import { syncOnce } from '../src/index.ts'
import type { LocalStore, SyncRecord, SyncTarget } from '../src/index.ts'

/** 内存里的云盘：路径 → 内容。 */
class MemoryTarget implements SyncTarget {
  files = new Map<string, string>()
  writes = 0
  async list(prefix: string) {
    return [...this.files.keys()]
      .filter((path) => path.startsWith(prefix))
      .map((path) => ({ path, size: this.files.get(path)?.length ?? 0 }))
  }
  async read(path: string) {
    return this.files.get(path) ?? null
  }
  async write(path: string, body: string) {
    this.writes += 1
    this.files.set(path, body)
  }
  async remove(path: string) {
    this.files.delete(path)
  }
}

/** 内存里的本地库：docs + dirty + 基准 rev（模拟 documents.synced_rev 列）。 */
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
      // 只有推到云端的确实是当前版本时才清 dirty，避免把同步期间的新改动丢掉。
      if (this.docs.get(record.id)?.rev === record.rev) this.dirty.delete(record.id)
    }
  }
}

let clock = 0
const now = () => {
  clock += 1
  return new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString()
}

function doc(id: string, title: string, at: string): Omit<SyncRecord, 'rev'> {
  return { id, updated_at: at, deleted_at: null, payload: { title, url: `https://example.com/${id}` } }
}

async function run() {
  const cloud = new MemoryTarget()
  const phone = new MemoryStore()
  const laptop = new MemoryStore()
  const pullAll = async (store: MemoryStore, deviceId: string) =>
    syncOnce({ target: cloud, store, deviceId, now })

  // 1. 手机保存一条 → 同步 → 电脑拉到
  phone.put(doc('doc-1', '睡眠不足与焦虑', '2026-01-01T00:00:01Z'))
  let report = await pullAll(phone, 'device-phone')
  assert.equal(report.pushed, 1, '手机应该推上去一条')

  report = await pullAll(laptop, 'device-laptop')
  assert.equal(report.pulled, 1, '电脑应该拉到一条')
  assert.equal(laptop.docs.get('doc-1')?.payload.title, '睡眠不足与焦虑')
  console.log('✓ 新建能双向同步')

  // 2. 只有手机改（没有别人动过）→ 电脑跟上，不产生副本
  phone.put({ ...doc('doc-1', '睡眠不足与焦虑（手机改）', '2026-01-01T00:00:05Z'), rev: 2 })
  await pullAll(phone, 'device-phone')
  report = await pullAll(laptop, 'device-laptop')
  assert.equal(report.conflicts, 0, '单边修改不该产生冲突副本')
  assert.equal(laptop.docs.get('doc-1')?.payload.title, '睡眠不足与焦虑（手机改）')
  console.log('✓ 单边修改只跟随，不产生副本')

  // 3. 两端都改过同一篇 → 新的占主页，旧的留副本
  phone.put({ ...doc('doc-1', '手机又改了一次', '2026-01-01T00:00:30Z'), rev: 3 })
  laptop.dirty.add('doc-1') // 电脑此前改过（rev 2 已同步，但现在基准仍是 2）
  laptop.docs.set('doc-1', { ...doc('doc-1', '电脑上的说法', '2026-01-01T00:00:31Z'), rev: 3 })
  await pullAll(laptop, 'device-laptop') // 电脑先推
  report = await pullAll(phone, 'device-phone') // 手机随后看到电脑的版本
  assert.equal(report.conflicts, 1, '两端都改应该留一份冲突副本')
  const titles = [...phone.docs.values()].map((r) => String(r.payload.title))
  assert.ok(titles.includes('电脑上的说法'), '较新的版本应该占据主位')
  assert.ok(titles.some((t) => t.includes('冲突副本')), '另一份应该以冲突副本保留')
  console.log('✓ 两端都改：新的占主位，另一份留冲突副本')

  // 4. 删除（墓碑）传播，且不会被另一台设备复活
  const victim = 'doc-3'
  phone.put(doc(victim, '要删掉的一条', '2026-01-01T00:00:40Z'))
  await pullAll(phone, 'device-phone')
  await pullAll(laptop, 'device-laptop')
  assert.equal(laptop.docs.get(victim)?.deleted_at, null)

  laptop.put({ ...doc(victim, '要删掉的一条', '2026-01-01T00:00:50Z'), deleted_at: '2026-01-01T00:00:50Z', rev: 2 })
  await pullAll(laptop, 'device-laptop')
  report = await pullAll(phone, 'device-phone')
  assert.equal(report.deleted, 1, '墓碑应该被拉下来')
  assert.equal(phone.docs.get(victim)?.deleted_at, '2026-01-01T00:00:50Z', '手机上应该也是墓碑')

  report = await pullAll(phone, 'device-phone')
  assert.equal(report.pushed, 0, '墓碑不该被反向覆盖')
  assert.equal(JSON.parse(cloud.files.get(`docs/${victim}.json`) ?? '{}').deleted_at, '2026-01-01T00:00:50Z')
  console.log('✓ 删除靠墓碑传播，不会被另一台设备复活')

  // 5. 重复同步收敛
  const before = phone.docs.size
  for (const store of [phone, laptop, phone, laptop]) {
    await pullAll(store, store === phone ? 'device-phone' : 'device-laptop')
  }
  assert.equal(phone.docs.size, before, '空跑同步不应再产生副本')
  console.log('✓ 重复同步收敛，不产生副本风暴')

  // 5b. 没改动时不能把远端整库重拉一遍。
  // 只有 listDirty() 时，引擎分不清「本机没有」和「本机有但没改」，
  // 曾因此每轮都重新拉取所有记录（真机上 312 条全被算成「取回」）。
  const idle = await pullAll(phone, 'device-phone')
  assert.equal(idle.pulled, 0, '没有改动时不该有任何取回')
  assert.equal(idle.pushed, 0, '没有改动时不该有任何上传')
  console.log('✓ 无改动时同步是空转（pulled 0 / pushed 0）')

  console.log(`\n全部通过：云端 ${cloud.files.size} 个文件，累计 ${cloud.writes} 次写入`)
}

await run()
