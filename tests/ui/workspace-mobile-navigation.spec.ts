import { expect, test } from '@playwright/test'

test.use({
  viewport: { width: 375, height: 667 },
})

test('mobile workspace header opens mutually exclusive navigation sheets', async ({ page }) => {
  await page.route('**/api/workspace', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, updatedAt: '2026-07-27T00:00:00.000Z' }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        currentNovelId: 'novel-mobile',
        currentChapterId: 'chapter-mobile',
        localNovels: [{ id: 'novel-mobile', title: 'Mobile Fixture', summary: '', tags: [] }],
        localVolumes: [{ id: 'volume-mobile', novelId: 'novel-mobile', title: '第一卷', order: 1 }],
        localChapters: [{
          id: 'chapter-mobile',
          novelId: 'novel-mobile',
          volumeId: 'volume-mobile',
          title: '移动端章节',
          order: 1,
          content: '<p>用于移动端工作区验收的章节正文。</p>',
          status: 'draft',
          wordCount: 16,
          updatedAt: '2026-07-27',
        }],
      }),
    })
  })

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
  const editor = page.locator('[contenteditable="true"]').first()
  await expect(header).toBeVisible()
  await expect(editor).toBeVisible()
  const headerBox = await header.boundingBox()
  expect(headerBox).not.toBeNull()
  expect(headerBox!.x + headerBox!.width).toBeLessThanOrEqual(375)

  for (const name of ['返回书库', '打开章节导航', '打开故事上下文', '打开知识状态', '更多选项']) {
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

  await page.getByRole('button', { name: '打开知识状态' }).click()
  await expect(page.getByRole('dialog', { name: '知识状态' })).toBeVisible()
  await expect(page.getByTestId('workspace-reference-panel')).toHaveCount(0)
  await page.getByRole('button', { name: '关闭知识状态' }).click()

  await page.getByRole('button', { name: '更多选项' }).click()
  await expect(page.getByRole('dialog', { name: '工作区选项' })).toBeVisible()
})
