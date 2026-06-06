import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const fixturePath = path.join(process.cwd(), 'scripts/fixtures/workspace-import-smoke.txt')
const evidenceDirectory = path.join(process.cwd(), '.sisyphus/evidence/full-project-refactor')

async function importWorkspaceFixture(page: Page) {
  await page.goto('/library', { waitUntil: 'networkidle' })
  await expect(page.getByText('导入 TXT 小说')).toBeVisible()

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
}

test('workspace autosave limits save churn after a single edit', async ({ page }) => {
  fs.mkdirSync(evidenceDirectory, { recursive: true })

  const workspacePostTimestamps: string[] = []
  page.on('requestfinished', async (request) => {
    if (request.method() !== 'POST' || !request.url().includes('/api/workspace')) return
    const response = await request.response()
    if (response?.ok()) {
      workspacePostTimestamps.push(new Date().toISOString())
    }
  })

  await importWorkspaceFixture(page)
  await expect(page.getByTestId('workspace-chapter-body-view')).toBeVisible()

  const baselinePostCount = workspacePostTimestamps.length
  const editor = page.locator('[contenteditable="true"]').first()
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' UX流畅度验收')
  await expect(page.getByTestId('workspace-chapter-body-view')).toContainText('UX流畅度验收')

  await page.waitForTimeout(6500)

  const postsTriggeredByEdit = workspacePostTimestamps.length - baselinePostCount
  expect(postsTriggeredByEdit).toBeGreaterThanOrEqual(1)
  expect(postsTriggeredByEdit).toBeLessThanOrEqual(2)
  await expect(page.locator('body')).not.toContainText('Refusing to overwrite a recoverable workspace with an empty payload')

  await page.screenshot({
    path: path.join(evidenceDirectory, 'task-6-autosave-churn.png'),
    fullPage: true,
  })

  fs.writeFileSync(
    path.join(evidenceDirectory, 'task-6-autosave-churn.txt'),
    [
      `workspaceUrl=${page.url()}`,
      `baselinePostCount=${baselinePostCount}`,
      `postsTriggeredByEdit=${postsTriggeredByEdit}`,
      `postTimestamps=${workspacePostTimestamps.join(',')}`,
    ].join('\n')
  )
})

test('preset compat modal keeps internal error keys out of user-facing copy', async ({ page }) => {
  fs.mkdirSync(evidenceDirectory, { recursive: true })

  await page.route('**/api/settings/preset-compat', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'preset_not_found' }),
      })
      return
    }

    await route.continue()
  })

  await importWorkspaceFixture(page)
  await page.getByTestId('preset-compat-library-open').click()
  await expect(page.getByTestId('preset-compat-library-modal')).toBeVisible()

  const presetImportResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/settings/preset-compat/import') && response.request().method() === 'POST'
  )
  await page.getByTestId('preset-compat-preset-import-input').setInputFiles(
    path.join(process.cwd(), 'external/resets_example.json')
  )
  const presetImportResponse = await presetImportResponsePromise
  expect(presetImportResponse.ok()).toBeTruthy()

  await page.locator('[data-testid^="preset-compat-preset-delete-"]').first().click()

  const modal = page.getByTestId('preset-compat-library-modal')
  await expect(modal).toContainText('找不到对应的预设')

  const modalText = await modal.innerText()
  expect(modalText.includes('preset_not_found')).toBeFalsy()
  expect(modalText.includes('standalone_regex_not_found')).toBeFalsy()

  await page.screenshot({
    path: path.join(evidenceDirectory, 'task-6-error-copy.png'),
    fullPage: true,
  })
})
