/**
 * Local directory adapter — three uses:
 *
 *   1. tests: run the sync engine against a real filesystem instead of only talking to itself in memory;
 *   2. LAN/desktop: point at a mounted directory (such as the iCloud Drive mount point on macOS);
 *   3. iCloud (future): point at the app's ubiquity container path and let the system handle the transfer.
 *
 * What is passed in is an existing, readable and writable absolute path. On the RN side expo-file-system
 * only has to supply a directory path to reuse the same interface.
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
    // Simple escape guard: no .. is allowed to climb out of the root directory.
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
