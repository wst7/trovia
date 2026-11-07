/**
 * End-to-end tests for the WebDAV client.
 *
 * sync.test.mjs above only checks that the computed record is right, not that it can actually be written.
 * This file starts a minimal WebDAV server (PROPFIND / MKCOL / PUT / GET) and runs it with a real fetch:
 * only once this layer has been exercised can we claim the extension works as soon as it is installed.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { check, getRecord, putRecord, resolveUrl } from '../src/webdav.js'
import { buildRecord } from '../src/record.js'

const USER = 'trovia'
const PASSWORD = 'app-password'
const ROOT = '/dav'

const expectedAuth = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`

/** Minimal working WebDAV: enough for the extension to get through "create folder → write file → read it back". */
function startServer() {
  const files = new Map() // path → string
  const dirs = new Set()

  const server = createServer((req, res) => {
    if (req.headers.authorization !== expectedAuth) {
      res.writeHead(401).end()
      return
    }
    const url = new URL(req.url, 'http://localhost')
    const path = decodeURIComponent(url.pathname)
    if (!path.startsWith(ROOT)) {
      res.writeHead(404).end()
      return
    }
    const rel = path.slice(ROOT.length).replace(/^\/+|\/+$/g, '')

    if (req.method === 'PROPFIND') {
      if (rel && !dirs.has(rel)) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(207).end('<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"/>')
      return
    }

    if (req.method === 'MKCOL') {
      if (dirs.has(rel)) {
        res.writeHead(405).end()
        return
      }
      const parent = rel.split('/').slice(0, -1).join('/')
      // WebDAV rejects a missing parent, which is exactly what tests whether the extension creates folders in order
      if (parent && !dirs.has(parent)) {
        res.writeHead(409).end()
        return
      }
      dirs.add(rel)
      res.writeHead(201).end()
      return
    }

    if (req.method === 'PUT') {
      const parent = rel.split('/').slice(0, -1).join('/')
      if (parent && !dirs.has(parent)) {
        res.writeHead(409).end()
        return
      }
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        files.set(rel, Buffer.concat(chunks).toString('utf8'))
        res.writeHead(dirs.has(rel) ? 204 : 201).end()
      })
      return
    }

    if (req.method === 'GET') {
      if (!files.has(rel)) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(files.get(rel))
      return
    }

    res.writeHead(405).end()
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        config: { base: `http://127.0.0.1:${port}${ROOT}`, user: USER, password: PASSWORD, folder: 'trovia' },
        files,
        dirs,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

test('路径逐段编码：中文与空格都要转义', () => {
  // putRecord joins folder into the path; resolveUrl only encodes each segment it is handed
  const url = resolveUrl({ base: 'https://dav.example.com/dav' }, '我的收藏/docs/a b.json')
  assert.equal(url, 'https://dav.example.com/dav/%E6%88%91%E7%9A%84%E6%94%B6%E8%97%8F/docs/a%20b.json')
})

test('错误密码返回 unauthorized', async () => {
  const srv = await startServer()
  try {
    const result = await check({ ...srv.config, password: 'wrong' })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'unauthorized')
  } finally {
    await srv.close()
  }
})

test('地址不存在返回 not-found', async () => {
  const srv = await startServer()
  try {
    const result = await check({ ...srv.config, base: srv.config.base.replace(ROOT, '/nope') })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'not-found')
  } finally {
    await srv.close()
  }
})

test('空云盘上第一次保存：自动建目录再写入', async () => {
  const srv = await startServer()
  try {
    assert.equal((await check(srv.config)).ok, true)

    const record = buildRecord({ url: 'https://sspai.com/post/73145', title: '效率系统' })
    await putRecord(srv.config, record)

    // Both folder levels were created, and the file landed under docs/
    assert.ok(srv.dirs.has('trovia'))
    assert.ok(srv.dirs.has('trovia/docs'))
    const stored = JSON.parse(srv.files.get(`trovia/docs/${record.id}.json`))
    assert.equal(stored.payload.title, '效率系统')
    assert.equal(stored.payload.metadata.saved_by, 'extension')
  } finally {
    await srv.close()
  }
})

test('读回记录：存在时拿到 rev，不存在时是 null', async () => {
  const srv = await startServer()
  try {
    const record = buildRecord({ url: 'https://example.com/a', title: 'A' })
    assert.equal(await getRecord(srv.config, record.id), null)

    await putRecord(srv.config, record)
    const read = await getRecord(srv.config, record.id)
    assert.equal(read.id, record.id)
    assert.equal(read.rev, 1)
  } finally {
    await srv.close()
  }
})

test('第二次保存同一个链接：覆盖同一个文件，rev 递增', async () => {
  const srv = await startServer()
  try {
    const first = buildRecord({ url: 'https://example.com/post?utm_source=x', title: '旧标题' })
    await putRecord(srv.config, first)

    const existing = await getRecord(srv.config, first.id)
    const again = buildRecord({ url: 'https://example.com/post', title: '新标题', rev: Number(existing.rev) + 1 })
    await putRecord(srv.config, again)

    // After normalization it is the same id, so the cloud holds only one copy
    assert.equal(again.id, first.id)
    assert.equal(srv.files.size, 1)
    const stored = JSON.parse(srv.files.get(`trovia/docs/${again.id}.json`))
    assert.equal(stored.rev, 2)
    assert.equal(stored.payload.title, '新标题')
  } finally {
    await srv.close()
  }
})
