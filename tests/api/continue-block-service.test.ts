import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const EVIDENCE_DIR = path.join(process.cwd(), '.sisyphus/evidence/task-3-continue-block-service')
const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }

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

function seedNovel(database: DatabaseSync) {
  database.prepare('INSERT INTO NovelRecord (id, title, author, sourceType) VALUES (?, ?, ?, ?)').run('novel-001', 'Fixture Novel', 'Fixture Author', 'txt')
  database.prepare('INSERT INTO StoryBranch (id, novelId, name, baseBranchId) VALUES (?, ?, ?, ?)').run('novel-001:main', 'novel-001', 'main', null)
  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
     revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-10', 'novel-001', 'novel-001:main', 10, '第10章', '第10章内容', '第10章摘要', 1, 0, null, 'hash-10', 'ready')

  database.prepare(
    `INSERT INTO what_if_sessions (
      id, novel_id, base_branch_id, source_chapter_no, title, premise,
      selected_text, original_text, generated_text, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'what-if-session-1',
    'novel-001',
    'novel-001:main',
    10,
    'IF-01 决裂线',
    '如果他们在这里闹翻。',
    '原始选区',
    '原始片段',
    'what-if 正文',
    'active'
  )

  database.prepare(
    `INSERT INTO outline_nodes (
      id, novel_id, branch_id, chapter_no, title, summary, original_outcome,
      track_key, phase_label, source_type, confidence, involved_entities_json, key_events_json, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'outline-100',
    'novel-001',
    'novel-001:main',
    100,
    '第100章 远期节点',
    '未来跳转目标节点',
    '原线里有不同结果。',
    'phase-3',
    '第三阶段',
    'authored',
    1,
    '["男主","女主"]',
    '["远期冲突"]',
    100
  )

  database.prepare(
    `INSERT INTO outline_node_chapters (
      id, outline_node_id, chapter_no, chapter_id, chapter_title, is_primary, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'outline-anchor-100',
    'outline-100',
    100,
    null,
    '第100章 远期节点',
    1,
    0
  )

  database.prepare(
    `INSERT INTO future_jump_runs (
      id, session_id, base_branch_id, parent_timeline_node_id, target_outline_node_id,
      target_outline_chapter_id, source_chapter_no, target_chapter_no, user_direction,
      bridge_summary, generated_target_text, latest_revision_no, error_message, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'jump-run-1',
    'what-if-session-1',
    'novel-001:main',
    null,
    'outline-100',
    'outline-anchor-100',
    10,
    100,
    '沿着未来推进',
    '桥接摘要',
    '未来正文',
    1,
    null,
    'generated'
  )

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, continue_block_id,
      what_if_session_id, future_jump_run_id, lane_index, color_token, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'jump-parent-1',
    'novel-001',
    'novel-001:main',
    'future_jump',
    1,
    100,
    'JUMP-01 远期跳转',
    '父级 future jump 节点',
    null,
    10,
    100,
    null,
    null,
    null,
    'jump-run-1',
    0,
    'violet',
    'generated'
  )
}

describe('continue-block service', () => {
  it('persists continue children under saved nodes, keeps future-jump continues as child blocks, and regenerates in place with history', async () => {
    const tempDatabase = createTempDatabaseCopy('chatbook-continue-block-service')
    cleanups.push(tempDatabase.cleanup)
    const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
    globalForSqlite.sqlite = database
    seedNovel(database)

    vi.resetModules()
    const { createContinueBlockFromRewrite, regenerateContinueBlock } = await import('@/lib/server/continue-block-service')
    const { findContinueBlockById } = await import('@/lib/server/continue-block-store')
    const { loadStoryTimeline } = await import('@/lib/server/story-timeline-store')
    const { GET: getContinueBlockDetail } = await import('@/app/api/continue-blocks/[continueBlockId]/route')

    const root = await createContinueBlockFromRewrite({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      sourceChapterNo: 10,
      selectedText: '原始选区',
      originalText: '原始片段',
      generatedText: '第一版续写正文',
      inputTokens: 10,
      outputTokens: 20,
      userInstruction: '保存这版续写结果',
      titleHint: '第一版续写',
    })

    const child = await createContinueBlockFromRewrite({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      sourceChapterNo: 10,
      parentTimelineNodeId: root.timelineNodeId,
      selectedText: '第一版续写正文',
      originalText: '第一版续写正文',
      generatedText: '第二版子续写正文',
      inputTokens: 30,
      outputTokens: 40,
      userInstruction: '沿着当前 continue block 继续写',
      titleHint: '第二版子续写',
    })

    const futureJumpChild = await createContinueBlockFromRewrite({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      sourceChapterNo: 10,
      parentTimelineNodeId: 'jump-parent-1',
      selectedText: '未来跳转后的正文',
      originalText: '未来跳转后的正文',
      generatedText: '沿着 future jump 继续写出的子续写正文',
      inputTokens: null,
      outputTokens: 50,
      userInstruction: '沿着当前 Future Jump 继续推进',
      titleHint: 'Future Jump 子续写',
    })

    const secondRoot = await createContinueBlockFromRewrite({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      sourceChapterNo: 10,
      selectedText: '另一条原始选区',
      originalText: '另一条原始片段',
      generatedText: '第二个根改写正文',
      inputTokens: 12,
      outputTokens: 24,
      userInstruction: '创建第二条 rewrite 根',
      titleHint: '第二个根改写',
    })

    const secondRootFirstChild = await createContinueBlockFromRewrite({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      sourceChapterNo: 10,
      parentTimelineNodeId: secondRoot.timelineNodeId,
      selectedText: '第二个根改写正文',
      originalText: '第二个根改写正文',
      generatedText: '第二个根下的首个续写',
      inputTokens: 14,
      outputTokens: 28,
      userInstruction: '第二条 rewrite 的首个续写',
      titleHint: '第二根首续写',
    })

    const secondRootSecondChild = await createContinueBlockFromRewrite({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      sourceChapterNo: 10,
      parentTimelineNodeId: secondRoot.timelineNodeId,
      selectedText: '第二个根下的首个续写',
      originalText: '第二个根下的首个续写',
      generatedText: '第二个根下的第二个续写',
      inputTokens: 16,
      outputTokens: 32,
      userInstruction: '第二条 rewrite 的第二个续写',
      titleHint: '第二根次续写',
    })

    const regenerated = await regenerateContinueBlock({
      continueBlockId: root.continueBlockId,
      generatedText: '第一版续写正文（重生）',
      userInstruction: '重新生成同一个 continue block',
      selectedText: '原始选区',
      originalText: '原始片段',
      inputTokens: 60,
      outputTokens: 70,
      titleHint: '第一版重生',
    })

    const rootDetail = findContinueBlockById(root.continueBlockId)
    const childDetail = findContinueBlockById(child.continueBlockId)
    const futureJumpChildDetail = findContinueBlockById(futureJumpChild.continueBlockId)
    const secondRootFirstChildDetail = findContinueBlockById(secondRootFirstChild.continueBlockId)
    const secondRootSecondChildDetail = findContinueBlockById(secondRootSecondChild.continueBlockId)
    const timeline = loadStoryTimeline('novel-001', 'novel-001:main')
    const rootTimelineNodes = timeline.branchNodes.filter((node) => node.continueBlockId === root.continueBlockId)
    const childNode = timeline.branchNodes.find((node) => node.id === child.timelineNodeId)
    const futureJumpChildNode = timeline.branchNodes.find((node) => node.id === futureJumpChild.timelineNodeId)
    const secondRootFirstChildNode = timeline.branchNodes.find((node) => node.id === secondRootFirstChild.timelineNodeId)
    const secondRootSecondChildNode = timeline.branchNodes.find((node) => node.id === secondRootSecondChild.timelineNodeId)

    expect(rootDetail?.timelineNodeId).toBe(root.timelineNodeId)
    expect(rootDetail?.latestText).toBe('第一版续写正文（重生）')
    expect(rootDetail?.inputTokens).toBe(60)
    expect(rootDetail?.outputTokens).toBe(70)
    expect(rootDetail?.latestRevisionNo).toBe(2)
    expect(rootDetail?.revisionHistory.map((item) => item.revisionKind)).toEqual(['initial', 'regenerate'])
    expect(rootDetail?.revisions.at(-1)).toEqual(expect.objectContaining({
      generatedText: '第一版续写正文（重生）',
      revisionNo: 2,
      revisionKind: 'regenerate',
    }))
    expect(childDetail?.parentTimelineNodeId).toBe(root.timelineNodeId)
    expect(futureJumpChildDetail?.parentTimelineNodeId).toBe('jump-parent-1')
    expect(secondRootFirstChildDetail?.parentTimelineNodeId).toBe(secondRoot.timelineNodeId)
    expect(secondRootSecondChildDetail?.parentTimelineNodeId).toBe(secondRoot.timelineNodeId)
    expect(childDetail?.latestRevisionNo).toBe(1)
    expect(childDetail?.inputTokens).toBe(30)
    expect(childDetail?.outputTokens).toBe(40)
    expect(futureJumpChildDetail?.latestRevisionNo).toBe(1)
    expect(futureJumpChildDetail?.inputTokens).toBeNull()
    expect(futureJumpChildDetail?.outputTokens).toBe(50)
    expect(regenerated.latestRevisionNo).toBe(2)
    expect(regenerated.timelineNodeId).toBe(root.timelineNodeId)
    expect(root.nodeType).toBe('rewrite')
    expect(child.nodeType).toBe('continue_block')
    expect(futureJumpChild.nodeType).toBe('continue_block')
    expect(secondRoot.nodeType).toBe('rewrite')
    expect(secondRootFirstChild.nodeType).toBe('continue_block')
    expect(secondRootSecondChild.nodeType).toBe('continue_block')
    expect(regenerated.nodeType).toBe('rewrite')
    expect(childNode?.readableLabel).toBe('CONT-01')
    expect(childNode?.readableLineageLabel).toBe('RE-01, CONT-01')
    expect(futureJumpChildNode?.readableLabel).toBe('CONT-01')
    expect(futureJumpChildNode?.readableLineageLabel).toBe('JUMP-01, CONT-01')
    expect(secondRootFirstChildNode?.readableLabel).toBe('CONT-01')
    expect(secondRootFirstChildNode?.readableLineageLabel).toBe('RE-02, CONT-01')
    expect(secondRootSecondChildNode?.readableLabel).toBe('CONT-02')
    expect(secondRootSecondChildNode?.readableLineageLabel).toBe('RE-02, CONT-02')
    expect(rootTimelineNodes).toHaveLength(1)
    const detailResponse = await getContinueBlockDetail(
      new Request(`http://localhost/api/continue-blocks/${root.continueBlockId}?novelId=novel-001&branchId=novel-001:main`),
      { params: Promise.resolve({ continueBlockId: root.continueBlockId }) }
    )
    expect(detailResponse.status).toBe(200)
    const detailPayload = await detailResponse.json() as {
      id: string
      latestRevisionNo: number
      latestText: string
      revisionHistory: Array<{ revisionNo: number; revisionKind: string }>
      revisions: Array<{ revisionNo: number; generatedText: string }>
    }
    expect(detailPayload).toEqual(expect.objectContaining({
      id: root.continueBlockId,
      latestRevisionNo: 2,
      latestText: '第一版续写正文（重生）',
      revisionHistory: [
        expect.objectContaining({ revisionNo: 1, revisionKind: 'initial' }),
        expect.objectContaining({ revisionNo: 2, revisionKind: 'regenerate' }),
      ],
      revisions: [
        expect.objectContaining({ revisionNo: 1, generatedText: '第一版续写正文' }),
        expect.objectContaining({ revisionNo: 2, generatedText: '第一版续写正文（重生）' }),
      ],
    }))
    expect(timeline.branchNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: root.timelineNodeId,
        nodeType: 'rewrite',
        continueBlockId: root.continueBlockId,
        parentNodeId: null,
        currentText: '第一版续写正文（重生）',
        inputTokens: 60,
        outputTokens: 70,
      }),
      expect.objectContaining({
        id: child.timelineNodeId,
        nodeType: 'continue_block',
        continueBlockId: child.continueBlockId,
        parentNodeId: root.timelineNodeId,
        currentText: '第二版子续写正文',
        inputTokens: 30,
        outputTokens: 40,
      }),
      expect.objectContaining({
        id: futureJumpChild.timelineNodeId,
        nodeType: 'continue_block',
        continueBlockId: futureJumpChild.continueBlockId,
        parentNodeId: 'jump-parent-1',
      }),
    ]))
    expect(timeline.edges).toEqual(expect.arrayContaining([
      { fromNodeId: root.timelineNodeId, toNodeId: child.timelineNodeId },
      { fromNodeId: 'jump-parent-1', toNodeId: futureJumpChild.timelineNodeId },
    ]))

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'continue-block-report.json'),
      JSON.stringify({
        root,
        child,
        futureJumpChild,
        regenerated,
        rootRevisionKinds: rootDetail?.revisionHistory.map((item) => item.revisionKind),
        branchNodes: timeline.branchNodes.filter((node) => ['rewrite', 'continue_block'].includes(node.nodeType)),
      }, null, 2)
    )
  })

  it('rejects regenerate for a missing continue block', async () => {
    const tempDatabase = createTempDatabaseCopy('chatbook-continue-block-missing')
    cleanups.push(tempDatabase.cleanup)
    const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
    globalForSqlite.sqlite = database
    seedNovel(database)

    vi.resetModules()
    const { regenerateContinueBlock } = await import('@/lib/server/continue-block-service')

    await expect(regenerateContinueBlock({
      continueBlockId: 'missing-continue-block',
      generatedText: '不会写入',
      userInstruction: '重新生成',
      selectedText: '原始选区',
      originalText: '原始片段',
    })).rejects.toThrow('Continue block not found: missing-continue-block')
  })
})
