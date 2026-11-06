/**
 * 全量导出。
 *
 * 落地页写着「任何时候都能完整导出」，所以这里必须真的做到：
 * 一份机器可读的备份（gzip 过的 JSON，导入时能完整还原），一份人能读的 Markdown。
 * 两者都只包含用户自己的内容，不含索引与向量这类派生数据。
 *
 * 为什么不直接给 JSON：几百篇的库，JSON 里全是字段名和转义，正文与纯文本还各存一遍，
 * 6 MB 很常见。gzip 之后 1.6 MB（315 篇实测），手机分享面板和个人网盘都不再嫌它大。
 *
 * 备份里存的是「整行」而不只是内容字段：id、canonical_url、状态、两个时间戳、rev、metadata
 * 都要带上，否则导出再导入之后这些值会漂移，再导出就不是同一份文件了。
 */
import type { DocumentDetail } from '@trovia/shared'

import { encodeBackup } from './export-codec'
import type { ExportDocument } from './repo'

type FileSystemModule = typeof import('expo-file-system/legacy')

function fs(): FileSystemModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-file-system/legacy') as FileSystemModule
  } catch {
    return null
  }
}

/** 备份格式版本。v2 起每篇多带 updated_at 与 rev。 */
export const EXPORT_VERSION = 2

export interface ExportBundle {
  version: number
  exported_at: string
  count: number
  documents: ExportDocument[]
}

/** 人可读版本：每篇一节，标题 + 元信息 + 正文。 */
export function buildExportMarkdown(docs: DocumentDetail[], exportedAt: string): string {
  const header = [`# Trovia 导出`, ``, `导出时间：${exportedAt}`, `共 ${docs.length} 条`, ``].join('\n')
  const sections = docs.map((doc) => {
    const meta = [
      doc.site_name ? `来源：${doc.site_name}` : null,
      `链接：${doc.url}`,
      doc.author ? `作者：${doc.author}` : null,
      doc.published_at ? `发表于：${doc.published_at}` : null,
      `收藏于：${doc.saved_at}`,
      doc.keywords.length > 0 ? `关键词：${doc.keywords.join('、')}` : null,
    ]
      .filter(Boolean)
      .join('  \n')

    const title = doc.title?.trim() || doc.url
    const body = doc.content_markdown?.trim() || doc.plain_text?.trim() || '（没有保存到正文）'
    return [`## ${title}`, ``, meta, ``, body].join('\n')
  })
  return [header, ...sections].join('\n\n---\n\n')
}

function stamp(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`
}

export interface ExportResult {
  /** .zip 备份：backup.json + 收藏.md，导入时直接认。 */
  path: string
  /** 压缩前后的字节数，界面上用来交代省了多少。 */
  rawBytes: number
  zipBytes: number
}

/**
 * 写盘并返回路径。分享由调用方决定（系统分享面板）。
 * 没有可用文件系统时返回 null，调用方提示失败。
 */
export async function writeExport(docs: ExportDocument[]): Promise<ExportResult | null> {
  const module = fs()
  if (!module?.documentDirectory) return null

  const now = new Date()
  const exportedAt = now.toISOString()
  const dir = `${module.documentDirectory}exports/`
  try {
    await module.makeDirectoryAsync(dir, { intermediates: true })
  } catch {
    // 已存在
  }

  const bundle: ExportBundle = {
    version: EXPORT_VERSION,
    exported_at: exportedAt,
    count: docs.length,
    documents: docs,
  }
  // 不 pretty-print：缩进白涨一两成体积，压缩前也没人要读它。
  const encoded = encodeBackup(JSON.stringify(bundle), buildExportMarkdown(docs, exportedAt))
  const path = `${dir}trovia-${stamp(now)}.zip`

  // expo-file-system 写二进制只能走 base64。
  await module.writeAsStringAsync(path, encoded.base64, { encoding: 'base64' })

  return { path, rawBytes: encoded.rawBytes, zipBytes: encoded.zipBytes }
}

/** 字节数说成人话。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
