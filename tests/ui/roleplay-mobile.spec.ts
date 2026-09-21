import { expect, test, type Page } from '@playwright/test'
import { buildRequestPromptMessages } from '@/lib/generation-prompt-preview'
import { type RoleplayTurn, type RoleplayScript, roleplayScriptText } from '@/lib/roleplay-script'
import { createDefaultAISettings } from '@/lib/ai-settings'
import { getRoleplayBranchDeletionIds } from '@/lib/roleplay-branches'
import type { StoryTimelineResponse } from '@/lib/story-branch-types'
import { mockNovelResourceApi, type MockNovelResourceMutation } from '@/tests/helpers/novel-resource-api-mock'

const cast = { playerName: '林舟', counterpartName: '沈月' }
const script: RoleplayScript = { ...cast, blocks: [{ type: 'narration', text: '她没有躲开，只是把试探接成了更慢的一句反问。' }, { type: 'narration', text: '屋里的灯晃了一下。' }, { type: 'counterpart', text: '她抬起眼，语气放轻。“你真的准备好了吗？”' }, { type: 'player', text: '他握紧手中的伞。“我不想再等了。”' }, { type: 'narration', text: '窗外传来雨声。' }, { type: 'counterpart', text: '那就坐下，听我说。' }] }
const savedScript: RoleplayScript = { ...script, blocks: [{ type: 'narration', text: '她没有躲开，只是把试探接成了更慢的一句反问。\n\n屋里的灯晃了一下。' }, ...script.blocks.slice(2)] }

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
  turn?: RoleplayTurn
  script?: RoleplayScript
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
    turn: input.turn,
    script: input.script,
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
    characterOptions: [{ name: '林舟', protagonist: true }, { name: '沈月', protagonist: false }],
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

