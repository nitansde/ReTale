import path from 'node:path'
import { expect, test } from '@playwright/test'

for (const width of [1280, 390]) {
  test(`book search finds and opens full-text passages at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/library', { waitUntil: 'networkidle' })
    await page.getByTestId('app-language-option-en').click()
    const imported = page.waitForResponse((response) => response.url().endsWith('/api/import-txt') && response.request().method() === 'POST')
    await page.locator('input[type=file]').setInputFiles(path.join(process.cwd(), 'scripts/fixtures/workspace-import-smoke.txt'))
    await page.waitForURL(/\/workspace/)
    const { novelId } = await (await imported).json()
    const savedRewrite = await page.request.post('/api/continue-blocks', { data: {
      novelId, branchId: `${novelId}:main`, sourceChapterNo: 2,
      selectedText: '旧稿', originalText: '桌上摊着一叠旧稿。', generatedText: '改写后，他拿着银色罗盘穿过森林。',
      userInstruction: '加入罗盘', titleHint: '改写的旅程',
    } })
    expect(savedRewrite.ok()).toBe(true)
    await page.reload({ waitUntil: 'networkidle' })
    const searchButton = page.locator('header').getByRole('button', { name: 'Search', exact: true })
    await expect(searchButton).toBeVisible()
    expect(await searchButton.evaluate((button) => button.nextElementSibling?.getAttribute('aria-label'))).toBe('Open chapter navigation')
    await page.screenshot({ path: testInfo.outputPath(`header-search-${width}.png`), animations: 'disabled' })
    await searchButton.click()
    const dialog = page.getByRole('dialog', { name: 'Search this book' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('searchbox')).toBeFocused()
    await expect(dialog.getByRole('radio', { name: 'Semantic search' })).toBeChecked()
    await expect(dialog.getByRole('alert')).toContainText('no usable embeddings')
    await dialog.getByRole('searchbox').fill('森林')
    await dialog.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('no usable embeddings')
    await dialog.getByRole('radio', { name: 'Exact search' }).check()
    await dialog.getByRole('searchbox').fill('旧稿')
    await dialog.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(dialog.getByRole('status')).toContainText('Exact search')
    const result = dialog.getByRole('button', { name: /初入现场/ })
    await expect(result).toContainText('旧稿')
    await page.screenshot({ path: testInfo.outputPath(`book-search-${width}.png`), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await result.click()
    await expect(dialog).not.toBeVisible()
    await expect(page.getByTestId('workspace-chapter-reader')).toContainText('旧稿')
    await expect(page.getByTestId('workspace-chapter-reader')).toHaveAttribute('contenteditable', 'false')
    await searchButton.click()
    await dialog.getByRole('radio', { name: 'Exact search' }).check()
    await dialog.getByRole('searchbox').fill('银色罗盘')
    await dialog.getByRole('button', { name: 'Search', exact: true }).click()
    const rewrite = dialog.getByRole('button', { name: /改写的旅程/ })
    await expect(rewrite).toContainText('Rewrite')
    await rewrite.click()
    await expect(page.getByTestId('workspace-continue-block-view')).toContainText('改写后，他拿着银色罗盘穿过森林。')
  })
}
