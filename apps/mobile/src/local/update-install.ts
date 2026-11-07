/**
 * Download the installer package and hand it to the system installer.
 *
 * Android does not let an app install things quietly: the apk can only be handed to the system install screen and the user taps “Install”.
 * The first time, “install unknown apps” also has to be granted to Trovia in the system settings — when it is not granted,
 * this opens that settings page directly, so the user does not have to go digging for it.
 */
type FileSystemModule = typeof import('expo-file-system/legacy')

function fs(): FileSystemModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-file-system/legacy') as FileSystemModule
  } catch {
    return null
  }
}

export interface DownloadProgress {
  /** 0–1; -1 when the server did not send Content-Length. */
  ratio: number
  written: number
  total: number
}

/** Download into the cache directory; the file name is fixed, so a repeat download simply overwrites it. */
export async function downloadApk(
  url: string,
  fileName: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<string> {
  const module = fs()
  if (!module?.cacheDirectory) throw new Error('这台设备上暂时无法写入文件')
  const target = `${module.cacheDirectory}${fileName.replace(/[^\w.-]/g, '_')}`
  // Delete the old package first, so a resumed download cannot take half an old file for the new package
  await module.deleteAsync(target, { idempotent: true }).catch(() => undefined)

  const task = module.createDownloadResumable(url, target, {}, (event) => {
    const total = event.totalBytesExpectedToWrite
    onProgress?.({
      ratio: total > 0 ? event.totalBytesWritten / total : -1,
      written: event.totalBytesWritten,
      total,
    })
  })
  const result = await task.downloadAsync()
  if (!result || result.status < 200 || result.status >= 300) {
    throw new Error(`下载失败（HTTP ${result?.status ?? '未知'}）`)
  }
  return result.uri
}

/** Bring up the system install screen. Without the permission, open the “install unknown apps” settings page. */
export async function installApk(uri: string): Promise<void> {
  const module = fs()
  const IntentLauncher = await import('expo-intent-launcher')
  const contentUri = module?.getContentUriAsync ? await module.getContentUriAsync(uri) : uri
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      type: 'application/vnd.android.package-archive',
    })
  } catch {
    // Typical cause: “install unknown apps” is not enabled. Open that settings page directly.
    await IntentLauncher.startActivityAsync('android.settings.MANAGE_UNKNOWN_APP_SOURCES', {
      data: 'package:com.trovia.app',
    }).catch(() => undefined)
    throw new Error('没有安装权限：先在系统设置里允许 Trovia 安装应用，再回来点一次')
  }
}

export function formatMb(bytes: number): string {
  if (!bytes) return ''
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
