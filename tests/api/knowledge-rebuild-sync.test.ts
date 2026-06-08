import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { syncWorkspacePayloadToKnowledgeStore } from '@/lib/server/knowledge-rebuild'
import { hashContent } from '@/lib/server/knowledge-store'
import { execute, initializeDatabase, queryOne } from '@/lib/server/sqlite'
import { htmlToPlainText } from '@/lib/utils'
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
    createTestDatabase('retale-knowledge-sync-stale-job-cleanup')

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

  it('repairs missing derived line and span artifacts for unchanged chapters', async () => {
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
          volumeId: 'volume-1',
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
  })

  it('syncs a large workspace payload without queuing rebuild jobs', async () => {
    createTestDatabase('retale-knowledge-sync-large-workspace')

    const localChapters = Array.from({ length: 64 }, (_, index) => ({
      id: `large_ch_${index + 1}`,
      novelId: 'novel_large_workspace',
      volumeId: 'volume-large',
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
  })
})
