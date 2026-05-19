import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { formatStoryBranchInstructionPreview } from '@/lib/story-branch-labels'
import { DEFAULT_REWRITE_PROMPT } from '@/components/workspace/selection-novel-studio'
import { storyBranchFixtureIds } from '@/tests/helpers/fixture-ids'
import type { StoryTimelineResponse } from '@/lib/story-branch-types'

const evidenceDirectory = path.join(process.cwd(), '.sisyphus/evidence/task-15-branch-ux-playwright-future-map')
const futureJumpEvidenceDirectory = path.join(process.cwd(), '.sisyphus/evidence/task-15-branch-ux-playwright-future-jump-view')
const rewritePromptPlaceholder = '例如：保留剧情走向，但把这段写得更压迫、更像命运在逼近。'

function buildWhatIfSessionDetail() {
  return {
    id: 'what-if-session-001',
    novelId: 'novel-001',
    baseBranchId: 'novel-001:main',
    sourceChapterNo: 10,
    title: 'IF-01 决裂线',
    premise: '如果他们在这里闹翻',
    selectedText: '“你根本没信过我。”',
    originalText: '原始章节正文',
    generatedText: '魔改后的 What-if 正文',
    inputTokens: 321,
    outputTokens: 654,
    status: 'active',
    createdAt: '2026-05-15T01:23:45.000Z',
    updatedAt: '2026-05-15T01:23:45.000Z',
    deltas: [
      {
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
        createdAt: '2026-05-15T01:23:45.000Z',
      },
    ],
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
      outline_event_100: [
        {
          id: 'outline_chapter_100_primary',
          outlineNodeId: 'outline_event_100',
          chapterNo: 100,
          chapterId: 'chapter-100',
          chapterTitle: '第100章 被绑走',
          isPrimary: true,
          sortOrder: 0,
          createdAt: '2026-05-15T01:23:45.000Z',
          updatedAt: '2026-05-15T01:23:45.000Z',
        },
      ],
      outline_event_120: [
        {
          id: 'outline_chapter_120_primary',
          outlineNodeId: 'outline_event_120',
          chapterNo: 120,
          chapterId: 'chapter-120',
          chapterTitle: '第120章 断桥重逢',
          isPrimary: true,
          sortOrder: 0,
          createdAt: '2026-05-15T01:23:45.000Z',
          updatedAt: '2026-05-15T01:23:45.000Z',
        },
      ],
    },
    defaults: {
      selectedTrackKey: 'phase-3',
      selectedOutlineNodeId: 'outline_event_100',
    },
  }
}

function buildWorkspacePayload() {
  return {
    currentNovelId: 'novel-001',
    currentChapterId: 'chapter-10',
    localNovels: [{ id: 'novel-001', title: 'Fixture Novel', summary: 'Timeline fixture novel', tags: ['fixture'] }],
    localVolumes: [{ id: 'volume-001', novelId: 'novel-001', title: '第一卷', order: 1 }],
    localChapters: [
      {
        id: 'chapter-10',
        novelId: 'novel-001',
        volumeId: 'volume-001',
        title: '第10章 结盟',
        order: 10,
        content: '<p>第10章正文</p>',
        status: 'draft',
        wordCount: 1200,
        updatedAt: '2026-05-15',
      },
      {
        id: 'chapter-100',
        novelId: 'novel-001',
        volumeId: 'volume-001',
        title: '第100章 被绑走',
        order: 100,
        content: '<p>第100章正文</p>',
        status: 'draft',
        wordCount: 1900,
        updatedAt: '2026-05-15',
      },
      {
        id: 'branch-chapter-10-b1',
        novelId: 'novel-001',
        volumeId: 'volume-001',
        title: '第10章 结盟 · 分支 1',
        order: 10.1,
        content: '<p>分支正文</p>',
        status: 'draft',
        wordCount: 320,
        updatedAt: '2026-05-15',
        kind: 'branch',
        parentChapterId: 'chapter-10',
        branchLabel: 'B1',
      },
    ],
  }
}

function buildFutureJumpRunDetail(latestRevisionNo = 2) {
  const bridgeSummary = latestRevisionNo >= 3 ? '第三版桥接摘要：误会被拉长，救援明显延后。' : '第二版桥接摘要：误会升级，救援晚到一步。'
  const generatedTargetText = latestRevisionNo >= 3 ? '第三版未来正文：她被带走后，所有误会都在更慢地发酵。' : '第二版未来正文：她被带走后，误会已经先一步封死所有退路。'

  return {
    id: 'jump-run-001',
    sessionId: 'what-if-session-001',
    baseBranchId: 'novel-001:main',
    parentTimelineNodeId: storyBranchFixtureIds.whatIfNodeId,
    sourceContext: {
      nodeId: storyBranchFixtureIds.whatIfNodeId,
      nodeType: 'what_if',
      chapterId: 'chapter-10',
      chapterNo: 10,
      whatIfSessionId: 'what-if-session-001',
    },
    targetOutlineNodeId: storyBranchFixtureIds.outlineEventId,
    targetOutlineChapterId: storyBranchFixtureIds.outlineChapterAnchorId,
    sourceChapterNo: 10,
    targetChapterNo: 100,
    userDirection: '让救援更晚到来',
    bridgeSummary,
    generatedTargetText,
    inputTokens: latestRevisionNo >= 3 ? 777 : 555,
    outputTokens: latestRevisionNo >= 3 ? 888 : 666,
    latestRevisionNo,
    errorMessage: null,
    status: latestRevisionNo >= 3 ? 'revised' : 'generated',
    createdAt: '2026-05-15T01:23:45.000Z',
    updatedAt: '2026-05-15T01:23:45.000Z',
    timelineNodeId: storyBranchFixtureIds.futureJumpNodeId,
    latestRevision: {
      id: `future-jump-revision-${latestRevisionNo}`,
      runId: 'jump-run-001',
      revisionNo: latestRevisionNo,
      revisionKind: latestRevisionNo >= 3 ? 'feedback' : 'feedback',
      userFeedback: latestRevisionNo >= 3 ? '把救援再推迟一章' : '让误会先彻底锁死',
      bridgeSummary,
      generatedTargetText,
      createdAt: '2026-05-15T01:23:45.000Z',
    },
    revisionHistory: [
      {
        revisionNo: 1,
        revisionKind: 'initial',
        userFeedback: null,
        createdAt: '2026-05-15T01:21:45.000Z',
      },
      {
        revisionNo: 2,
        revisionKind: 'feedback',
        userFeedback: '让误会先彻底锁死',
        createdAt: '2026-05-15T01:22:45.000Z',
      },
      ...(latestRevisionNo >= 3
        ? [{
            revisionNo: 3,
            revisionKind: 'feedback',
            userFeedback: '把救援再推迟一章',
            createdAt: '2026-05-15T01:23:45.000Z',
          }]
        : []),
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
        createdAt: '2026-05-15T01:21:45.000Z',
      },
      {
        id: 'future-jump-revision-2',
        runId: 'jump-run-001',
        revisionNo: 2,
        revisionKind: 'feedback',
        userFeedback: '让误会先彻底锁死',
        bridgeSummary: '第二版桥接摘要：误会升级，救援晚到一步。',
        generatedTargetText: '第二版未来正文：她被带走后，误会已经先一步封死所有退路。',
        createdAt: '2026-05-15T01:22:45.000Z',
      },
      ...(latestRevisionNo >= 3
        ? [{
            id: 'future-jump-revision-3',
            runId: 'jump-run-001',
            revisionNo: 3,
            revisionKind: 'feedback',
            userFeedback: '把救援再推迟一章',
            bridgeSummary: '第三版桥接摘要：误会被拉长，救援明显延后。',
            generatedTargetText: '第三版未来正文：她被带走后，所有误会都在更慢地发酵。',
            createdAt: '2026-05-15T01:23:45.000Z',
          }]
        : []),
    ],
  }
}

