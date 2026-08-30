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
  await expect(page.getByTestId('workspace-chapter-body-view')).toContainText('最终保存版本-3')

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
