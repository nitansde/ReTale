import type * as NodeSqlite from 'node:sqlite'
import {
  resetNovelDatabaseOverridesForTests,
  resetResolvedDatabasesForTests,
  setNovelDatabaseOverrideForTests,
} from '@/lib/server/db-resolver'

type DatabaseSync = NodeSqlite.DatabaseSync

export function registerLegacyNovelDatabase(database: DatabaseSync, novelIds: readonly string[]) {
  const disposers: Array<() => void> = []

  try {
    for (const novelId of new Set(novelIds)) {
      disposers.push(setNovelDatabaseOverrideForTests(novelId, database))
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) {
      dispose()
    }
    throw error
  }

  let disposed = false
  return () => {
    if (disposed) {
      return
    }
    disposed = true

    for (const dispose of disposers.reverse()) {
      dispose()
    }
  }
}

export function resetNovelDatabaseTestState() {
  resetNovelDatabaseOverridesForTests()
  resetResolvedDatabasesForTests()
}
