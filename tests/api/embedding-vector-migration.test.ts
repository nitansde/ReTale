import { backfillEmbeddingVectorBatch, finalizeEmbeddingVectorMigration } from '../../scripts/embedding-cache-migration.mjs'
import { SCHEMA_SQL } from '@/lib/server/schema'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatabaseAccess, runWithDatabaseAccessScope } from '@/lib/server/database-access'
import { decodeEmbeddingVector, encodeEmbeddingVector } from '@/lib/server/embedding-vector'
import { lookupRawTextEmbeddingCacheEntries, upsertRawTextEmbeddingCacheEntries } from '@/lib/server/retrieval-embedding-cache'
import { previewEmbeddingCacheRetention } from '@/lib/server/storage-retention'
import { DatabaseSchemaVersionError, initializeDatabase } from '@/lib/server/sqlite'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const connections: DatabaseSync[] = []
const scope = { novelId: 'vector', branchId: 'vector:main', provider: 'ollama', model: 'model' }

function fixture() {
  const database = initializeDatabase(new DatabaseSync(':memory:'))
  connections.push(database)
  database.exec(`
    INSERT INTO NovelRecord (id, title) VALUES ('vector', 'Vector'), ('other', 'Other');
    INSERT INTO StoryBranch (id, novelId, name) VALUES ('vector:main', 'vector', 'main'), ('other:main', 'other', 'main');
  `)
  database.exec('DROP TABLE RawTextEmbeddingCache')
  database.exec(SCHEMA_SQL.replace('vectorBlob BLOB NOT NULL,', 'vectorJson TEXT NOT NULL, vectorBlob BLOB,'))
  const db = createDatabaseAccess(database)
  const insert = (hash: string, json = '[0.1,-0.2,1]', dimension = 3, branch = 'vector:main') => database.prepare(`
    INSERT INTO RawTextEmbeddingCache (branchId, provider, model, embeddingInputHash, vectorJson, vectorDimension, lastSeenAt)
    VALUES (?, 'ollama', 'model', ?, ?, ?, '2026-01-01')
  `).run(branch, hash, json, dimension)
  return { database, db, insert }
}

afterEach(() => { for (const db of connections.splice(0)) db.close() })

