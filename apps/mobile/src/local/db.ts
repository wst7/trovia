import * as SQLite from 'expo-sqlite'

/**
 * 本地数据库：收藏的唯一真相在手机上，不依赖任何服务器。
 *
 * 表结构刻意保留 updated_at / deleted_at：
 * 删除用墓碑而不是物理删除，条目 id 在设备内稳定，
 * 以后要做多端同步时可以直接按 updated_at 合并、按 deleted_at 传播删除。
 */
let opening: Promise<SQLite.SQLiteDatabase> | null = null

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!opening) opening = open()
  return opening
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('xunji.db')
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
  search_text       TEXT NOT NULL DEFAULT '',
  parse_status      TEXT NOT NULL DEFAULT 'pending',
  parse_stage       TEXT,
  parse_error_code  TEXT,
  saved_at          TEXT NOT NULL,
  last_parsed_at    TEXT,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  metadata          TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS documents_saved_at_idx
  ON documents (deleted_at, saved_at DESC);

-- 同一条链接只保留一条有效收藏；删除后（deleted_at 非空）可以重新收藏。
CREATE UNIQUE INDEX IF NOT EXISTS documents_url_active_idx
  ON documents (url) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`)

  // 轻量迁移：老库没有 images 列时补上（SQLite 没有 ADD COLUMN IF NOT EXISTS）。
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(documents)')
  if (!columns.some((column) => column.name === 'images')) {
    await db.runAsync("ALTER TABLE documents ADD COLUMN images TEXT NOT NULL DEFAULT '[]'")
  }

  // 上次进程在抓取/解析中途被杀掉时，这些行会一直停在非终态。
  // 本进程还没有开始处理任何条目，启动时把它们放回队列最安全。
  await db.runAsync(
    `UPDATE documents SET parse_status = 'pending', parse_stage = 'fetch', updated_at = ?
     WHERE deleted_at IS NULL AND parse_status IN ('fetching', 'parsing', 'analyzing')`,
    new Date().toISOString(),
  )
  return db
}

/** 测试与「清空数据」用：删掉所有收藏（保留表结构）。 */
export async function clearAllDocuments(): Promise<void> {
  const db = await getDb()
  await db.runAsync('DELETE FROM documents')
}
