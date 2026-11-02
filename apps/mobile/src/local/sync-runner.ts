/**
 * 同步的一次执行：把配置、WebDAV 传输、本机库接到一起。
 *
 * 这里刻意不做后台自动同步：手机上「悄悄传数据」比「手动点一下」更让人不安，
 * 也更容易在弱网下反复失败。等界面稳定了再考虑前台定时。
 */
import { syncOnce } from '@xunji/sync'
import type { SyncReport } from '@xunji/sync'
import { WebDavTarget } from '@xunji/sync/webdav'

import { deviceId, loadConfig, loadPassword } from './sync-config'
import type { WebDavConfig } from './sync-config'
import { createSyncStore } from './sync-store'

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

  return syncOnce({
    target,
    store: createSyncStore(),
    deviceId: await deviceId(),
    now: () => new Date().toISOString(),
  })
}

/** 报告变成一句人话，界面和 Toast 共用。 */
export function describeReport(report: SyncReport): string {
  const parts: string[] = []
  if (report.pushed > 0) parts.push(`上传 ${report.pushed} 条`)
  if (report.pulled > 0) parts.push(`取回 ${report.pulled} 条`)
  if (report.deleted > 0) parts.push(`删除 ${report.deleted} 条`)
  if (report.conflicts > 0) parts.push(`保留 ${report.conflicts} 份冲突副本`)
  if (parts.length === 0) return '两端已经一致，没有需要同步的改动。'
  return parts.join('，')
}
