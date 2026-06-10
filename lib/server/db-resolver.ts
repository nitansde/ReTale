import fs from 'node:fs'
import path from 'node:path'
import type * as NodeSqlite from 'node:sqlite'
import { CONTROL_SCHEMA_SQL } from '@/lib/server/schema'
import { initializeDatabase, openSqliteDatabase } from '@/lib/server/sqlite'

type DatabaseSync = NodeSqlite.DatabaseSync

const globalForDbResolver = globalThis as {
  __retaleResolvedDbs?: Map<string, DatabaseSync>
}

function getResolverCache() {
  if (!globalForDbResolver.__retaleResolvedDbs) {
    globalForDbResolver.__retaleResolvedDbs = new Map<string, DatabaseSync>()
  }

  return globalForDbResolver.__retaleResolvedDbs
}

function getDataRootPath() {
  const configuredBasePath = process.env.RETALE_DATA_DIR?.trim()
  if (configuredBasePath && configuredBasePath.length > 0) {
    return path.resolve(process.cwd(), configuredBasePath)
  }

  const isBuildPhase = process.env.npm_lifecycle_event === 'build'
    || process.env.NEXT_PHASE === 'phase-production-build'
    || process.env.__NEXT_PRIVATE_BUILD_WORKER === '1'

  return path.resolve(process.cwd(), isBuildPhase ? '.sisyphus/runtime/next-build-data' : 'data')
}

function assertContainedPath(basePath: string, candidatePath: string, label: string) {
  const relativePath = path.relative(basePath, candidatePath)
  if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
    return
  }

  throw new Error(`${label} resolves outside the configured data directory`)
}

function validateNovelId(novelId: string) {
  if (typeof novelId !== 'string') {
    throw new Error('Invalid novel ID: expected a string')
  }

  if (novelId.trim().length === 0) {
    throw new Error('Invalid novel ID: value cannot be blank')
  }

  if (novelId !== novelId.trim()) {
    throw new Error('Invalid novel ID: value cannot include leading or trailing whitespace')
  }

  if (novelId === '.' || novelId === '..') {
    throw new Error(`Invalid novel ID: "${novelId}" is not allowed`)
  }

  if (novelId.includes('/') || novelId.includes('\\')) {
    throw new Error(`Invalid novel ID: "${novelId}" cannot contain path separators`)
  }

  if (!/^[A-Za-z0-9._-]+$/.test(novelId)) {
    throw new Error(`Invalid novel ID: "${novelId}" contains unsupported characters`)
  }

  return novelId
}

function getCanonicalCacheKey(filePath: string) {
  const absolutePath = path.resolve(filePath)
  if (!fs.existsSync(absolutePath)) {
    return absolutePath
  }

  return fs.realpathSync.native(absolutePath)
}

function openResolvedDatabase(databasePath: string, options?: { schemaSql?: string; mode?: 'full' | 'control' }) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })

  const cacheKey = getCanonicalCacheKey(databasePath)
  const cache = getResolverCache()
  const cached = cache.get(cacheKey)
  if (cached) {
    return cached
  }

  const database = initializeDatabase(openSqliteDatabase(databasePath), options)
  cache.set(cacheKey, database)
  return database
}

function getNovelDirectory(novelId: string) {
  const stableNovelId = validateNovelId(novelId)
  const novelsRootPath = path.join(getDataRootPath(), 'novels')
  const novelDirectory = path.resolve(novelsRootPath, stableNovelId)
  assertContainedPath(novelsRootPath, novelDirectory, `Novel ID "${novelId}"`)
  return novelDirectory
}

export function getNovelLanceDbPath(novelId: string) {
  return path.join(getNovelDirectory(novelId), 'lancedb')
}

export function getNovelDb(novelId: string) {
  return openResolvedDatabase(path.join(getNovelDirectory(novelId), 'novel.db'))
}

export function getControlDb() {
  const dataRootPath = getDataRootPath()
  fs.mkdirSync(dataRootPath, { recursive: true })
  return openResolvedDatabase(path.join(dataRootPath, 'control.db'), {
    schemaSql: CONTROL_SCHEMA_SQL,
    mode: 'control',
  })
}

export function resetResolvedDatabasesForTests() {
  const cache = globalForDbResolver.__retaleResolvedDbs
  if (!cache) {
    return
  }

  for (const database of cache.values()) {
    try {
      ;(database as DatabaseSync & { close?: () => void }).close?.()
    } catch (_closeError) {
      void _closeError
      // Ignore close cleanup failures so test teardown can keep clearing the resolver cache.
    }
  }

  cache.clear()
  delete globalForDbResolver.__retaleResolvedDbs
}