function buildGenerationContextPayload() {
  return {
    ok: true,
    novelId: 'novel-001',
    branchId: 'novel-001:main',
    chapterId: 'chapter-100',
    chapterNo: 100,
    chapterTitle: '第100章 被绑走',
    selectedLineStart: 1,
    selectedLineEnd: 5,
    warnings: [],
    promptBlocks: [
      {
        id: 'future-jump-context',
        label: 'Future jump context',
        enabled: true,
        priority: 'high',
        content: 'Latest speculative future branch context',
      },
    ],
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

function buildStoryTimelinePayload(options?: { includeWhatIf?: boolean; includeFutureJump?: boolean }): StoryTimelineResponse {
  const includeWhatIf = options?.includeWhatIf ?? true
  const includeFutureJump = options?.includeFutureJump ?? true

  return {
    novelId: 'novel-001',
    branchId: 'novel-001:main',
    chapters: [
      { type: 'chapter', chapterNo: 10, chapterId: 'chapter-10', title: '第10章 结盟', wordCount: 1200 },
      { type: 'chapter', chapterNo: 100, chapterId: 'chapter-100', title: '第100章 被绑走', wordCount: 1900 },
    ],
    branchNodes: [
      ...(includeWhatIf
        ? [{
          type: 'branch_node' as const,
          id: storyBranchFixtureIds.whatIfNodeId,
          nodeType: 'what_if' as const,
          readableLabel: 'IF-01',
          readableLineageLabel: 'IF-01',
        anchorChapterNo: 10,
        parentNodeId: null,
        title: 'IF-01 决裂线',
        subtitle: '如果他们在这里闹翻',
        laneIndex: 0,
        colorToken: 'rose',
          currentText: '魔改后的 What-if 正文',
          inputTokens: 321,
          outputTokens: 654,
          sourceChapterNo: 10,
          targetChapterNo: null,
          continueBlockId: null,
          whatIfSessionId: 'what-if-session-001',
          futureJumpRunId: null,
          status: 'active',
        }]
        : []),
      ...(includeFutureJump
        ? [{
            type: 'branch_node' as const,
            id: storyBranchFixtureIds.futureJumpNodeId,
            nodeType: 'future_jump' as const,
            readableLabel: 'JUMP-01',
            readableLineageLabel: 'IF-01, JUMP-01',
            anchorChapterNo: 100,
            parentNodeId: storyBranchFixtureIds.whatIfNodeId,
            title: 'JUMP-01 第100章',
            subtitle: '跳到被绑走后的未来',
            laneIndex: 0,
            colorToken: 'violet',
            currentText: '第二版未来正文：她被带走后，误会已经先一步封死所有退路。',
            inputTokens: 555,
            outputTokens: 666,
            sourceChapterNo: 10,
            targetChapterNo: 100,
            continueBlockId: null,
            whatIfSessionId: null,
            futureJumpRunId: 'jump-run-001',
            status: 'generated',
          }]
        : []),
    ],
    edges: includeWhatIf && includeFutureJump
      ? [{ fromNodeId: storyBranchFixtureIds.whatIfNodeId, toNodeId: storyBranchFixtureIds.futureJumpNodeId }]
      : [],
  }
}

function buildContinueBlockTimelinePayload(): StoryTimelineResponse {
  return {
    novelId: 'novel-001',
    branchId: 'novel-001:main',
    chapters: [
      { type: 'chapter', chapterNo: 10, chapterId: 'chapter-10', title: '第10章 结盟', wordCount: 1200 },
    ],
    branchNodes: [
      {
        type: 'branch_node' as const,
        id: 'continue-node-1',
        nodeType: 'continue_block' as const,
        readableLabel: 'CONT-01',
        readableLineageLabel: 'CONT-01',
        anchorChapterNo: 10,
        parentNodeId: null,
        title: 'CONT-01 续写块',
        subtitle: '沿着当前节点继续写',
        laneIndex: 0,
        colorToken: 'fuchsia',
        sourceChapterNo: 10,
        targetChapterNo: null,
        continueBlockId: 'continue-block-1',
        whatIfSessionId: null,
        futureJumpRunId: null,
        latestText: '已保存的续写块正文：她在门后听见誓言改变了方向。',
        currentText: '已保存的续写块正文：她在门后听见誓言改变了方向。',
        inputTokens: 41,
        outputTokens: 59,
        latestRevisionNo: 1,
        userInstruction: '把誓言后的情绪变化压进同一场景。',
        selectedText: '第10章正文',
        originalText: '第10章正文',
        status: 'active',
      },
    ],
    edges: [],
  }
}

type ContinueBlockDetailFixtureInput = {
  continueBlockId: string
  timelineNodeId: string
  parentTimelineNodeId: string | null
  sourceChapterNo: number
  title: string
  subtitle: string
  userInstruction: string
  selectedText: string
  originalText: string
  latestText: string
  inputTokens: number | null
  outputTokens: number | null
  latestRevisionNo: number
  revisionKind?: 'initial' | 'regenerate'
  createdAt?: string
  updatedAt?: string
  revisions?: Array<{
    revisionNo: number
    revisionKind: 'initial' | 'regenerate'
    userInstruction: string
    selectedText: string
    originalText: string
    generatedText: string
    inputTokens: number | null
    outputTokens: number | null
    title: string
    subtitle: string
    createdAt: string
  }>
}

function buildContinueBlockDetail(input: ContinueBlockDetailFixtureInput) {
  const createdAt = input.createdAt ?? '2026-05-15T01:23:45.000Z'
  const updatedAt = input.updatedAt ?? createdAt
  const revisions = input.revisions ?? [
    {
      revisionNo: input.latestRevisionNo,
      revisionKind: input.revisionKind ?? (input.latestRevisionNo > 1 ? 'regenerate' : 'initial'),
      userInstruction: input.userInstruction,
      selectedText: input.selectedText,
      originalText: input.originalText,
      generatedText: input.latestText,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      title: input.title,
      subtitle: input.subtitle,
      createdAt,
    },
  ]
  const latestRevision = revisions.at(-1) ?? null

  return {
    id: input.continueBlockId,
    novelId: 'novel-001',
    branchId: 'novel-001:main',
    parentTimelineNodeId: input.parentTimelineNodeId,
    sourceChapterNo: input.sourceChapterNo,
    title: input.title,
    subtitle: input.subtitle,
    userInstruction: input.userInstruction,
    selectedText: input.selectedText,
    originalText: input.originalText,
    latestText: input.latestText,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    latestRevisionNo: input.latestRevisionNo,
    status: input.latestRevisionNo > 1 ? 'revised' : 'active',
    createdAt,
    updatedAt,
    timelineNodeId: input.timelineNodeId,
    latestRevision: latestRevision
      ? {
          id: `${input.continueBlockId}-revision-${latestRevision.revisionNo}`,
          continueBlockId: input.continueBlockId,
          ...latestRevision,
        }
      : null,
    revisionHistory: revisions.map((revision) => ({
      revisionNo: revision.revisionNo,
      revisionKind: revision.revisionKind,
      createdAt: revision.createdAt,
    })),
    revisions: revisions.map((revision) => ({
      id: `${input.continueBlockId}-revision-${revision.revisionNo}`,
      continueBlockId: input.continueBlockId,
      ...revision,
    })),
  }
}

function buildMixedContinueTreeTimelinePayload(): StoryTimelineResponse {
  return {
    novelId: 'novel-001',
    branchId: 'novel-001:main',
    chapters: [
      { type: 'chapter', chapterNo: 10, chapterId: 'chapter-10', title: '第10章 结盟', wordCount: 1200 },
      { type: 'chapter', chapterNo: 100, chapterId: 'chapter-100', title: '第100章 被绑走', wordCount: 1900 },
    ],
    branchNodes: [
      {
        type: 'branch_node' as const,
        id: storyBranchFixtureIds.whatIfNodeId,
        nodeType: 'what_if' as const,
        readableLabel: 'IF-01',
        readableLineageLabel: 'IF-01',
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
        createdAt: '2026-05-15T01:21:00.000Z',
        status: 'active',
      },
      {
        type: 'branch_node' as const,
        id: 'continue-node-1',
        nodeType: 'continue_block' as const,
        readableLabel: 'CONT-01',
        readableLineageLabel: 'IF-01, CONT-01',
        anchorChapterNo: 10,
        parentNodeId: storyBranchFixtureIds.whatIfNodeId,
        title: 'CONT-01 续写块',
        subtitle: '沿着分支继续推进',
        laneIndex: 1,
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
        createdAt: '2026-05-15T01:22:00.000Z',
        status: 'active',
      },
      {
        type: 'branch_node' as const,
        id: storyBranchFixtureIds.futureJumpNodeId,
        nodeType: 'future_jump' as const,
        readableLabel: 'JUMP-01',
        readableLineageLabel: 'IF-01, CONT-01, JUMP-01',
        anchorChapterNo: 100,
        parentNodeId: 'continue-node-1',
        title: 'JUMP-01 第100章',
        subtitle: '跳到被绑走后的未来',
        laneIndex: 1,
        colorToken: 'violet',
        sourceChapterNo: 10,
        targetChapterNo: 100,
        continueBlockId: null,
        whatIfSessionId: null,
        futureJumpRunId: 'jump-run-001',
        createdAt: '2026-05-15T01:23:00.000Z',
        status: 'generated',
      },
      {
        type: 'branch_node' as const,
        id: 'continue-node-2',
        nodeType: 'continue_block' as const,
        readableLabel: 'CONT-02',
        readableLineageLabel: 'IF-01, CONT-01, JUMP-01, CONT-02',
        anchorChapterNo: 100,
        parentNodeId: storyBranchFixtureIds.futureJumpNodeId,
        title: 'CONT-02 未来续写块',
        subtitle: '沿着未来跳转继续推进',
        laneIndex: 1,
        colorToken: 'fuchsia',
        sourceChapterNo: 100,
        targetChapterNo: null,
        continueBlockId: 'continue-block-2',
        whatIfSessionId: null,
        futureJumpRunId: null,
        latestText: '未来续写块正文：她被带走后，誓言开始在更远的地方回响。',
        latestRevisionNo: 1,
        userInstruction: '沿着未来跳转后的正文继续推进。',
        selectedText: '第100章正文',
        originalText: '第100章正文',
        createdAt: '2026-05-15T01:24:00.000Z',
        status: 'active',
      },
    ],
    edges: [
      { fromNodeId: storyBranchFixtureIds.whatIfNodeId, toNodeId: 'continue-node-1' },
      { fromNodeId: 'continue-node-1', toNodeId: storyBranchFixtureIds.futureJumpNodeId },
      { fromNodeId: storyBranchFixtureIds.futureJumpNodeId, toNodeId: 'continue-node-2' },
    ],
  }
}

function buildDeleteAffordanceTimelinePayload(): StoryTimelineResponse {
  return {
    novelId: 'novel-001',
    branchId: 'novel-001:main',
    chapters: [
      { type: 'chapter', chapterNo: 10, chapterId: 'chapter-10', title: '第10章 结盟', wordCount: 1200 },
      { type: 'chapter', chapterNo: 100, chapterId: 'chapter-100', title: '第100章 被绑走', wordCount: 1900 },
    ],
    branchNodes: [
      {
        type: 'branch_node' as const,
        id: 'rewrite-node-1',
        nodeType: 'rewrite' as const,
        readableLabel: 'RE-01',
        readableLineageLabel: 'RE-01',
        anchorChapterNo: 10,
        parentNodeId: null,
        title: 'RE-01 第一版改写',
        subtitle: '首个保存的改写节点',
        laneIndex: 0,
        colorToken: 'fuchsia',
        sourceChapterNo: 10,
        targetChapterNo: null,
        continueBlockId: 'rewrite-block-1',
        whatIfSessionId: null,
        futureJumpRunId: null,
        latestText: '改写正文：她在门后听见誓言改变了方向。',
        latestRevisionNo: 1,
        userInstruction: '让誓言转向更冷的情绪。',
        selectedText: '第10章正文',
        originalText: '第10章正文',
        createdAt: '2026-05-15T01:20:00.000Z',
        status: 'active',
      },
      {
        type: 'branch_node' as const,
        id: 'continue-node-1',
        nodeType: 'continue_block' as const,
        readableLabel: 'CONT-01',
        readableLineageLabel: 'RE-01, CONT-01',
        anchorChapterNo: 10,
        parentNodeId: 'rewrite-node-1',
        title: 'CONT-01 续写块',
        subtitle: '沿着改写结果继续推进',
        laneIndex: 1,
        colorToken: 'fuchsia',
        sourceChapterNo: 10,
        targetChapterNo: null,
        continueBlockId: 'continue-block-1',
        whatIfSessionId: null,
        futureJumpRunId: null,
        latestText: '续写正文：她决定把誓言藏进下一次沉默。',
        latestRevisionNo: 1,
        userInstruction: '继续压低场景里的情绪。',
        selectedText: '第10章正文',
        originalText: '改写正文：她在门后听见誓言改变了方向。',
        createdAt: '2026-05-15T01:21:00.000Z',
        status: 'active',
      },
      {
        type: 'branch_node' as const,
        id: storyBranchFixtureIds.whatIfNodeId,
        nodeType: 'what_if' as const,
        readableLabel: 'IF-01',
        readableLineageLabel: 'IF-01',
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
        createdAt: '2026-05-15T01:22:00.000Z',
        status: 'active',
      },
      {
        type: 'branch_node' as const,
        id: storyBranchFixtureIds.futureJumpNodeId,
        nodeType: 'future_jump' as const,
        readableLabel: 'JUMP-01',
        readableLineageLabel: 'IF-01, JUMP-01',
        anchorChapterNo: 100,
        parentNodeId: storyBranchFixtureIds.whatIfNodeId,
        title: 'JUMP-01 第100章',
        subtitle: '跳到被绑走后的未来',
        laneIndex: 0,
        colorToken: 'violet',
        sourceChapterNo: 10,
        targetChapterNo: 100,
        continueBlockId: null,
        whatIfSessionId: null,
        futureJumpRunId: 'jump-run-001',
        createdAt: '2026-05-15T01:23:00.000Z',
        status: 'generated',
      },
    ],
    edges: [
      { fromNodeId: 'rewrite-node-1', toNodeId: 'continue-node-1' },
      { fromNodeId: storyBranchFixtureIds.whatIfNodeId, toNodeId: storyBranchFixtureIds.futureJumpNodeId },
    ],
  }
}

function deleteTimelineNodeFromPayload(timeline: StoryTimelineResponse, nodeId: string): StoryTimelineResponse {
  const targetNode = timeline.branchNodes.find((node) => node.id === nodeId)
  if (!targetNode) return timeline

  const reorderedBranchNodes = timeline.branchNodes
    .filter((node) => node.id !== nodeId)
    .map((node) => (
    node.parentNodeId === nodeId
      ? { ...node, parentNodeId: targetNode.parentNodeId }
      : node
  ))

  return {
    ...timeline,
    branchNodes: reorderedBranchNodes,
    edges: reorderedBranchNodes
      .filter((node) => node.parentNodeId)
      .map((node) => ({ fromNodeId: node.parentNodeId!, toNodeId: node.id })),
  }
}

test('saving a rewrite candidate lands on a persisted continue-block reader and survives reload in read mode', async ({ page }) => {
  let createdContinueBlock = false
  let continueBlockPayload: Record<string, unknown> | null = null
  let continueBlockDetailRequestCount = 0
  const continueBlockDetailState = buildContinueBlockDetail({
    continueBlockId: 'continue-block-1',
    timelineNodeId: 'continue-node-1',
    parentTimelineNodeId: null,
    sourceChapterNo: 10,
    title: 'CONT-01 续写块',
    subtitle: '把誓言后的情绪变化压进同一场景。',
    userInstruction: '把誓言后的情绪变化压进同一场景。',
    selectedText: '第10章正文',
    originalText: '第10章正文',
    latestText: '已保存的续写块正文：她在门后听见誓言改变了方向。',
    inputTokens: 41,
    outputTokens: 59,
    latestRevisionNo: 1,
  })

  await page.route('**/api/workspace', async (route) => {
    await route.fulfill({ json: buildWorkspacePayload() })
  })
  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({
      json: createdContinueBlock ? buildContinueBlockTimelinePayload() : buildStoryTimelinePayload({ includeWhatIf: false, includeFutureJump: false }),
    })
  })
  await page.route('**/api/knowledge-view*', async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        localOutlines: [],
        localCharacters: [],
        localCharacterRelations: [],
        localWorldEntries: [],
        localTimelineEvents: [],
        knowledgeRebuildStatus: null,
        jobOutcome: null,
      },
    })
  })
  await page.route('**/api/rewrite', async (route) => {
    await route.fulfill({ status: 200, body: '保存后的候选正文：她在门后听见誓言改变了方向。' })
  })
  await page.route('**/api/continue-blocks/continue-block-1?*', async (route) => {
    continueBlockDetailRequestCount += 1
    await route.fulfill({ json: continueBlockDetailState })
  })
  await page.route('**/api/continue-blocks', async (route) => {
    continueBlockPayload = route.request().postDataJSON()
    createdContinueBlock = true
    await route.fulfill({
      json: {
        continueBlockId: 'continue-block-1',
        timelineNodeId: 'continue-node-1',
        generatedText: '保存后的候选正文：她在门后听见誓言改变了方向。',
        title: 'CONT-01 续写候选一',
        subtitle: '把誓言后的情绪变化压进同一场景。',
        latestRevisionNo: 1,
      },
    })
  })

  await page.goto('/workspace', { waitUntil: 'networkidle' })
  const chapterCard = page.getByRole('button', { name: 'Chapter 10 第10章 结盟 1200 字' })
  await chapterCard.evaluate((node: HTMLButtonElement) => node.click())
  await expect(page.getByTestId('workspace-current-word-count')).not.toContainText('1,200 字')
  await expect(page.getByTestId('workspace-current-input-tokens')).toContainText('输入 — tokens')
  await expect(page.getByTestId('workspace-current-output-tokens')).toContainText('输出 — tokens')

  await page.locator('[contenteditable="true"]').evaluate((editor) => {
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

  await page.getByTestId('workspace-chapter-rewrite-entry').click()
  await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
  await page.getByRole('button', { name: '生成候选版本' }).click()
  await expect(page.getByText('保存后的候选正文：她在门后听见誓言改变了方向。').nth(1)).toBeVisible()
  await page.getByRole('button', { name: '保存为续写块' }).click()

  expect(continueBlockPayload).toMatchObject({
    novelId: 'novel-001',
    branchId: 'novel-001:main',
    sourceChapterNo: 10,
    generatedText: '保存后的候选正文：她在门后听见誓言改变了方向。',
  })

  await expect(page.getByTestId('workspace-action-overlay')).toBeHidden()
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('continue-block')
  await expect(page.getByTestId('workspace-continue-block-view')).toBeVisible()
  await expect(page.getByTestId('workspace-continue-block-reader-mode')).toContainText('Read mode')
  await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('已保存的续写块正文：她在门后听见誓言改变了方向。')
  expect(continueBlockDetailRequestCount).toBeGreaterThanOrEqual(1)
  await expect(page.getByTestId('workspace-current-input-tokens')).toContainText('输入 41 tokens')
  await expect(page.getByTestId('workspace-current-output-tokens')).toContainText('输出 59 tokens')
  await expect(page.getByTestId('workspace-continue-block-continue-entry')).toBeEnabled()
  await expect(page.getByTestId('workspace-continue-block-regenerate-entry')).toBeEnabled()
  await expect(page.getByTestId('workspace-continue-block-future-jump-entry')).toBeEnabled()
  await expect(page.getByTestId('timeline-node-continue-node-1')).toContainText('CONT-01')
  await expect(page.getByTestId('workspace-center-pane')).toContainText('CONT-01')
  await expect(page.getByTestId('workspace-continue-block-actions')).toContainText(`指令预览 · ${formatStoryBranchInstructionPreview('把誓言后的情绪变化压进同一场景。')}`)
  await expect(page.getByTestId('workspace-continue-block-view')).toContainText(`指令预览 · ${formatStoryBranchInstructionPreview('把誓言后的情绪变化压进同一场景。')}`)
  await expect(page.getByText('continue-block-1')).toHaveCount(0)
  await expect(page.getByText(/anchor 第/i)).toHaveCount(0)
  await expect(page.getByText(/^draft$/i)).toHaveCount(0)

  await page.reload({ waitUntil: 'networkidle' })

  await expect(page).toHaveURL(/selectionKind=continue_block/)
  await expect(page.getByTestId('workspace-continue-block-view')).toBeVisible()
  await expect(page.getByTestId('workspace-continue-block-reader-mode')).toContainText('Read mode')
  await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('已保存的续写块正文：她在门后听见誓言改变了方向。')
  expect(continueBlockDetailRequestCount).toBeGreaterThanOrEqual(2)
})

