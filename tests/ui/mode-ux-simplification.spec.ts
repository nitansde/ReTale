import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import { ensureEvidenceDir, writeEvidenceFile } from '@/tests/helpers/evidence'
import { storyBranchFixtureIds } from '@/tests/helpers/fixture-ids'
import type { StoryTimelineResponse } from '@/lib/story-branch-types'

const fixturePath = process.cwd() + '/scripts/fixtures/workspace-import-smoke.txt'
const evidenceDirectory = ensureEvidenceDir('task-14-mode-ux-simplification')

function buildEmptyWorkspacePayload() {
  return {
    currentNovelId: null,
    currentChapterId: null,
    localNovels: [],
    localVolumes: [],
    localChapters: [],
    localOutlines: [],
    localCharacters: [],
    localCharacterRelations: [],
    localWorldEntries: [],
    localTimelineEvents: [],
    rewriteCandidates: [],
    rewriteHistory: [],
    trajectories: [],
    rewriteMode: 'rewrite',
    rewriteTone: 'balanced',
    rewriteOutput: 'full',
    rewriteScope: 'chapter',
    selectionText: '',
    selectedParagraphIndex: null,
    thinkingLevel: 'standard',
    autoContinue: false,
    keepCanon: true,
    promptText: '',
    selectedPresetId: '',
    presets: [],
    constraints: [],
    focusMode: false,
    presetCompatSessionState: {},
    aiSettings: buildWorkspacePayload().aiSettings,
  }
}

function buildWorkspacePayload() {
  return {
    currentNovelId: 'novel-001',
    currentChapterId: 'chapter-10',
    currentTab: 'editor',
    helperTab: 'trajectory',
    expandedVolumeIds: ['volume-001'],
    localNovels: [{
      id: 'novel-001',
      title: '合成测试故事（短样本）',
      summary: '用于 mode UX simplification 的 TXT 导入夹具。',
      tags: ['fixture'],
      chapterCount: 2,
      wordCount: 3100,
      updatedAt: '2026-05-18',
    }],
    localVolumes: [{ id: 'volume-001', novelId: 'novel-001', title: '第一卷', order: 1 }],
    localChapters: [
      {
        id: 'chapter-10',
        novelId: 'novel-001',
        volumeId: 'volume-001',
        title: '第10章 结盟',
        order: 10,
        content: '<p>第10章正文</p>',
        originalContent: '<p>第10章正文</p>',
        status: 'draft',
        wordCount: 1200,
        updatedAt: '2026-05-18',
        trajectory: [],
      },
      {
        id: 'chapter-100',
        novelId: 'novel-001',
        volumeId: 'volume-001',
        title: '第100章 被绑走',
        order: 100,
        content: '<p>第100章正文</p>',
        originalContent: '<p>第100章正文</p>',
        status: 'draft',
        wordCount: 1900,
        updatedAt: '2026-05-18',
        trajectory: [],
      },
    ],
    localOutlines: [],
    localCharacters: [],
    localCharacterRelations: [],
    localWorldEntries: [],
    localTimelineEvents: [],
    rewriteCandidates: [],
    rewriteHistory: [],
    trajectories: [],
    rewriteMode: 'rewrite',
    rewriteTone: 'balanced',
    rewriteOutput: 'full',
    rewriteScope: 'chapter',
    selectionText: '',
    selectedParagraphIndex: null,
    thinkingLevel: 'standard',
    autoContinue: false,
    keepCanon: true,
    promptText: '',
    selectedPresetId: '',
    presets: [],
    constraints: [],
    focusMode: false,
    presetCompatSessionState: {},
    aiSettings: {
      rewrite: {
        provider: 'openai-compatible',
        openAICompatible: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'gpt-4.1-mini' },
        ollama: { baseUrl: 'http://localhost:11434', model: 'qwen3:8b' },
      },
      knowledgeExtraction: {
        provider: 'openai-compatible',
        openAICompatible: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'gpt-4.1-mini' },
        ollama: { baseUrl: 'http://localhost:11434', model: 'qwen3:8b' },
      },
      embeddings: {
        provider: 'openai-compatible',
        openAICompatible: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'text-embedding-3-large' },
        ollama: { baseUrl: 'http://localhost:11434', model: 'nomic-embed-text' },
        embeddingBatchSize: 16,
      },
    },
  }
}

function buildKnowledgeViewPayload() {
  return {
    ok: true,
    localOutlines: [],
    localCharacters: [],
    localCharacterRelations: [],
    localWorldEntries: [],
    localTimelineEvents: [],
    knowledgeRebuildStatus: null,
    jobOutcome: null,
  }
}

