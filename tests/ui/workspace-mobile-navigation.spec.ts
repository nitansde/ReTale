import { expect, test } from '@playwright/test'
import { mockNovelResourceApi } from '@/tests/helpers/novel-resource-api-mock'

test.use({
  viewport: { width: 390, height: 844 },
})

test('mobile workspace header opens mutually exclusive navigation sheets', async ({ page }) => {
  const workspacePayload = {
    currentNovelId: 'novel-mobile',
    currentChapterId: 'chapter-mobile',
    localNovels: [{ id: 'novel-mobile', title: 'Mobile Fixture', summary: '', tags: [] }],
    localChapters: [{
      id: 'chapter-mobile',
      novelId: 'novel-mobile',
      title: '移动端章节',
      order: 1,
      content: '<p>用于移动端工作区验收的章节正文。</p>',
      status: 'draft',
      wordCount: 16,
      updatedAt: '2026-07-27',
    }],
  }
  await mockNovelResourceApi(page, () => workspacePayload)

  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        novelId: 'novel-mobile',
        branchId: 'novel-mobile:main',
        chapters: [{ type: 'chapter', chapterNo: 1, chapterId: 'chapter-mobile', title: '移动端章节', wordCount: 16 }],
        branchNodes: [],
        edges: [],
      }),
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
        hanlpCacheSnapshot: null,
        knowledgeStatusOverview: null,
      }),
    })
  })

  await page.goto('/workspace', { waitUntil: 'networkidle' })

  const header = page.getByTestId('workspace-mobile-header')
  const editor = page.getByTestId('workspace-chapter-reader').first()
  await expect(header).toBeVisible()
  await expect(editor).toBeVisible()
  const headerBox = await header.boundingBox()
  expect(headerBox).not.toBeNull()
  expect(headerBox!.x + headerBox!.width).toBeLessThanOrEqual(375)

  for (const name of ['返回书库', '打开章节导航', '打开故事上下文', '更多选项']) {
    const control = page.getByRole(name === '返回书库' ? 'link' : 'button', { name, exact: true })
    const box = await control.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }

  await page.getByRole('button', { name: '打开章节导航' }).click()
  const chapterDialog = page.getByRole('dialog', { name: '章节导航' })
  const chapterBackdrop = chapterDialog.locator('xpath=..')
  const editorHtml = await editor.innerHTML()
  await expect(chapterDialog).toBeVisible()
  await expect(page.getByTestId('workspace-chapter-nav')).toHaveCount(1)
  await chapterBackdrop.dispatchEvent('mousedown')
  await expect(chapterDialog).toBeVisible()
  await chapterBackdrop.dispatchEvent('mouseup')
  await expect(chapterDialog).toBeVisible()

  const backdropBox = await chapterBackdrop.boundingBox()
  expect(backdropBox).not.toBeNull()
  await chapterBackdrop.click({
    position: { x: backdropBox!.width - 4, y: backdropBox!.height / 2 },
  })
  await expect(chapterDialog).toHaveCount(0)
  await expect(editor).not.toBeFocused()
  expect(await editor.innerHTML()).toBe(editorHtml)

  await page.getByRole('button', { name: '打开故事上下文' }).click()
  await expect(page.getByRole('dialog', { name: '故事上下文' })).toBeVisible()
  await expect(page.getByTestId('workspace-reference-panel')).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: '知识状态' })).toHaveCount(0)
  await page.getByRole('button', { name: '关闭故事上下文' }).click()

  await page.getByRole('button', { name: '更多选项' }).click()
  await expect(page.getByRole('dialog', { name: '工作区选项' })).toBeVisible()
  {
    const optionsDialog = page.getByRole('dialog', { name: '工作区选项' })
    await page.getByRole('button', { name: '打开知识状态' }).click()
    await expect(optionsDialog).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: '知识状态' })).toBeVisible()
    await expect(page.getByTestId('workspace-reference-panel')).toHaveCount(0)
  }
  await page.getByRole('button', { name: '关闭知识状态' }).click()

  await page.getByRole('button', { name: '更多选项' }).click()
  await expect(page.getByRole('dialog', { name: '工作区选项' })).toBeVisible()
})

