import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync; fetch?: typeof fetch }

function seedFailureFixture(database: DatabaseSync) {
  database.prepare(`INSERT INTO NovelRecord (id, title, author, sourceType) VALUES (?, ?, ?, ?)`).run('novel-001', 'Fixture Novel', 'Fixture Author', 'txt')
  database.prepare(`INSERT INTO StoryBranch (id, novelId, name, baseBranchId) VALUES (?, ?, ?, ?)`).run('novel-001:main', 'novel-001', 'main', null)
  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-10', 'novel-001', 'novel-001:main', 10, '第10章', '源章节正文', '源章节摘要', 1, 0, null, 'hash-10', 'ready')
  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-100', 'novel-001', 'novel-001:main', 100, '第100章', '目标章节正文', '目标章节摘要', 1, 0, null, 'hash-100', 'ready')
  database.prepare(
    `INSERT INTO what_if_sessions (
      id, novel_id, base_branch_id, source_chapter_no, title, premise,
      selected_text, original_text, generated_text, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('what-if-001', 'novel-001', 'novel-001:main', 10, 'IF 决裂线', '让男女主决裂。', '选段', '原文', '改写', 'active')
  database.prepare(
    `INSERT INTO what_if_deltas (
      id, session_id, delta_type, subject_name, target_name, subject_entity_id, target_entity_id,
      key, old_value, new_value, valid_from_chapter, description, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('delta-1', 'what-if-001', 'relationship_change', '男主', '女主', null, null, '关系', '合作', '决裂', 10, '两人关系破裂。', 0.9)
  database.prepare(
    `INSERT INTO outline_nodes (
      id, novel_id, branch_id, chapter_no, title, summary, original_outcome,
      track_key, phase_label, source_type, confidence, involved_entities_json, key_events_json, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('outline-100', 'novel-001', 'novel-001:main', 100, '女主被反派绑走', '反派抓住女主。', '原线有救援。', 'phase-3', '第三阶段', 'authored', 1, '["男主","女主"]', '["绑走"]', 100)
  database.prepare(
    `INSERT INTO outline_node_chapters (
      id, outline_node_id, chapter_no, chapter_id, chapter_title, is_primary, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('outline-anchor-100', 'outline-100', 100, 'chapter-100', '第100章', 1, 0)

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, what_if_session_id,
      future_jump_run_id, lane_index, color_token, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('if_fixture_001', 'novel-001', 'novel-001:main', 'what_if', 1, 10, 'IF 决裂线', '让男女主决裂。', null, 10, null, 'chapter-10', 'what-if-001', null, 0, 'rose', 'active')
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

describe('future-jump-service failure', () => {
  it('retries exactly once on bridge validation failure then marks the run failed without creating timeline nodes', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => ({
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
      }),
    }))

    const tempDatabase = createTempDatabaseCopy('chatbook-future-jump-service-failure')
    cleanups.push(tempDatabase.cleanup)
    const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
    globalForSqlite.sqlite = database
    seedFailureFixture(database)
    vi.resetModules()

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ bridgeSummary: '太短了' }) } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ bridgeSummary: '还是太短' }) } }] }), { status: 200 }))

    vi.stubGlobal('fetch', fetchMock)

    const service = await import('@/lib/server/future-jump-service')
    const { findFutureJumpRunById } = await import('@/lib/server/future-jump-store')

    await expect(service.generateFutureJump({
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
    })).rejects.toThrow(/Future jump generation failed: bridge stage failed after 2 attempts/)

    expect(fetchMock).toHaveBeenCalledTimes(2)

    const failedRun = database.prepare('SELECT id FROM future_jump_runs ORDER BY created_at DESC, id DESC LIMIT 1').get() as { id: string } | undefined
    expect(failedRun?.id).toBeTruthy()

    const persisted = findFutureJumpRunById(failedRun!.id)
    expect(persisted?.status).toBe('failed')
    expect(persisted?.errorMessage).toMatch(/bridgeSummary must be 300-600/)
    expect(persisted?.revisions).toHaveLength(0)

    const timelineCount = database.prepare('SELECT COUNT(*) AS count FROM story_timeline_nodes WHERE future_jump_run_id = ?').get(failedRun!.id) as { count: number }
    expect(timelineCount.count).toBe(0)
  }, 15000)
})
