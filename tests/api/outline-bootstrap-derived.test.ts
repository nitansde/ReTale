import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type { PersistedNovelState } from '@/lib/types'
import { loadFutureMapSourceData } from '@/lib/server/outline-bootstrap'
import { createOutlineNode, createOutlineNodeChapter } from '@/lib/server/outline-node-store'
import { listOutlineNodes } from '@/lib/server/outline-node-store'
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
  const tempDatabase = createTempDatabaseCopy('chatbook-outline-bootstrap-derived')
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
  db.execute(`INSERT INTO NovelRecord (id, title, author, sourceType) VALUES (?, ?, ?, ?)`, 'novel-002', 'Derived Fixture', 'Fixture Author', 'txt')
  db.execute(`INSERT INTO StoryBranch (id, novelId, name, baseBranchId) VALUES (?, ?, ?, ?)`, 'novel-002:main', 'novel-002', 'main', null)

  const chapterRows = [
    ['chapter-20', 20, '第20章 伏击', '第20章摘要：反派开始布网。'],
    ['chapter-35', 35, '第35章 失联', ''],
    ['chapter-120', 120, '第120章 迟到的救援', '第120章摘要：救援已经太迟。'],
  ] as const

  for (const [chapterId, chapterNo, title, summary] of chapterRows) {
    db.execute(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, summary,
        revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      chapterId,
      'novel-002',
      'novel-002:main',
      chapterNo,
      title,
      `${title} 内容`,
      summary,
      1,
      0,
      null,
      `hash-${chapterId}`,
      'ready',
    )
  }

  db.execute(
    `INSERT INTO KnowledgeEvent (
      id, novelId, branchId, name, summary, eventType, chapterNo, lineStart, lineEnd,
      importance, consequences, evidenceSpanId, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'knowledge-event-20',
    'novel-002',
    'novel-002:main',
    '反派伏击开始',
    '反派在此正式启动长期计划。',
    'major',
    20,
    null,
    null,
    5,
    '原线里主角还未察觉。',
    null,
    'user_confirmed',
  )
  db.execute(`INSERT INTO KnowledgeEntity (id, novelId, branchId, entityType, canonicalName, description, firstSeenChapter, lastSeenChapter, status, importance, userConfirmed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 'character-antagonist', 'novel-002', 'novel-002:main', 'character', '反派', '主导伏击者', 20, 120, 'user_confirmed', 5, 1)
  db.execute(`INSERT INTO EventParticipant (id, eventId, entityId, role) VALUES (?, ?, ?, ?)`, 'event-participant-1', 'knowledge-event-20', 'character-antagonist', 'planner')

  db.execute(
    `INSERT INTO KnowledgeFact (
      id, novelId, branchId, factType, subjectEntityId, predicate, objectEntityId, valueJson,
      sourceChapter, validFromChapter, validUntilChapter, confidence, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'open-thread-35',
    'novel-002',
    'novel-002:main',
    'open_thread',
    null,
    '女主为何突然失联',
    null,
    JSON.stringify({ description: '主角尚未意识到失联背后的真相。' }),
    35,
    35,
    999999,
    0.55,
    'user_confirmed',
  )
}

describe('outline bootstrap derived fallback', () => {
  it('bootstraps derived future-map rows on demand with stable tracks and anchors', async () => {
    const database = createTestDb()
    cleanups.push(database.cleanup)
    seedNovel(database.db)

    const workspaceState: Partial<PersistedNovelState> = {
      localOutlines: [],
      localTimelineEvents: [{
        id: 'timeline-event-20',
        novelId: 'novel-002',
        title: '反派线节点',
        phase: '第二幕',
        worldline: '反派线',
        summary: '把知识事件映射到 authored worldline。',
        order: 2,
        chapterIds: ['chapter-20'],
      }],
    }

    const futureMap = await loadFutureMapSourceData({
      novelId: 'novel-002',
      branchId: 'novel-002:main',
      workspaceState,
      db: database.db,
    })

    const persistedNodes = listOutlineNodes('novel-002', 'novel-002:main', database.db)
    const derivedEvent = futureMap.events.find((event) => event.sourceType === 'derived_event')
    const derivedOpenThread = futureMap.events.find((event) => event.sourceType === 'derived_open_thread')
    const derivedSummary = futureMap.events.find((event) => event.sourceType === 'derived_summary' && event.chapterNo === 120)

    expect(persistedNodes.length).toBeGreaterThanOrEqual(3)
    expect(futureMap.tracks.length).toBeGreaterThanOrEqual(2)
    expect(derivedEvent?.trackKey).toBe('worldline-反派线')
    expect(derivedEvent?.phaseLabel).toBe('第二幕')
    expect(derivedEvent?.confidence).toBeLessThan(1)
    expect(derivedOpenThread?.trackKey).toBe('chapter-range-4')
    expect(derivedOpenThread?.confidence).toBeLessThan(1)
    expect(derivedSummary?.trackKey).toBe('chapter-range-12')
    expect(derivedSummary?.confidence).toBeLessThan(1)
    expect(futureMap.chaptersByEvent[derivedEvent!.id]?.[0]?.chapterId).toBe('chapter-20')
    expect(futureMap.chaptersByEvent[derivedOpenThread!.id]?.[0]?.chapterId).toBe('chapter-35')
    expect(futureMap.defaults.selectedTrackKey).toBeTruthy()
    expect(futureMap.defaults.selectedOutlineNodeId).toBeTruthy()

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'derived-fallback.txt'),
      JSON.stringify({
        tracks: futureMap.tracks,
        events: futureMap.events,
        chaptersByEvent: futureMap.chaptersByEvent,
        defaults: futureMap.defaults,
      }, null, 2),
    )
  })

  it('additively backfills later candidates when partial outline rows already exist', async () => {
    const database = createTestDb()
    cleanups.push(database.cleanup)
    seedNovel(database.db)

    createOutlineNode({
      id: 'outline_event_20_existing',
      novelId: 'novel-002',
      branchId: 'novel-002:main',
      chapterNo: 20,
      title: '反派伏击开始',
      summary: '反派在此正式启动长期计划。',
      originalOutcome: '原线里主角还未察觉。',
      trackKey: 'worldline-反派线',
      phaseLabel: '第二幕',
      sourceType: 'derived_event',
      confidence: 0.78,
      involvedEntities: ['反派'],
      keyEvents: ['反派伏击开始'],
      sortOrder: 0,
    }, database.db)
    createOutlineNodeChapter({
      id: 'outline_event_20_existing:chapter:chapter-20:0',
      outlineNodeId: 'outline_event_20_existing',
      chapterNo: 20,
      chapterId: 'chapter-20',
      chapterTitle: '第20章 伏击',
      isPrimary: true,
      sortOrder: 0,
    }, database.db)

    const workspaceState: Partial<PersistedNovelState> = {
      localOutlines: [],
      localTimelineEvents: [{
        id: 'timeline-event-20',
        novelId: 'novel-002',
        title: '反派线节点',
        phase: '第二幕',
        worldline: '反派线',
        summary: '把知识事件映射到 authored worldline。',
        order: 2,
        chapterIds: ['chapter-20'],
      }],
    }

    const futureMap = await loadFutureMapSourceData({
      novelId: 'novel-002',
      branchId: 'novel-002:main',
      workspaceState,
      db: database.db,
    })

    const persistedNodes = listOutlineNodes('novel-002', 'novel-002:main', database.db)
    const chapter35Event = futureMap.events.find((event) => event.chapterNo === 35)
    const chapter120Summary = futureMap.events.find((event) => event.sourceType === 'derived_summary' && event.chapterNo === 120)

    expect(persistedNodes.filter((node) => node.chapterNo === 20 && node.title === '反派伏击开始')).toHaveLength(1)
    expect(chapter35Event).toBeTruthy()
    expect(chapter120Summary).toBeTruthy()
    expect(futureMap.chaptersByEvent[chapter35Event!.id]?.[0]?.chapterId).toBe('chapter-35')
    expect(futureMap.chaptersByEvent[chapter120Summary!.id]?.[0]?.chapterId).toBe('chapter-120')
  })
})
