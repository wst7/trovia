/**
 * Developer mode: record the very fact that something "couldn't be saved" so the user can forward it with one tap.
 *
 * Ordinary users shouldn't see this; the switch hides on the home screen title (long press), because when something breaks
 * the settings page may be exactly the page that crashed, so the one route that must always work is the home screen.
 */
import { readSetting, writeSetting } from './settings'

const FLAG = 'dev_mode'
const LOG_NAME = 'dev.log'
const MAX_CHARS = 60_000

type FileSystemModule = typeof import('expo-file-system/legacy')

function fs(): FileSystemModule | null {
  try {
    return require('expo-file-system/legacy') as FileSystemModule
  } catch {
    return null
  }
}

function logPath(module: FileSystemModule): string | null {
  const dir = module.documentDirectory
  return dir ? `${dir}${LOG_NAME}` : null
}

let enabled = false

export function isDevMode(): boolean {
  return enabled
}

export async function loadDevMode(): Promise<boolean> {
  try {
    enabled = (await readSetting(FLAG)) === '1'
  } catch {
    enabled = false
  }
  return enabled
}

export async function setDevMode(next: boolean): Promise<void> {
  enabled = next
  try {
    await writeSetting(FLAG, next ? '1' : '0')
  } catch {
    // Failing to persist doesn't affect logging for this session.
  }
}

/** Write one line in developer mode; when it is off, do nothing and spend no I/O. */
export async function devLog(scope: string, detail: unknown, error?: unknown): Promise<void> {
  if (!enabled) return
  const module = fs()
  if (!module) return
  const path = logPath(module)
  if (!path) return
  const message =
    error instanceof Error
      ? `${error.message} | ${(error.stack ?? '').replace(/\s+/g, ' ').slice(0, 1200)}`
      : error !== undefined
        ? String(error)
        : ''
  const line = `${new Date().toISOString()} ${scope} ${typeof detail === 'string' ? detail : JSON.stringify(detail)} ${message}`
  try {
    const info = await module.getInfoAsync(path)
    const previous = info.exists ? await module.readAsStringAsync(path) : ''
    await module.writeAsStringAsync(path, `${previous}${line.replace(/\s+/g, ' ')}\n`.slice(-MAX_CHARS))
  } catch {
    // A logging failure must not throw.
  }
}

/**
 * Operation log: who did what, when, how long it took, and how it turned out.
 *
 * Writes to the same file as devLog under a fixed `op:` prefix, so a read can pick only operations
 * or look at save-failure stacks together with them — when something breaks, these two halves are always read together.
 */
export async function opLog(
  action: string,
  detail: Record<string, unknown> = {},
  error?: unknown,
): Promise<void> {
  await devLog(`op.${action}`, detail, error)
}

export async function readDevLog(): Promise<string | null> {
  const module = fs()
  if (!module) return null
  const path = logPath(module)
  if (!path) return null
  try {
    const info = await module.getInfoAsync(path)
    if (!info.exists) return null
    return await module.readAsStringAsync(path)
  } catch {
    return null
  }
}

export async function clearDevLog(): Promise<void> {
  const module = fs()
  if (!module) return
  const path = logPath(module)
  if (!path) return
  try {
    await module.writeAsStringAsync(path, '')
  } catch {
    // Ignore.
  }
}

/** Environment snapshot: free disk, database size, row counts — look here for things like SQLITE_FULL. */
export async function diagnosticsSnapshot(): Promise<string> {
  const module = fs()
  const lines: string[] = []
  try {
    if (module) {
      const info = await module.getFreeDiskStorageAsync?.()
      if (typeof info === 'number') lines.push(`free_disk: ${(info / 1024 / 1024).toFixed(1)} MB`)
    }
  } catch {
    lines.push('free_disk: unknown')
  }
  try {
    const { getDb } = await import('./db')
    const db = await getDb()
    const counts = await db.getFirstAsync<{ total: number; deleted: number }>(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted FROM documents',
    )
    lines.push(`documents: ${counts?.total ?? 0} (deleted ${counts?.deleted ?? 0})`)
    const base = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_base')
    // Named as rows, not "base": next to documents:N it read like a second document count.
    lines.push(`sync_base_rows: ${base?.n ?? 0}`)
  } catch (error) {
    lines.push(`db: ${error instanceof Error ? error.message : String(error)}`)
  }
  // Which build is running. There is one delivery channel now, but the number
  // the UI reads and the number in the package can still disagree after a
  // manual install, so both are recorded.
  try {
    const [{ appVersion }, Constants] = await Promise.all([
      import('./app-version'),
      import('expo-constants'),
    ])
    lines.push(`app_version: ${await appVersion()}`)
    lines.push(`js_version: ${Constants.default.expoConfig?.version ?? '-'}`)
  } catch (error) {
    lines.push(`version: ${error instanceof Error ? error.message : String(error)}`)
  }
  // The state of the log itself: developers read this code to decide "why the log is empty".
  try {
    const module = fs()
    const path = module ? logPath(module) : null
    if (module && path) {
      const info = await module.getInfoAsync(path)
      if (!info.exists) {
        lines.push(`dev_log: 空（dev_mode=${enabled ? 'on' : 'off'}）`)
      } else {
        const text = await module.readAsStringAsync(path)
        lines.push(`dev_log: ${text.length}B ${text.trim().split('\n').filter(Boolean).length}行（dev_mode=${enabled ? 'on' : 'off'}）`)
      }
    } else {
      lines.push('dev_log: 文件系统不可用')
    }
  } catch (error) {
    lines.push(`dev_log: ${error instanceof Error ? error.message : String(error)}`)
  }
  return lines.join('\n')
}