function buildGenerationContextPayload() {
  return {
    ok: true,
    novelId: 'novel-001',
    branchId: 'novel-001:main',
    chapterId: 'chapter-10',
    chapterNo: 10,
    chapterTitle: '第10章 结盟',
    selectedLineStart: 1,
    selectedLineEnd: 5,
    warnings: [],
    promptBlocks: [{
      id: 'future-jump-context',
      label: 'Future jump context',
      enabled: true,
      priority: 'high',
      content: 'Latest speculative future branch context',
    }],
    assembledContext: 'Latest speculative future branch context',
    lanceEvidence: [],
    tokenEstimate: 42,
    graphContext: {
      seedEntities: [],
      nodes: [],
      edges: [],
      contextText: '',
      warnings: [],
      tokenEstimate: 42,
      status: 'ready',
    },
  }
}

function buildWhatIfSessionDetail() {
  return {
    id: 'what-if-session-001',
    novelId: 'novel-001',
    baseBranchId: 'novel-001:main',
    sourceChapterNo: 10,
    title: 'IF-01 决裂线',
    premise: '如果他们在这里闹翻',
    selectedText: '第10章正文',
    originalText: '第10章正文',
    generatedText: '魔改后的 What-if 正文',
    status: 'active',
    createdAt: '2026-05-18T01:23:45.000Z',
    updatedAt: '2026-05-18T01:23:45.000Z',
    deltas: [{
      id: 'what-if-delta-001',
      sessionId: 'what-if-session-001',
      deltaType: 'relationship_change',
      subjectName: '男主',
      targetName: '女主',
      subjectEntityId: null,
      targetEntityId: null,
      key: 'relationship',
      oldValue: '信任',
      newValue: '决裂',
      validFromChapter: 10,
      description: '两人关系在这里彻底破裂。',
      confidence: 0.92,
      createdAt: '2026-05-18T01:23:45.000Z',
    }],
  }
}

function buildFutureMapPayload() {
  return {
    novelId: 'novel-001',
    branchId: 'novel-001:main',
    tracks: [
      { trackKey: 'phase-3', phaseLabel: '第三阶段', eventCount: 1, sourceTypes: ['authored'] },
      { trackKey: 'phase-4', phaseLabel: '第四阶段', eventCount: 1, sourceTypes: ['derived_event'] },
    ],
    events: [
      {
        id: 'outline_event_100',
        chapterNo: 100,
        title: '第100章 被绑走',
        summary: '女主被带走。',
        originalOutcome: '仍有救援机会。',
        trackKey: 'phase-3',
        phaseLabel: '第三阶段',
        sourceType: 'authored',
        confidence: 0.9,
        sortOrder: 1,
      },
      {
        id: 'outline_event_120',
        chapterNo: 120,
        title: '第120章 断桥重逢',
        summary: '基于现有线索推导出的重逢节点。',
        originalOutcome: null,
        trackKey: 'phase-4',
        phaseLabel: '第四阶段',
        sourceType: 'derived_event',
        confidence: 0.74,
        sortOrder: 2,
      },
    ],
    chaptersByEvent: {
      outline_event_100: [{
        id: 'outline_chapter_100_primary',
        outlineNodeId: 'outline_event_100',
        chapterNo: 100,
        chapterId: 'chapter-100',
        chapterTitle: '第100章 被绑走',
        isPrimary: true,
        sortOrder: 0,
        createdAt: '2026-05-18T01:23:45.000Z',
        updatedAt: '2026-05-18T01:23:45.000Z',
      }],
      outline_event_120: [{
        id: 'outline_chapter_120_primary',
        outlineNodeId: 'outline_event_120',
        chapterNo: 120,
        chapterId: null,
        chapterTitle: '第120章 断桥重逢',
        isPrimary: true,
        sortOrder: 0,
        createdAt: '2026-05-18T01:23:45.000Z',
        updatedAt: '2026-05-18T01:23:45.000Z',
      }],
    },
    defaults: {
      selectedTrackKey: 'phase-3',
      selectedOutlineNodeId: 'outline_event_100',
    },
  }
}

