/**
 * WebDAV adapter 的验证：起一个最小 WebDAV 服务（MKCOL / PROPFIND / PUT /
 * GET / DELETE），让同步引擎真的通过 HTTP 跑一遍。
 *
 * 目的不是模拟坚果云的全部行为，而是验证最脆的部分——PROPFIND 的 XML
 * 怎么解析、路径怎么拼、空目录怎么处理。这些错了，连上真云盘也跑不通。
 *
 * 跑法：npx tsx packages/sync/test/webdav.test.mts
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { syncOnce } from '../src/index.ts'
import { WebDavTarget } from '../src/webdav.ts'
import type { LocalStore, SyncRecord } from '../src/index.ts'

/** 最小 WebDAV：把文件放在内存里，够引擎用。 */
function makeServer() {
  const files = new Map<string, string>()
  const dirs = new Set<string>([''])
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = decodeURIComponent((req.url ?? '/').replace(/^\/dav\/?/, ''))
    const auth = req.headers.authorization
    if (auth !== `Basic ${Buffer.from('u:p').toString('base64')}`) {
      res.writeHead(401).end()
      return
    }

    if (req.method === 'MKCOL') {
      dirs.add(path)
      res.writeHead(dirs.has(path) ? 201 : 405).end()
      return
    }

    if (req.method === 'PROPFIND') {
      if (!dirs.has(path) && ![...files.keys()].some((f) => f.startsWith(`${path}/`))) {
        res.writeHead(404).end()
        return
      }
      const children = [...files.keys()].filter((f) => f.startsWith(`${path}/`) && !f.slice(path.length + 1).includes('/'))
      const blocks = children
        .map((f) => {
          const body = files.get(f) ?? ''
          return `<d:response><d:href>/dav/${f}</d:href><d:propstat><d:prop><d:getcontentlength>${body.length}</d:getcontentlength><d:getetag>"${body.length}"</d:getetag></d:prop></d:propstat></d:response>`
        })
        .join('')
      res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' })
      res.end(`<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${blocks}</d:multistatus>`)
      return
    }

    if (req.method === 'PUT') {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        files.set(path, body)
        res.writeHead(201).end()
      })
      return
    }

    if (req.method === 'GET') {
      if (!files.has(path)) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(files.get(path))
      return
    }

    if (req.method === 'DELETE') {
      files.delete(path)
      res.writeHead(204).end()
      return
    }

    res.writeHead(405).end()
  })
  return { server, files, dirs }
}

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
const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++clock)).toISOString()

async function run() {
  const { server, files } = makeServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const baseUrl = `http://127.0.0.1:${address.port}/dav/xunji`

  try {
    const target = new WebDavTarget({ baseUrl, username: 'u', password: 'p' })
    const phone = new MemoryStore()
    const laptop = new MemoryStore()

    await target.ensureDir('docs')

    // 空目录：list 必须返回空数组，而不是抛错
    assert.deepEqual(await target.list('docs/'), [], '空目录应返回空列表')
    console.log('✓ 空目录 PROPFIND 返回空列表，不报错')

    phone.put({
      id: 'doc-w1',
      updated_at: '2026-01-01T00:00:01Z',
      deleted_at: null,
      payload: { title: '中文标题能不能过 XML', url: 'https://example.com/w1' },
    })
    let report = await syncOnce({ target, store: phone, deviceId: 'phone', now })
    assert.equal(report.pushed, 1)
    assert.equal(files.size, 1, '服务端应该收到一个文件')
    console.log(`✓ PUT 走通，服务端收到 ${files.size} 个文件`)

    // 另一台设备通过 PROPFIND + GET 拉回来，标题里的中文不能坏
    report = await syncOnce({ target, store: laptop, deviceId: 'laptop', now })
    assert.equal(report.pulled, 1)
    assert.equal(laptop.docs.get('doc-w1')?.payload.title, '中文标题能不能过 XML')
    console.log('✓ PROPFIND 解析出 href，GET 拿回中文标题')

    // 无改动时不该重复写
    const writesBefore = files.size
    report = await syncOnce({ target, store: laptop, deviceId: 'laptop', now })
    assert.equal(report.pushed, 0)
    assert.equal(files.size, writesBefore)
    console.log('✓ 二次同步不重复写')

    console.log('\n全部通过：WebDAV adapter 在真实 HTTP 上跑通')
  } finally {
    server.close()
  }
}

await run()
