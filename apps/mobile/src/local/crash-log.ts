/**
 * 崩溃留痕。
 *
 * Release 包里 JS 抛了没人接的错误，系统会直接把进程带走，什么都不显示——
 * 用户只看到「点一下就退出」，我们这边拿不到任何东西。这里把最后几次
 * 未捕获错误的调用栈写进本机文件，用户回来点「导出诊断」就能发出来。
 */
type FileSystemModule = typeof import('expo-file-system/legacy')

const LOG_NAME = 'crash.log'
const MAX_CHARS = 24_000

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

function format(error: unknown, fatal: boolean): string {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? (error.stack ?? '') : ''
  const oneLine = `${new Date().toISOString()} fatal=${fatal} ${message} ${stack}`
  return oneLine.replace(/\s+/g, ' ').slice(0, 4000)
}

/** 崩溃之后进程随时会被收掉，所以这里不等 promise：写完算数，写不完也只能算。 */
async function append(line: string): Promise<void> {
  const module = fs()
  if (!module) return
  const path = logPath(module)
  if (!path) return
  try {
    const info = await module.getInfoAsync(path)
    const previous = info.exists ? await module.readAsStringAsync(path) : ''
    await module.writeAsStringAsync(path, `${previous}${line}\n`.slice(-MAX_CHARS))
  } catch {
    // 记录本身不能再抛：吞掉。
  }
}

/** 读回记录，给「导出诊断」用。 */
export async function readCrashLog(): Promise<string | null> {
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

/** 有没有留下过崩溃记录，用来决定首页要不要提一句。 */
export async function hasCrashLog(): Promise<boolean> {
  const module = fs()
  if (!module) return false
  const path = logPath(module)
  if (!path) return false
  try {
    const info = await module.getInfoAsync(path)
    return Boolean(info.exists)
  } catch {
    return false
  }
}

let installed = false

/** 装一次全局兜底，必须在 App 最外层尽早调用。 */
export function installCrashLogger(): void {
  if (installed) return
  installed = true
  const holder = globalThis as {
    ErrorUtils?: {
      getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void
      setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void
    }
  }
  const ErrorUtils = holder.ErrorUtils
  if (!ErrorUtils?.getGlobalHandler || !ErrorUtils.setGlobalHandler) return
  const previous = ErrorUtils.getGlobalHandler()

  ErrorUtils.setGlobalHandler((error, isFatal) => {
    void append(format(error, Boolean(isFatal)))
    // 原来的处理（红屏 / 退出）照旧。
    previous(error, isFatal)
  })
}