function buildFutureJumpRunDetail() {
  return {
    id: 'jump-run-001',
    sessionId: 'what-if-session-001',
    baseBranchId: 'novel-001:main',
    parentTimelineNodeId: 'continue-node-1',
    targetOutlineNodeId: storyBranchFixtureIds.outlineEventId,
    targetOutlineChapterId: storyBranchFixtureIds.outlineChapterAnchorId,
    sourceChapterNo: 10,
    targetChapterNo: 100,
    userDirection: '让救援更晚到来',
    bridgeSummary: '第二版桥接摘要：误会升级，救援晚到一步。',
    generatedTargetText: '第二版未来正文：她被带走后，误会已经先一步封死所有退路。',
    latestRevisionNo: 2,
    errorMessage: null,
    status: 'generated',
    createdAt: '2026-05-18T01:23:45.000Z',
    updatedAt: '2026-05-18T01:23:45.000Z',
    timelineNodeId: storyBranchFixtureIds.futureJumpNodeId,
    latestRevision: {
      id: 'future-jump-revision-2',
      runId: 'jump-run-001',
      revisionNo: 2,
      revisionKind: 'feedback',
      userFeedback: '让误会先彻底锁死',
      bridgeSummary: '第二版桥接摘要：误会升级，救援晚到一步。',
      generatedTargetText: '第二版未来正文：她被带走后，误会已经先一步封死所有退路。',
      createdAt: '2026-05-18T01:22:45.000Z',
    },
    revisionHistory: [
      { revisionNo: 1, revisionKind: 'initial', userFeedback: null, createdAt: '2026-05-18T01:21:45.000Z' },
      { revisionNo: 2, revisionKind: 'feedback', userFeedback: '让误会先彻底锁死', createdAt: '2026-05-18T01:22:45.000Z' },
    ],
    revisions: [
      {
        id: 'future-jump-revision-1',
        runId: 'jump-run-001',
        revisionNo: 1,
        revisionKind: 'initial',
        userFeedback: null,
        bridgeSummary: '初始桥接摘要：未来仍有更快的援手。',
        generatedTargetText: '初始未来正文：旧版正文。',
        createdAt: '2026-05-18T01:21:45.000Z',
      },
      {
        id: 'future-jump-revision-2',
        runId: 'jump-run-001',
        revisionNo: 2,
        revisionKind: 'feedback',
        userFeedback: '让误会先彻底锁死',
        bridgeSummary: '第二版桥接摘要：误会升级，救援晚到一步。',
        generatedTargetText: '第二版未来正文：她被带走后，误会已经先一步封死所有退路。',
        createdAt: '2026-05-18T01:22:45.000Z',
      },
    ],
  }
}

function buildBaseTimeline(): StoryTimelineResponse {
  return {
    novelId: 'novel-001',
    branchId: 'novel-001:main',
    chapters: [
      { type: 'chapter', chapterNo: 10, chapterId: 'chapter-10', title: '第10章 结盟', wordCount: 1200 },
      { type: 'chapter', chapterNo: 100, chapterId: 'chapter-100', title: '第100章 被绑走', wordCount: 1900 },
    ],
    branchNodes: [],
    edges: [],
  }
}

function buildContinueParentNode(overrides?: Partial<StoryTimelineResponse['branchNodes'][number]>) {
  return {
    type: 'branch_node' as const,
    id: 'continue-node-1',
    nodeType: 'continue_block' as const,
    anchorChapterNo: 10,
    parentNodeId: storyBranchFixtureIds.whatIfNodeId,
    title: 'CONT-01 续写块',
    subtitle: '沿着分支继续推进',
    laneIndex: 0,
    colorToken: 'fuchsia',
    sourceChapterNo: 10,
    targetChapterNo: null,
    continueBlockId: 'continue-block-1',
    whatIfSessionId: null,
    futureJumpRunId: null,
    latestText: '已保存的续写块正文：她在门后听见誓言改变了方向。',
    latestRevisionNo: 1,
    userInstruction: '把誓言后的情绪变化压进同一场景。',
    selectedText: '第10章正文',
    originalText: '第10章正文',
    createdAt: '2026-05-18T01:22:00.000Z',
    status: 'active',
    ...overrides,
  }
}

function buildWhatIfAncestorNode() {
  return {
    type: 'branch_node' as const,
    id: storyBranchFixtureIds.whatIfNodeId,
    nodeType: 'what_if' as const,
    anchorChapterNo: 10,
    parentNodeId: null,
    title: 'IF-01 决裂线',
    subtitle: '如果他们在这里闹翻',
    laneIndex: 0,
    colorToken: 'rose',
    sourceChapterNo: 10,
    targetChapterNo: null,
    continueBlockId: null,
    whatIfSessionId: 'what-if-session-001',
    futureJumpRunId: null,
    createdAt: '2026-05-18T01:21:00.000Z',
    status: 'active',
  }
}

function buildAfterSaveTimeline(): StoryTimelineResponse {
  return {
    ...buildBaseTimeline(),
    branchNodes: [buildWhatIfAncestorNode(), buildContinueParentNode()],
    edges: [{ fromNodeId: storyBranchFixtureIds.whatIfNodeId, toNodeId: 'continue-node-1' }],
  }
}

