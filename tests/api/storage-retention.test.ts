import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseAccess, runWithDatabaseAccessScope } from '@/lib/server/database-access'
import { initializeDatabase } from '@/lib/server/sqlite'
import { pruneWorkspaceStateBackupsInDb } from '@/lib/server/persistence'
import { lookupRawTextEmbeddingCacheEntries, pruneInactiveRawTextEmbeddingCache } from '@/lib/server/retrieval-embedding-cache'
import { updateKnowledgeRebuildJobTelemetry } from '@/lib/server/knowledge-rebuild'
import {
  previewEmbeddingCacheRetention,
  previewWorkspaceBackupRetention,
  readStorageRetentionPolicy,
} from '@/lib/server/storage-retention'

const connections: DatabaseSync[] = []
const now = Date.parse('2026-09-11T00:00:00Z')

function fixture() {
  const database = initializeDatabase(new DatabaseSync(':memory:'))
  connections.push(database)
  const db = createDatabaseAccess(database)
  database.exec(`
    INSERT INTO WorkspaceState (id) VALUES ('singleton'), ('other');
    INSERT INTO NovelRecord (id, title) VALUES ('novel', 'Novel'), ('other', 'Other');
    INSERT INTO StoryBranch (id, novelId, name) VALUES
      ('novel:main', 'novel', 'main'), ('novel:alternate', 'novel', 'alternate'), ('other:main', 'other', 'main');
  `)
  function backup(id: string, payload: string, workspace = 'singleton') {
    database.prepare(`INSERT INTO WorkspaceStateBackup (id, workspaceStateId, payload, createdAt)
      VALUES (?, ?, ?, '2026-09-10 00:00:00')`).run(id, workspace, payload)
  }
  function cache(model: string, lastSeenAt = '2026-01-01 00:00:00', branch = 'novel:main', count = 1) {
    const insert = database.prepare(`INSERT INTO RawTextEmbeddingCache
      (branchId, provider, model, embeddingInputHash, vectorBlob, vectorDimension, lastSeenAt)
      VALUES (?, 'ollama', ?, ?, X'cdcccc3dcdcc4c3e', 2, ?)`)
    for (let index = 0; index < count; index++) insert.run(branch, model, `hash-${index}`, lastSeenAt)
  }
  function job(id: string, status: string, snapshot: unknown, branch: string | null = 'novel:main') {
    database.prepare(`INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, payloadJson)
      VALUES (?, 'novel', ?, 'extract_chapter_knowledge', ?, ?)`)
      .run(id, branch, status, typeof snapshot === 'string' ? snapshot : JSON.stringify({ embeddingSettingsSnapshot: snapshot }))
  }
  return { database, db, backup, cache, job }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const database of connections.splice(0)) database.close()
})

describe('workspace backup retention', () => {
  it('accounts for UTF-8 bytes and previews without deleting or reading payloads into JS', () => {
    const { db, backup } = fixture()
    backup('old', '中😀')
    backup('new', '中😀')
    vi.stubEnv('RETALE_BACKUP_MAX_BYTES', '10')
    const preview = previewWorkspaceBackupRetention(db)
    expect(preview).toMatchObject({ totalBytes: 14, eligibleBytes: 7, retainedCount: 1, retainedBytes: 7 })
    expect(preview.candidates.map((row) => row.id)).toEqual(['old'])
    expect(db.queryAll('SELECT id FROM WorkspaceStateBackup')).toHaveLength(2)
    pruneWorkspaceStateBackupsInDb(db)
    expect(db.queryAll('SELECT id FROM WorkspaceStateBackup')).toEqual([{ id: 'new' }])
  })

  it('keeps the newest oversized backup and leaves other workspaces alone', () => {
    const { db, backup } = fixture()
    backup('old', 'small')
    backup('new', '中'.repeat(10))
    backup('other', 'other data', 'other')
    vi.stubEnv('RETALE_BACKUP_MAX_BYTES', '10')
    expect(pruneWorkspaceStateBackupsInDb(db)).toMatchObject({ retainedCount: 1, retainedBytes: 30, overBudgetBytes: 20 })
    expect(db.queryAll('SELECT id FROM WorkspaceStateBackup ORDER BY id')).toEqual([{ id: 'new' }, { id: 'other' }])
  })

  it('supports more small backups when the configurable count cap is raised', () => {
    const { db, backup } = fixture()
    for (let index = 0; index < 35; index++) backup(`backup-${index}`, 'x')
    vi.stubEnv('RETALE_BACKUP_MAX_COUNT', '30')
    expect(pruneWorkspaceStateBackupsInDb(db)).toMatchObject({ retainedCount: 30, eligibleBytes: 5 })
    expect(db.queryAll('SELECT id FROM WorkspaceStateBackup')).toHaveLength(30)
  })

  it('rolls pruning back with the workspace transaction', async () => {
    const { db, backup } = fixture()
    backup('old', 'old')
    backup('new', 'new')
    vi.stubEnv('RETALE_BACKUP_MAX_COUNT', '1')
    await expect(db.withTransaction(() => {
      pruneWorkspaceStateBackupsInDb(db)
      throw new Error('save failed')
    })).rejects.toThrow('save failed')
    expect(db.queryAll('SELECT id FROM WorkspaceStateBackup')).toHaveLength(2)
  })

  it.each(['0', '-1', 'NaN', '1.5', '9007199254740992'])('rejects invalid retention limit %s', (value) => {
    expect(() => readStorageRetentionPolicy({ RETALE_BACKUP_MAX_BYTES: value })).toThrow('positive safe integer')
  })
})

