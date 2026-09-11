import { createScopedDatabaseFixture } from '@/tests/helpers/database-fixture'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncWorkspacePayloadToKnowledgeStore } from '@/lib/server/knowledge-rebuild'
import { createWorkspaceKnowledgeSync } from '@/lib/server/knowledge-workspace-sync'
import { createDatabaseAccess } from '@/lib/server/database-access'
import { NovelRegistryNotReadyError } from '@/lib/server/db-resolver'
import { hashContent } from '@/lib/server/knowledge-store'
import { initializeDatabase } from '@/lib/server/sqlite'
import { execute, queryOne } from '@/lib/server/database-access'
import { htmlToPlainText } from '@/lib/utils'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const databaseFixture = createScopedDatabaseFixture()

const cleanups: Array<() => void> = []
const originalDataDir = process.env.RETALE_DATA_DIR
const cleanupDirectories: string[] = []

function restoreEnvVar(name: 'RETALE_DATA_DIR', originalValue: string | undefined) {
  if (originalValue === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = originalValue
}

function createTestDatabase(prefix: string) {
  const tempDatabase = createTempDatabaseCopy(prefix)
  cleanups.push(tempDatabase.cleanup)
  process.env.RETALE_DATA_DIR = path.join(tempDatabase.directory, 'data')
  const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
  databaseFixture.database = database
  return database
}

afterEach(databaseFixture.wrap(async () => {
  if (databaseFixture.database) {
    try {
      ;(databaseFixture.database as DatabaseSync & { close?: () => void }).close?.()
    } catch {
    }
    delete databaseFixture.database
  }

  while (cleanups.length) {
    cleanups.pop()?.()
  }

  const resolverModule = await import('@/lib/server/db-resolver')
  resolverModule.resetResolvedDatabasesForTests()
  restoreEnvVar('RETALE_DATA_DIR', originalDataDir)
  while (cleanupDirectories.length) {
    fs.rmSync(cleanupDirectories.pop()!, { recursive: true, force: true })
  }
}))

async function createPerNovelResolverFixture(prefix: string) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  cleanupDirectories.push(tempRoot)
  process.env.RETALE_DATA_DIR = path.join(tempRoot, 'data')
  const resolver = await import('@/lib/server/db-resolver')
  resolver.resetResolvedDatabasesForTests()
  return resolver
}

function seedNovelRegistryStatus(
  controlDb: DatabaseSync,
  novelId: string,
  migrationStatus: 'ready' | 'deleting' | 'deleted',
) {
  const novelDirectory = path.join(process.env.RETALE_DATA_DIR ?? 'data', 'novels', novelId)
  controlDb.prepare(
    `INSERT INTO NovelRegistry (
       novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus
     ) VALUES (?, ?, ?, ?, ?, '1', ?)`,
  ).run(
    novelId,
    novelId,
    novelId,
    path.join(novelDirectory, 'novel.db'),
    path.join(novelDirectory, 'lancedb'),
    migrationStatus,
  )
}

