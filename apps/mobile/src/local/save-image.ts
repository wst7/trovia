/**
 * 把正文里的图片存到系统相册。
 *
 * 本地文件（image_files 落过盘的）直接入库；远程地址先下到缓存目录再入库，
 * 存完把临时文件删掉——小说级别的图片攒多了会悄悄占掉几百 MB。
 */
import * as MediaLibrary from 'expo-media-library/legacy'

/** 相册里的文件名：Trovia-20261102-234501.png，按时间一眼能认出来。 */
function cleanName(extension: string, now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `Trovia-${stamp}.${extension}`
}

type FileSystemModule = typeof import('expo-file-system/legacy')

function fs(): FileSystemModule | null {
  try {
    return require('expo-file-system/legacy') as FileSystemModule
  } catch {
    return null
  }
}

export type SaveResult =
  | { ok: true }
  | { ok: false; reason: 'permission' | 'unavailable' | 'failed' }

/**
 * @param uri 本地 file:// 或远程 http(s):// 地址
 */
export async function saveImageToLibrary(uri: string): Promise<SaveResult> {
  const module = fs()
  if (!module) return { ok: false, reason: 'unavailable' }

  // Android 13+ 存图片走 MediaStore，不需要读权限；12 及以下要写权限。
  const permission = await MediaLibrary.requestPermissionsAsync()
  if (!permission.granted) return { ok: false, reason: 'permission' }

  try {
    if (uri.startsWith('file://')) {
      // 正文图片落盘时用的是 .img 后缀（我们自己起的名字）。相册按扩展名判断类型，
      // 「.img」会被当成未知格式直接失败，所以先复制成带图片后缀的临时文件。
      const extension = /\.(png|jpe?g|webp|gif|avif)$/i.exec(uri)?.[1]?.toLowerCase() ?? 'jpg'
      const copy = `${module.cacheDirectory ?? ''}${cleanName(extension)}`
      await module.copyAsync({ from: uri, to: copy })
      try {
        await MediaLibrary.saveToLibraryAsync(copy)
        return { ok: true }
      } finally {
        await module.deleteAsync(copy, { idempotent: true }).catch(() => undefined)
      }
    }

    // 扩展名决定 MediaStore 认不认这个文件：远程地址里没有后缀时默认按 jpg 存。
    const remoteExtension = /\.(png|jpe?g|webp|gif|avif)(?:[?#]|$)/i.exec(uri)?.[1]?.toLowerCase() ?? 'jpg'
    const target = `${module.cacheDirectory ?? ''}${cleanName(remoteExtension)}`
    const downloaded = await module.downloadAsync(uri, target)
    if (downloaded.status !== 200) {
      await module.deleteAsync(target, { idempotent: true }).catch(() => undefined)
      return { ok: false, reason: 'failed' }
    }
    try {
      await MediaLibrary.saveToLibraryAsync(downloaded.uri)
      return { ok: true }
    } finally {
      await module.deleteAsync(downloaded.uri, { idempotent: true }).catch(() => undefined)
    }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}
