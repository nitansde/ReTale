import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const fixturePath = path.join(process.cwd(), 'scripts/fixtures/workspace-import-smoke.txt')
const evidenceDirectory = path.join(process.cwd(), 'tests/artifacts/evidence/full-project-refactor')

async function importWorkspaceFixture(page: Page) {
  await page.goto('/library', { waitUntil: 'networkidle' })
  await expect(page.getByRole('button', { name: '导入小说' })).toBeVisible()

  const importResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/import-txt') && response.request().method() === 'POST'
  )

  await page.locator('input[type=file]').setInputFiles(fixturePath)
  const importResponse = await importResponsePromise
  expect(importResponse.ok()).toBeTruthy()

  // The library pushes to /workspace itself once the novel is loaded into the store.
  // Navigating here instead of waiting aborts that load and rehydrates the previously
  // persisted novel, so wait for the app's own navigation.
  await page.waitForURL(/\/workspace/)
  await page.waitForLoadState('networkidle')
}

test('workspace autosave limits save churn after a single edit', async ({ page }) => {
  fs.mkdirSync(evidenceDirectory, { recursive: true })

  const workspaceSaveTimestamps: string[] = []
  page.on('response', (response) => {
    const method = response.request().method()
    const pathname = new URL(response.url()).pathname
    if (
      ((method === 'PATCH' && pathname.startsWith('/api/chapters/'))
        || (method === 'POST' && pathname.startsWith('/api/novels/')))
      && response.ok()
    ) {
      workspaceSaveTimestamps.push(new Date().toISOString())
    }
  })

  await importWorkspaceFixture(page)
  await expect(page.getByTestId('workspace-chapter-body-view')).toBeVisible()

  const baselineSaveCount = workspaceSaveTimestamps.length
  const editor = page.getByTestId('workspace-chapter-reader').first()
  await page.getByTestId('workspace-reader-edit-toggle').click()
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' UX流畅度验收')
  await expect(page.getByTestId('workspace-chapter-body-view')).toContainText('UX流畅度验收')

  await page.waitForTimeout(6500)

  const savesTriggeredByEdit = workspaceSaveTimestamps.length - baselineSaveCount
  expect(savesTriggeredByEdit).toBeGreaterThanOrEqual(1)
  expect(savesTriggeredByEdit).toBeLessThanOrEqual(2)
  await expect(page.locator('body')).not.toContainText('Refusing to overwrite a recoverable workspace with an empty payload')

  await page.screenshot({
    path: path.join(evidenceDirectory, 'task-6-autosave-churn.png'),
    fullPage: true,
  })

  fs.writeFileSync(
    path.join(evidenceDirectory, 'task-6-autosave-churn.txt'),
    [
      `workspaceUrl=${page.url()}`,
      `baselineSaveCount=${baselineSaveCount}`,
      `savesTriggeredByEdit=${savesTriggeredByEdit}`,
      `saveTimestamps=${workspaceSaveTimestamps.join(',')}`,
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
  await page.getByTestId('preset-compat-library-open').evaluate((node) => {
    ;(node as HTMLButtonElement).click()
  })
  await expect(page.getByTestId('preset-compat-library-modal')).toBeVisible()

  const presetImportResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/settings/preset-compat/import') && response.request().method() === 'POST'
  )
  await page.getByTestId('preset-compat-preset-import-input').setInputFiles(
    path.join(process.cwd(), 'tests/fixtures/preset-compat/synthetic-sillytavern-preset.json')
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
