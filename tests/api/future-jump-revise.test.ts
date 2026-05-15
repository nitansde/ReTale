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

function seedReviseFixture(database: DatabaseSync) {
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
    `INSERT INTO outline_node_chapters (
      id, outline_node_id, chapter_no, chapter_id, chapter_title, is_primary, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('outline-anchor-100', 'outline-100', 100, 'chapter-100', '第100章 绑走', 1, 0)

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, what_if_session_id,
      future_jump_run_id, lane_index, color_token, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('if_fixture_001', 'novel-001', 'novel-001:main', 'what_if', 1, 10, 'IF-01 决裂线', '如果他们在这里闹翻', null, 10, null, 'chapter-10', 'what-if-001', null, 0, 'rose', 'active')

  database.prepare(
    `INSERT INTO future_jump_runs (
      id, session_id, base_branch_id, parent_timeline_node_id, target_outline_node_id,
      target_outline_chapter_id, source_chapter_no, target_chapter_no, user_direction,
      bridge_summary, generated_target_text, latest_revision_no, error_message, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('jump-run-001', 'what-if-001', 'novel-001:main', 'if_fixture_001', 'outline-100', 'outline-anchor-100', 10, 100, '把结果写得更虐，但人物不能失真。', '初版桥接摘要', '初版未来正文', 1, null, 'generated')

  database.prepare(
    `INSERT INTO future_jump_revisions (
      id, run_id, revision_no, revision_kind, user_feedback, bridge_summary, generated_target_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('future-jump-revision-001', 'jump-run-001', 1, 'initial', null, '初版桥接摘要', '初版未来正文')

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, what_if_session_id,
      future_jump_run_id, lane_index, color_token, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('jump_fixture_001', 'novel-001', 'novel-001:main', 'future_jump', 1, 100, 'JUMP-01 被绑走之夜', '迟来的真相', 'if_fixture_001', 10, 100, 'chapter-100', null, 'jump-run-001', 0, 'violet', 'generated')
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

describe('future-jump revise API', () => {
  it('appends immutable revisions, updates mirrored latest fields, and keeps one timeline node', async () => {
    const database = createTestDatabase('chatbook-future-jump-revise')
    seedReviseFixture(database)

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings(),
    }))

    const revisedBridgeSummary = '修订后，决裂并没有立刻演成彻底仇视，反而形成一种更危险的冷战。男主表面上切断协作，实际上仍在暗中关注女主，却因为自尊与怀疑不肯现身说明；女主看穿了他的犹豫，只把这份迟疑当成再次背叛，于是更加倔强地独自推进调查。两人的行动路线因此不断交错，却始终差一层坦白。反派情报网趁机伪造证据，让男主误判女主主动接近敌方，又让女主误会男主把自己当作诱饵。旧日感情没有消失，反而在压抑和误解里变得更尖锐，任何迟来的善意都被当成算计。外围势力也被反派收买，在关键节点同时截断通信、封死退路，使女主被迫独自面对早已布好的陷阱。连本来仍想帮他们转圜的朋友，也在反派挑拨下选择沉默，让裂痕再无缓冲。男主直到最后才拼出真相，却因为此前一次次选择旁观与迟疑，硬生生错过了最能改变结局的时机，于是女主被绑走成了这条分歧线上最刺痛、也最顺理成章的结果。'
    const revisedTargetText = '仓库顶灯忽明忽暗，女主被反剪着手臂按在铁椅上，指节因为过度用力而泛白。她听见门外终于传来急促脚步时，心口先是一紧，紧接着又被更复杂的情绪拽住——来的人如果真是男主，那他究竟是来救她，还是终于来面对自己一路的迟疑。门板被撞开的瞬间，男主满身雨气地闯进来，视线先落在她腕上的勒痕，又像被烫到一样猛地收紧。他第一次没有用任何借口掩饰，只在反派揭开伪造情报的那一刻，近乎狼狈地承认，正是自己一次次选择不信、选择旁观，才把她推到这里。女主没有立刻回应，只盯着他，眼底的委屈和失望都压成一句发哑的追问：你现在来，到底是想救我，还是想赎你自己的错？'

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ bridgeSummary: revisedBridgeSummary }) } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ generatedTargetText: revisedTargetText, titleHint: '迟到的救援' }) } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    vi.resetModules()
    const [{ POST: reviseRun }, { GET: getRun }] = await Promise.all([
      import('@/app/api/future-jump/runs/[runId]/revise/route'),
      import('@/app/api/future-jump/runs/[runId]/route'),
    ])

    const reviseResponse = await reviseRun(new Request('http://localhost/api/future-jump/runs/jump-run-001/revise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userFeedback: '把男主的愧疚写得更明显，但不要立刻和好。',
      }),
    }), { params: Promise.resolve({ runId: 'jump-run-001' }) })

    expect(reviseResponse.status).toBe(200)
    const revisePayload = await reviseResponse.json() as {
      runId: string
      timelineNodeId: string | null
      bridgeSummary: string
      generatedTargetText: string
    }
    expect(revisePayload).toEqual({
      runId: 'jump-run-001',
      timelineNodeId: 'jump_fixture_001',
      bridgeSummary: revisedBridgeSummary,
      generatedTargetText: revisedTargetText,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const revisions = database.prepare(
      'SELECT revision_no, revision_kind, user_feedback, bridge_summary, generated_target_text FROM future_jump_revisions WHERE run_id = ? ORDER BY revision_no ASC'
    ).all('jump-run-001') as Array<{
      revision_no: number
      revision_kind: string
      user_feedback: string | null
      bridge_summary: string
      generated_target_text: string
    }>
    expect(revisions).toEqual([
      {
        revision_no: 1,
        revision_kind: 'initial',
        user_feedback: null,
        bridge_summary: '初版桥接摘要',
        generated_target_text: '初版未来正文',
      },
      {
        revision_no: 2,
        revision_kind: 'revise',
        user_feedback: '把男主的愧疚写得更明显，但不要立刻和好。',
        bridge_summary: revisedBridgeSummary,
        generated_target_text: revisedTargetText,
      },
    ])

    const runRow = database.prepare(
      'SELECT latest_revision_no, bridge_summary, generated_target_text, status FROM future_jump_runs WHERE id = ?'
    ).get('jump-run-001') as {
      latest_revision_no: number
      bridge_summary: string
      generated_target_text: string
      status: string
    }
    expect(runRow).toEqual({
      latest_revision_no: 2,
      bridge_summary: revisedBridgeSummary,
      generated_target_text: revisedTargetText,
      status: 'revised',
    })

    const timelineNodeCount = database.prepare('SELECT COUNT(*) AS count FROM story_timeline_nodes WHERE future_jump_run_id = ?').get('jump-run-001') as { count: number }
    expect(timelineNodeCount.count).toBe(1)

    const getResponse = await getRun(
      new Request('http://localhost/api/future-jump/runs/jump-run-001?branchId=novel-001:main'),
      { params: Promise.resolve({ runId: 'jump-run-001' }) }
    )
    expect(getResponse.status).toBe(200)
    const runPayload = await getResponse.json() as {
      id: string
      timelineNodeId: string | null
      latestRevisionNo: number
      bridgeSummary: string
      generatedTargetText: string
      latestRevision: { revisionNo: number; generatedTargetText: string } | null
      revisionHistory: Array<{ revisionNo: number; revisionKind: string; userFeedback: string | null }>
    }
    expect(runPayload).toEqual(expect.objectContaining({
      id: 'jump-run-001',
      timelineNodeId: 'jump_fixture_001',
      latestRevisionNo: 2,
      bridgeSummary: revisedBridgeSummary,
      generatedTargetText: revisedTargetText,
      latestRevision: expect.objectContaining({
        revisionNo: 2,
        generatedTargetText: revisedTargetText,
      }),
      revisionHistory: [
        expect.objectContaining({ revisionNo: 1, revisionKind: 'initial', userFeedback: null }),
        expect.objectContaining({ revisionNo: 2, revisionKind: 'revise', userFeedback: '把男主的愧疚写得更明显，但不要立刻和好。' }),
      ],
    }))
  })
})
