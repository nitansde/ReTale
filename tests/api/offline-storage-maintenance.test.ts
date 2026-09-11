import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { applyStorageRetention, compactDatabase } from '../../scripts/apply-storage-retention.mjs'
import { backfillEmbeddingVectorBatch, finalizeEmbeddingVectorMigration } from '../../scripts/embedding-cache-migration.mjs'
import { migrateProgressText, migrateStoredProgress } from '../../scripts/progress-message-migration.mjs'
import { progressZhMessages } from '@/lib/i18n/progress-messages'
import { initializeDatabase } from '@/lib/server/sqlite'
import { decodeEmbeddingVector } from '@/lib/server/embedding-vector'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const connections: DatabaseSync[] = []
function fixture() {
  const database = initializeDatabase(new DatabaseSync(':memory:'))
  connections.push(database)
  database.exec(`
    INSERT INTO NovelRecord (id,title) VALUES ('novel','Novel');
    INSERT INTO StoryBranch (id,novelId,name) VALUES ('novel:main','novel','main');
    DROP TABLE RawTextEmbeddingCache;
    CREATE TABLE RawTextEmbeddingCache (branchId TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
      embeddingInputHash TEXT NOT NULL, vectorJson TEXT NOT NULL, vectorBlob BLOB, vectorDimension INTEGER NOT NULL,
      lastSeenAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(branchId,provider,model,embeddingInputHash),
      FOREIGN KEY(branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE);
    INSERT INTO RawTextEmbeddingCache (branchId,provider,model,embeddingInputHash,vectorJson,vectorDimension,lastSeenAt)
      VALUES ('novel:main','provider','old','old','[0.1,0.2]',2,'2026-01-01'),
      ('novel:main','provider','current','current','[0.3,0.4]',2,'2026-01-01');
  `)
  return database
}
afterEach(() => { for (const db of connections.splice(0)) db.close() })

