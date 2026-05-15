import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { writeEvidenceFile } from '@/tests/helpers/evidence'
import { createTempDatabaseCopy, getSourceDbPath, hashFile } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('api harness temp database isolation', () => {
  it('operates on a temp database without mutating dev.db', () => {
    const sourceDbPath = getSourceDbPath()
    const originalHash = hashFile(sourceDbPath)
    const tempDatabase = createTempDatabaseCopy('chatbook-api-harness')
    cleanups.push(tempDatabase.cleanup)

    const copyHash = hashFile(tempDatabase.dbPath)
    expect(copyHash).toBe(originalHash)

    const database = new DatabaseSync(tempDatabase.dbPath)
    database.exec('CREATE TABLE IF NOT EXISTS temp_harness_check (id TEXT PRIMARY KEY)')
    database.exec("INSERT OR REPLACE INTO temp_harness_check (id) VALUES ('ok')")

    const row = database.prepare('SELECT id FROM temp_harness_check LIMIT 1').get() as { id: string } | undefined
    expect(row?.id).toBe('ok')
    expect(hashFile(sourceDbPath)).toBe(originalHash)

    writeEvidenceFile(
      'devdb-integrity.txt',
      [`sourceDbPath=${sourceDbPath}`, `tempDbPath=${tempDatabase.dbPath}`, `originalHash=${originalHash}`].join('\n')
    )
  })
})
