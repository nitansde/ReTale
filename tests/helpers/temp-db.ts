import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { initializeDatabase } from '@/lib/server/sqlite'
import {
  assertOwnedTestPath,
  createOwnedTestRoot,
  removeOwnedTestTree,
} from '../../scripts/test-path-safety.mjs'

function resolveOwnedSourceDatabase() {
  const testRoot = process.env.RETALE_TEST_ROOT
  const configuredSourcePath = process.env.RETALE_TEST_SOURCE_DB_PATH
  if (!testRoot || !configuredSourcePath) {
    throw new Error('Missing owned Vitest source database environment')
  }

  const sourceDbPath = assertOwnedTestPath(testRoot, path.resolve(process.cwd(), configuredSourcePath), {
    repoRoot: process.cwd(),
    label: 'Vitest source database',
  })
  const sourceStats = fs.statSync(sourceDbPath)
  if (!sourceStats.isFile()) {
    throw new Error(`Vitest source database is not a file: ${sourceDbPath}`)
  }

  return sourceDbPath
}

export function getSourceDbPath() {
  return resolveOwnedSourceDatabase()
}

export function hashFile(filePath: string) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

export function createTempDatabaseCopy(prefix: string, mode: 'full' | 'control' = 'full') {
  const sourceDbPath = resolveOwnedSourceDatabase()
  const sourceHashBefore = hashFile(sourceDbPath)
  const testRoot = process.env.RETALE_TEST_ROOT
  if (!testRoot) {
    throw new Error('Missing RETALE_TEST_ROOT')
  }

  const tempDir = createOwnedTestRoot(testRoot, `${prefix}-`, { repoRoot: process.cwd() })
  const dbPath = path.join(tempDir, 'test.db')
  fs.copyFileSync(sourceDbPath, dbPath)

  const database = initializeDatabase(new DatabaseSync(dbPath), { mode })
  ;(database as DatabaseSync & { close?: () => void }).close?.()

  if (hashFile(sourceDbPath) !== sourceHashBefore) {
    throw new Error(`Source database changed while creating test copy: ${sourceDbPath}`)
  }

  return {
    directory: tempDir,
    dbPath,
    cleanup() {
      removeOwnedTestTree(tempDir, testRoot, {
        repoRoot: process.cwd(),
        label: 'temporary test database directory',
      })
    },
  }
}