test('delete affordances stay visible across rewrite/continue/what-if/future-jump nodes and selected deletes recover URL state deterministically', async ({ page }) => {
  let timelineState = buildDeleteAffordanceTimelinePayload()
  const continueBlockDetails = {
    'rewrite-block-1': buildContinueBlockDetail({
      continueBlockId: 'rewrite-block-1',
      timelineNodeId: 'rewrite-node-1',
      parentTimelineNodeId: null,
      sourceChapterNo: 10,
      title: 'RE-01 第一版改写',
      subtitle: '首个保存的改写节点',
      userInstruction: '让誓言转向更冷的情绪。',
      selectedText: '第10章正文',
      originalText: '第10章正文',
      latestText: '改写正文：她在门后听见誓言改变了方向。',
      inputTokens: 38,
      outputTokens: 52,
      latestRevisionNo: 1,
    }),
    'continue-block-1': buildContinueBlockDetail({
      continueBlockId: 'continue-block-1',
      timelineNodeId: 'continue-node-1',
      parentTimelineNodeId: 'rewrite-node-1',
      sourceChapterNo: 10,
      title: 'CONT-01 续写块',
      subtitle: '沿着改写结果继续推进',
      userInstruction: '继续压低场景里的情绪。',
      selectedText: '第10章正文',
      originalText: '改写正文：她在门后听见誓言改变了方向。',
      latestText: '续写正文：她决定把誓言藏进下一次沉默。',
      inputTokens: 44,
      outputTokens: 61,
      latestRevisionNo: 1,
    }),
  }
  const continueBlockDetailRequests: string[] = []

  await page.route('**/api/workspace', async (route) => {
    await route.fulfill({ json: buildWorkspacePayload() })
  })
  await page.route('**/api/story-timeline*', async (route) => {
    if (route.request().method() === 'DELETE') {
      const { nodeId } = route.request().postDataJSON() as { nodeId: string }
      timelineState = deleteTimelineNodeFromPayload(timelineState, nodeId)
      await route.fulfill({ json: { ok: true } })
      return
    }

    await route.fulfill({ json: timelineState })
  })
  await page.route('**/api/knowledge-view*', async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        localOutlines: [],
        localCharacters: [],
        localCharacterRelations: [],
        localWorldEntries: [],
        localTimelineEvents: [],
        knowledgeRebuildStatus: null,
        jobOutcome: null,
      },
    })
  })
  await page.route('**/api/continue-blocks/*', async (route) => {
    const continueBlockId = new URL(route.request().url()).pathname.split('/').at(-1) ?? ''
    continueBlockDetailRequests.push(continueBlockId)
    await route.fulfill({ json: continueBlockDetails[continueBlockId as keyof typeof continueBlockDetails] })
  })
  await page.route('**/api/what-if/sessions/what-if-session-001?*', async (route) => {
    await route.fulfill({ json: buildWhatIfSessionDetail() })
  })
  await page.route('**/api/future-jump/runs/jump-run-001?*', async (route) => {
    await route.fulfill({ json: buildFutureJumpRunDetail(2) })
  })

  await page.goto('/workspace?selectionKind=continue_block&selectionNodeId=continue-node-1&selectionContinueBlockId=continue-block-1&selectionAnchorChapterNo=10', { waitUntil: 'networkidle' })

  await expect(page.getByLabel('删除 Rewrite 节点 RE-01')).toBeVisible()
  await expect(page.getByLabel('删除 Continue block 节点 CONT-01')).toBeVisible()
  await expect(page.getByLabel('删除 What if 节点 IF-01')).toBeVisible()
  await expect(page.getByLabel('删除 Future jump 节点 JUMP-01')).toBeVisible()
  expect(continueBlockDetailRequests).toContain('continue-block-1')

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByLabel('删除 Continue block 节点 CONT-01').click()
  await expect(page).toHaveURL(/selectionKind=rewrite/)
  await expect(page).toHaveURL(/selectionNodeId=rewrite-node-1/)
  await expect(page).not.toHaveURL(/selectionNodeId=continue-node-1/)
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('rewrite')
  expect(continueBlockDetailRequests).toContain('rewrite-block-1')

  timelineState = buildDeleteAffordanceTimelinePayload()
  await page.goto(`/workspace?selectionKind=future_jump&selectionNodeId=${storyBranchFixtureIds.futureJumpNodeId}&selectionRunId=jump-run-001&selectionSourceChapterNo=10&selectionTargetChapterNo=100`, { waitUntil: 'networkidle' })
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByLabel('删除 Future jump 节点 JUMP-01').click()
  await expect(page).toHaveURL(/selectionKind=what_if/)
  await expect(page).toHaveURL(new RegExp(`selectionNodeId=${storyBranchFixtureIds.whatIfNodeId}`))
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('what-if')

  timelineState = buildDeleteAffordanceTimelinePayload()
  await page.goto('/workspace?selectionKind=rewrite&selectionNodeId=rewrite-node-1&selectionContinueBlockId=rewrite-block-1&selectionAnchorChapterNo=10', { waitUntil: 'networkidle' })
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByLabel('删除 Rewrite 节点 RE-01').click()
  await expect(page).toHaveURL(/selectionKind=chapter/)
  await expect(page).toHaveURL(/selectionChapterId=chapter-10/)
  await expect(page.getByTestId('workspace-chapter-body-view')).toBeVisible()

  timelineState = buildDeleteAffordanceTimelinePayload()
  await page.goto(`/workspace?selectionKind=what_if&selectionNodeId=${storyBranchFixtureIds.whatIfNodeId}&selectionSessionId=what-if-session-001&selectionAnchorChapterNo=10`, { waitUntil: 'networkidle' })
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByLabel('删除 What if 节点 IF-01').click()
  await expect(page).toHaveURL(/selectionKind=chapter/)
  await expect(page).toHaveURL(/selectionChapterId=chapter-10/)
  await expect(page.getByTestId('workspace-chapter-body-view')).toBeVisible()
  await expect(page.getByTestId(`timeline-node-${storyBranchFixtureIds.futureJumpNodeId}`)).toBeVisible()
  await expect(page.getByTestId(`timeline-node-${storyBranchFixtureIds.futureJumpNodeId}`)).toContainText('JUMP-01')
  await page.getByTestId(`timeline-node-${storyBranchFixtureIds.futureJumpNodeId}`).click()
  await expect(page.getByTestId('workspace-future-jump-view')).toBeVisible()
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('future-jump')
})

