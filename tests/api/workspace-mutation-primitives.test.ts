import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createDatabaseAccess } from '@/lib/server/database-access'
import {
  createWorkspaceStateBackupInDb,
  findWorkspaceState,
  markWorkspaceKnowledgeSyncRequested,
  markWorkspaceKnowledgeSyncRequestedInDb,
  pruneWorkspaceStateBackupsInDb,
  readWorkspaceStateFromDb,
  upsertWorkspaceState,
  writeWorkspaceStateInDb,
} from '@/lib/server/persistence'
import { initializeDatabase } from '@/lib/server/sqlite'
import {
  loadWorkspacePayloadFromRuntimeOrRecovery,
  persistWorkspaceRuntimeState,
  readWorkspaceRuntimeSnapshotFromDb,
  replaceWorkspaceRuntimeStateInDb,
} from '@/lib/server/workspace-resilience'
import { normalizeWorkspaceState } from '@/lib/workspace-state'

function createTestDatabase() {
  const database = initializeDatabase(new DatabaseSync(':memory:'))
  return {
    database,
    db: createDatabaseAccess(database),
  }
}

function createPayload(title: string, content: string) {
  const novelId = 'novel-stage-2'
  return normalizeWorkspaceState({
    currentNovelId: novelId,
    currentChapterId: `${novelId}-chapter-1`,
    expandedVolumeIds: [`${novelId}-volume-1`],
    localNovels: [{ id: novelId, title, summary: 'summary', tags: ['stage-2'] }],
    localVolumes: [{ id: `${novelId}-volume-1`, novelId, title: 'Volume 1', order: 1 }],
    localChapters: [{
      id: `${novelId}-chapter-1`,
      novelId,
      volumeId: `${novelId}-volume-1`,
      title: 'Chapter 1',
      order: 1,
      content,
      originalContent: '<p>original</p>',
      status: 'draft',
      wordCount: content.length,
      updatedAt: 'just now',
      trajectory: ['stage-2'],
    }],
  })
}

function readMutationRows(database: DatabaseSync) {
  return {
    runtime: database.prepare('SELECT revision, currentNovelId FROM WorkspaceRuntimeState WHERE id = ?').get('singleton'),
    artifact: database.prepare('SELECT payload FROM WorkspaceState WHERE id = ?').get('singleton'),
    backupCount: database.prepare('SELECT COUNT(*) AS count FROM WorkspaceStateBackup WHERE workspaceStateId = ?').get('singleton'),
    sync: database.prepare(
      'SELECT requestedRevision, requestedSourceUpdatedAt FROM WorkspaceKnowledgeSyncState WHERE workspaceStateId = ?',
    ).get('singleton'),
  }
}

