#!/usr/bin/env node
/**
 * Every comment in this repo is English. Only copy that ships to users is
 * translated, and that lives in the i18n dictionaries.
 *
 * Why a checker: a convention nobody can run is a convention that decays.
 * This scans source files for CJK text sitting in a comment and fails.
 *
 * Usage: node scripts/check-comments.mjs [path]
 *   path  limit the scan to a subdirectory (relative to the repo root)
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2] ? join(root, process.argv[2]) : root

const CODE = new Set(['.ts', '.tsx', '.js', '.mjs', '.mts', '.cjs', '.py', '.css', '.sh', '.yml', '.yaml'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.expo', 'android', 'ios', '.impeccable', 'build', 'coverage'])

/** Copy lives here; the rest of the repo is not allowed to hold Chinese in code. */
const I18N_DIRS = ['apps/mobile/src/i18n/', 'apps/extension/i18n/']

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

/** Lines whose comment part starts at the beginning. */
const LINE_COMMENT = /^\s*(\/\/|\/\*|\*|#|<!--)/
/** A trailing comment after code: `foo() // note`. Quote-blind, but good enough here. */
const TRAILING = /\S\s+\/\/\s*(.*)$/

function commentText(line, ext) {
  const trimmed = line.trim()
  if (LINE_COMMENT.test(line)) return trimmed
  if (ext === '.py' || ext === '.sh' || ext === '.yml' || ext === '.yaml') {
    const hash = trimmed.match(/(?:^|\s)#\s*(.*)$/)
    return hash ? hash[1] : null
  }
  const trailing = line.match(TRAILING)
  return trailing ? trailing[1] : null
}

function isI18n(rel) {
  return I18N_DIRS.some((dir) => rel.startsWith(dir))
}

async function walk(dir) {
  const out = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else if (CODE.has(entry.name.slice(entry.name.lastIndexOf('.')))) out.push(full)
  }
  return out
}

// A file argument has to be scanned as a file. Calling readdir() on a file
// throws ENOTDIR, and swallowing that error made every per-file check pass.
async function collect(target) {
  const info = await stat(target).catch(() => null)
  if (!info) return []
  if (info.isFile()) return [target]
  return walk(target)
}

const findings = []
for (const file of await collect(target)) {
  const rel = relative(root, file).split(sep).join('/')
  if (isI18n(rel)) continue
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch {
    continue
  }
  const ext = rel.slice(rel.lastIndexOf('.'))
  text.split('\n').forEach((line, index) => {
    const comment = commentText(line, ext)
    if (comment && CJK.test(comment)) {
      findings.push({ rel, line: index + 1, text: line.trim().slice(0, 120) })
    }
  })
}

if (findings.length === 0) {
  console.log('comments: ok (no CJK in code comments)')
  process.exit(0)
}

console.error(`comments: ${findings.length} line(s) still carry Chinese`)
const byFile = new Map()
for (const f of findings) byFile.set(f.rel, (byFile.get(f.rel) ?? 0) + 1)
for (const [file, count] of [...byFile].sort((a, b) => b[1] - a[1])) {
  console.error(`  ${String(count).padStart(4)}  ${file}`)
}
process.exit(1)