test('full speculative branching flow persists through revise, reload, and reopened jump selection', async ({ page }) => {
  fs.mkdirSync(evidenceDirectory, { recursive: true })
  fs.mkdirSync(futureJumpEvidenceDirectory, { recursive: true })
  let includeCreatedWhatIf = false
  let includeCreatedJump = false
  let whatIfPayload: Record<string, unknown> | null = null
  let createPayload: Record<string, unknown> | null = null
  let revisePayload: Record<string, unknown> | null = null
  let currentDetail = buildFutureJumpRunDetail(2)

  await page.route('**/api/workspace', async (route) => {
    await route.fulfill({ json: buildWorkspacePayload() })
  })
  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({
      json: buildStoryTimelinePayload({
        includeWhatIf: includeCreatedWhatIf || includeCreatedJump,
        includeFutureJump: includeCreatedJump,
      }),
    })
  })
  await page.route('**/api/knowledge-view*', async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        localOutlines: [],
        localCharacters: [],
        localCharacterRelations: [],
        localWorldEntries: [],
        localTimelineEvents: [],
        knowledgeRebuildStatus: null,
        jobOutcome: null,
      },
    })
  })
  await page.route('**/api/rag/graph-context*', async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        chapterId: 'chapter-10',
        chapterNo: 10,
        chapterTitle: '第10章 结盟',
        warnings: [],
        lanceEvidence: [],
        tokenEstimate: 32,
        graphContext: {
          seedEntities: [
            {
              id: 'character-1',
              entityType: 'character',
              label: '男主',
              importance: 0.9,
              confidence: 0.95,
              userConfirmed: true,
              score: 0.95,
            },
          ],
          nodes: [
            {
              id: 'character-1',
              entityType: 'character',
              label: '男主',
              importance: 0.9,
              confidence: 0.95,
              userConfirmed: true,
              score: 0.95,
            },
          ],
          edges: [],
          contextText: '',
          warnings: [],
          tokenEstimate: 32,
          status: 'ready',
        },
      },
    })
  })
  await page.route('**/api/what-if/sessions/what-if-session-001?*', async (route) => {
    await route.fulfill({ json: buildWhatIfSessionDetail() })
  })
  await page.route('**/api/what-if/sessions', async (route) => {
    whatIfPayload = route.request().postDataJSON()
    includeCreatedWhatIf = true
    await route.fulfill({
      json: {
        sessionId: 'what-if-session-001',
        timelineNodeId: storyBranchFixtureIds.whatIfNodeId,
        generatedText: '魔改后的 What-if 正文',
        deltas: buildWhatIfSessionDetail().deltas,
        title: 'IF-01 决裂线',
        subtitle: '如果他们在这里闹翻',
      },
    })
  })
  await page.route('**/api/story-future-map*', async (route) => {
    await route.fulfill({ json: buildFutureMapPayload() })
  })
  await page.route('**/api/rag/build-generation-context', async (route) => {
    await route.fulfill({ json: buildGenerationContextPayload() })
  })
  await page.route('**/api/rewrite', async (route) => {
    await route.fulfill({
      status: 200,
      body: '魔改后的 What-if 正文',
      contentType: 'text/plain; charset=utf-8',
    })
  })
  await page.route('**/api/future-jump/runs', async (route) => {
    createPayload = route.request().postDataJSON()
    includeCreatedJump = true
    await route.fulfill({
      json: {
        runId: 'jump-run-001',
        timelineNodeId: storyBranchFixtureIds.futureJumpNodeId,
        bridgeSummary: 'bridge summary',
        generatedTargetText: 'future jump text',
      },
    })
  })
  await page.route('**/api/future-jump/runs/jump-run-001?*', async (route) => {
    await route.fulfill({ json: currentDetail })
  })
  await page.route('**/api/future-jump/runs/jump-run-001/revise', async (route) => {
    revisePayload = route.request().postDataJSON()
    currentDetail = buildFutureJumpRunDetail(3)
    await route.fulfill({
      json: {
        runId: 'jump-run-001',
        timelineNodeId: storyBranchFixtureIds.futureJumpNodeId,
        bridgeSummary: currentDetail.bridgeSummary,
        generatedTargetText: currentDetail.generatedTargetText,
      },
    })
  })

  await page.goto('/workspace', { waitUntil: 'networkidle' })

  const chapterCard = page.getByRole('button', { name: 'Chapter 10 第10章 结盟 1200 字' })
  const ifNode = page.getByTestId(`timeline-node-${storyBranchFixtureIds.whatIfNodeId}`)

  await expect(page.getByTestId('timeline-chapter-10')).toBeVisible()
  await expect(page.getByTestId('timeline-chapter-100')).toBeVisible()
  await expect(ifNode).toBeHidden()

  await chapterCard.evaluate((node: HTMLButtonElement) => node.click())
  await expect(page.getByTestId('workspace-chapter-body-view')).toBeVisible()
  await expect(page.getByTestId('workspace-chapter-view-toggle')).toBeVisible()

  await page.locator('[contenteditable="true"]').evaluate((editor) => {
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

  await expect(page.getByTestId('workspace-chapter-rewrite-entry')).toBeVisible()
  await expect(page.getByTestId('workspace-chapter-roleplay-entry')).toBeVisible()
  await expect(page.getByTestId('workspace-chapter-rewrite-entry')).toContainText('魔改')
  await expect(page.getByTestId('workspace-chapter-roleplay-entry')).toContainText('角色扮演')
  await expect(page.getByTestId('workspace-chapter-body-view')).not.toContainText('未来跳转')

  await page.getByTestId('workspace-chapter-rewrite-entry').click()
  await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
  await expect(page.getByTestId('workspace-context-panel-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('workspace-context-panel')).toHaveCount(0)
  await page.getByTestId('workspace-context-panel-toggle').click()
  await expect(page.getByTestId('workspace-context-panel-toggle')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('workspace-context-panel')).toBeVisible()
  await expect(page.getByText('Future jump context')).toBeVisible()
  await expect(page.getByTestId('workspace-context-panel')).not.toContainText('输出要求')
  await expect(page.getByTestId('workspace-current-word-count')).not.toContainText('1,200 字')
  await expect(page.getByTestId('workspace-current-input-tokens')).toContainText('输入 — tokens')
  await expect(page.getByTestId('workspace-current-output-tokens')).toContainText('输出 — tokens')
  const contextBlockToggle = page.getByTestId('workspace-context-panel').getByRole('checkbox').first()
  await expect(contextBlockToggle).toBeChecked()
  await contextBlockToggle.uncheck()
  await expect(contextBlockToggle).not.toBeChecked()
  await page.getByTestId('workspace-context-panel-toggle').click()
  await expect(page.getByTestId('workspace-context-panel')).toHaveCount(0)
  await page.getByTestId('workspace-context-panel-toggle').click()
  await expect(page.getByTestId('workspace-context-panel')).toBeVisible()
  await expect(page.getByTestId('workspace-context-panel').getByRole('checkbox').first()).not.toBeChecked()
  await page.getByRole('button', { name: '生成候选版本' }).click()
  await expect(page.getByRole('button', { name: '创建 What-if' })).toBeEnabled()
  await expect(page.getByTestId('workspace-action-overlay')).toContainText('魔改后的 What-if 正文')
  await page.getByRole('button', { name: '创建 What-if' }).click()

  expect(whatIfPayload).toMatchObject({
    novelId: 'novel-001',
    branchId: 'novel-001:main',
    sourceChapterNo: 10,
    generatedText: '魔改后的 What-if 正文',
  })

  await expect(page.getByTestId('workspace-action-overlay')).toBeHidden()
  await expect(ifNode).toBeVisible()
  await expect(page.getByTestId('what-if-view')).toBeVisible()
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('what-if')
  await expect(page.getByText('魔改后的 What-if 正文')).toBeVisible()
  await expect(page.getByTestId('what-if-delta-list')).toBeVisible()
  await expect(page.getByTestId('workspace-current-input-tokens')).toContainText('输入 321 tokens')
  await expect(page.getByTestId('workspace-current-output-tokens')).toContainText('输出 654 tokens')

  await page.getByRole('button', { name: 'Regenerate What-if' }).click()
  await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
  await expect(page.getByPlaceholder(rewritePromptPlaceholder)).toHaveValue(DEFAULT_REWRITE_PROMPT)
  await page.getByTestId('workspace-action-overlay').click({ position: { x: 8, y: 8 } })
  await expect(page.getByTestId('workspace-action-overlay')).toBeHidden()

  await ifNode.click()
  await page.getByTestId('what-if-jump-button').click()
  await expect(page.getByTestId('future-map-overlay')).toBeVisible()
  await expect(page.getByTestId('future-map-overlay')).not.toContainText('novel-001:main')
  await expect(page.getByTestId('future-map-confirm')).toBeDisabled()
  await page.getByTestId('future-map-track-phase-3').click()
  await page.getByTestId('future-map-event-outline_event_100').click()
  await expect(page.getByTestId('future-map-resolved-chapter')).toContainText('第 100 章')
  await expect(page.getByTestId('future-map-confirm')).toBeEnabled()
  await page.getByPlaceholder('可选：给这次 Future Jump 一句额外方向，例如“先保留误会，再让救援更晚到来”。').fill('让救援更晚到来')
  await page.screenshot({ path: path.join(evidenceDirectory, 'event-chapter-select.png'), fullPage: true })
  await page.getByTestId('future-map-confirm').click()

  expect(createPayload).toEqual({
    sourceContext: {
      nodeId: storyBranchFixtureIds.whatIfNodeId,
      nodeType: 'what_if',
      chapterId: 'chapter-10',
      chapterNo: 10,
      whatIfSessionId: 'what-if-session-001',
    },
    targetOutlineNodeId: 'outline_event_100',
    targetOutlineChapterId: 'outline_chapter_100_primary',
    parentTimelineNodeId: storyBranchFixtureIds.whatIfNodeId,
    userDirection: '让救援更晚到来',
  })

  const jumpNode = page.getByTestId(`timeline-node-${storyBranchFixtureIds.futureJumpNodeId}`)
  const edge = page.getByTestId(`timeline-edge-${storyBranchFixtureIds.whatIfNodeId}-${storyBranchFixtureIds.futureJumpNodeId}`)
  await expect(page.getByTestId('future-map-overlay')).toBeHidden()
  await expect(jumpNode).toBeVisible()
  await expect(page.getByTestId('workspace-future-jump-view')).toBeVisible()
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('future-jump')
  await expect(jumpNode).toHaveAttribute('data-active', 'true')
  await expect(edge).toHaveAttribute('data-active', 'true')
  await expect(jumpNode).toContainText('JUMP-01')
  await expect(page.getByTestId('workspace-center-pane')).toContainText('JUMP-01')
  await expect(page.getByTestId('workspace-future-jump-view')).toContainText(`指令预览 · ${formatStoryBranchInstructionPreview('让救援更晚到来')}`)
  await expect(page.getByTestId('workspace-current-input-tokens')).toContainText('输入 555 tokens')
  await expect(page.getByTestId('workspace-current-output-tokens')).toContainText('输出 666 tokens')
  await expect(page.getByText('jump-run-001')).toHaveCount(0)
  await expect(page.getByText(/anchor 第/i)).toHaveCount(0)
  await expect(page.getByText(/^draft$/i)).toHaveCount(0)
  await expect(page.getByText(/^from\b/i)).toHaveCount(0)

  await page.getByTestId('future-jump-feedback').fill('把救援再推迟一章')
  await page.getByTestId('future-jump-regenerate').click()
  await expect(page.getByTestId('future-jump-bridge')).toContainText('第三版桥接摘要：误会被拉长，救援明显延后。')
  await expect(page.getByTestId('future-jump-text')).toContainText('第三版未来正文：她被带走后，所有误会都在更慢地发酵。')
  await expect(page.getByTestId('workspace-current-input-tokens')).toContainText('输入 777 tokens')
  await expect(page.getByTestId('workspace-current-output-tokens')).toContainText('输出 888 tokens')
  expect(revisePayload).toEqual({ userFeedback: '把救援再推迟一章' })

  await expect(page).toHaveURL(/selectionKind=future_jump/)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByTestId('workspace-future-jump-view')).toBeVisible()
  await expect(page.getByTestId('future-jump-bridge')).toContainText('第三版桥接摘要：误会被拉长，救援明显延后。')
  await jumpNode.click()
  await expect(page.getByTestId('future-jump-text')).toContainText('第三版未来正文：她被带走后，所有误会都在更慢地发酵。')

  const chapter100 = page.getByRole('button', { name: 'Chapter 100 第100章 被绑走 1900 字' })
  await chapter100.evaluate((node: HTMLButtonElement) => node.click())
  await expect(page.getByTestId('workspace-chapter-body-view')).toBeVisible()
  await expect(page.getByText('第100章正文')).toBeVisible()
  await page.screenshot({ path: path.join(futureJumpEvidenceDirectory, 'reload-reopen-jump.png'), fullPage: true })
})

test('future map shows derived provenance badges on inferred candidates', async ({ page }) => {
  fs.mkdirSync(evidenceDirectory, { recursive: true })

  await page.route('**/api/workspace', async (route) => {
    await route.fulfill({ json: buildWorkspacePayload() })
  })
  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({ json: buildStoryTimelinePayload({ includeWhatIf: true, includeFutureJump: false }) })
  })
  await page.route('**/api/knowledge-view*', async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        localOutlines: [],
        localCharacters: [],
        localCharacterRelations: [],
        localWorldEntries: [],
        localTimelineEvents: [],
        knowledgeRebuildStatus: null,
        jobOutcome: null,
      },
    })
  })
  await page.route('**/api/rag/graph-context*', async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        chapterId: 'chapter-10',
        chapterNo: 10,
        chapterTitle: '第10章 结盟',
        warnings: [],
        lanceEvidence: [],
        tokenEstimate: 32,
        graphContext: {
          seedEntities: [],
          nodes: [],
          edges: [],
          contextText: '',
          warnings: [],
          tokenEstimate: 32,
          status: 'ready',
        },
      },
    })
  })
  await page.route('**/api/what-if/sessions/what-if-session-001?*', async (route) => {
    await route.fulfill({ json: buildWhatIfSessionDetail() })
  })
  await page.route('**/api/story-future-map*', async (route) => {
    await route.fulfill({ json: buildFutureMapPayload() })
  })

  await page.goto('/workspace', { waitUntil: 'networkidle' })
  await page.getByTestId(`timeline-node-${storyBranchFixtureIds.whatIfNodeId}`).click()
  await page.getByTestId('what-if-jump-button').click()
  await expect(page.getByTestId('future-map-overlay')).toBeVisible()

  await page.getByTestId('future-map-mode-direct-chapter').click()
  await page.getByTestId('future-map-track-phase-4').click()
  await expect(page.getByTestId('future-map-direct-chapter-120')).toBeVisible()
  await expect(page.getByText('derived event')).toBeVisible()
  await expect(page.getByText('基于现有线索推导出的重逢节点。')).toBeVisible()
  await expect(page.getByText(/置信度 74%/)).toBeVisible()
  await page.screenshot({ path: path.join(evidenceDirectory, 'derived-badges.png'), fullPage: true })
})