function buildAfterContinueTimeline(): StoryTimelineResponse {
  return {
    ...buildAfterSaveTimeline(),
    branchNodes: [
      buildWhatIfAncestorNode(),
      buildContinueParentNode(),
      {
        type: 'branch_node' as const,
        id: 'continue-node-2',
        nodeType: 'continue_block' as const,
        anchorChapterNo: 10,
        parentNodeId: 'continue-node-1',
        title: 'CONT-02 子续写块',
        subtitle: '沿着当前续写块继续推进',
        laneIndex: 0,
        colorToken: 'fuchsia',
        sourceChapterNo: 10,
        targetChapterNo: null,
        continueBlockId: 'continue-block-2',
        whatIfSessionId: null,
        futureJumpRunId: null,
        latestText: '子续写块正文：誓言之后，她选择独自离开。',
        latestRevisionNo: 1,
        userInstruction: '继续沿着这个 continue block 的最新版本扩展新的续写块，不要覆盖当前节点。',
        selectedText: '第10章正文',
        originalText: '已保存的续写块正文：她在门后听见誓言改变了方向。',
        createdAt: '2026-05-18T01:23:00.000Z',
        status: 'active',
      },
    ],
    edges: [
      { fromNodeId: storyBranchFixtureIds.whatIfNodeId, toNodeId: 'continue-node-1' },
      { fromNodeId: 'continue-node-1', toNodeId: 'continue-node-2' },
    ],
  }
}

function buildAfterRegenerateTimeline(): StoryTimelineResponse {
  const afterContinue = buildAfterContinueTimeline()
  return {
    ...afterContinue,
    branchNodes: afterContinue.branchNodes.map((node) => node.id === 'continue-node-1'
      ? buildContinueParentNode({
          title: 'CONT-01 重生版',
          subtitle: '同节点重生后保留修订历史',
          latestText: '重生后的续写块正文：保留修订历史的新版。',
          latestRevisionNo: 2,
          userInstruction: '重新生成当前 continue block，并保留它的修订历史。',
        })
      : node),
  }
}

function buildAfterFutureJumpTimeline(): StoryTimelineResponse {
  const afterRegenerate = buildAfterRegenerateTimeline()
  return {
    ...afterRegenerate,
    branchNodes: [
      ...afterRegenerate.branchNodes,
      {
        type: 'branch_node' as const,
        id: storyBranchFixtureIds.futureJumpNodeId,
        nodeType: 'future_jump' as const,
        anchorChapterNo: 100,
        parentNodeId: 'continue-node-1',
        title: 'JUMP-01 第100章',
        subtitle: '跳到被绑走后的未来',
        laneIndex: 0,
        colorToken: 'violet',
        sourceChapterNo: 10,
        targetChapterNo: 100,
        continueBlockId: null,
        whatIfSessionId: null,
        futureJumpRunId: 'jump-run-001',
        createdAt: '2026-05-18T01:24:00.000Z',
        status: 'generated',
      },
    ],
    edges: [
      ...afterRegenerate.edges,
      { fromNodeId: 'continue-node-1', toNodeId: storyBranchFixtureIds.futureJumpNodeId },
    ],
  }
}

function buildAfterFutureJumpContinueTimeline(): StoryTimelineResponse {
  const afterFutureJump = buildAfterFutureJumpTimeline()
  return {
    ...afterFutureJump,
    branchNodes: [
      ...afterFutureJump.branchNodes,
      {
        type: 'branch_node' as const,
        id: 'continue-node-3',
        nodeType: 'continue_block' as const,
        anchorChapterNo: 100,
        parentNodeId: storyBranchFixtureIds.futureJumpNodeId,
        title: 'CONT-03 未来续写块',
        subtitle: '沿着未来跳转继续推进',
        laneIndex: 0,
        colorToken: 'fuchsia',
        sourceChapterNo: 100,
        targetChapterNo: null,
        continueBlockId: 'continue-block-3',
        whatIfSessionId: null,
        futureJumpRunId: null,
        latestText: '未来续写块正文：她被带走后，誓言开始在更远的地方回响。',
        latestRevisionNo: 1,
        userInstruction: '沿着未来跳转后的正文继续推进。',
        selectedText: '第二版未来正文：她被带走后，误会已经先一步封死所有退路。',
        originalText: '第二版未来正文：她被带走后，误会已经先一步封死所有退路。',
        createdAt: '2026-05-18T01:25:00.000Z',
        status: 'active',
      },
    ],
    edges: [
      ...afterFutureJump.edges,
      { fromNodeId: storyBranchFixtureIds.futureJumpNodeId, toNodeId: 'continue-node-3' },
    ],
  }
}

