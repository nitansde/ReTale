import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'

const fixturePath = path.join(process.cwd(), 'scripts/fixtures/workspace-import-smoke.txt')
const evidenceDirectory = path.join(process.cwd(), '.sisyphus/evidence/task-15-branch-ux-playwright-harness')

test('future-jump harness smoke', async ({ page }) => {
  fs.mkdirSync(evidenceDirectory, { recursive: true })

  await page.goto('/library', { waitUntil: 'networkidle' })
  await expect(page.getByText('导入 TXT 小说')).toBeVisible()
  await expect(page).toHaveURL(/127\.0\.0\.1:3000\/library/)

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

  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByText('章节导航')).toBeVisible()
  await expect(page.getByText('第1章 初入现场')).toBeVisible()

  const pageText = await page.locator('body').innerText()
  expect(pageText.includes('正在恢复工作区')).toBeFalsy()

  await page.screenshot({
    path: path.join(evidenceDirectory, 'future-jump-harness-smoke.png'),
    fullPage: true,
  })

  fs.writeFileSync(
    path.join(evidenceDirectory, 'future-jump-harness-smoke.txt'),
    [`url=${page.url()}`, `hasChapterNav=${pageText.includes('章节导航')}`, `hasChapterOne=${pageText.includes('第1章 初入现场')}`].join('\n')
  )
})
