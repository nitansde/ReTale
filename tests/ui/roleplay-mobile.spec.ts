import { expect, test, type Page } from '@playwright/test'
import type { StoryTimelineResponse } from '@/lib/story-branch-types'
import { mockNovelResourceApi, type MockNovelResourceMutation } from '@/tests/helpers/novel-resource-api-mock'

test.use({
  viewport: { width: 390, height: 844 },
})

function buildWorkspacePayload() {
  return {
    currentNovelId: 'novel-001',
    currentChapterId: 'chapter-10',
    localNovels: [{ id: 'novel-001', title: 'Fixture Novel', summary: 'Roleplay mobile fixture', tags: ['fixture'] }],
    localChapters: [
      {
        id: 'chapter-10',
        novelId: 'novel-001',
        title: '第10章 结盟',
        order: 10,
        content: '<p>第10章正文：夜色压下来之前，他们已经开始互相试探。</p>',
        status: 'draft',
        wordCount: 1200,
        updatedAt: '2026-05-20',
      },
    ],
  }
}

function buildTimelineState(): StoryTimelineResponse {
  return {
    novelId: 'novel-001',
    branchId: 'novel-001:main',
    chapters: [{ type: 'chapter', chapterNo: 10, chapterId: 'chapter-10', title: '第10章 结盟', wordCount: 1200 }],
    branchNodes: [],
    edges: [],
  }
}

function buildRoleplayMessage(input: {
  id: string
  messageIndex: number
  role: 'user' | 'assistant'
  content: string
  parentMessageId?: string | null
}) {
  const turnIndex = Math.ceil(input.messageIndex / 2)
  return {
    id: input.id,
    sessionId: 'roleplay-session-001',
    messageIndex: input.messageIndex,
    turnIndex,
    variantIndex: 1,
    variantGroupId: `variant-group-${turnIndex}`,
    role: input.role,
    content: input.content,
    parentMessageId: input.parentMessageId ?? null,
    forkedFromMessageId: null,
    createdAt: `2026-05-20T12:0${input.messageIndex}:00.000Z`,
    updatedAt: `2026-05-20T12:0${input.messageIndex}:00.000Z`,
    variantMetadata: {
      turnIndex,
      variantIndex: 1,
      variantGroupId: `variant-group-${turnIndex}`,
    },
    forkMetadata: {
      parentMessageId: input.parentMessageId ?? null,
      forkedFromMessageId: null,
    },
  }
}

function buildSessionDetail(messages: ReturnType<typeof buildRoleplayMessage>[]) {
  return {
    id: 'roleplay-session-001',
    novelId: 'novel-001',
    branchId: 'novel-001:main',
    title: 'RP · 第10章 结盟',
    subtitle: '围绕片段「夜色压下来之前」展开角色扮演',
    sourceChapterNo: 10,
    createdAt: '2026-05-20T12:00:00.000Z',
    updatedAt: '2026-05-20T12:00:00.000Z',
    status: 'active',
    sourceSnapshot: {
      chapterId: 'chapter-10',
      chapterNo: 10,
      chapterTitle: '第10章 结盟',
      timelineNodeId: null,
      timelineNodeType: 'chapter',
      selectedText: '夜色压下来之前，他们已经开始互相试探。',
      textSnapshot: '第10章正文：夜色压下来之前，他们已经开始互相试探。',
      selectedLineStart: 1,
      selectedLineEnd: 1,
    },
    messages,
  }
}

async function openMobileChapterDrawer(page: Page) {
  const chapterDrawerToggle = page.getByRole('button', { name: '打开章节导航', exact: true })
  await expect(chapterDrawerToggle).toBeVisible()
  await chapterDrawerToggle.click()
}

