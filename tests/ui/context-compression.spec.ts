import { expect, test } from '@playwright/test'
import { createDefaultAISettings } from '@/lib/ai-settings'
import { mockNovelResourceApi } from '@/tests/helpers/novel-resource-api-mock'
import type { ContextCompressionPreview } from '@/lib/context-compression'

for (const width of [390, 1440]) {
  test(`context compression warning and prefix selection at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const novelId = 'novel-001', branchId = `${novelId}:main`, sessionId = 'rp-1'
    const cast = { playerName: '林舟', counterpartName: '沈月' }
    const original = '原著正文：他们在城门前相遇。'
    const workspace = { currentNovelId: novelId, currentChapterId: 'chapter-1', localNovels: [{ id: novelId, title: '压缩上下文测试', summary: '', tags: [] }], localChapters: [{ id: 'chapter-1', novelId, title: '第一章', order: 1, content: `<p>${original}</p>`, status: 'draft', wordCount: 20, updatedAt: '2026-09-20' }] }
    const ai = createDefaultAISettings()
    ai.rewrite.openAICompatible = { ...ai.rewrite.openAICompatible, configured: true, baseUrl: 'http://fixture.invalid/v1', model: 'fixture', apiKeyConfigured: true }
    await page.route('**/api/settings/ai', (route) => route.fulfill({ json: ai }))
    await mockNovelResourceApi(page, () => workspace)
    await page.route('**/api/knowledge-view*', (route) => route.fulfill({ json: { ok: true, localOutlines: [], localCharacterRelations: [], localWorldEntries: [], localTimelineEvents: [], localCharacters: [], knowledgeRebuildStatus: null } }))
    await page.route('**/api/story-timeline*', (route) => route.fulfill({ json: { novelId, branchId, chapters: [{ type: 'chapter', chapterNo: 1, chapterId: 'chapter-1', title: '第一章', wordCount: 20 }], branchNodes: [{ type: 'branch_node', id: 'rp-node', nodeType: 'roleplay_session', readableLabel: 'RP-01', readableLineageLabel: 'RP-01', anchorChapterNo: 1, parentNodeId: null, title: '城门对话', subtitle: null, laneIndex: 0, colorToken: 'emerald', sourceChapterNo: 1, targetChapterNo: null, continueBlockId: null, whatIfSessionId: null, futureJumpRunId: null, roleplaySessionId: sessionId, status: 'active' }], edges: [] } }))
    const turn = { ...cast, storyGuidance: '', dialogue: '我们出发吧。', maxCharacters: 500 }
    const script = { ...cast, blocks: [{ type: 'counterpart', text: '好，我会守住这个约定。' }] }
    const messages = [
      { id: 'm1', sessionId, messageIndex: 1, turnIndex: 1, variantIndex: 1, role: 'user', content: turn.dialogue, turn, parentMessageId: null, status: 'active', createdAt: '2026-09-20', updatedAt: '2026-09-20' },
      { id: 'm2', sessionId, messageIndex: 2, turnIndex: 2, variantIndex: 1, role: 'assistant', content: script.blocks[0].text, script, parentMessageId: 'm1', status: 'active', createdAt: '2026-09-20', updatedAt: '2026-09-20' },
    ]
    await page.route('**/api/roleplay/sessions/rp-1?*', (route) => route.fulfill({ json: { id: sessionId, novelId, branchId, title: '城门对话', subtitle: '', characterOptions: [{ name: '林舟', protagonist: true }, { name: '沈月' }], sourceChapterNo: 1, status: 'active', sourceSnapshot: { chapterId: 'chapter-1', chapterNo: 1, chapterTitle: '第一章', timelineNodeId: null, timelineNodeType: 'chapter', selectedText: original, textSnapshot: original, selectedLineStart: 1, selectedLineEnd: 1 }, messages } }))
    let compressed = 0
    let total = 8
    const compression = (): ContextCompressionPreview => ({ scope: { novelId, branchId, roleplaySessionId: sessionId, roleplayLeafMessageId: 'm2' }, fingerprint: 'same-history', totalChapters: total, compressedChapters: compressed, chapters: Array.from({ length: total }, (_, i) => ({ label: `城门对话 ${i + 1}`, tokenEstimate: 30000 })), summary: compressed ? '他们决定结伴出发，约定在天黑前抵达城门。' : null, tokenEstimate: compressed ? 95000 : 230000 })
    await page.route('**/api/roleplay/preview', (route) => route.fulfill({ json: { ok: true, contextSnapshotId: `snapshot-${compressed}`, compression: compression(), tokenEstimate: compressed ? 110000 : 235000, systemPrompt: '请承接故事。', userPrompt: '故事上下文', promptBlocks: [{ id: 'roleplay-history', label: '历史', content: compressed ? '他们决定结伴出发。' : '历史正文', enabled: true, priority: 'highest', required: true, trimmed: false }], writingSkillRecords: [], warnings: [] } }))
    await page.route('**/api/rewrite', (route) => route.fulfill({ status: 502, json: { error: 'HTTP 400: maximum context length is 200000 tokens, requested 235000 tokens' } }))
    const requests: unknown[] = []
    const expansions: unknown[] = []
    await page.route('**/api/context/compress', async (route) => {
      const body = route.request().postDataJSON()
      if (route.request().method() === 'DELETE') {
        expansions.push(body)
        compressed = 0
      } else {
        requests.push(body)
        compressed = body.count
      }
      await route.fulfill({ json: { ok: true, compression: compression() } })
    })
    await page.goto('/workspace?selectionKind=roleplay_session&selectionNodeId=rp-node&selectionSessionId=rp-1&selectionAnchorChapterNo=1', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('workspace-roleplay-session-view')).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: '200K' })).toBeVisible()
    await page.getByTestId('roleplay-regenerate-last').click()
    const failure = page.getByRole('alert').filter({ hasText: 'HTTP 400' })
    await expect(failure).toContainText('maximum context length is 200000 tokens, requested 235000 tokens')
    await expect(failure).toContainText('请打开“高级上下文”→“压缩上下文”')
    await expect(page.getByRole('button', { name: /压缩上下文/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '展开上下文' })).toHaveCount(0)
    await page.getByRole('button', { name: '高级上下文', exact: true }).click()
    const contextMenu = page.getByRole('dialog', { name: '高级上下文', exact: true })
    await expect(contextMenu.getByTestId('roleplay-context-token-estimate')).toContainText('235,000 tokens')
    await contextMenu.getByRole('button', { name: /压缩上下文/ }).click()
    const dialog = page.getByRole('dialog', { name: '压缩上下文' })
    await expect(dialog).toContainText('历史共 8 章')
    await expect(dialog).toContainText('原著正文不参与压缩')
    await dialog.getByRole('spinbutton').fill('5')
    await expect(dialog).toContainText('其余 3 章保持全文')
    await expect(dialog.getByTestId('compression-estimated-savings')).toContainText('预计节省约 148,750 tokens')
    await expect(dialog.getByTestId('compression-estimated-savings')).toContainText('150,000 → 摘要约 1,250 tokens')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`compression-${width}.png`), animations: 'disabled' })
    await dialog.getByRole('button', { name: '开始压缩' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('alert').filter({ hasText: '200K' })).toHaveCount(0)
    await expect(contextMenu.getByTestId('compression-history-status')).toContainText('5 章已压缩 · 3 章未压缩')
    await expect(contextMenu.getByTestId('roleplay-context-token-estimate')).toContainText('110,000 tokens')
    await expect(contextMenu.getByTestId('compression-saved-tokens')).toContainText('累计节省约')
    await expect(contextMenu.getByRole('button', { name: '继续压缩上下文' })).toBeEnabled()
    await contextMenu.getByRole('button', { name: '关闭高级上下文', exact: true }).click()
    await expect(page.getByRole('button', { name: /压缩上下文/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '展开上下文' })).toHaveCount(0)
    await page.getByRole('button', { name: '高级上下文', exact: true }).click()
    await contextMenu.getByRole('button', { name: '继续压缩上下文' }).click()
    const moreDialog = page.getByRole('dialog', { name: '继续压缩上下文', exact: true })
    await expect(moreDialog).toContainText('第 1–5 章 · 已使用摘要')
    await expect(moreDialog).toContainText('第 6–8 章 · 保留全文')
    await moreDialog.getByText('查看当前摘要', { exact: true }).click()
    await expect(moreDialog.getByText('他们决定结伴出发，约定在天黑前抵达城门。')).toBeVisible()
    await moreDialog.getByRole('spinbutton', { name: '本次再压缩' }).fill('2')
    await expect(moreDialog.getByTestId('compression-estimated-savings')).toContainText('本次预计节省约')
    await expect(moreDialog.getByTestId('compression-estimated-savings')).not.toContainText('148,750')
    await expect(moreDialog.getByTestId('compression-selection')).toContainText('本次选择：第 6–7 章（2 章）')
    await expect(moreDialog.getByTestId('compression-selection')).toContainText('前 7 章使用摘要；其余 1 章保持全文')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`compress-more-${width}.png`), animations: 'disabled' })
    await moreDialog.getByRole('button', { name: '合并摘要并压缩' }).click()
    await expect(moreDialog).toBeHidden()
    await expect(contextMenu.getByTestId('compression-history-status')).toContainText('7 章已压缩 · 1 章未压缩')
    await contextMenu.getByRole('button', { name: '继续压缩上下文' }).click()
    await expect(moreDialog.getByRole('spinbutton')).toHaveAttribute('max', '1')
    await moreDialog.getByRole('button', { name: '合并摘要并压缩' }).click()
    await expect(contextMenu.getByRole('button', { name: '已全部压缩' })).toBeDisabled()
    await expect(contextMenu).toContainText('生成新内容后可继续压缩')
    // Reopen after generating more history: the summary stays, new chapters are selectable.
    total = 10
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '高级上下文', exact: true }).click()
    await expect(contextMenu.getByTestId('compression-history-status')).toContainText('8 章已压缩 · 2 章未压缩')
    await contextMenu.getByRole('button', { name: '继续压缩上下文' }).click()
    await expect(moreDialog.getByRole('spinbutton')).toHaveValue('1')
    await expect(moreDialog.getByTestId('compression-selection')).toContainText('本次选择：第 9 章（1 章）')
    await moreDialog.getByRole('button', { name: '合并摘要并压缩' }).click()
    await expect(moreDialog).toBeHidden()
    expect(requests).toEqual([5, 7, 8, 9].map((count) => ({ scope: compression().scope, fingerprint: 'same-history', count })))
    await contextMenu.getByRole('button', { name: '展开上下文' }).click()
    await expect(page.getByRole('alert').filter({ hasText: '200K' })).toBeVisible()
    await expect(contextMenu.getByTestId('compression-history-status')).toContainText('0 章已压缩 · 10 章未压缩')
    await expect(contextMenu.getByTestId('roleplay-context-token-estimate')).toContainText('235,000 tokens')
    await expect(contextMenu.getByTestId('compression-saved-tokens')).toHaveCount(0)
    await expect(contextMenu.getByRole('button', { name: '展开上下文' })).toHaveCount(0)
    expect(expansions).toEqual([{ scope: compression().scope, fingerprint: 'same-history' }])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`expanded-context-${width}.png`), animations: 'disabled' })
    await contextMenu.getByRole('button', { name: '关闭高级上下文', exact: true }).click()
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByRole('alert').filter({ hasText: '200K' })).toBeVisible()
    await expect(page.getByText('好，我会守住这个约定。', { exact: true })).toBeVisible()
    expect(workspace.localChapters[0].content).toBe(`<p>${original}</p>`)
    expect(errors).toEqual([])
  })
}
