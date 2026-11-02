/**
 * 本机调试用的最小 WebDAV 服务：把目录直接映射到磁盘，方便用 `ls` 看同步结果。
 *
 * 跑法：npx tsx apps/mobile/scripts/dev-webdav.mts [端口] [目录]
 * 模拟器里填 http://10.0.2.2:<端口>/dav/，用户名 u，密码 p。
 *
 * 只实现同步引擎会用到的五个方法（MKCOL / PROPFIND / PUT / GET / DELETE），
 * 不追求兼容全部 WebDAV 语义——真机上最终要连的是坚果云或群晖。
 */
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const port = Number(process.argv[2] ?? 8090)
const root = resolve(process.argv[3] ?? '/tmp/trovia-webdav')
const USER = 'u'
const PASS = 'p'
const PREFIX = '/dav/'

mkdirSync(root, { recursive: true })

function toDisk(path: string): string {
  const clean = path.replace(/^\/+/, '').split('/').filter((part) => part && part !== '..').join('/')
  return join(root, clean)
}

function authorized(req: IncomingMessage): boolean {
  const expected = `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`
  return req.headers.authorization === expected
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="trovia-dev"' }).end()
    return
  }

  const raw = decodeURIComponent(req.url ?? '/')
  const path = raw.startsWith(PREFIX) ? raw.slice(PREFIX.length) : raw.replace(/^\/+/, '')
  const disk = toDisk(path)

  if (req.method === 'MKCOL') {
    if (existsSync(disk)) {
      res.writeHead(405).end()
      return
    }
    mkdirSync(disk, { recursive: true })
    console.log('MKCOL', path)
    res.writeHead(201).end()
    return
  }

  if (req.method === 'PROPFIND') {
    if (!existsSync(disk) || !statSync(disk).isDirectory()) {
      res.writeHead(404).end()
      return
    }
    const entries = readdirSync(disk).filter((name) => statSync(join(disk, name)).isFile())
    const blocks = entries
      .map((name) => {
        const file = join(disk, name)
        const size = statSync(file).size
        return `<d:response><d:href>${PREFIX}${path ? `${path}/` : ''}${encodeURIComponent(name)}</d:href><d:propstat><d:prop><d:getcontentlength>${size}</d:getcontentlength><d:getetag>"${size}-${Math.floor(statSync(file).mtimeMs)}"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
      })
      .join('')
    res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' })
    res.end(`<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${blocks}</d:multistatus>`)
    return
  }

  if (req.method === 'PUT') {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      mkdirSync(dirname(disk), { recursive: true })
      writeFileSync(disk, body)
      console.log('PUT', path, `${body.length}B`)
      res.writeHead(201).end()
    })
    return
  }

  if (req.method === 'GET') {
    if (!existsSync(disk) || !statSync(disk).isFile()) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(readFileSync(disk))
    return
  }

  if (req.method === 'DELETE') {
    if (existsSync(disk)) rmSync(disk, { recursive: true, force: true })
    console.log('DELETE', path)
    res.writeHead(204).end()
    return
  }

  res.writeHead(405).end()
})

server.listen(port, '0.0.0.0', () => {
  console.log(`dev webdav: http://127.0.0.1:${port}${PREFIX} (模拟器用 10.0.2.2)`)
  console.log(`目录: ${root}  账号: ${USER} / ${PASS}`)
})