test('roleplay mobile flow reopens timeline chat and keeps chapter body unchanged', async ({ page }, testInfo) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const initialChapterContent = '<p>第10章正文：夜色压下来之前，他们已经开始互相试探。</p>'
  const workspacePayload = buildWorkspacePayload()
  const workspaceSaves: MockNovelResourceMutation[] = []
  const touchedNonRoleplayMutationRoutes: string[] = []
  let createPayload: Record<string, unknown> | null = null
  const rewritePayloads: Record<string, unknown>[] = []
  const previewPayloads: Record<string, unknown>[] = []
  let generatedScript = script
  let timelineState = buildTimelineState()
  let sessionDetail = buildSessionDetail([])

  const aiSettings = createDefaultAISettings()
  aiSettings.rewrite.openAICompatible = {
    ...aiSettings.rewrite.openAICompatible,
    configured: true,
    baseUrl: 'http://roleplay-fixture.invalid/v1',
    model: 'roleplay-fixture',
    apiKeyConfigured: true,
  }
  await page.route('**/api/settings/ai', (route) => route.fulfill({ json: aiSettings }))
  await page.route('**/api/writing-skills?*', (route) => route.fulfill({ json: { cards: [{ id: 'skill-expression', title: '神态与动作', summary: '通过细小动作推动对话。' }] } }))
  await page.route('**/api/roleplay/preview', async (route) => {
    const body = route.request().postDataJSON()
    previewPayloads.push(body)
    const options = body.roleplayTurn.generationOptions
    const blocks = [
      { id: 'current-summary', label: '当前章节摘要', content: '两人在雨夜交谈。', required: false, priority: 'high', enabled: !options.disabledBlockIds.includes('current-summary'), trimmed: false },
      ...(options.writingSkillCardIds.includes('skill-expression') ? [{ id: 'writing-skill:skill-expression', label: '写作技巧：神态与动作', content: '写作方法：用动作表现迟疑。\n范文：她垂下眼，指尖停在杯沿。', required: false, priority: 'highest', enabled: true, trimmed: false }] : []),
    ]
    const systemPrompt = '角色互动系统指令'
    const userPrompt = blocks.filter((block) => block.enabled).map((block) => `# ${block.label}\n${block.content}`).join('\n') + '\n# 任务\n推进当前对话。'
    await route.fulfill({ json: { ok: true, contextSnapshotId: 'rp-preview', promptBlocks: blocks, writingSkillRecords: [], systemPrompt, userPrompt, requestMessages: buildRequestPromptMessages(systemPrompt, userPrompt), warnings: ['Preset field `top_k` was preserved for export but not applied to openai-compatible.'] } })
  })

  await mockNovelResourceApi(page, () => workspacePayload, {
    onMutation: (mutation) => {
      workspaceSaves.push(mutation)
    },
  })

  await page.route('**/api/story-timeline*', async (route) => {
    if (route.request().method() === 'DELETE') {
      const { nodeId } = route.request().postDataJSON() as { nodeId: string }
      timelineState = { ...timelineState, branchNodes: timelineState.branchNodes.filter((node) => node.id !== nodeId) }
      await route.fulfill({ json: { ok: true, nodeId } })
      return
    }
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
    if (route.request().method() === 'DELETE') {
      const { messageId, mode } = route.request().postDataJSON() as { messageId: string; mode?: string }
      const request = sessionDetail.messages.find((message) => message.id === messageId)!
      const deletedMessageIds = mode === 'branch' ? getRoleplayBranchDeletionIds(sessionDetail.messages, messageId) : sessionDetail.messages.filter((message) => message.id === messageId || (message.role === 'assistant' && message.parentMessageId === messageId)).map((message) => message.id)
      sessionDetail = { ...sessionDetail, messages: sessionDetail.messages.filter((message) => !deletedMessageIds.includes(message.id)).map((message) => ({
        ...message, parentMessageId: message.parentMessageId && deletedMessageIds.includes(message.parentMessageId) ? request.parentMessageId : message.parentMessageId,
      })) }
      await route.fulfill({ json: { ok: true, deletedMessageIds } })
      return
    }
    const payload = await route.request().postDataJSON() as {
      role: 'user' | 'assistant'
      turn?: RoleplayTurn
      script?: RoleplayScript
      content: string
      parentMessageId?: string | null
    }
    const nextMessageIndex = Math.max(0, ...sessionDetail.messages.map((message) => message.messageIndex)) + 1

    if (payload.role === 'user') {
      const userMessage = buildRoleplayMessage({
        id: `message-${nextMessageIndex}`,
        messageIndex: nextMessageIndex,
        role: 'user',
        content: payload.content,
        turn: payload.turn,
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
      id: `message-${nextMessageIndex}`,
      messageIndex: nextMessageIndex,
      role: 'assistant',
      content: payload.content,
      script: payload.script,
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
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'openai-compatible', result: { content: JSON.stringify({ blocks: generatedScript.blocks }) }, metadata: { internal: 'ROLEPLAY_METADATA_SENTINEL' }, presetCompat: { streamPolicy: { effective: false } } }),
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
  await expect(page.getByTestId('workspace-roleplay-session-actions')).toHaveCount(0)
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('角色扮演')
  await page.getByRole('button', { name: '关闭故事上下文' }).click()
  await expect(page.getByTestId('roleplay-regenerate-last')).toHaveCount(0)
  await expect(page.getByTestId('roleplay-cast-picker')).toBeVisible()
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('roleplay-cast.png') })
  await page.getByRole('group', { name: '对方角色' }).getByRole('button', { name: '沈月', exact: true }).click()
  await page.getByRole('button', { name: '进入故事', exact: true }).click()
  await expect(page.getByTestId('roleplay-empty-state')).toBeVisible()
  await expect(page.getByRole('button', { name: '返回章节', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '对话来源', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('workspace-roleplay-session-view').locator('header')).toHaveCount(0)
  const mobileHeader = page.getByTestId('workspace-mobile-header')
  await mobileHeader.getByRole('button', { name: '选择对话角色' }).click()
  await expect(page.getByRole('dialog', { name: '选择对话角色' }).getByRole('textbox', { name: '对方角色' })).toHaveValue('沈月')
  await page.getByRole('button', { name: '关闭人物选择' }).click()
  await mobileHeader.getByRole('button', { name: '打开知识状态' }).click()
  await expect(page.getByRole('button', { name: '关闭知识状态' })).toBeVisible()
  await page.getByRole('button', { name: '关闭知识状态' }).click()
  await expect(mobileHeader.getByRole('button', { name: '设置', exact: true })).toHaveCount(0)
  await mobileHeader.getByRole('button', { name: '更多选项' }).click()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible()
  await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '关闭', exact: true }).click()
  const composer = page.getByTestId('roleplay-composer')
  await expect(composer).toHaveAttribute('data-expanded', 'false')
  expect((await composer.boundingBox())!.height).toBeLessThan(130)
  await expect(page.getByRole('textbox', { name: '故事引导' })).toHaveCount(0)
  const mobileMessages = await page.getByTestId('roleplay-message-list').boundingBox()
  expect(mobileMessages?.height).toBeGreaterThan(600)
  await expect(page.getByTestId('roleplay-composer-send')).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true)
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('roleplay-mobile-empty.png') })

  await page.getByRole('textbox', { name: '我的台词' }).fill('别再试探了，现在就把真相说清楚。')
  await page.getByRole('textbox', { name: '故事引导' }).fill('她站在窗边，雨声渐近。')
  await page.getByRole('spinbutton', { name: '本次目标字数' }).fill('500')
  await expect(composer).toHaveAttribute('data-expanded', 'true')
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('roleplay-mobile-expanded-composer.png') })
  await page.getByRole('button', { name: '收起输入框' }).click()
  await expect(page.getByRole('textbox', { name: '我的台词' })).toHaveValue('别再试探了，现在就把真相说清楚。')
  await page.getByRole('textbox', { name: '我的台词' }).click()
  await expect(page.getByRole('textbox', { name: '故事引导' })).toHaveValue('她站在窗边，雨声渐近。')
  await page.getByRole('button', { name: '写作技巧', exact: true }).click()
  const skillPicker = page.getByTestId('roleplay-skill-picker')
  await expect(skillPicker).toBeVisible()
  await expect(skillPicker).not.toHaveAttribute('open', '')
  await expect(page.getByRole('checkbox', { name: '神态与动作', exact: true })).toBeHidden()
  await page.getByTestId('roleplay-skill-picker-trigger').click()
  await expect(page.getByText('通过细小动作推动对话。', { exact: true })).toHaveCount(0)
  await page.getByRole('checkbox', { name: /神态与动作/ }).check()
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('roleplay-skill-menu.png') })
  await page.getByTestId('roleplay-skill-picker-trigger').click()
  await expect(page.getByTestId('roleplay-skill-picker-trigger')).toContainText('神态与动作')
  await expect(skillPicker).not.toHaveAttribute('open', '')
  await page.getByRole('combobox', { name: '每张卡范文数' }).selectOption('2')
  await expect(page.getByTestId('prompt-block-content-writing-skill:skill-expression')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('她垂下眼，指尖停在杯沿。')
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('roleplay-writing-skills.png') })
  await page.getByRole('button', { name: '关闭写作技巧' }).click()
  await page.getByRole('button', { name: '高级上下文' }).click()
  const advancedContext = page.getByTestId('advanced-context-prompt-panel')
  await expect(advancedContext.getByRole('tab')).toHaveCount(0)
  await expect(advancedContext.getByTestId('context-prompt-blocks')).toHaveCount(1)
  await expect(advancedContext.getByTestId('prompt-block-content-request-preset')).toBeHidden()
  await advancedContext.getByRole('button', { name: '展开全文：预设' }).click()
  await expect(advancedContext.getByTestId('prompt-block-content-request-preset')).toContainText('角色互动系统指令')
  await advancedContext.getByRole('button', { name: '收起全文：预设' }).click()
  await expect(page.getByRole('dialog')).not.toContainText('preserved for export')
  await page.getByRole('checkbox', { name: '当前章节摘要' }).uncheck()
  await expect.poll(() => previewPayloads.at(-1)?.disabledBlockIds).toEqual(['current-summary'])
  await expect(page.getByRole('checkbox', { name: '当前章节摘要' })).not.toBeChecked()
  await expect(advancedContext).toContainText('推进当前对话')
  await expect(advancedContext.getByText(/用动作表现迟疑/)).toHaveCount(1)
  await expect(advancedContext.getByText(/两人在雨夜交谈/)).toHaveCount(1)
  await expect(page.getByTestId('roleplay-final-prompt')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('roleplay-advanced-context.png') })
  await page.getByRole('button', { name: '关闭高级上下文' }).click()
  await page.getByTestId('roleplay-composer-send').click()

  await expect(page.getByTestId('roleplay-message-0')).toContainText('别再试探了，现在就把真相说清楚。')
  await expect(page.getByTestId('roleplay-message-1')).toContainText('她没有躲开，只是把试探接成了更慢的一句反问。')
  await expect(page.getByTestId('roleplay-regenerate-last')).toBeEnabled()
  await expect(composer).toHaveAttribute('data-expanded', 'false')
  await expect(page.getByTestId('roleplay-message-list')).not.toContainText('ROLEPLAY_METADATA_SENTINEL')
  expect(sessionDetail.messages.at(-1)?.script).toEqual(savedScript)
  await expect(page.locator('[data-roleplay-block=player]')).toHaveCount(1)
  await expect(page.locator('[data-roleplay-block=counterpart]')).toHaveCount(2)
  await expect(page.locator('[data-roleplay-block=narration]')).toHaveCount(2)
  expect(await page.locator('[data-roleplay-block=narration]').first().locator('p').last().textContent()).toBe(savedScript.blocks[0].text)
  await expect(page.locator('[data-roleplay-block=counterpart]').first()).toContainText('她抬起眼，语气放轻。“你真的准备好了吗？”')
  await expect(page.locator('[data-roleplay-block=player]')).toContainText('他握紧手中的伞。“我不想再等了。”')
  expect(rewritePayloads[0]?.roleplayTurn).toMatchObject({ ...cast, maxCharacters: 500, storyGuidance: '她站在窗边，雨声渐近。' })
  expect(rewritePayloads[0]).toMatchObject({ writingSkillCardIds: ['skill-expression'], writingSkillExampleCount: 2, disabledBlockIds: ['current-summary'], contextSnapshotId: 'rp-preview' })
  await expect(page.getByTestId('roleplay-message-0').getByRole('button', { name: '重新生成' })).toBeEnabled()
  await expect(page.getByTestId('roleplay-message-0').getByRole('button', { name: '删除请求 #1' })).toBeEnabled()
  await page.getByTestId('roleplay-message-0').scrollIntoViewIfNeeded()
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('roleplay-mobile-chat.png') })
  await page.getByTestId('roleplay-message-0').getByRole('button', { name: '从 #1 分叉' }).click()
  await expect(page.getByTestId('roleplay-fork-anchor')).toContainText('下轮从 #1 分叉')

  await page.getByRole('button', { name: '更多选项' }).click()
  await page.getByRole('button', { name: '打开故事上下文' }).click()
  await page.getByRole('button', { name: '关闭故事上下文' }).click()
  await openMobileChapterDrawer(page)
  await page.getByTestId('timeline-chapter-10').getByRole('button').first().click()
  await expect(page.getByTestId('workspace-chapter-body-view')).toBeVisible()
  await expect(page.getByTestId('workspace-chapter-reader')).toContainText('第10章正文：夜色压下来之前，他们已经开始互相试探。')

  await openMobileChapterDrawer(page)
  await page.getByTestId('timeline-node-roleplay-node-1').click()
  await expect(page.getByTestId('workspace-roleplay-session-view')).toBeVisible()
  await expect(page.getByTestId('roleplay-message-0')).toContainText('别再试探了，现在就把真相说清楚。')
  await expect(page.getByTestId('roleplay-message-1')).toContainText('她没有躲开，只是把试探接成了更慢的一句反问。')

  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByRole('button', { name: '写作技巧 · 1' })).toBeVisible()
  await page.getByRole('textbox', { name: '我的台词' }).fill('我坐下了，你接着说吧。')
  await page.getByTestId('roleplay-composer-send').click()
  await expect(page.getByTestId('roleplay-message-3')).toBeVisible()
  expect(rewritePayloads[1]).toMatchObject({
    roleplayMessages: [
      { role: 'user', content: '故事引导：她站在窗边，雨声渐近。\n林舟对沈月说：别再试探了，现在就把真相说清楚。' },
      { role: 'assistant', content: roleplayScriptText(savedScript) },
    ],
    presetCompatRuntimeContext: { sessionPhase: 'continue' },
    writingSkillCardIds: ['skill-expression'], writingSkillExampleCount: 2, disabledBlockIds: ['current-summary'],
  })

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.getByTestId('workspace-chapter-nav')).toBeVisible()
  const desktopMessages = await page.getByTestId('roleplay-message-list').boundingBox()
  expect(desktopMessages?.width).toBeGreaterThan(1000)
  expect(desktopMessages?.height).toBeGreaterThan(500)
  await expect(page.getByTestId('roleplay-composer-send')).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true)
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('roleplay-desktop-chat.png') })
  await page.getByRole('button', { name: '选择对话角色' }).click()
  await expect(page.getByRole('dialog', { name: '选择对话角色' })).toBeVisible()
  await page.getByRole('button', { name: '关闭人物选择' }).click()
  await page.getByRole('button', { name: '打开故事上下文' }).click()
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('角色扮演')
  await page.getByRole('button', { name: '关闭故事上下文' }).click()

  await expect(page.getByRole('button', { name: /^删除请求/ })).toHaveCount(2)
  await expect(page.getByTestId('roleplay-message-0').getByRole('button', { name: '重新生成' })).toHaveCount(0)
  await page.getByTestId('roleplay-message-2').getByRole('button', { name: '重新生成' }).click()
  await expect(page.getByTestId('roleplay-message-4')).toBeVisible()
  expect(rewritePayloads[2]?.roleplayTurn).toEqual(rewritePayloads[1]?.roleplayTurn)
  await expect(page.getByTestId('roleplay-regenerate-last')).toHaveCount(1)
  await expect(page.getByTestId('roleplay-message-3')).toHaveCount(0)
  await page.getByRole('button', { name: '上一个回复版本' }).click()
  await expect(page.getByTestId('roleplay-message-3')).toBeVisible()
  await expect(page.getByTestId('roleplay-message-4')).toHaveCount(0)
  await page.getByRole('button', { name: '下一个回复版本' }).click()
  await expect(page.getByTestId('roleplay-message-4')).toBeVisible()
  await page.getByTestId('roleplay-message-2').getByRole('button', { name: '删除请求 #3' }).click()
  await expect(page.getByTestId('roleplay-message-2')).toHaveCount(0)
  await expect(page.getByTestId('roleplay-message-0').getByRole('button', { name: '重新生成' })).toBeEnabled()
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByRole('button', { name: /^删除请求/ })).toHaveCount(1)
  await expect(page.getByTestId('roleplay-message-1')).toContainText('她没有躲开')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('textbox', { name: '我的台词' }).fill('继续走向城门。')
  await page.getByTestId('roleplay-composer-send').click()
  await expect(page.getByTestId('roleplay-message-3')).toBeVisible()
  await page.getByRole('button', { name: '从 #2 分叉' }).click()
  await expect(page.getByTestId('roleplay-message-2')).toHaveCount(0)
  await page.getByRole('textbox', { name: '我的台词' }).fill('改走河边。')
  await page.getByTestId('roleplay-composer-send').click()
  await expect(page.getByTestId('roleplay-message-5')).toBeVisible()
  const branchPicker = page.getByRole('button', { name: '当前分支', exact: true })
  await expect(branchPicker).toHaveAttribute('data-selected-branch', 'message-6')
  const branchIconBounds = await page.getByTestId('roleplay-branch-picker').boundingBox()
  const sendBounds = await page.getByTestId('roleplay-composer-send').boundingBox()
  expect(branchIconBounds!.width).toBeLessThanOrEqual(44)
  expect(Math.abs(branchIconBounds!.y - sendBounds!.y)).toBeLessThan(2)
  await expect(page.getByTestId('roleplay-message-2')).toHaveCount(0)
  await page.getByTestId('roleplay-message-4').scrollIntoViewIfNeeded()
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('roleplay-mobile-branches.png') })
  await page.getByRole('button', { name: '上一个剧情分支' }).click()
  await expect(branchPicker).toHaveAttribute('data-selected-branch', 'message-4')
  await expect(page.getByTestId('roleplay-message-2')).toContainText('继续走向城门。')
  await expect(page.getByTestId('roleplay-message-4')).toHaveCount(0)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(branchPicker).toHaveAttribute('data-selected-branch', 'message-4')
  await expect(page.getByTestId('roleplay-message-2')).toContainText('继续走向城门。')
  await page.getByRole('textbox', { name: '我的台词' }).fill('这条路上有什么？')
  await page.getByTestId('roleplay-composer-send').click()
  await expect(page.getByTestId('roleplay-message-7')).toBeVisible()
  expect(sessionDetail.messages.at(-2)?.parentMessageId).toBe('message-4')
  expect(JSON.stringify(rewritePayloads.at(-1)?.roleplayMessages)).toContain('继续走向城门。')
  expect(JSON.stringify(rewritePayloads.at(-1)?.roleplayMessages)).not.toContain('改走河边。')
  await branchPicker.click()
  await page.getByTestId('roleplay-select-branch-message-6').click()
  await expect(page.getByTestId('roleplay-message-4')).toContainText('改走河边。')
  await expect(page.getByTestId('roleplay-message-6')).toHaveCount(0)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByTestId('roleplay-message-4').scrollIntoViewIfNeeded()
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('roleplay-desktop-branches.png') })
  await branchPicker.click()
  await page.getByTestId('roleplay-select-branch-message-8').click()
  // Delete the inactive route from the menu, retaining the selected route and shared opening.
  await page.setViewportSize({ width: 390, height: 844 })
  await branchPicker.click()
  await expect(page.getByTestId('roleplay-select-branch-message-8')).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('roleplay-branch-menu.png') })
  await page.getByRole('button', { name: '删除分支 2', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('独有的 2 条消息')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByTestId('roleplay-select-branch-message-6')).toBeVisible()
  await page.getByRole('button', { name: '删除分支 2', exact: true }).click()
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('roleplay-branch-delete-confirm.png') })
  await page.getByRole('button', { name: '确认删除分支', exact: true }).click()
  await expect(page.getByTestId('roleplay-select-branch-message-6')).toHaveCount(0)
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await expect(branchPicker).toHaveAttribute('data-selected-branch', 'message-8')
  await expect(page.getByTestId('roleplay-message-0')).toHaveCount(1)
  await expect(page.getByTestId('roleplay-message-6')).toContainText('这条路上有什么？')
  await page.reload({ waitUntil: 'networkidle' })
  await branchPicker.click()
  await expect(page.getByTestId('roleplay-select-branch-message-6')).toHaveCount(0)
  await expect(page.getByTestId('roleplay-select-branch-message-8')).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 900 })

  const historyStart = Math.max(...sessionDetail.messages.map((message) => message.messageIndex))
  sessionDetail = {
    ...sessionDetail,
    messages: [...sessionDetail.messages, ...Array.from({ length: 20 }, (_, index) => buildRoleplayMessage({
      id: `history-${index}`,
      messageIndex: index + historyStart + 1,
      parentMessageId: index === 0 ? sessionDetail.messages.at(-1)!.id : `history-${index - 1}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      turn: index % 2 === 0 ? { ...cast, dialogue: '然后呢？', storyGuidance: '', maxCharacters: 500 } : undefined,
      script: index % 2 ? script : undefined,
      content: index % 2 === 0 ? '然后呢？' : '她望向街角，终于说出了那一夜的经过。\n\n灯火一点点暗下去，脚步声却越来越近。'.repeat(3),
    }))],
  }
  await page.reload({ waitUntil: 'networkidle' })
  const messageList = page.getByTestId('roleplay-message-list')
  await expect(page.getByTestId(`roleplay-message-${sessionDetail.messages.at(-1)!.messageIndex - 1}`)).toBeVisible()
  expect(await messageList.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await expect(page.getByTestId('roleplay-composer-send')).toBeInViewport()
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('roleplay-desktop-light-long-chat.png') })
  await page.setViewportSize({ width: 360, height: 640 })
  await page.getByRole('textbox', { name: '我的台词' }).fill('第一行\n第二行\n第三行\n第四行\n第五行')
  await expect(page.getByTestId('roleplay-composer-send')).toBeInViewport()
  await expect.poll(() => messageList.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(2)
  expect(await messageList.evaluate((element) => element.clientHeight)).toBeGreaterThan(200)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true)
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('roleplay-mobile-light-long-chat.png') })
  await page.setViewportSize({ width: 320, height: 640 })
  await expect(page.getByTestId('roleplay-composer-send')).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '收起输入框' }).click()
  expect((await composer.boundingBox())!.height).toBeLessThan(130)
  await expect(page.getByTestId('roleplay-branch-picker')).toBeInViewport()

  generatedScript = { ...script, blocks: [
    { type: 'narration', text: '新一段故事从这里开始。\n\n' + '雨声敲打着窗沿，她慢慢讲起那天发生的事情。\n\n'.repeat(24) },
    { type: 'counterpart', text: '她终于停下来。“这就是全部经过。”' },
  ] }
  for (const viewport of [{ width: 360, height: 640 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport)
    for (const regenerate of [false, true]) {
      const nextIndex = Math.max(...sessionDetail.messages.map((message) => message.messageIndex)) + (regenerate ? 0 : 1)
      if (regenerate) await page.getByTestId('roleplay-regenerate-last').click()
      else {
        await page.getByRole('textbox', { name: '我的台词' }).fill('从头慢慢讲给我听。')
        await page.getByTestId('roleplay-composer-send').click()
      }
      const reply = page.getByTestId(`roleplay-message-${nextIndex}`)
      await expect(reply).toContainText('新一段故事从这里开始。')
      await expect(page.getByTestId('roleplay-pending-reply')).toHaveCount(0)
      await expect.poll(() => reply.evaluate((element) => {
        const list = element.closest('[data-testid="roleplay-message-list"]')!
        return Math.abs(element.getBoundingClientRect().top - list.getBoundingClientRect().top - parseFloat(getComputedStyle(list).paddingTop))
      })).toBeLessThan(2)
      expect(await messageList.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeGreaterThan(300)
      await expect(page.getByTestId('roleplay-composer-send')).toBeInViewport()
    }
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`roleplay-new-reply-start-${viewport.width}.png`) })
  }
  await page.setViewportSize({ width: 360, height: 640 })

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
    roleplayTurn: expect.objectContaining({ dialogue: '别再试探了，现在就把真相说清楚。', maxCharacters: 500 }),
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

  await openMobileChapterDrawer(page)
  const card = page.getByTestId('timeline-node-roleplay-node-1')
  await card.scrollIntoViewIfNeeded()
  const box = await card.boundingBox()
  if (!box) throw new Error('RP card not visible')
  const cdp = await page.context().newCDPSession(page)
  const x = box.x + box.width * 0.8
  const y = box.y + 30
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
  for (let step = 1; step <= 5; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - step * 20, y, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '删除 角色扮演会话 节点 RP-01' }).click()
  await expect(page.getByTestId('workspace-chapter-body-view')).toBeVisible()
  await expect(page).toHaveURL(/selectionKind=chapter/)
  await expect(page.getByTestId('workspace-roleplay-session-view')).toHaveCount(0)
  await page.reload({ waitUntil: 'networkidle' })
  await openMobileChapterDrawer(page)
  await expect(page.getByTestId('timeline-node-roleplay-node-1')).toHaveCount(0)
  expect(pageErrors).toEqual([])
})
