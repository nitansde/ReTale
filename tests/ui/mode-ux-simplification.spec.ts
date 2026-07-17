import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import { ensureEvidenceDir, writeEvidenceFile } from '@/tests/helpers/evidence'
import { storyBranchFixtureIds } from '@/tests/helpers/fixture-ids'
import type { StoryTimelineResponse } from '@/lib/story-branch-types'

const fixturePath = path.join(process.cwd(), 'scripts/fixtures/workspace-import-smoke.txt')
const evidenceDirectory = ensureEvidenceDir('task-15-branch-ux-playwright-mode-ux-simplification')
const readerTypographyEvidenceDirectory = ensureEvidenceDir('task-9-reader-typography')
const rewritePromptPlaceholder = '例如：保留剧情走向，但把这段写得更压迫、更像命运在逼近。'

function buildRecoverableRewriteJob(params: {
  jobId: string
  content?: string | null
  chapterId?: string
  selectedText?: string
  sourceText?: string
  userInstruction?: string
  status?: string
  progress?: number
  currentStep?: string | null
}) {
  const timestamp = '2026-05-18T01:23:45.000Z'
  return {
    jobId: params.jobId,
    status: params.status ?? (params.content == null ? 'queued' : 'succeeded'),
    progress: params.progress ?? (params.content == null ? 0.1 : 1),
    currentStep: params.currentStep ?? (params.content == null ? '已创建可恢复魔改任务' : '已完成魔改任务'),
    errorMessage: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    panel: {
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      chapterId: params.chapterId ?? 'chapter-10',
      selectedText: params.selectedText ?? '',
      sourceText: params.sourceText ?? '',
      sourceTextOverride: null,
      userInstruction: params.userInstruction ?? '',
      rewriteLaunchSource: null,
      createdAt: timestamp,
    },
    result: params.content == null
      ? null
      : {
          provider: 'openai-compatible',
          title: '生成版本',
          summary: '基于当前章节知识状态与证据装配生成。',
          content: params.content,
          inputTokens: 42,
          outputTokens: 84,
          metadata: {},
          presetCompat: null,
        },
  }
}

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
    sourceContext: {
      nodeId: 'continue-node-1',
      nodeType: 'continue_block',
      chapterId: 'chapter-10',
      chapterNo: 10,
      whatIfSessionId: 'what-if-session-001',
    },
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

function buildRewriteRootNode(overrides?: Partial<StoryTimelineResponse['branchNodes'][number]>) {
  return {
    type: 'branch_node' as const,
    id: 'rewrite-node-1',
    nodeType: 'rewrite' as const,
    anchorChapterNo: 10,
    parentNodeId: null,
    title: 'RE-01 改写节点',
    subtitle: '首个保存的改写结果',
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
    branchNodes: [buildRewriteRootNode()],
    edges: [],
  }
}