async function selectWholeEditorParagraph(page: Page) {
  await page.locator('[contenteditable="true"]').evaluate((editor: HTMLElement) => {
    const paragraph = editor.querySelector('p')
    const textNode = paragraph?.firstChild
    if (!paragraph || !textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('Failed to resolve editor text node for selection')
    }

    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, textNode.textContent?.length ?? 0)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
}

test('simplified mode flow covers import, continue-block lineage, future-jump continue, collapsed context, and obsolete-surface absence', async ({ page }) => {
  let imported = false
  let timelineState = buildBaseTimeline()
  let presetCompatLibrary = createDefaultPresetCompatLibrary()
  const rewriteBodies = [
    '已保存的续写块正文：她在门后听见誓言改变了方向。',
    '子续写块正文：誓言之后，她选择独自离开。',
    '重生后的续写块正文：保留修订历史的新版。',
    '未来续写块正文：她被带走后，誓言开始在更远的地方回响。',
  ]
  let rewriteIndex = 0
  let futureJumpPayload: Record<string, unknown> | null = null

  await page.route('**/api/workspace', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) })
      return
    }

    await route.fulfill({
      status: 200,
      body: JSON.stringify(imported ? buildWorkspacePayload() : buildEmptyWorkspacePayload()),
      contentType: 'application/json',
    })
  })
  await page.route('**/api/settings/ai', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) })
      return
    }
    await route.fulfill({ status: 200, body: JSON.stringify(buildWorkspacePayload().aiSettings), contentType: 'application/json' })
  })
  await page.route('**/api/settings/preset-compat', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { library: typeof presetCompatLibrary }
      presetCompatLibrary = {
        ...body.library,
        revision: body.library.revision + 1,
      }
      await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, library: presetCompatLibrary }), contentType: 'application/json' })
      return
    }

    await route.fulfill({ status: 200, body: JSON.stringify(presetCompatLibrary), contentType: 'application/json' })
  })
  await page.route('**/api/import-txt', async (route) => {
    imported = true
    timelineState = buildBaseTimeline()
    await route.fulfill({
      status: 200,
      body: JSON.stringify({ novelId: 'novel-001', chapterId: 'chapter-10', chapterCount: 2 }),
      contentType: 'application/json',
    })
  })
  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify(timelineState), contentType: 'application/json' })
  })
  await page.route('**/api/knowledge-view*', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify(buildKnowledgeViewPayload()), contentType: 'application/json' })
  })
  await page.route('**/api/rag/build-generation-context', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify(buildGenerationContextPayload()), contentType: 'application/json' })
  })
  await page.route('**/api/rewrite', async (route) => {
    const body = rewriteBodies[Math.min(rewriteIndex, rewriteBodies.length - 1)]
    rewriteIndex += 1
    await route.fulfill({ status: 200, body, contentType: 'text/plain' })
  })
  await page.route('**/api/continue-blocks', async (route) => {
    const payload = route.request().postDataJSON() as { parentTimelineNodeId?: string | null }

    if (route.request().method() === 'PUT') {
      timelineState = buildAfterRegenerateTimeline()
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          continueBlockId: 'continue-block-1',
          timelineNodeId: 'continue-node-1',
          generatedText: '重生后的续写块正文：保留修订历史的新版。',
          title: 'CONT-01 重生版',
          subtitle: '同节点重生后保留修订历史',
          latestRevisionNo: 2,
        }),
        contentType: 'application/json',
      })
      return
    }

    if (payload.parentTimelineNodeId === storyBranchFixtureIds.futureJumpNodeId) {
      timelineState = buildAfterFutureJumpContinueTimeline()
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          continueBlockId: 'continue-block-3',
          timelineNodeId: 'continue-node-3',
          generatedText: '未来续写块正文：她被带走后，誓言开始在更远的地方回响。',
          title: 'CONT-03 未来续写块',
          subtitle: '沿着未来跳转继续推进',
          latestRevisionNo: 1,
        }),
        contentType: 'application/json',
      })
      return
    }

    if (payload.parentTimelineNodeId === 'continue-node-1') {
      timelineState = buildAfterContinueTimeline()
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          continueBlockId: 'continue-block-2',
          timelineNodeId: 'continue-node-2',
          generatedText: '子续写块正文：誓言之后，她选择独自离开。',
          title: 'CONT-02 子续写块',
          subtitle: '沿着当前续写块继续推进',
          latestRevisionNo: 1,
        }),
        contentType: 'application/json',
      })
      return
    }

    timelineState = buildAfterSaveTimeline()
    await route.fulfill({
      status: 200,
      body: JSON.stringify({
        continueBlockId: 'continue-block-1',
        timelineNodeId: 'continue-node-1',
        generatedText: '已保存的续写块正文：她在门后听见誓言改变了方向。',
        title: 'CONT-01 续写块',
        subtitle: '沿着分支继续推进',
        latestRevisionNo: 1,
      }),
      contentType: 'application/json',
    })
  })
  await page.route('**/api/story-future-map*', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify(buildFutureMapPayload()), contentType: 'application/json' })
  })
  await page.route('**/api/what-if/sessions/what-if-session-001?*', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify(buildWhatIfSessionDetail()), contentType: 'application/json' })
  })
  await page.route('**/api/future-jump/runs', async (route) => {
    futureJumpPayload = route.request().postDataJSON()
    timelineState = buildAfterFutureJumpTimeline()
    await route.fulfill({
      status: 200,
      body: JSON.stringify({
        runId: 'jump-run-001',
        timelineNodeId: storyBranchFixtureIds.futureJumpNodeId,
        bridgeSummary: '第二版桥接摘要：误会升级，救援晚到一步。',
        generatedTargetText: '第二版未来正文：她被带走后，误会已经先一步封死所有退路。',
      }),
      contentType: 'application/json',
    })
  })
  await page.route('**/api/future-jump/runs/jump-run-001?*', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify(buildFutureJumpRunDetail()), contentType: 'application/json' })
  })

  await page.goto('/library', { waitUntil: 'networkidle' })
  await expect(page.getByText('导入 TXT 小说')).toBeVisible()

  await page.locator('input[type=file]').setInputFiles(fixturePath)
  await expect(page).toHaveURL(/\/workspace(?:\?|$)/)
  await expect(page.getByTestId('timeline-chapter-10')).toBeVisible()
  await expect(page.getByTestId('timeline-chapter-100')).toBeVisible()

  await page.getByTestId('preset-compat-library-open').click()
  await expect(page.getByTestId('preset-compat-library-modal')).toBeVisible()
  await expect(page.getByTestId('preset-compat-builtin-system-toggle-rewrite')).toBeVisible()
  await expect(page.getByTestId('preset-compat-builtin-system-toggle-future_jump')).toBeVisible()
  await expect(page.getByTestId('preset-compat-builtin-system-toggle-roleplay')).toBeVisible()
  await expect(page.getByTestId('preset-compat-builtin-system-toggle-expand')).toHaveCount(0)
  await expect(page.getByTestId('preset-compat-builtin-system-toggle-polish')).toHaveCount(0)
  await expect(page.getByTestId('preset-compat-builtin-system-toggle-continue')).toHaveCount(0)
  await page.locator('[data-testid="preset-compat-library-modal"] button').first().click()
  await expect(page.getByTestId('preset-compat-library-modal')).toHaveCount(0)

  await selectWholeEditorParagraph(page)
  await expect(page.getByTestId('workspace-chapter-rewrite-entry')).toBeVisible()
  await expect(page.getByTestId('workspace-chapter-roleplay-entry')).toBeVisible()
  await expect(page.getByTestId('workspace-chapter-future_jump-entry')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Future Jump/i })).toHaveCount(0)

  await page.getByTestId('workspace-chapter-rewrite-entry').click()
  await expect(page.getByTestId('workspace-context-panel-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('workspace-context-panel')).toHaveCount(0)
  await page.getByTestId('workspace-context-panel-toggle').click()
  await expect(page.getByTestId('workspace-context-panel')).toBeVisible()
  await expect(page.getByText('Future jump context')).toBeVisible()
  const contextBlockToggle = page.getByTestId('workspace-context-panel').getByRole('checkbox').first()
  await expect(contextBlockToggle).toBeChecked()
  await contextBlockToggle.uncheck()
  await page.getByTestId('workspace-context-panel-toggle').click()
  await expect(page.getByTestId('workspace-context-panel')).toHaveCount(0)
  await page.getByTestId('workspace-context-panel-toggle').click()
  await expect(page.getByTestId('workspace-context-panel')).toBeVisible()
  await expect(page.getByTestId('workspace-context-panel').getByRole('checkbox').first()).not.toBeChecked()

  await page.getByRole('button', { name: '生成候选版本' }).click()
  await expect(page.getByText('已保存的续写块正文：她在门后听见誓言改变了方向。').first()).toBeVisible()
  await page.getByRole('button', { name: '保存为续写块' }).click()

  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('continue-block')
  await expect(page.getByTestId('workspace-continue-block-view')).toBeVisible()
  await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('已保存的续写块正文：她在门后听见誓言改变了方向。')
  await expect(page.getByTestId('workspace-continue-block-continue-entry')).toBeEnabled()
  await expect(page.getByTestId('workspace-continue-block-regenerate-entry')).toBeEnabled()
  await expect(page.getByTestId('workspace-continue-block-future-jump-entry')).toBeEnabled()

  await page.getByTestId('workspace-continue-block-continue-entry').click()
  await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
  await expect(page.getByRole('button', { name: /当前续写块版本/ })).toBeVisible()
  await page.getByRole('button', { name: '生成候选版本' }).click()
  await expect(page.getByText('子续写块正文：誓言之后，她选择独自离开。').first()).toBeVisible()
  await page.getByRole('button', { name: '保存为续写块' }).click()
  await expect(page).toHaveURL(/selectionNodeId=continue-node-2/)
  await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('子续写块正文：誓言之后，她选择独自离开。')

  await page.getByTestId('timeline-node-continue-node-1').click()
  await expect(page).toHaveURL(/selectionNodeId=continue-node-1/)
  await page.getByTestId('workspace-continue-block-regenerate-entry').click()
  await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
  await expect(page.getByRole('button', { name: /当前待重生版本/ })).toBeVisible()
  await page.getByRole('button', { name: '生成候选版本' }).click()
  await expect(page.getByText('重生后的续写块正文：保留修订历史的新版。').first()).toBeVisible()
  await page.getByRole('button', { name: '保存为续写块' }).click()
  await expect(page).toHaveURL(/selectionNodeId=continue-node-1/)
  await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('重生后的续写块正文：保留修订历史的新版。')
  await expect(page.getByTestId('workspace-continue-block-view')).toContainText('revision 2')

  await page.getByTestId('workspace-continue-block-future-jump-entry').click()
  await expect(page.getByTestId('future-map-overlay')).toBeVisible()
  await expect(page.getByTestId('future-map-confirm')).toBeDisabled()
  await page.getByTestId('future-map-track-phase-3').click()
  await page.getByTestId('future-map-event-outline_event_100').click()
  await page.getByTestId('future-map-chapter-100').click()
  await page.getByPlaceholder('可选：给这次 Future Jump 一句额外方向，例如“先保留误会，再让救援更晚到来”。').fill('让救援更晚到来')
  await page.getByTestId('future-map-confirm').click()

  expect(futureJumpPayload).toEqual({
    sessionId: 'what-if-session-001',
    targetOutlineNodeId: 'outline_event_100',
    targetOutlineChapterId: 'outline_chapter_100_primary',
    parentTimelineNodeId: 'continue-node-1',
    userDirection: '让救援更晚到来',
  })

  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('future-jump')
  await expect(page.getByTestId('workspace-future-jump-view')).toBeVisible()
  await expect(page.getByTestId('future-jump-bridge')).toContainText('第二版桥接摘要：误会升级，救援晚到一步。')
  await expect(page.getByTestId('future-jump-text')).toContainText('第二版未来正文：她被带走后，误会已经先一步封死所有退路。')

  await page.getByTestId('future-jump-continue').click()
  await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
  await expect(page.getByText('默认不替换正文')).toBeVisible()
  await expect(page.getByTestId('workspace-action-overlay').getByText('第二版未来正文：她被带走后，误会已经先一步封死所有退路。').first()).toBeVisible()
  await page.getByRole('button', { name: '生成候选版本' }).click()
  await expect(page.getByText('未来续写块正文：她被带走后，誓言开始在更远的地方回响。').first()).toBeVisible()
  await page.getByRole('button', { name: '保存为续写块' }).click()

  await expect(page).toHaveURL(/selectionKind=continue_block/)
  await expect(page).toHaveURL(/selectionNodeId=continue-node-3/)
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('continue-block')
  await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('未来续写块正文：她被带走后，誓言开始在更远的地方回响。')

  await page.screenshot({ path: path.join(evidenceDirectory, 'mode-ux-simplification-flow.png'), fullPage: true })
  writeEvidenceFile('task-14-mode-ux-simplification/report.txt', [
    `fixture=${fixturePath}`,
    `finalUrl=${page.url()}`,
    'chapterEntryModes=rewrite,roleplay',
    'obsoletePresetModesAbsent=expand,polish,continue',
    'flow=import>rewrite>save-continue>continue-child>regenerate-parent>future-jump>future-jump-continue-child',
  ].join('\n'))
})

