import { createScopedDatabaseFixture } from '@/tests/helpers/database-fixture'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'

const databaseFixture = createScopedDatabaseFixture()

const createdDirectories: string[] = []
const originalDataDir = process.env.RETALE_DATA_DIR

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

function createTestDatabase(prefix: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-data-`))
  createdDirectories.push(directory)
  const dataRoot = path.join(directory, 'data')
  const databasePath = path.join(dataRoot, 'novels', FIXTURE_IDS.novelId, 'novel.db')
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  process.env.RETALE_DATA_DIR = dataRoot
  const database = initializeDatabase(new DatabaseSync(databasePath))
  databaseFixture.database = database
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
      id, source_what_if_session_id, source_timeline_node_type, source_text_snapshot, base_branch_id, parent_timeline_node_id, target_outline_node_id,
      target_outline_chapter_id, source_chapter_no, target_chapter_no, user_direction,
      bridge_summary, generated_target_text, latest_revision_no, error_message, status
    ) VALUES (?, ?, 'what_if', 'What-if 正文', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      'SELECT id, source_what_if_session_id, generated_target_text, latest_revision_no, status FROM future_jump_runs ORDER BY id ASC'
    ).all() as Array<{
      id: string
      source_what_if_session_id: string | null
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
    body: JSON.stringify({ novelId: FIXTURE_IDS.novelId, branchId: FIXTURE_IDS.branchId, ...body }),
  })
}

afterEach(databaseFixture.wrap(async () => {
  vi.restoreAllMocks()
  vi.resetModules()

  if (databaseFixture.database) {
    try {
      ;(databaseFixture.database as DatabaseSync & { close?: () => void }).close?.()
    } catch {
    }
    delete databaseFixture.database
  }

  const resolver = await import('@/lib/server/db-resolver')
  resolver.resetResolvedDatabasesForTests()
  if (originalDataDir === undefined) delete process.env.RETALE_DATA_DIR
  else process.env.RETALE_DATA_DIR = originalDataDir

  while (createdDirectories.length) {
    const directory = createdDirectories.pop()
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
}))

describe('roleplay session API', () => {
  it('deletes a route transactionally while retaining shared ancestors, nested siblings and fork metadata', databaseFixture.wrap(async () => {
    const database = createTestDatabase('retale-roleplay-branch-delete')
    createFixture(database)
    const { POST: createSession } = await import('@/app/api/roleplay/sessions/route')
    const { POST: appendMessage, DELETE: removeMessages } = await import('@/app/api/roleplay/sessions/[sessionId]/messages/route')
    const response = await createSession(createSessionRequest({ novelId: FIXTURE_IDS.novelId, branchId: FIXTURE_IDS.branchId, title: '删除分支', sourceChapterId: FIXTURE_IDS.chapterId, sourceChapterNo: 12, sourceSelectedText: '雨夜', sourceTextSnapshot: '雨夜正文' }))
    const { sessionId } = await response.json() as { sessionId: string }
    const context = { params: Promise.resolve({ sessionId }) }
    const append = async (id: string, role: string, parentMessageId: string | null, forkedFromMessageId: string | null = null) => {
      expect((await appendMessage(createMessageRequest(sessionId, { id, role, parentMessageId, forkedFromMessageId, content: id }), context)).status).toBe(201)
    }
    const remove = (messageId: string, extra = {}, targetSession = sessionId) => removeMessages(new Request(`http://localhost/api/roleplay/sessions/${targetSession}/messages`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ novelId: FIXTURE_IDS.novelId, branchId: FIXTURE_IDS.branchId, messageId, mode: 'branch', ...extra }),
    }), { params: Promise.resolve({ sessionId: targetSession }) })
    const read = () => database.prepare('SELECT id, parent_message_id, forked_from_message_id FROM roleplay_messages ORDER BY message_index').all()
    await append('u1', 'user', null)
    await append('a1', 'assistant', 'u1')
    await append('u2', 'user', 'a1')
    await append('a2', 'assistant', 'u2')
    await append('a2-alt', 'assistant', 'u2', 'a2')
    await append('u3', 'user', 'a2')
    await append('a3', 'assistant', 'u3')
    await append('other-root', 'user', null)
    const before = read()
    expect((await remove('a3', { branchId: 'wrong' })).status).toBe(404)
    expect((await remove('a3', {}, 'missing-session')).status).toBe(404)
    const otherResponse = await createSession(createSessionRequest({ novelId: FIXTURE_IDS.novelId, branchId: FIXTURE_IDS.branchId, title: '其他会话', sourceChapterId: FIXTURE_IDS.chapterId, sourceChapterNo: 12, sourceSelectedText: '雨夜', sourceTextSnapshot: '雨夜正文' }))
    const otherSessionId = (await otherResponse.json()).sessionId as string
    const beforeIsolation = snapshotIsolation(database)
    expect((await remove('a3', {}, otherSessionId)).status).toBe(404)
    expect((await remove('missing')).status).toBe(404)
    expect((await remove('u2')).status).toBe(400)
    expect((await remove('a3', { mode: 'unknown' })).status).toBe(400)
    expect(read()).toEqual(before)

    database.exec("CREATE TRIGGER fail_branch_delete BEFORE DELETE ON roleplay_messages WHEN OLD.id = 'a2' BEGIN SELECT RAISE(ABORT, 'forced branch delete failure'); END")
    expect((await remove('a3')).status).toBe(500)
    expect(read()).toEqual(before)
    database.exec('DROP TRIGGER fail_branch_delete')

    const deleted = await remove('a3')
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toEqual({ ok: true, deletedMessageIds: ['a3', 'u3', 'a2'] })
    expect(read()).toEqual([
      { id: 'u1', parent_message_id: null, forked_from_message_id: null },
      { id: 'a1', parent_message_id: 'u1', forked_from_message_id: null },
      { id: 'u2', parent_message_id: 'a1', forked_from_message_id: null },
      { id: 'a2-alt', parent_message_id: 'u2', forked_from_message_id: null },
      { id: 'other-root', parent_message_id: null, forked_from_message_id: null },
    ])
    expect((await remove('a3')).status).toBe(404)
    expect((await remove('other-root')).status).toBe(200)
    expect((await remove('a2-alt')).status).toBe(200)
    expect(read()).toEqual([])
    expect(database.prepare('SELECT id FROM roleplay_sessions WHERE id = ?').get(sessionId)).toBeTruthy()
    await append('fresh', 'user', null)
    expect(read()).toHaveLength(1)
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(snapshotIsolation(database)).toEqual(beforeIsolation)
  }))

  it('deletes only the requested turn and its variants, reconnects later forks, and validates the session context', databaseFixture.wrap(async () => {
    const database = createTestDatabase('retale-roleplay-turn-delete')
    createFixture(database)
    const { POST: createSession } = await import('@/app/api/roleplay/sessions/route')
    const { POST: appendMessage, DELETE: deleteRequest } = await import('@/app/api/roleplay/sessions/[sessionId]/messages/route')
    const { GET: getSession } = await import('@/app/api/roleplay/sessions/[sessionId]/route')
    const makeSession = async () => {
      const response = await createSession(createSessionRequest({ novelId: FIXTURE_IDS.novelId, branchId: FIXTURE_IDS.branchId, title: '删除请求', sourceChapterId: FIXTURE_IDS.chapterId, sourceChapterNo: 12, sourceSelectedText: '雨夜', sourceTextSnapshot: '雨夜正文' }))
      expect(response.status).toBe(201)
      return (await response.json()).sessionId as string
    }
    const sessionId = await makeSession()
    const otherSessionId = await makeSession()
    const beforeIsolation = snapshotIsolation(database)
    const context = { params: Promise.resolve({ sessionId }) }
    const append = async (id: string, role: string, parentMessageId: string | null, extra = {}) => {
      const response = await appendMessage(createMessageRequest(sessionId, { id, role, parentMessageId, content: id, ...extra }), context)
      expect(response.status).toBe(201)
      return (await response.json()).id as string
    }
    const remove = (messageId: string, extra = {}, targetSession = sessionId) => deleteRequest(new Request(`http://localhost/api/roleplay/sessions/${targetSession}/messages`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ novelId: FIXTURE_IDS.novelId, branchId: FIXTURE_IDS.branchId, messageId, ...extra }),
    }), { params: Promise.resolve({ sessionId: targetSession }) })
    const readMessages = async () => {
      const response = await getSession(new Request(`http://localhost/api/roleplay/sessions/${sessionId}?novelId=${FIXTURE_IDS.novelId}&branchId=${FIXTURE_IDS.branchId}`), context)
      expect(response.status).toBe(200)
      return (await response.json()).messages as Array<{ id: string; parentMessageId: string | null; forkedFromMessageId: string | null }>
    }
    await append('u1', 'user', null)
    await append('a1', 'assistant', 'u1')
    await append('u2', 'user', 'a1')
    await append('a2', 'assistant', 'u2')
    const variantId = await append('variant', 'assistant', 'u2', { mode: 'latest-turn-variant' })
    await append('u3', 'user', variantId, { forkedFromMessageId: variantId })
    await append('a3', 'assistant', 'u3')
    await append('fork', 'user', 'a2', { forkedFromMessageId: 'a2' })
    const beforeMessages = database.prepare('SELECT * FROM roleplay_messages ORDER BY id').all()
    expect((await remove('u2', { branchId: 'wrong-branch' })).status).toBe(404)
    expect((await remove('u2', {}, otherSessionId)).status).toBe(404)
    expect((await remove('u2', {}, 'missing-session')).status).toBe(404)
    expect((await remove('missing')).status).toBe(404)
    expect((await remove('')).status).toBe(400)
    expect((await remove('a2')).status).toBe(400)
    expect(database.prepare('SELECT * FROM roleplay_messages ORDER BY id').all()).toEqual(beforeMessages)

    // A failed delete must also roll back the preceding parent-link changes.
    database.exec("CREATE TRIGGER fail_turn_delete BEFORE DELETE ON roleplay_messages WHEN OLD.id = 'u2' BEGIN SELECT RAISE(ABORT, 'forced delete failure'); END")
    expect((await remove('u2')).status).toBe(500)
    expect(database.prepare('SELECT * FROM roleplay_messages ORDER BY id').all()).toEqual(beforeMessages)
    database.exec('DROP TRIGGER fail_turn_delete')

    const deleted = await remove('u2')
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toEqual({ ok: true, deletedMessageIds: ['u2', 'a2', variantId] })
    const remaining = await readMessages()
    expect(remaining.map((message) => message.id)).toEqual(['u1', 'a1', 'u3', 'a3', 'fork'])
    expect(remaining.find((message) => message.id === 'u3')).toMatchObject({ parentMessageId: 'a1', forkedFromMessageId: null })
    expect(remaining.find((message) => message.id === 'fork')).toMatchObject({ parentMessageId: 'a1', forkedFromMessageId: null })
    expect(remaining.find((message) => message.id === 'a3')).toMatchObject({ parentMessageId: 'u3' })
    expect((await remove('fork')).status).toBe(200)
    expect((await remove('u3')).status).toBe(200)
    expect((await remove('u1')).status).toBe(200)
    expect(await readMessages()).toEqual([])
    await append('new-user', 'user', null)
    await append('new-reply', 'assistant', 'new-user')
    await append('new-variant', 'assistant', 'new-user', { mode: 'latest-turn-variant' })
    expect(await readMessages()).toHaveLength(3)
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(snapshotIsolation(database)).toEqual(beforeIsolation)
  }))

  it('requires a valid character profile for every option, including protagonists and promoted or confirmed entities', databaseFixture.wrap(async () => {
    const database = createTestDatabase('retale-roleplay-character-entities')
    createFixture(database)
    database.prepare(`
      INSERT INTO hanlp_bootstrap_entities (id, novel_id, branch_id, chapter_id, chapter_no, entity_text, entity_type)
      VALUES (?, ?, ?, ?, 12, '林舟', 'person')
    `).run('recognized-hero', FIXTURE_IDS.novelId, FIXTURE_IDS.branchId, FIXTURE_IDS.chapterId)
    database.prepare(`
      INSERT INTO character_candidates (
        id, novel_id, branch_id, surface_text, display_name, normalized_name, first_seen_chapter, last_seen_chapter
      ) VALUES (?, ?, ?, '沈月', '沈月', '沈月', 2, 12)
    `).run('candidate-counterpart', FIXTURE_IDS.novelId, FIXTURE_IDS.branchId)

    const { POST: createSession } = await import('@/app/api/roleplay/sessions/route')
    const { GET: getSession } = await import('@/app/api/roleplay/sessions/[sessionId]/route')
    const response = await createSession(createSessionRequest({
      novelId: FIXTURE_IDS.novelId, branchId: FIXTURE_IDS.branchId, title: 'RP 实体角色',
      sourceChapterId: FIXTURE_IDS.chapterId, sourceChapterNo: 12,
      sourceSelectedText: '沈月望着窗外。', sourceTextSnapshot: '林舟和沈月望着窗外的陌生人。「灵力汇入丹田。」',
    }))
    expect(response.status).toBe(201)
    const { sessionId } = await response.json() as { sessionId: string }
    const readOptions = async () => {
      const result = await getSession(
        new Request(`http://localhost/api/roleplay/sessions/${sessionId}?novelId=${FIXTURE_IDS.novelId}&branchId=${FIXTURE_IDS.branchId}`),
        { params: Promise.resolve({ sessionId }) },
      )
      expect(result.status).toBe(200)
      return (await result.json()).characterOptions
    }
    expect(await readOptions()).toEqual([])

    database.prepare(`
      INSERT INTO KnowledgeEntity (id, novelId, branchId, entityType, canonicalName, importanceTier, firstSeenChapter, status)
      VALUES (?, ?, ?, 'character', '林舟', 'protagonist', 1, 'hanlp_bootstrap')
    `).run('hero', FIXTURE_IDS.novelId, FIXTURE_IDS.branchId)
    for (const name of ['「', '丹田', '灵力']) {
      database.prepare(`
        INSERT INTO KnowledgeEntity (id, novelId, branchId, entityType, canonicalName, importanceTier, firstSeenChapter, status)
        VALUES (?, ?, ?, 'character', ?, 'important', 1, 'hanlp_bootstrap')
      `).run(`noise-${name}`, FIXTURE_IDS.novelId, FIXTURE_IDS.branchId, name)
    }
    expect(await readOptions()).toEqual([])

    // Known-character updates can create a profile without changing the bootstrap status.
    database.prepare(`
      INSERT INTO KnowledgeFact (
        id, novelId, branchId, factType, subjectEntityId, predicate, valueJson,
        sourceChapter, validFromChapter, validUntilChapter, status
      ) VALUES ('hero-profile', ?, ?, 'character_profile', 'hero', 'role_card', ?, 1, 1, 999999, 'ai_generated')
    `).run(FIXTURE_IDS.novelId, FIXTURE_IDS.branchId, JSON.stringify({ profile: { identity: { content: '故事主角' } } }))
    expect(await readOptions()).toEqual([{ name: '林舟', protagonist: true }])
    for (const status of ['rejected', 'outdated', 'potentially_stale']) {
      database.prepare("UPDATE KnowledgeFact SET status = ? WHERE id = 'hero-profile'").run(status)
      expect(await readOptions()).toEqual([])
    }
    database.prepare("UPDATE KnowledgeFact SET status = 'ai_generated', sourceChapter = 13, validFromChapter = 13 WHERE id = 'hero-profile'").run()
    expect(await readOptions()).toEqual([])
    database.prepare("UPDATE KnowledgeFact SET sourceChapter = 1, validFromChapter = 1, validUntilChapter = 12 WHERE id = 'hero-profile'").run()
    expect(await readOptions()).toEqual([])
    database.prepare("DELETE FROM KnowledgeFact WHERE id = 'hero-profile'").run()
    database.prepare("UPDATE KnowledgeEntity SET userConfirmed = 1 WHERE id = 'hero'").run()
    expect(await readOptions()).toEqual([])
    database.prepare("UPDATE KnowledgeEntity SET userConfirmed = 0, status = 'known_character_update' WHERE id = 'hero'").run()
    expect(await readOptions()).toEqual([])
    database.prepare(`
      INSERT INTO KnowledgeFact (
        id, novelId, branchId, factType, subjectEntityId, predicate, valueJson,
        sourceChapter, validFromChapter, validUntilChapter, status
      ) VALUES ('hero-profile', ?, ?, 'character_profile', 'hero', 'role_card', ?, 1, 1, 999999, 'user_confirmed')
    `).run(FIXTURE_IDS.novelId, FIXTURE_IDS.branchId, JSON.stringify({ profile: { identity: { content: '故事主角' } } }))
    expect(await readOptions()).toEqual([{ name: '林舟', protagonist: true }])
    database.prepare("UPDATE KnowledgeEntity SET status = 'rejected' WHERE id = 'hero'").run()
    expect(await readOptions()).toEqual([])
    database.prepare("UPDATE KnowledgeEntity SET userConfirmed = 0, status = 'known_character_update' WHERE id = 'hero'").run()
    expect(await readOptions()).toEqual([{ name: '林舟', protagonist: true }])

    database.prepare(`
      INSERT INTO KnowledgeEntity (id, novelId, branchId, entityType, canonicalName, importanceTier, firstSeenChapter, status)
      VALUES (?, ?, ?, 'character', '沈月', 'arc', 2, 'candidate_promoted')
    `).run('counterpart', FIXTURE_IDS.novelId, FIXTURE_IDS.branchId)
    database.prepare("UPDATE character_candidates SET promoted_entity_id = 'counterpart', status = 'promoted_pending_summary' WHERE id = ?").run('candidate-counterpart')
    expect(await readOptions()).toEqual([{ name: '林舟', protagonist: true }])
    database.prepare(`
      INSERT INTO KnowledgeFact (
        id, novelId, branchId, factType, subjectEntityId, predicate, valueJson,
        sourceChapter, validFromChapter, validUntilChapter
      ) VALUES ('counterpart-profile', ?, ?, 'character_profile', 'counterpart', 'role_card', ?, 2, 2, 999999)
    `).run(FIXTURE_IDS.novelId, FIXTURE_IDS.branchId, JSON.stringify({ profile: { identity: { content: '故事配角' } } }))
    expect(await readOptions()).toEqual([{ name: '林舟', protagonist: true }, { name: '沈月', protagonist: false }])

    database.prepare("DELETE FROM KnowledgeEntity WHERE id = 'counterpart'").run()
    expect(await readOptions()).toEqual([{ name: '林舟', protagonist: true }])
  }))

  it('persists script inputs and blocks and lists only the protagonist and present chapter characters', databaseFixture.wrap(async () => {
    const database = createTestDatabase('retale-roleplay-script')
    createFixture(database)
    for (const [id, name, tier, firstSeen] of [
      ['hero', '林舟', 'protagonist', 1], ['present', '沈月', 'important', 2],
      ['absent', '赵远', 'important', 1], ['future', '未来角色', 'important', 30],
    ] as const) {
      database.prepare('INSERT INTO KnowledgeEntity (id, novelId, branchId, entityType, canonicalName, importanceTier, firstSeenChapter) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, FIXTURE_IDS.novelId, FIXTURE_IDS.branchId, 'character', name, tier, firstSeen)
      database.prepare(`
        INSERT INTO KnowledgeFact (
          id, novelId, branchId, factType, subjectEntityId, predicate, valueJson, sourceChapter, validFromChapter, validUntilChapter
        ) VALUES (?, ?, ?, 'character_profile', ?, 'role_card', ?, ?, ?, 999999)
      `).run(`${id}-profile`, FIXTURE_IDS.novelId, FIXTURE_IDS.branchId, id, JSON.stringify({ profile: { identity: { content: name } } }), firstSeen, firstSeen)
    }
    const { POST: createSession } = await import('@/app/api/roleplay/sessions/route')
    const { POST: appendMessage } = await import('@/app/api/roleplay/sessions/[sessionId]/messages/route')
    const { GET: getSession } = await import('@/app/api/roleplay/sessions/[sessionId]/route')
    const response = await createSession(createSessionRequest({
      novelId: FIXTURE_IDS.novelId, branchId: FIXTURE_IDS.branchId, title: 'RP 剧本',
      sourceChapterId: FIXTURE_IDS.chapterId, sourceChapterNo: 12,
      sourceSelectedText: '沈月望着窗外。', sourceTextSnapshot: '沈月望着窗外。',
    }))
    expect(response.status).toBe(201)
    const { sessionId } = await response.json() as { sessionId: string }
    const context = { params: Promise.resolve({ sessionId }) }
    const read = () => getSession(new Request(`http://localhost/api/roleplay/sessions/${sessionId}?novelId=${FIXTURE_IDS.novelId}&branchId=${FIXTURE_IDS.branchId}`), context)
    expect(await (await read()).json()).toMatchObject({ characterOptions: [{ name: '林舟', protagonist: true }, { name: '沈月', protagonist: false }] })
    const turn = { playerName: '林舟', counterpartName: '沈月', storyGuidance: '雨声渐近。', dialogue: '还在等吗？', maxCharacters: 200, generationOptions: { writingSkillCardIds: ['skill'], writingSkillExampleCount: 2, writingSkillSeed: 73, disabledBlockIds: ['current-summary'] } }
    const userResponse = await appendMessage(createMessageRequest(sessionId, { role: 'user', turn }), context)
    expect(userResponse.status).toBe(201)
    const user = await userResponse.json() as { id: string }
    const script = { playerName: '林舟', counterpartName: '沈月', blocks: [{ type: 'narration', text: '雨落在窗沿。' }, { type: 'narration', text: '门外响起脚步声。' }, { type: 'counterpart', text: '她回过头，微微一笑。“我在等你。”' }, { type: 'player', text: '他向门外示意。“走吧。”' }] }
    const savedScript = { ...script, blocks: [{ type: 'narration', text: '雨落在窗沿。\n\n门外响起脚步声。' }, ...script.blocks.slice(2)] }
    const assistant = await appendMessage(createMessageRequest(sessionId, { role: 'assistant', parentMessageId: user.id, script }), context)
    expect(assistant.status).toBe(201)
    const originalReply = await assistant.json() as { id: string; turnIndex: number }
    expect(await (await read()).json()).toMatchObject({ messages: [{ turn }, { script: savedScript }] })
    const invalid = await appendMessage(createMessageRequest(sessionId, { role: 'user', turn: { ...turn, counterpartName: '林舟' } }), context)
    expect(invalid.status).toBe(400)
    const longerScript = { ...script, blocks: [{ type: 'counterpart', text: `${'她轻声讲述着窗外的往事。'.repeat(20)}她把伞递给他。“我们走吧。”` }] }
    const beyondTarget = await appendMessage(createMessageRequest(sessionId, { role: 'assistant', parentMessageId: user.id, script: longerScript }), context)
    expect(beyondTarget.status).toBe(201)
    expect(await beyondTarget.json()).toMatchObject({ script: longerScript })
    expect((await (await read()).json()).messages.at(-1)).toMatchObject({ script: longerScript })
    const variant = await appendMessage(createMessageRequest(sessionId, { role: 'assistant', mode: 'latest-turn-variant', parentMessageId: user.id, script }), context)
    expect(variant.status).toBe(201)
    expect((await (await read()).json()).messages).toHaveLength(4)
    const laterUserResponse = await appendMessage(createMessageRequest(sessionId, { role: 'user', turn, parentMessageId: originalReply.id }), context)
    const laterUser = await laterUserResponse.json() as { id: string }
    const laterReply = await appendMessage(createMessageRequest(sessionId, { role: 'assistant', parentMessageId: laterUser.id, script }), context)
    expect(laterReply.status).toBe(201)

    const olderBranchVariant = await appendMessage(createMessageRequest(sessionId, { role: 'assistant', mode: 'latest-turn-variant', sourceMessageId: originalReply.id, parentMessageId: user.id, script }), context)
    expect(olderBranchVariant.status).toBe(201)
    expect(await olderBranchVariant.json()).toMatchObject({ turnIndex: originalReply.turnIndex, variantIndex: 2, parentMessageId: user.id, forkedFromMessageId: originalReply.id })
    const beforeInvalidVariant = (await (await read()).json()).messages
    const wrongParent = await appendMessage(createMessageRequest(sessionId, { role: 'assistant', mode: 'latest-turn-variant', sourceMessageId: originalReply.id, parentMessageId: laterUser.id, script }), context)
    expect(wrongParent.status).toBe(400)
    const missingSource = await appendMessage(createMessageRequest(sessionId, { role: 'assistant', mode: 'latest-turn-variant', sourceMessageId: 'missing-source', parentMessageId: user.id, script }), context)
    expect(missingSource.status).toBe(404)
    const otherSessionResponse = await createSession(createSessionRequest({ novelId: FIXTURE_IDS.novelId, branchId: FIXTURE_IDS.branchId, title: '另一段对话', sourceChapterId: FIXTURE_IDS.chapterId, sourceChapterNo: 12, sourceSelectedText: '雨夜', sourceTextSnapshot: '雨夜正文' }))
    const otherSessionId = (await otherSessionResponse.json()).sessionId as string
    const otherMessageResponse = await appendMessage(createMessageRequest(otherSessionId, { role: 'assistant', content: '其他会话的回复' }), { params: Promise.resolve({ sessionId: otherSessionId }) })
    const otherMessageId = (await otherMessageResponse.json()).id as string
    const foreignSource = await appendMessage(createMessageRequest(sessionId, { role: 'assistant', mode: 'latest-turn-variant', sourceMessageId: otherMessageId, parentMessageId: user.id, script }), context)
    expect(foreignSource.status).toBe(404)
    expect((await (await read()).json()).messages).toEqual(beforeInvalidVariant)
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  }))

  it('deletes an RP node with its messages, preserves its child session, and rejects deletion from another branch', databaseFixture.wrap(async () => {
    const database = createTestDatabase('retale-roleplay-api-delete')
    createFixture(database)
    vi.resetModules()
    const beforeIsolation = snapshotIsolation(database)
    const { POST: createSession } = await import('@/app/api/roleplay/sessions/route')
    const { POST: appendMessage } = await import('@/app/api/roleplay/sessions/[sessionId]/messages/route')
    const { GET: getSession } = await import('@/app/api/roleplay/sessions/[sessionId]/route')
    const { DELETE } = await import('@/app/api/story-timeline/route')
    const makeSession = async (sourceTimelineNodeId: string, sourceTimelineNodeType: string) => {
      const response = await createSession(createSessionRequest({
        novelId: FIXTURE_IDS.novelId, branchId: FIXTURE_IDS.branchId, title: 'RP 夜谈',
        sourceChapterId: FIXTURE_IDS.chapterId, sourceChapterNo: 12,
        sourceTimelineNodeId, sourceTimelineNodeType,
        sourceSelectedText: '夜谈', sourceTextSnapshot: '原来的夜谈正文。',
      }))
      expect(response.status).toBe(201)
      return response.json() as Promise<{ sessionId: string; timelineNodeId: string }>
    }
    const parent = await makeSession(FIXTURE_IDS.rewriteTimelineNodeId, 'rewrite')
    const child = await makeSession(parent.timelineNodeId, 'roleplay_session')
    for (const session of [parent, child]) {
      const message = await appendMessage(createMessageRequest(session.sessionId, { role: 'user', content: '开口吧。' }), { params: Promise.resolve({ sessionId: session.sessionId }) })
      expect(message.status).toBe(201)
    }
    database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run('other-branch', FIXTURE_IDS.novelId, 'Other')
    const deleteRequest = (branchId: string) => new Request(`http://localhost/api/story-timeline?novelId=${FIXTURE_IDS.novelId}&branchId=${branchId}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeId: parent.timelineNodeId }),
    })
    expect((await DELETE(deleteRequest('other-branch'))).status).toBe(404)
    expect(database.prepare('SELECT id FROM roleplay_sessions WHERE id = ?').get(parent.sessionId)).toBeDefined()
    expect((await DELETE(deleteRequest(FIXTURE_IDS.branchId))).status).toBe(200)
    expect(database.prepare('SELECT id FROM story_timeline_nodes WHERE id = ?').get(parent.timelineNodeId)).toBeUndefined()
    expect(database.prepare('SELECT id FROM roleplay_sessions WHERE id = ?').get(parent.sessionId)).toBeUndefined()
    expect(database.prepare('SELECT id FROM roleplay_messages WHERE session_id = ?').get(parent.sessionId)).toBeUndefined()
    expect(database.prepare('SELECT parent_node_id FROM story_timeline_nodes WHERE id = ?').get(child.timelineNodeId)).toEqual({ parent_node_id: FIXTURE_IDS.rewriteTimelineNodeId })
    expect(database.prepare('SELECT id FROM roleplay_messages WHERE session_id = ?').get(child.sessionId)).toBeDefined()
    const deletedDetail = await getSession(new Request(`http://localhost/api/roleplay/sessions/${parent.sessionId}?novelId=${FIXTURE_IDS.novelId}&branchId=${FIXTURE_IDS.branchId}`), { params: Promise.resolve({ sessionId: parent.sessionId }) })
    expect(deletedDetail.status).toBe(404)
    expect(snapshotIsolation(database)).toEqual({ ...beforeIsolation, timelineRoleplayRows: expect.any(Array) })
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  }))

  it('creates a session, appends ordered messages, preserves variant and fork metadata, and keeps non-roleplay tables untouched', databaseFixture.wrap(async () => {
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
    expect(listResponse.headers.get('cache-control')).toBe('no-store')
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
    expect(getResponse.headers.get('cache-control')).toBe('no-store')
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
  }))

  it('returns 404 for invalid roleplay session ids on load and append', databaseFixture.wrap(async () => {
    createTestDatabase('retale-roleplay-api-not-found')
    vi.resetModules()

    const { GET } = await import('@/app/api/roleplay/sessions/[sessionId]/route')
    const missingSessionResponse = await GET(
      new Request('http://localhost/api/roleplay/sessions/missing-session?novelId=novel-roleplay-001&branchId=novel-roleplay-001:main'),
      { params: Promise.resolve({ sessionId: 'missing-session' }) }
    )
    expect(missingSessionResponse.status).toBe(404)
    expect(missingSessionResponse.headers.get('cache-control')).toBe('no-store')
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
    await expect(appendResponse.json()).resolves.toEqual({ ok: false, error: 'Roleplay session not found for the requested branch context' })
  }))

  it('rejects invalid source timeline ids without creating a session or orphan timeline node', databaseFixture.wrap(async () => {
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
  }))

  it('rolls back roleplay session creation when its timeline node insert fails', databaseFixture.wrap(async () => {
    const database = createTestDatabase('retale-roleplay-api-atomic-rollback')
    createFixture(database)
    database.exec(`
      CREATE TRIGGER fail_roleplay_timeline_insert
      BEFORE INSERT ON story_timeline_nodes
      WHEN NEW.roleplay_session_id IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'forced roleplay timeline failure');
      END;
    `)
    vi.resetModules()

    const { POST: createSession } = await import('@/app/api/roleplay/sessions/route')
    const response = await createSession(createSessionRequest({
      novelId: FIXTURE_IDS.novelId,
      branchId: FIXTURE_IDS.branchId,
      title: 'RP-回滚验证',
      sourceChapterId: FIXTURE_IDS.chapterId,
      sourceChapterNo: 12,
      sourceChapterTitle: '第12章 夜谈',
      sourceTimelineNodeId: FIXTURE_IDS.rewriteTimelineNodeId,
      sourceTimelineNodeType: 'rewrite',
      sourceSelectedText: '他在窗边停住，迟迟没有开口。',
      sourceTextSnapshot: 'rewrite 正文：风吹动了窗纸，他还是没有转身。',
    }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'forced roleplay timeline failure' })
    expect(database.prepare('SELECT COUNT(*) AS count FROM roleplay_sessions').get()).toMatchObject({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM story_timeline_nodes WHERE roleplay_session_id IS NOT NULL').get()).toMatchObject({ count: 0 })
  }))

  it('rolls back variant-group updates when latest-turn variant insertion fails', databaseFixture.wrap(async () => {
    const database = createTestDatabase('retale-roleplay-api-variant-rollback')
    createFixture(database)
    vi.resetModules()

    const { createRoleplaySession, appendRoleplayMessage, createRoleplayLatestTurnVariant } = await import('@/lib/server/roleplay-store')
    const { createNovelDatabaseAccess } = await import('@/lib/server/database-access')
    const db = createNovelDatabaseAccess(FIXTURE_IDS.novelId)
    const { session } = await createRoleplaySession({
      id: 'roleplay-variant-rollback-session',
      novelId: FIXTURE_IDS.novelId,
      branchId: FIXTURE_IDS.branchId,
      title: '变体回滚验证',
      subtitle: null,
      sourceChapterId: FIXTURE_IDS.chapterId,
      sourceChapterNo: 12,
      sourceChapterTitle: '第12章 夜谈',
      sourceTimelineNodeId: FIXTURE_IDS.rewriteTimelineNodeId,
      sourceTimelineNodeType: 'rewrite',
      sourceSelectedText: '他在窗边停住，迟迟没有开口。',
      sourceTextSnapshot: 'rewrite 正文：风吹动了窗纸，他还是没有转身。',
      sourceSelectedLineStart: null,
      sourceSelectedLineEnd: null,
      status: 'active',
    }, db)
    const originalMessage = await appendRoleplayMessage({
      id: 'roleplay-variant-rollback-original',
      sessionId: session.id,
      role: 'assistant',
      content: '原始助手消息',
      parentMessageId: null,
      forkedFromMessageId: null,
      variantGroupId: null,
      status: 'active',
    }, db)
    database.exec(`
      CREATE TRIGGER fail_roleplay_variant_insert
      BEFORE INSERT ON roleplay_messages
      WHEN NEW.content = '强制失败的变体'
      BEGIN
        SELECT RAISE(ABORT, 'forced roleplay variant failure');
      END;
    `)

    await expect(createRoleplayLatestTurnVariant({
      sessionId: session.id,
      role: 'assistant',
      content: '强制失败的变体',
    }, db)).rejects.toThrow('forced roleplay variant failure')

    expect(database.prepare('SELECT COUNT(*) AS count FROM roleplay_messages WHERE session_id = ?').get(session.id)).toMatchObject({ count: 1 })
    expect(database.prepare('SELECT variant_group_id FROM roleplay_messages WHERE id = ?').get(originalMessage.id)).toMatchObject({ variant_group_id: null })
  }))

  it('serializes concurrent session, message, and latest-turn variant allocations and returns each inserted variant', databaseFixture.wrap(async () => {
    const database = createTestDatabase('retale-roleplay-api-concurrent-allocation')
    createFixture(database)
    vi.resetModules()

    const { createRoleplaySession, appendRoleplayMessage, createRoleplayLatestTurnVariant } = await import('@/lib/server/roleplay-store')
    const { createNovelDatabaseAccess } = await import('@/lib/server/database-access')
    const db = createNovelDatabaseAccess(FIXTURE_IDS.novelId)
    const createdSessions = await Promise.all(Array.from({ length: 5 }, (_, index) => createRoleplaySession({
      id: `roleplay-concurrent-session-${index + 1}`,
      novelId: FIXTURE_IDS.novelId,
      branchId: FIXTURE_IDS.branchId,
      title: `并发角色扮演 ${index + 1}`,
      subtitle: null,
      sourceChapterId: FIXTURE_IDS.chapterId,
      sourceChapterNo: 12,
      sourceChapterTitle: '第12章 夜谈',
      sourceTimelineNodeId: FIXTURE_IDS.rewriteTimelineNodeId,
      sourceTimelineNodeType: 'rewrite',
      sourceSelectedText: '他在窗边停住，迟迟没有开口。',
      sourceTextSnapshot: 'rewrite 正文：风吹动了窗纸，他还是没有转身。',
      sourceSelectedLineStart: null,
      sourceSelectedLineEnd: null,
      status: 'active',
    }, db)))

    const timelineLabels = database.prepare(
      `SELECT label_index
       FROM story_timeline_nodes
       WHERE node_type = 'roleplay_session'
       ORDER BY label_index ASC`
    ).all() as Array<{ label_index: number }>
    expect(timelineLabels.map((row) => row.label_index)).toEqual([1, 2, 3, 4, 5])

    const sessionId = createdSessions[0]?.session.id
    expect(sessionId).toBeTruthy()
    if (!sessionId) throw new Error('Concurrent roleplay session was not created')

    const appendedMessages = await Promise.all(Array.from({ length: 6 }, (_, index) => appendRoleplayMessage({
      id: `roleplay-concurrent-message-${index + 1}`,
      sessionId,
      role: 'assistant',
      content: `并发普通消息 ${index + 1}`,
      parentMessageId: null,
      forkedFromMessageId: null,
      variantGroupId: null,
      status: 'active',
    }, db)))
    expect(appendedMessages.map((message) => message.messageIndex).sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5, 6])
    expect(appendedMessages.map((message) => message.turnIndex).sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5, 6])

    const variantContents = Array.from({ length: 5 }, (_, index) => `并发变体 ${index + 1}`)
    const variants = await Promise.all(variantContents.map((content) => createRoleplayLatestTurnVariant({
      sessionId,
      role: 'assistant',
      content,
    }, db)))
    const storedVariants = database.prepare(
      `SELECT id, content, message_index, turn_index, variant_index
       FROM roleplay_messages
       WHERE session_id = ? AND content LIKE '并发变体 %'
       ORDER BY variant_index ASC`
    ).all(sessionId) as Array<{
      id: string
      content: string
      message_index: number
      turn_index: number
      variant_index: number
    }>

    expect(storedVariants.map((message) => message.message_index)).toEqual([7, 8, 9, 10, 11])
    expect(storedVariants.map((message) => message.turn_index)).toEqual([6, 6, 6, 6, 6])
    expect(storedVariants.map((message) => message.variant_index)).toEqual([2, 3, 4, 5, 6])
    expect(variants).toHaveLength(variantContents.length)
    for (const variant of variants) {
      const stored = storedVariants.find((message) => message.content === variant.content)
      expect(stored?.id).toBe(variant.id)
    }
  }))
})
