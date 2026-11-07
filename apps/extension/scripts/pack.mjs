/**
 * 打一个可以直接拖进 Chrome 的 zip。
 *
 * 打进包里的只有运行时需要的东西：manifest、脚本、图标、页面。
 * test/ 与 scripts/ 不进包——用户装的是插件，不是仓库。
 *
 * 用系统自带的 zip：Chrome 认标准 zip，自己拼一个 tar.gz 改后缀是不行的。
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