describe('embedding model retention', () => {
  it('protects current models and recent switches, and never crosses novels', () => {
    const { db, cache } = fixture()
    cache('current')
    cache('expired')
    cache('recent', '2026-09-10 00:00:00')
    cache('other-novel', '2026-01-01 00:00:00', 'other:main')
    const preview = previewEmbeddingCacheRetention(db, 'novel', [{ provider: 'ollama', model: 'current' }], undefined, now)
    expect(preview.scopes.filter((scope) => scope.eligible).map((scope) => scope.model)).toEqual(['expired'])
    expect(preview).toMatchObject({ totalBytes: 24, eligibleRows: 1, eligibleBytes: 8 })
  })

  it.each(['queued', 'running', 'paused'])('protects persisted %s job identities across branches', (status) => {
    const { db, cache, job } = fixture()
    cache('model|version:a')
    cache('model|version:b')
    cache('alternate', undefined, 'novel:alternate')
    job('job', status, { provider: 'ollama', model: 'model', cacheModelIdentity: 'model|version:a' })
    const preview = previewEmbeddingCacheRetention(db, 'novel', [], undefined, now)
    expect(preview.scopes.filter((scope) => scope.eligible).map((scope) => scope.model).sort()).toEqual(['alternate', 'model|version:b'])
  })

  it.each(['succeeded', 'failed', 'aborted'])('does not pin caches indefinitely for terminal %s jobs', (status) => {
    const { db, cache, job } = fixture()
    cache('old-model')
    job('terminal', status, { provider: 'ollama', model: 'old-model' })
    expect(previewEmbeddingCacheRetention(db, 'novel', [], undefined, now).eligibleRows).toBe(1)
  })

  it('protects legacy model variants and conservatively protects incomplete job snapshots', () => {
    const { db, cache, job } = fixture()
    cache('legacy|version:a')
    cache('legacy|version:b')
    cache('alternate', undefined, 'novel:alternate')
    job('legacy', 'paused', { provider: 'ollama', model: 'legacy' })
    job('incomplete', 'running', '{broken', 'novel:alternate')
    expect(previewEmbeddingCacheRetention(db, 'novel', [], undefined, now).eligibleRows).toBe(0)
  })

  it('preserves the exact cache identity and input limit through persisted telemetry updates', () => {
    const { db, job } = fixture()
    job('snapshot', 'paused', {
      provider: 'ollama', model: 'model', cacheModelIdentity: 'model|version:a',
      embeddingBatchSize: 8, embeddingInputMaxCodePoints: 512,
    })
    db.execute(`UPDATE KnowledgeJob SET payloadJson = json_set(payloadJson, '$.branchId', branchId) WHERE id = 'snapshot'`)
    runWithDatabaseAccessScope(db, () => updateKnowledgeRebuildJobTelemetry('snapshot', { rawTextEmbeddingProgress: 0.5 }))
    const row = db.queryOne<{ payloadJson: string }>('SELECT payloadJson FROM KnowledgeJob WHERE id = ?', 'snapshot')!
    expect(JSON.parse(row.payloadJson).embeddingSettingsSnapshot).toMatchObject({
      cacheModelIdentity: 'model|version:a', embeddingInputMaxCodePoints: 512,
    })
  })

  it('evicts oldest inactive identities under byte pressure after the grace period', () => {
    const { db, cache } = fixture()
    cache('oldest', '2026-08-25 00:00:00')
    cache('newer', '2026-09-01 00:00:00')
    cache('switch', '2026-09-10 00:00:00')
    const policy = { ...readStorageRetentionPolicy({}), cacheMaxBytes: 16 }
    const preview = previewEmbeddingCacheRetention(db, 'novel', [], policy, now)
    expect(preview.scopes.filter((scope) => scope.eligible).map((scope) => scope.model)).toEqual(['oldest'])
    expect(preview.retainedBytes).toBe(16)
  })

  it('refreshes last use on real cache hits before retention assesses age', async () => {
    const { db, cache } = fixture()
    cache('used')
    await runWithDatabaseAccessScope(db, () => lookupRawTextEmbeddingCacheEntries({
      scope: { novelId: 'novel', branchId: 'novel:main', provider: 'ollama', model: 'used' },
      embeddingInputHashes: ['hash-0'], touchOnHit: true,
    }))
    expect(previewEmbeddingCacheRetention(db, 'novel', []).eligibleRows).toBe(0)
  })

  it('bounds automatic cleanup and frees reusable pages without claiming file shrinkage', async () => {
    const { database, db, cache } = fixture()
    cache('old', undefined, 'novel:main', 1200)
    const pages = database.prepare('PRAGMA page_count').get()
    const result = await runWithDatabaseAccessScope(db, () => pruneInactiveRawTextEmbeddingCache({ novelId: 'novel', currentIdentities: [] }))
    expect(result.deletedRows).toBe(500)
    expect(db.queryAll('SELECT embeddingInputHash FROM RawTextEmbeddingCache')).toHaveLength(700)
    expect(database.prepare('PRAGMA page_count').get()).toEqual(pages)
  })

  it('rechecks jobs after the preview and before deleting a scope', async () => {
    const { db, cache, job } = fixture()
    cache('resumed')
    const transaction = db.withTransaction
    vi.spyOn(db, 'withTransaction').mockImplementation((callback) => {
      job('resumed', 'queued', { provider: 'ollama', model: 'resumed' })
      return transaction(callback)
    })
    const result = await runWithDatabaseAccessScope(db, () => pruneInactiveRawTextEmbeddingCache({ novelId: 'novel', currentIdentities: [] }))
    expect(result.deletedRows).toBe(0)
  })

  it('rechecks last use after the preview and before deleting a scope', async () => {
    const { db, cache } = fixture()
    cache('reused')
    const transaction = db.withTransaction
    vi.spyOn(db, 'withTransaction').mockImplementation((callback) => {
      db.execute('UPDATE RawTextEmbeddingCache SET lastSeenAt = CURRENT_TIMESTAMP')
      return transaction(callback)
    })
    const result = await runWithDatabaseAccessScope(db, () => pruneInactiveRawTextEmbeddingCache({ novelId: 'novel', currentIdentities: [] }))
    expect(result.deletedRows).toBe(0)
  })

  it('rechecks a model-setting change while waiting for the deletion transaction', async () => {
    const { db, cache } = fixture()
    cache('newly-selected')
    let currentModel = 'previous'
    const transaction = db.withTransaction
    vi.spyOn(db, 'withTransaction').mockImplementation((callback) => {
      currentModel = 'newly-selected'
      return transaction(callback)
    })
    const result = await runWithDatabaseAccessScope(db, () => pruneInactiveRawTextEmbeddingCache({
      novelId: 'novel', currentIdentities: () => [{ provider: 'ollama', model: currentModel }],
    }))
    expect(result.deletedRows).toBe(0)
  })
})
