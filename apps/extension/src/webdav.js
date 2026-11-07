/**
 * WebDAV client: only the four things the extension needs — probe, create directory, write a file, read a file.
 *
 * Authentication is Basic; the credentials live in chrome.storage.local and are read only when the user clicks save.
 * Services like Jianguoyun require an “app password”, not the login password, and the settings page spells that out.
 */

function authHeader(config) {
  // btoa only takes latin1, so a Chinese password has to be converted to UTF-8 first.
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

/** Relative path → full URL, encoding segment by segment so Chinese directory names are not rejected. */
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

/** Probe: PROPFIND the directory; `.ok` coming back means both the credentials and the address are right. */
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

/** Create the directory; already existing (405) also counts as success. */
async function mkcol(config, path) {
  const response = await request(config, 'MKCOL', path)
  if (response.ok || response.status === 405) return
  throw new Error(`MKCOL ${path} → ${response.status}`)
}

/**
 * Write one record to docs/<id>.json.
 * Create the directory itself when it does not exist, so the user only has to fill in one WebDAV root address.
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
    // When the directory does not exist, create the two levels first and then write once more.
    if (!/→ 409|→ 404/.test(String(error?.message))) throw error
    await mkcol(config, config.folder)
    await mkcol(config, dir)
    return put()
  }
}

/** Read one record back, used to carry the rev over when “the same link is saved again”. */
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
