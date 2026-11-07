/**
 * Crash trail.
 *
 * When JS throws an unhandled error in a release build, the system takes the process down with nothing displayed —
 * the user only sees "it quits when I tap", and we get nothing at all. This writes the stack traces of the last few
 * uncaught errors to a local file, so the user can come back and tap "export diagnostics" to send them out.
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

/** After a crash the process can be reaped at any moment, so this does not wait for the promise: whatever is written is written. */
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
    // The record itself must not throw again: swallow it.
  }
}

/** Read the records back, for "export diagnostics". */
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

/**
 * Record an operation that "did not crash but failed" — save failures are the most common.
 * When a user reports "the save failed", this line says whether it was the database, storage, or a duplicate.
 */
export function recordProblem(scope: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? (error.stack ?? '') : ''
  void append(`${new Date().toISOString()} fatal=false ${scope} ${message} ${stack}`.replace(/\s+/g, ' ').slice(0, 4000))
}

/** Whether a crash record was ever left behind, used to decide whether the home screen should mention it. */
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

/** Clear the crash records: once the user has sent the log out, there is no reason to keep them. */
export async function clearCrashLog(): Promise<void> {
  const module = fs()
  if (!module) return
  const path = logPath(module)
  if (!path) return
  try {
    await module.writeAsStringAsync(path, '')
  } catch {
    // If it cannot be cleared, so be it.
  }
}

let installed = false

/** Install the global fallback once; it must be called as early as possible at the outermost layer of the app. */
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
    // The original handling (red box / exit) stays as before.
    previous(error, isFatal)
  })
}
