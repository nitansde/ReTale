import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync; fetch?: typeof fetch }

function createAiSettings() {
  return {
    rewrite: {
      provider: 'openai-compatible',
      openAICompatible: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        model: 'test-model',
      },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'ignored',
      },
    },
  }
}

function createTestDatabase(prefix: string) {
  const tempDatabase = createTempDatabaseCopy(prefix)
  cleanups.push(tempDatabase.cleanup)
  const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
  globalForSqlite.sqlite = database
  return database
}

function seedCreateFixture(database: DatabaseSync) {
  database.prepare(`INSERT INTO NovelRecord (id, title, author, sourceType) VALUES (?, ?, ?, ?)`).run('novel-001', 'Fixture Novel', 'Fixture Author', 'txt')
  database.prepare(`INSERT INTO StoryBranch (id, novelId, name, baseBranchId) VALUES (?, ?, ?, ?)`).run('novel-001:main', 'novel-001', 'main', null)

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-10', 'novel-001', 'novel-001:main', 10, '第10章 决裂', '第10章正文', '第10章摘要', 1, 0, null, 'hash-10', 'ready')

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-25', 'novel-001', 'novel-001:main', 25, '第25章 误判升级', '第25章正文', '第25章摘要', 1, 0, null, 'hash-25', 'ready')

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-100', 'novel-001', 'novel-001:main', 100, '第100章 绑走', '第100章正文', '第100章摘要', 1, 0, null, 'hash-100', 'ready')

  database.prepare(
    `INSERT INTO what_if_sessions (
      id, novel_id, base_branch_id, source_chapter_no, title, premise,
      selected_text, original_text, generated_text, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('what-if-001', 'novel-001', 'novel-001:main', 10, 'IF-01 决裂线', '让男女主在这里彻底决裂。', '原始选段', '原始正文', '改写正文', 'active')

  database.prepare(
    `INSERT INTO what_if_deltas (
      id, session_id, delta_type, subject_name, target_name, subject_entity_id, target_entity_id,
      key, old_value, new_value, valid_from_chapter, description, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('delta-1', 'what-if-001', 'relationship_change', '男主', '女主', null, null, '关系', '合作', '决裂', 10, '两人关系彻底崩塌。', 0.9)

  database.prepare(
    `INSERT INTO outline_nodes (
      id, novel_id, branch_id, chapter_no, title, summary, original_outcome,
      track_key, phase_label, source_type, confidence, involved_entities_json, key_events_json, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('outline-100', 'novel-001', 'novel-001:main', 100, '女主被反派绑走', '反派抓走女主。', '原线里男主及时救援。', 'phase-3', '第三阶段', 'authored', 1, '["男主","女主"]', '["绑走"]', 100)

  database.prepare(
    `INSERT INTO outline_nodes (
      id, novel_id, branch_id, chapter_no, title, summary, original_outcome,
      track_key, phase_label, source_type, confidence, involved_entities_json, key_events_json, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('outline-010', 'novel-001', 'novel-001:main', 10, '仍在第10章', '同章节点。', '无', 'phase-1', '第一阶段', 'authored', 1, '["男主"]', '["决裂"]', 10)

  database.prepare(
    `INSERT INTO outline_nodes (
      id, novel_id, branch_id, chapter_no, title, summary, original_outcome,
      track_key, phase_label, source_type, confidence, involved_entities_json, key_events_json, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('outline-005', 'novel-001', 'novel-001:main', 5, '更早的节点', '更早节点。', '无', 'phase-0', '前置阶段', 'authored', 1, '["男主"]', '["伏笔"]', 5)

  database.prepare(
    `INSERT INTO outline_node_chapters (
      id, outline_node_id, chapter_no, chapter_id, chapter_title, is_primary, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('outline-anchor-100', 'outline-100', 100, 'chapter-100', '第100章 绑走', 1, 0)

  database.prepare(
    `INSERT INTO outline_node_chapters (
      id, outline_node_id, chapter_no, chapter_id, chapter_title, is_primary, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('outline-anchor-010', 'outline-010', 10, 'chapter-10', '第10章 决裂', 1, 0)

  database.prepare(
    `INSERT INTO outline_node_chapters (
      id, outline_node_id, chapter_no, chapter_id, chapter_title, is_primary, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('outline-anchor-005', 'outline-005', 5, null, '第5章 伏笔', 1, 0)

  database.prepare(
    `INSERT INTO continue_blocks (
      id, novel_id, branch_id, parent_timeline_node_id, source_chapter_no, title, subtitle,
      user_instruction, selected_text, original_text, latest_text, latest_revision_no, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'continue-block-rewrite-025',
    'novel-001',
    'novel-001:main',
    null,
    25,
    'RE-01 误判升级',
    null,
    '让误判继续扩大。',
    '第25章正文',
    '第25章正文',
    'rewrite 节点正文：误会已经深到无法当面解释。',
    1,
    'active'
  )

  database.prepare(
    `INSERT INTO continue_blocks (
      id, novel_id, branch_id, parent_timeline_node_id, source_chapter_no, title, subtitle,
      user_instruction, selected_text, original_text, latest_text, latest_revision_no, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'continue-block-025',
    'novel-001',
    'novel-001:main',
    null,
    25,
    'CONT-02 深入误判',
    null,
    '继续深入误判。',
    'rewrite 节点正文：误会已经深到无法当面解释。',
    'rewrite 节点正文：误会已经深到无法当面解释。',
    'continue 节点正文：他把最后一次求证也压成了沉默。',
    1,
    'active'
  )

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, what_if_session_id,
      future_jump_run_id, lane_index, color_token, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('if_fixture_001', 'novel-001', 'novel-001:main', 'what_if', 1, 10, 'IF-01 决裂线', '如果他们在这里闹翻', null, 10, null, 'chapter-10', 'what-if-001', null, 0, 'rose', 'active')

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, what_if_session_id,
      future_jump_run_id, lane_index, color_token, status, continue_block_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('rewrite_fixture_025', 'novel-001', 'novel-001:main', 'rewrite', 1, 25, 'RE-01 误判升级', null, 'if_fixture_001', 25, null, 'chapter-25', null, null, 0, 'sky', 'active', 'continue-block-rewrite-025')

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, what_if_session_id,
      future_jump_run_id, lane_index, color_token, status, continue_block_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('continue_fixture_025', 'novel-001', 'novel-001:main', 'continue_block', 2, 25, 'CONT-02 深入误判', null, 'rewrite_fixture_025', 25, null, 'chapter-25', null, null, 0, 'sky', 'active', 'continue-block-025')
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

  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('future-jump create API', () => {
  it('uses the selected source node context instead of the ancestor what-if root and creates exactly one timeline node', async () => {
    const database = createTestDatabase('retale-future-jump-create')
    seedCreateFixture(database)

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings(),
    }))

    const bridgeSummary = '决裂之后，男主把原本要与女主共享的线索全部压在自己手里，他坚信真正的问题出在女主身边，于是故意切断联系，只凭零碎情报独自追查。女主被这份怀疑逼得心灰意冷，也不再解释，而是带着自己的判断去追索反派的暗线。两人越走越远，原本互补的能力被硬生生拆成彼此掣肘的盲区，旧日默契在一次次错过里变成更深的误会。反派情报网敏锐地捕捉到他们的裂缝，先挑动外围势力散布假消息，再借泄密者把女主引到孤立地点。男主因为不肯求证女主的行踪，始终晚半步；女主则误以为男主已经默认放弃自己，强撑着独自周旋。两人身边原本愿意调停的盟友，也因为长期收不到完整真相，只能各自站队，让误会越积越深。等双方终于意识到真正的敌人并不是彼此时，反派已经完成布置，把这场情感与信任上的断裂，推成了女主被绑走的必然后果。'
    const generatedTargetText = '女主被拖进废弃仓库时，腕间的绳结已经勒得发麻。她仍咬着牙不肯喊疼，只在门缝灌进冷风时，短促地闭了一下眼。反派的人故意提起男主的名字，像在审视她究竟还会不会相信那个人会来。她没有回答，心口却被那一句话扯得发紧。另一边，男主在翻到最后一条被篡改的线索时，才猛地意识到自己一路追的方向全是别人刻意留下的假痕。他冲出街口时，夜色已经沉到最冷，所有迟来的判断都像钉子一样扎进脑海。他第一次清楚地明白，真正把女主推到这一步的人，除了反派，还有自己那份迟迟不肯放下的怀疑。仓库里的灯光忽明忽暗，女主听见外面终于传来急促的脚步，却没有再像从前那样立刻生出获救的踏实。她只是抬起头，在门板震开的瞬间，看见男主满身寒意地闯进来。两人的视线隔着人群撞上，先涌出来的不是重逢，而是一种更深的痛——他们都知道，这一次来得太晚了。'

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ bridgeSummary }) } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ generatedTargetText, titleHint: '被绑走之夜', subtitleHint: '迟来的真相' }) } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    vi.resetModules()
    const { POST } = await import('@/app/api/future-jump/runs/route')
    const response = await POST(new Request('http://localhost/api/future-jump/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceContext: {
          nodeId: 'continue_fixture_025',
          nodeType: 'continue_block',
          chapterId: 'chapter-25',
          chapterNo: 25,
          whatIfSessionId: null,
        },
        targetOutlineNodeId: 'outline-100',
        targetOutlineChapterId: 'outline-anchor-100',
        parentTimelineNodeId: 'continue_fixture_025',
        userDirection: '把结果写得更虐，但人物不能失真。',
      }),
    }))

    expect(response.status).toBe(200)
    const payload = await response.json() as {
      runId: string
      timelineNodeId: string
      bridgeSummary: string
      generatedTargetText: string
    }

    expect(payload.runId).toBeTruthy()
    expect(payload.timelineNodeId).toBeTruthy()
    expect(payload.bridgeSummary).toBe(bridgeSummary)
    expect(payload.generatedTargetText).toBe(generatedTargetText)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const runRow = database.prepare('SELECT * FROM future_jump_runs WHERE id = ?').get(payload.runId) as {
      latest_revision_no: number
      status: string
      bridge_summary: string
      generated_target_text: string
      parent_timeline_node_id: string | null
      source_timeline_node_id: string | null
      source_timeline_node_type: string | null
      source_chapter_id: string | null
      source_chapter_no: number
    }
    expect(runRow.status).toBe('generated')
    expect(runRow.latest_revision_no).toBe(1)
    expect(runRow.bridge_summary).toBe(bridgeSummary)
    expect(runRow.generated_target_text).toBe(generatedTargetText)
    expect(runRow.parent_timeline_node_id).toBe('continue_fixture_025')
    expect(runRow.source_timeline_node_id).toBe('continue_fixture_025')
    expect(runRow.source_timeline_node_type).toBe('continue_block')
    expect(runRow.source_chapter_id).toBe('chapter-25')
    expect(runRow.source_chapter_no).toBe(25)
    expect((runRow as { source_what_if_session_id?: string | null }).source_what_if_session_id).toBe('what-if-001')

    const firstRequestBody = String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body ?? '')
    expect(firstRequestBody).toContain('第25章正文')
    expect(firstRequestBody).toContain('continue 节点正文：他把最后一次求证也压成了沉默。')

    const revisions = database.prepare('SELECT revision_no, revision_kind FROM future_jump_revisions WHERE run_id = ? ORDER BY revision_no ASC').all(payload.runId) as Array<{
      revision_no: number
      revision_kind: string
    }>
    expect(revisions).toEqual([{ revision_no: 1, revision_kind: 'initial' }])

    const jumpNodes = database.prepare('SELECT * FROM story_timeline_nodes WHERE future_jump_run_id = ? ORDER BY created_at ASC, id ASC').all(payload.runId) as Array<{
      id: string
      node_type: string
      label_index: number
      title: string
      subtitle: string | null
      chapter_id: string | null
      parent_node_id: string | null
    }>
    expect(jumpNodes).toHaveLength(1)
    expect(jumpNodes[0]).toEqual(expect.objectContaining({
      id: payload.timelineNodeId,
      node_type: 'future_jump',
      label_index: 1,
      title: 'IF-01, RE-01, CONT-02, JUMP-01 被绑走之夜',
      subtitle: '迟来的真相',
      chapter_id: 'chapter-100',
      parent_node_id: 'continue_fixture_025',
    }))
  }, 30000)

  it('rejects missing outline nodes before any run is persisted', async () => {
    const database = createTestDatabase('retale-future-jump-create-missing-outline')
    seedCreateFixture(database)
    const initialRunCount = (database.prepare('SELECT COUNT(*) AS count FROM future_jump_runs').get() as { count: number }).count

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings(),
    }))

    vi.resetModules()
    const { POST } = await import('@/app/api/future-jump/runs/route')
    const response = await POST(new Request('http://localhost/api/future-jump/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceContext: {
          nodeId: 'if_fixture_001',
          nodeType: 'what_if',
          chapterId: 'chapter-10',
          chapterNo: 10,
          whatIfSessionId: 'what-if-001',
        },
        targetOutlineNodeId: 'missing-outline',
        targetOutlineChapterId: 'outline-anchor-100',
      }),
    }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Target outline node not found: missing-outline' })
    const runCount = database.prepare('SELECT COUNT(*) AS count FROM future_jump_runs').get() as { count: number }
    expect(runCount.count).toBe(initialRunCount)
  })

  it('rejects invalid parent timeline ids before creating future-jump runs or timeline nodes', async () => {
    const database = createTestDatabase('retale-future-jump-create-invalid-parent')
    seedCreateFixture(database)
    const initialRunCount = (database.prepare('SELECT COUNT(*) AS count FROM future_jump_runs').get() as { count: number }).count
    const initialTimelineNodeCount = (database.prepare('SELECT COUNT(*) AS count FROM story_timeline_nodes').get() as { count: number }).count

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings(),
    }))

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    vi.resetModules()
    const { POST } = await import('@/app/api/future-jump/runs/route')
    const response = await POST(new Request('http://localhost/api/future-jump/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceContext: {
          nodeId: 'continue_fixture_025',
          nodeType: 'continue_block',
          chapterId: 'chapter-25',
          chapterNo: 25,
          whatIfSessionId: null,
        },
        targetOutlineNodeId: 'outline-100',
        targetOutlineChapterId: 'outline-anchor-100',
        parentTimelineNodeId: 'missing-parent-node',
      }),
    }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Parent timeline node not found: missing-parent-node' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect((database.prepare('SELECT COUNT(*) AS count FROM future_jump_runs').get() as { count: number }).count).toBe(initialRunCount)
    expect((database.prepare('SELECT COUNT(*) AS count FROM story_timeline_nodes').get() as { count: number }).count).toBe(initialTimelineNodeCount)
  })

  it('rejects targets that stay on or before the source chapter', async () => {
    const database = createTestDatabase('retale-future-jump-create-invalid-targets')
    seedCreateFixture(database)
    const initialRunCount = (database.prepare('SELECT COUNT(*) AS count FROM future_jump_runs').get() as { count: number }).count

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings(),
    }))

    vi.resetModules()
    const { POST } = await import('@/app/api/future-jump/runs/route')

    const sameChapter = await POST(new Request('http://localhost/api/future-jump/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceContext: {
          nodeId: 'if_fixture_001',
          nodeType: 'what_if',
          chapterId: 'chapter-10',
          chapterNo: 10,
          whatIfSessionId: 'what-if-001',
        },
        targetOutlineNodeId: 'outline-010',
        targetOutlineChapterId: 'outline-anchor-010',
      }),
    }))
    expect(sameChapter.status).toBe(400)
    await expect(sameChapter.json()).resolves.toEqual({ ok: false, error: 'Target chapter must be after the source chapter' })

    const earlierChapter = await POST(new Request('http://localhost/api/future-jump/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceContext: {
          nodeId: 'if_fixture_001',
          nodeType: 'what_if',
          chapterId: 'chapter-10',
          chapterNo: 10,
          whatIfSessionId: 'what-if-001',
        },
        targetOutlineNodeId: 'outline-005',
        targetOutlineChapterId: 'outline-anchor-005',
      }),
    }))
    expect(earlierChapter.status).toBe(400)
    await expect(earlierChapter.json()).resolves.toEqual({ ok: false, error: 'Target chapter must not be before the source chapter' })

    const runCount = database.prepare('SELECT COUNT(*) AS count FROM future_jump_runs').get() as { count: number }
    expect(runCount.count).toBe(initialRunCount)
  })
})
