/**
 * Sync config: the address and username go into the ordinary settings table; the password goes only into SecureStore.
 *
 * No “account system” is built: the user fills in their own cloud drive's address and password, nothing passes through any server of ours,
 * and there is no such thing as password recovery. So all that is needed here is to store, read and clear.
 */
import * as SecureStore from 'expo-secure-store'

import { readSetting, writeSetting } from './settings'

const PASSWORD_KEY = 'trovia.sync.webdav.password'

export interface WebDavConfig {
  baseUrl: string
  username: string
  /** Remote directory, trovia by default; a typo will not touch anybody else's files. */
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

/** Device identifier: generated on the first sync, used only to leave a trace on the remote of “who has synced”. */
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
