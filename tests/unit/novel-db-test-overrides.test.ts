import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getControlDb,
  getNovelDb,
  getNovelLanceDbPath,
  setNovelDatabaseOverrideForTests,
} from '@/lib/server/db-resolver'
import { registerNovelDatabaseFixture, resetNovelDatabaseTestState } from '@/tests/helpers/novel-db'
import { createOwnedTestRoot, removeOwnedTestTree } from '../../scripts/test-path-safety.mjs'


const repoRoot = process.cwd()
const suiteTestRoot = process.env.RETALE_TEST_ROOT ?? ''
const originalVitest = process.env.VITEST
const originalDataDir = process.env.RETALE_DATA_DIR
const databases: DatabaseSync[] = []
let containerRoot = ''
let activeTestRoot = ''

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

function databaseFile(database: DatabaseSync) {
  const rows = database.prepare('PRAGMA database_list').all() as Array<{ name: string; file: string }>
  return rows.find((row) => row.name === 'main')?.file ?? ''
}

function openDatabase(fileName: string, root = activeTestRoot) {
  const databasePath = path.join(root, fileName)
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  const database = new DatabaseSync(databasePath)
  databases.push(database)
  return database
}

beforeEach(() => {
  if (!suiteTestRoot) {
    throw new Error('Missing RETALE_TEST_ROOT')
  }

  containerRoot = createOwnedTestRoot(suiteTestRoot, 'novel-db-overrides-', { repoRoot })
  activeTestRoot = createOwnedTestRoot(containerRoot, 'active-', { repoRoot })
  process.env.VITEST = 'true'
  process.env.RETALE_TEST_ROOT = activeTestRoot
  process.env.RETALE_DATA_DIR = path.join(activeTestRoot, 'resolver-data')
})

afterEach(() => {
  resetNovelDatabaseTestState()

  while (databases.length > 0) {
    const database = databases.pop()
    try {
      database?.close()
    } catch (_error) {
      void _error
      // Ignore secondary SQLite close failures so teardown can continue.
    }
  }

  restoreEnv('VITEST', originalVitest)
  restoreEnv('RETALE_TEST_ROOT', suiteTestRoot || undefined)
  restoreEnv('RETALE_DATA_DIR', originalDataDir)

  if (containerRoot) {
    removeOwnedTestTree(containerRoot, suiteTestRoot, {
      repoRoot,
      label: 'novel database override test container',
    })
  }
})

