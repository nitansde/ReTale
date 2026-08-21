import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FUTURE_MAP_MISSING_SUMMARY_FALLBACK } from '@/lib/story-branch-types'
import { initializeDatabase } from '@/lib/server/sqlite'
import { persistWorkspaceRuntimeState } from '@/lib/server/workspace-resilience'
import type { PersistedNovelState } from '@/lib/types'
import { normalizeWorkspaceState } from '@/lib/workspace-state'
import { registerLegacyNovelDatabase, resetNovelDatabaseTestState } from '@/tests/helpers/novel-db'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const overrideDisposers: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }

function createTestDatabase(prefix: string) {
  const tempDatabase = createTempDatabaseCopy(prefix)
  cleanups.push(tempDatabase.cleanup)
  const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
  overrideDisposers.push(registerLegacyNovelDatabase(database, ['novel-001', 'novel-002']))
  globalForSqlite.sqlite = database
  return database
}

function seedFutureMapFixture(database: DatabaseSync) {
  database.prepare(
    `INSERT INTO NovelRecord (id, title, author, sourceType)
     VALUES (?, ?, ?, ?)`
  ).run('novel-001', 'Fixture Novel', 'Fixture Author', 'txt')

  database.prepare(
    `INSERT INTO StoryBranch (id, novelId, name, baseBranchId)
     VALUES (?, ?, ?, ?)`
  ).run('novel-001:main', 'novel-001', 'main', null)

  database.prepare(
    `INSERT INTO StoryBranch (id, novelId, name, baseBranchId)
     VALUES (?, ?, ?, ?)`
  ).run('novel-001:alt', 'novel-001', 'alt', 'novel-001:main')

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-5', 'novel-001', 'novel-001:main', 5, '第5章', '第5章正文', '第5章摘要', 1, 0, null, 'hash-5', 'ready')

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-10', 'novel-001', 'novel-001:main', 10, '第10章', '第10章正文', '第10章摘要', 1, 0, null, 'hash-10', 'ready')

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-25', 'novel-001', 'novel-001:main', 25, '第25章', '第25章正文', '第25章摘要', 1, 0, null, 'hash-25', 'ready')

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-100', 'novel-001', 'novel-001:main', 100, '第100章 女主被反派绑走', '第100章正文', '原线里男主会及时救人。', 1, 0, null, 'hash-100', 'ready')

  database.prepare(
    `INSERT INTO KnowledgeEvent (
      id, novelId, branchId, name, summary, eventType, chapterNo, lineStart, lineEnd,
      importance, consequences, evidenceSpanId, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('knowledge-event-005', 'novel-001', 'novel-001:main', '早期伏笔节点', '这是源章节之前的候选。', 'minor', 5, null, null, 3, '早期后果', null, 'user_confirmed')

  database.prepare(
    `INSERT INTO KnowledgeEvent (
      id, novelId, branchId, name, summary, eventType, chapterNo, lineStart, lineEnd,
      importance, consequences, evidenceSpanId, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('knowledge-event-100', 'novel-001', 'novel-001:main', '女主被反派绑走', '反派设局抓走女主。', 'major', 100, null, null, 5, '原线里男主会及时救人。', null, 'user_confirmed')

}

function seedFutureJumpDetailFixture(database: DatabaseSync) {
  database.prepare(
    `INSERT INTO what_if_sessions (
      id, novel_id, base_branch_id, source_chapter_no, title, premise,
      selected_text, original_text, generated_text, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('what-if-session-001', 'novel-001', 'novel-001:main', 10, 'IF-01 决裂线', '让男主没有及时救人。', '原始选区', '原始片段', '魔改片段', 'active')

  database.prepare(
    `INSERT INTO outline_nodes (
      id, novel_id, branch_id, chapter_no, title, summary, original_outcome,
      track_key, phase_label, source_type, confidence, involved_entities_json, key_events_json, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('outline_event_100', 'novel-001', 'novel-001:main', 100, '女主被反派绑走', '反派设局抓走女主。', '原线里男主会及时救人。', 'phase-3', '第三阶段', 'authored', 1, '["男主","女主"]', '["绑走"]', 100)

  database.prepare(
    `INSERT INTO outline_node_chapters (
      id, outline_node_id, chapter_no, chapter_id, chapter_title, is_primary, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('outline_chapter_100_primary', 'outline_event_100', 100, 'chapter-100', '第100章 女主被反派绑走', 1, 0)

  database.prepare(
    `INSERT INTO continue_blocks (
      id, novel_id, branch_id, parent_timeline_node_id, source_chapter_no, title, subtitle,
      user_instruction, selected_text, original_text, latest_text, latest_revision_no, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('continue-block-025', 'novel-001', 'novel-001:main', null, 25, 'CONT-02 深入误判', null, '继续误判线', '选区', '原文', '续写正文', 1, 'active')

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, what_if_session_id,
      future_jump_run_id, lane_index, color_token, status, continue_block_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('continue-node-025', 'novel-001', 'novel-001:main', 'continue_block', 2, 25, 'CONT-02 深入误判', null, null, 25, null, 'chapter-25', null, null, 0, 'sky', 'active', 'continue-block-025')

  database.prepare(
    `INSERT INTO future_jump_runs (
      id, session_id, base_branch_id, parent_timeline_node_id, source_timeline_node_id,
      source_timeline_node_type, source_chapter_id, source_what_if_session_id, target_outline_node_id,
      target_outline_chapter_id, source_chapter_no, target_chapter_no, user_direction,
      bridge_summary, generated_target_text, latest_revision_no, error_message, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('jump-run-001', 'what-if-session-001', 'novel-001:main', null, 'continue-node-025', 'continue_block', 'chapter-25', 'what-if-session-001', 'outline_event_100', 'outline_chapter_100_primary', 25, 100, '男主没有第一时间救援。', '桥接摘要', '未来节点正文', 2, null, 'generated')

  database.prepare(
    `INSERT INTO future_jump_revisions (
      id, run_id, revision_no, revision_kind, user_feedback, bridge_summary, generated_target_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('future-jump-revision-001', 'jump-run-001', 1, 'initial', null, '桥接摘要', '未来节点正文')

  database.prepare(
    `INSERT INTO future_jump_revisions (
      id, run_id, revision_no, revision_kind, user_feedback, bridge_summary, generated_target_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('future-jump-revision-002', 'jump-run-001', 2, 'revise', '更虐一点', '新的桥接摘要', '新的未来节点正文')
}

async function seedWorkspaceDirectChapterFallbackFixture(database: DatabaseSync) {
  database.prepare(
    `INSERT INTO NovelRecord (id, title, author, sourceType)
     VALUES (?, ?, ?, ?)`
  ).run('novel-002', 'Workspace Future Map Novel', 'Fixture Author', 'txt')

  database.prepare(
    `INSERT INTO StoryBranch (id, novelId, name, baseBranchId)
     VALUES (?, ?, ?, ?)`
  ).run('novel-002:main', 'novel-002', 'main', null)

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-25', 'novel-002', 'novel-002:main', 25, '第25章', '第25章正文', '第25章摘要', 1, 0, null, 'hash-25', 'ready')

  database.prepare(
    `INSERT INTO outline_nodes (
      id, novel_id, branch_id, chapter_no, title, summary, original_outcome,
      track_key, phase_label, source_type, confidence, involved_entities_json, key_events_json, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('workspace-outline-80', 'novel-002', 'novel-002:main', 80, '第80章 失控分岔', '', null, 'workspace-phase', '工作区阶段', 'authored', 1, '[]', '["失控分岔"]', 80)

  const workspaceState: Partial<PersistedNovelState> = {
    currentNovelId: 'novel-002',
    currentChapterId: 'chapter-25',
    localNovels: [{ id: 'novel-002', title: 'Workspace Future Map Novel', summary: '', tags: [] }],
    localChapters: [
      {
        id: 'chapter-25',
        novelId: 'novel-002',
        title: '第25章',
        order: 25,
        content: '第25章正文',
        status: 'done',
        wordCount: 1200,
        updatedAt: '2026-05-18T00:00:00.000Z',
      },
      {
        id: 'chapter-80',
        novelId: 'novel-002',
        title: '第80章 失控分岔',
        order: 80,
        content: '第80章正文',
        status: 'draft',
        wordCount: 1500,
        updatedAt: '2026-05-18T00:00:00.000Z',
      },
    ],
    localOutlines: [{
      id: 'workspace-outline-80',
      novelId: 'novel-002',
      title: '第80章 失控分岔',
      type: 'main',
      summary: '',
      relatedChapterIds: ['chapter-80'],
    }],
    localCharacters: [],
    localCharacterRelations: [],
    localWorldEntries: [],
    localTimelineEvents: [],
    rewriteCandidates: [],
    rewriteHistory: [],
    trajectories: [],
  }

  await persistWorkspaceRuntimeState(normalizeWorkspaceState(workspaceState), 'singleton', {
    execute: (sql, ...params) => database.prepare(sql).run(...params),
    queryAll: <T>(sql: string, ...params: Array<string | number | bigint | Uint8Array | null>) => database.prepare(sql).all(...params) as T[],
    queryOne: <T>(sql: string, ...params: Array<string | number | bigint | Uint8Array | null>) => (database.prepare(sql).get(...params) ?? null) as T | null,
  })

  database.prepare(
    `INSERT INTO WorkspaceState (id, payload)
     VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updatedAt = CURRENT_TIMESTAMP`
  ).run('singleton', JSON.stringify(workspaceState))
}

afterEach(() => {
  vi.resetModules()

  while (overrideDisposers.length) {
    overrideDisposers.pop()?.()
  }
  resetNovelDatabaseTestState()

  if (globalForSqlite.sqlite) {
    try {
      ;(globalForSqlite.sqlite as DatabaseSync & { close?: () => void }).close?.()
    } catch (_closeError) {
      void _closeError
      // Ignore close failures so teardown can continue removing fixture files.
    }
    delete globalForSqlite.sqlite
  }

  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('story-future-map-read', () => {
  it('bootstraps future-map reads from outline sources and rehydrates future-jump detail records', async () => {
    const database = createTestDatabase('retale-story-future-map-read')
    seedFutureMapFixture(database)
    seedFutureJumpDetailFixture(database)
    vi.resetModules()

    const [{ GET: getFutureMap }, { GET: getFutureJumpRun }] = await Promise.all([
      import('@/app/api/story-future-map/route'),
      import('@/app/api/future-jump/runs/[runId]/route'),
    ])

    const futureMapResponse = await getFutureMap(
      new Request('http://localhost/api/story-future-map?novelId=novel-001&branchId=novel-001:main&sourceChapterNo=25&sourceChapterId=chapter-25&sourceNodeId=continue-node-025&sourceNodeType=continue_block&parentSessionId=what-if-session-001')
    )
    expect(futureMapResponse.status).toBe(200)
    expect(futureMapResponse.headers.get('cache-control')).toBe('no-store')

    const futureMapPayload = await futureMapResponse.json()
    expect(futureMapPayload.branchId).toBe('novel-001:main')
    expect(futureMapPayload.tracks.length).toBeGreaterThan(0)
    expect(futureMapPayload.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'outline_event_100',
        title: '女主被反派绑走',
        sourceType: 'authored',
      }),
    ]))
    expect(futureMapPayload.chaptersByEvent['outline_event_100']).toEqual([
      expect.objectContaining({
        chapterNo: 100,
        chapterId: 'chapter-100',
      }),
    ])
    expect(futureMapPayload.events.every((event: { id: string }) => futureMapPayload.chaptersByEvent[event.id].every((chapter: { chapterNo: number }) => chapter.chapterNo > 25))).toBe(true)
    expect(futureMapPayload.events.find((event: { title: string }) => event.title === '早期伏笔节点')).toBeUndefined()
    expect(futureMapPayload.defaults.selectedTrackKey).toBe(futureMapPayload.events[0].trackKey)
    expect(futureMapPayload.defaults.selectedOutlineNodeId).toBe('outline_event_100')

    const runResponse = await getFutureJumpRun(
      new Request('http://localhost/api/future-jump/runs/jump-run-001?branchId=novel-001:main'),
      { params: Promise.resolve({ runId: 'jump-run-001' }) }
    )
    expect(runResponse.status).toBe(200)
    expect(runResponse.headers.get('cache-control')).toBe('no-store')

    const runPayload = await runResponse.json()
    expect(runPayload).toEqual(expect.objectContaining({
      id: 'jump-run-001',
      baseBranchId: 'novel-001:main',
      sessionId: 'what-if-session-001',
      sourceContext: {
        nodeId: 'continue-node-025',
        nodeType: 'continue_block',
        chapterId: 'chapter-25',
        chapterNo: 25,
        whatIfSessionId: 'what-if-session-001',
      },
      latestRevisionNo: 2,
      bridgeSummary: '桥接摘要',
    }))
    expect(runPayload.revisions).toEqual([
      expect.objectContaining({ revisionNo: 1, revisionKind: 'initial' }),
      expect.objectContaining({ revisionNo: 2, revisionKind: 'revise', generatedTargetText: '新的未来节点正文' }),
    ])
  })

  it('returns validation and branch-isolation errors for future-map and future-jump detail reads', async () => {
    const database = createTestDatabase('retale-story-future-map-read-errors')
    seedFutureMapFixture(database)
    vi.resetModules()

    const [{ GET: getFutureMap }, { GET: getFutureJumpRun }] = await Promise.all([
      import('@/app/api/story-future-map/route'),
      import('@/app/api/future-jump/runs/[runId]/route'),
    ])

    const missingBranchResponse = await getFutureMap(
      new Request('http://localhost/api/story-future-map?novelId=novel-001')
    )
    expect(missingBranchResponse.status).toBe(400)
    expect(missingBranchResponse.headers.get('cache-control')).toBe('no-store')
    await expect(missingBranchResponse.json()).resolves.toEqual({ ok: false, error: 'branchId is required' })

    const missingSourceChapterResponse = await getFutureMap(
      new Request('http://localhost/api/story-future-map?novelId=novel-001&branchId=novel-001:main')
    )
    expect(missingSourceChapterResponse.status).toBe(400)
    await expect(missingSourceChapterResponse.json()).resolves.toEqual({ ok: false, error: 'sourceChapterNo must be a positive integer' })

    const invalidSourceChapterResponse = await getFutureMap(
      new Request('http://localhost/api/story-future-map?novelId=novel-001&branchId=novel-001:main&sourceChapterNo=0')
    )
    expect(invalidSourceChapterResponse.status).toBe(400)
    await expect(invalidSourceChapterResponse.json()).resolves.toEqual({ ok: false, error: 'sourceChapterNo must be a positive integer' })

    const inaccessibleBranchResponse = await getFutureMap(
      new Request('http://localhost/api/story-future-map?novelId=novel-001&branchId=missing&sourceChapterNo=10')
    )
    expect(inaccessibleBranchResponse.status).toBe(404)
    await expect(inaccessibleBranchResponse.json()).resolves.toEqual({
      ok: false,
      error: 'branchId does not belong to the requested novel',
    })

    seedFutureJumpDetailFixture(database)

    const invalidParentSessionResponse = await getFutureMap(
      new Request('http://localhost/api/story-future-map?novelId=novel-001&branchId=novel-001:alt&sourceChapterNo=10&parentSessionId=what-if-session-001')
    )
    expect(invalidParentSessionResponse.status).toBe(404)
    await expect(invalidParentSessionResponse.json()).resolves.toEqual({
      ok: false,
      error: 'parentSessionId not found for the requested branch context',
    })

    const conflictingSourceChapterResponse = await getFutureMap(
      new Request('http://localhost/api/story-future-map?novelId=novel-001&branchId=novel-001:main&sourceChapterNo=10&sourceChapterId=chapter-25&parentSessionId=what-if-session-001')
    )
    expect(conflictingSourceChapterResponse.status).toBe(400)
    await expect(conflictingSourceChapterResponse.json()).resolves.toEqual({
      ok: false,
      error: 'sourceChapterId must match sourceChapterNo',
    })

    const missingContextResponse = await getFutureJumpRun(
      new Request('http://localhost/api/future-jump/runs/jump-run-001'),
      { params: Promise.resolve({ runId: 'jump-run-001' }) }
    )
    expect(missingContextResponse.status).toBe(400)
    expect(missingContextResponse.headers.get('cache-control')).toBe('no-store')
    await expect(missingContextResponse.json()).resolves.toEqual({ ok: false, error: 'branchId is required' })

    const inaccessibleRunResponse = await getFutureJumpRun(
      new Request('http://localhost/api/future-jump/runs/jump-run-001?branchId=novel-001:alt'),
      { params: Promise.resolve({ runId: 'jump-run-001' }) }
    )
    expect(inaccessibleRunResponse.status).toBe(404)
    await expect(inaccessibleRunResponse.json()).resolves.toEqual({
      ok: false,
      error: 'Future jump run not found for the requested branch context',
    })
  })

  it('keeps direct-chapter options available from workspace chapters even when persisted summaries and anchors are missing', async () => {
    const database = createTestDatabase('retale-story-future-map-workspace-fallback')
    await seedWorkspaceDirectChapterFallbackFixture(database)
    vi.resetModules()

    const { GET: getFutureMap } = await import('@/app/api/story-future-map/route')

    const response = await getFutureMap(
      new Request('http://localhost/api/story-future-map?novelId=novel-002&branchId=novel-002:main&sourceChapterNo=25')
    )
    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(payload.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'workspace-outline-80',
        summary: FUTURE_MAP_MISSING_SUMMARY_FALLBACK,
      }),
    ]))
    expect(payload.chaptersByEvent['workspace-outline-80']).toEqual([
      expect.objectContaining({
        chapterNo: 80,
        chapterId: null,
        chapterTitle: '第80章 失控分岔',
      }),
    ])
    expect(payload.events.every((event: { id: string }) => payload.chaptersByEvent[event.id].every((chapter: { chapterNo: number }) => chapter.chapterNo > 25))).toBe(true)
  })
})