describe('workspace mutation persistence primitives', () => {
  it('composes runtime replacement, artifact backup/write, pruning, and sync request in one outer transaction', async () => {
    const { database, db } = createTestDatabase()
    const initialPayload = createPayload('Initial', '<p>initial</p>')
    const nextPayload = createPayload('Updated', '<p>updated</p>')
    await persistWorkspaceRuntimeState(initialPayload, 'singleton', db)
    const initialArtifact = await upsertWorkspaceState('singleton', JSON.stringify(initialPayload), { db })
    database.prepare('UPDATE WorkspaceRuntimeState SET revision = 4 WHERE id = ?').run('singleton')

    await db.withTransaction(() => {
      const runtime = replaceWorkspaceRuntimeStateInDb(db, nextPayload, 5)
      const existingArtifact = readWorkspaceStateFromDb(db)
      expect(existingArtifact).not.toBeNull()
      if (existingArtifact && existingArtifact.payload !== JSON.stringify(nextPayload)) {
        createWorkspaceStateBackupInDb(db, existingArtifact, 'workspace-save')
      }
      writeWorkspaceStateInDb(db, 'singleton', JSON.stringify(nextPayload))
      pruneWorkspaceStateBackupsInDb(db)
      markWorkspaceKnowledgeSyncRequestedInDb(db, 'singleton', runtime.updatedAt)
    })

    const runtime = readWorkspaceRuntimeSnapshotFromDb(db)
    const artifact = readWorkspaceStateFromDb(db)
    const backup = database.prepare(
      'SELECT payload, reason, sourceUpdatedAt FROM WorkspaceStateBackup WHERE workspaceStateId = ?',
    ).get('singleton')
    const sync = database.prepare(
      'SELECT requestedRevision, requestedSourceUpdatedAt FROM WorkspaceKnowledgeSyncState WHERE workspaceStateId = ?',
    ).get('singleton')

    expect(runtime).toMatchObject({ payload: nextPayload, revision: 5 })
    expect(artifact?.payload).toBe(JSON.stringify(nextPayload))
    expect(backup).toEqual({
      payload: JSON.stringify(initialPayload),
      reason: 'workspace-save',
      sourceUpdatedAt: initialArtifact.updatedAt,
    })
    expect(sync).toEqual({ requestedRevision: 1, requestedSourceUpdatedAt: runtime?.updatedAt })
  })

  it('rolls back every workspace surface when failure is injected after runtime replacement', async () => {
    const { database, db } = createTestDatabase()
    const initialPayload = createPayload('Initial', '<p>initial</p>')
    const nextPayload = createPayload('Updated', '<p>updated</p>')
    await persistWorkspaceRuntimeState(initialPayload, 'singleton', db)
    await upsertWorkspaceState('singleton', JSON.stringify(initialPayload), { db })
    markWorkspaceKnowledgeSyncRequested('singleton', '2026-08-12 00:00:00', { db })
    database.prepare('UPDATE WorkspaceRuntimeState SET revision = 3 WHERE id = ?').run('singleton')
    const before = readMutationRows(database)

    await expect(db.withTransaction(() => {
      replaceWorkspaceRuntimeStateInDb(db, nextPayload, 4)
      throw new Error('injected failure')
    })).rejects.toThrow('injected failure')

    expect(readMutationRows(database)).toEqual(before)
  })

  it('keeps convenience wrapper payload, backup, sync, and revision behavior compatible', async () => {
    const { database, db } = createTestDatabase()
    const initialPayload = createPayload('Initial', '<p>initial</p>')
    const nextPayload = createPayload('Updated', '<p>updated</p>')
    await persistWorkspaceRuntimeState(initialPayload, 'singleton', db)
    await upsertWorkspaceState('singleton', JSON.stringify(initialPayload), { db, backupReason: 'workspace-save' })
    database.prepare('UPDATE WorkspaceRuntimeState SET revision = 8 WHERE id = ?').run('singleton')

    const runtimeResult = await persistWorkspaceRuntimeState(nextPayload, 'singleton', db)
    const artifactResult = await upsertWorkspaceState('singleton', JSON.stringify(nextPayload), { db, backupReason: 'workspace-save' })
    markWorkspaceKnowledgeSyncRequested('singleton', runtimeResult.updatedAt, { db })
    const loaded = await loadWorkspacePayloadFromRuntimeOrRecovery('singleton', db)
    const runtime = readWorkspaceRuntimeSnapshotFromDb(db)
    const artifact = findWorkspaceState('singleton', { db })
    const backups = database.prepare(
      'SELECT payload, reason FROM WorkspaceStateBackup WHERE workspaceStateId = ? ORDER BY createdAt DESC, rowid DESC',
    ).all('singleton')
    const sync = database.prepare(
      'SELECT requestedRevision, requestedSourceUpdatedAt FROM WorkspaceKnowledgeSyncState WHERE workspaceStateId = ?',
    ).get('singleton')

    expect(loaded).toMatchObject({
      currentNovelId: nextPayload.currentNovelId,
      currentChapterId: nextPayload.currentChapterId,
      localNovels: nextPayload.localNovels,
      localVolumes: nextPayload.localVolumes,
      localChapters: [expect.objectContaining({
        id: nextPayload.localChapters[0]?.id,
        content: '<p>updated</p>',
        wordCount: '<p>updated</p>'.length,
        updatedAt: 'just now',
      })],
    })
    expect(runtime).toMatchObject({ payload: loaded, revision: 8, updatedAt: runtimeResult.updatedAt })
    expect(artifactResult).toEqual(artifact)
    expect(artifact?.payload).toBe(JSON.stringify(nextPayload))
    expect(artifact?.revision).toBe(8)
    expect(backups).toEqual([{ payload: JSON.stringify(initialPayload), reason: 'workspace-save' }])
    expect(sync).toEqual({ requestedRevision: 1, requestedSourceUpdatedAt: runtimeResult.updatedAt })
  })

  it('derives an omitted artifact revision from runtime and then preserves the artifact revision', async () => {
    const { database, db } = createTestDatabase()
    const initialPayload = createPayload('Initial', '<p>initial</p>')
    const updatedPayload = createPayload('Updated', '<p>updated</p>')
    await persistWorkspaceRuntimeState(initialPayload, 'singleton', db)
    database.prepare('UPDATE WorkspaceRuntimeState SET revision = ? WHERE id = ?').run(11, 'singleton')

    const runtimeDerived = writeWorkspaceStateInDb(db, 'singleton', JSON.stringify(initialPayload))
    expect(runtimeDerived.revision).toBe(11)

    database.prepare('DELETE FROM WorkspaceRuntimeState WHERE id = ?').run('singleton')
    const artifactDerived = writeWorkspaceStateInDb(db, 'singleton', JSON.stringify(updatedPayload))
    expect(artifactDerived.revision).toBe(11)
    expect(readWorkspaceStateFromDb(db)?.revision).toBe(11)
  })

  it('uses revision zero for fresh and recovered baselines', async () => {
    const { database, db } = createTestDatabase()
    const freshPayload = createPayload('Fresh', '<p>fresh</p>')
    await persistWorkspaceRuntimeState(freshPayload, 'singleton', db)
    expect(readWorkspaceRuntimeSnapshotFromDb(db)?.revision).toBe(0)

    database.exec(`
      DELETE FROM WorkspaceRuntimeChapter;
      DELETE FROM WorkspaceRuntimeVolume;
      DELETE FROM WorkspaceRuntimeNovel;
      DELETE FROM WorkspaceRuntimeState;
      INSERT INTO NovelRecord (id, title) VALUES ('novel-recovered', 'Recovered');
      INSERT INTO StoryBranch (id, novelId, name) VALUES ('novel-recovered:main', 'novel-recovered', 'main');
      INSERT INTO KnowledgeChapter (id, novelId, branchId, chapterNo, title, rawText, sourceHash)
      VALUES ('recovered-chapter', 'novel-recovered', 'novel-recovered:main', 1, 'Recovered Chapter', 'Recovered body', 'hash');
    `)

    await loadWorkspacePayloadFromRuntimeOrRecovery('singleton', db)
    expect(readWorkspaceRuntimeSnapshotFromDb(db)?.revision).toBe(0)
  })
})
