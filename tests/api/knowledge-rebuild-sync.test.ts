import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { syncWorkspacePayloadToKnowledgeStore } from '@/lib/server/knowledge-rebuild'
import { initializeDatabase, queryOne } from '@/lib/server/sqlite'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }

function createTestDatabase(prefix: string) {
  const tempDatabase = createTempDatabaseCopy(prefix)
  cleanups.push(tempDatabase.cleanup)
  const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
  globalForSqlite.sqlite = database
  return database
}

afterEach(() => {
  if (globalForSqlite.sqlite) {
    try {
      ;(globalForSqlite.sqlite as DatabaseSync & { close?: () => void }).close?.()
    } catch {
    }
    delete globalForSqlite.sqlite
  }

  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('syncWorkspacePayloadToKnowledgeStore', () => {
  it('aborts stale running rebuild jobs before removing stale novels', async () => {
    createTestDatabase('chatbook-knowledge-sync-stale-job-cleanup')

    globalForSqlite.sqlite?.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run('novel_stale', 'Stale Novel', 'txt')
    globalForSqlite.sqlite?.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run('novel_stale:main', 'novel_stale', 'main')
    globalForSqlite.sqlite?.prepare(
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
  })

  it('syncs workspace chapters without enqueuing a rebuild job', async () => {
    createTestDatabase('chatbook-knowledge-sync-without-rebuild-job')

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
          volumeId: 'volume-1',
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
  })
})
