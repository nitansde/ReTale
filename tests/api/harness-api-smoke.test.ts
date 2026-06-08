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
  it('operates on a temp database without mutating the source test database', () => {
    const sourceDbPath = getSourceDbPath()
    const tempDatabase = createTempDatabaseCopy('retale-api-harness')
    cleanups.push(tempDatabase.cleanup)

    const copyHash = hashFile(tempDatabase.dbPath)
    expect(copyHash).toMatch(/^[a-f0-9]{64}$/)

    const database = new DatabaseSync(tempDatabase.dbPath)
    database.exec('CREATE TABLE IF NOT EXISTS temp_harness_check (id TEXT PRIMARY KEY)')
    database.exec("INSERT OR REPLACE INTO temp_harness_check (id) VALUES ('ok')")

    const row = database.prepare('SELECT id FROM temp_harness_check LIMIT 1').get() as { id: string } | undefined
    expect(row?.id).toBe('ok')

    const sourceDatabase = new DatabaseSync(sourceDbPath)
    const sourceTable = sourceDatabase.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'temp_harness_check'"
    ).get() as { name: string } | undefined
    ;(sourceDatabase as DatabaseSync & { close?: () => void }).close?.()
    expect(sourceTable).toBeUndefined()

    writeEvidenceFile(
      'test-db-integrity.txt',
      [`sourceDbPath=${sourceDbPath}`, `tempDbPath=${tempDatabase.dbPath}`, `tempDbHash=${copyHash}`].join('\n')
    )
  })
})
