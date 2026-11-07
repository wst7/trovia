/**
 * Migrating the database file when it is renamed.
 *
 * It deals only with paths, touches neither expo nor React Native, so it can be tested in Node with a fake filesystem.
 */
export const DB_NAME = 'trovia.db'
/** The database file before the rename. */
export const LEGACY_DB_NAME = 'xunji.db'

/** Only these two methods are used; they are pulled out so it can be tested in Node with a fake filesystem. */
export interface DbFileOps {
  exists(path: string): Promise<boolean>
  move(from: string, to: string): Promise<void>
}

/**
 * Move the old pre-rename database under the new name.
 *
 * The conditions are explicit: act only when the new database does not exist and the old one does. Move WAL mode's two side files along with it,
 * otherwise the part of the writes not yet flushed is lost.
 */
export async function moveLegacyDatabase(dir: string, ops: DbFileOps): Promise<boolean> {
  const next = `${dir}/${DB_NAME}`
  if (await ops.exists(next)) return false
  const legacy = `${dir}/${LEGACY_DB_NAME}`
  if (!(await ops.exists(legacy))) return false
  await ops.move(legacy, next)
  for (const suffix of ['-wal', '-shm']) {
    const from = `${legacy}${suffix}`
    if (await ops.exists(from)) await ops.move(from, `${next}${suffix}`)
  }
  return true
}
