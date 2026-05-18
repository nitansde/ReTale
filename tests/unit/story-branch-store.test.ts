import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'
import { createFutureJumpRunWithInitialRevision, appendFutureJumpRevision, findFutureJumpRunById } from '@/lib/server/future-jump-store'
import { createOutlineNode, createOutlineNodeChapter, findOutlineNodeById, listOutlineNodeChapters } from '@/lib/server/outline-node-store'
import { createStoryTimelineNode, findStoryTimelineNodeById, getNextStoryTimelineLabelIndex, listStoryTimelineNodes } from '@/lib/server/story-timeline-store'
import { addWhatIfDelta, createWhatIfSession, findWhatIfSessionById } from '@/lib/server/what-if-store'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const EVIDENCE_DIR = path.join(process.cwd(), '.sisyphus/evidence/task-3-store-contracts')
type SqlParam = string | number | bigint | Uint8Array | null

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('story branch stores', () => {
  it('round-trips authored speculative records across the new store modules', async () => {
    const tempDatabase = createTempDatabaseCopy('chatbook-story-branch-store')
    cleanups.push(tempDatabase.cleanup)

    const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
    const testDb = {
      execute: (sql: string, ...params: SqlParam[]) => {
        return database.prepare(sql).run(...params)
      },
      queryAll: <T>(sql: string, ...params: SqlParam[]) => {
        return database.prepare(sql).all(...params) as T[]
      },
      queryOne: <T>(sql: string, ...params: SqlParam[]) => {
        const row = database.prepare(sql).get(...params)
        return (row ?? null) as T | null
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
            // ignore rollback failures in tests
          }
          throw error
        }
      },
    }

    testDb.execute(
      `INSERT INTO NovelRecord (id, title, author, sourceType)
       VALUES (?, ?, ?, ?)`,
      'novel-001',
      'Fixture Novel',
      'Fixture Author',
      'txt'
    )

    testDb.execute(
      `INSERT INTO StoryBranch (id, novelId, name, baseBranchId)
       VALUES (?, ?, ?, ?)`,
      'novel-001:main',
      'novel-001',
      'main',
      null
    )

    testDb.execute(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, summary,
        revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'chapter-10',
      'novel-001',
      'novel-001:main',
      10,
      '第10章',
      '第10章内容',
      '第10章摘要',
      1,
      0,
      null,
      'hash-chapter-10',
      'ready'
    )

    testDb.execute(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, summary,
        revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'chapter-100',
      'novel-001',
      'novel-001:main',
      100,
      '第100章',
      '第100章内容',
      '第100章摘要',
      1,
      0,
      null,
      'hash-chapter-100',
      'ready'
    )

    const whatIfSession = createWhatIfSession(
      {
        id: 'what-if-session-001',
        novelId: 'novel-001',
        baseBranchId: 'novel-001:main',
        sourceChapterNo: 10,
        title: 'IF-01 决裂线',
        premise: '让男主和女主在这里彻底闹掰。',
        selectedText: '原始选区',
        originalText: '原始片段',
        generatedText: '魔改片段',
        status: 'active',
      },
      testDb
    )

    const whatIfDelta = addWhatIfDelta(
      {
        id: 'what-if-delta-001',
        sessionId: 'what-if-session-001',
        deltaType: 'relationship_change',
        subjectName: '男主',
        targetName: '女主',
        subjectEntityId: null,
        targetEntityId: null,
        key: 'relationship',
        oldValue: '暧昧同盟',
        newValue: '决裂 / 不信任',
        validFromChapter: 10,
        description: '两人关系破裂。',
        confidence: 0.9,
      },
      testDb
    )

    const outlineNode = createOutlineNode(
      {
        id: 'outline_event_100',
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        chapterNo: 100,
        title: '女主被反派绑走',
        summary: '反派设局抓走女主。',
        originalOutcome: '男主原线救援。',
        trackKey: 'phase-3',
        phaseLabel: '第三阶段',
        sourceType: 'authored',
        confidence: 1,
        involvedEntities: ['男主', '女主'],
        keyEvents: ['绑走'],
        sortOrder: 100,
      },
      testDb
    )

    const outlineChapter = createOutlineNodeChapter(
      {
        id: 'outline_chapter_100_primary',
        outlineNodeId: 'outline_event_100',
        chapterNo: 100,
        chapterId: 'chapter-100',
        chapterTitle: '第100章 女主被反派绑走',
        isPrimary: true,
        sortOrder: 0,
      },
      testDb
    )

    const ifNode = createStoryTimelineNode(
      {
        id: 'if_fixture_001',
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        nodeType: 'what_if',
        labelIndex: getNextStoryTimelineLabelIndex('novel-001', 'novel-001:main', 'what_if', testDb),
        anchorChapterNo: 10,
        title: 'IF-01 决裂线',
        subtitle: '男主与女主闹掰',
        parentNodeId: null,
        sourceChapterNo: 10,
        targetChapterNo: null,
        chapterId: 'chapter-10',
        continueBlockId: null,
        whatIfSessionId: 'what-if-session-001',
        futureJumpRunId: null,
        laneIndex: 0,
        colorToken: 'purple',
        status: 'active',
      },
      testDb
    )

    const futureJumpRun = await createFutureJumpRunWithInitialRevision(
      {
        id: 'jump-run-001',
        sessionId: 'what-if-session-001',
        baseBranchId: 'novel-001:main',
        parentTimelineNodeId: 'if_fixture_001',
        targetOutlineNodeId: 'outline_event_100',
        targetOutlineChapterId: 'outline_chapter_100_primary',
        sourceChapterNo: 10,
        targetChapterNo: 100,
        userDirection: '男主没有第一时间救援。',
        bridgeSummary: '桥接摘要',
        generatedTargetText: '未来节点正文',
        latestRevisionNo: 1,
        errorMessage: null,
        status: 'generated',
      },
      testDb
    )

    const jumpNode = createStoryTimelineNode(
      {
        id: 'jump_fixture_001',
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        nodeType: 'future_jump',
        labelIndex: getNextStoryTimelineLabelIndex('novel-001', 'novel-001:main', 'future_jump', testDb),
        anchorChapterNo: 100,
        title: 'JUMP-01 女主被绑走',
        subtitle: '男主未救援',
        parentNodeId: 'if_fixture_001',
        sourceChapterNo: 10,
        targetChapterNo: 100,
        chapterId: 'chapter-100',
        continueBlockId: null,
        whatIfSessionId: null,
        futureJumpRunId: 'jump-run-001',
        laneIndex: 0,
        colorToken: 'blue-purple',
        status: 'active',
      },
      testDb
    )

    const revisedRun = await appendFutureJumpRevision(
      {
        runId: 'jump-run-001',
        revisionKind: 'revise',
        userFeedback: '不够虐，让女主以为男主彻底放弃她。',
        bridgeSummary: '新的桥接摘要',
        generatedTargetText: '新的未来节点正文',
      },
      testDb
    )

    expect(findWhatIfSessionById('what-if-session-001', testDb)?.deltas).toHaveLength(1)
    expect(whatIfDelta?.deltaType).toBe('relationship_change')
    expect(findWhatIfSessionById('what-if-session-001', testDb)?.title).toBe('IF-01 决裂线')

    expect(outlineNode?.title).toBe('女主被反派绑走')
    expect(outlineChapter?.chapterNo).toBe(100)
    expect(findOutlineNodeById('outline_event_100', testDb)?.trackKey).toBe('phase-3')
    expect(listOutlineNodeChapters('outline_event_100', testDb)).toHaveLength(1)

    expect(ifNode?.nodeType).toBe('what_if')
    expect(jumpNode?.nodeType).toBe('future_jump')
    expect(findStoryTimelineNodeById('jump_fixture_001', testDb)?.parentNodeId).toBe('if_fixture_001')
    expect(listStoryTimelineNodes('novel-001', 'novel-001:main', testDb)).toHaveLength(2)

    expect(futureJumpRun?.revisions).toHaveLength(1)
    expect(revisedRun?.latestRevisionNo).toBe(2)
    expect(revisedRun?.bridgeSummary).toBe('新的桥接摘要')
    expect(findFutureJumpRunById('jump-run-001', testDb)?.revisions).toHaveLength(2)

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'unit-report.txt'),
      JSON.stringify(
        {
          whatIfSessionId: whatIfSession?.id,
          outlineNodeId: outlineNode?.id,
          futureJumpRunId: revisedRun?.id,
          timelineNodeCount: listStoryTimelineNodes('novel-001', 'novel-001:main', testDb).length,
          revisionCount: findFutureJumpRunById('jump-run-001', testDb)?.revisions.length,
        },
        null,
        2
      )
    )

    ;(database as DatabaseSync & { close?: () => void }).close?.()
  })
})
