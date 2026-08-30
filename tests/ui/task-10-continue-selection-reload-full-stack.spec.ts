import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const evidenceDirectory = path.join(process.cwd(), '.sisyphus/evidence/full-project-refactor')
const fixturePath = path.join(process.cwd(), 'scripts/fixtures/workspace-import-smoke.txt')

async function importWorkspaceFixture(page: Page) {
  await page.goto('/library', { waitUntil: 'networkidle' })
  await expect(page.getByRole('button', { name: '导入小说' })).toBeVisible()

  const importResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/import-txt') && response.request().method() === 'POST'
  )

  await page.locator('input[type=file]').setInputFiles(fixturePath)
  const importResponse = await importResponsePromise
  expect(importResponse.ok()).toBeTruthy()
  const imported = await importResponse.json() as { novelId: string; chapterId: string }

  await page.waitForLoadState('networkidle')
  if (!/\/workspace$/.test(page.url())) {
    await page.goto('/workspace', { waitUntil: 'networkidle' })
  }
  return imported
}

test('real continue-block branch selections survive reload after child creation and regenerate-in-place', async ({ page }) => {
  fs.mkdirSync(evidenceDirectory, { recursive: true })

  const imported = await importWorkspaceFixture(page)
  await expect(page.getByTestId('workspace-chapter-body-view')).toBeVisible()
  const currentBodyText = (await page.getByTestId('workspace-chapter-body-view').innerText()).trim()
  expect(currentBodyText).toBeTruthy()

  const novelResponse = await page.request.get(`/api/novels/${encodeURIComponent(imported.novelId)}`)
  expect(novelResponse.ok()).toBeTruthy()
  const novel = await novelResponse.json() as {
    localChapters: Array<{ id: string; order: number }>
  }
  const chapter = novel.localChapters.find((item) => item.id === imported.chapterId)
  expect(imported.novelId).toBeTruthy()
  expect(chapter).toBeTruthy()

  const rootResponse = await page.request.post('/api/continue-blocks', {
    data: {
      novelId: imported.novelId,
      branchId: `${imported.novelId}:main`,
      sourceChapterNo: chapter?.order,
      selectedText: currentBodyText,
      originalText: currentBodyText,
      generatedText: '全栈根续写版本：他推门而入时，风声比脚步更早一步抵达。',
      userInstruction: '保存真实后端的根续写块',
      titleHint: '全栈根续写',
      subtitleHint: 'Task 10 full-stack root',
    },
  })
  expect(rootResponse.ok()).toBeTruthy()
  const root = await rootResponse.json() as {
    continueBlockId: string
    timelineNodeId: string
  }

  const childResponse = await page.request.post('/api/continue-blocks', {
    data: {
      novelId: imported.novelId,
      branchId: `${imported.novelId}:main`,
      sourceChapterNo: chapter?.order,
      parentTimelineNodeId: root.timelineNodeId,
      selectedText: '全栈根续写版本：他推门而入时，风声比脚步更早一步抵达。',
      originalText: '全栈根续写版本：他推门而入时，风声比脚步更早一步抵达。',
      generatedText: '全栈子续写版本：灯光摇了一下，像有人先在屋里屏住了呼吸。',
      userInstruction: '沿着真实后端的续写块继续生成子节点',
      titleHint: '全栈子续写',
      subtitleHint: 'Task 10 full-stack child',
    },
  })
  expect(childResponse.ok()).toBeTruthy()
  const child = await childResponse.json() as {
    continueBlockId: string
    timelineNodeId: string
  }

  await page.goto(`/workspace?selectionKind=continue_block&selectionNodeId=${child.timelineNodeId}&selectionContinueBlockId=${child.continueBlockId}&selectionAnchorChapterNo=${chapter?.order}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('续写内容')
  await expect(page.getByTestId('workspace-continue-block-view')).toContainText('全栈子续写版本：灯光摇了一下，像有人先在屋里屏住了呼吸。')
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page).toHaveURL(new RegExp(`selectionNodeId=${child.timelineNodeId}`))
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('续写内容')
  await expect(page.getByTestId('workspace-continue-block-view')).toContainText('全栈子续写版本：灯光摇了一下，像有人先在屋里屏住了呼吸。')

  const regenerateResponse = await page.request.put('/api/continue-blocks', {
    data: {
      novelId: imported.novelId,
      branchId: `${imported.novelId}:main`,
      continueBlockId: root.continueBlockId,
      selectedText: currentBodyText,
      originalText: currentBodyText,
      generatedText: '全栈根续写版本（重生）：门轴响动之后，整间屋子的安静都像被重新排列。',
      userInstruction: '在真实后端原位重生当前续写块',
      titleHint: '全栈根续写重生',
      subtitleHint: 'Task 10 full-stack regenerate',
    },
  })
  expect(regenerateResponse.ok()).toBeTruthy()

  await page.goto(`/workspace?selectionKind=rewrite&selectionNodeId=${root.timelineNodeId}&selectionContinueBlockId=${root.continueBlockId}&selectionAnchorChapterNo=${chapter?.order}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('改写分支')
  await expect(page).toHaveURL(new RegExp(`selectionNodeId=${root.timelineNodeId}`))
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page).toHaveURL(new RegExp(`selectionNodeId=${root.timelineNodeId}`))
  await expect(page.getByTestId('workspace-reference-selection-kind')).toHaveText('改写分支')

  await page.screenshot({
    path: path.join(evidenceDirectory, 'task-10-continue-selection-reload.png'),
    fullPage: true,
  })

  fs.writeFileSync(
    path.join(evidenceDirectory, 'task-10-continue-selection-reload.txt'),
    [
      `workspaceUrl=${page.url()}`,
      `rootTimelineNodeId=${root.timelineNodeId}`,
      `childTimelineNodeId=${child.timelineNodeId}`,
      `rootContinueBlockId=${root.continueBlockId}`,
      `childContinueBlockId=${child.continueBlockId}`,
    ].join('\n')
  )
})