describe('explicit offline storage maintenance', () => {
  it('retains the current model, verifies conversion, and removes the JSON column', () => {
    const database = fixture()
    expect(applyStorageRetention(database, [{ provider: 'provider', model: 'current' }])).toMatchObject({ deletedVectors: 1 })
    database.exec('BEGIN IMMEDIATE')
    expect(backfillEmbeddingVectorBatch(database, { novelId: 'novel', retireJson: true })).toMatchObject({ converted: 1, retired: 1, errors: [] })
    expect(finalizeEmbeddingVectorMigration(database)).toEqual({ finalized: true, validated: 1 })
    database.exec('COMMIT')
    expect(database.prepare('PRAGMA table_info(RawTextEmbeddingCache)').all().map(row => row.name)).not.toContain('vectorJson')
    const row = database.prepare('SELECT vectorBlob,vectorDimension FROM RawTextEmbeddingCache').get()!
    expect(decodeEmbeddingVector(row.vectorBlob as Uint8Array, row.vectorDimension as number)).toEqual([0.3,0.4].map(Math.fround))
    expect(finalizeEmbeddingVectorMigration(database)).toEqual({ finalized: false, validated: 1 })
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('refuses active work and preserves every row', () => {
    const database = fixture()
    database.exec("INSERT INTO KnowledgeJob (id,novelId,jobType,status) VALUES ('job','novel','extract_chapter_knowledge','paused')")
    expect(() => applyStorageRetention(database, [{ provider: 'provider', model: 'current' }])).toThrow('active/resumable')
    expect(database.prepare('SELECT COUNT(*) AS n FROM RawTextEmbeddingCache').get()).toEqual({ n: 2 })
  })

  it('refuses finalization until all JSON has been verified and rolls table replacement back', () => {
    const database = fixture()
    expect(() => finalizeEmbeddingVectorMigration(database)).toThrow('Retire every JSON')
    database.exec('BEGIN IMMEDIATE')
    backfillEmbeddingVectorBatch(database, { novelId: 'novel', retireJson: true })
    finalizeEmbeddingVectorMigration(database)
    database.exec('ROLLBACK')
    expect(database.prepare('SELECT vectorJson, vectorBlob FROM RawTextEmbeddingCache WHERE model = ?').get('old'))
      .toEqual({ vectorJson: '[0.1,0.2]', vectorBlob: null })
  })

  it('migrates known progress templates once and leaves custom diagnostics untouched', () => {
    const database = fixture()
    database.prepare('INSERT INTO KnowledgeJob (id,novelId,jobType,status,currentStep,payloadJson) VALUES (?,?,?,?,?,?)')
      .run('job','novel','extract_chapter_knowledge','succeeded',progressZhMessages['progress.completed'],'{"prompt":"知识库重建完成"}')
    for (const template of Object.values(progressZhMessages)) {
      const text = template.replace(/\{\{\w+\}\}/gu,'7')
      expect(migrateProgressText(text)).toMatch(/^@retale-progress:/)
      expect(migrateProgressText(migrateProgressText(text))).toBe(migrateProgressText(text))
    }
    expect(migrateProgressText('Custom diagnostic')).toBe('Custom diagnostic')
    const before = database.prepare('SELECT payloadJson FROM KnowledgeJob').get()
    expect(migrateStoredProgress(database)).toBe(1)
    expect(migrateStoredProgress(database)).toBe(0)
    expect(database.prepare('SELECT payloadJson FROM KnowledgeJob').get()).toEqual(before)
  })

  it('previews and migrates stored step labels through the CLI without changing prompt data', () => {
    const temp = createTempDatabaseCopy('progress-migration-cli')
    try {
      const database = new DatabaseSync(temp.dbPath)
      database.exec("INSERT INTO NovelRecord(id,title) VALUES ('progress','Progress')")
      const payload = { prompt: progressZhMessages['progress.completed'], steps: [{ key: 'extract', label: progressZhMessages['progress.extract'], detail: 'Custom diagnostic' }] }
      database.prepare('INSERT INTO KnowledgeJob(id,novelId,jobType,status,currentStep,payloadJson) VALUES (?,?,?,?,?,?)')
        .run('job','progress','extract_chapter_knowledge','succeeded',progressZhMessages['progress.completed'],JSON.stringify(payload))
      database.close()
      const hash = () => createHash('sha256').update(fs.readFileSync(temp.dbPath)).digest('hex')
      const before = hash()
      const run = (...args: string[]) => JSON.parse(execFileSync(process.execPath, [
        '--experimental-strip-types','scripts/progress-message-migration.mjs','--database',temp.dbPath,...args,
      ], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }))
      expect(run()).toEqual({ readOnly: true, candidateJobs: 1 })
      expect(hash()).toBe(before)
      expect(run('--apply')).toEqual({ readOnly: false, changedJobs: 1 })
      expect(run('--apply')).toEqual({ readOnly: false, changedJobs: 0 })
      const check = new DatabaseSync(temp.dbPath, { readOnly: true })
      try {
        const row = check.prepare('SELECT currentStep,payloadJson FROM KnowledgeJob').get()!
        expect(row.currentStep).toMatch(/^@retale-progress:/)
        const migrated = JSON.parse(row.payloadJson as string)
        expect(migrated.steps[0].label).toMatch(/^@retale-progress:/)
        expect(migrated.steps[0].detail).toBe('Custom diagnostic')
        expect(migrated.prompt).toBe(payload.prompt)
      } finally { check.close() }
    } finally { temp.cleanup() }
  })

  it('refuses to finalize corrupt binary data even after JSON retirement', () => {
    const database = fixture()
    backfillEmbeddingVectorBatch(database, { novelId: 'novel', retireJson: true })
    database.prepare('UPDATE RawTextEmbeddingCache SET vectorBlob = ? WHERE model = ?').run(new Uint8Array(1),'old')
    expect(() => finalizeEmbeddingVectorMigration(database)).toThrow('byte length')
    expect(database.prepare('PRAGMA table_info(RawTextEmbeddingCache)').all().map(row => row.name)).toContain('vectorJson')
  })

  it('compacts a file while preserving records and integrity', () => {
    const temp = createTempDatabaseCopy('offline-compaction')
    try {
      const database = new DatabaseSync(temp.dbPath)
      database.exec('CREATE TABLE MaintenanceFixture (id INTEGER PRIMARY KEY, data BLOB); INSERT INTO MaintenanceFixture VALUES (1,zeroblob(1000000)),(2,zeroblob(10)); DELETE FROM MaintenanceFixture WHERE id = 1')
      database.close()
      const result = compactDatabase(temp.dbPath)
      expect(result.reclaimedBytes).toBeGreaterThan(500000)
      const check = new DatabaseSync(temp.dbPath, { readOnly: true })
      try { expect(check.prepare('SELECT id,length(data) AS bytes FROM MaintenanceFixture').all()).toEqual([{ id: 2, bytes: 10 }]) }
      finally { check.close() }
    } finally { temp.cleanup() }
  })
})
