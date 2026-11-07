import * as FileSystem from 'expo-file-system/legacy'
import * as SQLite from 'expo-sqlite'

import { DB_NAME, moveLegacyDatabase } from './db-migrate'

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


async function migrateLegacyDatabase(): Promise<void> {
  try {
    await moveLegacyDatabase(`${FileSystem.documentDirectory}SQLite`, {
      exists: async (path) => (await FileSystem.getInfoAsync(path)).exists,
      move: (from, to) => FileSystem.moveAsync({ from, to }),
    })
  } catch {
    // 搬不动就当没有老库：至少不会因为一次失败打不开 App。
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

  // 轻量迁移：老库没有 images 列时补上（SQLite 没有 ADD COLUMN IF NOT EXISTS）。
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(documents)')
  if (!columns.some((column) => column.name === 'images')) {
    await db.runAsync("ALTER TABLE documents ADD COLUMN images TEXT NOT NULL DEFAULT '[]'")
  }
  // 同步基准带上远端文件的 etag：没变过的文件就不必再 GET 一遍。
  const baseColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(sync_base)')
  if (!baseColumns.some((column) => column.name === 'remote_etag')) {
    await db.runAsync('ALTER TABLE sync_base ADD COLUMN remote_etag TEXT')
  }
  // 同步用的 rev：老库补列，并用触发器在每次 UPDATE 时自增，
  // 这样所有写路径（解析、状态、删除）都不用各自记得改 rev。
  if (!columns.some((column) => column.name === 'rev')) {
    await db.runAsync('ALTER TABLE documents ADD COLUMN rev INTEGER NOT NULL DEFAULT 1')
  }
  await db.runAsync(`
    CREATE TRIGGER IF NOT EXISTS documents_rev_bump
    AFTER UPDATE ON documents
    FOR EACH ROW
    WHEN NEW.rev = OLD.rev
    BEGIN
      UPDATE documents SET rev = OLD.rev + 1 WHERE id = OLD.id;
    END;
  `)

  // 图片落盘后的本地路径，与 images 按下标对齐；空字符串表示这张没存下来。
  if (!columns.some((column) => column.name === 'image_files')) {
    await db.runAsync("ALTER TABLE documents ADD COLUMN image_files TEXT NOT NULL DEFAULT '[]'")
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

/**
 * 测试与「清空数据」用：删掉所有收藏（保留表结构）。
 *
 * sync_base 必须一起删。它记的是「这条已经同步过、基准 rev 是几」——
 * 只删 documents 而留着它，下次同步就会认为云端那些条目「本机已经有了」，
 * 一条都不拉，界面还显示「两端已经一致」，而本地其实是空的。
 */
export async function clearAllDocuments(): Promise<void> {
  const db = await getDb()
  await db.runAsync('DELETE FROM documents')
  await db.runAsync('DELETE FROM sync_base')
  await db.runAsync('DELETE FROM doc_vectors')
}
