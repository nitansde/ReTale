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

function seedTimelineFixture(database: DatabaseSync) {
  database.prepare(
    `INSERT INTO NovelRecord (id, title, author, sourceType)
     VALUES (?, ?, ?, ?)`
  ).run('novel-001', 'Fixture Novel', 'Fixture Author', 'txt')

  database.prepare(
    `INSERT INTO NovelRecord (id, title, author, sourceType)
     VALUES (?, ?, ?, ?)`
  ).run('novel-002', 'Other Novel', 'Other Author', 'txt')

  database.prepare(
    `INSERT INTO StoryBranch (id, novelId, name, baseBranchId)
     VALUES (?, ?, ?, ?)`
  ).run('novel-001:main', 'novel-001', 'main', null)

  database.prepare(
    `INSERT INTO StoryBranch (id, novelId, name, baseBranchId)
     VALUES (?, ?, ?, ?)`
  ).run('novel-001:alt', 'novel-001', 'alt', 'novel-001:main')

  database.prepare(
    `INSERT INTO StoryBranch (id, novelId, name, baseBranchId)
     VALUES (?, ?, ?, ?)`
  ).run('novel-002:main', 'novel-002', 'main', null)

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-10', 'novel-001', 'novel-001:main', 10, '第10章 结盟', '男主和女主暂时结盟。', '第10章摘要', 1, 0, null, 'hash-10', 'ready')

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-100', 'novel-001', 'novel-001:main', 100, '第100章 被绑走', '女主在第100章被反派绑走。', '第100章摘要', 1, 0, null, 'hash-100', 'ready')

  database.prepare(
    `INSERT INTO what_if_sessions (
      id, novel_id, base_branch_id, source_chapter_no, title, premise,
      selected_text, original_text, generated_text, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('what-if-session-001', 'novel-001', 'novel-001:main', 10, 'IF-01 决裂线', '让两人提前决裂。', '原始选区', '原始片段', '魔改片段', 'active')

  database.prepare(
    `INSERT INTO what_if_deltas (
      id, session_id, delta_type, subject_name, target_name, subject_entity_id, target_entity_id,
      key, old_value, new_value, valid_from_chapter, description, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('what-if-delta-001', 'what-if-session-001', 'relationship_change', '男主', '女主', null, null, 'relationship', '信任', '决裂', 10, '两人关系破裂。', 0.9)

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
  ).run('jump-run-001', 'what-if-session-001', 'novel-001:main', null, 'outline_event_100', 'outline_chapter_100_primary', 10, 100, '男主没有第一时间救援。', '桥接摘要', '未来节点正文', 1, null, 'generated')

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, what_if_session_id,
      future_jump_run_id, lane_index, color_token, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('if_fixture_001', 'novel-001', 'novel-001:main', 'what_if', 1, 10, 'IF-01 决裂线', '如果他们在这里闹翻', null, 10, null, 'chapter-10', 'what-if-session-001', null, 0, 'rose', 'active')

  database.prepare(
    `INSERT INTO continue_blocks (
      id, novel_id, branch_id, parent_timeline_node_id, source_chapter_no, title, subtitle,
      user_instruction, selected_text, original_text, latest_text, latest_revision_no, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('continue-block-001', 'novel-001', 'novel-001:main', null, 10, 'RE-01 第一版改写', '首个改写结果', '保存这版改写。', '原始选区', '原始片段', '改写后的正文', 1, 'active')

  database.prepare(
    `INSERT INTO continue_blocks (
      id, novel_id, branch_id, parent_timeline_node_id, source_chapter_no, title, subtitle,
      user_instruction, selected_text, original_text, latest_text, latest_revision_no, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('continue-block-002', 'novel-001', 'novel-001:main', null, 10, 'RE-01, CONT-01 续写块', '沿着分支继续推进', '继续沿着当前分支扩展。', '改写后的正文', '改写后的正文', '续写后的正文', 1, 'active')

  database.prepare(
    `INSERT INTO continue_blocks (
      id, novel_id, branch_id, parent_timeline_node_id, source_chapter_no, title, subtitle,
      user_instruction, selected_text, original_text, latest_text, latest_revision_no, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('continue-block-003', 'novel-001', 'novel-001:main', null, 10, 'RE-01, CONT-01, CONT-02 深层续写块', '沿着同一路径继续推进', '继续沿着当前续写块向下扩展。', '续写后的正文', '续写后的正文', '更深层的续写正文', 1, 'active')

  database.prepare(
    `INSERT INTO continue_block_revisions (
      id, continue_block_id, revision_no, revision_kind, user_instruction, selected_text,
      original_text, generated_text, title, subtitle
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('continue-revision-001', 'continue-block-001', 1, 'initial', '保存这版改写。', '原始选区', '原始片段', '改写后的正文', 'RE-01 第一版改写', '首个改写结果')

  database.prepare(
    `INSERT INTO continue_block_revisions (
      id, continue_block_id, revision_no, revision_kind, user_instruction, selected_text,
      original_text, generated_text, title, subtitle
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('continue-revision-002', 'continue-block-002', 1, 'initial', '继续沿着当前分支扩展。', '改写后的正文', '改写后的正文', '续写后的正文', 'RE-01, CONT-01 续写块', '沿着分支继续推进')

  database.prepare(
    `INSERT INTO continue_block_revisions (
      id, continue_block_id, revision_no, revision_kind, user_instruction, selected_text,
      original_text, generated_text, title, subtitle
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('continue-revision-003', 'continue-block-003', 1, 'initial', '继续沿着当前续写块向下扩展。', '续写后的正文', '续写后的正文', '更深层的续写正文', 'RE-01, CONT-01, CONT-02 深层续写块', '沿着同一路径继续推进')

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, continue_block_id,
      what_if_session_id, future_jump_run_id, lane_index, color_token, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('rewrite_fixture_001', 'novel-001', 'novel-001:main', 'rewrite', 1, 10, 'RE-01 第一版改写', '首个改写结果', null, 10, null, null, 'continue-block-001', null, null, 0, 'fuchsia', 'active')

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, continue_block_id,
      what_if_session_id, future_jump_run_id, lane_index, color_token, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('continue_fixture_001', 'novel-001', 'novel-001:main', 'continue_block', 1, 10, 'RE-01, CONT-01 续写块', '沿着分支继续推进', 'rewrite_fixture_001', 10, null, null, 'continue-block-002', null, null, 1, 'fuchsia', 'active')

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, continue_block_id,
      what_if_session_id, future_jump_run_id, lane_index, color_token, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('continue_fixture_002', 'novel-001', 'novel-001:main', 'continue_block', 2, 10, 'RE-01, CONT-01, CONT-02 深层续写块', '沿着同一路径继续推进', 'continue_fixture_001', 10, null, null, 'continue-block-003', null, null, 2, 'fuchsia', 'active')

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, continue_block_id,
      what_if_session_id, future_jump_run_id, lane_index, color_token, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('jump_fixture_001', 'novel-001', 'novel-001:main', 'future_jump', 1, 100, 'RE-01, JUMP-01 第100章', '跳到被绑走后的未来', 'rewrite_fixture_001', 10, 100, 'chapter-100', null, null, 'jump-run-001', 1, 'violet', 'generated')
}

afterEach(() => {
  vi.resetModules()

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

describe('story-timeline-read', () => {
  it('returns chapters, authored branch nodes, derived edges, and rehydrates what-if detail records', async () => {
    const database = createTestDatabase('chatbook-story-timeline-read')
    seedTimelineFixture(database)
    vi.resetModules()

    const [{ GET: getStoryTimeline }, { GET: getWhatIfSession }] = await Promise.all([
      import('@/app/api/story-timeline/route'),
      import('@/app/api/what-if/sessions/[sessionId]/route'),
    ])

    const timelineResponse = await getStoryTimeline(
      new Request('http://localhost/api/story-timeline?novelId=novel-001&branchId=main')
    )
    expect(timelineResponse.status).toBe(200)

    const timelinePayload = await timelineResponse.json()
    expect(timelinePayload.branchId).toBe('novel-001:main')
    expect(timelinePayload.chapters.map((chapter: { chapterNo: number }) => chapter.chapterNo)).toEqual([10, 100])
    expect(timelinePayload.chapters[0].wordCount).toBeGreaterThan(0)
    expect(timelinePayload.branchNodes).toEqual([
      expect.objectContaining({
        id: 'if_fixture_001',
        nodeType: 'what_if',
        anchorChapterNo: 10,
        whatIfSessionId: 'what-if-session-001',
      }),
      expect.objectContaining({
        id: 'rewrite_fixture_001',
        nodeType: 'rewrite',
        readableLabel: 'RE-01',
        readableLineageLabel: 'RE-01',
        continueBlockId: 'continue-block-001',
        latestText: '改写后的正文',
      }),
      expect.objectContaining({
        id: 'continue_fixture_001',
        nodeType: 'continue_block',
        readableLabel: 'CONT-01',
        readableLineageLabel: 'RE-01, CONT-01',
        parentNodeId: 'rewrite_fixture_001',
        laneIndex: 1,
        continueBlockId: 'continue-block-002',
        latestText: '续写后的正文',
        latestRevisionNo: 1,
        userInstruction: '继续沿着当前分支扩展。',
        selectedText: '改写后的正文',
        originalText: '改写后的正文',
      }),
      expect.objectContaining({
        id: 'continue_fixture_002',
        nodeType: 'continue_block',
        readableLabel: 'CONT-02',
        readableLineageLabel: 'RE-01, CONT-01, CONT-02',
        parentNodeId: 'continue_fixture_001',
        laneIndex: 1,
        continueBlockId: 'continue-block-003',
        latestText: '更深层的续写正文',
        latestRevisionNo: 1,
        userInstruction: '继续沿着当前续写块向下扩展。',
        selectedText: '续写后的正文',
        originalText: '续写后的正文',
      }),
      expect.objectContaining({
        id: 'jump_fixture_001',
        nodeType: 'future_jump',
        readableLabel: 'JUMP-01',
        readableLineageLabel: 'RE-01, JUMP-01',
        parentNodeId: 'rewrite_fixture_001',
        laneIndex: 0,
        futureJumpRunId: 'jump-run-001',
      }),
    ])
    expect(timelinePayload.edges).toEqual([
      { fromNodeId: 'rewrite_fixture_001', toNodeId: 'continue_fixture_001' },
      { fromNodeId: 'continue_fixture_001', toNodeId: 'continue_fixture_002' },
      { fromNodeId: 'rewrite_fixture_001', toNodeId: 'jump_fixture_001' },
    ])
    expect(timelinePayload.branchNodes.map((node: { id: string; laneIndex: number }) => ({ id: node.id, laneIndex: node.laneIndex }))).toEqual([
      { id: 'if_fixture_001', laneIndex: 0 },
      { id: 'rewrite_fixture_001', laneIndex: 0 },
      { id: 'continue_fixture_001', laneIndex: 1 },
      { id: 'continue_fixture_002', laneIndex: 1 },
      { id: 'jump_fixture_001', laneIndex: 0 },
    ])

    const sessionResponse = await getWhatIfSession(
      new Request('http://localhost/api/what-if/sessions/what-if-session-001?novelId=novel-001&branchId=novel-001:main'),
      { params: Promise.resolve({ sessionId: 'what-if-session-001' }) }
    )
    expect(sessionResponse.status).toBe(200)

    const sessionPayload = await sessionResponse.json()
    expect(sessionPayload).toEqual(expect.objectContaining({
      id: 'what-if-session-001',
      baseBranchId: 'novel-001:main',
      title: 'IF-01 决裂线',
    }))
    expect(sessionPayload.deltas).toEqual([
      expect.objectContaining({
        id: 'what-if-delta-001',
        newValue: '决裂',
      }),
    ])
  })

  it('returns validation and branch-isolation errors for timeline and what-if detail reads', async () => {
    const database = createTestDatabase('chatbook-story-timeline-read-errors')
    seedTimelineFixture(database)
    vi.resetModules()

    const [{ GET: getStoryTimeline }, { GET: getWhatIfSession }] = await Promise.all([
      import('@/app/api/story-timeline/route'),
      import('@/app/api/what-if/sessions/[sessionId]/route'),
    ])

    const missingBranchResponse = await getStoryTimeline(
      new Request('http://localhost/api/story-timeline?novelId=novel-001')
    )
    expect(missingBranchResponse.status).toBe(400)
    await expect(missingBranchResponse.json()).resolves.toEqual({ ok: false, error: 'branchId is required' })

    const inaccessibleBranchResponse = await getStoryTimeline(
      new Request('http://localhost/api/story-timeline?novelId=novel-001&branchId=novel-002:main')
    )
    expect(inaccessibleBranchResponse.status).toBe(404)
    await expect(inaccessibleBranchResponse.json()).resolves.toEqual({
      ok: false,
      error: 'branchId does not belong to the requested novel',
    })

    const missingContextResponse = await getWhatIfSession(
      new Request('http://localhost/api/what-if/sessions/what-if-session-001?branchId=novel-001:main'),
      { params: Promise.resolve({ sessionId: 'what-if-session-001' }) }
    )
    expect(missingContextResponse.status).toBe(400)
    await expect(missingContextResponse.json()).resolves.toEqual({ ok: false, error: 'novelId is required' })

    const inaccessibleSessionResponse = await getWhatIfSession(
      new Request('http://localhost/api/what-if/sessions/what-if-session-001?novelId=novel-001&branchId=novel-001:alt'),
      { params: Promise.resolve({ sessionId: 'what-if-session-001' }) }
    )
    expect(inaccessibleSessionResponse.status).toBe(404)
    await expect(inaccessibleSessionResponse.json()).resolves.toEqual({
      ok: false,
      error: 'What-if session not found for the requested branch context',
    })
  })
})
