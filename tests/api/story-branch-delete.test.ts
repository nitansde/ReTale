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

function seedDeleteFixture(database: DatabaseSync) {
  database.prepare(`INSERT INTO NovelRecord (id, title, author, sourceType) VALUES (?, ?, ?, ?)`).run('novel-001', 'Fixture Novel', 'Fixture Author', 'txt')
  database.prepare(`INSERT INTO StoryBranch (id, novelId, name, baseBranchId) VALUES (?, ?, ?, ?)`).run('novel-001:main', 'novel-001', 'main', null)
  database.prepare(`INSERT INTO StoryBranch (id, novelId, name, baseBranchId) VALUES (?, ?, ?, ?)`).run('novel-001:alt', 'novel-001', 'alt', 'novel-001:main')

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-10', 'novel-001', 'novel-001:main', 10, '第10章', '第10章正文', '第10章摘要', 1, 0, null, 'hash-10', 'ready')

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-100', 'novel-001', 'novel-001:main', 100, '第100章', '第100章正文', '第100章摘要', 1, 0, null, 'hash-100', 'ready')

  database.prepare(
    `INSERT INTO what_if_sessions (
      id, novel_id, base_branch_id, source_chapter_no, title, premise,
      selected_text, original_text, generated_text, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('what-if-001', 'novel-001', 'novel-001:main', 10, 'IF-01 决裂线', '让两人决裂', '原文', '原文正文', '改写正文', 'active')

  database.prepare(
    `INSERT INTO what_if_sessions (
      id, novel_id, base_branch_id, source_chapter_no, title, premise,
      selected_text, original_text, generated_text, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('what-if-002', 'novel-001', 'novel-001:main', 10, 'IF-02 保留线', '保留另一条线', '原文', '原文正文', '另一条改写正文', 'active')

  database.prepare(
    `INSERT INTO what_if_deltas (
      id, session_id, delta_type, subject_name, target_name, subject_entity_id, target_entity_id,
      key, old_value, new_value, valid_from_chapter, description, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('delta-001', 'what-if-001', 'relationship_change', '男主', '女主', null, null, 'relationship', '信任', '决裂', 10, '两人关系破裂。', 0.9)

  database.prepare(
    `INSERT INTO outline_nodes (
      id, novel_id, branch_id, chapter_no, title, summary, original_outcome,
      track_key, phase_label, source_type, confidence, involved_entities_json, key_events_json, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('outline-100', 'novel-001', 'novel-001:main', 100, '第100章节点', '未来节点摘要', '原线里更早获救', 'phase-3', '第三阶段', 'authored', 1, '["男主","女主"]', '["绑走"]', 100)

  database.prepare(
    `INSERT INTO outline_node_chapters (
      id, outline_node_id, chapter_no, chapter_id, chapter_title, is_primary, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('outline-chapter-100', 'outline-100', 100, 'chapter-100', '第100章', 1, 0)

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, what_if_session_id,
      future_jump_run_id, lane_index, color_token, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('if-node-001', 'novel-001', 'novel-001:main', 'what_if', 1, 10, 'IF-01 决裂线', '主线拐点', null, 10, null, 'chapter-10', 'what-if-001', null, 0, 'rose', 'active')

  database.prepare(
    `INSERT INTO future_jump_runs (
      id, session_id, base_branch_id, parent_timeline_node_id, target_outline_node_id,
      target_outline_chapter_id, source_chapter_no, target_chapter_no, user_direction,
      bridge_summary, generated_target_text, latest_revision_no, error_message, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('jump-run-001', 'what-if-001', 'novel-001:main', 'if-node-001', 'outline-100', 'outline-chapter-100', 10, 100, '让救援更晚', '桥接摘要', '未来正文', 2, null, 'revised')

  database.prepare(
    `INSERT INTO future_jump_revisions (
      id, run_id, revision_no, revision_kind, user_feedback, bridge_summary, generated_target_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('jump-revision-001', 'jump-run-001', 1, 'initial', null, '桥接摘要', '未来正文')

  database.prepare(
    `INSERT INTO future_jump_revisions (
      id, run_id, revision_no, revision_kind, user_feedback, bridge_summary, generated_target_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('jump-revision-002', 'jump-run-001', 2, 'feedback', '让误会更深', '第二版桥接摘要', '第二版未来正文')

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, what_if_session_id,
      future_jump_run_id, lane_index, color_token, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('jump-node-001', 'novel-001', 'novel-001:main', 'future_jump', 1, 100, 'JUMP-01 第100章', '迟到的救援', 'if-node-001', 10, 100, 'chapter-100', null, 'jump-run-001', 1, 'violet', 'revised')

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, what_if_session_id,
      future_jump_run_id, lane_index, color_token, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('if-node-002', 'novel-001', 'novel-001:main', 'what_if', 2, 10, 'IF-02 保留线', '未删除分支', null, 10, null, 'chapter-10', 'what-if-002', null, 0, 'sky', 'active')
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

describe('story branch delete APIs', () => {
  it('deletes a what-if session, its timeline node, and descendant future-jump lineage in branch context', async () => {
    const database = createTestDatabase('chatbook-story-branch-delete-what-if')
    seedDeleteFixture(database)
    vi.resetModules()

    const { DELETE } = await import('@/app/api/what-if/sessions/[sessionId]/route')
    const response = await DELETE(
      new Request('http://localhost/api/what-if/sessions/what-if-001?novelId=novel-001&branchId=novel-001:main', { method: 'DELETE' }),
      { params: Promise.resolve({ sessionId: 'what-if-001' }) }
    )

    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload).toEqual({ ok: true, sessionId: 'what-if-001' })

    expect(database.prepare('SELECT id FROM what_if_sessions WHERE id = ?').get('what-if-001')).toBeUndefined()
    expect(database.prepare('SELECT id FROM what_if_deltas WHERE session_id = ?').get('what-if-001')).toBeUndefined()
    expect(database.prepare('SELECT id FROM future_jump_runs WHERE id = ?').get('jump-run-001')).toBeUndefined()
    expect(database.prepare('SELECT id FROM future_jump_revisions WHERE run_id = ?').get('jump-run-001')).toBeUndefined()
    expect(database.prepare('SELECT id FROM story_timeline_nodes WHERE id = ?').get('if-node-001')).toBeUndefined()
    expect(database.prepare('SELECT id FROM story_timeline_nodes WHERE id = ?').get('jump-node-001')).toBeUndefined()
    expect(database.prepare('SELECT id FROM what_if_sessions WHERE id = ?').get('what-if-002')).toEqual({ id: 'what-if-002' })
    expect(database.prepare('SELECT id FROM story_timeline_nodes WHERE id = ?').get('if-node-002')).toEqual({ id: 'if-node-002' })
  })

  it('deletes a future-jump run and revisions while preserving the parent what-if node', async () => {
    const database = createTestDatabase('chatbook-story-branch-delete-future-jump')
    seedDeleteFixture(database)
    vi.resetModules()

    const { DELETE } = await import('@/app/api/future-jump/runs/[runId]/route')
    const response = await DELETE(
      new Request('http://localhost/api/future-jump/runs/jump-run-001?branchId=novel-001:main', { method: 'DELETE' }),
      { params: Promise.resolve({ runId: 'jump-run-001' }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, runId: 'jump-run-001' })

    expect(database.prepare('SELECT id FROM future_jump_runs WHERE id = ?').get('jump-run-001')).toBeUndefined()
    expect(database.prepare('SELECT id FROM future_jump_revisions WHERE run_id = ?').get('jump-run-001')).toBeUndefined()
    expect(database.prepare('SELECT id FROM story_timeline_nodes WHERE id = ?').get('jump-node-001')).toBeUndefined()
    expect(database.prepare('SELECT id FROM what_if_sessions WHERE id = ?').get('what-if-001')).toEqual({ id: 'what-if-001' })
    expect(database.prepare('SELECT id FROM story_timeline_nodes WHERE id = ?').get('if-node-001')).toEqual({ id: 'if-node-001' })
  })

  it('keeps branch-context validation on deletes', async () => {
    const database = createTestDatabase('chatbook-story-branch-delete-context')
    seedDeleteFixture(database)

    const [{ DELETE: deleteWhatIf }, { DELETE: deleteFutureJump }] = await Promise.all([
      import('@/app/api/what-if/sessions/[sessionId]/route'),
      import('@/app/api/future-jump/runs/[runId]/route'),
    ])

    const inaccessibleWhatIf = await deleteWhatIf(
      new Request('http://localhost/api/what-if/sessions/what-if-001?novelId=novel-001&branchId=novel-001:alt', { method: 'DELETE' }),
      { params: Promise.resolve({ sessionId: 'what-if-001' }) }
    )
    expect(inaccessibleWhatIf.status).toBe(404)
    await expect(inaccessibleWhatIf.json()).resolves.toEqual({
      ok: false,
      error: 'What-if session not found for the requested branch context',
    })

    const inaccessibleFutureJump = await deleteFutureJump(
      new Request('http://localhost/api/future-jump/runs/jump-run-001?branchId=novel-001:alt', { method: 'DELETE' }),
      { params: Promise.resolve({ runId: 'jump-run-001' }) }
    )
    expect(inaccessibleFutureJump.status).toBe(404)
    await expect(inaccessibleFutureJump.json()).resolves.toEqual({
      ok: false,
      error: 'Future jump run not found for the requested branch context',
    })
  })
})
