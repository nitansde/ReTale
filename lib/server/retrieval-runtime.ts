import path from 'node:path'
import * as lancedb from '@lancedb/lancedb'

export function getRetrievalDatabaseDir() {
  return process.env.LANCEDB_DIR?.trim() || path.join(process.cwd(), '.lancedb')
}

export async function connectRetrievalDatabase() {
  return lancedb.connect(getRetrievalDatabaseDir())
}
