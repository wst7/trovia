/**
 * Regression tests for the WebDAV adapter: no network, a fake fetch reproduces the real server's quirks.
 *
 * All three come from actual responses on Nutstore:
 *   1. when the parent directory is missing, both MKCOL and PROPFIND return 409 (not 404);
 *   2. the collection itself also appears in the 207, and its href may have no trailing slash;
 *   3. MKCOL on an existing directory still returns 201.
 *
 * How to run: npx tsx packages/sync/test/webdav-409.test.mts
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

// 1) Treat 409 as "nothing there yet"; it must not fail the whole sync
{
  const { calls } = fakeFetch(() => ({ status: 409 }))
  const target = new WebDavTarget({ baseUrl: BASE, username: 'u', password: 'p' })
  const entries = await target.list('docs/')
  assert.deepEqual(entries, [], '409 应该返回空列表')
  assert.equal(calls[0].method, 'PROPFIND')
}

// 2) The collection's own href must be skipped (Nutstore's href has no trailing slash)
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

// 3) ensureDir must create the root first, then the subdirectory; 409 must surface as "parent directory missing"
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

// 4) An existing directory (201 or 405 both count as existing) must not raise
{
  fakeFetch((call) => ({ status: call.url.endsWith('/docs') ? 405 : 201 }))
  const target = new WebDavTarget({ baseUrl: BASE, username: 'u', password: 'p' })
  await target.ensureDir('docs')
  await target.ensureDir('docs')
}

console.log('WebDAV：409、集合自身条目、目录创建顺序全部通过 ✓')
