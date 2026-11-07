/**
 * 老库补列清单。
 *
 * 「建表语句里有、升级上来的库却没有」的列全写在这里，启动时按表检查补齐。
 * 这张清单漏过一项——imported_at——结果每次保存都报
 * `table documents has no column named imported_at`，用户只看到「保存没有完成」。
 *
 * 单独成文件是为了能被 node:sqlite 的测试直接跑一遍：新建一个老结构，
 * 应用这份清单，再按真实 INSERT 写一行，证明迁移真的补上了。
 */
export const DOCUMENT_COLUMNS: Array<[string, string]> = [
  ['canonical_url', "TEXT NOT NULL DEFAULT ''"],
  ['source_type', "TEXT NOT NULL DEFAULT 'web'"],
  ['published_at', 'TEXT'],
  ['keywords', "TEXT NOT NULL DEFAULT '[]'"],
  ['topics', "TEXT NOT NULL DEFAULT '[]'"],
  ['language', 'TEXT'],
  ['images', "TEXT NOT NULL DEFAULT '[]'"],
  ['image_files', "TEXT NOT NULL DEFAULT '[]'"],
  ['search_text', "TEXT NOT NULL DEFAULT ''"],
  ['imported_at', 'TEXT'],
  ['parse_error_code', 'TEXT'],
  ['last_parsed_at', 'TEXT'],
  ['rev', 'INTEGER NOT NULL DEFAULT 1'],
  ['deleted_at', 'TEXT'],
  ['metadata', "TEXT NOT NULL DEFAULT '{}'"],
]
