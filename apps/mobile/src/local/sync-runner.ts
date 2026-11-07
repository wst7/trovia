/**
 * One execution of sync: wiring the config, the WebDAV transport and the local store together.
 *
 * Background automatic sync is deliberately not done here: on a phone, “quietly shipping data” is more unsettling than “tapping once”,
 * and it also fails over and over on a weak network. Foreground timers can be considered once the UI has settled down.
 */
import { syncOnce } from '@trovia/sync'
import type { SyncReport } from '@trovia/sync'
import { WebDavTarget } from '@trovia/sync/webdav'

import { opLog } from './dev-log'
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

/** Test the connection: create the directory + list it once; if that goes through, the address, account and permissions are all fine. */
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

  const startedAt = Date.now()
  await opLog('sync.start', { host: config.baseUrl.replace(/^https?:\/\//, '') })
  let report: SyncReport
  try {
    report = await syncOnce({
      target,
      store: createSyncStore(),
      deviceId: await deviceId(),
      now: () => new Date().toISOString(),
    })
  } catch (error) {
    await opLog('sync.fail', { ms: Date.now() - startedAt }, error)
    throw error
  }
  await opLog('sync.done', { ...report, ms: Date.now() - startedAt })

  // Items pulled down carry only image URLs. Filling in the images happens after the sync and does not block the result:
  // the user sees the list first and the images are filled into the device one by one in the background.
  if (report.pulled > 0) void hydrateImages().catch(() => undefined)

  return report
}

/** The report turned into one plain sentence, shared by the UI and the Toast. */
export function describeReport(report: SyncReport): string {
  const parts: string[] = []
  if (report.pushed > 0) parts.push(t('sync.report.pushed', { count: report.pushed }))
  if (report.pulled > 0) parts.push(t('sync.report.pulled', { count: report.pulled }))
  if (report.deleted > 0) parts.push(t('sync.report.deleted', { count: report.deleted }))
  if (report.conflicts > 0) parts.push(t('sync.report.conflicts', { count: report.conflicts }))
  // Files that are in the cloud but cannot be read: when the numbers do not add up, this sentence is the answer.
  if (report.skipped > 0) parts.push(t('sync.report.skipped', { count: report.skipped }))
  // “Nothing to sync” has two meanings: the cloud is empty, and the cloud has things but both sides already agree.
  // Both cases used to show the same sentence, so users could not tell whether sync was not taking effect or there was simply nothing there.
  if (parts.length === 0) {
    return report.remoteFiles === 0 ? t('sync.report.emptyRemote') : t('sync.report.uptodate', { count: report.remoteFiles })
  }
  return parts.join(t('sync.report.join'))
}
