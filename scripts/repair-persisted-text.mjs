import fs from 'node:fs'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { registerTypeScriptHooks } from './typescript-runtime.mjs'

const options = { database: '', novelId: '', apply: false, expectedRevision: null }
const args = process.argv.slice(2)
for (let index = 0; index < args.length; index++) {
  const argument = args[index]
  if (argument === '--apply') options.apply = true
  else if (argument === '--database' && args[index + 1]) options.database = args[++index]
  else if (argument === '--novel-id' && args[index + 1]) options.novelId = args[++index]
  else if (argument === '--expected-revision' && args[index + 1]) options.expectedRevision = Number(args[++index])
  else throw new Error(`Unknown or incomplete argument: ${argument}`)
}
if (!options.database || !options.novelId) {
  throw new Error('Usage: npm run storage:repair-text -- --database PATH --novel-id ID [--apply --expected-revision N]')
}
if (options.apply && (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0)) {
  throw new Error('--apply requires --expected-revision from the preview')
}
const databasePath = fs.realpathSync(options.database)
const { loadEnvConfig } = createRequire(import.meta.url)('@next/env')
loadEnvConfig(process.cwd(), true)
await registerTypeScriptHooks()
const { planPersistedTextRepair } = await import('@/lib/server/persisted-text-repair-plan')
const database = new DatabaseSync(databasePath, { readOnly: true })
let plan
try {
  database.exec('PRAGMA query_only = ON; BEGIN')
  const db = {
    queryOne: (sql, ...params) => database.prepare(sql).get(...params) ?? null,
    queryAll: (sql, ...params) => database.prepare(sql).all(...params),
  }
  plan = planPersistedTextRepair(db, options.novelId)
} finally { database.close() }

if (!options.apply) {
  console.log(JSON.stringify({ databasePath, readOnly: true, ...plan }, null, 2))
} else {
  // Apply only to the configured per-novel store. A copied database is previewable
  // anywhere, but must be selected through RETALE_DATA_DIR to use the app's resolver.
  const { getNovelStoragePaths } = await import('@/lib/server/db-resolver')
  const storage = getNovelStoragePaths(options.novelId)
  if (fs.realpathSync(storage.databasePath) !== databasePath) throw new Error('The specified database does not match the configured novel store; check RETALE_DATA_DIR')
  const { repairPersistedEntityText } = await import('@/lib/server/persisted-text-repair')
  const result = await repairPersistedEntityText(options.novelId, options.expectedRevision)
  console.log(JSON.stringify({ databasePath, readOnly: false, ...result }, null, 2))
}