function buildAfterContinueTimeline(): StoryTimelineResponse {
  return {
    ...buildAfterSaveTimeline(),
    branchNodes: [
      buildRewriteRootNode(),
      {
        type: 'branch_node' as const,
        id: 'continue-node-2',
        nodeType: 'continue_block' as const,
        anchorChapterNo: 10,
        parentNodeId: 'rewrite-node-1',
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
      { fromNodeId: 'rewrite-node-1', toNodeId: 'continue-node-2' },
    ],
  }
}

function buildAfterRegenerateTimeline(): StoryTimelineResponse {
  const afterContinue = buildAfterContinueTimeline()
  return {
    ...afterContinue,
    branchNodes: afterContinue.branchNodes.map((node) => node.id === 'rewrite-node-1'
      ? buildRewriteRootNode({
          title: 'RE-01 重生版',
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
          parentNodeId: 'rewrite-node-1',
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
      { fromNodeId: 'rewrite-node-1', toNodeId: storyBranchFixtureIds.futureJumpNodeId },
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

async function readTypography(locator: Locator) {
  return locator.evaluate((element) => {
    const paragraph = element.querySelector('p')
    if (!paragraph) {
      throw new Error('Failed to resolve prose paragraph for typography snapshot')
    }

    const rootStyle = window.getComputedStyle(element)
    const paragraphStyle = window.getComputedStyle(paragraph)

    return {
      fontFamily: rootStyle.fontFamily,
      fontSize: rootStyle.fontSize,
      lineHeight: rootStyle.lineHeight,
      paragraphMarginBottom: paragraphStyle.marginBottom,
    }
  })
}

function expectTypographyToMatch(actual: Awaited<ReturnType<typeof readTypography>>, expected: Awaited<ReturnType<typeof readTypography>>) {
  expect(actual).toEqual(expected)
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
  const rewriteJobs = new Map<string, string>()
  await page.route('**/api/rewrite*', async (route) => {
    if (route.request().method() === 'GET') {
      const url = new URL(route.request().url())
      const jobId = url.searchParams.get('jobId')
      if (!jobId) {
        await route.fulfill({ json: { ok: true, job: null } })
        return
      }

      await route.fulfill({
        json: {
          ok: true,
          job: buildRecoverableRewriteJob({
            jobId: jobId ?? 'rewrite-job-missing',
            content: rewriteJobs.get(jobId ?? '') ?? rewriteBodies.at(-1) ?? '',
          }),
        },
      })
      return
    }

    const body = rewriteBodies[Math.min(rewriteIndex, rewriteBodies.length - 1)]
    rewriteIndex += 1
    const jobId = `rewrite-job-mode-ux-${rewriteIndex}`
    rewriteJobs.set(jobId, body)
    await route.fulfill({
      json: {
        ok: true,
        job: buildRecoverableRewriteJob({ jobId }),
      },
    })
  })
  await page.route('**/api/continue-blocks', async (route) => {
    const payload = route.request().postDataJSON() as { parentTimelineNodeId?: string | null }

    if (route.request().method() === 'PUT') {
      timelineState = buildAfterRegenerateTimeline()
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          continueBlockId: 'continue-block-1',
          timelineNodeId: 'rewrite-node-1',
          nodeType: 'rewrite',
          generatedText: '重生后的续写块正文：保留修订历史的新版。',
          title: 'RE-01 重生版',
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
          nodeType: 'continue_block',
          generatedText: '未来续写块正文：她被带走后，誓言开始在更远的地方回响。',
          title: 'CONT-03 未来续写块',
          subtitle: '沿着未来跳转继续推进',
          latestRevisionNo: 1,
        }),
        contentType: 'application/json',
      })
      return
    }

    if (payload.parentTimelineNodeId === 'rewrite-node-1') {
      timelineState = buildAfterContinueTimeline()
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          continueBlockId: 'continue-block-2',
          timelineNodeId: 'continue-node-2',
          nodeType: 'continue_block',
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
        timelineNodeId: 'rewrite-node-1',
        nodeType: 'rewrite',
        generatedText: '已保存的续写块正文：她在门后听见誓言改变了方向。',
        title: 'RE-01 改写节点',
        subtitle: '首个保存的改写结果',
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

  await page.getByRole('button', { name: '生成版本' }).click()
  await expect(page.getByText('已保存的续写块正文：她在门后听见誓言改变了方向。').first()).toBeVisible()
  await page.getByRole('button', { name: '保存为续写块' }).click()

  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('rewrite')
  await expect(page.getByTestId('workspace-continue-block-view')).toBeVisible()
  await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('已保存的续写块正文：她在门后听见誓言改变了方向。')
  await expect(page.getByTestId('workspace-current-word-count')).not.toContainText('1,200 字')
  await expect(page.getByTestId('workspace-current-input-tokens')).toContainText('输入 — tokens')
  await expect(page.getByTestId('workspace-current-output-tokens')).toContainText('输出 — tokens')
  await expect(page).toHaveURL(/selectionKind=rewrite/)
  await expect(page).toHaveURL(/selectionNodeId=rewrite-node-1/)
  await expect(page.getByTestId('workspace-continue-block-continue-entry')).toBeEnabled()
  await expect(page.getByTestId('workspace-continue-block-regenerate-entry')).toBeEnabled()
  await expect(page.getByTestId('workspace-continue-block-future-jump-entry')).toBeEnabled()
  await page.getByTestId('workspace-continue-block-future-jump-entry').click()
  await expect(page.getByTestId('future-map-overlay')).toBeVisible()
  await expect(page.getByTestId('future-map-overlay')).not.toContainText('novel-001:main')
  await expect(page.getByTestId('future-map-mode-history-node')).toBeVisible()
  await expect(page.getByTestId('future-map-mode-direct-chapter')).toBeVisible()
  await page.getByTestId('future-map-close').evaluate((node) => {
    ;(node as HTMLButtonElement).click()
  })
  await expect(page.getByTestId('future-map-overlay')).toBeHidden()

  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('rewrite')
  await expect(page).toHaveURL(/selectionKind=rewrite/)
  await expect(page).toHaveURL(/selectionNodeId=rewrite-node-1/)
  await expect(page.getByTestId('workspace-center-pane-kind')).toContainText('改写节点工作区')

  await page.getByTestId('workspace-continue-block-regenerate-entry').click()
  await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
  await expect(page.getByPlaceholder(rewritePromptPlaceholder)).toHaveValue('前一版要求：把誓言后的情绪变化压进同一场景。\n\n当前续写块：RE-01 改写节点\n\n重新生成当前续写块，并保留它的修订历史。')
  await expect(page.getByTestId('workspace-context-panel-toggle')).toHaveAttribute('aria-expanded', 'false')
  await page.getByTestId('workspace-context-panel-toggle').click()
  await expect(page.getByTestId('workspace-context-panel')).toBeVisible()
  await expect(page.getByTestId('workspace-context-panel')).not.toContainText('输出要求')
  await expect(page.getByText(/^from\b/i)).toHaveCount(0)
  await page.getByTestId('workspace-action-overlay').click({ position: { x: 8, y: 8 } })
  await expect(page.getByTestId('workspace-action-overlay')).toBeHidden()

  await page.getByTestId('workspace-continue-block-continue-entry').click()
  await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
  await expect(page.getByTestId('workspace-action-overlay').getByText('当前续写块版本').first()).toBeVisible()
  await expect(page.getByPlaceholder(rewritePromptPlaceholder)).toHaveValue('把誓言后的情绪变化压进同一场景。')
  await expect(page.getByTestId('workspace-context-panel-toggle')).toHaveAttribute('aria-expanded', 'false')
  await page.getByTestId('workspace-context-panel-toggle').click()
  await expect(page.getByTestId('workspace-context-panel')).toBeVisible()
  await expect(page.getByTestId('workspace-context-panel')).not.toContainText('输出要求')
  await expect(page.getByText(/^from\b/i)).toHaveCount(0)
  await page.getByTestId('workspace-context-panel-toggle').click()
  await expect(page.getByTestId('workspace-context-panel')).toHaveCount(0)
  await page.getByRole('button', { name: '生成版本' }).click()
  await expect(page.getByText('子续写块正文：誓言之后，她选择独自离开。').first()).toBeVisible()
  await page.getByRole('button', { name: '保存为续写块' }).click()
  await expect(page).toHaveURL(/selectionNodeId=continue-node-2/)
  await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('子续写块正文：誓言之后，她选择独自离开。')
  await expect(page.getByTestId('workspace-current-word-count')).not.toContainText('1,200 字')
  await expect(page.getByTestId('workspace-current-input-tokens')).toContainText('输入 — tokens')
  await expect(page.getByTestId('workspace-current-output-tokens')).toContainText('输出 — tokens')
  await expect(page.getByTestId('workspace-continue-block-future-jump-entry')).toBeEnabled()
  await page.getByTestId('workspace-continue-block-future-jump-entry').click()
  await expect(page.getByTestId('future-map-overlay')).toBeVisible()
  await expect(page.getByTestId('future-map-overlay')).not.toContainText('novel-001:main')
  await expect(page.getByTestId('future-map-mode-history-node')).toBeVisible()
  await page.getByTestId('future-map-close').evaluate((node) => {
    ;(node as HTMLButtonElement).click()
  })
  await expect(page.getByTestId('future-map-overlay')).toBeHidden()

  await page.getByTestId('timeline-node-rewrite-node-1').click()
  await expect(page).toHaveURL(/selectionNodeId=rewrite-node-1/)
  await expect(page).toHaveURL(/selectionKind=rewrite/)
  await page.getByTestId('workspace-continue-block-regenerate-entry').click()
  await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
  await expect(page.getByTestId('workspace-action-overlay').getByText('当前待重生版本').first()).toBeVisible()
  await page.getByRole('button', { name: '生成版本' }).click()
  await expect(page.getByText('重生后的续写块正文：保留修订历史的新版。').first()).toBeVisible()
  await page.getByRole('button', { name: '保存为续写块' }).click()
  await expect(page).toHaveURL(/selectionNodeId=rewrite-node-1/)
  await expect(page).toHaveURL(/selectionKind=rewrite/)
  await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('重生后的续写块正文：保留修订历史的新版。')
  await expect(page.getByTestId('workspace-continue-block-view')).toContainText(/revision 2|版本 2/i)

  await page.screenshot({ path: path.join(evidenceDirectory, 'mode-ux-simplification-flow.png'), fullPage: true })
  writeEvidenceFile('task-14-mode-ux-simplification/report.txt', [
    `fixture=${fixturePath}`,
    `finalUrl=${page.url()}`,
    'chapterEntryModes=rewrite,roleplay',
    'obsoletePresetModesAbsent=expand,polish,continue',
    'flow=import>rewrite>save-rewrite>reload>continue-child>regenerate-root',
  ].join('\n'))
})

test('continue-block rewrite does not collide with workspace autosave preset saves', async ({ page }) => {
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
  const rewriteJobs = new Map<string, string>()
  await page.route('**/api/rewrite*', async (route) => {
    if (route.request().method() === 'GET') {
      const url = new URL(route.request().url())
      const jobId = url.searchParams.get('jobId')
      if (!jobId) {
        await route.fulfill({ json: { ok: true, job: null } })
        return
      }

      await route.fulfill({
        json: {
          ok: true,
          job: buildRecoverableRewriteJob({
            jobId: jobId ?? 'rewrite-job-missing',
            content: rewriteJobs.get(jobId ?? '') ?? rewriteBodies.at(-1) ?? '',
          }),
        },
      })
      return
    }

    const body = rewriteBodies[Math.min(rewriteIndex, rewriteBodies.length - 1)]
    rewriteIndex += 1
    const jobId = `rewrite-job-autosave-${rewriteIndex}`
    rewriteJobs.set(jobId, body)
    await route.fulfill({
      json: {
        ok: true,
        job: buildRecoverableRewriteJob({ jobId }),
      },
    })
  })
  await page.route('**/api/continue-blocks', async (route) => {
    const payload = route.request().postDataJSON() as { parentTimelineNodeId?: string | null }

    if (payload.parentTimelineNodeId === 'rewrite-node-1') {
      timelineState = buildAfterContinueTimeline()
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          continueBlockId: 'continue-block-2',
          timelineNodeId: 'continue-node-2',
          nodeType: 'continue_block',
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
        timelineNodeId: 'rewrite-node-1',
        nodeType: 'rewrite',
        generatedText: '已保存的续写块正文：她在门后听见誓言改变了方向。',
        title: 'RE-01 改写节点',
        subtitle: '首个保存的改写结果',
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
  await page.getByRole('button', { name: '生成版本' }).click()
  await expect(page.getByText('已保存的续写块正文：她在门后听见誓言改变了方向。').first()).toBeVisible()
  await page.getByRole('button', { name: '保存为续写块' }).click()

  await expect(page).toHaveURL(/selectionKind=rewrite/)
  await expect(page).toHaveURL(/selectionNodeId=rewrite-node-1/)
  await expect(page.getByTestId('workspace-continue-block-continue-entry')).toBeEnabled()
  await page.getByTestId('workspace-continue-block-continue-entry').click()
  await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
  await expect(page.getByTestId('workspace-action-overlay').getByText('当前续写块版本').first()).toBeVisible()
  await page.getByRole('button', { name: '生成版本' }).click()
  await expect(page.getByText('子续写块正文：誓言之后，她选择独自离开。').first()).toBeVisible()
  await expect(page.getByRole('button', { name: '保存为续写块' })).toBeEnabled()
  await page.getByRole('button', { name: '保存为续写块' }).click()
  await expect(page).toHaveURL(/selectionNodeId=continue-node-2/)
  await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('子续写块正文：誓言之后，她选择独自离开。')
  await expect(page.getByText('revision_mismatch')).toHaveCount(0)
})

test('focused rewrite and continue nodes launch future jump with history/direct chooser payloads', async ({ page }) => {
  let timelineState = buildAfterContinueTimeline()
  const createPayloads: Array<Record<string, unknown>> = []

  await page.route('**/api/workspace', async (route) => {
    await route.fulfill({ json: buildWorkspacePayload() })
  })
  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({ json: timelineState })
  })
  await page.route('**/api/knowledge-view*', async (route) => {
    await route.fulfill({ json: buildKnowledgeViewPayload() })
  })
  await page.route('**/api/story-future-map*', async (route) => {
    await route.fulfill({ json: buildFutureMapPayload() })
  })
  await page.route('**/api/future-jump/runs', async (route) => {
    createPayloads.push(route.request().postDataJSON())
    timelineState = buildAfterFutureJumpTimeline()
    await route.fulfill({
      json: {
        runId: 'jump-run-001',
        timelineNodeId: storyBranchFixtureIds.futureJumpNodeId,
        bridgeSummary: '第二版桥接摘要：误会升级，救援晚到一步。',
        generatedTargetText: '第二版未来正文：她被带走后，误会已经先一步封死所有退路。',
      },
    })
  })
  await page.route('**/api/future-jump/runs/jump-run-001?*', async (route) => {
    await route.fulfill({ json: buildFutureJumpRunDetail() })
  })

  await page.goto('/workspace?selectionKind=rewrite&selectionNodeId=rewrite-node-1&selectionContinueBlockId=continue-block-1&selectionAnchorChapterNo=10', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('workspace-continue-block-future-jump-entry')).toBeEnabled()
  await page.getByTestId('workspace-continue-block-future-jump-entry').click()
  await expect(page.getByTestId('future-map-overlay')).toBeVisible()
  await expect(page.getByTestId('future-map-mode-history-node')).toBeVisible()
  await expect(page.getByTestId('future-map-mode-direct-chapter')).toBeVisible()
  await page.getByTestId('future-map-event-outline_event_100').click()
  await expect(page.getByTestId('future-map-resolved-chapter')).toContainText('第 100 章')
  await expect(page.getByTestId('future-map-confirm')).toBeEnabled()
  await page.getByTestId('future-map-confirm').click()
  await expect(page.getByTestId('workspace-future-jump-view')).toBeVisible()

  expect(createPayloads[0]).toEqual({
    novelId: 'novel-001',
    sourceContext: {
      nodeId: 'rewrite-node-1',
      nodeType: 'rewrite',
      chapterId: 'chapter-10',
      chapterNo: 10,
      whatIfSessionId: null,
    },
    targetOutlineNodeId: 'outline_event_100',
    targetOutlineChapterId: 'outline_chapter_100_primary',
    parentTimelineNodeId: 'rewrite-node-1',
  })

  await page.goto('/workspace?selectionKind=continue_block&selectionNodeId=continue-node-2&selectionContinueBlockId=continue-block-2&selectionAnchorChapterNo=10', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('continue-block')
  await expect(page.getByTestId('workspace-continue-block-future-jump-entry')).toBeEnabled()
  await page.getByTestId('workspace-continue-block-future-jump-entry').click()
  await expect(page.getByTestId('future-map-overlay')).toBeVisible()
  await page.getByTestId('future-map-mode-direct-chapter').click()
  await expect(page.getByTestId('future-map-confirm')).toBeDisabled()
  await page.getByTestId('future-map-track-phase-4').click()
  await page.getByTestId('future-map-direct-chapter-120').click()
  await expect(page.getByTestId('future-map-resolved-chapter')).toContainText('第 120 章')
  await expect(page.getByTestId('future-map-confirm')).toBeEnabled()
  await page.getByTestId('future-map-confirm').click()

  expect(createPayloads[1]).toEqual({
    novelId: 'novel-001',
    sourceContext: {
      nodeId: 'continue-node-2',
      nodeType: 'continue_block',
      chapterId: 'chapter-10',
      chapterNo: 10,
      whatIfSessionId: null,
    },
    targetOutlineNodeId: 'outline_event_120',
    targetOutlineChapterId: 'outline_chapter_120_primary',
    parentTimelineNodeId: 'continue-node-2',
  })
})

test('chapter prose typography matches rewrite, what-if, and future-jump readers', async ({ page }) => {
  const futureJumpNode = buildAfterFutureJumpTimeline().branchNodes.find((node) => node.id === storyBranchFixtureIds.futureJumpNodeId)
  if (!futureJumpNode) {
    throw new Error('Failed to seed future-jump node for typography parity test')
  }

  const timelineState: StoryTimelineResponse = {
    ...buildBaseTimeline(),
    branchNodes: [buildRewriteRootNode(), buildWhatIfAncestorNode(), futureJumpNode],
    edges: [{ fromNodeId: 'rewrite-node-1', toNodeId: storyBranchFixtureIds.futureJumpNodeId }],
  }

  await page.route('**/api/workspace', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) })
      return
    }

    await route.fulfill({ status: 200, body: JSON.stringify(buildWorkspacePayload()), contentType: 'application/json' })
  })
  await page.route('**/api/settings/ai', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) })
      return
    }

    await route.fulfill({ status: 200, body: JSON.stringify(buildWorkspacePayload().aiSettings), contentType: 'application/json' })
  })
  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify(timelineState), contentType: 'application/json' })
  })
  await page.route('**/api/knowledge-view*', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify(buildKnowledgeViewPayload()), contentType: 'application/json' })
  })
  await page.route('**/api/what-if/sessions/what-if-session-001?*', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify(buildWhatIfSessionDetail()), contentType: 'application/json' })
  })
  await page.route('**/api/future-jump/runs/jump-run-001?*', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify(buildFutureJumpRunDetail()), contentType: 'application/json' })
  })
  await page.route('**/api/story-future-map?*', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify(buildFutureMapPayload()), contentType: 'application/json' })
  })

  await page.goto('/workspace', { waitUntil: 'networkidle' })
  const chapterProse = page.locator('.ProseMirror')
  await expect(chapterProse).toBeVisible()
  const chapterTypography = await readTypography(chapterProse)

  await page.goto('/workspace?selectionKind=rewrite&selectionNodeId=rewrite-node-1&selectionContinueBlockId=continue-block-1&selectionAnchorChapterNo=10', { waitUntil: 'networkidle' })
  const rewriteReader = page.getByTestId('workspace-continue-block-reader-body')
  await expect(rewriteReader).toBeVisible()
  const rewriteTypography = await readTypography(rewriteReader)
  expectTypographyToMatch(rewriteTypography, chapterTypography)

  await page.goto(`/workspace?selectionKind=what_if&selectionNodeId=${storyBranchFixtureIds.whatIfNodeId}&selectionSessionId=what-if-session-001&selectionAnchorChapterNo=10`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('workspace-what-if-view')).toBeVisible()
  await expect(page.getByTestId('what-if-view')).toBeVisible()
  await expect(page.getByText('魔改后的 What-if 正文')).toBeVisible()
  const whatIfReaders = page.getByTestId('workspace-what-if-view').locator('.reader-body-prose')
  await expect(whatIfReaders).toHaveCount(2)
  const whatIfOriginalTypography = await readTypography(whatIfReaders.first())
  const whatIfGeneratedTypography = await readTypography(whatIfReaders.nth(1))
  expectTypographyToMatch(whatIfOriginalTypography, chapterTypography)
  expectTypographyToMatch(whatIfGeneratedTypography, chapterTypography)

  await page.goto(`/workspace?selectionKind=future_jump&selectionNodeId=${storyBranchFixtureIds.futureJumpNodeId}&selectionRunId=jump-run-001&selectionSourceChapterNo=10&selectionTargetChapterNo=100`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('workspace-future-jump-view')).toBeVisible()
  await expect(page.getByTestId('future-jump-view')).toBeVisible()
  await expect(page.getByText('第二版未来正文：她被带走后，误会已经先一步封死所有退路。')).toBeVisible()
  const futureJumpReader = page.getByTestId('future-jump-text').locator('.reader-body-prose')
  const futureJumpTypography = await readTypography(futureJumpReader)
  expectTypographyToMatch(futureJumpTypography, chapterTypography)

  writeEvidenceFile('task-9-reader-typography/typography-parity.json', JSON.stringify({
    chapterTypography,
    rewriteTypography,
    whatIfOriginalTypography,
    whatIfGeneratedTypography,
    futureJumpTypography,
    evidenceDirectory: readerTypographyEvidenceDirectory,
  }, null, 2))
  await page.screenshot({ path: path.join(readerTypographyEvidenceDirectory, 'typography-parity.png'), fullPage: true })
})
