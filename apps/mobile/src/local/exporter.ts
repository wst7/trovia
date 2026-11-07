/**
 * Full export.
 *
 * The landing page says "you can always export everything", so this really has to do it:
 * a machine-readable backup (gzipped JSON that restores completely on import), plus a human-readable Markdown.
 * Both contain only the user's own content, without derived data such as indexes and vectors.
 *
 * Why not hand out JSON directly: in a library of hundreds of articles the JSON is nothing but field names and escapes, and the body is stored a second time as plain text,
 * so 6 MB is common. After gzip it is 1.6 MB (measured on 315 articles), and neither the phone's share sheet nor personal cloud drives mind it anymore.
 *
 * The backup stores the "whole row", not just the content fields: id, canonical_url, status, both timestamps, rev, metadata
 * all have to be carried, otherwise those values drift after an export/import round trip and the next export is not the same file.
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

/** Backup format version. Since v2 each article also carries updated_at and rev. */
export const EXPORT_VERSION = 2

export interface ExportBundle {
  version: number
  exported_at: string
  count: number
  documents: ExportDocument[]
}

/** Human-readable version: one section per article, title + metadata + body. */
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
  /** .zip backup: backup.json + MARKDOWN_ENTRY, recognized directly on import. */
  path: string
  /** Byte counts before and after compression, used by the UI to say how much was saved. */
  rawBytes: number
  zipBytes: number
}

/**
 * Write to disk and return the path. Sharing is up to the caller (the system share sheet).
 * Returns null when no usable filesystem is available; the caller reports the failure.
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
    // Already exists
  }

  const bundle: ExportBundle = {
    version: EXPORT_VERSION,
    exported_at: exportedAt,
    count: docs.length,
    documents: docs,
  }
  // No pretty-print: indentation adds 10-20% of volume for nothing, and nobody reads it before compression.
  const encoded = encodeBackup(JSON.stringify(bundle), buildExportMarkdown(docs, exportedAt))
  const path = `${dir}trovia-${stamp(now)}.zip`

  // expo-file-system can only write binary through base64.
  await module.writeAsStringAsync(path, encoded.base64, { encoding: 'base64' })

  return { path, rawBytes: encoded.rawBytes, zipBytes: encoded.zipBytes }
}

/** Put a byte count into plain language. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
