import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SCHEMA_SQL } from '@/lib/server/schema'

type SqlParam = string | number | bigint | Uint8Array | null

const globalForSqlite = globalThis as {
  sqlite?: DatabaseSync
}

function resolveDatabasePath(databaseUrl: string) {
  if (databaseUrl === ':memory:') return databaseUrl

  if (databaseUrl === 'file:./dev.db' || databaseUrl === './dev.db' || databaseUrl === 'dev.db') {
    return path.join(process.cwd(), 'dev.db')
  }

  if (databaseUrl.startsWith('file:')) {
    const rawPath = databaseUrl.slice('file:'.length)
    if (!rawPath || rawPath === ':memory:') {
      return ':memory:'
    }

    if (path.isAbsolute(rawPath)) {
      return rawPath
    }

    throw new Error(`Unsupported relative SQLite DATABASE_URL: ${databaseUrl}`)
  }

  if (path.isAbsolute(databaseUrl)) {
    return databaseUrl
  }

  throw new Error(`Unsupported SQLite DATABASE_URL: ${databaseUrl}`)
}

function createDatabase() {
  const filename = resolveDatabasePath(process.env.DATABASE_URL ?? 'file:./dev.db')
  const database = new DatabaseSync(filename)
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA busy_timeout = 5000')
  database.exec(SCHEMA_SQL)
  return database
}

export const sqlite = globalForSqlite.sqlite ?? createDatabase()

if (process.env.NODE_ENV !== 'production') {
  globalForSqlite.sqlite = sqlite
}

export function execute(sql: string, ...params: SqlParam[]) {
  return sqlite.prepare(sql).run(...params)
}

export function queryOne<T>(sql: string, ...params: SqlParam[]) {
  const row = sqlite.prepare(sql).get(...params)
  return (row ?? null) as T | null
}

export function queryAll<T>(sql: string, ...params: SqlParam[]) {
  return sqlite.prepare(sql).all(...params) as T[]
}

export async function withTransaction<T>(callback: () => T | Promise<T>) {
  execute('BEGIN IMMEDIATE')
  try {
    const result = await callback()
    execute('COMMIT')
    return result
  } catch (error) {
    try {
      execute('ROLLBACK')
    } catch {
    }
    throw error
  }
}

export type { SqlParam }
