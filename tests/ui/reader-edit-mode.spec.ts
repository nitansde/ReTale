import path from 'node:path'
import { expect, test } from '@playwright/test'
import { normalizeAISettings } from '@/lib/ai-settings'

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`main reader requires explicit edit mode at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    // Selection actions require a configured writing model even in read-only mode.
    await page.route('**/api/settings/ai', (route) => route.fulfill({
      json: normalizeAISettings({
        rewrite: {
          provider: 'openai-compatible',
          openAICompatible: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' },
        },
      }),
    }))
    await page.goto('/library', { waitUntil: 'networkidle' })
    await page.getByTestId('app-language-option-en').click()
    await page.locator('input[type=file]').setInputFiles(path.join(process.cwd(), 'scripts/fixtures/workspace-import-smoke.txt'))
    await page.waitForURL(/\/workspace/)
    const reader = page.getByTestId('workspace-chapter-reader')
    const toggle = page.getByTestId('workspace-reader-edit-toggle')
    await expect(reader).toBeVisible()
    await expect(reader).toHaveAttribute('contenteditable', 'false')
    await expect(toggle).toHaveText('Edit text')
    const originalHtml = await reader.innerHTML()
    await reader.click()
    await page.keyboard.type('This must not change the chapter')
    expect(await reader.innerHTML()).toBe(originalHtml)

    // Reading mode still supports selecting text for rewrite and roleplay.
    await reader.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element.querySelector('p')!)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    await expect(page.getByTestId('workspace-chapter-actions').getByRole('button').first()).toBeEnabled()
    await expect(reader).toHaveAttribute('contenteditable', 'false')

    // Even after selecting near the end, editing puts the caret at the visible start.
    await reader.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element.querySelector('p:last-child')!)
      range.collapse(false)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    await toggle.click()
    await expect(reader).toHaveAttribute('contenteditable', 'true')
    await expect(toggle).toHaveText('Done editing')
    await expect(reader).toBeFocused()
    expect(await reader.evaluate((element) => {
      const selection = window.getSelection()!
      return selection.isCollapsed && selection.anchorOffset === 0
        && selection.anchorNode === element.querySelector('p')?.firstChild
    })).toBe(true)
    await expect(reader.locator('p').first()).toBeInViewport({ ratio: 1 })
    await reader.click()
    await page.keyboard.press('ControlOrMeta+A')
    const editedText = `Saved through explicit editing at ${viewport.width}px. 中文正文。`
    await page.keyboard.insertText(editedText)
    await expect(reader).toHaveText(editedText)
    await toggle.click()
    await expect(toggle).toHaveText('Edit text')
    await expect(reader).toHaveAttribute('contenteditable', 'false')
    await page.reload({ waitUntil: 'networkidle' })
    await expect(reader).toHaveText(editedText)
    await expect(reader).toHaveAttribute('contenteditable', 'false')
    await page.screenshot({ path: testInfo.outputPath('reader.png'), animations: 'disabled' })

    await toggle.click()
    await expect(reader).toHaveAttribute('contenteditable', 'true')
    if (viewport.width < 1024) await page.getByRole('button', { name: 'Open chapter navigation' }).click()
    await page.getByTestId('timeline-chapter-2').getByRole('button').first().click()
    await expect(reader).not.toHaveText(editedText)
    await expect(reader).toHaveAttribute('contenteditable', 'false')
    await expect(toggle).toHaveText('Edit text')
  })
}
