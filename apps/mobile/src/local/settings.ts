/**
 * Key-value settings: stored in the SQLite settings table.
 *
 * These functions used to be private to sync-config, and auto-retry also needs to record "when it last tried",
 * so they moved to a shared place — with two modules each keeping a copy, sooner or later one of them forgets to handle old values.
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
