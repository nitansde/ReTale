import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, type Page } from '@playwright/test'

const evidenceDirectory = path.join(process.cwd(), '.sisyphus/evidence/full-project-refactor')
const fixturePath = path.join(process.cwd(), 'scripts/fixtures/workspace-import-smoke.txt')

function resolveTestDatabasePath() {
  const dbPath = process.env.PLAYWRIGHT_TEST_DB_PATH
  if (!dbPath) {
    throw new Error('PLAYWRIGHT_TEST_DB_PATH is required for task-4 normalized runtime QA')
  }

  return dbPath
}

async function blankWorkspaceArtifactPayload() {
  let lastError: unknown = null

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const database = new DatabaseSync(resolveTestDatabasePath())
    try {
      database.exec('PRAGMA busy_timeout = 5000')
      database.prepare('UPDATE WorkspaceState SET payload = NULL WHERE id = ?').run('singleton')
      const payload = database.prepare('SELECT payload FROM WorkspaceState WHERE id = ?').get('singleton') as { payload: string | null } | undefined
      const runtimeChapters = database.prepare('SELECT COUNT(*) AS count FROM WorkspaceRuntimeChapter WHERE workspaceStateId = ?').get('singleton') as { count: number }

      return {
        artifactPayload: payload?.payload ?? null,
        runtimeChapterCount: runtimeChapters.count,
      }
    } catch (error) {
      lastError = error
      if (!(error instanceof Error) || !/database is locked/i.test(error.message) || attempt === 7) {
        throw error
      }
    } finally {
      database.close()
    }

    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to blank workspace artifact payload')
}

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

async function replaceEditorText(page: Page, text: string) {
  const editor = page.locator('[contenteditable="true"]').first()
  await editor.click()
  await page.keyboard.press('Meta+A')
  await page.keyboard.type(text)
  await expect(page.getByTestId('workspace-chapter-body-view')).toContainText(text)
}

test('workspace reload uses normalized runtime state after the legacy blob is blanked', async ({ page }) => {
  fs.mkdirSync(evidenceDirectory, { recursive: true })

  await importWorkspaceFixture(page)
  await expect(page.getByText('章节导航')).toBeVisible()
  await expect(page.getByTestId('workspace-chapter-body-view')).toBeVisible()

  const editedText = 'Task4 归一化运行时验证：清空旧 blob 后依然可见。'
  const saveResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/workspace') && response.request().method() === 'POST' && response.ok()
  )

  await replaceEditorText(page, editedText)
  const saveResponse = await saveResponsePromise
  expect(saveResponse.ok()).toBeTruthy()

  const databaseState = await blankWorkspaceArtifactPayload()

  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByTestId('workspace-chapter-body-view')).toContainText(editedText)

  await page.screenshot({
    path: path.join(evidenceDirectory, 'task-4-normalized-runtime.png'),
    fullPage: true,
  })

  fs.writeFileSync(
    path.join(evidenceDirectory, 'task-4-normalized-runtime.txt'),
    [
      `workspaceUrl=${page.url()}`,
      `databasePath=${resolveTestDatabasePath()}`,
      `artifactPayload=${JSON.stringify(databaseState.artifactPayload)}`,
      `runtimeChapterCount=${databaseState.runtimeChapterCount}`,
      `reloadedEditedTextVisible=${(await page.locator('body').innerText()).includes(editedText)}`,
    ].join('\n')
  )
})
