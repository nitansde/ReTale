import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'

const createdDirectories: string[] = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }

const FIXTURE_IDS = {
  novelId: 'novel-roleplay-001',
  branchId: 'novel-roleplay-001:main',
  chapterId: 'chapter-roleplay-12',
  continueBlockId: 'continue-roleplay-12',
  rewriteTimelineNodeId: 'timeline-rewrite-roleplay-12',
  whatIfSessionId: 'what-if-roleplay-12',
  outlineNodeId: 'outline-roleplay-100',
  outlineChapterId: 'outline-roleplay-100-primary',
  futureJumpRunId: 'jump-roleplay-100',
} as const

function makeTempDatabasePath(prefix: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  createdDirectories.push(directory)
  return path.join(directory, 'roleplay-api.db')
}

function createTestDatabase(prefix: string) {
  const database = initializeDatabase(new DatabaseSync(makeTempDatabasePath(prefix)))
  globalForSqlite.sqlite = database
  return database
}

function createFixture(database: DatabaseSync) {
  database.prepare('INSERT INTO NovelRecord (id, title, author, sourceType) VALUES (?, ?, ?, ?)').run(
    FIXTURE_IDS.novelId,
    'Roleplay Fixture Novel',
    'Fixture Author',
    'txt'
  )
  database.prepare('INSERT INTO StoryBranch (id, novelId, name, baseBranchId) VALUES (?, ?, ?, ?)').run(
    FIXTURE_IDS.branchId,
    FIXTURE_IDS.novelId,
    'main',
    null
  )
  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    FIXTURE_IDS.chapterId,
    FIXTURE_IDS.novelId,
    FIXTURE_IDS.branchId,
    12,
    '第12章 夜谈',
    '原始正文：他在窗边停住，迟迟没有开口。',
    '夜谈摘要',
    1,
    0,
    null,
    'chapter-roleplay-12-hash',
    'ready'
  )
  database.prepare(
    `INSERT INTO continue_blocks (
      id, novel_id, branch_id, parent_timeline_node_id, source_chapter_no, title, subtitle,
      user_instruction, selected_text, original_text, latest_text, latest_revision_no, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    FIXTURE_IDS.continueBlockId,
    FIXTURE_IDS.novelId,
    FIXTURE_IDS.branchId,
    null,
    12,
    'RE-01 夜谈延伸',
    null,
    '让对话更压抑。',
    '他在窗边停住，迟迟没有开口。',
    '原始正文：他在窗边停住，迟迟没有开口。',
    'rewrite 正文：风吹动了窗纸，他还是没有转身。',
    1,
    'active'
  )
  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, continue_block_id,
      what_if_session_id, future_jump_run_id, roleplay_session_id, readable_label,
      readable_lineage_label, lane_index, color_token, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    FIXTURE_IDS.rewriteTimelineNodeId,
    FIXTURE_IDS.novelId,
    FIXTURE_IDS.branchId,
    'rewrite',
    1,
    12,
    'RE-01 夜谈延伸',
    null,
    null,
    12,
    null,
    FIXTURE_IDS.chapterId,
    FIXTURE_IDS.continueBlockId,
    null,
    null,
    null,
    'RE-01',
    'RE-01',
    0,
    'sky',
    'active'
  )
  database.prepare(
    `INSERT INTO what_if_sessions (
      id, novel_id, base_branch_id, source_chapter_no, title, premise,
      selected_text, original_text, generated_text, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    FIXTURE_IDS.whatIfSessionId,
    FIXTURE_IDS.novelId,
    FIXTURE_IDS.branchId,
    12,
    'IF-01 先开口',
    '如果她先一步摊牌。',
    '他在窗边停住，迟迟没有开口。',
    '原始正文：他在窗边停住，迟迟没有开口。',
    'what-if 正文：她抢先打破了沉默。',
    'active'
  )
  database.prepare(
    `INSERT INTO outline_nodes (
      id, novel_id, branch_id, chapter_no, title, summary, original_outcome,
      track_key, phase_label, source_type, confidence, involved_entities_json, key_events_json, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    FIXTURE_IDS.outlineNodeId,
    FIXTURE_IDS.novelId,
    FIXTURE_IDS.branchId,
    100,
    '第100章 迟到的真相',
    '真相在更晚的章节才揭开。',
    '原线中双方继续试探。',
    'phase-4',
    '第四阶段',
    'authored',
    1,
    '["他","她"]',
    '["真相揭晓"]',
    100
  )
  database.prepare(
    `INSERT INTO outline_node_chapters (
      id, outline_node_id, chapter_no, chapter_id, chapter_title, is_primary, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    FIXTURE_IDS.outlineChapterId,
    FIXTURE_IDS.outlineNodeId,
    100,
    null,
    '第100章 迟到的真相',
    1,
    0
  )
  database.prepare(
    `INSERT INTO future_jump_runs (
      id, session_id, base_branch_id, parent_timeline_node_id, target_outline_node_id,
      target_outline_chapter_id, source_chapter_no, target_chapter_no, user_direction,
      bridge_summary, generated_target_text, latest_revision_no, error_message, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    FIXTURE_IDS.futureJumpRunId,
    FIXTURE_IDS.whatIfSessionId,
    FIXTURE_IDS.branchId,
    FIXTURE_IDS.rewriteTimelineNodeId,
    FIXTURE_IDS.outlineNodeId,
    FIXTURE_IDS.outlineChapterId,
    12,
    100,
    '让真相在未来章节才爆发。',
    '未来桥接摘要',
    'future-jump 正文：他把真相拖到了更晚的时候。',
    2,
    null,
    'generated'
  )
  database.prepare(
    `INSERT INTO future_jump_revisions (
      id, run_id, revision_no, revision_kind, user_feedback, bridge_summary, generated_target_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'future-jump-revision-001',
    FIXTURE_IDS.futureJumpRunId,
    1,
    'initial',
    null,
    '未来桥接摘要',
    'future-jump 正文：他把真相拖到了更晚的时候。'
  )
  database.prepare(
    `INSERT INTO future_jump_revisions (
      id, run_id, revision_no, revision_kind, user_feedback, bridge_summary, generated_target_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'future-jump-revision-002',
    FIXTURE_IDS.futureJumpRunId,
    2,
    'revise',
    '让悬念更久一点。',
    '新的未来桥接摘要',
    'future-jump 正文：他把真相压得更久。'
  )
}

function snapshotIsolation(database: DatabaseSync) {
  return {
    chapterText: (database.prepare('SELECT rawText FROM KnowledgeChapter WHERE id = ?').get(FIXTURE_IDS.chapterId) as { rawText: string }).rawText,
    continueBlocks: database.prepare(
      'SELECT id, parent_timeline_node_id, latest_text, latest_revision_no, status FROM continue_blocks ORDER BY id ASC'
    ).all() as Array<{
      id: string
      parent_timeline_node_id: string | null
      latest_text: string
      latest_revision_no: number
      status: string
    }>,
    whatIfSessions: database.prepare(
      'SELECT id, generated_text, status FROM what_if_sessions ORDER BY id ASC'
    ).all() as Array<{ id: string; generated_text: string; status: string }>,
    futureJumpRuns: database.prepare(
      'SELECT id, session_id, generated_target_text, latest_revision_no, status FROM future_jump_runs ORDER BY id ASC'
    ).all() as Array<{
      id: string
      session_id: string
      generated_target_text: string
      latest_revision_no: number
      status: string
    }>,
    futureJumpRevisions: database.prepare(
      'SELECT run_id, revision_no, revision_kind, bridge_summary, generated_target_text FROM future_jump_revisions ORDER BY run_id ASC, revision_no ASC'
    ).all() as Array<{
      run_id: string
      revision_no: number
      revision_kind: string
      bridge_summary: string
      generated_target_text: string
    }>,
    timelineRoleplayRows: database.prepare(
      `SELECT id, roleplay_session_id, continue_block_id, what_if_session_id, future_jump_run_id
       FROM story_timeline_nodes
       WHERE roleplay_session_id IS NOT NULL
       ORDER BY id ASC`
    ).all() as Array<{
      id: string
      roleplay_session_id: string
      continue_block_id: string | null
      what_if_session_id: string | null
      future_jump_run_id: string | null
    }>,
  }
}

function createSessionRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/roleplay/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function createMessageRequest(sessionId: string, body: Record<string, unknown>) {
  return new Request(`http://localhost/api/roleplay/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()

  if (globalForSqlite.sqlite) {
    try {
      ;(globalForSqlite.sqlite as DatabaseSync & { close?: () => void }).close?.()
    } catch {
    }
    delete globalForSqlite.sqlite
  }

  while (createdDirectories.length) {
    const directory = createdDirectories.pop()
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe('roleplay session API', () => {
  it('creates a session, appends ordered messages, preserves variant and fork metadata, and keeps non-roleplay tables untouched', async () => {
    const database = createTestDatabase('retale-roleplay-api-success')
    createFixture(database)
    vi.resetModules()

    const beforeIsolation = snapshotIsolation(database)

    const { POST: createSession, GET: listSessions } = await import('@/app/api/roleplay/sessions/route')
    const createResponse = await createSession(createSessionRequest({
      novelId: FIXTURE_IDS.novelId,
      branchId: FIXTURE_IDS.branchId,
      title: 'RP-入口 夜谈分支',
      subtitle: '从 rewrite 节点进入对话',
      sourceChapterId: FIXTURE_IDS.chapterId,
      sourceChapterNo: 12,
      sourceChapterTitle: '第12章 夜谈',
      sourceTimelineNodeId: FIXTURE_IDS.rewriteTimelineNodeId,
      sourceTimelineNodeType: 'rewrite',
      sourceSelectedText: '他在窗边停住，迟迟没有开口。',
      sourceTextSnapshot: 'rewrite 正文：风吹动了窗纸，他还是没有转身。',
      sourceSelectedLineStart: 8,
      sourceSelectedLineEnd: 8,
    }))

    expect(createResponse.status).toBe(201)
    const createPayload = await createResponse.json() as { sessionId: string; timelineNodeId: string }
    expect(createPayload.sessionId).toBeTruthy()
    expect(createPayload.timelineNodeId).toBeTruthy()

    const listResponse = await listSessions(new Request(`http://localhost/api/roleplay/sessions?novelId=${FIXTURE_IDS.novelId}`))
    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toMatchObject({
      sessions: [
        expect.objectContaining({
          id: createPayload.sessionId,
          branchId: FIXTURE_IDS.branchId,
          sourceChapterId: FIXTURE_IDS.chapterId,
          sourceTimelineNodeId: FIXTURE_IDS.rewriteTimelineNodeId,
        }),
      ],
    })

    const createdTimelineNode = database.prepare(
      `SELECT parent_node_id, roleplay_session_id, node_type, chapter_id,
              continue_block_id, what_if_session_id, future_jump_run_id
       FROM story_timeline_nodes
       WHERE id = ?`
    ).get(createPayload.timelineNodeId) as {
      parent_node_id: string | null
      roleplay_session_id: string | null
      node_type: string
      chapter_id: string | null
      continue_block_id: string | null
      what_if_session_id: string | null
      future_jump_run_id: string | null
    }
    expect(createdTimelineNode).toEqual({
      parent_node_id: FIXTURE_IDS.rewriteTimelineNodeId,
      roleplay_session_id: createPayload.sessionId,
      node_type: 'roleplay_session',
      chapter_id: FIXTURE_IDS.chapterId,
      continue_block_id: null,
      what_if_session_id: null,
      future_jump_run_id: null,
    })

    const { POST: appendMessage } = await import('@/app/api/roleplay/sessions/[sessionId]/messages/route')

    const firstMessageResponse = await appendMessage(
      createMessageRequest(createPayload.sessionId, {
        role: 'user',
        content: '如果她先开口，会不会把真相说出来？',
      }),
      { params: Promise.resolve({ sessionId: createPayload.sessionId }) }
    )
    expect(firstMessageResponse.status).toBe(201)
    const firstMessage = await firstMessageResponse.json() as { id: string; turnIndex: number; variantIndex: number }
    expect(firstMessage.turnIndex).toBe(1)
    expect(firstMessage.variantIndex).toBe(1)

    const secondMessageResponse = await appendMessage(
      createMessageRequest(createPayload.sessionId, {
        role: 'assistant',
        content: '她会先试探，再把最关键的一句压回去。',
        parentMessageId: firstMessage.id,
      }),
      { params: Promise.resolve({ sessionId: createPayload.sessionId }) }
    )
    expect(secondMessageResponse.status).toBe(201)
    const secondMessage = await secondMessageResponse.json() as { id: string; turnIndex: number; variantIndex: number }
    expect(secondMessage.turnIndex).toBe(2)
    expect(secondMessage.variantIndex).toBe(1)

    const variantMessageResponse = await appendMessage(
      createMessageRequest(createPayload.sessionId, {
        mode: 'latest-turn-variant',
        role: 'assistant',
        content: '她先把视线移开，只把真相说到一半，像是在给自己留退路。',
      }),
      { params: Promise.resolve({ sessionId: createPayload.sessionId }) }
    )
    expect(variantMessageResponse.status).toBe(201)
    const variantMessage = await variantMessageResponse.json() as {
      id: string
      turnIndex: number
      variantIndex: number
      variantGroupId: string | null
      parentMessageId: string | null
      forkedFromMessageId: string | null
    }
    expect(variantMessage.turnIndex).toBe(2)
    expect(variantMessage.variantIndex).toBe(2)
    expect(variantMessage.variantGroupId).toBeTruthy()
    expect(variantMessage.parentMessageId).toBe(firstMessage.id)
    expect(variantMessage.forkedFromMessageId).toBe(secondMessage.id)

    const fourthMessageResponse = await appendMessage(
      createMessageRequest(createPayload.sessionId, {
        role: 'user',
        content: '那他会不会听懂她没说出口的部分？',
        parentMessageId: variantMessage.id,
        forkedFromMessageId: secondMessage.id,
      }),
      { params: Promise.resolve({ sessionId: createPayload.sessionId }) }
    )
    expect(fourthMessageResponse.status).toBe(201)

    const storedMessages = database.prepare(
      `SELECT message_index, turn_index, variant_index, role, content,
              parent_message_id, forked_from_message_id, variant_group_id
       FROM roleplay_messages
       WHERE session_id = ?
       ORDER BY message_index ASC`
    ).all(createPayload.sessionId) as Array<{
      message_index: number
      turn_index: number
      variant_index: number
      role: 'user' | 'assistant'
      content: string
      parent_message_id: string | null
      forked_from_message_id: string | null
      variant_group_id: string | null
    }>
    expect(storedMessages).toEqual([
      {
        message_index: 1,
        turn_index: 1,
        variant_index: 1,
        role: 'user',
        content: '如果她先开口，会不会把真相说出来？',
        parent_message_id: null,
        forked_from_message_id: null,
        variant_group_id: null,
      },
      {
        message_index: 2,
        turn_index: 2,
        variant_index: 1,
        role: 'assistant',
        content: '她会先试探，再把最关键的一句压回去。',
        parent_message_id: firstMessage.id,
        forked_from_message_id: null,
        variant_group_id: variantMessage.variantGroupId,
      },
      {
        message_index: 3,
        turn_index: 2,
        variant_index: 2,
        role: 'assistant',
        content: '她先把视线移开，只把真相说到一半，像是在给自己留退路。',
        parent_message_id: firstMessage.id,
        forked_from_message_id: secondMessage.id,
        variant_group_id: variantMessage.variantGroupId,
      },
      {
        message_index: 4,
        turn_index: 3,
        variant_index: 1,
        role: 'user',
        content: '那他会不会听懂她没说出口的部分？',
        parent_message_id: variantMessage.id,
        forked_from_message_id: secondMessage.id,
        variant_group_id: null,
      },
    ])

    const { GET: getSession } = await import('@/app/api/roleplay/sessions/[sessionId]/route')
    const getResponse = await getSession(
      new Request(`http://localhost/api/roleplay/sessions/${createPayload.sessionId}?novelId=${FIXTURE_IDS.novelId}&branchId=${FIXTURE_IDS.branchId}`),
      { params: Promise.resolve({ sessionId: createPayload.sessionId }) }
    )

    expect(getResponse.status).toBe(200)
    const sessionPayload = await getResponse.json() as {
      id: string
      timelineNodeId: string | null
      sourceSnapshot: {
        chapterId: string | null
        chapterNo: number
        chapterTitle: string | null
        timelineNodeId: string | null
        timelineNodeType: string | null
        selectedText: string
        textSnapshot: string
        selectedLineStart: number | null
        selectedLineEnd: number | null
      }
      messages: Array<{
        id: string
        role: 'user' | 'assistant'
        messageIndex: number
        turnIndex: number
        variantIndex: number
        parentMessageId: string | null
        forkedFromMessageId: string | null
        variantGroupId: string | null
        variantMetadata: { turnIndex: number; variantIndex: number; variantGroupId: string | null }
        forkMetadata: { parentMessageId: string | null; forkedFromMessageId: string | null }
      }>
    }

    expect(sessionPayload.id).toBe(createPayload.sessionId)
    expect(sessionPayload.timelineNodeId).toBe(createPayload.timelineNodeId)
    expect(sessionPayload.sourceSnapshot).toEqual({
      chapterId: FIXTURE_IDS.chapterId,
      chapterNo: 12,
      chapterTitle: '第12章 夜谈',
      timelineNodeId: FIXTURE_IDS.rewriteTimelineNodeId,
      timelineNodeType: 'rewrite',
      selectedText: '他在窗边停住，迟迟没有开口。',
      textSnapshot: 'rewrite 正文：风吹动了窗纸，他还是没有转身。',
      selectedLineStart: 8,
      selectedLineEnd: 8,
    })
    expect(sessionPayload.messages.map((message) => message.messageIndex)).toEqual([1, 2, 3, 4])
    expect(sessionPayload.messages.map((message) => message.turnIndex)).toEqual([1, 2, 2, 3])
    expect(sessionPayload.messages.map((message) => message.variantIndex)).toEqual([1, 1, 2, 1])
    expect(sessionPayload.messages[2]?.variantMetadata).toEqual({
      turnIndex: 2,
      variantIndex: 2,
      variantGroupId: variantMessage.variantGroupId,
    })
    expect(sessionPayload.messages[2]?.forkMetadata).toEqual({
      parentMessageId: firstMessage.id,
      forkedFromMessageId: secondMessage.id,
    })
    expect(sessionPayload.messages[3]?.forkMetadata).toEqual({
      parentMessageId: variantMessage.id,
      forkedFromMessageId: secondMessage.id,
    })

    const afterIsolation = snapshotIsolation(database)
    expect(afterIsolation.chapterText).toBe(beforeIsolation.chapterText)
    expect(afterIsolation.continueBlocks).toEqual(beforeIsolation.continueBlocks)
    expect(afterIsolation.whatIfSessions).toEqual(beforeIsolation.whatIfSessions)
    expect(afterIsolation.futureJumpRuns).toEqual(beforeIsolation.futureJumpRuns)
    expect(afterIsolation.futureJumpRevisions).toEqual(beforeIsolation.futureJumpRevisions)
    expect(afterIsolation.timelineRoleplayRows).toEqual([
      {
        id: createPayload.timelineNodeId,
        roleplay_session_id: createPayload.sessionId,
        continue_block_id: null,
        what_if_session_id: null,
        future_jump_run_id: null,
      },
    ])
  })

  it('returns 404 for invalid roleplay session ids on load and append', async () => {
    createTestDatabase('retale-roleplay-api-not-found')
    vi.resetModules()

    const { GET } = await import('@/app/api/roleplay/sessions/[sessionId]/route')
    const missingSessionResponse = await GET(
      new Request('http://localhost/api/roleplay/sessions/missing-session?novelId=novel-roleplay-001&branchId=novel-roleplay-001:main'),
      { params: Promise.resolve({ sessionId: 'missing-session' }) }
    )
    expect(missingSessionResponse.status).toBe(404)
    await expect(missingSessionResponse.json()).resolves.toEqual({
      ok: false,
      error: 'Roleplay session not found for the requested branch context',
    })

    const { POST } = await import('@/app/api/roleplay/sessions/[sessionId]/messages/route')
    const appendResponse = await POST(
      createMessageRequest('missing-session', { role: 'user', content: 'hello' }),
      { params: Promise.resolve({ sessionId: 'missing-session' }) }
    )
    expect(appendResponse.status).toBe(404)
    await expect(appendResponse.json()).resolves.toEqual({ ok: false, error: 'Roleplay session not found: missing-session' })
  })

  it('rejects invalid source timeline ids without creating a session or orphan timeline node', async () => {
    const database = createTestDatabase('retale-roleplay-api-invalid-source-node')
    createFixture(database)
    vi.resetModules()

    const beforeSessionCount = (database.prepare('SELECT COUNT(*) AS count FROM roleplay_sessions').get() as { count: number }).count
    const beforeTimelineNodeCount = (database.prepare('SELECT COUNT(*) AS count FROM story_timeline_nodes').get() as { count: number }).count

    const { POST: createSession } = await import('@/app/api/roleplay/sessions/route')
    const response = await createSession(createSessionRequest({
      novelId: FIXTURE_IDS.novelId,
      branchId: FIXTURE_IDS.branchId,
      title: 'RP-入口 无效父节点',
      subtitle: '应该返回稳定错误',
      sourceChapterId: FIXTURE_IDS.chapterId,
      sourceChapterNo: 12,
      sourceChapterTitle: '第12章 夜谈',
      sourceTimelineNodeId: 'missing-timeline-node',
      sourceTimelineNodeType: 'rewrite',
      sourceSelectedText: '他在窗边停住，迟迟没有开口。',
      sourceTextSnapshot: 'rewrite 正文：风吹动了窗纸，他还是没有转身。',
      sourceSelectedLineStart: 8,
      sourceSelectedLineEnd: 8,
    }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Source timeline node not found: missing-timeline-node' })
    expect((database.prepare('SELECT COUNT(*) AS count FROM roleplay_sessions').get() as { count: number }).count).toBe(beforeSessionCount)
    expect((database.prepare('SELECT COUNT(*) AS count FROM story_timeline_nodes').get() as { count: number }).count).toBe(beforeTimelineNodeCount)
  })
})
