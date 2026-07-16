import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }
const originalDataDir = process.env.RETALE_DATA_DIR

function createTestDatabase(prefix: string, novelId = 'novel-001') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  cleanups.push(() => fs.rmSync(directory, { recursive: true, force: true }))
  const dataRoot = path.join(directory, 'data')
  const databasePath = path.join(dataRoot, 'novels', novelId, 'novel.db')
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  process.env.RETALE_DATA_DIR = dataRoot
  const database = initializeDatabase(new DatabaseSync(databasePath))
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

function seedPromoteFixture(database: DatabaseSync) {
  database.prepare(`INSERT INTO NovelRecord (id, title, author, sourceType) VALUES (?, ?, ?, ?)`).run('novel-promote', 'Promote Fixture', 'Fixture Author', 'txt')
  database.prepare(`INSERT INTO StoryBranch (id, novelId, name, baseBranchId) VALUES (?, ?, ?, ?)`).run('novel-promote:main', 'novel-promote', 'main', null)

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-promote-10', 'novel-promote', 'novel-promote:main', 10, '第10章', '第10章正文', '第10章摘要', 1, 0, null, 'hash-promote-10', 'ready')

  database.prepare(
    `INSERT INTO continue_blocks (
      id, novel_id, branch_id, parent_timeline_node_id, source_chapter_no, title, subtitle,
      user_instruction, selected_text, original_text, latest_text, latest_revision_no, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'rewrite-block-promote',
    'novel-promote',
    'novel-promote:main',
    null,
    10,
    'RE-01 第一版改写',
    '首个保存的改写节点',
    '重写这一段',
    '原文',
    '原文正文',
    '改写正文',
    1,
    'active',
    '2026-05-15 01:20:00',
    '2026-05-15 01:20:00'
  )

  database.prepare(
    `INSERT INTO continue_blocks (
      id, novel_id, branch_id, parent_timeline_node_id, source_chapter_no, title, subtitle,
      user_instruction, selected_text, original_text, latest_text, latest_revision_no, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'continue-block-promote-a',
    'novel-promote',
    'novel-promote:main',
    null,
    10,
    'RE-01, CONT-01 续写块',
    '第一个直属子节点',
    '继续推进',
    '原文',
    '原文正文',
    '续写正文 A',
    1,
    'active',
    '2026-05-15 01:21:00',
    '2026-05-15 01:21:00'
  )

  database.prepare(
    `INSERT INTO continue_blocks (
      id, novel_id, branch_id, parent_timeline_node_id, source_chapter_no, title, subtitle,
      user_instruction, selected_text, original_text, latest_text, latest_revision_no, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'continue-block-promote-b',
    'novel-promote',
    'novel-promote:main',
    null,
    10,
    'RE-01, CONT-02 续写块',
    '第二个直属子节点',
    '继续推进',
    '原文',
    '原文正文',
    '续写正文 B',
    1,
    'active',
    '2026-05-15 01:22:00',
    '2026-05-15 01:22:00'
  )

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, continue_block_id, what_if_session_id,
      future_jump_run_id, readable_label, readable_lineage_label, lane_index, color_token, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'rewrite-node-promote',
    'novel-promote',
    'novel-promote:main',
    'rewrite',
    1,
    10,
    'RE-01 第一版改写',
    '首个保存的改写节点',
    null,
    10,
    null,
    null,
    'rewrite-block-promote',
    null,
    null,
    'RE-01',
    'RE-01',
    0,
    'fuchsia',
    'active',
    '2026-05-15 01:20:00',
    '2026-05-15 01:20:00'
  )

  database.prepare('UPDATE continue_blocks SET parent_timeline_node_id = ? WHERE id = ?').run('rewrite-node-promote', 'continue-block-promote-a')
  database.prepare('UPDATE continue_blocks SET parent_timeline_node_id = ? WHERE id = ?').run('rewrite-node-promote', 'continue-block-promote-b')

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, continue_block_id, what_if_session_id,
      future_jump_run_id, readable_label, readable_lineage_label, lane_index, color_token, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'continue-node-promote-a',
    'novel-promote',
    'novel-promote:main',
    'continue_block',
    1,
    10,
    'RE-01, CONT-01 续写块',
    '第一个直属子节点',
    'rewrite-node-promote',
    10,
    null,
    null,
    'continue-block-promote-a',
    null,
    null,
    'CONT-01',
    'RE-01, CONT-01',
    1,
    'fuchsia',
    'active',
    '2026-05-15 01:21:00',
    '2026-05-15 01:21:00'
  )

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, continue_block_id, what_if_session_id,
      future_jump_run_id, readable_label, readable_lineage_label, lane_index, color_token, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'continue-node-promote-b',
    'novel-promote',
    'novel-promote:main',
    'continue_block',
    2,
    10,
    'RE-01, CONT-02 续写块',
    '第二个直属子节点',
    'rewrite-node-promote',
    10,
    null,
    null,
    'continue-block-promote-b',
    null,
    null,
    'CONT-02',
    'RE-01, CONT-02',
    1,
    'fuchsia',
    'active',
    '2026-05-15 01:22:00',
    '2026-05-15 01:22:00'
  )

  database.prepare(
    `INSERT INTO what_if_sessions (
      id, novel_id, base_branch_id, source_chapter_no, title, premise,
      selected_text, original_text, generated_text, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('what-if-promote-sibling', 'novel-promote', 'novel-promote:main', 10, 'IF-01 保留线', '保留另一条线', '原文', '原文正文', '另一条改写正文', 'active')

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, continue_block_id, what_if_session_id,
      future_jump_run_id, readable_label, readable_lineage_label, lane_index, color_token, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'if-node-promote-sibling',
    'novel-promote',
    'novel-promote:main',
    'what_if',
    1,
    10,
    'IF-01 保留线',
    '未删除分支',
    null,
    10,
    null,
    'chapter-promote-10',
    null,
    'what-if-promote-sibling',
    null,
    'IF-01',
    'IF-01',
    0,
    'rose',
    'active',
    '2026-05-15 01:25:00',
    '2026-05-15 01:25:00'
  )
}

afterEach(async () => {
  vi.resetModules()

  if (globalForSqlite.sqlite) {
    try {
      ;(globalForSqlite.sqlite as DatabaseSync & { close?: () => void }).close?.()
    } catch {
    }
    delete globalForSqlite.sqlite
  }

  const resolver = await import('@/lib/server/db-resolver')
  resolver.resetResolvedDatabasesForTests()
  if (originalDataDir === undefined) delete process.env.RETALE_DATA_DIR
  else process.env.RETALE_DATA_DIR = originalDataDir

  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('story branch delete APIs', () => {
  it('deletes a what-if session, its timeline node, and descendant future-jump lineage in branch context', async () => {
    const database = createTestDatabase('retale-story-branch-delete-what-if')
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
    const database = createTestDatabase('retale-story-branch-delete-future-jump')
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
    const database = createTestDatabase('retale-story-branch-delete-context')
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

  it('deletes only the current timeline node and promotes its direct children at the deleted index', async () => {
    const database = createTestDatabase('retale-story-branch-delete-promote', 'novel-promote')
    seedPromoteFixture(database)
    vi.resetModules()

    const [{ DELETE }, { loadStoryTimeline }] = await Promise.all([
      import('@/app/api/story-timeline/route'),
      import('@/lib/server/story-timeline-store'),
    ])
    const response = await DELETE(
      new Request('http://localhost/api/story-timeline?novelId=novel-promote&branchId=novel-promote:main', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: 'rewrite-node-promote' }),
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, nodeId: 'rewrite-node-promote' })

    expect(database.prepare('SELECT id FROM story_timeline_nodes WHERE id = ?').get('rewrite-node-promote')).toBeUndefined()
    expect(database.prepare('SELECT id FROM continue_blocks WHERE id = ?').get('rewrite-block-promote')).toBeUndefined()
    expect(database.prepare('SELECT parent_node_id FROM story_timeline_nodes WHERE id = ?').get('continue-node-promote-a')).toEqual({ parent_node_id: null })
    expect(database.prepare('SELECT parent_node_id FROM story_timeline_nodes WHERE id = ?').get('continue-node-promote-b')).toEqual({ parent_node_id: null })
    expect(database.prepare('SELECT readable_lineage_label FROM story_timeline_nodes WHERE id = ?').get('continue-node-promote-a')).toEqual({ readable_lineage_label: 'RE-01, CONT-01' })
    expect(database.prepare('SELECT readable_lineage_label FROM story_timeline_nodes WHERE id = ?').get('continue-node-promote-b')).toEqual({ readable_lineage_label: 'RE-01, CONT-02' })
    expect(database.prepare('SELECT parent_timeline_node_id FROM continue_blocks WHERE id = ?').get('continue-block-promote-a')).toEqual({ parent_timeline_node_id: null })
    expect(database.prepare('SELECT parent_timeline_node_id FROM continue_blocks WHERE id = ?').get('continue-block-promote-b')).toEqual({ parent_timeline_node_id: null })

    const timeline = loadStoryTimeline('novel-promote', 'novel-promote:main')
    expect(timeline.branchNodes).toEqual([
      expect.objectContaining({
        id: 'continue-node-promote-a',
        nodeType: 'continue_block',
        parentNodeId: null,
        readableLabel: 'CONT-01',
        readableLineageLabel: 'RE-01, CONT-01',
      }),
      expect.objectContaining({
        id: 'continue-node-promote-b',
        nodeType: 'continue_block',
        parentNodeId: null,
        readableLabel: 'CONT-02',
        readableLineageLabel: 'RE-01, CONT-02',
      }),
      expect.objectContaining({
        id: 'if-node-promote-sibling',
        nodeType: 'what_if',
        parentNodeId: null,
      }),
    ])
    expect(timeline.edges).toEqual([])

    const orderedNodes = database.prepare(
      'SELECT id, created_at FROM story_timeline_nodes WHERE novel_id = ? AND branch_id = ? ORDER BY created_at ASC, id ASC'
    ).all('novel-promote', 'novel-promote:main') as Array<{ id: string; created_at: string }>
    expect(orderedNodes).toEqual([
      { id: 'continue-node-promote-a', created_at: '2026-05-15 01:20:00.000' },
      { id: 'continue-node-promote-b', created_at: '2026-05-15 01:20:00.001' },
      { id: 'if-node-promote-sibling', created_at: '2026-05-15 01:25:00' },
    ])
    expect(orderedNodes.map((node) => node.id)).toEqual([
      'continue-node-promote-a',
      'continue-node-promote-b',
      'if-node-promote-sibling',
    ])
  })

  it('deletes a leaf timeline node without disturbing surviving sibling order', async () => {
    const database = createTestDatabase('retale-story-branch-delete-leaf', 'novel-promote')
    seedPromoteFixture(database)
    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, progress, currentStep, payloadJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'rewrite-job-orphan-leaf',
      'novel-promote',
      'novel-promote:main',
      'rewrite_generation',
      'running',
      0.65,
      '正在流式生成改写版本',
      JSON.stringify({
        request: {
          branchContextNodeId: 'continue-node-promote-a',
          continueBlockId: 'continue-block-promote-a',
        },
        panel: {
          novelId: 'novel-promote',
          branchId: 'novel-promote:main',
          chapterId: 'chapter-promote-10',
          selectedText: '',
          sourceText: '续写块正文',
          sourceTextOverride: null,
          userInstruction: '继续写',
          rewriteLaunchSource: 'continue_block',
          branchContextNodeId: 'continue-node-promote-a',
          branchContextInclusion: 'include_selected',
          continueBlockId: 'continue-block-promote-a',
          createdAt: '2026-05-15T01:23:45.000Z',
        },
        stream: true,
      })
    )
    vi.resetModules()

    const { DELETE } = await import('@/app/api/story-timeline/route')
    const response = await DELETE(
      new Request('http://localhost/api/story-timeline?novelId=novel-promote&branchId=novel-promote:main', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: 'continue-node-promote-a' }),
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, nodeId: 'continue-node-promote-a' })
    expect(database.prepare('SELECT id FROM continue_blocks WHERE id = ?').get('continue-block-promote-a')).toBeUndefined()
    expect(database.prepare('SELECT status FROM KnowledgeJob WHERE id = ?').get('rewrite-job-orphan-leaf')).toEqual({ status: 'aborted' })

    const orderedNodes = database.prepare(
      'SELECT id FROM story_timeline_nodes WHERE novel_id = ? AND branch_id = ? ORDER BY created_at ASC, id ASC'
    ).all('novel-promote', 'novel-promote:main') as Array<{ id: string }>
    expect(orderedNodes.map((node) => node.id)).toEqual([
      'rewrite-node-promote',
      'continue-node-promote-b',
      'if-node-promote-sibling',
    ])
  })
})
