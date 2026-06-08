import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }

function seedIsolationFixture(database: DatabaseSync) {
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
  ).run(
    'chapter-10',
    'novel-001',
    'novel-001:main',
    10,
    '第10章',
    '男主和女主暂时结盟，准备一起行动。\n他们都还相信对方。',
    '第10章摘要',
    1,
    0,
    null,
    'hash-10',
    'ready'
  )

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-100', 'novel-001', 'novel-001:main', 100, '第100章', '第100章内容', '第100章摘要', 1, 0, null, 'hash-100', 'ready')

  database.prepare('INSERT INTO ChapterLine (id, chapterId, lineNo, text) VALUES (?, ?, ?, ?)').run('line-10-1', 'chapter-10', 1, '男主和女主暂时结盟，准备一起行动。')
  database.prepare('INSERT INTO ChapterLine (id, chapterId, lineNo, text) VALUES (?, ?, ?, ?)').run('line-10-2', 'chapter-10', 2, '他们都还相信对方。')
  database.prepare(
    `INSERT INTO TextSpan (
      id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd,
      charStart, charEnd, text, spanType, tokenEstimate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('span-10-authored', 'novel-001', 'novel-001:main', 'chapter-10', 10, 1, 2, 0, 27, '男主和女主暂时结盟，准备一起行动。\n他们都还相信对方。', 'scene', 24)

  database.prepare(
    `INSERT INTO what_if_sessions (
      id, novel_id, base_branch_id, source_chapter_no, title, premise,
      selected_text, original_text, generated_text, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('what-if-session-001', 'novel-001', 'novel-001:main', 10, 'IF-01 决裂线', '让男主和女主在这里彻底闹掰。', '原始选区', '原始片段', '魔改片段', 'active')

  database.prepare(
    `INSERT INTO what_if_deltas (
      id, session_id, delta_type, subject_name, target_name, subject_entity_id, target_entity_id,
      key, old_value, new_value, valid_from_chapter, description, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('what-if-delta-001', 'what-if-session-001', 'relationship_change', '男主', '女主', null, null, 'relationship', '暧昧同盟', '决裂 / 不信任', 10, '两人关系破裂。', 0.9)

  database.prepare(
    `INSERT INTO outline_nodes (
      id, novel_id, branch_id, chapter_no, title, summary, original_outcome,
      track_key, phase_label, source_type, confidence, involved_entities_json, key_events_json, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('outline_event_100', 'novel-001', 'novel-001:main', 100, '女主被反派绑走', '反派设局抓走女主。', '男主原线救援。', 'phase-3', '第三阶段', 'authored', 1, '["男主","女主"]', '["绑走"]', 100)

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

  database.prepare(
    `INSERT INTO continue_blocks (
      id, novel_id, branch_id, parent_timeline_node_id, source_chapter_no, title, subtitle,
      user_instruction, selected_text, original_text, latest_text, latest_revision_no, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('continue-block-root', 'novel-001', 'novel-001:main', null, 10, 'RE-01 第一版改写', '首个改写结果', '保存这版改写。', '原始选区', '原始片段', '改写根正文：誓言让他们决定一起冒险。', 1, 'active')

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, continue_block_id,
      what_if_session_id, future_jump_run_id, lane_index, color_token, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('rewrite-node-001', 'novel-001', 'novel-001:main', 'rewrite', 1, 10, 'RE-01 第一版改写', '首个改写结果', null, 10, null, null, 'continue-block-root', null, null, 0, 'fuchsia', 'active')

  database.prepare(
    `INSERT INTO continue_blocks (
      id, novel_id, branch_id, parent_timeline_node_id, source_chapter_no, title, subtitle,
      user_instruction, selected_text, original_text, latest_text, latest_revision_no, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('continue-block-child', 'novel-001', 'novel-001:main', 'rewrite-node-001', 10, 'RE-01, CONT-01 续写块', '沿着分支继续推进', '继续沿着当前分支扩展。', '改写根正文：誓言让他们决定一起冒险。', '改写根正文：誓言让他们决定一起冒险。', '续写正文：他们在雨夜里正式立下共同誓言。', 1, 'active')

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, continue_block_id,
      what_if_session_id, future_jump_run_id, lane_index, color_token, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('continue-node-001', 'novel-001', 'novel-001:main', 'continue_block', 1, 10, 'RE-01, CONT-01 续写块', '沿着分支继续推进', 'rewrite-node-001', 10, null, null, 'continue-block-child', null, null, 1, 'fuchsia', 'active')
}

function createMockAISettings() {
  return {
    embeddings: {
      provider: 'ollama',
      embeddingBatchSize: 16,
      openAICompatible: {
        model: 'unused-openai-model',
      },
      ollama: {
        model: 'branch-isolation-embedding-model',
      },
    },
  }
}

afterEach(() => {
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

describe('branch-isolation-authored', () => {
  it('merges speculative authored deltas and latest future jump revision only for explicit requests', async () => {
    const tempDatabase = createTempDatabaseCopy('retale-branch-isolation-authored')
    cleanups.push(tempDatabase.cleanup)

    const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
    globalForSqlite.sqlite = database
    seedIsolationFixture(database)

    vi.resetModules()
    const aiSettings = createMockAISettings()
    const embedTextsWithOllama = vi.fn(async (input: string | string[]) => {
      const values = Array.isArray(input) ? input : [input]
      return {
        enabled: true,
        embeddings: values.map(() => [2, 2, 2]),
        model: aiSettings.embeddings.ollama.model,
      }
    })
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => aiSettings,
    }))
    vi.doMock('@/lib/server/ollama-local', () => ({
      embedTextsWithOllama,
    }))

    const { loadRawTextRetrievalDocs, precomputeRawTextEmbeddingCache } = await import('@/lib/server/retrieval-index')
    const firstPrecompute = await precomputeRawTextEmbeddingCache({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      settingsSnapshot: {
        provider: 'ollama',
        model: aiSettings.embeddings.ollama.model,
        embeddingBatchSize: aiSettings.embeddings.embeddingBatchSize,
      },
    })
    const rawTextDocs = loadRawTextRetrievalDocs('novel-001', 'novel-001:main')
    expect(firstPrecompute).toMatchObject({
      totalDocs: rawTextDocs.length,
      completedDocs: rawTextDocs.length,
      cacheHits: 0,
    })
    await expect(precomputeRawTextEmbeddingCache({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      settingsSnapshot: {
        provider: 'ollama',
        model: aiSettings.embeddings.ollama.model,
        embeddingBatchSize: aiSettings.embeddings.embeddingBatchSize,
      },
    })).resolves.toMatchObject({
      totalDocs: rawTextDocs.length,
      completedDocs: rawTextDocs.length,
      cacheHits: rawTextDocs.length,
    })
    expect(embedTextsWithOllama).toHaveBeenCalledTimes(1)

    const [{ buildGenerationContext }, { searchLanceEvidence }] = await Promise.all([
      import('@/lib/server/context-builder'),
      import('@/lib/server/retrieval-index'),
    ])

    const context = await buildGenerationContext({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      chapterId: 'chapter-10',
      selectedText: '男主和女主暂时结盟',
      operationType: 'rewrite',
      userInstruction: '按显式 what-if / future jump 视角生成。',
      whatIfSessionId: 'what-if-session-001',
      futureJumpRunId: 'jump-run-001',
    })

    expect(context.assembledContext).toContain('显式作者分支上下文')
    expect(context.assembledContext).toContain('决裂 / 不信任')
    expect(context.assembledContext).toContain('新的未来节点正文')
    expect(context.promptBlocks.some((block) => block.id === 'authored-branch-context')).toBe(true)

    const retrieval = await searchLanceEvidence({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      maxChapterNo: 10,
      query: '决裂 不信任 新的未来节点正文',
      limit: 10,
      whatIfSessionId: 'what-if-session-001',
      futureJumpRunId: 'jump-run-001',
    })

    expect(retrieval.matches.some((match) => match.sourceType === 'authored_delta' && match.text.includes('决裂 / 不信任'))).toBe(true)
    expect(retrieval.matches.some((match) => match.sourceType === 'future_jump_revision' && match.text.includes('新的未来节点正文'))).toBe(true)
    expect(database.prepare('SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ?').get('novel-001:main')).toMatchObject({
      count: rawTextDocs.length,
    })
  })

  it('assembles full chapter text plus rewrite/continue lineage in chronological order for continue flows', async () => {
    const tempDatabase = createTempDatabaseCopy('retale-branch-lineage-context')
    cleanups.push(tempDatabase.cleanup)

    const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
    globalForSqlite.sqlite = database
    seedIsolationFixture(database)

    vi.resetModules()
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createMockAISettings(),
    }))
    vi.doMock('@/lib/server/ollama-local', () => ({
      embedTextsWithOllama: vi.fn(async (input: string | string[]) => ({
        enabled: true,
        embeddings: (Array.isArray(input) ? input : [input]).map(() => [2, 2, 2]),
        model: 'branch-isolation-embedding-model',
      })),
    }))

    const { buildGenerationContext } = await import('@/lib/server/context-builder')
    const context = await buildGenerationContext({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      chapterId: 'chapter-10',
      selectedText: '',
      operationType: 'rewrite',
      userInstruction: '继续沿着当前续写块扩展新的版本。',
      branchContextNodeId: 'continue-node-001',
      branchContextInclusion: 'include_selected',
    })

    const branchLineageBlock = context.promptBlocks.find((block) => block.id === 'branch-lineage-full-text')
    expect(branchLineageBlock?.content).toContain('原始章节正文：')
    expect(branchLineageBlock?.content).toContain('男主和女主暂时结盟，准备一起行动。\n他们都还相信对方。')
    expect(branchLineageBlock?.content).toContain('改写根正文：誓言让他们决定一起冒险。')
    expect(branchLineageBlock?.content).toContain('续写正文：他们在雨夜里正式立下共同誓言。')

    const assembled = context.assembledContext
    const taskBlock = context.promptBlocks.find((block) => block.id === 'user-instruction')
    expect(taskBlock?.content).toContain('任务类型：续写后续故事')
    expect(taskBlock?.content).toContain('任务要求：接着下面给出的正文，继续根据用户指令写接下来的故事。')
    expect(taskBlock?.content).toContain('输出要求：只输出后续新正文，不要复述、解释或重新输出下面已经给出的正文。')
    expect(taskBlock?.content).not.toContain('操作类型：rewrite')
    expect(taskBlock?.content).not.toContain('不要改写')

    const chapterIndex = assembled.indexOf('男主和女主暂时结盟，准备一起行动。\n他们都还相信对方。')
    const rewriteIndex = assembled.indexOf('改写根正文：誓言让他们决定一起冒险。')
    const continueIndex = assembled.indexOf('续写正文：他们在雨夜里正式立下共同誓言。')

    expect(chapterIndex).toBeGreaterThanOrEqual(0)
    expect(rewriteIndex).toBeGreaterThan(chapterIndex)
    expect(continueIndex).toBeGreaterThan(rewriteIndex)
  })
})