describe('syncWorkspacePayloadToKnowledgeStore', () => {
  it('re-derives previously encoded raw text and spans from the unchanged chapter HTML', databaseFixture.wrap(async () => {
    const database = createTestDatabase('retale-knowledge-sync-entities')
    database.prepare('INSERT INTO NovelRecord (id, title) VALUES (?, ?)').run('novel_entities', 'Entities')
    database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run('novel_entities:main', 'novel_entities', 'main')
    database.prepare(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, sourceHash, revision, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('chapter_entities', 'novel_entities', 'novel_entities:main', 1, 'Entities', 'A &amp; B &lt;C&gt;', hashContent('A &amp; B &lt;C&gt;'), 1, 'ready')
    const sync = createWorkspaceKnowledgeSync({ abortKnowledgeRebuildUntilIdle: vi.fn(async () => undefined) })
    await sync({
      currentNovelId: 'novel_entities',
      localNovels: [{ id: 'novel_entities', title: 'Entities', summary: '', tags: [] }],
      localChapters: [{
        id: 'chapter_entities', novelId: 'novel_entities', title: 'Entities', order: 1,
        content: '<p>A &amp; B &lt;C&gt;</p>', status: 'draft', wordCount: 7, updatedAt: 'now',
      }],
    }, { db: createDatabaseAccess(database) })
    expect(database.prepare('SELECT rawText, sourceHash, revision, knowledgeStatus FROM KnowledgeChapter WHERE id = ?').get('chapter_entities'))
      .toMatchObject({ rawText: 'A & B <C>', sourceHash: hashContent('A & B <C>'), revision: 2, knowledgeStatus: 'stale' })
    expect(database.prepare('SELECT text FROM ChapterLine WHERE chapterId = ?').all('chapter_entities'))
      .toEqual([{ text: 'A & B <C>' }])
    expect(database.prepare('SELECT DISTINCT text FROM TextSpan WHERE chapterId = ?').all('chapter_entities'))
      .toEqual([{ text: 'A & B <C>' }])
  }))

  it('aborts stale running rebuild jobs before removing stale novels', databaseFixture.wrap(async () => {
    createTestDatabase('retale-knowledge-sync-stale-job-cleanup')

    databaseFixture.database?.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run('novel_stale', 'Stale Novel', 'txt')
    databaseFixture.database?.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run('novel_stale:main', 'novel_stale', 'main')
    databaseFixture.database?.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, progress)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('job_stale', 'novel_stale', 'novel_stale:main', 'extract_chapter_knowledge', 'running', 'extracting', 0.5)

    await syncWorkspacePayloadToKnowledgeStore({
      localNovels: [],
      localChapters: [],
    })

    expect(queryOne<{ id: string }>('SELECT id FROM NovelRecord WHERE id = ?', 'novel_stale')).toBeNull()
    expect(queryOne<{ id: string }>('SELECT id FROM StoryBranch WHERE id = ?', 'novel_stale:main')).toBeNull()
    expect(queryOne<{ id: string }>('SELECT id FROM KnowledgeJob WHERE id = ?', 'job_stale')).toBeNull()
  }))

  it.each(['deleting', 'deleted'] as const)(
    'removes stale projection rows without opening storage for a %s registry entry',
    databaseFixture.wrap(async (migrationStatus) => {
      createTestDatabase(`retale-knowledge-sync-${migrationStatus}-cleanup`)
      const resolver = await import('@/lib/server/db-resolver')
      const controlDb = resolver.getControlDb()
      seedNovelRegistryStatus(controlDb, 'novel_tombstone', migrationStatus)
      const novelDirectory = resolver.getNovelStoragePaths('novel_tombstone').novelDirectory

      databaseFixture.database?.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run(
        'novel_tombstone',
        'Tombstone',
        'workspace',
      )
      databaseFixture.database?.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run(
        'novel_tombstone:main',
        'novel_tombstone',
        'main',
      )

      await syncWorkspacePayloadToKnowledgeStore({ localNovels: [], localChapters: [] })

      expect(queryOne<{ id: string }>('SELECT id FROM NovelRecord WHERE id = ?', 'novel_tombstone')).toBeNull()
      expect(queryOne<{ id: string }>('SELECT id FROM StoryBranch WHERE id = ?', 'novel_tombstone:main')).toBeNull()
      expect(fs.existsSync(novelDirectory)).toBe(false)
      expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get('novel_tombstone')).toEqual({
        migrationStatus,
      })
    }),
  )

  it('keeps normal storage-backed cleanup for ready stale novels', databaseFixture.wrap(async () => {
    createTestDatabase('retale-knowledge-sync-ready-cleanup')
    const resolver = await import('@/lib/server/db-resolver')
    const controlDb = resolver.getControlDb()
    const novelDb = resolver.getNovelDb('novel_ready_stale')
    seedNovelRegistryStatus(controlDb, 'novel_ready_stale', 'ready')
    const novelDirectory = resolver.getNovelStoragePaths('novel_ready_stale').novelDirectory

    databaseFixture.database?.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run(
      'novel_ready_stale',
      'Ready stale',
      'workspace',
    )
    novelDb.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run(
      'novel_ready_stale',
      'Ready stale',
      'workspace',
    )

    await syncWorkspacePayloadToKnowledgeStore({ localNovels: [], localChapters: [] })

    expect(queryOne<{ id: string }>('SELECT id FROM NovelRecord WHERE id = ?', 'novel_ready_stale')).toBeNull()
    expect(fs.existsSync(novelDirectory)).toBe(true)
  }))

  it('accepts a ready-to-deleted race only after the registry confirms the tombstone', databaseFixture.wrap(async () => {
    const database = createTestDatabase('retale-knowledge-sync-ready-deleted-race')
    const resolver = await import('@/lib/server/db-resolver')
    const controlDb = resolver.getControlDb()
    seedNovelRegistryStatus(controlDb, 'novel_raced', 'ready')
    database.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run(
      'novel_raced',
      'Raced',
      'workspace',
    )
    const abortKnowledgeRebuildUntilIdle = vi.fn(async () => {
      controlDb.prepare('UPDATE NovelRegistry SET migrationStatus = ? WHERE novelId = ?').run('deleted', 'novel_raced')
      throw new NovelRegistryNotReadyError('novel_raced', 'deleted')
    })
    const sync = createWorkspaceKnowledgeSync({ abortKnowledgeRebuildUntilIdle })

    await sync({ localNovels: [], localChapters: [] }, { db: createDatabaseAccess(database) })

    expect(abortKnowledgeRebuildUntilIdle).toHaveBeenCalledTimes(1)
    expect(database.prepare('SELECT id FROM NovelRecord WHERE id = ?').get('novel_raced')).toBeUndefined()
  }))

  it('rethrows unexpected stale cleanup failures without deleting the projection', databaseFixture.wrap(async () => {
    const database = createTestDatabase('retale-knowledge-sync-unexpected-cleanup-error')
    database.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run(
      'novel_failure',
      'Failure',
      'workspace',
    )
    const cleanupError = new Error('unexpected cleanup failure')
    const sync = createWorkspaceKnowledgeSync({
      abortKnowledgeRebuildUntilIdle: vi.fn(async () => {
        throw cleanupError
      }),
    })

    await expect(sync({ localNovels: [], localChapters: [] }, { db: createDatabaseAccess(database) }))
      .rejects.toBe(cleanupError)
    expect(database.prepare('SELECT id FROM NovelRecord WHERE id = ?').get('novel_failure')).toEqual({ id: 'novel_failure' })
  }))

  it('rethrows a not-ready error when the fresh registry read still reports ready', databaseFixture.wrap(async () => {
    const database = createTestDatabase('retale-knowledge-sync-unconfirmed-registry-race')
    const resolver = await import('@/lib/server/db-resolver')
    seedNovelRegistryStatus(resolver.getControlDb(), 'novel_still_ready', 'ready')
    database.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run(
      'novel_still_ready',
      'Still ready',
      'workspace',
    )
    const notReadyError = new NovelRegistryNotReadyError('novel_still_ready', 'deleted')
    const sync = createWorkspaceKnowledgeSync({
      abortKnowledgeRebuildUntilIdle: vi.fn(async () => {
        throw notReadyError
      }),
    })

    await expect(sync({ localNovels: [], localChapters: [] }, { db: createDatabaseAccess(database) }))
      .rejects.toBe(notReadyError)
    expect(database.prepare('SELECT id FROM NovelRecord WHERE id = ?').get('novel_still_ready')).toEqual({ id: 'novel_still_ready' })
  }))

  it('syncs workspace chapters without enqueuing a rebuild job', databaseFixture.wrap(async () => {
    createTestDatabase('retale-knowledge-sync-without-rebuild-job')

    await syncWorkspacePayloadToKnowledgeStore({
      currentNovelId: 'novel_imported',
      localNovels: [
        {
          id: 'novel_imported',
          title: 'Imported Novel',
          summary: 'summary',
          tags: ['导入'],
        },
      ],
      localChapters: [
        {
          id: 'ch_1',
          novelId: 'novel_imported',
          title: '第1章 初遇',
          content: '<p>林澄开始记录这次练习。</p>',
          order: 1,
          status: 'draft',
          wordCount: 8,
          updatedAt: '2026-05-16T00:00:00.000Z',
        },
      ],
    })

    expect(queryOne<{ id: string }>('SELECT id FROM NovelRecord WHERE id = ?', 'novel_imported')).toMatchObject({ id: 'novel_imported' })
    expect(queryOne<{ id: string }>('SELECT id FROM StoryBranch WHERE id = ?', 'novel_imported:main')).toMatchObject({ id: 'novel_imported:main' })
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM KnowledgeChapter WHERE novelId = ?', 'novel_imported')).toMatchObject({ count: 1 })
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM KnowledgeJob WHERE novelId = ?', 'novel_imported')).toMatchObject({ count: 0 })
  }))

  it('preserves an active first rebuild for unchanged source and aborts it after a real edit', databaseFixture.wrap(async () => {
    const database = createTestDatabase('retale-knowledge-sync-active-first-rebuild')
    const chapterContent = '<p>林澄开始记录这次练习。</p>'
    const rawText = htmlToPlainText(chapterContent)

    database.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run(
      'novel_active_rebuild',
      'Active Rebuild',
      'workspace',
    )
    database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run(
      'novel_active_rebuild:main',
      'novel_active_rebuild',
      'main',
    )
    database.prepare(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'ch_active_rebuild_1',
      'novel_active_rebuild',
      'novel_active_rebuild:main',
      1,
      '第1章 初遇',
      rawText,
      7,
      0,
      null,
      hashContent(rawText),
      'ready',
    )
    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, progress)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'job_active_rebuild',
      'novel_active_rebuild',
      'novel_active_rebuild:main',
      'extract_chapter_knowledge',
      'running',
      'extracting',
      0.25,
    )

    const chapterBefore = database.prepare(
      `SELECT chapterNo, title, rawText, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
       FROM KnowledgeChapter WHERE id = ?`,
    ).get('ch_active_rebuild_1')
    const jobBefore = database.prepare(
      `SELECT status, currentStep, progress
       FROM KnowledgeJob WHERE id = ?`,
    ).get('job_active_rebuild')
    let chapterObservedAtAbort: unknown
    const abortKnowledgeRebuildUntilIdle = vi.fn(async () => {
      chapterObservedAtAbort = database.prepare(
        `SELECT revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
         FROM KnowledgeChapter WHERE id = ?`,
      ).get('ch_active_rebuild_1')
    })
    const sync = createWorkspaceKnowledgeSync({ abortKnowledgeRebuildUntilIdle })
    const payload = {
      currentNovelId: 'novel_active_rebuild',
      localNovels: [{
        id: 'novel_active_rebuild',
        title: 'Active Rebuild',
        summary: '',
        tags: [],
      }],
      localChapters: [{
        id: 'ch_active_rebuild_1',
        novelId: 'novel_active_rebuild',
        title: '第1章 初遇',
        content: chapterContent,
        order: 1,
        status: 'draft' as const,
        wordCount: 8,
        updatedAt: '2026-05-16T00:00:00.000Z',
      }],
    }

    await sync(payload, { db: createDatabaseAccess(database) })

    expect(abortKnowledgeRebuildUntilIdle).not.toHaveBeenCalled()
    expect(database.prepare(
      `SELECT chapterNo, title, rawText, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
       FROM KnowledgeChapter WHERE id = ?`,
    ).get('ch_active_rebuild_1')).toEqual(chapterBefore)
    expect(database.prepare(
      `SELECT status, currentStep, progress
       FROM KnowledgeJob WHERE id = ?`,
    ).get('job_active_rebuild')).toEqual(jobBefore)

    const editedChapterContent = '<p>林澄开始记录这次练习，并发现新的线索。</p>'
    const editedRawText = htmlToPlainText(editedChapterContent)
    await sync({
      ...payload,
      localChapters: [{
        ...payload.localChapters[0],
        content: editedChapterContent,
        wordCount: 16,
        updatedAt: '2026-05-16T00:01:00.000Z',
      }],
    }, { db: createDatabaseAccess(database) })

    expect(abortKnowledgeRebuildUntilIdle).toHaveBeenCalledTimes(1)
    expect(abortKnowledgeRebuildUntilIdle).toHaveBeenCalledWith({
      novelId: 'novel_active_rebuild',
      branchId: 'novel_active_rebuild:main',
    })
    expect(chapterObservedAtAbort).toEqual({
      revision: 8,
      isDirty: 1,
      dirtyReason: 'Chapter 1 changed',
      sourceHash: hashContent(editedRawText),
      knowledgeStatus: 'stale',
    })
    expect(database.prepare(
      `SELECT rawText, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
       FROM KnowledgeChapter WHERE id = ?`,
    ).get('ch_active_rebuild_1')).toEqual({
      rawText: editedRawText,
      revision: 8,
      isDirty: 1,
      dirtyReason: 'Chapter 1 changed',
      sourceHash: hashContent(editedRawText),
      knowledgeStatus: 'stale',
    })
  }))

  it('repairs missing derived line and span artifacts for unchanged chapters', databaseFixture.wrap(async () => {
    createTestDatabase('retale-knowledge-sync-repairs-derived-artifacts')
    const chapterContent = '<p>林澄开始记录这次练习。</p>'
    const rawText = htmlToPlainText(chapterContent)

    execute('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)', 'novel_repair', 'Imported Novel', 'txt')
    execute('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)', 'novel_repair:main', 'novel_repair', 'main')
    execute(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'ch_repair_1',
      'novel_repair',
      'novel_repair:main',
      1,
      '第1章 初遇',
      rawText,
      7,
      0,
      null,
      hashContent(rawText),
      'ready'
    )

    await syncWorkspacePayloadToKnowledgeStore({
      currentNovelId: 'novel_repair',
      localNovels: [
        {
          id: 'novel_repair',
          title: 'Imported Novel',
          summary: 'summary',
          tags: ['导入'],
        },
      ],
      localChapters: [
        {
          id: 'ch_repair_1',
          novelId: 'novel_repair',
          title: '第1章 初遇',
          content: chapterContent,
          order: 1,
          status: 'draft',
          wordCount: 8,
          updatedAt: '2026-05-16T00:00:00.000Z',
        },
      ],
    })

    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM ChapterLine WHERE chapterId = ?', 'ch_repair_1')?.count).toBeGreaterThan(0)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM TextSpan WHERE chapterId = ?', 'ch_repair_1')?.count).toBeGreaterThan(0)
    expect(queryOne<{ revision: number; isDirty: number; knowledgeStatus: string }>(
      'SELECT revision, isDirty, knowledgeStatus FROM KnowledgeChapter WHERE id = ?',
      'ch_repair_1'
    )).toMatchObject({ revision: 7, isDirty: 0, knowledgeStatus: 'ready' })
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM KnowledgeJob WHERE novelId = ?', 'novel_repair')).toMatchObject({ count: 0 })
  }))

  it('syncs a large workspace payload without queuing rebuild jobs', databaseFixture.wrap(async () => {
    createTestDatabase('retale-knowledge-sync-large-workspace')

    const localChapters = Array.from({ length: 64 }, (_, index) => ({
      id: `large_ch_${index + 1}`,
      novelId: 'novel_large_workspace',
      title: `第${index + 1}章`,
      content: `<p>第 ${index + 1} 章内容。</p>`,
      order: index + 1,
      status: 'draft' as const,
      wordCount: 8,
      updatedAt: '2026-05-16T00:00:00.000Z',
    }))

    await syncWorkspacePayloadToKnowledgeStore({
      currentNovelId: 'novel_large_workspace',
      localNovels: [
        {
          id: 'novel_large_workspace',
          title: 'Large Workspace Novel',
          summary: 'summary',
          tags: ['大体量'],
        },
      ],
      localChapters,
    })

    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM KnowledgeChapter WHERE novelId = ?', 'novel_large_workspace')).toMatchObject({ count: 64 })
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM ChapterLine WHERE chapterId = ?', 'large_ch_64')?.count).toBeGreaterThan(0)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM TextSpan WHERE chapterId = ?', 'large_ch_64')?.count).toBeGreaterThan(0)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM KnowledgeJob WHERE novelId = ?', 'novel_large_workspace')).toMatchObject({ count: 0 })
  }))

  it('scopes target-novel sync writes and stale cleanup to the requested novel database only', databaseFixture.wrap(async () => {
    const resolver = await createPerNovelResolverFixture('retale-knowledge-sync-per-novel')
    const alphaDb = resolver.getNovelDb('novel-alpha')
    const betaDb = resolver.getNovelDb('novel-beta')
    const alphaAccess = createDatabaseAccess(alphaDb)
    databaseFixture.database = alphaDb

    alphaDb.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run('novel-alpha', 'Alpha', 'workspace')
    alphaDb.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run('novel-alpha:main', 'novel-alpha', 'main')
    alphaDb.prepare(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('alpha-ch-1', 'novel-alpha', 'novel-alpha:main', 1, 'Alpha Chapter 1', 'Alpha body', 1, 0, null, hashContent('Alpha body'), 'ready')
    alphaDb.prepare('INSERT INTO ChapterLine (id, chapterId, lineNo, text, charStart, charEnd) VALUES (?, ?, ?, ?, ?, ?)').run('alpha-line-1', 'alpha-ch-1', 1, 'Alpha body', 0, 10)
    alphaDb.prepare(
      `INSERT INTO TextSpan (
        id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd, charStart, charEnd, text, spanType, tokenEstimate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('alpha-span-1', 'novel-alpha', 'novel-alpha:main', 'alpha-ch-1', 1, 1, 1, 0, 10, 'Alpha body', 'evidence', 2)
    betaDb.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run('novel-beta', 'Beta', 'workspace')
    betaDb.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run('novel-beta:main', 'novel-beta', 'main')
    betaDb.prepare('INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status) VALUES (?, ?, ?, ?, ?)').run(
      'beta-job-1',
      'novel-beta',
      'novel-beta:main',
      'extract_chapter_knowledge',
      'queued',
    )

    await syncWorkspacePayloadToKnowledgeStore({
      currentNovelId: 'novel-alpha',
      syncScope: 'target-novel',
      localNovels: [{ id: 'novel-alpha', title: 'Alpha Updated', summary: '', tags: [] }],
      localChapters: [{
        id: 'alpha-ch-1',
        novelId: 'novel-alpha',
        title: 'Alpha Chapter 1',
        content: '<p>Alpha body</p>',
        order: 1,
        status: 'draft',
        wordCount: 2,
        updatedAt: '2026-05-16T00:00:00.000Z',
      }],
    }, { db: alphaAccess })

    expect(alphaDb.prepare('SELECT COUNT(*) AS count FROM KnowledgeChapter WHERE novelId = ?').get('novel-alpha')).toMatchObject({ count: 1 })
    expect(betaDb.prepare('SELECT COUNT(*) AS count FROM KnowledgeChapter WHERE novelId = ?').get('novel-beta')).toMatchObject({ count: 0 })
    expect(betaDb.prepare('SELECT COUNT(*) AS count FROM KnowledgeJob WHERE novelId = ?').get('novel-beta')).toMatchObject({ count: 1 })
  }))
})
