/**
 * 数据库文件改名时的搬迁。
 *
 * 只跟路径打交道，不碰 expo、不碰 React Native，所以能在 Node 里用假文件系统测。
 */
export const DB_NAME = 'trovia.db'
/** 改名前的库文件。 */
export const LEGACY_DB_NAME = 'xunji.db'

/** 只用到这两个方法，抽出来是为了能在 Node 里用假文件系统测。 */
export interface DbFileOps {
  exists(path: string): Promise<boolean>
  move(from: string, to: string): Promise<void>
}

/**
 * 把改名前的老库搬到新名字下。
 *
 * 条件很明确：新库不存在、老库存在才动。WAL 模式的两个旁路文件一起搬，
 * 否则会丢掉还没落盘的那部分写入。
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
