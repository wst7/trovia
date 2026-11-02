/**
 * 可重试的失败，回到前台时偷偷再试一次。
 *
 * 「没能连上站点」多半是当时信号断了：地铁里点保存、飞机上、电梯里。用户不该为此
 * 记得回来点一次重试——但也不能每次切到前台就把几十条链接全部重打一遍（那是对
 * 站点的不礼貌，也耗电）。
 *
 * 所以：只挑「我们这边的问题」那几类，每次最多 20 条，两轮之间至少隔 30 分钟，
 * 失败照样静默。站点拒绝读取的条目一条都不碰——它们的错误码本来就不在可重试列表里。
 */
import { processPendingQueue } from './pipeline'
import { isRetryableError, RETRYABLE_CODES } from './retry'
import * as repo from './repo'
import { readSetting, writeSetting } from './settings'

const LAST_ATTEMPT_KEY = 'trovia.autoRetry.at'
/** 两轮之间至少隔这么久：刚失败过就再试，多半还是同样的结果。 */
const MIN_INTERVAL_MS = 30 * 60 * 1000
/** 一次最多排这么多：避免一口气打 40 个站点。 */
const BATCH = 20

let running = false

/**
 * 只统计「本机可以改善」的失败，和界面上的口径一致。
 */
export async function countRetryableFailures(): Promise<number> {
  return repo.countRetryableFailed()
}

/** 是否有值得自动重试的条目（不触发重试，纯查询）。 */
export async function hasRetryableFailures(): Promise<boolean> {
  return (await countRetryableFailures()) > 0
}

export async function maybeRetryFailed(): Promise<number> {
  if (running) return 0
  if (!(await hasRetryableFailures())) return 0

  try {
    const raw = await readSetting(LAST_ATTEMPT_KEY)
    if (raw) {
      const age = Date.now() - new Date(raw).getTime()
      if (Number.isFinite(age) && age < MIN_INTERVAL_MS) return 0
    }
  } catch {
    // 读不到时间就当作从没试过：多试一次不会伤人。
  }

  running = true
  try {
    await writeSetting(LAST_ATTEMPT_KEY, new Date().toISOString())
    const queued = await repo.retryFailedBatch(BATCH)
    if (queued > 0) await processPendingQueue()
    return queued
  } catch {
    // 静默：自动重试失败不该弹窗，用户没请求过它。
    return 0
  } finally {
    running = false
  }
}

/** 供设置页展示：这些错误码才是自动重试会碰的。 */
export function autoRetryCodes(): string[] {
  return [...RETRYABLE_CODES]
}

export { isRetryableError }
