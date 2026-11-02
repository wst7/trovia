/**
 * 同步配置：地址与用户名进普通设置表，密码只进 SecureStore。
 *
 * 不做「账号体系」：用户填的是自己网盘的地址和密码，我们不经过任何服务器，
 * 也没有找回密码这回事。所以这里只需要能存、能读、能清空。
 */
import * as SecureStore from 'expo-secure-store'

import { readSetting, writeSetting } from './settings'

const PASSWORD_KEY = 'trovia.sync.webdav.password'

export interface WebDavConfig {
  baseUrl: string
  username: string
  /** 远端目录，默认 trovia；填错也不会动别人的文件。 */
  folder: string
}

export const EMPTY_CONFIG: WebDavConfig = { baseUrl: '', username: '', folder: 'trovia' }

export async function loadConfig(): Promise<WebDavConfig> {
  const raw = await readSetting('sync_webdav')
  if (!raw) return EMPTY_CONFIG
  try {
    const parsed = JSON.parse(raw) as Partial<WebDavConfig>
    return {
      baseUrl: parsed.baseUrl ?? '',
      username: parsed.username ?? '',
      folder: parsed.folder || 'trovia',
    }
  } catch {
    return EMPTY_CONFIG
  }
}

export async function saveConfig(config: WebDavConfig, password: string): Promise<void> {
  await writeSetting('sync_webdav', JSON.stringify(config))
  if (password) await SecureStore.setItemAsync(PASSWORD_KEY, password)
  else await SecureStore.deleteItemAsync(PASSWORD_KEY)
}

export async function loadPassword(): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(PASSWORD_KEY)) ?? ''
  } catch {
    return ''
  }
}

/** 设备标识：第一次同步时生成，只用来在远端留下「谁同步过」的痕迹。 */
export async function deviceId(): Promise<string> {
  const existing = await readSetting('sync_device_id')
  if (existing) return existing
  const created = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  await writeSetting('sync_device_id', created)
  return created
}

export async function lastSyncAt(): Promise<string | null> {
  return readSetting('sync_last_at')
}