test('continue-block rewrite does not collide with workspace autosave preset saves', async ({ page }) => {
  const fixturePath = process.cwd() + '/scripts/fixtures/workspace-import-smoke.txt'
  let imported = false
  let timelineState = buildBaseTimeline()
  let rewriteIndex = 0
  let presetCompatLibrary = createDefaultPresetCompatLibrary()
  let presetSaveInFlight = false

  const rewriteBodies = [
    '已保存的续写块正文：她在门后听见誓言改变了方向。',
    '子续写块正文：誓言之后，她选择独自离开。',
  ]

  await page.route('**/api/workspace', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) })
      return
    }

    await route.fulfill({
      status: 200,
      body: JSON.stringify(imported ? buildWorkspacePayload() : buildEmptyWorkspacePayload()),
      contentType: 'application/json',
    })
  })
  await page.route('**/api/settings/ai', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) })
      return
    }
    await route.fulfill({ status: 200, body: JSON.stringify(buildWorkspacePayload().aiSettings), contentType: 'application/json' })
  })
  await page.route('**/api/settings/preset-compat', async (route) => {
    if (route.request().method() === 'POST') {
      if (presetSaveInFlight) {
        await route.fulfill({ status: 409, body: JSON.stringify({ ok: false, error: 'revision_mismatch' }), contentType: 'application/json' })
        return
      }

      presetSaveInFlight = true
      const body = route.request().postDataJSON() as { library: typeof presetCompatLibrary }
      await page.waitForTimeout(1100)
      presetCompatLibrary = {
        ...body.library,
        revision: body.library.revision + 1,
      }
      presetSaveInFlight = false
      await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, library: presetCompatLibrary }), contentType: 'application/json' })
      return
    }

    await route.fulfill({ status: 200, body: JSON.stringify(presetCompatLibrary), contentType: 'application/json' })
  })
  await page.route('**/api/import-txt', async (route) => {
    imported = true
    timelineState = buildBaseTimeline()
    await route.fulfill({
      status: 200,
      body: JSON.stringify({ novelId: 'novel-001', chapterId: 'chapter-10', chapterCount: 2 }),
      contentType: 'application/json',
    })
  })
  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify(timelineState), contentType: 'application/json' })
  })
  await page.route('**/api/knowledge-view*', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify(buildKnowledgeViewPayload()), contentType: 'application/json' })
  })
  await page.route('**/api/rag/build-generation-context', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify(buildGenerationContextPayload()), contentType: 'application/json' })
  })
  await page.route('**/api/rewrite', async (route) => {
    const body = rewriteBodies[Math.min(rewriteIndex, rewriteBodies.length - 1)]
    rewriteIndex += 1
    await route.fulfill({ status: 200, body, contentType: 'text/plain' })
  })
  await page.route('**/api/continue-blocks', async (route) => {
    const payload = route.request().postDataJSON() as { parentTimelineNodeId?: string | null }

    if (payload.parentTimelineNodeId === 'continue-node-1') {
      timelineState = buildAfterContinueTimeline()
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          continueBlockId: 'continue-block-2',
          timelineNodeId: 'continue-node-2',
          generatedText: '子续写块正文：誓言之后，她选择独自离开。',
          title: 'CONT-02 子续写块',
          subtitle: '沿着当前续写块继续推进',
          latestRevisionNo: 1,
        }),
        contentType: 'application/json',
      })
      return
    }

    timelineState = buildAfterSaveTimeline()
    await route.fulfill({
      status: 200,
      body: JSON.stringify({
        continueBlockId: 'continue-block-1',
        timelineNodeId: 'continue-node-1',
        generatedText: '已保存的续写块正文：她在门后听见誓言改变了方向。',
        title: 'CONT-01 续写块',
        subtitle: '沿着分支继续推进',
        latestRevisionNo: 1,
      }),
      contentType: 'application/json',
    })
  })

  await page.goto('/library', { waitUntil: 'networkidle' })
  await page.locator('input[type=file]').setInputFiles(fixturePath)
  await expect(page).toHaveURL(/\/workspace(?:\?|$)/)

  await selectWholeEditorParagraph(page)
  await page.getByTestId('workspace-chapter-rewrite-entry').click()
  await page.getByRole('button', { name: '生成候选版本' }).click()
  await expect(page.getByText('已保存的续写块正文：她在门后听见誓言改变了方向。').first()).toBeVisible()
  await page.getByRole('button', { name: '保存为续写块' }).click()

  await expect(page.getByTestId('workspace-continue-block-continue-entry')).toBeEnabled()
  await page.getByTestId('workspace-continue-block-continue-entry').click()
  await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
  await expect(page.getByRole('button', { name: /当前续写块版本/ })).toBeVisible()
  await page.getByRole('button', { name: '生成候选版本' }).click()
  await expect(page.getByText('子续写块正文：誓言之后，她选择独自离开。').first()).toBeVisible()
  await expect(page.getByRole('button', { name: '保存为续写块' })).toBeEnabled()
  await page.getByRole('button', { name: '保存为续写块' }).click()
  await expect(page).toHaveURL(/selectionNodeId=continue-node-2/)
  await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('子续写块正文：誓言之后，她选择独自离开。')
  await expect(page.getByText('revision_mismatch')).toHaveCount(0)
})
