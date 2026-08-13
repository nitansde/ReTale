import { AsyncLocalStorage } from 'node:async_hooks'
import type * as NodeSqlite from 'node:sqlite'
import { getControlDb, getCreatingNovelDb, getNovelDb } from '@/lib/server/db-resolver'
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

type SerializedDatabaseTransactionScope = {
  transactionKey: DatabaseTransactionKey
  active: boolean
  nestedTransactions: Set<Promise<unknown>>
  nestedFailures: unknown[]
}

type SerializedDatabaseTransactionQueue = {
  tail: Promise<void>
  pending: number
}

type DatabaseTransactionKey = object

type SerializedDatabaseTransactionState = {
  scope: AsyncLocalStorage<SerializedDatabaseTransactionScope>
  queues: WeakMap<DatabaseTransactionKey, SerializedDatabaseTransactionQueue>
  keyByDatabaseFile: Map<string, DatabaseTransactionKey>
  activeQueues: Set<SerializedDatabaseTransactionQueue>
}

const SERIALIZED_DATABASE_TRANSACTION_STATE = Symbol.for('retale.serialized-database-transaction-state-v3')
const globalForSerializedDatabaseTransactions = globalThis as typeof globalThis & {
  [SERIALIZED_DATABASE_TRANSACTION_STATE]?: SerializedDatabaseTransactionState
}
const serializedDatabaseTransactionState = globalForSerializedDatabaseTransactions[SERIALIZED_DATABASE_TRANSACTION_STATE] ??= {
  scope: new AsyncLocalStorage<SerializedDatabaseTransactionScope>(),
  queues: new WeakMap<DatabaseTransactionKey, SerializedDatabaseTransactionQueue>(),
  keyByDatabaseFile: new Map<string, DatabaseTransactionKey>(),
  activeQueues: new Set<SerializedDatabaseTransactionQueue>(),
}

function getDatabaseTransactionKey(database: DatabaseSync): DatabaseTransactionKey {
  const main = database.prepare('PRAGMA database_list').all().find((row) => (
    (row as { name?: unknown }).name === 'main'
  )) as { file?: unknown } | undefined
  const databaseFile = typeof main?.file === 'string' ? main.file : ''
  if (!databaseFile) return database

  let key = serializedDatabaseTransactionState.keyByDatabaseFile.get(databaseFile)
  if (!key) {
    key = {}
    serializedDatabaseTransactionState.keyByDatabaseFile.set(databaseFile, key)
  }
  return key
}

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

async function runSerializedDatabaseTransaction<T>(
  transactionKey: DatabaseTransactionKey,
  execute: ExecuteLike,
  callback: () => T | Promise<T>,
) {
  const inheritedScope = serializedDatabaseTransactionState.scope.getStore()
  if (inheritedScope?.active && inheritedScope.transactionKey === transactionKey) {
    const nestedTransaction = (async () => callback())()
    const observedNestedTransaction = nestedTransaction.catch((error) => {
      inheritedScope.nestedFailures.push(error)
    })
    inheritedScope.nestedTransactions.add(observedNestedTransaction)
    return nestedTransaction
  }

  let queue = serializedDatabaseTransactionState.queues.get(transactionKey)
  if (!queue) {
    queue = { tail: Promise.resolve(), pending: 0 }
    serializedDatabaseTransactionState.queues.set(transactionKey, queue)
  }
  serializedDatabaseTransactionState.activeQueues.add(queue)

  const previousTail = queue.tail.catch(() => undefined)
  let releaseCurrentTail!: () => void
  const currentTail = new Promise<void>((resolve) => {
    releaseCurrentTail = resolve
  })
  queue.pending += 1
  queue.tail = previousTail.then(() => currentTail)

  await previousTail
  const transactionScope: SerializedDatabaseTransactionScope = {
    transactionKey,
    active: true,
    nestedTransactions: new Set(),
    nestedFailures: [],
  }
  try {
    return await serializedDatabaseTransactionState.scope.run(
      transactionScope,
      async () => {
        let began = false
        try {
          execute('BEGIN IMMEDIATE')
          began = true
          let callbackResult!: T
          let callbackFailure: { error: unknown } | null = null
          try {
            callbackResult = await callback()
          } catch (error) {
            callbackFailure = { error }
          }
          await Promise.resolve()
          while (transactionScope.nestedTransactions.size > 0) {
            const pendingNestedTransactions = [...transactionScope.nestedTransactions]
            transactionScope.nestedTransactions.clear()
            await Promise.allSettled(pendingNestedTransactions)
          }
          if (callbackFailure) {
            throw callbackFailure.error
          }
          if (transactionScope.nestedFailures.length > 0) {
            throw transactionScope.nestedFailures[0]
          }
          transactionScope.active = false
          execute('COMMIT')
          began = false
          return callbackResult
        } catch (error) {
          transactionScope.active = false
          if (began) {
            try {
              execute('ROLLBACK')
            } catch (_rollbackError) {
              void _rollbackError
              // Ignore rollback cleanup failures so the original transaction error is rethrown.
            }
          }
          throw error
        } finally {
          transactionScope.active = false
        }
      },
    )
  } finally {
    queue.pending -= 1
    releaseCurrentTail()
    if (queue.pending === 0) {
      serializedDatabaseTransactionState.activeQueues.delete(queue)
    }
  }
}

