/**
 * Save the images in the body to the system photo library.
 *
 * Local files (already persisted by image_files) go straight in; remote addresses are downloaded to a cache directory first,
 * and the temporary file is deleted afterwards — a novel's worth of images piling up quietly takes up hundreds of MB.
 */
import * as MediaLibrary from 'expo-media-library/legacy'

/** The filename in the photo library: Trovia-20261102-234501.png, recognizable at a glance by its time. */
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
 * @param uri a local file:// or a remote http(s):// address
 */
export async function saveImageToLibrary(uri: string): Promise<SaveResult> {
  const module = fs()
  if (!module) return { ok: false, reason: 'unavailable' }

  // Android 13+ saves images through MediaStore and needs no read permission; 12 and below need write permission.
  const permission = await MediaLibrary.requestPermissionsAsync()
  if (!permission.granted) return { ok: false, reason: 'permission' }

  try {
    if (uri.startsWith('file://')) {
      // Body images are persisted with an .img suffix (a name of our own). The photo library decides the type by extension,
      // and ".img" is treated as an unknown format and fails outright, so copy it to a temporary file with an image suffix first.
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

    // The extension decides whether MediaStore accepts the file: when the remote address has no suffix, save as jpg by default.
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
