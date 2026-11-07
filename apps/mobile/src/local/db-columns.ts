/**
 * The list of columns backfilled into old databases.
 *
 * Every column that exists in the CREATE TABLE statement but is missing from an upgraded database is listed here, and is added per table at startup.
 * This list once missed one entry — imported_at — and every save then reported
 * `table documents has no column named imported_at`, while the user only saw "the save did not finish".
 *
 * It lives in its own file so a node:sqlite test can run it directly: create the old schema,
 * apply this list, then write a row with the real INSERT, proving the migration really backfills it.
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