test('mobile knowledge sheet presents one phase-local progressbar and durable terminal coverage', async ({ page }) => {
  let activeRefresh = true
  const workspacePayload = {
    currentNovelId: 'novel-knowledge-mobile',
    currentChapterId: 'chapter-knowledge-mobile',
    localNovels: [{ id: 'novel-knowledge-mobile', title: 'Knowledge Mobile Fixture', summary: '', tags: [] }],
    localChapters: [{
      id: 'chapter-knowledge-mobile',
      novelId: 'novel-knowledge-mobile',
      title: '知识状态移动验收',
      order: 1,
      content: '<p>用于验证移动知识状态展示的章节正文。</p>',
      status: 'draft',
      wordCount: 18,
      updatedAt: '2026-07-27',
    }],
  }
  await mockNovelResourceApi(page, () => workspacePayload)

  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        novelId: 'novel-knowledge-mobile',
        branchId: 'novel-knowledge-mobile:main',
        chapters: [{ type: 'chapter', chapterNo: 1, chapterId: 'chapter-knowledge-mobile', title: '知识状态移动验收', wordCount: 18 }],
        branchNodes: [],
        edges: [],
      }),
    })
  })

  await page.route('**/api/knowledge-view*', async (route) => {
    const retrievalTask = {
      jobId: 'mobile-retrieval-refresh',
      novelId: 'novel-knowledge-mobile',
      jobType: 'rebuild_retrieval_index',
      status: activeRefresh ? 'running' : 'completed',
      progress: activeRefresh ? 0.95 : 1,
      currentStep: 'global backend phase 95%',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:01:00.000Z',
      etaMinutes: activeRefresh ? 2 : null,
      chapterRange: activeRefresh ? { startChapter: 1, endChapter: 12 } : { startChapter: 4, endChapter: 9 },
      steps: activeRefresh
        ? [
            { key: 'raw-embedding', label: 'Raw embedding', status: 'running', progress: 0.5, etaMinutes: 2, detail: 'provider raw phase 50%' },
            { key: 'index', label: 'Lance index', status: 'pending', progress: 0, etaMinutes: null, detail: null },
          ]
        : [
            { key: 'raw-embedding', label: 'Raw embedding', status: 'completed', progress: 1, etaMinutes: null, detail: 'provider raw phase complete' },
            { key: 'index', label: 'Lance index', status: 'completed', progress: 1, etaMinutes: null, detail: 'provider index complete' },
          ],
      rawTextEmbeddingProgress: activeRefresh ? 0.5 : 1,
      rawTextEmbeddingCacheHitRate: 0.25,
      embeddingSettingsSnapshot: { provider: 'ollama', model: 'qwen3-embedding:4b', embeddingBatchSize: 32 },
    }
    const knowledgeStatusOverview = activeRefresh
      ? {
          knowledgeGraph: { status: 'full', coveredChapterCount: 12, totalChapterCount: 12, validThroughChapterNo: 12 },
          extractionCache: { status: 'full', coveredChapterCount: 12, totalChapterCount: 12, validThroughChapterNo: 12 },
          embeddingCache: { status: 'partial', coveredChapterCount: 6, totalChapterCount: 12, validThroughChapterNo: 6, provider: 'ollama', model: 'qwen3-embedding:4b' },
          retrievalIndex: { status: 'partial', indexedScopeCount: 7, chapterRange: { startChapter: 1, endChapter: 7 }, task: retrievalTask },
        }
      : {
          knowledgeGraph: { status: 'partial', coveredChapterCount: 8, totalChapterCount: 12, validThroughChapterNo: 5 },
          extractionCache: { status: 'partial', coveredChapterCount: 8, totalChapterCount: 12, validThroughChapterNo: 5 },
          embeddingCache: { status: 'partial', coveredChapterCount: 8, totalChapterCount: 12, validThroughChapterNo: 5, provider: 'ollama', model: 'qwen3-embedding:4b' },
          retrievalIndex: { status: 'partial', indexedScopeCount: 6, chapterRange: { startChapter: 4, endChapter: 9 }, task: retrievalTask },
        }

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
        knowledgeRebuildStatus: retrievalTask,
        hanlpCacheSnapshot: null,
        knowledgeStatusOverview,
        jobOutcome: activeRefresh ? 'running' : 'completed',
        actionError: null,
      }),
    })
  })

  await page.goto('/workspace', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '更多选项' }).click()
  await page.getByRole('button', { name: '打开知识状态' }).click()

  const knowledgeDialog = page.getByRole('dialog', { name: '知识状态' })
  const summary = page.getByTestId('workspace-knowledge-status')
  await expect(knowledgeDialog).toBeVisible()
  await expect(summary).toContainText('全部 12 章')
  await expect(summary).toContainText('至第 7 章')
  await expect(summary).toContainText('50%')
  await expect(summary).not.toContainText('95%')
  await expect(summary).not.toContainText(/HanLP|LLM|Embedding|LanceDB|Ollama|qwen3|provider raw|global backend/i)
  await expect(page.getByTestId('workspace-knowledge-advanced-details')).toHaveCount(0)

  const activeProgress = page.getByRole('progressbar', { name: '内容检索当前阶段进度' })
  await expect(activeProgress).toHaveCount(1)
  await expect(activeProgress).toHaveAttribute('aria-valuemin', '0')
  await expect(activeProgress).toHaveAttribute('aria-valuemax', '100')
  await expect(activeProgress).toHaveAttribute('aria-valuenow', '50')
  await expect(page.getByRole('progressbar')).toHaveCount(1)

  for (const control of [
    page.getByRole('button', { name: '关闭知识状态' }),
    page.getByRole('button', { name: '高级详情' }),
  ]) {
    const box = await control.boundingBox()
    expect(box).not.toBeNull()
    expect(Math.round(box!.width)).toBeGreaterThanOrEqual(44)
    expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44)
  }

  const collapsedOverflow = await knowledgeDialog.evaluate((dialog) => ({
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    sheetClientWidth: dialog.clientWidth,
    sheetScrollWidth: dialog.scrollWidth,
  }))
  expect(collapsedOverflow.documentScrollWidth).toBeLessThanOrEqual(collapsedOverflow.documentClientWidth)
  expect(collapsedOverflow.sheetScrollWidth).toBeLessThanOrEqual(collapsedOverflow.sheetClientWidth)

  await page.getByRole('button', { name: '高级详情' }).click()
  const advanced = page.getByTestId('workspace-knowledge-advanced-details')
  await expect(advanced).toBeVisible()
  await expect(advanced).toContainText('Ollama · qwen3-embedding:4b · batch 32')
  await expect(page.getByRole('progressbar')).toHaveCount(1)

  const expandedOverflow = await knowledgeDialog.evaluate((dialog) => ({
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    sheetClientWidth: dialog.clientWidth,
    sheetScrollWidth: dialog.scrollWidth,
    sheetClientHeight: dialog.clientHeight,
    sheetScrollHeight: dialog.scrollHeight,
  }))
  expect(expandedOverflow.documentScrollWidth).toBeLessThanOrEqual(expandedOverflow.documentClientWidth)
  expect(expandedOverflow.sheetScrollWidth).toBeLessThanOrEqual(expandedOverflow.sheetClientWidth)
  expect(expandedOverflow.sheetScrollHeight).toBeGreaterThan(expandedOverflow.sheetClientHeight)
  await knowledgeDialog.evaluate((dialog) => { dialog.scrollTop = dialog.scrollHeight })
  await expect.poll(() => knowledgeDialog.evaluate((dialog) => dialog.scrollTop)).toBeGreaterThan(0)

  activeRefresh = false
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '更多选项' }).click()
  await page.getByRole('button', { name: '打开知识状态' }).click()

  const terminalSummary = page.getByTestId('workspace-knowledge-status')
  await expect(terminalSummary).toContainText('至第 5 章')
  await expect(terminalSummary).toContainText('第 4–9 章')
  await expect(terminalSummary).not.toContainText(/HanLP|LLM|Embedding|LanceDB|Ollama|qwen3|provider raw|global backend/i)
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await page.getByRole('button', { name: '高级详情' }).click()
  await expect(page.getByTestId('workspace-knowledge-advanced-details')).toContainText('Ollama · qwen3-embedding:4b')
  await expect(page.getByRole('progressbar')).toHaveCount(0)
})
