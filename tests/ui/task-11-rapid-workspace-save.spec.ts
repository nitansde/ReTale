import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const evidenceDirectory = path.join(process.cwd(), 'tests/artifacts/evidence/full-project-refactor')
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

  // The library pushes to /workspace itself once the novel is loaded into the store.
  // Navigating here instead of waiting aborts that load and rehydrates the previously
  // persisted novel, so wait for the app's own navigation.
  await page.waitForURL(/\/workspace/)
  await page.waitForLoadState('networkidle')
}

async function replaceEditorText(page: Page, text: string) {
  const editor = page.getByTestId('workspace-chapter-reader').first()
  if (await editor.getAttribute('contenteditable') !== 'true') await page.getByTestId('workspace-reader-edit-toggle').click()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(text)
  await expect(editor).toHaveText(text)
}

async function saveWorkspaceEdit(page: Page, text: string) {
  const saveResponsePromise = page.waitForResponse((response) => {
    const method = response.request().method()
    const pathname = new URL(response.url()).pathname
    return ((method === 'PATCH' && pathname.startsWith('/api/chapters/'))
      || (method === 'POST' && pathname.startsWith('/api/novels/')))
      && response.ok()
  })

  await replaceEditorText(page, text)
  return saveResponsePromise
}

test('rapid workspace saves persist the latest chapter content after reload', async ({ page }) => {
  fs.mkdirSync(evidenceDirectory, { recursive: true })

  await importWorkspaceFixture(page)
  await expect(page.getByText('章节导航')).toBeVisible()
  await expect(page.getByTestId('workspace-chapter-body-view')).toBeVisible()

  const versions = ['最终保存版本-1', '最终保存版本-2', '最终保存版本-3']
  const saveStatuses: number[] = []
  const saveMethods: string[] = []

  for (const version of versions) {
    const saveResponse = await saveWorkspaceEdit(page, version)
    saveStatuses.push(saveResponse.status())
    saveMethods.push(saveResponse.request().method())
  }

  expect(saveMethods).toEqual(versions.map(() => 'PATCH'))

  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByTestId('workspace-chapter-reader').first()).toHaveText('最终保存版本-3')

  await page.screenshot({
    path: path.join(evidenceDirectory, 'task-11-rapid-save.png'),
    fullPage: true,
  })

  fs.writeFileSync(
    path.join(evidenceDirectory, 'task-11-rapid-save.txt'),
    [
      `workspaceUrl=${page.url()}`,
      `saveStatuses=${saveStatuses.join(',')}`,
      `saveMethods=${saveMethods.join(',')}`,
      `reloadedHasLatest=${(await page.locator('body').innerText()).includes('最终保存版本-3')}`,
    ].join('\n')
  )
})