test('future jump view renders latest revision, revises in place, and reopens rewrite flow with guardrails', async ({ page }) => {
  fs.mkdirSync(futureJumpEvidenceDirectory, { recursive: true })
  let currentDetail = buildFutureJumpRunDetail(2)
  let timelineState = buildStoryTimelinePayload({ includeWhatIf: true, includeFutureJump: true })
  let revisePayload: Record<string, unknown> | null = null
  let rewritePayload: Record<string, unknown> | null = null
  let continueBlockPayload: Record<string, unknown> | null = null
  let reviseRequestCount = 0
  const continueBlockDetails: Record<string, ReturnType<typeof buildContinueBlockDetail>> = {}
  const continueBlockDetailRequests: string[] = []

  await page.route('**/api/workspace', async (route) => {
    await route.fulfill({ json: buildWorkspacePayload() })
  })
  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({ json: timelineState })
  })
  await page.route('**/api/knowledge-view*', async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        localOutlines: [],
        localCharacters: [],
        localCharacterRelations: [],
        localWorldEntries: [],
        localTimelineEvents: [],
        knowledgeRebuildStatus: null,
        jobOutcome: null,
      },
    })
  })
  await page.route('**/api/what-if/sessions/what-if-session-001?*', async (route) => {
    await route.fulfill({ json: buildWhatIfSessionDetail() })
  })
  await page.route('**/api/continue-blocks/*', async (route) => {
    const continueBlockId = new URL(route.request().url()).pathname.split('/').at(-1) ?? ''
    continueBlockDetailRequests.push(continueBlockId)
    await route.fulfill({ json: continueBlockDetails[continueBlockId] })
  })
  await page.route('**/api/story-future-map*', async (route) => {
    await route.fulfill({ json: buildFutureMapPayload() })
  })
  await page.route('**/api/future-jump/runs/jump-run-001?*', async (route) => {
    await route.fulfill({ json: currentDetail })
  })
  await page.route('**/api/future-jump/runs/jump-run-001/revise', async (route) => {
    revisePayload = route.request().postDataJSON()
    reviseRequestCount += 1
    currentDetail = buildFutureJumpRunDetail(3)
    await route.fulfill({
      json: {
        runId: 'jump-run-001',
        timelineNodeId: storyBranchFixtureIds.futureJumpNodeId,
        bridgeSummary: currentDetail.bridgeSummary,
        generatedTargetText: currentDetail.generatedTargetText,
      },
    })
  })
  await page.route('**/api/rag/build-generation-context', async (route) => {
    await route.fulfill({ json: buildGenerationContextPayload() })
  })
  await page.route('**/api/rewrite', async (route) => {
    rewritePayload = route.request().postDataJSON()
    await route.fulfill({ status: 200, body: '未来续写候选正文：她被带走后，誓言开始在更远的地方回响。' })
  })
  await page.route('**/api/continue-blocks', async (route) => {
    continueBlockPayload = route.request().postDataJSON()
    continueBlockDetails['continue-block-2'] = buildContinueBlockDetail({
      continueBlockId: 'continue-block-2',
      timelineNodeId: 'continue-node-2',
      parentTimelineNodeId: storyBranchFixtureIds.futureJumpNodeId,
      sourceChapterNo: 100,
      title: 'CONT-02 未来续写块',
      subtitle: '沿着未来跳转继续推进',
      userInstruction: '沿着未来跳转后的正文继续推进。',
      selectedText: '第三版未来正文：她被带走后，所有误会都在更慢地发酵。',
      originalText: '第三版未来正文：她被带走后，所有误会都在更慢地发酵。',
      latestText: '未来续写块正文：她被带走后，誓言开始在更远的地方回响。',
      inputTokens: 73,
      outputTokens: 91,
      latestRevisionNo: 1,
    })
    timelineState = {
      ...timelineState,
      branchNodes: [
        ...timelineState.branchNodes,
        {
          type: 'branch_node' as const,
          id: 'continue-node-2',
          nodeType: 'continue_block' as const,
          anchorChapterNo: 100,
          parentNodeId: storyBranchFixtureIds.futureJumpNodeId,
          title: 'CONT-02 未来续写块',
          subtitle: '沿着未来跳转继续推进',
          laneIndex: 0,
          colorToken: 'fuchsia',
          sourceChapterNo: 100,
          targetChapterNo: null,
          continueBlockId: 'continue-block-2',
          whatIfSessionId: null,
          futureJumpRunId: null,
          latestText: '未来续写块正文：她被带走后，誓言开始在更远的地方回响。',
          latestRevisionNo: 1,
          userInstruction: '沿着未来跳转后的正文继续推进。',
          selectedText: '第三版未来正文：她被带走后，所有误会都在更慢地发酵。',
          originalText: '第三版未来正文：她被带走后，所有误会都在更慢地发酵。',
          status: 'active',
        },
      ],
      edges: [...timelineState.edges, { fromNodeId: storyBranchFixtureIds.futureJumpNodeId, toNodeId: 'continue-node-2' }],
    }
    await route.fulfill({
      json: {
        continueBlockId: 'continue-block-2',
        timelineNodeId: 'continue-node-2',
        generatedText: '未来续写块正文：她被带走后，誓言开始在更远的地方回响。',
        title: 'CONT-02 未来续写块',
        subtitle: '沿着未来跳转继续推进',
        latestRevisionNo: 1,
      },
    })
  })

  await page.goto('/workspace', { waitUntil: 'networkidle' })

  const jumpNode = page.getByTestId(`timeline-node-${storyBranchFixtureIds.futureJumpNodeId}`)
  await jumpNode.click()

  await expect(page.getByTestId('future-jump-view')).toBeVisible()
  await expect(page.getByTestId('future-jump-bridge')).toContainText('第二版桥接摘要：误会升级，救援晚到一步。')
  await expect(page.getByTestId('future-jump-text')).toContainText('第二版未来正文：她被带走后，误会已经先一步封死所有退路。')
  await expect(page.getByText('第 2 版 · feedback')).toBeVisible()
  await page.screenshot({ path: path.join(futureJumpEvidenceDirectory, 'latest-revision.png'), fullPage: true })

  await page.getByTestId('future-jump-feedback').fill('把救援再推迟一章')
  await page.getByTestId('future-jump-regenerate').click()

  await expect(page.getByTestId('future-jump-bridge')).toContainText('第三版桥接摘要：误会被拉长，救援明显延后。')
  await expect(page.getByTestId('future-jump-text')).toContainText('第三版未来正文：她被带走后，所有误会都在更慢地发酵。')
  await expect(page.getByText('第 3 版 · feedback')).toBeVisible()
  expect(revisePayload).toEqual({ userFeedback: '把救援再推迟一章' })
  await page.screenshot({ path: path.join(futureJumpEvidenceDirectory, 'revision-flow.png'), fullPage: true })

  await expect(page.getByTestId('future-jump-regenerate')).toBeVisible()
  await expect(page.getByTestId('future-jump-continue')).toBeVisible()
  await page.getByTestId('future-jump-continue').click()
  await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
  await expect(page.getByText('默认不替换正文')).toBeVisible()
  await expect(page.getByPlaceholder(rewritePromptPlaceholder)).toHaveValue(DEFAULT_REWRITE_PROMPT)
  await expect(page.getByTestId('workspace-action-overlay').getByText('第三版未来正文：她被带走后，所有误会都在更慢地发酵。').first()).toBeVisible()
  await page.getByRole('button', { name: '生成候选版本' }).click()
  await page.getByRole('button', { name: '保存为续写块' }).click()

  expect(rewritePayload).toMatchObject({
    operationType: 'rewrite',
    selectedText: '第三版未来正文：她被带走后，所有误会都在更慢地发酵。',
    sourceText: '第三版未来正文：她被带走后，所有误会都在更慢地发酵。',
  })
  expect(continueBlockPayload).toMatchObject({
    branchId: 'novel-001:main',
    sourceChapterNo: 100,
    parentTimelineNodeId: storyBranchFixtureIds.futureJumpNodeId,
    selectedText: '第三版未来正文：她被带走后，所有误会都在更慢地发酵。',
    originalText: '第三版未来正文：她被带走后，所有误会都在更慢地发酵。',
  })
  expect(reviseRequestCount).toBe(1)
  await expect(page).toHaveURL(/selectionKind=continue_block/)
  await expect(page).toHaveURL(/selectionNodeId=continue-node-2/)
  await expect(page.getByTestId('workspace-continue-block-view')).toBeVisible()
  await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('未来续写块正文：她被带走后，誓言开始在更远的地方回响。')
  expect(continueBlockDetailRequests).toContain('continue-block-2')
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByTestId('workspace-continue-block-view')).toBeVisible()
  await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('未来续写块正文：她被带走后，誓言开始在更远的地方回响。')
  expect(continueBlockDetailRequests.filter((id) => id === 'continue-block-2').length).toBeGreaterThanOrEqual(2)
})