function observeOutwardNestedTransaction<T>(
  transactionKey: DatabaseTransactionKey,
  transaction: Promise<T>,
) {
  const inheritedScope = serializedDatabaseTransactionState.scope.getStore()
  if (inheritedScope?.active && inheritedScope.transactionKey === transactionKey) {
    // The transaction runner observes its internal callback promise so the outer
    // transaction can roll back. Observe the exact promise returned to this
    // caller as well: async wrappers otherwise create a new rejected promise
    // that becomes unhandled when a nested transaction is intentionally voided.
    // Attaching a handler does not change the rejected state for callers that
    // await the original promise.
    void transaction.catch(() => undefined)
  }
  return transaction
}

export async function withPerNovelWriteTransaction<T>(params: {
  novelId: string
  execute: ExecuteLike
  callback: () => T | Promise<T>
  transactionKey?: DatabaseTransactionKey
}) {
  return runWithPerNovelWriteGate(params.novelId, () => runSerializedDatabaseTransaction(
    params.transactionKey ?? getDatabaseTransactionKey(getNovelDb(params.novelId)),
    params.execute,
    params.callback,
  ))
}

export function createDatabaseAccess(database: DatabaseSync, options?: {
  novelId?: string
  serializeTransactions?: boolean
  transactionKey?: DatabaseTransactionKey
}): DatabaseAccess {
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

  const withTransaction: DatabaseAccess['withTransaction'] = <T>(callback: () => T | Promise<T>) => {
    if (options?.novelId) {
      const transactionKey = options.transactionKey ?? getDatabaseTransactionKey(database)
      return observeOutwardNestedTransaction(transactionKey, withPerNovelWriteTransaction({
        novelId: options.novelId,
        execute,
        callback,
        transactionKey,
      }))
    }

    if (options?.serializeTransactions) {
      const transactionKey = options.transactionKey ?? getDatabaseTransactionKey(database)
      return observeOutwardNestedTransaction(
        transactionKey,
        runSerializedDatabaseTransaction(transactionKey, execute, callback),
      )
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

export function createCreatingNovelDatabaseAccess(novelId: string) {
  return createDatabaseAccess(getCreatingNovelDb(novelId), { novelId })
}

export function createControlDatabaseAccess() {
  const database = getControlDb()
  return createDatabaseAccess(database, {
    serializeTransactions: true,
    transactionKey: getDatabaseTransactionKey(database),
  })
}

export async function resetControlDatabaseTransactionQueueForTests() {
  const queues = Array.from(serializedDatabaseTransactionState.activeQueues)
  await Promise.all(queues.map((queue) => queue.tail.catch(() => undefined)))
  for (const queue of queues) {
    if (queue.pending !== 0) {
      throw new Error('Cannot reset the control database transaction queue while work is pending')
    }
    queue.tail = Promise.resolve()
    serializedDatabaseTransactionState.activeQueues.delete(queue)
  }
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
