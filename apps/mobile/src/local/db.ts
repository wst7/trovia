import * as FileSystem from 'expo-file-system/legacy'
import * as SQLite from 'expo-sqlite'

import { DOCUMENT_COLUMNS } from './db-columns'
import { DB_NAME, moveLegacyDatabase } from './db-migrate'

/**
 * Local database: the single source of truth for saved items lives on the phone, with no dependency on any server.
 *
 * The schema deliberately keeps updated_at / deleted_at:
 * deletion uses a tombstone rather than a physical delete, item ids are stable within the device,
 * and once multi-device sync is added, merging can go straight by updated_at and delete propagation by deleted_at.
 */
let opening: Promise<SQLite.SQLiteDatabase> | null = null

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!opening) opening = open()
  return opening
}


async function migrateLegacyDatabase(): Promise<void> {
  try {
    await moveLegacyDatabase(`${FileSystem.documentDirectory}SQLite`, {
      exists: async (path) => (await FileSystem.getInfoAsync(path)).exists,
      move: (from, to) => FileSystem.moveAsync({ from, to }),
    })
  } catch {
    // If it cannot be moved, treat it as if there were no old database: at least one failure will not keep the app from opening.
  }
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  await migrateLegacyDatabase()
  const db = await SQLite.openDatabaseAsync(DB_NAME)
  await db.execAsync(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
  id                TEXT PRIMARY KEY NOT NULL,
  url               TEXT NOT NULL,
  canonical_url     TEXT NOT NULL DEFAULT '',
  title             TEXT,
  site_name         TEXT,
  source_type       TEXT NOT NULL DEFAULT 'web',
  author            TEXT,
  published_at      TEXT,
  description       TEXT,
  summary_short     TEXT,
  summary_long      TEXT,
  keywords          TEXT NOT NULL DEFAULT '[]',
  topics            TEXT NOT NULL DEFAULT '[]',
  language          TEXT,
  content_markdown  TEXT,
  plain_text        TEXT,
  images            TEXT NOT NULL DEFAULT '[]',
  image_files       TEXT NOT NULL DEFAULT '[]',
  search_text       TEXT NOT NULL DEFAULT '',
  imported_at       TEXT,
  parse_status      TEXT NOT NULL DEFAULT 'pending',
  parse_stage       TEXT,
  parse_error_code  TEXT,
  saved_at          TEXT NOT NULL,
  last_parsed_at    TEXT,
  updated_at        TEXT NOT NULL,
  -- 每次写入 +1，同步用它区分「没变」和「两端都改了」。
  rev               INTEGER NOT NULL DEFAULT 1,
  deleted_at        TEXT,
  metadata          TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS documents_saved_at_idx
  ON documents (deleted_at, saved_at DESC);

-- 同一条链接只保留一条有效收藏；删除后（deleted_at 非空）可以重新收藏。
CREATE UNIQUE INDEX IF NOT EXISTS documents_url_active_idx
  ON documents (url) WHERE deleted_at IS NULL;

-- 语义检索用的向量：一篇一行，模型名与维度一起存，换模型后旧向量自动失效。
CREATE TABLE IF NOT EXISTS doc_vectors (
  document_id  TEXT PRIMARY KEY NOT NULL,
  model        TEXT NOT NULL,
  dim          INTEGER NOT NULL,
  vec          BLOB NOT NULL,
  updated_at   TEXT NOT NULL
);

-- 每台设备记住「上次同步时这条是哪个 rev」，三方比较的基准。
CREATE TABLE IF NOT EXISTS sync_base (
  doc_id TEXT PRIMARY KEY NOT NULL,
  rev    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`)

  /*
   * Lightweight migration: add the columns that “are in the CREATE TABLE statement but missing from an older database”.
   *
   * This one slipped through before — `imported_at` was only written in CREATE TABLE, an upgraded database did not have it,
   * so every save reported "table documents has no column named imported_at".
   * They are now kept as a list, so a missing one is an oversight you can see at a glance.
   */
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(documents)')
  const has = (name: string) => columns.some((column) => column.name === name)
  const ADDED_COLUMNS = DOCUMENT_COLUMNS
  for (const [name, definition] of ADDED_COLUMNS) {
    if (!has(name)) await db.runAsync(`ALTER TABLE documents ADD COLUMN ${name} ${definition}`)
  }

  // The sync baseline carries the remote file's etag: a file that has not changed does not have to be GET again.
  const baseColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(sync_base)')
  if (!baseColumns.some((column) => column.name === 'remote_etag')) {
    await db.runAsync('ALTER TABLE sync_base ADD COLUMN remote_etag TEXT')
  }
  // The rev used for sync: older databases get the column added, and a trigger increments it on every UPDATE,
  // so no write path (parsing, status, deletion) has to remember to bump rev itself.
  await db.runAsync(`
    CREATE TRIGGER IF NOT EXISTS documents_rev_bump
    AFTER UPDATE ON documents
    FOR EACH ROW
    WHEN NEW.rev = OLD.rev
    BEGIN
      UPDATE documents SET rev = OLD.rev + 1 WHERE id = OLD.id;
    END;
  `)

  // When the previous process was killed mid-fetch/parse, these rows stay stuck in a non-terminal state.
  // This process has not started on any item yet, so putting them back in the queue at startup is the safest move.
  await db.runAsync(
    `UPDATE documents SET parse_status = 'pending', parse_stage = 'fetch', updated_at = ?
     WHERE deleted_at IS NULL AND parse_status IN ('fetching', 'parsing', 'analyzing')`,
    new Date().toISOString(),
  )
  return db
}

/**
 * For tests and “clear data”: delete all saved items (keeping the schema).
 *
 * sync_base has to be deleted along with it. It records “this item has already been synced, and the baseline rev is which” —
 * delete only documents and leave it, and the next sync will believe those cloud items “already exist on this device”,
 * pull not a single one, and the UI will still say “both sides are already in sync” while the local store is actually empty.
 */
export async function clearAllDocuments(): Promise<void> {
  const db = await getDb()
  await db.runAsync('DELETE FROM documents')
  await db.runAsync('DELETE FROM sync_base')
  await db.runAsync('DELETE FROM doc_vectors')
}
