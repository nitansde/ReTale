import { AsyncLocalStorage } from 'node:async_hooks'
import type * as NodeSqlite from 'node:sqlite'
import { getNovelDb } from '@/lib/server/db-resolver'
import {
  execute as executeAgainstSingleton,
  queryAll as queryAllAgainstSingleton,
  queryOne as queryOneAgainstSingleton,
  runWithSqliteBusyRetry,
  type SqlParam,
  withTransaction as withSingletonTransaction,
} from '@/lib/server/sqlite'
import { runWithPerNovelWriteGate } from '@/lib/server/per-novel-write-gate'

type DatabaseSync = NodeSqlite.DatabaseSync

export type DatabaseAccess = {
  execute: typeof executeAgainstSingleton
  queryOne: typeof queryOneAgainstSingleton
  queryAll: typeof queryAllAgainstSingleton
  withTransaction: typeof withSingletonTransaction
}

type ExecuteLike = DatabaseAccess['execute']

const databaseAccessScope = new AsyncLocalStorage<DatabaseAccess>()

async function runImmediateTransaction<T>(execute: ExecuteLike, callback: () => T | Promise<T>) {
  execute('BEGIN IMMEDIATE')
  try {
    const result = await callback()
    execute('COMMIT')
    return result
  } catch (error) {
    try {
      execute('ROLLBACK')
    } catch (_rollbackError) {
      void _rollbackError
      // Ignore rollback cleanup failures so the original transaction error is rethrown.
    }
    throw error
  }
}

export async function withPerNovelWriteTransaction<T>(params: {
  novelId: string
  execute: ExecuteLike
  callback: () => T | Promise<T>
}) {
  return runWithPerNovelWriteGate(params.novelId, () => runImmediateTransaction(params.execute, params.callback))
}

export function createDatabaseAccess(database: DatabaseSync, options?: { novelId?: string }): DatabaseAccess {
  const execute: DatabaseAccess['execute'] = (sql, ...params) => (
    runWithSqliteBusyRetry(() => database.prepare(sql).run(...params))
  )

  const queryOne: DatabaseAccess['queryOne'] = <T>(sql: string, ...params: SqlParam[]) => {
    const row = runWithSqliteBusyRetry(() => database.prepare(sql).get(...params))
    return (row ?? null) as T | null
  }

  const queryAll: DatabaseAccess['queryAll'] = <T>(sql: string, ...params: SqlParam[]) => (
    runWithSqliteBusyRetry(() => database.prepare(sql).all(...params)) as T[]
  )

  const withTransaction: DatabaseAccess['withTransaction'] = async <T>(callback: () => T | Promise<T>) => {
    if (options?.novelId) {
      return withPerNovelWriteTransaction({
        novelId: options.novelId,
        execute,
        callback,
      })
    }

    return runImmediateTransaction(execute, callback)
  }

  return {
    execute,
    queryOne,
    queryAll,
    withTransaction,
  }
}

export function createNovelDatabaseAccess(novelId: string) {
  return createDatabaseAccess(getNovelDb(novelId), { novelId })
}

function getScopedDatabaseAccess() {
  return databaseAccessScope.getStore() ?? singletonDatabaseAccess
}

export function runWithDatabaseAccessScope<T>(db: DatabaseAccess, callback: () => T): T
export function runWithDatabaseAccessScope<T>(db: DatabaseAccess, callback: () => Promise<T>): Promise<T>
export function runWithDatabaseAccessScope<T>(db: DatabaseAccess, callback: () => T | Promise<T>) {
  return databaseAccessScope.run(db, callback)
}

export function runWithNovelDatabaseAccess<T>(novelId: string, callback: () => T): T
export function runWithNovelDatabaseAccess<T>(novelId: string, callback: () => Promise<T>): Promise<T>
export function runWithNovelDatabaseAccess<T>(novelId: string, callback: () => T | Promise<T>) {
  return runWithDatabaseAccessScope(createNovelDatabaseAccess(novelId), callback)
}

export const singletonDatabaseAccess: DatabaseAccess = {
  execute: executeAgainstSingleton,
  queryOne: queryOneAgainstSingleton,
  queryAll: queryAllAgainstSingleton,
  withTransaction: withSingletonTransaction,
}

export const execute: DatabaseAccess['execute'] = (sql, ...params) => getScopedDatabaseAccess().execute(sql, ...params)
export const queryOne: DatabaseAccess['queryOne'] = (sql, ...params) => getScopedDatabaseAccess().queryOne(sql, ...params)
export const queryAll: DatabaseAccess['queryAll'] = (sql, ...params) => getScopedDatabaseAccess().queryAll(sql, ...params)
export const withTransaction: DatabaseAccess['withTransaction'] = (callback) => getScopedDatabaseAccess().withTransaction(callback)

export type { SqlParam }
