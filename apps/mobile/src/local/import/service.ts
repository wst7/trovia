/**
 * 导入的落库部分：选文件 → 解析 → 与现有收藏比对 → 批量入队。
 *
 * 刻意不在这里做「导入即解析」：导入只负责把链接放进队列，
 * 真正的抓取交给既有的解析队列，用户可以继续用手机，解析在后台慢慢跑。
 */
import * as DocumentPicker from 'expo-document-picker'

import { emitChange } from '../bus'
import { decodeBackupBase64 } from '../export-codec'
import * as repo from '../repo'
import { normalizeUrl, parseImport } from './parse'
import type { ImportFormat, ImportItem, RestoreDocument } from './parse'

type FileSystemModule = typeof import('expo-file-system/legacy')

function fs(): FileSystemModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-file-system/legacy') as FileSystemModule
  } catch {
    return null
  }
}

export interface PickedFile {
  name: string
  format: ImportFormat
  items: ImportItem[]
  /** 只有 Trovia 备份有：带正文的那份，恢复时直接落库。 */
  documents: RestoreDocument[] | undefined
  skipped: { line: string; reason: string }[]
  /** 已经在本机收藏里的条数（按归一化后的链接判断）。 */
  existing: number
  fresh: ImportItem[]
}

/** 打开系统文件选择器并解析；用户取消时返回 null。 */
export async function pickAndParse(): Promise<PickedFile | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: [
      'text/html',
      'application/json',
      'text/csv',
      'text/plain',
      'application/octet-stream',
      // 自己导出的备份：zip（新）与 gzip（过渡期），不同系统报的 mime 不一样
      'application/zip',
      'application/x-zip-compressed',
      'application/gzip',
      'application/x-gzip',
    ],
    copyToCacheDirectory: true,
    multiple: false,
  })
  if (picked.canceled || picked.assets.length === 0) return null

  const asset = picked.assets[0]
  const module = fs()
  if (!module) throw new Error('这台设备上暂时无法读取文件')

  // 按字节读、按文件头判断容器：zip / gzip / 纯文本走同一个入口。
  const base64 = await module.readAsStringAsync(asset.uri, { encoding: 'base64' })
  const { text: content } = decodeBackupBase64(base64)
  const parsed = parseImport(content)

  const existingUrls = await repo.listUrls()
  const known = new Set(existingUrls.map((url) => normalizeUrl(url) ?? url))
  const fresh = parsed.items.filter((item) => !known.has(item.url))

  return {
    name: asset.name ?? '导入文件',
    format: parsed.format,
    items: parsed.items,
    skipped: parsed.skipped,
    existing: parsed.items.length - fresh.length,
    fresh,
    documents: parsed.documents,
  }
}

export interface ImportProgress {
  done: number
  total: number
}

export interface ImportSummary {
  created: number
  duplicate: number
  failed: number
}

/** 逐条写入队列；交给调用方节流展示进度。 */
/**
 * 从自己的备份恢复：不抓网页，直接按备份里的内容落库。
 *
 * 这跟 runImport 是两条路：普通导入只有链接，得重新整理；备份里有正文，
 * 站点挂了也还在。
 */
export async function runRestore(
  documents: RestoreDocument[],
  onProgress?: (progress: ImportProgress) => void,
  fileName?: string,
): Promise<ImportSummary> {
  let created = 0
  let duplicate = 0
  let failed = 0

  for (let index = 0; index < documents.length; index += 1) {
    try {
      const result = await repo.restoreDocument(documents[index], fileName ?? '')
      if (result === 'duplicate') duplicate += 1
      else created += 1
    } catch {
      failed += 1
    }
    onProgress?.({ done: index + 1, total: documents.length })
  }

  // 恢复是直接写库，不经过解析队列，所以这里要自己喊一声；
  // 否则收藏页还停在导入前的列表上，得手动下拉才看得到。
  if (created > 0) emitChange()
  return { created, duplicate, failed }
}

export async function runImport(
  items: ImportItem[],
  onProgress?: (progress: ImportProgress) => void,
  /** 文件名，写进每条收藏的 metadata，详情页能说明「这条是从哪个文件来的」。 */
  fileName?: string,
): Promise<ImportSummary> {
  let created = 0
  let duplicate = 0
  let failed = 0

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    try {
      const result = await repo.createDocument(
        item.url,
        item.title,
        item.addedAt,
        fileName ? { kind: 'import' as const, file: fileName } : null,
        typeof item.addedAt === 'number',
      )
      if (result.duplicate) duplicate += 1
      else created += 1
    } catch {
      failed += 1
    }
    onProgress?.({ done: index + 1, total: items.length })
  }

  // 第一条落库就让列表刷新，别等后台整理完。
  if (created > 0) emitChange()
  return { created, duplicate, failed }
}
