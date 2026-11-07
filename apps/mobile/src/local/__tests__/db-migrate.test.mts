/**
 * Moving things over when the database name changes. Uses a fake filesystem and never touches a real device.
 *
 * How to run: npx tsx apps/mobile/src/local/__tests__/db-migrate.test.mts
 */
import assert from 'node:assert/strict'

import { moveLegacyDatabase } from '../db-migrate.ts'

function fakeFs(files: string[]) {
  const set = new Set(files)
  const moved: string[] = []
  return {
    moved,
    set,
    ops: {
      exists: async (path: string) => set.has(path),
      move: async (from: string, to: string) => {
        assert.ok(set.has(from), `搬一个不存在的文件：${from}`)
        set.delete(from)
        set.add(to)
        moved.push(`${from} -> ${to}`)
      },
    },
  }
}

const DIR = '/data/SQLite'

// 1. Old database present, new one absent: move it over, including the WAL side files
{
  const fs = fakeFs([`${DIR}/xunji.db`, `${DIR}/xunji.db-wal`, `${DIR}/xunji.db-shm`])
  const done = await moveLegacyDatabase(DIR, fs.ops)
  assert.equal(done, true, '应该搬')
  assert.ok(fs.set.has(`${DIR}/trovia.db`), '新库文件应在')
  assert.ok(fs.set.has(`${DIR}/trovia.db-wal`), 'WAL 要跟着搬')
  assert.ok(fs.set.has(`${DIR}/trovia.db-shm`), 'SHM 要跟着搬')
  assert.equal([...fs.set].some((p) => p.includes('xunji')), false, '不该留下老名字的文件')
}

// 2. The new database already exists: leave it alone, so newer data is not overwritten
{
  const fs = fakeFs([`${DIR}/trovia.db`, `${DIR}/xunji.db`])
  const done = await moveLegacyDatabase(DIR, fs.ops)
  assert.equal(done, false, '新库存在就不该搬')
  assert.deepEqual(fs.moved, [])
  assert.ok(fs.set.has(`${DIR}/xunji.db`), '老文件原样留着，交给人工判断')
}

// 3. Only the new database: do nothing
{
  const fs = fakeFs([`${DIR}/trovia.db`])
  assert.equal(await moveLegacyDatabase(DIR, fs.ops), false)
  assert.deepEqual(fs.moved, [])
}

// 4. Neither one exists (a fresh install): do nothing
{
  const fs = fakeFs([])
  assert.equal(await moveLegacyDatabase(DIR, fs.ops), false)
  assert.deepEqual(fs.moved, [])
}

// 5. The old database has no side files (it was closed normally): move only the main file
{
  const fs = fakeFs([`${DIR}/xunji.db`])
  assert.equal(await moveLegacyDatabase(DIR, fs.ops), true)
  assert.deepEqual(fs.moved, [`${DIR}/xunji.db -> ${DIR}/trovia.db`])
}

console.log('moveLegacyDatabase：5 项断言通过')
