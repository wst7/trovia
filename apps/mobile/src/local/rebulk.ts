/**
 * 把整库正文重新抓一遍。
 *
 * 抽取规则会改进，但老条目的正文是收藏当天抓的，只能一条条点「重新整理」——
 * 313 条手工点不现实。这里做成一件可中断的活：一条一条排队，每完成一条回一次
 * 进度，用户随时能停。
 *
 * 刻意不分批并发：连打十几个站点既容易被限流，又会让用户不知道进度到底走到哪。
 */
import { processPendingQueue } from './pipeline'
import { markForRetry } from './repo'
import { getDb } from './db'

export interface ReprocessProgress {
  done: number
  total: number
  /** 刚刚处理完的那条标题，让人知道它在干活而不是卡住。 */
  current: string | null
}

/** 需要重抓的条目：所有正常存在的文档（失败的那些有别的入口）。 */
async function listTargets(): Promise<{ id: string; title: string | null }[]> {
  const db = await getDb()
  return db.getAllAsync<{ id: string; title: string | null }>(
    `SELECT id, title FROM documents
      WHERE deleted_at IS NULL
      ORDER BY saved_at DESC`,
  )
}

export async function countReprocessTargets(): Promise<number> {
  return (await listTargets()).length
}

/**
 * @param onProgress 每处理完一条回调一次
 * @param shouldStop 返回 true 时在下一条之前停下（用户点了停止）
 */
export async function reprocessAll(
  onProgress: (progress: ReprocessProgress) => void,
  shouldStop: () => boolean = () => false,
): Promise<{ processed: number; stopped: boolean }> {
  const targets = await listTargets()
  const total = targets.length
  let done = 0

  for (const target of targets) {
    if (shouldStop()) return { processed: done, stopped: true }
    onProgress({ done, total, current: target.title })
    try {
      await markForRetry(target.id)
      await processPendingQueue()
    } catch {
      // 单条失败（网络、站点拒绝）不影响整批：它自己的状态会记下来。
    }
    done += 1
  }

  onProgress({ done, total, current: null })
  return { processed: done, stopped: false }
}
