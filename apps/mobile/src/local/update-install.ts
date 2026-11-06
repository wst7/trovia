/**
 * 下载安装包并交给系统安装器。
 *
 * 安卓不许应用悄悄装东西：只能把 apk 交给系统安装界面，用户点「安装」。
 * 首次还要在系统设置里给 Trovia 开「安装未知应用」的权限——没开时
 * 这里直接把那个设置页打开，省得用户自己翻。
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
  /** 0–1；服务器没给 Content-Length 时是 -1。 */
  ratio: number
  written: number
  total: number
}

/** 下载到缓存目录；文件名固定，重复下载直接覆盖。 */
export async function downloadApk(
  url: string,
  fileName: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<string> {
  const module = fs()
  if (!module?.cacheDirectory) throw new Error('这台设备上暂时无法写入文件')
  const target = `${module.cacheDirectory}${fileName.replace(/[^\w.-]/g, '_')}`
  // 旧包先删掉，避免断点续传把半个旧文件当成新包
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

/** 拉起系统安装界面。没权限时打开「安装未知应用」的设置页。 */
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
    // 典型原因：没开「安装未知应用」。把设置页直接打开。
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
