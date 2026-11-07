#!/usr/bin/env node
/**
 * Release notes are written by hand, in product language.
 *
 * The GitHub Release body comes from the matching `## <version>` section in
 * docs/CHANGELOG.md (see .github/workflows/android.yml). A missing section
 * silently falls back to generated commit titles, which are not what a user
 * wants to read, so the release flow refuses to start without one.
 *
 * Usage: node scripts/check-changelog.mjs 0.14.1
 */
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = (process.argv[2] ?? '').replace(/^v/, '').trim()

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`changelog: "${version}" is not a version (expected x.y.z)`)
  process.exit(2)
}

const source = await readFile(join(root, 'docs/CHANGELOG.md'), 'utf8')
const lines = source.split('\n')

const start = lines.findIndex((line) => line.trim() === `## ${version}`)
if (start === -1) {
  console.error(`changelog: docs/CHANGELOG.md has no "## ${version}" section`)
  process.exit(1)
}

const next = lines.findIndex((line, index) => index > start && /^## /.test(line))
const body = lines.slice(start + 1, next === -1 ? undefined : next)
const text = body.join('\n').trim()

if (!text) {
  console.error(`changelog: the "## ${version}" section is empty`)
  process.exit(1)
}

const bullets = body.filter((line) => line.trim().startsWith('- ')).length
console.log(`changelog: ok (${version}, ${bullets} entries, ${text.length} chars)`)
