/**
 * 自动同步：回到前台时静默跑一轮。
 *
 * 不做后台定时：手机上的后台任务既不可靠，也会让人怀疑「它在我不知道的时候传了什么」。
 * 只在这个时机同步，用户能预期到：打开应用，内容就是新的。
 */
import { loadConfig, loadPassword, lastSyncAt } from './sync-config'
import { syncNow } from './sync-runner'

/** 两次自动同步之间的最小间隔：刚同步过就别再连一次网盘。 */
const MIN_INTERVAL_MS = 5 * 60 * 1000

let running = false

export async function isSyncConfigured(): Promise<boolean> {
  const config = await loadConfig()
  if (!config.baseUrl.trim() || !config.username.trim()) return false
  return (await loadPassword()).length > 0
}

/**
 * 满足条件才同步；失败一律静默——自动同步报错弹窗比不同步更烦人。
 * 手动同步仍然会把错误讲清楚。
 */
/**
 * 刚存了一条，顺手同步一次。
 *
 * 不等 5 分钟那个节流：用户刚存完，最想看的就是「另一台也能看到」。
 * 但连着存几条时只跑最后一轮——8 秒内的多次保存合并成一次同步。
 */
let saveTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleSyncAfterSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void syncAfterSave()
  }, 8000)
}

export async function syncAfterSave(): Promise<void> {
  if (running) return
  if (!(await isSyncConfigured())) return
  running = true
  try {
    await syncNow()
  } catch {
    // 存都存好了，同步失败不该在保存这条路上弹错；下次前台会再试。
  } finally {
    running = false
  }
}

export async function maybeAutoSync(): Promise<void> {
  if (running) return
  if (!(await isSyncConfigured())) return

  const last = await lastSyncAt()
  if (last) {
    const age = Date.now() - new Date(last).getTime()
    if (Number.isFinite(age) && age < MIN_INTERVAL_MS) return
  }

  running = true
  try {
    await syncNow()
  } catch {
    // 断网、网盘限流、密码过期：都不打扰用户，下次前台再说。
  } finally {
    running = false
  }
}
