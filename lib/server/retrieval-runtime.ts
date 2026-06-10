import path from 'node:path'
import * as lancedb from '@lancedb/lancedb'
import { getNovelLanceDbPath } from '@/lib/server/db-resolver'

export function getRetrievalDatabaseDir(novelId?: string) {
  if (novelId) {
    return getNovelLanceDbPath(novelId)
  }

  return process.env.LANCEDB_DIR?.trim() || path.join(process.cwd(), '.lancedb')
}

export async function connectRetrievalDatabase(novelId?: string) {
  return lancedb.connect(getRetrievalDatabaseDir(novelId))
}
