import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const evidenceDirectory = path.join(process.cwd(), '.sisyphus/evidence/full-project-refactor')
const fixturePath = path.join(process.cwd(), 'scripts/fixtures/workspace-import-smoke.txt')

test('task 2 full-stack library to workspace baseline and task page snapshot', async ({ page }) => {
  fs.mkdirSync(evidenceDirectory, { recursive: true })

  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(page).toHaveURL(/127\.0\.0\.1:3000\/library/)

  await page.screenshot({
    path: path.join(evidenceDirectory, 'task-2-library-page-baseline.png'),
    fullPage: true,
  })

  await expect(page.getByRole('button', { name: '导入小说' })).toBeVisible()

  const importResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/import-txt') && response.request().method() === 'POST'
  )

  await page.locator('input[type=file]').setInputFiles(fixturePath)
  const importResponse = await importResponsePromise
  expect(importResponse.ok()).toBeTruthy()

  await page.waitForLoadState('networkidle')
  if (!/\/workspace$/.test(page.url())) {
    await page.goto('/workspace', { waitUntil: 'networkidle' })
  }

  await expect(page.getByText('章节导航')).toBeVisible()
  await expect(page.getByText('第1章 初入现场')).toBeVisible()

  const workspaceText = await page.locator('body').innerText()
  await page.screenshot({
    path: path.join(evidenceDirectory, 'task-2-library-workspace-baseline.png'),
    fullPage: true,
  })

  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByText('章节导航')).toBeVisible()
  await expect(page.getByText('第1章 初入现场')).toBeVisible()

  const reloadedWorkspaceText = await page.locator('body').innerText()
  await page.screenshot({
    path: path.join(evidenceDirectory, 'task-2-workspace-reload-baseline.png'),
    fullPage: true,
  })

  await page.goto('/task', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { level: 1, name: /Tasks|任务/, exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: /No active tasks|当前没有活跃任务/ })).toBeVisible()

  const taskPageText = await page.locator('body').innerText()
  await page.screenshot({
    path: path.join(evidenceDirectory, 'task-2-task-page-baseline.png'),
    fullPage: true,
  })

  fs.writeFileSync(
    path.join(evidenceDirectory, 'task-2-feature-inventory.txt'),
    [
      `workspaceUrl=${page.url()}`,
      `importStatus=${importResponse.status()}`,
      `workspaceHasChapterNav=${workspaceText.includes('章节导航')}`,
      `workspaceHasChapterOne=${workspaceText.includes('第1章 初入现场')}`,
      `workspaceReloadHasChapterNav=${reloadedWorkspaceText.includes('章节导航')}`,
      `workspaceReloadHasChapterOne=${reloadedWorkspaceText.includes('第1章 初入现场')}`,
      `taskPageHasHeading=${taskPageText.includes('Tasks') || taskPageText.includes('任务')}`,
      `taskPageHasNoActiveTasks=${taskPageText.includes('No active tasks') || taskPageText.includes('当前没有活跃任务')}`,
    ].join('\n')
  )
})