describe('binary vector storage and explicit offline migration', () => {
  it('refuses an unmigrated database without rewriting its old values', () => {
    const { database, insert } = fixture()
    insert('legacy')
    expect(() => initializeDatabase(database)).toThrow(DatabaseSchemaVersionError)
    expect(database.prepare('SELECT vectorJson,vectorBlob FROM RawTextEmbeddingCache').get())
      .toEqual({ vectorJson: '[0.1,-0.2,1]', vectorBlob: null })
  })

  it('writes and reads binary vectors after vector finalization, before the separate schema cutover', async () => {
    const { database, db } = fixture()
    finalizeEmbeddingVectorMigration(database)
    expect(() => initializeDatabase(database)).toThrow(DatabaseSchemaVersionError)
    await runWithDatabaseAccessScope(db, async () => {
      await upsertRawTextEmbeddingCacheEntries({ scope, entries: [{ embeddingInput: 'new vector', vector: [0.1,0.2,1] }] })
    })
    expect(db.queryOne('SELECT LENGTH(vectorBlob) AS bytes FROM RawTextEmbeddingCache')).toEqual({ bytes: 12 })
    expect(previewEmbeddingCacheRetention(db, 'vector', []).totalBytes).toBe(12)
    const columns = database.prepare('PRAGMA table_info(RawTextEmbeddingCache)').all()
    expect(columns.map(column => column.name)).not.toContain('vectorJson')
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_raw_text_embedding_legacy_write'").all()).toEqual([])
  })

  it('backfills in bounded batches and retires JSON only after verified float32 round-trips', () => {
    const { database, insert } = fixture()
    insert('one')
    insert('two')
    insert('other', '[0.1,-0.2,1]', 3, 'other:main')
    const first = backfillEmbeddingVectorBatch(database, { novelId: 'vector', limit: 1 })
    expect(first).toMatchObject({ scanned: 1, converted: 1, retired: 0, errors: [] })
    const row = database.prepare('SELECT vectorJson, vectorBlob FROM RawTextEmbeddingCache WHERE embeddingInputHash = ?').get('one')!
    expect(row.vectorJson).toBe('[0.1,-0.2,1]')
    expect(decodeEmbeddingVector(row.vectorBlob as Uint8Array, 3)).toEqual([0.1, -0.2, 1].map(Math.fround))
    expect(backfillEmbeddingVectorBatch(database, { novelId: 'vector', afterRowId: first.nextRowId })).toMatchObject({ converted: 1 })
    expect(backfillEmbeddingVectorBatch(database, { novelId: 'vector', retireJson: true })).toMatchObject({ converted: 0, retired: 2 })
    expect(database.prepare("SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE vectorJson = '[]'").get()).toEqual({ count: 2 })
    expect(backfillEmbeddingVectorBatch(database, { novelId: 'vector', retireJson: true }).scanned).toBe(0)
  })

  it('retains invalid or conflicting JSON rows for inspection and advances the cursor', () => {
    const { database, insert } = fixture()
    insert('bad-json', '{broken')
    insert('bad-dimension', '[0.1]', 3)
    insert('overflow', '[1e40]', 1)
    insert('mismatch')
    database.prepare('UPDATE RawTextEmbeddingCache SET vectorBlob = ? WHERE embeddingInputHash = ?').run(encodeEmbeddingVector([1, 2, 3]), 'mismatch')
    const result = backfillEmbeddingVectorBatch(database, { novelId: 'vector', retireJson: true })
    expect(result).toMatchObject({ scanned: 4, converted: 0, retired: 0 })
    expect(result.errors).toHaveLength(4)
    expect(backfillEmbeddingVectorBatch(database, { novelId: 'vector', afterRowId: result.nextRowId }).scanned).toBe(0)
  })

  it('treats a corrupt binary vector as a cache miss', async () => {
    const { database, db, insert } = fixture()
    insert('corrupt')
    backfillEmbeddingVectorBatch(database, { novelId: 'vector', retireJson: true })
    finalizeEmbeddingVectorMigration(database)
    database.prepare('UPDATE RawTextEmbeddingCache SET vectorBlob = ?').run(new Uint8Array(1))
    const result = await runWithDatabaseAccessScope(db, () => lookupRawTextEmbeddingCacheEntries({ scope, embeddingInputHashes: ['corrupt'] }))
    expect(result).toEqual([])
    expect(database.prepare('SELECT COUNT(*) AS n FROM RawTextEmbeddingCache').get()).toEqual({ n: 0 })
  })

  it('rolls the migration back when the surrounding transaction fails', async () => {
    const { database, db, insert } = fixture()
    insert('rollback')
    await expect(db.withTransaction(() => {
      backfillEmbeddingVectorBatch(database, { novelId: 'vector', retireJson: true })
      throw new Error('injected failure')
    })).rejects.toThrow('injected failure')
    expect(database.prepare('SELECT vectorJson, vectorBlob FROM RawTextEmbeddingCache').get())
      .toEqual({ vectorJson: '[0.1,-0.2,1]', vectorBlob: null })
  })

  it('runs preview, bounded backfill, and finalization through the CLI on a legacy database', () => {
    const temp = createTempDatabaseCopy('vector-migration-cli')
    try {
      const db = initializeDatabase(new DatabaseSync(temp.dbPath))
      db.exec(`INSERT INTO NovelRecord (id, title) VALUES ('vector', 'Vector');
        INSERT INTO StoryBranch (id, novelId, name) VALUES ('vector:main', 'vector', 'main');
        ALTER TABLE RawTextEmbeddingCache RENAME COLUMN vectorBlob TO vectorJson;
        INSERT INTO RawTextEmbeddingCache (branchId, provider, model, embeddingInputHash, vectorJson, vectorDimension)
          VALUES ('vector:main', 'ollama', 'model', 'hash', '[0.1,0.2]', 2);`)
      db.close()
      const run = (...args: string[]) => JSON.parse(execFileSync(process.execPath, [
        '--experimental-strip-types', 'scripts/migrate-embedding-cache.mjs', '--database', temp.dbPath, '--novel-id', 'vector', ...args,
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
      expect(run()).toMatchObject({ readOnly: true, additiveSchemaNeeded: true, rows: 1, float32Bytes: 8 })
      expect(run('--apply')).toMatchObject({ scanned: 1, converted: 1, retired: 0 })
      expect(run('--apply', '--retire-json', '--finalize')).toMatchObject({ scanned: 1, converted: 0, retired: 1, finalization: { finalized: true, validated: 1 } })
      expect(run()).toMatchObject({ schemaFinalized: true, rows: 0 })
    } finally {
      temp.cleanup()
    }
  })
})
