import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { normalizeWorkspaceState } from '@/lib/workspace-state'
import type { FullSnapshotMutationRequest } from '@/lib/server/workspace-mutation'

const cleanupDirectories: string[] = []
const originalDataDir = process.env.RETALE_DATA_DIR

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

function createPayload(novelId: string, content = '<p>initial</p>') {
  return normalizeWorkspaceState({
    currentNovelId: novelId,
    currentChapterId: `${novelId}-chapter-1`,
    expandedVolumeIds: [`${novelId}-volume-1`],
    localNovels: [{ id: novelId, title: 'Mutation Novel', summary: 'summary', tags: ['mutation'] }],
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
      updatedAt: 'initial label',
      trajectory: ['keep-me'],
    }],
  })
}

async function createMutationFixture(prefix: string, novelId = 'novel-mutation') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  cleanupDirectories.push(root)
  process.env.RETALE_DATA_DIR = path.join(root, 'data')
  vi.resetModules()

  const resolver = await import('@/lib/server/db-resolver')
  const controlDb = resolver.getControlDb()
  const storage = resolver.getNovelStoragePaths(novelId)
  controlDb.prepare(
    `INSERT INTO NovelRegistry (
       novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus
     ) VALUES (?, ?, ?, ?, ?, '1', 'ready')`,
  ).run(novelId, novelId, 'Mutation Novel', storage.databasePath, storage.lanceDbPath)

  return {
    novelId,
    root,
    controlDb,
    get database() {
      return resolver.getNovelDb(novelId)
    },
    storage,
    resolver,
  }
}

function fullSnapshotRequest(novelId: string, content = '<p>initial</p>', overrides: Partial<FullSnapshotMutationRequest> = {}): FullSnapshotMutationRequest {
  return {
    kind: 'full-snapshot' as const,
    novelId,
    payload: createPayload(novelId, content),
    backupReason: 'workspace-save' as const,
    allowEmptyReset: false,
    baseRevision: 0,
    idempotencyKey: 'full-request-1',
    ...overrides,
  }
}

function chapterPatchRequest(novelId: string, baseRevision: number, key = 'patch-request-1', content = '<p>patched</p>') {
  return {
    kind: 'chapter-patch' as const,
    novelId,
    chapterId: `${novelId}-chapter-1`,
    baseRevision,
    idempotencyKey: key,
    content,
    wordCount: content.length,
    updatedAtLabel: 'patched label',
  }
}

function readSurfaces(database: DatabaseSync) {
  return {
    runtime: database.prepare('SELECT revision, currentNovelId, updatedAt FROM WorkspaceRuntimeState WHERE id = ?').get('singleton'),
    chapter: database.prepare(
      `SELECT contentHtml, originalContentHtml, title, status, wordCount, updatedAtLabel, trajectoryJson
       FROM WorkspaceRuntimeChapter WHERE workspaceStateId = ?`,
    ).get('singleton'),
    artifact: database.prepare('SELECT payload FROM WorkspaceState WHERE id = ?').get('singleton'),
    backups: database.prepare('SELECT payload, reason, sourceUpdatedAt FROM WorkspaceStateBackup ORDER BY rowid').all(),
    sync: database.prepare(
      'SELECT requestedRevision, requestedSourceUpdatedAt FROM WorkspaceKnowledgeSyncState WHERE workspaceStateId = ?',
    ).get('singleton'),
    replays: database.prepare(
      'SELECT idempotencyKey, operation, requestHash, committedRevision, responseJson FROM WorkspaceMutationReplay ORDER BY rowid',
    ).all(),
  }
}

async function expectMutationError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code })
}