test('continue-block selection restores on reload and exposes the reader action matrix', async ({ page }) => {
  let continueBlockDetailRequestCount = 0

  await page.route('**/api/workspace', async (route) => {
    await route.fulfill({ json: buildWorkspacePayload() })
  })
  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({ json: buildContinueBlockTimelinePayload() })
  })
  await page.route('**/api/knowledge-view*', async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        localOutlines: [],
        localCharacters: [],
        localCharacterRelations: [],
        localWorldEntries: [],
        localTimelineEvents: [],
        knowledgeRebuildStatus: null,
        jobOutcome: null,
      },
    })
  })
  await page.route('**/api/continue-blocks/continue-block-1?*', async (route) => {
    continueBlockDetailRequestCount += 1
    await route.fulfill({
      json: buildContinueBlockDetail({
        continueBlockId: 'continue-block-1',
        timelineNodeId: 'continue-node-1',
        parentTimelineNodeId: null,
        sourceChapterNo: 10,
        title: 'CONT-01 续写块',
        subtitle: '沿着当前节点继续写',
        userInstruction: '把誓言后的情绪变化压进同一场景。',
        selectedText: '第10章正文',
        originalText: '第10章正文',
        latestText: '已保存的续写块正文：她在门后听见誓言改变了方向。',
        inputTokens: 41,
        outputTokens: 59,
        latestRevisionNo: 1,
      }),
    })
  })

  await page.goto('/workspace?selectionKind=continue_block&selectionNodeId=continue-node-1&selectionContinueBlockId=continue-block-1&selectionAnchorChapterNo=10', { waitUntil: 'networkidle' })

  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('continue-block')
  await expect(page.getByTestId('workspace-continue-block-actions')).toBeVisible()
  await expect(page.getByTestId('workspace-continue-block-view')).toBeVisible()
  await expect(page.getByTestId('workspace-continue-block-reader-mode')).toContainText('Read mode')
  await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('已保存的续写块正文：她在门后听见誓言改变了方向。')
  expect(continueBlockDetailRequestCount).toBeGreaterThanOrEqual(1)
  await expect(page.getByTestId('workspace-continue-block-continue-entry')).toBeEnabled()
  await expect(page.getByTestId('workspace-continue-block-regenerate-entry')).toBeEnabled()
  await expect(page.getByTestId('workspace-continue-block-future-jump-entry')).toBeEnabled()

  await page.reload({ waitUntil: 'networkidle' })

  await expect(page).toHaveURL(/selectionKind=continue_block/)
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('continue-block')
  await expect(page.getByTestId('workspace-continue-block-actions')).toBeVisible()
  await expect(page.getByTestId('workspace-continue-block-view')).toBeVisible()
  await expect(page.getByTestId('workspace-continue-block-reader-mode')).toContainText('Read mode')
  expect(continueBlockDetailRequestCount).toBeGreaterThanOrEqual(2)
})

