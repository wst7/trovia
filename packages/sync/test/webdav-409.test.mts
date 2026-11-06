/**
 * WebDAV 适配器的回归测试：不打网络，用假的 fetch 复刻真实服务器的怪癖。
 *
 * 三条都来自坚果云上的实际返回：
 *   1. 父目录不存在时，MKCOL 和 PROPFIND 都回 409（不是 404）；
 *   2. 集合自己也会出现在 207 里，href 末尾还可能没有斜杠；
 *   3. MKCOL 已存在的目录仍回 201。
 *
 * 跑法：npx tsx packages/sync/test/webdav-409.test.mts
 */
import assert from 'node:assert/strict'

import { WebDavTarget } from '../src/webdav.ts'

type Call = { method: string; url: string }

function fakeFetch(routes: (call: Call) => { status: number; body?: string }): { calls: Call[] } {
  const calls: Call[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, url })
    const { status, body } = routes({ method, url })
    return new Response(body ?? '', { status, headers: { 'Content-Type': 'text/xml' } })
  }) as typeof fetch
  return { calls }
}

const BASE = 'https://dav.example.com/dav/trovia'

// 1) 409 当成「还没有内容」，不要让整次同步失败
{
  const { calls } = fakeFetch(() => ({ status: 409 }))
  const target = new WebDavTarget({ baseUrl: BASE, username: 'u', password: 'p' })
  const entries = await target.list('docs/')
  assert.deepEqual(entries, [], '409 应该返回空列表')
  assert.equal(calls[0].method, 'PROPFIND')
}

// 2) 集合自己那条 href 必须跳过（坚果云的 href 不带尾斜杠）
{
  fakeFetch(() => ({
    status: 207,
    body: `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
      <d:response><d:href>/dav/trovia/docs</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
      <d:response><d:href>/dav/trovia/docs/a.json</d:href><d:propstat><d:prop><d:getcontentlength>12</d:getcontentlength><d:getetag>"x"</d:getetag></d:prop></d:propstat></d:response>
    </d:multistatus>`,
  }))
  const target = new WebDavTarget({ baseUrl: BASE, username: 'u', password: 'p' })
  const entries = await target.list('docs/')
  assert.equal(entries.length, 1, '只应剩下一份文件')
  assert.equal(entries[0].path, 'docs/a.json', '路径要相对根目录，读的时候才 GET 得对')
  assert.equal(entries[0].size, 12)
}

// 3) ensureDir 必须先建根目录，再建子目录；409 要报成「父目录不存在」
{
  const { calls } = fakeFetch((call) => {
    if (call.url.endsWith('/docs')) return { status: 409 }
    return { status: 201 }
  })
  const target = new WebDavTarget({ baseUrl: BASE, username: 'u', password: 'p' })
  await assert.rejects(() => target.ensureDir('docs'), /上级目录不存在（409）/)
  assert.ok(calls.some((c) => c.method === 'MKCOL' && c.url === `${BASE}/`), '应先对整个根目录发 MKCOL')
  assert.ok(calls.some((c) => c.method === 'MKCOL' && c.url === `${BASE}/docs`))
}

// 4) 已存在的目录（201/405 都算存在）不该报错
{
  fakeFetch((call) => ({ status: call.url.endsWith('/docs') ? 405 : 201 }))
  const target = new WebDavTarget({ baseUrl: BASE, username: 'u', password: 'p' })
  await target.ensureDir('docs')
  await target.ensureDir('docs')
}

console.log('WebDAV：409、集合自身条目、目录创建顺序全部通过 ✓')
