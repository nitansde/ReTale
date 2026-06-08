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

function seedFutureJumpFixture(database: DatabaseSync) {
  database.prepare(`INSERT INTO NovelRecord (id, title, author, sourceType) VALUES (?, ?, ?, ?)`).run('novel-001', 'Fixture Novel', 'Fixture Author', 'txt')
  database.prepare(`INSERT INTO StoryBranch (id, novelId, name, baseBranchId) VALUES (?, ?, ?, ?)`).run('novel-001:main', 'novel-001', 'main', null)

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-10', 'novel-001', 'novel-001:main', 10, '第10章 决裂', '男主终于选择先怀疑女主，连同盟都裂开了。\n两人各自退后一步，谁也不肯先解释。', '两人在这一章彻底决裂。', 1, 0, null, 'hash-10', 'ready')

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-100', 'novel-001', 'novel-001:main', 100, '第100章 绑走', '原线里女主会在这里被反派绑走，而男主及时追上。', '原线中男主及时救援。', 1, 0, null, 'hash-100', 'ready')

  database.prepare(`INSERT INTO KnowledgeEntity (id, novelId, branchId, entityType, canonicalName, description, firstSeenChapter, lastSeenChapter, importanceTier, status, importance, userConfirmed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('entity-male', 'novel-001', 'novel-001:main', 'character', '男主', '主角', 1, 100, 'protagonist', 'user_confirmed', 5, 1)
  database.prepare(`INSERT INTO KnowledgeEntity (id, novelId, branchId, entityType, canonicalName, description, firstSeenChapter, lastSeenChapter, importanceTier, status, importance, userConfirmed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('entity-female', 'novel-001', 'novel-001:main', 'character', '女主', '主角', 1, 100, 'protagonist', 'user_confirmed', 5, 1)
  database.prepare(`INSERT INTO EntityState (id, novelId, branchId, entityId, stateType, stateValue, description, sourceChapter, validFromChapter, validUntilChapter, evidenceSpanId, evidenceQuote, confidence, status, includeByDefault) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('state-male', 'novel-001', 'novel-001:main', 'entity-male', 'stance', '不再信任女主', '男主开始怀疑女主。', 10, 10, 999999, null, null, 0.9, 'user_confirmed', 1)
  database.prepare(`INSERT INTO EntityState (id, novelId, branchId, entityId, stateType, stateValue, description, sourceChapter, validFromChapter, validUntilChapter, evidenceSpanId, evidenceQuote, confidence, status, includeByDefault) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('state-female', 'novel-001', 'novel-001:main', 'entity-female', 'stance', '对男主极度失望', '女主被伤透。', 10, 10, 999999, null, null, 0.9, 'user_confirmed', 1)
  database.prepare(`INSERT INTO KnowledgeRelation (id, novelId, branchId, sourceEntityId, targetEntityId, relationType, polarity, strength, sourceChapter, validFromChapter, validUntilChapter, evidenceSpanId, confidence, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run('rel-1', 'novel-001', 'novel-001:main', 'entity-male', 'entity-female', 'alliance', 'negative', 5, 10, 10, 999999, null, 0.9, 'user_confirmed')
  database.prepare(`INSERT INTO KnowledgeEvent (id, novelId, branchId, name, summary, eventType, chapterNo, lineStart, lineEnd, importance, consequences, evidenceSpanId, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('event-10', 'novel-001', 'novel-001:main', '同盟决裂', '男主与女主在此彻底分裂。', 'major', 10, null, null, 5, '双方留下巨大裂痕。', null, 'user_confirmed')
  database.prepare(`INSERT INTO KnowledgeWorld (id, novelId, branchId, term, category, definition, firstSeenChapter, validFromChapter, validUntilChapter, evidenceSpanId, status, confidence, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run('world-1', 'novel-001', 'novel-001:main', '反派情报网', 'faction', '反派长期监视男女主的动向。', 5, 5, 999999, null, 'user_confirmed', 0.8)
  database.prepare(`INSERT INTO KnowledgeFact (id, novelId, branchId, factType, subjectEntityId, predicate, objectEntityId, valueJson, sourceChapter, validFromChapter, validUntilChapter, confidence, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('thread-1', 'novel-001', 'novel-001:main', 'open_thread', null, '谁泄露了行动计划', null, JSON.stringify({ description: '没有人知道真正的泄密者。' }), 10, 10, 999999, 0.7, 'user_confirmed')

  database.prepare(
    `INSERT INTO what_if_sessions (
      id, novel_id, base_branch_id, source_chapter_no, title, premise,
      selected_text, original_text, generated_text, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('what-if-001', 'novel-001', 'novel-001:main', 10, 'IF 决裂线', '让男女主在这里彻底决裂。', '决裂选段', '原文片段', '改写片段', 'active')

  database.prepare(
    `INSERT INTO what_if_deltas (
      id, session_id, delta_type, subject_name, target_name, subject_entity_id, target_entity_id,
      key, old_value, new_value, valid_from_chapter, description, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('delta-1', 'what-if-001', 'relationship_change', '男主', '女主', 'entity-male', 'entity-female', '信任关系', '勉强同盟', '公开决裂', 10, '两人的互信彻底崩塌。', 0.95)
  database.prepare(
    `INSERT INTO what_if_deltas (
      id, session_id, delta_type, subject_name, target_name, subject_entity_id, target_entity_id,
      key, old_value, new_value, valid_from_chapter, description, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('delta-2', 'what-if-001', 'faction_shift', '男主', null, 'entity-male', null, '行动策略', '同步行动', '各自为战', 10, '男主不再与女主共享计划。', 0.88)

  database.prepare(
    `INSERT INTO outline_nodes (
      id, novel_id, branch_id, chapter_no, title, summary, original_outcome,
      track_key, phase_label, source_type, confidence, involved_entities_json, key_events_json, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('outline-100', 'novel-001', 'novel-001:main', 100, '女主被反派绑走', '反派在两人决裂后抓住女主。', '原线里男主及时救援。', 'phase-3', '第三阶段', 'authored', 1, '["男主","女主"]', '["绑走"]', 100)

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
  ).run('if_fixture_001', 'novel-001', 'novel-001:main', 'what_if', 1, 10, 'IF 决裂线', '让男女主在这里彻底决裂。', null, 10, null, 'chapter-10', 'what-if-001', null, 0, 'rose', 'active')
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

describe('future-jump-service success', () => {
  it('generates and revises a two-stage future jump with validated outputs', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings(),
    }))

    const tempDatabase = createTempDatabaseCopy('retale-future-jump-service-success')
    cleanups.push(tempDatabase.cleanup)
    const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
    globalForSqlite.sqlite = database
    seedFutureJumpFixture(database)
    vi.resetModules()

    const fetchMock = vi.fn()
    const longBridge = '决裂之后，男主把原本要与女主共享的线索全部压在自己手里，他坚信真正的问题出在女主身边，于是故意切断联系，只凭零碎情报独自追查。女主被这份怀疑逼得心灰意冷，也不再解释，而是带着自己的判断去追索反派的暗线。两人越走越远，原本互补的能力被硬生生拆成彼此掣肘的盲区，旧日默契在一次次错过里变成更深的误会。反派情报网敏锐地捕捉到他们的裂缝，先挑动外围势力散布假消息，再借泄密者把女主引到孤立地点。男主因为不肯求证女主的行踪，始终晚半步；女主则误以为男主已经默认放弃自己，强撑着独自周旋。两人身边原本愿意调停的盟友，也因为长期收不到完整真相，只能各自站队，让误会越积越深。等双方终于意识到真正的敌人并不是彼此时，反派已经完成布置，把这场情感与信任上的断裂，推成了女主被绑走的必然后果。'
    const revisedBridge = '修订后，决裂并没有立刻演成彻底仇视，反而形成一种更危险的冷战。男主表面上切断协作，实际上仍在暗中关注女主，却因为自尊与怀疑不肯现身说明；女主看穿了他的犹豫，只把这份迟疑当成再次背叛，于是更加倔强地独自推进调查。两人的行动路线因此不断交错，却始终差一层坦白。反派情报网趁机伪造证据，让男主误判女主主动接近敌方，又让女主误会男主把自己当作诱饵。旧日感情没有消失，反而在压抑和误解里变得更尖锐，任何迟来的善意都被当成算计。外围势力也被反派收买，在关键节点同时截断通信、封死退路，使女主被迫独自面对早已布好的陷阱。连本来仍想帮他们转圜的朋友，也在反派挑拨下选择沉默，让裂痕再无缓冲。男主直到最后才拼出真相，却因为此前一次次选择旁观与迟疑，硬生生错过了最能改变结局的时机，于是女主被绑走成了这条分歧线上最刺痛、也最顺理成章的结果。'

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ bridgeSummary: longBridge }) } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ generatedTargetText: '' }) } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ generatedTargetText: '女主被拖进废弃仓库时，腕间的绳结已经勒得发麻。她仍咬着牙不肯喊疼，只在门缝灌进冷风时，短促地闭了一下眼。反派的人故意提起男主的名字，像在审视她究竟还会不会相信那个人会来。她没有回答，心口却被那一句话扯得发紧。另一边，男主在翻到最后一条被篡改的线索时，才猛地意识到自己一路追的方向全是别人刻意留下的假痕。他冲出街口时，夜色已经沉到最冷，所有迟来的判断都像钉子一样扎进脑海。他第一次清楚地明白，真正把女主推到这一步的人，除了反派，还有自己那份迟迟不肯放下的怀疑。仓库里的灯光忽明忽暗，女主听见外面终于传来急促的脚步，却没有再像从前那样立刻生出获救的踏实。她只是抬起头，在门板震开的瞬间，看见男主满身寒意地闯进来。两人的视线隔着人群撞上，先涌出来的不是重逢，而是一种更深的痛——他们都知道，这一次来得太晚了。', titleHint: '被绑走之夜', subtitleHint: '迟来的真相' }) } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ bridgeSummary: revisedBridge }) } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ generatedTargetText: '废弃仓库外的雨线细得像针。男主终于找到这里时，靴底踩碎积水的声响在空院里格外清晰。他一路赶来，脑海里翻涌的不是英雄式的决断，而是每一次没能及时开口的迟疑：那些怀疑、那些自以为冷静的观望，最终都被反派利用，反噬成眼前这一幕。门内，女主被反剪着手臂按在昏黄灯下，脸色苍白，却仍旧抬着下巴，不肯让人看见自己露怯。她听见脚步时先是僵了一瞬，等确认来人是男主，眼底掠过的情绪却不是单纯的欣喜，而是压了太久的委屈、失望与一点来不及熄灭的期待。反派故意当着他们的面揭开伪造情报的过程，让过去所有误会一下子有了血淋淋的证据。男主握紧拳，第一次在她面前承认，自己曾经选择不信、选择退后，才让事情走到无法轻易挽回的地步。女主没有立刻原谅，只在挣脱束缚后望着他，声音发哑地问了一句：\"你现在来，是想救我，还是想赎你自己的错？\"这句话像刀子一样劈开两人之间最后一层遮掩，也让这场迟到的救援比原线更痛、更真。', titleHint: '迟到的救援' }) } }] }), { status: 200 }))

    vi.stubGlobal('fetch', fetchMock)

    const service = await import('@/lib/server/future-jump-service')
    const { findFutureJumpRunById } = await import('@/lib/server/future-jump-store')
    const generated = await service.generateFutureJump({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      whatIfSessionId: 'what-if-001',
      sourceContext: {
        nodeId: 'if_fixture_001',
        nodeType: 'what_if',
        chapterId: 'chapter-10',
        chapterNo: 10,
        whatIfSessionId: 'what-if-001',
      },
      targetOutlineNodeId: 'outline-100',
      targetOutlineChapterId: 'outline-anchor-100',
      userDirection: '让结果更虐，但仍保持人物一致。',
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(generated.run.status).toBe('generated')
    expect(generated.run.errorMessage).toBeNull()
    expect(generated.run.bridgeSummary).toContain('女主被绑走')
    expect(generated.run.generatedTargetText).toContain('女主被拖进废弃仓库')
    expect(generated.run.revisions).toHaveLength(1)
    expect(generated.revision.revisionNo).toBe(1)
    expect(generated.titleHint).toBe('被绑走之夜')
    expect(generated.subtitleHint).toBe('迟来的真相')

    const revised = await service.reviseFutureJump({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      runId: generated.run.id,
      userFeedback: '把男主的愧疚写得更明显，但不要直接和好。',
    })

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(revised.run.status).toBe('revised')
    expect(revised.run.latestRevisionNo).toBe(2)
    expect(revised.run.revisions).toHaveLength(2)
    expect(revised.revision.revisionNo).toBe(2)
    expect(revised.revision.userFeedback).toBe('把男主的愧疚写得更明显，但不要直接和好。')
    expect(revised.run.bridgeSummary).toContain('迟疑')
    expect(revised.run.generatedTargetText).toContain('赎你自己的错')
    expect(revised.titleHint).toBe('迟到的救援')
    expect(revised.subtitleHint).toBeNull()

    const persisted = findFutureJumpRunById(generated.run.id)
    expect(persisted?.revisions).toHaveLength(2)
    expect(persisted?.errorMessage).toBeNull()
  }, 45000)
})
