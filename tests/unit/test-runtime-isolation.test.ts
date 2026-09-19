import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertOwnedTestDatabaseUrl,
  assertOwnedTestPath,
  createOwnedTestRoot,
  removeOwnedTestTree,
  TEST_OWNERSHIP_MARKER,
} from '../../scripts/test-path-safety.mjs'
import { createTempDatabaseCopy, getSourceDbPath, hashFile } from '@/tests/helpers/temp-db'
import { createVitestFileRuntime, resolveTestWorkers } from '../../scripts/vitest-file-runtime.mjs'

const repoRoot = process.cwd()
const originalTestRoot = process.env.RETALE_TEST_ROOT
const originalSourceDbPath = process.env.RETALE_TEST_SOURCE_DB_PATH
const cleanupRoots: string[] = []

function fileHash(filePath: string) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function fileSnapshot(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return null
  }
  const stats = fs.statSync(filePath)
  return { size: stats.size, mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs }
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

function currentOwnedRoot() {
  const testRoot = process.env.RETALE_TEST_ROOT
  if (!testRoot) {
    throw new Error('Missing RETALE_TEST_ROOT')
  }
  return testRoot
}

function isolatedServerOverrideEnv(overrides: Record<string, string>) {
  const testRoot = currentOwnedRoot()
  const databasePath = path.join(testRoot, 'server-profile.db')
  return {
    ...process.env,
    RETALE_INTERNAL_ALLOW_TEST_OVERRIDES: '1',
    RETALE_SERVER_TEST_ROOT: testRoot,
    RETALE_SERVER_DATABASE_PATH: databasePath,
    RETALE_SERVER_DATABASE_URL: `file:${databasePath}`,
    RETALE_SERVER_DATA_DIR: path.join(testRoot, 'server-data'),
    RETALE_SERVER_DIST_DIR: path.relative(repoRoot, path.join(testRoot, 'server-next-dist')),
    RETALE_SERVER_TSCONFIG_PATH: path.relative(repoRoot, path.join(testRoot, 'server-tsconfig.json')),
    ...overrides,
  }
}

afterEach(() => {
  restoreEnv('RETALE_TEST_ROOT', originalTestRoot)
  restoreEnv('RETALE_TEST_SOURCE_DB_PATH', originalSourceDbPath)

  while (cleanupRoots.length > 0) {
    const cleanupRoot = cleanupRoots.pop()
    if (cleanupRoot) {
      removeOwnedTestTree(cleanupRoot, os.tmpdir(), { repoRoot })
    }
  }
})

