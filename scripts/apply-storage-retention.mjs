import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
import { previewWorkspaceBackupRetention, previewEmbeddingCacheRetention } from '../lib/server/storage-retention.ts'

export function assertMaintenanceIdle(database) {
  if (database.prepare("SELECT 1 FROM KnowledgeJob WHERE status IN ('queued', 'running', 'paused') LIMIT 1").get()) {
    throw new Error('Stop or finish active/resumable jobs before offline maintenance')
  }
  if (database.prepare('SELECT 1 FROM WorkspaceKnowledgeSyncState WHERE startedRevision IS NOT NULL LIMIT 1').get()) {
    throw new Error('Finish or recover claimed workspace syncs before offline maintenance')
  }
}

export function createMaintenanceReader(database) {
  const columns = database.prepare('PRAGMA table_info(RawTextEmbeddingCache)').all()
  const hasJson = columns.some(column => column.name === 'vectorJson')
  const hasBlob = columns.some(column => column.name === 'vectorBlob')
  // Old formats are understood only by explicit offline tools.
  const payload = hasJson
    ? `octet_length(vectorJson)${hasBlob ? ' + COALESCE(octet_length(vectorBlob), 0)' : ''}`
    : 'octet_length(vectorBlob)'
  return { queryAll: (sql, ...params) => database.prepare(
    sql.replace('SUM(octet_length(vectorBlob))', `SUM(${payload})`),
  ).all(...params) }
}

export function applyStorageRetention(database, identities) {
  if (!identities.length) throw new Error('Specify the current embedding identity before applying retention')
  const transaction = callback => {
    database.exec('BEGIN IMMEDIATE')
    try { assertMaintenanceIdle(database); const value = callback(); database.exec('COMMIT'); return value }
    catch (error) { database.exec('ROLLBACK'); throw error }
  }
  const reader = createMaintenanceReader(database)
  const plans = transaction(() => ({
    backups: database.prepare('SELECT id FROM WorkspaceState').all().map(({ id }) => previewWorkspaceBackupRetention(reader, id)),
    caches: database.prepare('SELECT id FROM NovelRecord').all().map(({ id }) => previewEmbeddingCacheRetention(reader, id, identities)),
  }))
  let deletedBackups = 0
  let deletedVectors = 0
  for (const plan of plans.backups) {
    for (const row of plan.candidates) {
      deletedBackups += transaction(() => Number(database.prepare('DELETE FROM WorkspaceStateBackup WHERE id = ? AND workspaceStateId = ?').run(row.id, plan.workspaceStateId).changes))
    }
  }
  for (const plan of plans.caches) {
    for (const scope of plan.scopes.filter(scope => scope.eligible)) {
      let deleted
      do {
        deleted = transaction(() => Number(database.prepare(`DELETE FROM RawTextEmbeddingCache WHERE rowid IN (
          SELECT rowid FROM RawTextEmbeddingCache WHERE branchId = ? AND provider = ? AND model = ? AND lastSeenAt <= ? LIMIT 500
        )`).run(scope.branchId, scope.provider, scope.model, scope.lastSeenAt).changes))
        deletedVectors += deleted
      } while (deleted === 500)
    }
  }
  return { deletedBackups, deletedVectors, plans }
}

// The server and workers must stay stopped until this function completes.
export function compactDatabase(databasePath) {
  const temporaryPath = `${databasePath}.compact-${process.pid}`
  if (fs.existsSync(temporaryPath)) throw new Error('Compaction destination already exists')
  const beforeBytes = fs.statSync(databasePath).size
  const database = new DatabaseSync(databasePath)
  try {
    const checkpoint = database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()
    if (checkpoint.busy) throw new Error('Database is busy; stop all clients before compaction')
    database.exec('PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT')
    database.prepare('VACUUM INTO ?').run(temporaryPath)
    const compacted = new DatabaseSync(temporaryPath, { readOnly: true })
    try {
      if (compacted.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Compacted database failed integrity check')
      const beforeViolations = database.prepare('PRAGMA foreign_key_check').all()
      const afterViolations = compacted.prepare('PRAGMA foreign_key_check').all()
      if (JSON.stringify(beforeViolations) !== JSON.stringify(afterViolations)) throw new Error('Compaction changed foreign key integrity')
    } finally { compacted.close() }
  } finally { database.close() }
  if (fs.existsSync(`${databasePath}-wal`) || fs.existsSync(`${databasePath}-shm`)) {
    throw new Error('Database remains open; stop all clients before replacing the compacted file')
  }
  fs.chmodSync(temporaryPath, fs.statSync(databasePath).mode & 0o777)
  const fd = fs.openSync(temporaryPath, 'r')
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(temporaryPath, databasePath)
  const directory = fs.openSync(path.dirname(databasePath), 'r')
  try { fs.fsyncSync(directory) } finally { fs.closeSync(directory) }
  const afterBytes = fs.statSync(databasePath).size
  return { beforeBytes, afterBytes, reclaimedBytes: beforeBytes - afterBytes }
}

function main(args) {
  createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd(), true)
  let databasePath, apply = false, compact = false
  const identities = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--database' && args[index+1]) databasePath = fs.realpathSync(args[++index])
    else if (arg === '--protect-model' && args[index+1]) {
      const identity = args[++index], separator = identity.indexOf('=')
      if (separator < 1 || separator === identity.length-1) throw new Error('Expected provider=exact-model-identity')
      identities.push({ provider: identity.slice(0, separator), model: identity.slice(separator+1) })
    } else if (arg === '--apply') apply = true
    else if (arg === '--compact') compact = true
    else throw new Error(`Unknown or incomplete argument: ${arg}`)
  }
  if (!databasePath || !apply) throw new Error('Use storage:preview first; apply requires --database PATH --apply --protect-model provider=identity [--compact]. Stop the server and back up first.')
  const database = new DatabaseSync(databasePath)
  let result
  try { result = applyStorageRetention(database, identities) } finally { database.close() }
  if (compact) result.compaction = compactDatabase(databasePath)
  console.log(JSON.stringify(result, null, 2))
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2))
