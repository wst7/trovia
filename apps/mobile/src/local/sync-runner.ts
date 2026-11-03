/**
 * 同步的一次执行：把配置、WebDAV 传输、本机库接到一起。
 *
 * 这里刻意不做后台自动同步：手机上「悄悄传数据」比「手动点一下」更让人不安，
 * 也更容易在弱网下反复失败。等界面稳定了再考虑前台定时。
 */
import { syncOnce } from '@trovia/sync'
import type { SyncReport } from '@trovia/sync'
import { WebDavTarget } from '@trovia/sync/webdav'

import { hydrateImages } from './image-hydrate'
import { deviceId, loadConfig, loadPassword } from './sync-config'
import type { WebDavConfig } from './sync-config'
import { createSyncStore } from './sync-store'
import { t } from '../i18n'

function joinUrl(baseUrl: string, folder: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  const sub = folder.trim().replace(/^\/+|\/+$/g, '')
  return sub ? `${base}/${sub}` : base
}

export class SyncNotConfigured extends Error {
  constructor() {
    super('还没填好同步账户')
  }
}

async function targetOf(config: WebDavConfig): Promise<WebDavTarget> {
  const password = await loadPassword()
  if (!config.baseUrl.trim() || !config.username.trim() || !password) throw new SyncNotConfigured()
  return new WebDavTarget({
    baseUrl: joinUrl(config.baseUrl, config.folder),
    username: config.username.trim(),
    password,
  })
}

/** 测试连接：建目录 + 列一次，能走通就说明地址、账号、权限都对。 */
export async function testConnection(): Promise<void> {
  const config = await loadConfig()
  const target = await targetOf(config)
  await target.ensureDir('docs')
  await target.list('docs/')
}

export async function syncNow(): Promise<SyncReport> {
  const config = await loadConfig()
  const target = await targetOf(config)
  await target.ensureDir('docs')

  const report = await syncOnce({
    target,
    store: createSyncStore(),
    deviceId: await deviceId(),
    now: () => new Date().toISOString(),
  })

  // 拉下来的条目只有图片地址。补图放在同步之后、不阻塞结果：
  // 用户先看到列表，图片在后台一张张补进本机。
  if (report.pulled > 0) void hydrateImages().catch(() => undefined)

  return report
}

/** 报告变成一句人话，界面和 Toast 共用。 */
export function describeReport(report: SyncReport): string {
  const parts: string[] = []
  if (report.pushed > 0) parts.push(t('sync.report.pushed', { count: report.pushed }))
  if (report.pulled > 0) parts.push(t('sync.report.pulled', { count: report.pulled }))
  if (report.deleted > 0) parts.push(t('sync.report.deleted', { count: report.deleted }))
  if (report.conflicts > 0) parts.push(t('sync.report.conflicts', { count: report.conflicts }))
  if (parts.length === 0) return t('sync.report.none')
  return parts.join(t('sync.report.join'))
}
