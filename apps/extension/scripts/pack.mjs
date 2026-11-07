/**
 * Build a zip you can drag straight into Chrome.
 *
 * Only what the runtime needs goes into the package: manifest, scripts, icons, pages.
 * test/ and scripts/ stay out of the package — users install the extension, not the repo.
 *
 * Use the system zip: Chrome accepts a standard zip, and hand-rolling a tar.gz and renaming it does not work.
 */
import { execFile } from 'node:child_process'
import { mkdir, rm, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outFile = join(root, 'dist', 'trovia-extension.zip')

const INCLUDE = ['manifest.json', 'background.js', 'popup.html', 'popup.js', 'popup.css',
                 'options.html', 'options.js', 'options.css', 'src', 'icons']

await mkdir(join(root, 'dist'), { recursive: true })
await rm(outFile, { force: true })

try {
  await run('zip', ['-r', '-q', outFile, ...INCLUDE], { cwd: root })
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error('找不到 zip 命令：macOS / Linux 自带，Windows 请用 WSL 或手动压缩。')
    process.exit(1)
  }
  throw error
}

const size = (await stat(outFile)).size
console.log(`打包完成：${relative(root, outFile)}（${(size / 1024).toFixed(1)} KB）`)
