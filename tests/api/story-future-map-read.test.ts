import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'
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
    `INSERT INTO future_jump_runs (
      id, session_id, base_branch_id, parent_timeline_node_id, target_outline_node_id,
      target_outline_chapter_id, source_chapter_no, target_chapter_no, user_direction,
      bridge_summary, generated_target_text, latest_revision_no, error_message, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('jump-run-001', 'what-if-session-001', 'novel-001:main', null, 'outline_event_100', 'outline_chapter_100_primary', 10, 100, '男主没有第一时间救援。', '桥接摘要', '未来节点正文', 2, null, 'generated')

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

afterEach(() => {
  vi.resetModules()

  if (globalForSqlite.sqlite) {
    try {
      globalForSqlite.sqlite.close()
    } catch {
    }
    delete globalForSqlite.sqlite
  }

  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('story-future-map-read', () => {
  it('bootstraps future-map reads from outline sources and rehydrates future-jump detail records', async () => {
    const database = createTestDatabase('chatbook-story-future-map-read')
    seedFutureMapFixture(database)
    seedFutureJumpDetailFixture(database)
    vi.resetModules()

    const [{ GET: getFutureMap }, { GET: getFutureJumpRun }] = await Promise.all([
      import('@/app/api/story-future-map/route'),
      import('@/app/api/future-jump/runs/[runId]/route'),
    ])

    const futureMapResponse = await getFutureMap(
      new Request('http://localhost/api/story-future-map?novelId=novel-001&branchId=novel-001:main&sourceChapterNo=10&parentSessionId=what-if-session-001')
    )
    expect(futureMapResponse.status).toBe(200)

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
    expect(futureMapPayload.events.every((event: { id: string }) => futureMapPayload.chaptersByEvent[event.id].every((chapter: { chapterNo: number }) => chapter.chapterNo > 10))).toBe(true)
    expect(futureMapPayload.events.find((event: { title: string }) => event.title === '早期伏笔节点')).toBeUndefined()
    expect(futureMapPayload.defaults.selectedTrackKey).toBe(futureMapPayload.events[0].trackKey)
    expect(futureMapPayload.defaults.selectedOutlineNodeId).toBe('outline_event_100')

    const runResponse = await getFutureJumpRun(
      new Request('http://localhost/api/future-jump/runs/jump-run-001?branchId=novel-001:main'),
      { params: Promise.resolve({ runId: 'jump-run-001' }) }
    )
    expect(runResponse.status).toBe(200)

    const runPayload = await runResponse.json()
    expect(runPayload).toEqual(expect.objectContaining({
      id: 'jump-run-001',
      baseBranchId: 'novel-001:main',
      latestRevisionNo: 2,
      bridgeSummary: '桥接摘要',
    }))
    expect(runPayload.revisions).toEqual([
      expect.objectContaining({ revisionNo: 1, revisionKind: 'initial' }),
      expect.objectContaining({ revisionNo: 2, revisionKind: 'revise', generatedTargetText: '新的未来节点正文' }),
    ])
  })

  it('returns validation and branch-isolation errors for future-map and future-jump detail reads', async () => {
    const database = createTestDatabase('chatbook-story-future-map-read-errors')
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
      new Request('http://localhost/api/story-future-map?novelId=novel-001&branchId=novel-001:main&sourceChapterNo=11&parentSessionId=what-if-session-001')
    )
    expect(conflictingSourceChapterResponse.status).toBe(400)
    await expect(conflictingSourceChapterResponse.json()).resolves.toEqual({
      ok: false,
      error: 'sourceChapterNo must match parentSessionId source chapter',
    })

    const missingContextResponse = await getFutureJumpRun(
      new Request('http://localhost/api/future-jump/runs/jump-run-001'),
      { params: Promise.resolve({ runId: 'jump-run-001' }) }
    )
    expect(missingContextResponse.status).toBe(400)
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
})
