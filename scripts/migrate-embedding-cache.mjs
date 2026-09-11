import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { backfillEmbeddingVectorBatch, finalizeEmbeddingVectorMigration } from './embedding-cache-migration.mjs'
import { assertMaintenanceIdle } from './apply-storage-retention.mjs'

const args = process.argv.slice(2)
const options = { apply: false, retireJson: false, finalize: false, database: '', novelId: '', afterRowId: 0, limit: 100 }
for (let index = 0; index < args.length; index++) {
  const argument = args[index]
  if (argument === '--apply') options.apply = true
  else if (argument === '--retire-json') options.retireJson = true
  else if (argument === '--finalize') options.finalize = true
  else if (argument === '--database' && args[index + 1]) options.database = args[++index]
  else if (argument === '--novel-id' && args[index + 1]) options.novelId = args[++index]
  else if (argument === '--after-rowid' && args[index + 1]) options.afterRowId = Number(args[++index])
  else if (argument === '--limit' && args[index + 1]) options.limit = Number(args[++index])
  else throw new Error(`Unknown or incomplete argument: ${argument}`)
}
if (!options.database || !options.novelId) {
  throw new Error('Usage: npm run storage:migrate-vectors -- --database PATH --novel-id ID [--apply] [--retire-json] [--finalize] [--after-rowid N] [--limit 100]. Stop the server and back up before applying.')
}
if (options.retireJson && !options.apply) throw new Error('--retire-json requires --apply')
if (options.finalize && !options.apply) throw new Error('--finalize requires --apply')
if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 1000) throw new Error('--limit must be between 1 and 1000')
if (!Number.isSafeInteger(options.afterRowId) || options.afterRowId < 0) throw new Error('Invalid --after-rowid')
const database = new DatabaseSync(fs.realpathSync(options.database), { readOnly: !options.apply })
try {
  if (!database.prepare('SELECT id FROM NovelRecord WHERE id = ?').get(options.novelId)) throw new Error('Novel not found in the specified database')
  const columns = database.prepare('PRAGMA table_info(RawTextEmbeddingCache)').all()
  const hasBlob = columns.some((column) => column.name === 'vectorBlob')
  const hasJson = columns.some((column) => column.name === 'vectorJson')
  if (!options.apply) {
    database.exec('PRAGMA query_only = ON')
    console.log(JSON.stringify({
      readOnly: true,
      novelId: options.novelId,
      additiveSchemaNeeded: !hasBlob,
      schemaFinalized: !hasJson,
      ...(hasJson ? database.prepare(`SELECT COUNT(*) AS rows, SUM(octet_length(vectorJson)) AS jsonBytes,
        SUM(vectorDimension * 4) AS float32Bytes
        FROM RawTextEmbeddingCache WHERE branchId IN (SELECT id FROM StoryBranch WHERE novelId = ?)
          AND ${hasBlob ? "(vectorBlob IS NULL OR vectorJson != '[]')" : '1 = 1'}`).get(options.novelId) : { rows: 0, jsonBytes: 0, float32Bytes: 0 }),
      note: 'Estimate only; apply retention first. JSON is retained by default. Physical file compaction is separate.',
    }, null, 2))
  } else {
    database.exec('PRAGMA busy_timeout = 1000; BEGIN IMMEDIATE')
    try {
      assertMaintenanceIdle(database)
      if (!hasBlob) database.exec('ALTER TABLE RawTextEmbeddingCache ADD COLUMN vectorBlob BLOB')
      const result = hasJson ? backfillEmbeddingVectorBatch(database, options) : { scanned: 0, converted: 0, retired: 0, errors: [] }
      if (options.finalize) result.finalization = finalizeEmbeddingVectorMigration(database)
      database.exec('COMMIT')
      console.log(JSON.stringify({ novelId: options.novelId, ...result }, null, 2))
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
} finally {
  database.close()
}
