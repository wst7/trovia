/**
 * 补图：同步或导入进来的收藏只有图片地址，本机还没有文件。
 *
 * 不重跑解析（那会把正文、摘要、关键词全部重算一遍，还会覆盖同步过来的版本），
 * 只做一件事：按 images 里的地址把图片下载到本机，再回写 image_files。
 *
 * 限量是刻意的：一次最多补几张，别让回到前台的那一下变成下载几百兆。
 */
import { cacheImages, usableImageCount } from './imageStore'
import * as repo from './repo'

const BATCH = 4

let running = false

export async function hydrateImages(batch = BATCH): Promise<number> {
  if (running) return 0
  running = true
  let done = 0
  try {
    const candidates = await repo.listWithImages(batch)
    for (const doc of candidates) {
      try {
        // 字段里写着路径不算数，磁盘上真有字节才算；否则 404 留下的空文件会让
        // 这篇永远停在「已经存过」，再也不会重试。
        if ((await usableImageCount(doc.imageFiles)) > 0) continue

        const files = await cacheImages(doc.id, doc.images, doc.url)
        // 一张都没成功就保持原样，下次再试，别写一串空字符串把自己标记成「已补过」。
        if (files.some((file) => file.length > 0)) {
          await repo.setImageFiles(doc.id, files)
          done += 1
        }
      } catch {
        // 单篇失败不影响其他篇
      }
    }
  } finally {
    running = false
  }
  return done
}
