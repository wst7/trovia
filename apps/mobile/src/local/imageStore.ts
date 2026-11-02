/**
 * 正文图片落盘。
 *
 * 只存 URL 是不够的：原站换图、删图、或者用户断网，收藏里的图就没了。
 * 「本地优先」意味着图片也要在本地，所以解析完成之后把正文图下载到应用目录，
 * 详情页优先用本地文件，远程地址只作为兜底。
 *
 * 三条约束：
 *   - 每篇最多 IMAGE_LIMIT 张，超出的只保留远程地址（避免一篇长文吃掉几十 MB）
 *   - 单张超过 MAX_BYTES 的删掉，防止存下一堆 4K 原图
 *   - 下载失败就跳过，不影响正文与索引
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
 * 下载并保存；返回与 urls 等长的数组，未保存的位置是空字符串。
 * 已经是本地文件的路径原样返回，重复调用不会重复下载。
 */
export async function cacheImages(docId: string, urls: string[], referer: string): Promise<string[]> {
  const module = fs()
  const dir = dirOf(docId)
  if (!module || !dir) return urls.map(() => '')

  try {
    await module.makeDirectoryAsync(dir, { intermediates: true })
  } catch {
    // 目录已存在
  }

  const out: string[] = []
  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index]
    if (!url) {
      out.push('')
      continue
    }
    if (!/^https?:/i.test(url)) {
      out.push(url) // 已经是本地路径
      continue
    }
    if (index >= IMAGE_LIMIT) {
      out.push('')
      continue
    }

    const target = `${dir}${nameOf(index, url)}`
    try {
      const existing = await module.getInfoAsync(target)
      if (existing.exists) {
        out.push(target)
        continue
      }
    } catch {
      // 查不到就当不存在，继续下载
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

/** 删除这篇收藏的图片目录；删除收藏时调用，避免文件残留。 */
export async function removeImages(docId: string): Promise<void> {
  const module = fs()
  const dir = dirOf(docId)
  if (!module || !dir) return
  try {
    await module.deleteAsync(dir, { idempotent: true })
  } catch {
    // 目录不存在就算了
  }
}

/** 远程地址 → 本地文件；没有本地文件时返回远程地址。 */
export function resolveImage(url: string, local: string | null | undefined): string {
  return local && local.length > 0 ? local : url
}
