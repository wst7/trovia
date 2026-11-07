/**
 * 开发者模式：把「存不进」这件事本身记下来，供用户一键盘发出去。
 *
 * 普通用户不该看到这些；开关藏在首页标题上（长按），因为出问题的时候
 * 设置页可能正是崩掉的那一页，唯一能走的路必须是首页。
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
    // 存不进去也不影响本次会话的记录。
  }
}

/** 开发者模式下写一行；关着的时候什么都不做，不占 I/O。 */
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
    // 记录失败不能再抛。
  }
}

/**
 * 操作日志：谁在什么时候做了什么、花了多久、结果如何。
 *
 * 和 devLog 写同一个文件，前缀固定成 `op:`，读的时候可以只挑操作，
 * 也可以把保存失败的堆栈一起看——出问题时这两半总是一起看。
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
    // 忽略。
  }
}

/** 环境快照：磁盘剩余、数据库体积、行数——SQLITE_FULL 这类问题看这里。 */
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
    lines.push(`sync_base: ${base?.n ?? 0}`)
  } catch (error) {
    lines.push(`db: ${error instanceof Error ? error.message : String(error)}`)
  }
  // 日志本身的状态：开发者看着这块代码判断「为什么日志是空的」。
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
