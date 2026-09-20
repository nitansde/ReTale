import { expect, test, type Locator, type Page } from '@playwright/test'
import { mockNovelResourceApi } from '@/tests/helpers/novel-resource-api-mock'
import type { Chapter } from '@/lib/types'
import type { StoryTimelineBranchNode } from '@/lib/story-branch-types'

async function touchSwipe(page: Page, card: Locator, dx: number, dy = 0) {
  await card.scrollIntoViewIfNeeded()
  const bounds = await card.boundingBox()
  if (!bounds) throw new Error('Swipe target is not visible')
  const x = bounds.x + bounds.width * 0.7
  const y = bounds.y + Math.min(40, bounds.height / 2)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
  for (let step = 1; step <= 6; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * step / 6, y: y + dy * step / 6, id: 1 }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

for (const mobile of [true, false]) {
  test(`timeline deletion ${mobile ? 'swipes on mobile' : 'buttons on desktop'} covers chapters and all branch types`, async ({ page }, testInfo) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 })
    const novelId = 'swipe-novel'
    let chapters: Chapter[] = [1, 2].map((order) => ({
      id: `chapter-${order}`, novelId, order, title: `第${order}章 正式章节`,
      content: `<p>第${order}章原文。</p>`, status: 'draft', wordCount: 8, updatedAt: '2026-09-19',
    }))
    chapters.push({ ...chapters[0]!, id: 'branch-chapter', parentChapterId: 'chapter-1', title: '魔改分支章节' })
    let nodes: StoryTimelineBranchNode[] = (['rewrite', 'roleplay_session', 'continue_block', 'what_if', 'future_jump'] as const).map((nodeType, index) => ({
      type: 'branch_node', id: `node-${nodeType}`, nodeType, anchorChapterNo: 1, parentNodeId: null,
      title: `${nodeType} 标题`, readableLabel: ['RE-01', 'RP-01', 'CONT-01', 'IF-01', 'JUMP-01'][index],
      subtitle: '一段很长的说明文字，删除按钮应始终留在可视范围内。'.repeat(3),
      laneIndex: 0, colorToken: null, sourceChapterNo: 1, targetChapterNo: nodeType === 'future_jump' ? 2 : null,
      continueBlockId: nodeType === 'rewrite' || nodeType === 'continue_block' ? `block-${index}` : null,
      whatIfSessionId: nodeType === 'what_if' ? 'what-if-session' : null,
      futureJumpRunId: nodeType === 'future_jump' ? 'jump-run' : null,
      roleplaySessionId: nodeType === 'roleplay_session' ? 'rp-session' : null,
      status: 'active',
    }))
    const deletions: string[] = []
    let failNextDeletion = false
    await mockNovelResourceApi(page, () => ({
      currentNovelId: novelId, currentChapterId: chapters[0]?.id ?? null,
      localNovels: [{ id: novelId, title: '左滑删除测试' }], localChapters: chapters,
    }), { onMutation: (mutation) => {
      if (mutation.kind === 'novel' && Array.isArray(mutation.payload.localChapters)) {
        chapters = (mutation.payload.localChapters as Chapter[]).map((chapter) => {
          const persisted = { ...chapter, content: chapters.find((item) => item.id === chapter.id)?.content ?? chapter.content }
          delete persisted.contentLoaded
          return persisted
        })
      }
    } })
    await page.route('**/api/story-timeline*', async (route) => {
      if (route.request().method() === 'DELETE') {
        const { nodeId } = route.request().postDataJSON() as { nodeId: string }
        if (failNextDeletion) {
          failNextDeletion = false
          await route.fulfill({ status: 500, json: { ok: false, error: 'Deletion failed' } })
          return
        }
        deletions.push(nodeId)
        nodes = nodes.filter((node) => node.id !== nodeId)
        await route.fulfill({ json: { ok: true, nodeId } })
        return
      }
      await route.fulfill({ json: {
        novelId, branchId: `${novelId}:main`,
        chapters: chapters.filter((chapter) => !chapter.parentChapterId).map((chapter) => ({ type: 'chapter', chapterNo: chapter.order, chapterId: chapter.id, title: chapter.title, wordCount: chapter.wordCount })),
        branchNodes: nodes, edges: [],
      } })
    })
    await page.route('**/api/knowledge-view*', (route) => route.fulfill({ json: {
      ok: true, localOutlines: [], localCharacters: [], localCharacterRelations: [], localWorldEntries: [], localTimelineEvents: [], knowledgeRebuildStatus: null,
    } }))
    await page.goto('/workspace', { waitUntil: 'networkidle' })
    if (mobile) await page.getByRole('button', { name: '打开章节导航', exact: true }).click()
    const nav = page.getByTestId('workspace-chapter-nav')
    await expect(nav).toBeVisible()

    const chapterRow = page.getByTestId('timeline-chapter-row-chapter-1')
    if (mobile) {
      await touchSwipe(page, chapterRow.getByRole('button').first(), -15, 70)
      await expect(chapterRow).toHaveAttribute('data-delete-revealed', 'false')
      await touchSwipe(page, chapterRow.getByRole('button').first(), -110)
      await expect(chapterRow).toHaveAttribute('data-delete-revealed', 'true')
      await page.screenshot({ path: testInfo.outputPath('chapter-swipe-delete.png'), animations: 'disabled' })
      await expect(nav).toBeVisible()
      await touchSwipe(page, chapterRow.getByRole('button').first(), 110)
      await expect(chapterRow).toHaveAttribute('data-delete-revealed', 'false')
    }

    for (const kind of ['rewrite', 'roleplay_session', 'continue_block', 'what_if', 'future_jump']) {
      const row = page.getByTestId(`timeline-node-row-node-${kind}`)
      const card = page.getByTestId(`timeline-node-node-${kind}`)
      const deleteButton = row.getByRole('button', { name: /^删除 / })
      if (mobile) {
        await touchSwipe(page, card, -110)
        await expect(row).toHaveAttribute('data-delete-revealed', 'true')
        await expect(nav).toBeVisible()
      } else {
        await deleteButton.scrollIntoViewIfNeeded()
      }
      await expect(deleteButton).toBeInViewport()
      const navBounds = await nav.boundingBox()
      const deleteBounds = await deleteButton.boundingBox()
      expect(deleteBounds!.x + deleteBounds!.width).toBeLessThanOrEqual(navBounds!.x + navBounds!.width)
      expect(deletions).not.toContain(`node-${kind}`)
      if (kind === 'roleplay_session') {
        await page.screenshot({ path: testInfo.outputPath('rp-delete.png'), animations: 'disabled' })
        page.once('dialog', async (dialog) => { expect(dialog.message()).toContain('角色扮演会话'); await dialog.dismiss() })
        await deleteButton.click()
        await expect(card).toBeVisible()
        expect(deletions).not.toContain('node-roleplay_session')
        if (mobile) await touchSwipe(page, card, -110)
      }
      if (kind === 'rewrite') {
        failNextDeletion = true
        page.once('dialog', (dialog) => dialog.accept())
        await deleteButton.click()
        await expect(card).toBeEnabled()
        await expect(card).toBeVisible()
        if (mobile) await touchSwipe(page, card, -110)
      }
      page.once('dialog', (dialog) => dialog.accept())
      await deleteButton.click()
      await expect(card).toHaveCount(0)
    }
    expect(deletions).toHaveLength(5)

    for (const [id, title] of [['branch-chapter', '魔改分支章节'], ['chapter-1', '第1章 正式章节']]) {
      const row = page.getByTestId(`timeline-chapter-row-${id}`)
      const card = row.getByRole('button').first()
      const deleteButton = row.getByRole('button', { name: `删除章节 ${title}`, exact: true })
      if (mobile) await touchSwipe(page, card, -110)
      page.once('dialog', (dialog) => dialog.dismiss())
      await deleteButton.click()
      await expect(row).toBeVisible()
      expect(chapters.some((chapter) => chapter.id === id)).toBe(true)
      if (mobile) await touchSwipe(page, card, -110)
      page.once('dialog', (dialog) => dialog.accept())
      await deleteButton.click()
      await expect(row).toHaveCount(0)
      await expect.poll(() => chapters.some((chapter) => chapter.id === id)).toBe(false)
    }
    await page.reload({ waitUntil: 'networkidle' })
    if (mobile) await page.getByRole('button', { name: '打开章节导航', exact: true }).click()
    await expect(page.getByTestId('timeline-chapter-row-chapter-2')).toBeVisible()
    await expect(page.getByTestId('timeline-chapter-row-chapter-1')).toHaveCount(0)
    await expect(page.getByTestId('timeline-node-node-roleplay_session')).toHaveCount(0)
  })
}
