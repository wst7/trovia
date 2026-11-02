/**
 * 键值设置：存在 SQLite 的 settings 表里。
 *
 * 之前这套函数是 sync-config 私有的，自动重试也要记「上次什么时候试过」，
 * 就搬到共用位置——两个模块各写一份，早晚会有一份忘了处理旧值。
 */
import { getDb } from './db'

export async function readSetting(key: string): Promise<string | null> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)
  return row?.value ?? null
}

export async function writeSetting(key: string, value: string): Promise<void> {
  const db = await getDb()
  await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value)
}
