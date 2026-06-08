import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { SCHEMA_SQL } from '@/lib/server/schema'

const SOURCE_DB_PATH = path.resolve(
  process.cwd(),
  process.env.RETALE_TEST_SOURCE_DB_PATH ?? path.join('tests', '.runtime', 'test-db', 'vitest-source.db')
)

function ensureSourceDatabase() {
  fs.mkdirSync(path.dirname(SOURCE_DB_PATH), { recursive: true })
  const database = new DatabaseSync(SOURCE_DB_PATH)
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA busy_timeout = 5000')
  database.exec(SCHEMA_SQL)
  ;(database as DatabaseSync & { close?: () => void }).close?.()
}

export function getSourceDbPath() {
  ensureSourceDatabase()
  return SOURCE_DB_PATH
}

export function hashFile(filePath: string) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

export function createTempDatabaseCopy(prefix: string) {
  ensureSourceDatabase()

  if (!fs.existsSync(SOURCE_DB_PATH)) {
    throw new Error(`Missing source database: ${SOURCE_DB_PATH}`)
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  const dbPath = path.join(tempDir, 'test.db')
  fs.copyFileSync(SOURCE_DB_PATH, dbPath)

  return {
    directory: tempDir,
    dbPath,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true })
    },
  }
}
