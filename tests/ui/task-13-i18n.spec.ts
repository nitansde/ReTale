import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const evidenceDirectory = path.join(process.cwd(), '.sisyphus/evidence/full-project-refactor')
const fixturePath = path.join(process.cwd(), 'scripts/fixtures/workspace-import-smoke.txt')

test('task 13 defaults to zh and persists en across reload and navigation', async ({ page }) => {
  fs.mkdirSync(evidenceDirectory, { recursive: true })

  await page.goto('/library', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: '书库' })).toBeVisible()
  await expect(page.getByTestId('app-language-switcher')).toHaveCount(1)
  await expect(page.getByText('导入 TXT 小说')).toBeVisible()
  await expect(page.getByTestId('app-language-option-zh')).toHaveAttribute('aria-pressed', 'true')

  await page.screenshot({
    path: path.join(evidenceDirectory, 'task-13-zh-default.png'),
    fullPage: true,
  })

  await page.getByTestId('app-language-option-en').click()
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
  await expect(page.getByText('Import TXT Novel')).toBeVisible()
  await expect(page.getByTestId('app-language-option-en')).toHaveAttribute('aria-pressed', 'true')

  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
  await expect(page.getByText('Import TXT Novel')).toBeVisible()

  await page.goto('/task', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible()
  await expect(page.getByTestId('app-language-switcher')).toHaveCount(0)

  await page.goto('/library', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('app-language-switcher')).toHaveCount(1)
  await expect(page.getByTestId('app-language-option-en')).toHaveAttribute('aria-pressed', 'true')
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

  await expect(page.getByRole('heading', { name: 'Chapters', exact: true })).toBeVisible()
  await expect(page.getByTestId('workspace-current-word-count')).toContainText('words')
  await expect(page.getByTestId('app-language-switcher')).toHaveCount(0)

  await page.screenshot({
    path: path.join(evidenceDirectory, 'task-13-en-switch.png'),
    fullPage: true,
  })
})
