import type { DatabaseSync } from 'node:sqlite'
import { createDatabaseAccess, runWithDatabaseAccessScope, type DatabaseAccess } from '@/lib/server/database-access'
import { initializeDatabase, openSqliteDatabase } from '@/lib/server/sqlite'

/** File-owned connection selected explicitly by a test, with scope bounded to its callback. */
export function createScopedDatabaseFixture() {
  const fixture: { database?: DatabaseSync } = {}
  const accesses = new WeakMap<DatabaseSync, DatabaseAccess>()
  const access = () => {
    if (!fixture.database) throw new Error('This test must explicitly open or assign its database fixture')
    let db = accesses.get(fixture.database)
    if (!db) { db = createDatabaseAccess(fixture.database); accesses.set(fixture.database, db) }
    return db
  }
  const scoped: DatabaseAccess = {
    execute: (sql, ...params) => access().execute(sql, ...params),
    queryOne: (sql, ...params) => access().queryOne(sql, ...params),
    queryAll: (sql, ...params) => access().queryAll(sql, ...params),
    withTransaction: (callback) => access().withTransaction(callback),
  }
  return Object.assign(fixture, {
    open(filename: string) {
      fixture.database = initializeDatabase(openSqliteDatabase(filename))
      return { sqlite: fixture.database, ...access() }
    },
    close() {
      try { fixture.database?.close() } finally { delete fixture.database }
    },
    wrap<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
      return (...args: Args) => runWithDatabaseAccessScope(scoped, () => callback(...args))
    },
  })
}
