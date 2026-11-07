/**
 * Persisting body images to disk.
 *
 * Storing only the URL is not enough: if the source site swaps or deletes an image, or the user goes offline, the images in the saved article are gone.
 * "Local-first" means images have to be local too, so once parsing finishes the body images are downloaded into the app directory,
 * and the detail screen prefers the local file, with the remote address only as a fallback.
 *
 * Three constraints:
 *   - at most IMAGE_LIMIT images per article, and anything beyond that keeps only its remote address (so one long article does not eat tens of MB)
 *   - a single image over MAX_BYTES is deleted, to avoid storing a pile of 4K originals
 *   - a failed download is skipped, without affecting the body or the index
 */
const UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'

export const IMAGE_LIMIT = 12
const MAX_BYTES = 4 * 1024 * 1024

type FileSystemModule = typeof import('expo-file-system/legacy')

function fs(): FileSystemModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-file-system/legacy') as FileSystemModule
  } catch {
    return null
  }
}

function dirOf(docId: string): string | null {
  const module = fs()
  if (!module?.documentDirectory) return null
  return `${module.documentDirectory}images/${docId}/`
}

function nameOf(index: number, url: string): string {
  let hash = 0
  for (let i = 0; i < url.length; i += 1) hash = (hash * 31 + url.charCodeAt(i)) | 0
  return `${String(index).padStart(2, '0')}-${Math.abs(hash).toString(36)}.img`
}

/**
 * Download and save; returns an array as long as urls, with an empty string where nothing was saved.
 * Paths that are already local files are returned as is, and repeated calls do not download again.
 */
export async function cacheImages(docId: string, urls: string[], referer: string): Promise<string[]> {
  const module = fs()
  const dir = dirOf(docId)
  if (!module || !dir) return urls.map(() => '')

  try {
    await module.makeDirectoryAsync(dir, { intermediates: true })
  } catch {
    // Directory already exists
  }

  const out: string[] = []
  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index]
    if (!url) {
      out.push('')
      continue
    }
    if (!/^https?:/i.test(url)) {
      out.push(url) // Already a local path
      continue
    }
    if (index >= IMAGE_LIMIT) {
      out.push('')
      continue
    }

    const target = `${dir}${nameOf(index, url)}`
    try {
      const existing = await module.getInfoAsync(target)
      // "The file exists" does not mean "the image is usable": a 404 also writes a 0-byte shell.
      // The shell must be deleted and re-downloaded, otherwise this slot is a blank image forever and never gets retried.
      if (existing.exists) {
        const existingSize = 'size' in existing ? Number(existing.size ?? 0) : 0
        if (existingSize > 0) {
          out.push(target)
          continue
        }
        await module.deleteAsync(target, { idempotent: true }).catch(() => undefined)
      }
    } catch (error) {
      // Treat an unreadable result as absent and keep downloading
    }

    try {
      const result = await module.downloadAsync(url, target, {
        headers: { 'User-Agent': UA, Referer: referer, Accept: 'image/*,*/*;q=0.8' },
      })
      if (result.status !== 200) {
        out.push('')
        continue
      }
      const info = await module.getInfoAsync(target)
      const size = info.exists && 'size' in info ? Number(info.size ?? 0) : 0
      // 0 bytes means nothing real came down this time (a 404 page, an empty response). Delete it, otherwise the next getInfoAsync
      // will consider it "already saved" and this slot stays a blank image forever, never retried again.
      if (size === 0) {
        await module.deleteAsync(target, { idempotent: true }).catch(() => undefined)
        out.push('')
        continue
      }
      if (size > MAX_BYTES) {
        await module.deleteAsync(target, { idempotent: true })
        out.push('')
        continue
      }
      out.push(target)
    } catch {
      out.push('')
    }
  }
  return out
}

/** Delete this saved article's image directory; called when the article is deleted, to avoid leftover files. */
/** How many are really usable on disk: 0 bytes or a missing file does not count. */
export async function usableImageCount(files: string[]): Promise<number> {
  const module = fs()
  if (!module) return 0
  let count = 0
  for (const file of files) {
    if (!file) continue
    try {
      // legacy's getInfoAsync does not accept the type for { size: true }; the return value already carries size.
      const info = await module.getInfoAsync(file)
      if (info.exists && 'size' in info && Number(info.size ?? 0) > 0) count += 1
    } catch {
      // Treat an unreadable result as none
    }
  }
  return count
}

export async function removeImages(docId: string): Promise<void> {
  const module = fs()
  const dir = dirOf(docId)
  if (!module || !dir) return
  try {
    await module.deleteAsync(dir, { idempotent: true })
  } catch {
    // If the directory does not exist, let it go
  }
}

/** Remote address → local file; returns the remote address when there is no local file. */
export function resolveImage(url: string, local: string | null | undefined): string {
  return local && local.length > 0 ? local : url
}