describe('owned test runtime paths', () => {
  it('isolates actual concurrent test files, including module-time singleton access', () => {
    const suiteRoot = createOwnedTestRoot(currentOwnedRoot(), 'parallel-proof-', { repoRoot })
    try {
      const result = spawnSync(process.execPath, [
        'node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.ts',
        'tests/fixtures/vitest-isolation/first.test.mjs',
        'tests/fixtures/vitest-isolation/second.test.mjs',
      ], {
        cwd: repoRoot, encoding: 'utf8', timeout: 30_000,
        env: { ...process.env, RETALE_TEST_SUITE_ROOT: suiteRoot, RETALE_TEST_WORKERS: '2' },
      })
      expect(result.status, result.stdout + result.stderr).toBe(0)
      const first = JSON.parse(fs.readFileSync(path.join(suiteRoot, 'barrier', 'first.json'), 'utf8'))
      const second = JSON.parse(fs.readFileSync(path.join(suiteRoot, 'barrier', 'second.json'), 'utf8'))
      for (const key of ['testRoot', 'database', 'source', 'temp', 'evidence', 'pid']) {
        expect(first[key], key).not.toBe(second[key])
      }
    } finally {
      removeOwnedTestTree(suiteRoot, currentOwnedRoot(), { repoRoot })
    }
  }, 35_000)

  it('rejects an unowned suite before creating runtime files', () => {
    const unowned = path.join(currentOwnedRoot(), 'unowned-suite')
    expect(() => createVitestFileRuntime({ suiteRoot: unowned, testFile: 'example.test.ts', repoRoot })).toThrow(/ownership marker/)
    expect(fs.existsSync(unowned)).toBe(false)
  })

  it('defaults to two workers and permits bounded overrides including serial runs', () => {
    expect(resolveTestWorkers('')).toBe(2)
    expect(resolveTestWorkers('1')).toBe(1)
    expect(resolveTestWorkers('4')).toBe(4)
    for (const value of ['0', '9', '-1', '1.5', 'NaN', '2x']) {
      expect(() => resolveTestWorkers(value)).toThrow(/RETALE_TEST_WORKERS/)
    }
  })

  it('runs Vitest with explicit owned database, source, and data paths', () => {
    const testRoot = currentOwnedRoot()
    const databaseUrl = process.env.DATABASE_URL
    const sourceDbPath = process.env.RETALE_TEST_SOURCE_DB_PATH
    const dataDir = process.env.RETALE_DATA_DIR

    expect(databaseUrl).toBeTruthy()
    expect(sourceDbPath).toBeTruthy()
    expect(dataDir).toBeTruthy()
    expect(() => assertOwnedTestDatabaseUrl(testRoot, databaseUrl, { repoRoot })).not.toThrow()
    expect(() => assertOwnedTestPath(testRoot, sourceDbPath, { repoRoot })).not.toThrow()
    expect(() => assertOwnedTestPath(testRoot, dataDir, { repoRoot })).not.toThrow()
  })

  it('rejects repository dev.db and data paths before touching them', () => {
    const testRoot = currentOwnedRoot()
    const rootDatabasePath = path.join(repoRoot, 'dev.db')
    const rootDataPath = path.join(repoRoot, 'data')
    const databaseSnapshotBefore = fileSnapshot(rootDatabasePath)
    const dataMarkerExistedBefore = fs.existsSync(path.join(rootDataPath, TEST_OWNERSHIP_MARKER))

    expect(() => assertOwnedTestPath(testRoot, rootDatabasePath, {
      repoRoot,
      label: 'unsafe database',
    })).toThrow(/repository dev\.db/)
    expect(() => assertOwnedTestPath(testRoot, rootDataPath, {
      repoRoot,
      label: 'unsafe data directory',
    })).toThrow(/repository data directory/)

    expect(fileSnapshot(rootDatabasePath)).toEqual(databaseSnapshotBefore)
    expect(fs.existsSync(path.join(rootDataPath, TEST_OWNERSHIP_MARKER))).toBe(dataMarkerExistedBefore)
  })

  it('rejects an inherited source outside the active owned root without mutating it', () => {
    const outerRoot = createOwnedTestRoot(os.tmpdir(), 'retale-unsafe-source-', { repoRoot })
    cleanupRoots.push(outerRoot)
    const activeRoot = createOwnedTestRoot(outerRoot, 'active-', { repoRoot })
    const unsafeSourcePath = path.join(outerRoot, 'unsafe-source.db')
    fs.writeFileSync(unsafeSourcePath, 'source-sentinel')
    const sourceHashBefore = fileHash(unsafeSourcePath)

    process.env.RETALE_TEST_ROOT = activeRoot
    process.env.RETALE_TEST_SOURCE_DB_PATH = unsafeSourcePath

    expect(() => getSourceDbPath()).toThrow(/inside the owned test root/)
    expect(fileHash(unsafeSourcePath)).toBe(sourceHashBefore)
  })

  it('initializes only the copied target and leaves source bytes unchanged', () => {
    const sourceDbPath = getSourceDbPath()
    const sourceStatsBefore = fs.statSync(sourceDbPath)
    const sourceHashBefore = hashFile(sourceDbPath)
    const tempDatabase = createTempDatabaseCopy('retale-source-immutable')

    expect(() => assertOwnedTestPath(currentOwnedRoot(), tempDatabase.dbPath, {
      repoRoot,
      label: 'temporary database copy',
    })).not.toThrow()

    try {
      const database = new DatabaseSync(tempDatabase.dbPath)
      const workspaceTable = database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'WorkspaceState'"
      ).get() as { name?: string } | undefined
      database.exec('CREATE TABLE copy_only_sentinel (id TEXT PRIMARY KEY)')
      database.close()

      expect(workspaceTable?.name).toBe('WorkspaceState')
      expect(hashFile(sourceDbPath)).toBe(sourceHashBefore)
      expect(fs.statSync(sourceDbPath).size).toBe(sourceStatsBefore.size)
      expect(fs.statSync(sourceDbPath).mtimeMs).toBe(sourceStatsBefore.mtimeMs)
    } finally {
      tempDatabase.cleanup()
    }
  })

  it('forces dev:test data under its marked test root on port 3000', () => {
    const cleanEnv = { ...process.env }
    delete cleanEnv.RETALE_INTERNAL_ALLOW_TEST_OVERRIDES
    const output = execFileSync(process.execPath, ['scripts/next-test-server.mjs', '--print-config'], {
      cwd: repoRoot,
      env: cleanEnv,
      encoding: 'utf8',
    })
    const config = JSON.parse(output) as {
      port: number
      databaseUrl: string
      dataDir: string
      databasePath: string
    }
    const serverTestRoot = path.join(repoRoot, 'tests', 'artifacts', 'runtime', 'test-server')

    expect(config.port).toBe(3000)
    expect(() => assertOwnedTestPath(serverTestRoot, config.databasePath, { repoRoot })).not.toThrow()
    expect(() => assertOwnedTestPath(serverTestRoot, config.dataDir, { repoRoot })).not.toThrow()
    expect(() => assertOwnedTestDatabaseUrl(serverTestRoot, config.databaseUrl, { repoRoot })).not.toThrow()
    expect(path.resolve(config.dataDir)).not.toBe(path.join(repoRoot, 'data'))
  })

  it('rejects unsafe test-server database and data overrides before startup', () => {
    const rootDatabasePath = path.join(repoRoot, 'dev.db')
    const rootDataPath = path.join(repoRoot, 'data')
    const databaseSnapshotBefore = fileSnapshot(rootDatabasePath)
    const unsafeDatabase = spawnSync(process.execPath, ['scripts/next-test-server.mjs', '--print-config'], {
      cwd: repoRoot,
      env: isolatedServerOverrideEnv({
        RETALE_SERVER_DATABASE_PATH: rootDatabasePath,
        RETALE_SERVER_DATABASE_URL: `file:${rootDatabasePath}`,
      }),
      encoding: 'utf8',
    })
    const unsafeData = spawnSync(process.execPath, ['scripts/next-test-server.mjs', '--print-config'], {
      cwd: repoRoot,
      env: isolatedServerOverrideEnv({ RETALE_SERVER_DATA_DIR: rootDataPath }),
      encoding: 'utf8',
    })

    expect(unsafeDatabase.status).not.toBe(0)
    expect(unsafeDatabase.stderr).toMatch(/repository dev\.db/)
    expect(unsafeData.status).not.toBe(0)
    expect(unsafeData.stderr).toMatch(/repository data directory/)
    expect(fileSnapshot(rootDatabasePath)).toEqual(databaseSnapshotBefore)
  })

  it('allocates production freshness paths inside a marker-owned test artifact root', () => {
    const output = execFileSync(process.execPath, ['scripts/verify-production-freshness.mjs', '--print-config'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    const config = JSON.parse(output) as {
      testRoot: string
      databasePath: string
      databaseUrl: string
      dataDir: string
      distPath: string
    }
    const productionSmokeRunsRoot = path.join(repoRoot, 'tests', 'artifacts', 'runtime', 'production-smoke-runs')

    try {
      expect(() => assertOwnedTestPath(config.testRoot, config.databasePath, { repoRoot })).not.toThrow()
      expect(() => assertOwnedTestDatabaseUrl(config.testRoot, config.databaseUrl, { repoRoot })).not.toThrow()
      expect(() => assertOwnedTestPath(config.testRoot, config.dataDir, { repoRoot })).not.toThrow()
      expect(() => assertOwnedTestPath(config.testRoot, config.distPath, { repoRoot })).not.toThrow()
      expect(path.resolve(config.databasePath)).not.toBe(path.join(repoRoot, 'dev.db'))
      expect(path.resolve(config.dataDir)).not.toBe(path.join(repoRoot, 'data'))
    } finally {
      removeOwnedTestTree(config.testRoot, productionSmokeRunsRoot, { repoRoot })
    }
  })
})