test('continue-block continue creates a child node while regenerate updates the same node in place', async ({ page }) => {
  let timelineState = buildContinueBlockTimelinePayload()
  let createPayload: Record<string, unknown> | null = null
  let regeneratePayload: Record<string, unknown> | null = null
  const generationContextPayloads: Record<string, unknown>[] = []
  const rewritePayloads: Record<string, unknown>[] = []
  const continueBlockDetails: Record<string, ReturnType<typeof buildContinueBlockDetail>> = {
    'continue-block-1': buildContinueBlockDetail({
      continueBlockId: 'continue-block-1',
      timelineNodeId: 'continue-node-1',
      parentTimelineNodeId: null,
      sourceChapterNo: 10,
      title: 'CONT-01 续写块',
      subtitle: '沿着当前节点继续写',
      userInstruction: '把誓言后的情绪变化压进同一场景。',
      selectedText: '第10章正文',
      originalText: '第10章正文',
      latestText: '已保存的续写块正文：她在门后听见誓言改变了方向。',
      inputTokens: 41,
      outputTokens: 59,
      latestRevisionNo: 1,
    }),
  }
  const continueBlockDetailRequests: string[] = []

  await page.route('**/api/workspace', async (route) => {
    await route.fulfill({ json: buildWorkspacePayload() })
  })
  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({ json: timelineState })
  })
  await page.route('**/api/knowledge-view*', async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        localOutlines: [],
        localCharacters: [],
        localCharacterRelations: [],
        localWorldEntries: [],
        localTimelineEvents: [],
        knowledgeRebuildStatus: null,
        jobOutcome: null,
      },
    })
  })
  await page.route('**/api/rag/build-generation-context', async (route) => {
    generationContextPayloads.push(route.request().postDataJSON())
    await route.fulfill({ json: buildGenerationContextPayload() })
  })
  await page.route('**/api/rewrite', async (route) => {
    rewritePayloads.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, body: '新的候选正文：誓言之后，她选择独自离开。' })
  })
  await page.route('**/api/continue-blocks/*', async (route) => {
    const continueBlockId = new URL(route.request().url()).pathname.split('/').at(-1) ?? ''
    continueBlockDetailRequests.push(continueBlockId)
    await route.fulfill({ json: continueBlockDetails[continueBlockId] })
  })
  await page.route('**/api/continue-blocks', async (route) => {
    if (route.request().method() === 'PUT') {
      regeneratePayload = route.request().postDataJSON()
      continueBlockDetails['continue-block-1'] = buildContinueBlockDetail({
        continueBlockId: 'continue-block-1',
        timelineNodeId: 'continue-node-1',
        parentTimelineNodeId: null,
        sourceChapterNo: 10,
        title: 'CONT-01 重生版',
        subtitle: '同节点重生后保留修订历史',
        userInstruction: '重新生成当前 continue block，并保留它的修订历史。',
        selectedText: '第10章正文',
        originalText: '第10章正文',
        latestText: '重生后的续写块正文：誓言之后，她选择独自离开。',
        inputTokens: 67,
        outputTokens: 89,
        latestRevisionNo: 2,
        revisions: [
          {
            revisionNo: 1,
            revisionKind: 'initial',
            userInstruction: '把誓言后的情绪变化压进同一场景。',
            selectedText: '第10章正文',
            originalText: '第10章正文',
            generatedText: '已保存的续写块正文：她在门后听见誓言改变了方向。',
            inputTokens: 41,
            outputTokens: 59,
            title: 'CONT-01 续写块',
            subtitle: '沿着当前节点继续写',
            createdAt: '2026-05-15T01:23:45.000Z',
          },
          {
            revisionNo: 2,
            revisionKind: 'regenerate',
            userInstruction: '重新生成当前 continue block，并保留它的修订历史。',
            selectedText: '第10章正文',
            originalText: '第10章正文',
            generatedText: '重生后的续写块正文：誓言之后，她选择独自离开。',
            inputTokens: 67,
            outputTokens: 89,
            title: 'CONT-01 重生版',
            subtitle: '同节点重生后保留修订历史',
            createdAt: '2026-05-15T01:25:45.000Z',
          },
        ],
      })
      timelineState = {
        ...timelineState,
        branchNodes: timelineState.branchNodes.map((node) => node.id === 'continue-node-1'
          ? {
              ...node,
              title: 'CONT-01 重生版',
              subtitle: '同节点重生后保留修订历史',
              latestText: '重生后的续写块正文：誓言之后，她选择独自离开。',
              latestRevisionNo: 2,
              userInstruction: '重新生成当前 continue block，并保留它的修订历史。',
            }
          : node),
      }
      await route.fulfill({
        json: {
          continueBlockId: 'continue-block-1',
          timelineNodeId: 'continue-node-1',
          generatedText: '重生后的续写块正文：誓言之后，她选择独自离开。',
          title: 'CONT-01 重生版',
          subtitle: '同节点重生后保留修订历史',
          latestRevisionNo: 2,
        },
      })
      return
    }

    createPayload = route.request().postDataJSON()
    continueBlockDetails['continue-block-2'] = buildContinueBlockDetail({
      continueBlockId: 'continue-block-2',
      timelineNodeId: 'continue-node-2',
      parentTimelineNodeId: 'continue-node-1',
      sourceChapterNo: 10,
      title: 'CONT-02 子续写块',
      subtitle: '沿着当前续写块继续推进',
      userInstruction: '继续沿着这个 continue block 的最新版本扩展新的续写块，不要覆盖当前节点。',
      selectedText: '第10章正文',
      originalText: '已保存的续写块正文：她在门后听见誓言改变了方向。',
      latestText: '子续写块正文：誓言之后，她选择独自离开。',
      inputTokens: 63,
      outputTokens: 84,
      latestRevisionNo: 1,
    })
    timelineState = {
      ...timelineState,
      branchNodes: [
        ...timelineState.branchNodes,
        {
          type: 'branch_node' as const,
          id: 'continue-node-2',
          nodeType: 'continue_block' as const,
          anchorChapterNo: 10,
          parentNodeId: 'continue-node-1',
          title: 'CONT-02 子续写块',
          subtitle: '沿着当前续写块继续推进',
          laneIndex: 1,
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
          status: 'active',
        },
      ],
      edges: [...timelineState.edges, { fromNodeId: 'continue-node-1', toNodeId: 'continue-node-2' }],
    }
    await route.fulfill({
      json: {
        continueBlockId: 'continue-block-2',
        timelineNodeId: 'continue-node-2',
        generatedText: '子续写块正文：誓言之后，她选择独自离开。',
        title: 'CONT-02 子续写块',
        subtitle: '沿着当前续写块继续推进',
        latestRevisionNo: 1,
      },
    })
  })

  await page.goto('/workspace?selectionKind=continue_block&selectionNodeId=continue-node-1&selectionContinueBlockId=continue-block-1&selectionAnchorChapterNo=10', { waitUntil: 'networkidle' })
  expect(continueBlockDetailRequests).toContain('continue-block-1')

  await page.getByTestId('workspace-continue-block-continue-entry').click()
  await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
  await expect(page.getByRole('button', { name: /当前续写块版本/ })).toBeVisible()
  await page.getByRole('button', { name: '生成候选版本' }).click()
  await page.getByRole('button', { name: '保存为续写块' }).click()

  expect(createPayload).toMatchObject({
    parentTimelineNodeId: 'continue-node-1',
    branchId: 'novel-001:main',
  })
  expect(generationContextPayloads[0]).toMatchObject({
    branchContextNodeId: 'continue-node-1',
    branchContextInclusion: 'include_selected',
  })
  expect(rewritePayloads[0]).toMatchObject({
    branchContextNodeId: 'continue-node-1',
    branchContextInclusion: 'include_selected',
  })
  await expect(page).toHaveURL(/selectionNodeId=continue-node-2/)
  await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('子续写块正文：誓言之后，她选择独自离开。')
  await expect(page.getByTestId('workspace-continue-block-reader-mode')).toContainText('Read mode')
  expect(continueBlockDetailRequests).toContain('continue-block-2')

  await page.goto('/workspace?selectionKind=continue_block&selectionNodeId=continue-node-1&selectionContinueBlockId=continue-block-1&selectionAnchorChapterNo=10', { waitUntil: 'networkidle' })
  await page.getByTestId('workspace-continue-block-regenerate-entry').click()
  await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
  await expect(page.getByRole('button', { name: /当前待重生版本/ })).toBeVisible()
  await page.getByRole('button', { name: '生成候选版本' }).click()
  await page.getByRole('button', { name: '保存为续写块' }).click()

  expect(regeneratePayload).toMatchObject({
    continueBlockId: 'continue-block-1',
  })
  expect(generationContextPayloads[1]).toMatchObject({
    branchContextNodeId: 'continue-node-1',
    branchContextInclusion: 'include_selected',
  })
  expect(rewritePayloads[1]).toMatchObject({
    branchContextNodeId: 'continue-node-1',
    branchContextInclusion: 'include_selected',
  })
  await expect(page).toHaveURL(/selectionNodeId=continue-node-1/)
  await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('重生后的续写块正文：誓言之后，她选择独自离开。')
  await expect(page.getByTestId('workspace-continue-block-reader-mode')).toContainText('Read mode')
  await expect(page.getByTestId('continue-block-revision-history')).toContainText('已保存的续写块正文：她在门后听见誓言改变了方向。')
  await expect(page.getByTestId('continue-block-history-item-1')).toContainText('第 1 版 · initial')
  expect(continueBlockDetailRequests.filter((id) => id === 'continue-block-1').length).toBeGreaterThanOrEqual(2)
})

test('mixed continue and future-jump trees keep continue-block navigation selectable and reload-stable', async ({ page }) => {
  const continueBlockDetails = {
    'continue-block-1': buildContinueBlockDetail({
      continueBlockId: 'continue-block-1',
      timelineNodeId: 'continue-node-1',
      parentTimelineNodeId: storyBranchFixtureIds.whatIfNodeId,
      sourceChapterNo: 10,
      title: 'CONT-01 续写块',
      subtitle: '沿着分支继续推进',
      userInstruction: '把誓言后的情绪变化压进同一场景。',
      selectedText: '第10章正文',
      originalText: '第10章正文',
      latestText: '已保存的续写块正文：她在门后听见誓言改变了方向。',
      inputTokens: 41,
      outputTokens: 59,
      latestRevisionNo: 1,
    }),
    'continue-block-2': buildContinueBlockDetail({
      continueBlockId: 'continue-block-2',
      timelineNodeId: 'continue-node-2',
      parentTimelineNodeId: storyBranchFixtureIds.futureJumpNodeId,
      sourceChapterNo: 100,
      title: 'CONT-02 未来续写块',
      subtitle: '沿着未来跳转继续推进',
      userInstruction: '沿着未来跳转后的正文继续推进。',
      selectedText: '第100章正文',
      originalText: '第100章正文',
      latestText: '未来续写块正文：她被带走后，誓言开始在更远的地方回响。',
      inputTokens: 73,
      outputTokens: 91,
      latestRevisionNo: 1,
    }),
  }
  const continueBlockDetailRequests: string[] = []

  await page.route('**/api/workspace', async (route) => {
    await route.fulfill({ json: buildWorkspacePayload() })
  })
  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({ json: buildMixedContinueTreeTimelinePayload() })
  })
  await page.route('**/api/knowledge-view*', async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        localOutlines: [],
        localCharacters: [],
        localCharacterRelations: [],
        localWorldEntries: [],
        localTimelineEvents: [],
        knowledgeRebuildStatus: null,
        jobOutcome: null,
      },
    })
  })
  await page.route('**/api/continue-blocks/*', async (route) => {
    const continueBlockId = new URL(route.request().url()).pathname.split('/').at(-1) ?? ''
    continueBlockDetailRequests.push(continueBlockId)
    await route.fulfill({ json: continueBlockDetails[continueBlockId as keyof typeof continueBlockDetails] })
  })

  await page.goto('/workspace', { waitUntil: 'networkidle' })

  await expect(page.getByTestId('timeline-node-continue-node-1')).toBeVisible()
  await expect(page.getByTestId(`timeline-node-${storyBranchFixtureIds.futureJumpNodeId}`)).toBeVisible()
  await expect(page.getByTestId('timeline-node-continue-node-2')).toBeVisible()
  await expect(page.getByTestId('timeline-node-continue-node-1')).toHaveAttribute('data-visible-depth', '1')
  await expect(page.getByTestId(`timeline-node-${storyBranchFixtureIds.futureJumpNodeId}`)).toHaveAttribute('data-visible-depth', '1')
  await expect(page.getByTestId('timeline-node-continue-node-2')).toHaveAttribute('data-visible-depth', '1')

  await page.getByTestId('timeline-node-continue-node-2').click()

  await expect(page).toHaveURL(/selectionKind=continue_block/)
  await expect(page).toHaveURL(/selectionNodeId=continue-node-2/)
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('continue-block')
  await expect(page.getByTestId('workspace-continue-block-view')).toBeVisible()
  await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('未来续写块正文：她被带走后，誓言开始在更远的地方回响。')
  expect(continueBlockDetailRequests).toContain('continue-block-2')

  await page.reload({ waitUntil: 'networkidle' })

  await expect(page).toHaveURL(/selectionNodeId=continue-node-2/)
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('continue-block')
  await expect(page.getByTestId('workspace-continue-block-view')).toBeVisible()
  await expect(page.getByTestId('workspace-continue-block-reader-body')).toContainText('未来续写块正文：她被带走后，誓言开始在更远的地方回响。')
  expect(continueBlockDetailRequests.filter((id) => id === 'continue-block-2').length).toBeGreaterThanOrEqual(2)
  await expect(page.getByTestId('timeline-node-continue-node-1')).toHaveAttribute('data-visible-depth', '1')
  await expect(page.getByTestId(`timeline-node-${storyBranchFixtureIds.futureJumpNodeId}`)).toHaveAttribute('data-visible-depth', '1')
  await expect(page.getByTestId('timeline-node-continue-node-2')).toHaveAttribute('data-visible-depth', '1')
})

