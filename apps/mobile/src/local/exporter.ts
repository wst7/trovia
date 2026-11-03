/**
 * 全量导出。
 *
 * 落地页写着「任何时候都能完整导出」，所以这里必须真的做到：
 * 一份机器可读的 JSON（将来导入/迁移用），一份人能读的 Markdown（直接扔进笔记软件）。
 * 两者都只包含用户自己的内容，不含索引与向量这类派生数据。
 */
import type { DocumentDetail } from '@trovia/shared'

type FileSystemModule = typeof import('expo-file-system/legacy')

function fs(): FileSystemModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-file-system/legacy') as FileSystemModule
  } catch {
    return null
  }
}

export interface ExportBundle {
  version: 1
  exported_at: string
  count: number
  documents: DocumentDetail[]
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

/**
 * 写盘并返回路径。分享由调用方决定（系统分享面板）。
 * 没有可用文件系统时返回 null，调用方提示失败。
 */
export async function writeExport(docs: DocumentDetail[]): Promise<{ jsonPath: string; markdownPath: string } | null> {
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

  const bundle: ExportBundle = { version: 1, exported_at: exportedAt, count: docs.length, documents: docs }
  const jsonPath = `${dir}trovia-${stamp(now)}.json`
  const markdownPath = `${dir}trovia-${stamp(now)}.md`

  await module.writeAsStringAsync(jsonPath, JSON.stringify(bundle, null, 2))
  await module.writeAsStringAsync(markdownPath, buildExportMarkdown(docs, exportedAt))

  return { jsonPath, markdownPath }
}
