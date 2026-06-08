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
  ).run('chapter-10', 'novel-001', 'novel-001:main', 10, '第10章', '第10章内容', '第10章摘要', 1, 0, null, 'hash-10', 'ready')

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
  ).run('span-10-mainline', 'novel-001', 'novel-001:main', 'chapter-10', 10, 1, 2, 0, 27, '男主和女主暂时结盟，准备一起行动。\n他们都还相信对方。', 'scene', 24)

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

describe('branch-isolation-mainline', () => {
  it('keeps default context and retrieval speculation-free', async () => {
    const tempDatabase = createTempDatabaseCopy('retale-branch-isolation-mainline')
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
      userInstruction: '保留当前主线。',
    })

    expect(context.assembledContext).not.toContain('决裂 / 不信任')
    expect(context.assembledContext).not.toContain('新的未来节点正文')
    expect(context.promptBlocks.some((block) => block.id === 'authored-branch-context')).toBe(false)

    const retrieval = await searchLanceEvidence({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      maxChapterNo: 10,
      query: '决裂 不信任 新的未来节点正文',
      limit: 10,
    })

    expect(retrieval.matches).toEqual([])
    expect(retrieval.matches.some((match) => match.sourceType === 'authored_delta' || match.sourceType === 'future_jump_revision')).toBe(false)
    expect(database.prepare('SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ?').get('novel-001:main')).toMatchObject({
      count: rawTextDocs.length,
    })
  })
})