afterEach(async () => {
  vi.restoreAllMocks()
  if (originalDataDir === undefined) delete process.env.RETALE_DATA_DIR
  else process.env.RETALE_DATA_DIR = originalDataDir
  try {
    const mutation = await import('@/lib/server/workspace-mutation')
    mutation.setWorkspaceMutationFaultInjectorForTests(null)
    const resolver = await import('@/lib/server/db-resolver')
    resolver.resetResolvedDatabasesForTests()
    const gate = await import('@/lib/server/per-novel-write-gate')
    gate.resetPerNovelWriteGatesForTests()
  } catch (error) {
    void error
  }
  vi.resetModules()
  while (cleanupDirectories.length) {
    const directory = cleanupDirectories.pop()
    if (directory) fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('canonical workspace mutation coordinator', () => {
  it('increments baseline revision for full snapshots and targeted chapter patches', async () => {
    const fixture = await createMutationFixture('retale-workspace-mutation-baseline')
    const { runWorkspaceMutation } = await import('@/lib/server/workspace-mutation')

    const full = await runWorkspaceMutation(fullSnapshotRequest(fixture.novelId))
    const patch = await runWorkspaceMutation(chapterPatchRequest(fixture.novelId, 1))
    const artifact = JSON.parse((fixture.database.prepare('SELECT payload FROM WorkspaceState').get() as { payload: string }).payload)

    expect(full).toMatchObject({ ok: true, operation: 'full-snapshot', revision: 1, replayed: false, shouldScheduleKnowledgeSync: true })
    expect(patch).toMatchObject({ ok: true, operation: 'chapter-patch', chapterId: `${fixture.novelId}-chapter-1`, revision: 2, replayed: false })
    expect(fixture.database.prepare('SELECT revision FROM WorkspaceRuntimeState').get()).toEqual({ revision: 2 })
    expect(fixture.database.prepare(
      'SELECT contentHtml, wordCount, updatedAtLabel, originalContentHtml, title, trajectoryJson FROM WorkspaceRuntimeChapter',
    ).get()).toEqual({
      contentHtml: '<p>patched</p>',
      wordCount: '<p>patched</p>'.length,
      updatedAtLabel: 'patched label',
      originalContentHtml: '<p>original</p>',
      title: 'Chapter 1',
      trajectoryJson: '["keep-me"]',
    })
    expect(artifact.localChapters[0]).toMatchObject({ content: '<p>patched</p>', wordCount: 14, updatedAt: 'patched label' })
    expect(fixture.database.prepare('SELECT requestedRevision FROM WorkspaceKnowledgeSyncState').get()).toEqual({ requestedRevision: 2 })
  })

  it('supports legacy and revision-aware full snapshots with shared revision semantics', async () => {
    const fixture = await createMutationFixture('retale-workspace-mutation-full-modes')
    const { runWorkspaceMutation } = await import('@/lib/server/workspace-mutation')

    const legacy = await runWorkspaceMutation(fullSnapshotRequest(fixture.novelId, '<p>legacy</p>', {
      baseRevision: null,
      idempotencyKey: null,
    }))
    const aware = await runWorkspaceMutation(fullSnapshotRequest(fixture.novelId, '<p>aware</p>', {
      baseRevision: 1,
      idempotencyKey: 'aware-key',
    }))

    expect(legacy.revision).toBe(1)
    expect(aware.revision).toBe(2)
    expect(fixture.database.prepare('SELECT COUNT(*) AS count FROM WorkspaceMutationReplay').get()).toEqual({ count: 1 })
  })

  it('rejects stale revisions without changing any surface and includes authoritative chapter context', async () => {
    const fixture = await createMutationFixture('retale-workspace-mutation-stale')
    const { runWorkspaceMutation } = await import('@/lib/server/workspace-mutation')
    await runWorkspaceMutation(fullSnapshotRequest(fixture.novelId))
    const before = readSurfaces(fixture.database)

    await expect(runWorkspaceMutation(chapterPatchRequest(fixture.novelId, 0, 'stale-key'))).rejects.toMatchObject({
      code: 'stale_revision',
      currentRevision: 1,
      chapter: expect.objectContaining({ id: `${fixture.novelId}-chapter-1`, content: '<p>initial</p>' }),
    })
    expect(readSurfaces(fixture.database)).toEqual(before)
  })

  it('replays identical keys exactly once and rejects payload or operation reuse', async () => {
    const fixture = await createMutationFixture('retale-workspace-mutation-replay')
    const { runWorkspaceMutation } = await import('@/lib/server/workspace-mutation')
    await runWorkspaceMutation(fullSnapshotRequest(fixture.novelId))
    const request = chapterPatchRequest(fixture.novelId, 1, 'response-loss-key')
    const committed = await runWorkspaceMutation(request)
    const beforeReplay = readSurfaces(fixture.database)
    const replayed = await runWorkspaceMutation(request)

    expect(replayed).toEqual({ ...committed, replayed: true, shouldScheduleKnowledgeSync: false })
    expect(readSurfaces(fixture.database)).toEqual(beforeReplay)
    await expectMutationError(
      runWorkspaceMutation(chapterPatchRequest(fixture.novelId, 1, 'response-loss-key', '<p>different</p>')),
      'idempotency_key_reused',
    )
    await expectMutationError(
      runWorkspaceMutation(fullSnapshotRequest(fixture.novelId, '<p>different</p>', {
        baseRevision: 2,
        idempotencyKey: 'response-loss-key',
      })),
      'idempotency_key_reused',
    )
    expect(readSurfaces(fixture.database)).toEqual(beforeReplay)
  })

  it('serializes two direct calls sharing a base revision so one commits and one becomes stale', async () => {
    const fixture = await createMutationFixture('retale-workspace-mutation-concurrent')
    const { runWorkspaceMutation } = await import('@/lib/server/workspace-mutation')
    await runWorkspaceMutation(fullSnapshotRequest(fixture.novelId))

    const settled = await Promise.allSettled([
      runWorkspaceMutation(chapterPatchRequest(fixture.novelId, 1, 'concurrent-a', '<p>A</p>')),
      runWorkspaceMutation(chapterPatchRequest(fixture.novelId, 1, 'concurrent-b', '<p>B</p>')),
    ])

    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter((item) => item.status === 'rejected').map((item) => item.reason)).toEqual([
      expect.objectContaining({ code: 'stale_revision', currentRevision: 2 }),
    ])
    expect(fixture.database.prepare('SELECT revision FROM WorkspaceRuntimeState').get()).toEqual({ revision: 2 })
  })

  it.each(['after_runtime', 'after_artifact', 'after_sync', 'before_replay'] as const)(
    'rolls back every surface when failure is injected at %s',
    async (stage) => {
      const fixture = await createMutationFixture(`retale-workspace-mutation-fault-${stage}`)
      const mutation = await import('@/lib/server/workspace-mutation')
      await mutation.runWorkspaceMutation(fullSnapshotRequest(fixture.novelId))
      const before = readSurfaces(fixture.database)
      mutation.setWorkspaceMutationFaultInjectorForTests((currentStage) => {
        if (currentStage === stage) throw new Error(`fault:${stage}`)
      })

      await expectMutationError(
        mutation.runWorkspaceMutation(chapterPatchRequest(fixture.novelId, 1, `fault-${stage}`)),
        'persistence_failed',
      )
      expect(readSurfaces(fixture.database)).toEqual(before)
    },
  )

  it('prunes replay rows older than seven days and caps newest rows at 512 while preserving the committed row', async () => {
    const fixture = await createMutationFixture('retale-workspace-mutation-retention')
    const { runWorkspaceMutation } = await import('@/lib/server/workspace-mutation')
    await runWorkspaceMutation(fullSnapshotRequest(fixture.novelId))
    const database = fixture.database
    database.prepare('UPDATE WorkspaceMutationReplay SET createdAt = ?').run('2000-01-01 00:00:00')
    const insert = database.prepare(
      `INSERT INTO WorkspaceMutationReplay (
         workspaceStateId, idempotencyKey, operation, requestHash, committedRevision,
         responseStatus, responseJson, createdAt
       ) VALUES ('singleton', ?, 'chapter-patch', ?, 1, 200, ?, datetime('now', ?))`,
    )
    for (let index = 0; index < 520; index += 1) {
      insert.run(`seed-${index}`, `hash-${index}`, '{}', `${index} seconds`)
    }

    await runWorkspaceMutation(chapterPatchRequest(fixture.novelId, 1, 'newest-preserved'))
    const rows = database.prepare(
      'SELECT idempotencyKey, createdAt FROM WorkspaceMutationReplay WHERE workspaceStateId = ? ORDER BY createdAt DESC, rowid DESC',
    ).all('singleton') as Array<{ idempotencyKey: string; createdAt: string }>

    expect(rows).toHaveLength(512)
    expect(rows.some((row) => row.idempotencyKey === 'newest-preserved')).toBe(true)
    expect(rows.some((row) => row.createdAt.startsWith('2000-01-01'))).toBe(false)
  })

  it('rejects missing chapters, missing novels, and non-ready novels without creating or reviving storage', async () => {
    const fixture = await createMutationFixture('retale-workspace-mutation-readiness')
    const { runWorkspaceMutation } = await import('@/lib/server/workspace-mutation')
    await runWorkspaceMutation(fullSnapshotRequest(fixture.novelId))
    await expectMutationError(runWorkspaceMutation({
      ...chapterPatchRequest(fixture.novelId, 1, 'missing-chapter'),
      chapterId: 'missing-chapter',
    }), 'chapter_not_found')

    const missingId = 'novel-absent'
    const missingPath = fixture.resolver.getNovelStoragePaths(missingId).novelDirectory
    await expectMutationError(runWorkspaceMutation(chapterPatchRequest(missingId, 0)), 'novel_not_found')
    expect(fs.existsSync(missingPath)).toBe(false)

    fixture.controlDb.prepare('UPDATE NovelRegistry SET migrationStatus = ? WHERE novelId = ?').run('deleted', fixture.novelId)
    fixture.resolver.resetResolvedDatabasesForTests()
    fs.rmSync(fixture.storage.novelDirectory, { recursive: true, force: true })
    await expectMutationError(runWorkspaceMutation(chapterPatchRequest(fixture.novelId, 1, 'deleted-key')), 'novel_not_ready')
    expect(fs.existsSync(fixture.storage.novelDirectory)).toBe(false)
  })

  it('blocks unsafe empty snapshots and rejects invalid revision/idempotency pairing', async () => {
    const fixture = await createMutationFixture('retale-workspace-mutation-contract')
    const { runWorkspaceMutation } = await import('@/lib/server/workspace-mutation')
    await runWorkspaceMutation(fullSnapshotRequest(fixture.novelId))
    const emptyPayload = normalizeWorkspaceState({ currentNovelId: fixture.novelId, localNovels: [], localChapters: [] })
    await expectMutationError(runWorkspaceMutation(fullSnapshotRequest(fixture.novelId, '', {
      payload: emptyPayload,
      baseRevision: 1,
      idempotencyKey: 'empty-key',
    })), 'empty_overwrite_blocked')
    await expectMutationError(runWorkspaceMutation(fullSnapshotRequest(fixture.novelId, '', {
      baseRevision: 1,
      idempotencyKey: null,
    })), 'invalid_mutation_contract')
  })

  it('durably preserves canonical revision, artifact, and replay across resolver reopen', async () => {
    const fixture = await createMutationFixture('retale-workspace-mutation-reopen')
    const mutation = await import('@/lib/server/workspace-mutation')
    const request = fullSnapshotRequest(fixture.novelId)
    const committed = await mutation.runWorkspaceMutation(request)
    fixture.resolver.resetResolvedDatabasesForTests()
    vi.resetModules()

    const reopenedMutation = await import('@/lib/server/workspace-mutation')
    const replayed = await reopenedMutation.runWorkspaceMutation(request)
    const reopenedResolver = await import('@/lib/server/db-resolver')
    const database = reopenedResolver.getNovelDb(fixture.novelId)

    expect(replayed).toEqual({ ...committed, replayed: true, shouldScheduleKnowledgeSync: false })
    expect(database.prepare('SELECT revision FROM WorkspaceRuntimeState').get()).toEqual({ revision: 1 })
    expect(database.prepare('SELECT payload FROM WorkspaceState').get()).toBeDefined()
    expect(database.prepare('SELECT COUNT(*) AS count FROM WorkspaceMutationReplay').get()).toEqual({ count: 1 })
  })
})
