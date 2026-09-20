import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'
import { registerNovelDatabaseFixture, resetNovelDatabaseTestState } from '@/tests/helpers/novel-db'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const databases: DatabaseSync[] = []
const novelDatabaseDisposers: Array<() => void> = []

function createTestDatabase(prefix: string, novelIds: readonly string[]) {
  const tempDatabase = createTempDatabaseCopy(prefix)
  cleanups.push(tempDatabase.cleanup)
  const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
  databases.push(database)
  novelDatabaseDisposers.push(registerNovelDatabaseFixture(database, novelIds))
  return database
}

function seedTimelineFixture(database: DatabaseSync) {
  database.prepare(
    `INSERT INTO NovelRecord (id, title, author, sourceType)
     VALUES (?, ?, ?, ?)`
  ).run('novel-001', 'Fixture Novel', 'Fixture Author', 'txt')

  database.prepare(
    `INSERT INTO StoryBranch (id, novelId, name, baseBranchId)
     VALUES (?, ?, ?, ?)`
  ).run('novel-001:main', 'novel-001', 'main', null)

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
    `INSERT INTO continue_blocks (
      id, novel_id, branch_id, parent_timeline_node_id, source_chapter_no, title, subtitle,
      user_instruction, selected_text, original_text, latest_text, latest_revision_no, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('continue-block-001', 'novel-001', 'novel-001:main', null, 10, 'RE-01 第一版改写', '首个改写结果', '保存这版改写。', '原始选区', '原始片段', '改写后的正文', 1, 'active')

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, continue_block_id,
      what_if_session_id, future_jump_run_id, roleplay_session_id, lane_index, color_token, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('rewrite_fixture_001', 'novel-001', 'novel-001:main', 'rewrite', 1, 10, 'RE-01 第一版改写', '首个改写结果', null, 10, null, null, 'continue-block-001', null, null, null, 0, 'fuchsia', 'active')

  database.prepare(
    `INSERT INTO what_if_sessions (
      id, novel_id, base_branch_id, source_chapter_no, title, premise,
      selected_text, original_text, generated_text, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('what-if-session-001', 'novel-001', 'novel-001:main', 10, 'IF-01 决裂线', '让两人提前决裂。', '原始选区', '原始片段', '魔改片段', 'active')

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
      id, source_what_if_session_id, source_timeline_node_type, source_text_snapshot, base_branch_id, parent_timeline_node_id, target_outline_node_id,
      target_outline_chapter_id, source_chapter_no, target_chapter_no, user_direction,
      bridge_summary, generated_target_text, latest_revision_no, error_message, status
    ) VALUES (?, ?, 'what_if', 'What-if 正文', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('jump-run-001', 'what-if-session-001', 'novel-001:main', 'rewrite_fixture_001', 'outline_event_100', 'outline_chapter_100_primary', 10, 100, '男主没有第一时间救援。', '桥接摘要', '未来节点正文', 1, null, 'generated')

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, continue_block_id,
      what_if_session_id, future_jump_run_id, roleplay_session_id, lane_index, color_token, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('jump_fixture_001', 'novel-001', 'novel-001:main', 'future_jump', 1, 100, 'JUMP-01 第100章', '跳到被绑走后的未来', 'rewrite_fixture_001', 10, 100, 'chapter-100', null, null, 'jump-run-001', null, 0, 'violet', 'generated')

  database.prepare(
    `INSERT INTO roleplay_sessions (
      id, novel_id, branch_id, title, subtitle, source_chapter_id, source_chapter_no, source_chapter_title,
      source_timeline_node_id, source_timeline_node_type, source_selected_text, source_text_snapshot,
      source_selected_line_start, source_selected_line_end, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('roleplay-session-001', 'novel-001', 'novel-001:main', '夜谈', null, 'chapter-10', 10, '第10章 结盟', 'rewrite_fixture_001', 'rewrite', '她压低声音，先问他到底隐瞒了什么。', '结盟之后，气氛短暂沉了下来。', 3, 4, 'active')

  const insertRoleplayMessage = database.prepare(
    `INSERT INTO roleplay_messages (
      id, session_id, message_index, turn_index, variant_index, role, content,
      parent_message_id, forked_from_message_id, variant_group_id, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  insertRoleplayMessage.run('rp-msg-001', 'roleplay-session-001', 1, 1, 1, 'user', '你昨晚为什么没有按约定现身？', null, null, null, 'active')
  insertRoleplayMessage.run('rp-msg-002', 'roleplay-session-001', 2, 2, 1, 'assistant', '他停顿了一下，只说局势比预想中更危险。', 'rp-msg-001', null, null, 'active')
  insertRoleplayMessage.run('rp-msg-003', 'roleplay-session-001', 3, 3, 1, 'user', '那你现在最好把所有真相都告诉我。', 'rp-msg-002', null, null, 'active')
}

afterEach(() => {
  vi.resetModules()

  while (novelDatabaseDisposers.length) {
    novelDatabaseDisposers.pop()?.()
  }
  resetNovelDatabaseTestState()

  while (databases.length) {
    try {
      ;(databases.pop() as DatabaseSync & { close?: () => void }).close?.()
    } catch {
    }
  }

  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('roleplay timeline hydration', () => {
  it.each([false, true])('hydrates the first user request for persisted=%s roleplay nodes and keeps future-jump nodes intact', async (persisted) => {
    const database = createTestDatabase('retale-roleplay-timeline', ['novel-001'])
    seedTimelineFixture(database)
    let firstUserRequest = '你昨晚为什么没有按约定现身？'
    const timelineNodeId = persisted ? 'roleplay-node-001' : 'roleplay-session:roleplay-session-001'
    if (persisted) {
      const turn = {
        playerName: '女主', counterpartName: '男主',
        storyGuidance: '结盟后的雨夜，她想知道他失约的原因，让两人从试探逐渐走向坦诚，同时保留他还没有说出口的顾虑。',
        dialogue: firstUserRequest, maxCharacters: 600,
      }
      database.prepare('UPDATE roleplay_messages SET content = ? WHERE id = ?')
        .run(JSON.stringify({ turn }), 'rp-msg-001')
      firstUserRequest = `${turn.storyGuidance}\n女主对男主说：${turn.dialogue}`
      database.prepare(
        `INSERT INTO story_timeline_nodes (
          id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
          parent_node_id, roleplay_session_id, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(timelineNodeId, 'novel-001', 'novel-001:main', 'roleplay_session', 1, 10, '夜谈', '从章节选区开始角色扮演。', 'rewrite_fixture_001', 'roleplay-session-001', 'active')
    }
    vi.resetModules()

    const [{ GET: getStoryTimeline }, { GET: getRoleplaySession }] = await Promise.all([
      import('@/app/api/story-timeline/route'),
      import('@/app/api/roleplay/sessions/[sessionId]/route'),
    ])

    const timelineResponse = await getStoryTimeline(
      new Request('http://localhost/api/story-timeline?novelId=novel-001&branchId=main')
    )

    expect(timelineResponse.status).toBe(200)
    const timelinePayload = await timelineResponse.json()
    const roleplayNodes = timelinePayload.branchNodes.filter((node: { nodeType: string }) => node.nodeType === 'roleplay_session')

    expect(roleplayNodes).toHaveLength(1)
    expect(roleplayNodes[0]).toEqual(expect.objectContaining({
      id: timelineNodeId,
      nodeType: 'roleplay_session',
      roleplaySessionId: 'roleplay-session-001',
      parentNodeId: 'rewrite_fixture_001',
      anchorChapterNo: 10,
      readableLabel: 'RP-01',
      title: '夜谈',
      subtitle: firstUserRequest,
      userInstruction: firstUserRequest,
      currentText: '那你现在最好把所有真相都告诉我。',
    }))

    expect(timelinePayload.edges).toContainEqual({ fromNodeId: 'rewrite_fixture_001', toNodeId: timelineNodeId })
    expect(timelinePayload.branchNodes).toContainEqual(expect.objectContaining({
      id: 'jump_fixture_001',
      nodeType: 'future_jump',
      futureJumpRunId: 'jump-run-001',
      parentNodeId: 'rewrite_fixture_001',
    }))

    const roleplaySessionResponse = await getRoleplaySession(
      new Request('http://localhost/api/roleplay/sessions/roleplay-session-001?novelId=novel-001&branchId=novel-001:main'),
      { params: Promise.resolve({ sessionId: 'roleplay-session-001' }) }
    )

    expect(roleplaySessionResponse.status).toBe(200)
    const roleplaySessionPayload = await roleplaySessionResponse.json()
    expect(roleplaySessionPayload.timelineNodeId).toBe(persisted ? timelineNodeId : null)
    expect(roleplaySessionPayload.messages).toHaveLength(3)
    expect(roleplaySessionPayload.messages.map((message: { messageIndex: number; role: string }) => [message.messageIndex, message.role])).toEqual([
      [1, 'user'],
      [2, 'assistant'],
      [3, 'user'],
    ])
  })
})
