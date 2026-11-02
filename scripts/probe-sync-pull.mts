/**
 * 用真实的 WebDAV（本地调试服务）和一份空库跑一轮，回答一个问题：
 * 「换新手机/重装之后，同步能不能把远端的东西拉回来」。
 */
import { syncOnce, WebDavTarget } from '../packages/sync/src/index.ts'
import type { LocalStore, SyncRecord } from '../packages/sync/src/index.ts'

class EmptyStore implements LocalStore {
  applied: SyncRecord[] = []
  marked: SyncRecord[] = []
  async listDirty() {
    return []
  }
  async baseRevs() {
    return new Map<string, number>()
  }
  async applyRemote(records: SyncRecord[]) {
    this.applied.push(...records)
  }
  async markSynced(records: SyncRecord[]) {
    this.marked.push(...records)
  }
}

const target = new WebDavTarget({
  baseUrl: 'http://127.0.0.1:8090/dav/trovia',
  username: 'u',
  password: 'p',
})
const store = new EmptyStore()
const report = await syncOnce({ target, store, deviceId: 'probe', now: () => new Date().toISOString() })
console.log('report', JSON.stringify(report))
console.log('applied', store.applied.length)