describe('novel database test overrides', () => {
  it('requires the exact Vitest environment flag', () => {
    const database = openDatabase('vitest-guard.db')
    process.env.VITEST = '1'

    expect(() => setNovelDatabaseOverrideForTests('novel-alpha', database)).toThrow(/VITEST is true/)
    expect(getNovelDb('novel-alpha')).not.toBe(database)
  })

  it('requires a marker-valid RETALE_TEST_ROOT', () => {
    const database = openDatabase('owned.db')
    delete process.env.RETALE_TEST_ROOT
    expect(() => setNovelDatabaseOverrideForTests('novel-alpha', database)).toThrow(/RETALE_TEST_ROOT/)

    const unmarkedRoot = path.join(containerRoot, 'unmarked-root')
    fs.mkdirSync(unmarkedRoot)
    process.env.RETALE_TEST_ROOT = unmarkedRoot
    expect(() => setNovelDatabaseOverrideForTests('novel-alpha', database)).toThrow(/ownership marker/)
  })

  it('rejects in-memory and outside-root databases', () => {
    const memoryDatabase = new DatabaseSync(':memory:')
    databases.push(memoryDatabase)
    const outsideDatabase = openDatabase('outside.db', containerRoot)

    expect(() => setNovelDatabaseOverrideForTests('novel-memory', memoryDatabase)).toThrow(/file-backed/)
    expect(() => setNovelDatabaseOverrideForTests('novel-outside', outsideDatabase)).toThrow(/inside the owned test root/)
  })

  it('rejects a database reached through a symlink escape', () => {
    const targetDatabase = openDatabase('outside-target.db', containerRoot)
    targetDatabase.close()
    databases.splice(databases.indexOf(targetDatabase), 1)

    const symlinkPath = path.join(activeTestRoot, 'escaped-link.db')
    fs.symlinkSync(path.join(containerRoot, 'outside-target.db'), symlinkPath)
    const linkedDatabase = new DatabaseSync(symlinkPath)
    databases.push(linkedDatabase)

    expect(() => setNovelDatabaseOverrideForTests('novel-symlink', linkedDatabase)).toThrow(/inside the owned test root/)
  })

  it('validates exact novel IDs before registration and lookup', () => {
    const database = openDatabase('invalid-id.db')

    expect(() => setNovelDatabaseOverrideForTests('../novel-alpha', database)).toThrow(/Invalid novel ID/)
    expect(() => getNovelDb(' novel-alpha')).toThrow(/Invalid novel ID/)
  })

  it('routes only the registered exact key and never uses an unregistered connection', () => {
    const database = openDatabase('override.db')
    setNovelDatabaseOverrideForTests('novel-alpha', database)

    const alphaDatabase = getNovelDb('novel-alpha')
    const betaDatabase = getNovelDb('novel-beta')

    expect(alphaDatabase).toBe(database)
    expect(betaDatabase).not.toBe(database)
    expect(path.resolve(databaseFile(betaDatabase))).toBe(
      path.join(activeTestRoot, 'resolver-data', 'novels', 'novel-beta', 'novel.db')
    )
  })

  it('rejects replacing an exact key with a different connection', () => {
    const firstDatabase = openDatabase('first.db')
    const secondDatabase = openDatabase('second.db')
    setNovelDatabaseOverrideForTests('novel-alpha', firstDatabase)

    expect(() => setNovelDatabaseOverrideForTests('novel-alpha', secondDatabase)).toThrow(/already registered/)
    expect(getNovelDb('novel-alpha')).toBe(firstDatabase)
  })

  it('returns an idempotent disposer that restores normal routing', () => {
    const database = openDatabase('disposable.db')
    const dispose = setNovelDatabaseOverrideForTests('novel-alpha', database)

    dispose()
    dispose()

    const resolvedDatabase = getNovelDb('novel-alpha')
    expect(resolvedDatabase).not.toBe(database)
    expect(path.resolve(databaseFile(resolvedDatabase))).toBe(
      path.join(activeTestRoot, 'resolver-data', 'novels', 'novel-alpha', 'novel.db')
    )
  })

  it('resets registrations without closing externally owned connections', () => {
    const database = openDatabase('reset.db')
    setNovelDatabaseOverrideForTests('novel-alpha', database)

    resetNovelDatabaseTestState()

    expect(database.prepare('SELECT 1 AS value').get()).toEqual({ value: 1 })
    expect(getNovelDb('novel-alpha')).not.toBe(database)
  })

  it('leaves control database and LanceDB routing untouched', () => {
    const database = openDatabase('novel-only.db')
    setNovelDatabaseOverrideForTests('novel-alpha', database)

    const controlDatabase = getControlDb()

    expect(controlDatabase).not.toBe(database)
    expect(path.resolve(databaseFile(controlDatabase))).toBe(
      path.join(activeTestRoot, 'resolver-data', 'control.db')
    )
    expect(getNovelLanceDbPath('novel-alpha')).toBe(
      path.join(activeTestRoot, 'resolver-data', 'novels', 'novel-alpha', 'lancedb')
    )
  })

  it('deduplicates shared registrations and rolls back partial failures', () => {
    const database = openDatabase('legacy-helper.db')
    const dispose = registerNovelDatabaseFixture(database, ['novel-alpha', 'novel-alpha', 'novel-gamma'])
    expect(getNovelDb('novel-alpha')).toBe(database)
    expect(getNovelDb('novel-gamma')).toBe(database)
    dispose()
    dispose()
    expect(getNovelDb('novel-alpha')).not.toBe(database)
    expect(getNovelDb('novel-gamma')).not.toBe(database)

    expect(() => registerNovelDatabaseFixture(database, ['novel-beta', '../invalid'])).toThrow(/Invalid novel ID/)
    expect(getNovelDb('novel-beta')).not.toBe(database)
  })
})