test('future jump launched from a continue node stays attached under that current node after reload', async ({ page }) => {
  let createPayload: Record<string, unknown> | null = null
  let timelineState: StoryTimelineResponse = {
    ...buildMixedContinueTreeTimelinePayload(),
    branchNodes: buildMixedContinueTreeTimelinePayload().branchNodes.filter(
      (node) => node.id !== storyBranchFixtureIds.futureJumpNodeId && node.id !== 'continue-node-2'
    ),
    edges: [{ fromNodeId: storyBranchFixtureIds.whatIfNodeId, toNodeId: 'continue-node-1' }],
  }
  const currentDetail = {
    ...buildFutureJumpRunDetail(2),
    parentTimelineNodeId: 'continue-node-1',
    sourceContext: {
      nodeId: 'continue-node-1',
      nodeType: 'continue_block' as const,
      chapterId: 'chapter-10',
      chapterNo: 10,
      whatIfSessionId: 'what-if-session-001',
    },
    timelineNodeId: storyBranchFixtureIds.futureJumpNodeId,
  }

  await page.route('**/api/workspace', async (route) => {
    await route.fulfill({ json: buildWorkspacePayload() })
  })
  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({ json: timelineState })
  })
  await page.route('**/api/knowledge-view*', async (route) => {
    await route.fulfill({ json: { ok: true, localOutlines: [], localCharacters: [], localCharacterRelations: [], localWorldEntries: [], localTimelineEvents: [], knowledgeRebuildStatus: null, jobOutcome: null } })
  })
  await page.route('**/api/what-if/sessions/what-if-session-001?*', async (route) => {
    await route.fulfill({ json: buildWhatIfSessionDetail() })
  })
  await page.route('**/api/story-future-map*', async (route) => {
    await route.fulfill({ json: buildFutureMapPayload() })
  })
  await page.route('**/api/future-jump/runs', async (route) => {
    createPayload = route.request().postDataJSON()
    timelineState = {
      ...timelineState,
      branchNodes: [
        ...timelineState.branchNodes,
        {
          type: 'branch_node' as const,
          id: storyBranchFixtureIds.futureJumpNodeId,
          nodeType: 'future_jump' as const,
          readableLabel: 'JUMP-01',
          readableLineageLabel: 'IF-01, CONT-01, JUMP-01',
          anchorChapterNo: 100,
          parentNodeId: 'continue-node-1',
          title: 'IF-01, CONT-01, JUMP-01 第100章',
          subtitle: '跳到被绑走后的未来',
          laneIndex: 1,
          colorToken: 'violet',
          sourceChapterNo: 10,
          targetChapterNo: 100,
          continueBlockId: null,
          whatIfSessionId: null,
          futureJumpRunId: 'jump-run-001',
          createdAt: '2026-05-15T01:23:00.000Z',
          status: 'generated',
        },
      ],
      edges: [...timelineState.edges, { fromNodeId: 'continue-node-1', toNodeId: storyBranchFixtureIds.futureJumpNodeId }],
    }
    await route.fulfill({
      json: {
        runId: 'jump-run-001',
        timelineNodeId: storyBranchFixtureIds.futureJumpNodeId,
        bridgeSummary: 'bridge summary',
        generatedTargetText: 'future jump text',
      },
    })
  })
  await page.route('**/api/future-jump/runs/jump-run-001?*', async (route) => {
    await route.fulfill({ json: currentDetail })
  })

  await page.goto('/workspace', { waitUntil: 'networkidle' })
  await page.getByTestId('timeline-node-continue-node-1').click()
  await expect(page.getByTestId('workspace-continue-block-future-jump-entry')).toBeEnabled()
  await page.getByTestId('workspace-continue-block-future-jump-entry').click()
  await expect(page.getByTestId('future-map-overlay')).toBeVisible()
  await page.getByTestId('future-map-event-outline_event_100').click()
  await expect(page.getByTestId('future-map-resolved-chapter')).toContainText('第 100 章')
  await page.getByTestId('future-map-confirm').click()

  expect(createPayload).toEqual({
    sourceContext: {
      nodeId: 'continue-node-1',
      nodeType: 'continue_block',
      chapterId: 'chapter-10',
      chapterNo: 10,
      whatIfSessionId: null,
    },
    targetOutlineNodeId: 'outline_event_100',
    targetOutlineChapterId: 'outline_chapter_100_primary',
    parentTimelineNodeId: 'continue-node-1',
  })

  const jumpNode = page.getByTestId(`timeline-node-${storyBranchFixtureIds.futureJumpNodeId}`)
  const jumpEdge = page.getByTestId(`timeline-edge-continue-node-1-${storyBranchFixtureIds.futureJumpNodeId}`)
  await expect(jumpNode).toBeVisible()
  await expect(jumpEdge).toHaveAttribute('data-active', 'true')
  await expect(page).toHaveURL(/selectionKind=future_jump/)
  await expect(page).toHaveURL(new RegExp(`selectionNodeId=${storyBranchFixtureIds.futureJumpNodeId}`))
  await expect(page.getByTestId('workspace-future-jump-view')).toBeVisible()

  await page.reload({ waitUntil: 'networkidle' })

  await expect(page.getByTestId(`timeline-edge-continue-node-1-${storyBranchFixtureIds.futureJumpNodeId}`)).toBeVisible()
  await expect(page.getByTestId('workspace-future-jump-view')).toBeVisible()
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('future-jump')
})

test('focused future jump chooser history mode from what-if binds the chapter immediately', async ({ page }) => {
  let createPayload: Record<string, unknown> | null = null

  await page.route('**/api/workspace', async (route) => {
    await route.fulfill({ json: buildWorkspacePayload() })
  })
  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({ json: buildStoryTimelinePayload({ includeWhatIf: true, includeFutureJump: false }) })
  })
  await page.route('**/api/knowledge-view*', async (route) => {
    await route.fulfill({ json: { ok: true, localOutlines: [], localCharacters: [], localCharacterRelations: [], localWorldEntries: [], localTimelineEvents: [], knowledgeRebuildStatus: null, jobOutcome: null } })
  })
  await page.route('**/api/what-if/sessions/what-if-session-001?*', async (route) => {
    await route.fulfill({ json: buildWhatIfSessionDetail() })
  })
  await page.route('**/api/story-future-map*', async (route) => {
    await route.fulfill({ json: buildFutureMapPayload() })
  })
  await page.route('**/api/future-jump/runs', async (route) => {
    createPayload = route.request().postDataJSON()
    await route.fulfill({
      json: {
        runId: 'jump-run-002',
        timelineNodeId: storyBranchFixtureIds.futureJumpNodeId,
        bridgeSummary: 'bridge',
        generatedTargetText: 'future jump text',
      },
    })
  })

  await page.goto(`/workspace?selectionKind=what_if&selectionNodeId=${storyBranchFixtureIds.whatIfNodeId}&selectionSessionId=what-if-session-001&selectionAnchorChapterNo=10`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('workspace-what-if-view')).toBeVisible()
  await page.getByTestId('what-if-jump-button').click()
  await expect(page.getByTestId('future-map-overlay')).toBeVisible()
  await page.getByTestId('future-map-event-outline_event_100').click()
  await expect(page.getByTestId('future-map-resolved-chapter')).toContainText('第 100 章')
  await expect(page.getByTestId('future-map-confirm')).toBeEnabled()
  await page.getByTestId('future-map-confirm').click()

  expect(createPayload).toEqual({
    sourceContext: {
      nodeId: storyBranchFixtureIds.whatIfNodeId,
      nodeType: 'what_if',
      chapterId: 'chapter-10',
      chapterNo: 10,
      whatIfSessionId: 'what-if-session-001',
    },
    targetOutlineNodeId: 'outline_event_100',
    targetOutlineChapterId: 'outline_chapter_100_primary',
    parentTimelineNodeId: storyBranchFixtureIds.whatIfNodeId,
  })
})

test('focused future jump chooser direct-chapter mode shows real summaries and keeps invalid state deterministic', async ({ page }) => {
  let createPayload: Record<string, unknown> | null = null

  await page.route('**/api/workspace', async (route) => {
    await route.fulfill({ json: buildWorkspacePayload() })
  })
  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({ json: buildStoryTimelinePayload({ includeWhatIf: true, includeFutureJump: false }) })
  })
  await page.route('**/api/knowledge-view*', async (route) => {
    await route.fulfill({ json: { ok: true, localOutlines: [], localCharacters: [], localCharacterRelations: [], localWorldEntries: [], localTimelineEvents: [], knowledgeRebuildStatus: null, jobOutcome: null } })
  })
  await page.route('**/api/what-if/sessions/what-if-session-001?*', async (route) => {
    await route.fulfill({ json: buildWhatIfSessionDetail() })
  })
  await page.route('**/api/story-future-map*', async (route) => {
    await route.fulfill({ json: buildFutureMapPayload() })
  })
  await page.route('**/api/future-jump/runs', async (route) => {
    createPayload = route.request().postDataJSON()
    await route.fulfill({
      json: {
        runId: 'jump-run-003',
        timelineNodeId: storyBranchFixtureIds.futureJumpNodeId,
        bridgeSummary: 'bridge',
        generatedTargetText: 'future jump text',
      },
    })
  })

  await page.goto(`/workspace?selectionKind=what_if&selectionNodeId=${storyBranchFixtureIds.whatIfNodeId}&selectionSessionId=what-if-session-001&selectionAnchorChapterNo=10`, { waitUntil: 'networkidle' })
  await page.getByTestId('what-if-jump-button').click()
  await expect(page.getByTestId('future-map-overlay')).toBeVisible()
  await expect(page.getByTestId('future-map-overlay')).not.toContainText('novel-001:main')
  await expect(page.getByTestId('future-map-confirm')).toBeDisabled()
  await page.getByTestId('future-map-mode-direct-chapter').click()
  await expect(page.getByTestId('future-map-confirm')).toBeDisabled()
  await page.getByTestId('future-map-track-phase-4').click()
  await expect(page.getByTestId('future-map-direct-chapter-120')).toBeVisible()
  await expect(page.getByText('基于现有线索推导出的重逢节点。')).toBeVisible()
  await page.getByTestId('future-map-direct-chapter-120').click()
  await expect(page.getByTestId('future-map-resolved-chapter')).toContainText('第 120 章')
  await expect(page.getByTestId('future-map-confirm')).toBeEnabled()
  await page.getByTestId('future-map-confirm').click()

  expect(createPayload).toEqual({
    sourceContext: {
      nodeId: storyBranchFixtureIds.whatIfNodeId,
      nodeType: 'what_if',
      chapterId: 'chapter-10',
      chapterNo: 10,
      whatIfSessionId: 'what-if-session-001',
    },
    targetOutlineNodeId: 'outline_event_120',
    targetOutlineChapterId: 'outline_chapter_120_primary',
    parentTimelineNodeId: storyBranchFixtureIds.whatIfNodeId,
  })
})