test('roleplay mobile flow reopens timeline chat and keeps chapter body unchanged', async ({ page }) => {
  const initialChapterContent = '<p>第10章正文：夜色压下来之前，他们已经开始互相试探。</p>'
  const workspacePayload = buildWorkspacePayload()
  const workspaceSaves: MockNovelResourceMutation[] = []
  const touchedNonRoleplayMutationRoutes: string[] = []
  let createPayload: Record<string, unknown> | null = null
  const rewritePayloads: Record<string, unknown>[] = []
  let timelineState = buildTimelineState()
  let sessionDetail = buildSessionDetail([])

  await mockNovelResourceApi(page, () => workspacePayload, {
    onMutation: (mutation) => {
      workspaceSaves.push(mutation)
    },
  })

  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(timelineState),
    })
  })

  await page.route('**/api/knowledge-view*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        localOutlines: [],
        localCharacterRelations: [],
        localWorldEntries: [],
        localTimelineEvents: [],
        localCharacters: [],
        knowledgeRebuildStatus: null,
      }),
    })
  })

  await page.route('**/api/continue-blocks**', async (route) => {
    touchedNonRoleplayMutationRoutes.push(route.request().url())
    await route.fulfill({ status: 500, body: 'continue-block route should stay untouched during roleplay flow' })
  })

  await page.route('**/api/future-jump/**', async (route) => {
    touchedNonRoleplayMutationRoutes.push(route.request().url())
    await route.fulfill({ status: 500, body: 'future-jump route should stay untouched during roleplay flow' })
  })

  await page.route('**/api/roleplay/sessions', async (route) => {
    createPayload = await route.request().postDataJSON() as Record<string, unknown>
    timelineState = {
      ...timelineState,
      branchNodes: [
        {
          type: 'branch_node',
          id: 'roleplay-node-1',
          nodeType: 'roleplay_session',
          readableLabel: 'RP-01',
          readableLineageLabel: 'RP-01',
          anchorChapterNo: 10,
          parentNodeId: null,
          title: 'RP · 第10章 结盟',
          subtitle: '围绕片段「夜色压下来之前，他们已经开始互相试探。」展开角色扮演',
          laneIndex: 0,
          colorToken: 'emerald',
          sourceChapterNo: 10,
          targetChapterNo: null,
          continueBlockId: null,
          whatIfSessionId: null,
          futureJumpRunId: null,
          roleplaySessionId: 'roleplay-session-001',
          status: 'active',
        },
      ],
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessionId: 'roleplay-session-001', timelineNodeId: 'roleplay-node-1' }),
    })
  })

  await page.route('**/api/roleplay/sessions/roleplay-session-001?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(sessionDetail),
    })
  })

  await page.route('**/api/roleplay/sessions/roleplay-session-001/messages', async (route) => {
    const payload = await route.request().postDataJSON() as {
      role: 'user' | 'assistant'
      content: string
      parentMessageId?: string | null
    }

    if (payload.role === 'user') {
      const userMessage = buildRoleplayMessage({
        id: 'message-1',
        messageIndex: 1,
        role: 'user',
        content: payload.content,
        parentMessageId: payload.parentMessageId,
      })
      sessionDetail = {
        ...sessionDetail,
        messages: [...sessionDetail.messages, userMessage],
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(userMessage),
      })
      return
    }

    const assistantMessage = buildRoleplayMessage({
      id: 'message-2',
      messageIndex: 2,
      role: 'assistant',
      content: payload.content,
      parentMessageId: payload.parentMessageId,
    })
    sessionDetail = {
      ...sessionDetail,
      messages: [...sessionDetail.messages, assistantMessage],
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(assistantMessage),
    })
  })

  await page.route('**/api/rewrite', async (route) => {
    rewritePayloads.push(await route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: '她没有躲开，只是把试探接成了更慢的一句反问。',
    })
  })

  await page.goto('/workspace', { waitUntil: 'networkidle' })

  await openMobileChapterDrawer(page)
  await expect(page.getByTestId('timeline-chapter-10')).toBeVisible()
  await page.getByTestId('timeline-chapter-10').getByRole('button').first().click()
  await expect(page.getByTestId('workspace-chapter-body-view')).toBeVisible()

  await page.getByTestId('workspace-chapter-reader').evaluate((editor) => {
    const paragraph = editor.querySelector('p')
    const textNode = paragraph?.firstChild
    if (!paragraph || !textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('Failed to resolve editor text node for roleplay selection')
    }

    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, textNode.textContent?.length ?? 0)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })

  await expect(page.getByTestId('workspace-chapter-roleplay-entry')).toBeVisible()
  await page.getByTestId('workspace-chapter-roleplay-entry').click()

  await expect(page.getByTestId('workspace-roleplay-session-view')).toBeVisible()
  await expect(page.getByTestId('workspace-mobile-toolbar')).toHaveCount(0)
  await page.getByRole('button', { name: '更多选项' }).click()
  await page.getByRole('button', { name: '打开故事上下文' }).click()
  await expect(page.getByTestId('workspace-roleplay-session-actions')).toBeVisible()
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('角色扮演')
  await page.getByRole('button', { name: '关闭故事上下文' }).click()
  await expect(page.getByTestId('roleplay-regenerate-last')).toBeDisabled()

  await page.getByPlaceholder('输入角色台词、动作，或你希望推动的剧情。⌘/Ctrl + Enter 发送').fill('别再试探了，现在就把真相说清楚。')
  await page.getByTestId('roleplay-composer-send').click()

  await expect(page.getByTestId('roleplay-message-0')).toContainText('别再试探了，现在就把真相说清楚。')
  await expect(page.getByTestId('roleplay-message-1')).toContainText('她没有躲开，只是把试探接成了更慢的一句反问。')
  await expect(page.getByTestId('roleplay-regenerate-last')).toBeEnabled()
  await page.getByTestId('roleplay-message-0').click()
  await expect(page.getByTestId('roleplay-fork-anchor')).toContainText('下轮从 #1 分叉')

  await page.getByRole('button', { name: '更多选项' }).click()
  await page.getByRole('button', { name: '打开故事上下文' }).click()
  await page.getByRole('button', { name: '关闭故事上下文' }).click()
  await page.getByRole('button', { name: '返回章节' }).click()
  await expect(page.getByTestId('workspace-chapter-body-view')).toBeVisible()
  await expect(page.getByTestId('workspace-chapter-reader')).toContainText('第10章正文：夜色压下来之前，他们已经开始互相试探。')

  await openMobileChapterDrawer(page)
  await page.getByTestId('timeline-node-roleplay-node-1').click()
  await expect(page.getByTestId('workspace-roleplay-session-view')).toBeVisible()
  await expect(page.getByTestId('roleplay-message-0')).toContainText('别再试探了，现在就把真相说清楚。')
  await expect(page.getByTestId('roleplay-message-1')).toContainText('她没有躲开，只是把试探接成了更慢的一句反问。')

  await page.waitForTimeout(900)

  expect(createPayload).toMatchObject({
    novelId: 'novel-001',
    branchId: 'novel-001:main',
    sourceChapterId: 'chapter-10',
    sourceChapterNo: 10,
    sourceTimelineNodeId: null,
    sourceTimelineNodeType: 'chapter',
    sourceSelectedText: '第10章正文：夜色压下来之前，他们已经开始互相试探。',
    sourceTextSnapshot: '第10章正文：夜色压下来之前，他们已经开始互相试探。',
  })
  const rewritePayload = rewritePayloads[0]
  if (!rewritePayload) throw new Error('Rewrite payload was not captured')
  expect(rewritePayload).toMatchObject({
    novelId: 'novel-001',
    branchId: 'novel-001:main',
    operationType: 'roleplay',
    userInstruction: '别再试探了，现在就把真相说清楚。',
  })
  expect(rewritePayload.generatedText).toBeUndefined()
  expect(rewritePayload.continueBlockId).toBeUndefined()
  expect(touchedNonRoleplayMutationRoutes).toEqual([])
  expect(workspaceSaves.every((mutation) => {
    if (mutation.kind === 'chapter') return mutation.payload.content === initialChapterContent
    const localChapters = Array.isArray(mutation.payload.localChapters)
      ? mutation.payload.localChapters as Array<{ content?: string }>
      : []
    return localChapters.every((chapter) => chapter.content === initialChapterContent)
  })).toBe(true)
})
