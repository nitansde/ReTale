import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type { PersistedNovelState } from '@/lib/types'
import { bootstrapOutlineNodesForFutureMap } from '@/lib/server/outline-bootstrap'
import { listOutlineNodeChapters, listOutlineNodes } from '@/lib/server/outline-node-store'
import { initializeDatabase } from '@/lib/server/sqlite'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const ROOT = process.cwd()
const EVIDENCE_DIR = path.join(ROOT, '.sisyphus/evidence/task-4-outline-bootstrap')

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

function createTestDb() {
  const tempDatabase = createTempDatabaseCopy('chatbook-outline-bootstrap-authored')
  cleanups.push(tempDatabase.cleanup)

  const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
  return {
    cleanup() {
      database.close()
      tempDatabase.cleanup()
    },
    db: {
      execute: (sql: string, ...params: Array<string | number | bigint | Uint8Array | null>) => {
        return database.prepare(sql).run(...params)
      },
      queryAll: <T>(sql: string, ...params: Array<string | number | bigint | Uint8Array | null>) => {
        return database.prepare(sql).all(...params) as T[]
      },
      queryOne: <T>(sql: string, ...params: Array<string | number | bigint | Uint8Array | null>) => {
        return (database.prepare(sql).get(...params) ?? null) as T | null
      },
      withTransaction: async <T>(callback: () => T | Promise<T>) => {
        database.exec('BEGIN IMMEDIATE')
        try {
          const result = await callback()
          database.exec('COMMIT')
          return result
        } catch (error) {
          try {
            database.exec('ROLLBACK')
          } catch {
          }
          throw error
        }
      },
    },
  }
}

function seedNovel(db: ReturnType<typeof createTestDb>['db']) {
  db.execute(
    `INSERT INTO NovelRecord (id, title, author, sourceType) VALUES (?, ?, ?, ?)`,
    'novel-001',
    'Fixture Novel',
    'Fixture Author',
    'txt',
  )
  db.execute(
    `INSERT INTO StoryBranch (id, novelId, name, baseBranchId) VALUES (?, ?, ?, ?)`,
    'novel-001:main',
    'novel-001',
    'main',
    null,
  )
  db.execute(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'chapter-100',
    'novel-001',
    'novel-001:main',
    100,
    '第100章 女主被反派绑走',
    'chapter text',
    '原线里男主会及时救人。',
    1,
    0,
    null,
    'hash-chapter-100',
    'ready',
  )
  db.execute(
    `INSERT INTO KnowledgeEvent (
      id, novelId, branchId, name, summary, eventType, chapterNo, lineStart, lineEnd,
      importance, consequences, evidenceSpanId, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'knowledge-event-100',
    'novel-001',
    'novel-001:main',
    '女主被反派绑走',
    '知识事件版本摘要',
    'major',
    100,
    null,
    null,
    5,
    '知识事件原线后果',
    null,
    'user_confirmed',
  )
}

describe('outline bootstrap authored precedence', () => {
  it('seeds authored outline rows exactly once and keeps them ahead of inferred candidates', async () => {
    const database = createTestDb()
    cleanups.push(database.cleanup)
    seedNovel(database.db)

    const workspaceState: Partial<PersistedNovelState> = {
      localOutlines: [{
        id: 'outline_event_100',
        novelId: 'novel-001',
        title: '女主被反派绑走',
        type: 'main',
        summary: '作者手写版本：反派设局抓走女主。',
        relatedChapterIds: ['chapter-100'],
      }],
      localTimelineEvents: [{
        id: 'timeline-event-100',
        novelId: 'novel-001',
        title: '未来主线节点',
        phase: '第三阶段',
        worldline: '主线',
        summary: '用于提供 authored 轨道元数据。',
        order: 3,
        chapterIds: ['chapter-100'],
      }],
    }

    const firstRun = await bootstrapOutlineNodesForFutureMap({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      workspaceState,
      db: database.db,
    })
    const secondRun = await bootstrapOutlineNodesForFutureMap({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      workspaceState,
      db: database.db,
    })

    const nodes = listOutlineNodes('novel-001', 'novel-001:main', database.db)
    const authoredNode = nodes.find((node) => node.id === 'outline_event_100')
    const derivedDuplicate = nodes.find((node) => node.sourceType === 'derived_event' && node.chapterNo === 100 && node.title === '女主被反派绑走')

    expect(firstRun.createdNodes).toBeGreaterThanOrEqual(1)
    expect(secondRun.createdNodes).toBe(0)
    expect(authoredNode?.sourceType).toBe('authored')
    expect(authoredNode?.confidence).toBe(1)
    expect(authoredNode?.trackKey).toBe('worldline-主线')
    expect(authoredNode?.phaseLabel).toBe('第三阶段')
    expect(listOutlineNodeChapters('outline_event_100', database.db).map((chapter) => chapter.id)).toEqual(['outline_chapter_100_primary'])
    expect(derivedDuplicate).toBeUndefined()

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'authored-precedence.txt'),
      JSON.stringify({
        firstRun,
        secondRun,
        nodes: nodes.map((node) => ({
          id: node.id,
          sourceType: node.sourceType,
          title: node.title,
          chapterNo: node.chapterNo,
          trackKey: node.trackKey,
          phaseLabel: node.phaseLabel,
        })),
        chapters: listOutlineNodeChapters('outline_event_100', database.db),
      }, null, 2),
    )
  })
})
