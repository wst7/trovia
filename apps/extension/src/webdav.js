/**
 * WebDAV 客户端：只做插件需要的四件事——探路、建目录、写文件、读文件。
 *
 * 认证用 Basic，凭据存在 chrome.storage.local，只在用户点保存时读取。
 * 坚果云这类服务要求「应用密码」，不是登录密码，设置页里写清了。
 */

function authHeader(config) {
  // btoa 只吃 latin1，中文密码要先转 UTF-8。
  const bytes = new TextEncoder().encode(`${config.user}:${config.password}`)
  let binary = ''
  bytes.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  return `Basic ${btoa(binary)}`
}

function endOf(text) {
  return String(text ?? '').replace(/\/+$/, '')
}

/** 相对路径 → 完整 URL，逐段编码，避免中文目录名被拒。 */
export function resolveUrl(config, path = '') {
  const base = endOf(config.base)
  const segments = String(path)
    .split('/')
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
  return segments.length ? `${base}/${segments.join('/')}` : base
}

async function request(config, method, path, body) {
  const init = {
    method,
    headers: { Authorization: authHeader(config) },
  }
  if (body !== undefined) {
    init.body = body
    init.headers['Content-Type'] = 'application/json; charset=utf-8'
  }
  return fetch(resolveUrl(config, path), init)
}

/** 探路：PROPFIND 目录，返回.ok 表示凭据和地址都对。 */
export async function check(config) {
  const response = await fetch(resolveUrl(config), {
    method: 'PROPFIND',
    headers: { Authorization: authHeader(config), Depth: '0' },
  })
  if (response.status === 401) return { ok: false, reason: 'unauthorized' }
  if (response.status === 404) return { ok: false, reason: 'not-found' }
  if (!response.ok && response.status !== 207) return { ok: false, reason: `http-${response.status}` }
  return { ok: true }
}

/** 建目录，已存在（405）也算成功。 */
async function mkcol(config, path) {
  const response = await request(config, 'MKCOL', path)
  if (response.ok || response.status === 405) return
  throw new Error(`MKCOL ${path} → ${response.status}`)
}

/**
 * 写一条记录到 docs/<id>.json。
 * 目录不存在时自己建，用户只需要填一个 WebDAV 根地址。
 */
export async function putRecord(config, record) {
  const dir = [config.folder, 'docs'].filter(Boolean).join('/')
  const path = `${dir}/${record.id}.json`

  const put = () =>
    request(config, 'PUT', path, JSON.stringify(record)).then((response) => {
      if (!response.ok && response.status !== 201 && response.status !== 204) {
        throw new Error(`PUT ${path} → ${response.status}`)
      }
      return response
    })

  try {
    return await put()
  } catch (error) {
    // 目录不存在时先建两级，再写一次。
    if (!/→ 409|→ 404/.test(String(error?.message))) throw error
    await mkcol(config, config.folder)
    await mkcol(config, dir)
    return put()
  }
}

/** 读回一条记录，用于「同一个链接再存一次」时沿用 rev。 */
export async function getRecord(config, id) {
  const dir = [config.folder, 'docs'].filter(Boolean).join('/')
  const response = await request(config, 'GET', `${dir}/${id}.json`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GET → ${response.status}`)
  try {
    return await response.json()
  } catch {
    return null
  }
}
