/**
 * 本地目录 adapter —— 三种用途：
 *
 *   1. 测试：用真实文件系统跑同步引擎，而不是只在内存里自说自话；
 *   2. 局域网/桌面：指向一个挂载的目录（如 macOS 上的 iCloud Drive 挂载点）；
 *   3. iCloud（未来）：指向 App 的 ubiquity 容器路径，传输交给系统。
 *
 * 传入的是一个已存在、可读写的绝对路径。RN 侧由 expo-file-system
 * 提供一个目录路径即可复用同一套接口。
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SyncEntry, SyncTarget } from './index.ts'

export class LocalDirTarget implements SyncTarget {
  constructor(private readonly root: string) {
    if (!existsSync(root)) throw new Error(`目录不存在：${root}`)
  }

  private abs(path: string): string {
    // 简单越界防护：不允许 .. 逃出根目录。
    if (path.includes('..')) throw new Error(`非法路径：${path}`)
    return join(this.root, path)
  }

  async list(prefix: string): Promise<SyncEntry[]> {
    const dir = this.abs(prefix.replace(/\/+$/, ''))
    if (!existsSync(dir)) return []
    const names = await readdir(dir)
    const entries: SyncEntry[] = []
    for (const name of names) {
      const full = join(dir, name)
      const info = await stat(full)
      if (!info.isFile()) continue
      entries.push({ path: `${prefix.replace(/\/+$/, '')}/${name}`, size: info.size, etag: String(info.mtimeMs) })
    }
    return entries
  }

  async read(path: string): Promise<string | null> {
    const full = this.abs(path)
    if (!existsSync(full)) return null
    return readFile(full, 'utf8')
  }

  async write(path: string, body: string): Promise<void> {
    const full = this.abs(path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, body, 'utf8')
  }

  async remove(path: string): Promise<void> {
    await rm(this.abs(path), { force: true })
  }
}
