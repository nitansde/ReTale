import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { storyBranchFixtureIds } from '@/tests/helpers/fixture-ids'

const evidenceDirectory = path.join(process.cwd(), '.sisyphus/evidence/task-14-future-map')
const futureJumpEvidenceDirectory = path.join(process.cwd(), '.sisyphus/evidence/task-15-future-jump-view')

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
    targetOutlineNodeId: storyBranchFixtureIds.outlineEventId,
    targetOutlineChapterId: storyBranchFixtureIds.outlineChapterAnchorId,
    sourceChapterNo: 10,
    targetChapterNo: 100,
    userDirection: '让救援更晚到来',
    bridgeSummary,
    generatedTargetText,
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

function buildStoryTimelinePayload(options?: { includeWhatIf?: boolean; includeFutureJump?: boolean }) {
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
          type: 'branch_node',
          id: storyBranchFixtureIds.whatIfNodeId,
          nodeType: 'what_if',
        anchorChapterNo: 10,
        parentNodeId: null,
        title: 'IF-01 决裂线',
        subtitle: '如果他们在这里闹翻',
        laneIndex: 0,
        colorToken: 'rose',
          sourceChapterNo: 10,
          targetChapterNo: null,
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
            anchorChapterNo: 100,
            parentNodeId: storyBranchFixtureIds.whatIfNodeId,
            title: 'JUMP-01 第100章',
            subtitle: '跳到被绑走后的未来',
            laneIndex: 1,
            colorToken: 'violet',
            sourceChapterNo: 10,
            targetChapterNo: 100,
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
    await route.fulfill({ status: 200, body: '魔改后的 What-if 正文' })
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

  await page.getByRole('button', { name: '魔改 围绕选中片段与额外要求，产出一个完整章节重写版本。' }).click()
  await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
  await page.getByRole('button', { name: '生成候选版本' }).click()
  await expect(page.getByTestId('workspace-action-overlay').getByText('魔改后的 What-if 正文').nth(1)).toBeVisible()
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

  await ifNode.click()
  await page.getByTestId('what-if-jump-button').click()
  await expect(page.getByTestId('future-map-overlay')).toBeVisible()
  await expect(page.getByTestId('future-map-confirm')).toBeDisabled()
  await page.getByTestId('future-map-track-phase-3').click()
  await page.getByTestId('future-map-event-outline_event_100').click()
  await expect(page.getByTestId('future-map-confirm')).toBeDisabled()
  await page.getByTestId('future-map-chapter-100').click()
  await expect(page.getByTestId('future-map-confirm')).toBeEnabled()
  await page.getByPlaceholder('可选：给这次 Future Jump 一句额外方向，例如“先保留误会，再让救援更晚到来”。').fill('让救援更晚到来')
  await page.screenshot({ path: path.join(evidenceDirectory, 'event-chapter-select.png'), fullPage: true })
  await page.getByTestId('future-map-confirm').click()

  expect(createPayload).toEqual({
    sessionId: 'what-if-session-001',
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

  await page.getByTestId('future-jump-feedback').fill('把救援再推迟一章')
  await page.getByTestId('future-jump-regenerate').click()
  await expect(page.getByTestId('future-jump-bridge')).toContainText('第三版桥接摘要：误会被拉长，救援明显延后。')
  await expect(page.getByTestId('future-jump-text')).toContainText('第三版未来正文：她被带走后，所有误会都在更慢地发酵。')
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

  await page.getByTestId('future-map-track-phase-4').click()
  await expect(page.getByTestId('future-map-event-outline_event_120')).toBeVisible()
  await expect(page.getByText('derived event')).toBeVisible()
  await expect(page.getByText(/置信度 74%/)).toBeVisible()
  await page.screenshot({ path: path.join(evidenceDirectory, 'derived-badges.png'), fullPage: true })
})

test('future jump view renders latest revision, revises in place, and reopens rewrite flow with guardrails', async ({ page }) => {
  fs.mkdirSync(futureJumpEvidenceDirectory, { recursive: true })
  let currentDetail = buildFutureJumpRunDetail(2)
  let revisePayload: Record<string, unknown> | null = null

  await page.route('**/api/workspace', async (route) => {
    await route.fulfill({ json: buildWorkspacePayload() })
  })
  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({ json: buildStoryTimelinePayload({ includeWhatIf: true, includeFutureJump: true }) })
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
  await page.route('**/api/story-future-map*', async (route) => {
    await route.fulfill({ json: buildFutureMapPayload() })
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
  await page.route('**/api/rag/build-generation-context', async (route) => {
    await route.fulfill({ json: buildGenerationContextPayload() })
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

  await page.getByRole('button', { name: 'Continue this Future' }).click()
  await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
  await expect(page.getByText('默认不替换正文')).toBeVisible()
  await expect(page.getByTestId('workspace-action-overlay').getByText('第三版未来正文：她被带走后，所有误会都在更慢地发酵。').first()).toBeVisible()
})
