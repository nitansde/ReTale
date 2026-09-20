import { expect, test } from '@playwright/test'
import { mockNovelResourceApi } from '@/tests/helpers/novel-resource-api-mock'

for (const width of [1440, 390]) {
  test(`chapter directory keeps upward scrolling when timeline data arrives at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const chapters = Array.from({ length: 20 }, (_, index) => ({
      id: `chapter-${index + 1}`,
      novelId: 'scroll-novel',
      title: `第${index + 1}章 目录滚动测试`,
      order: index + 1,
      content: `<p>第${index + 1}章正文。</p>`,
      status: 'draft',
      wordCount: 100,
      updatedAt: '2026-09-20',
    }))
    await mockNovelResourceApi(page, () => ({
      currentNovelId: 'scroll-novel',
      currentChapterId: 'chapter-20',
      localNovels: [{ id: 'scroll-novel', title: '目录滚动测试', summary: '', tags: [] }],
      localChapters: chapters,
    }))
    let releaseTimeline!: () => void
    const timelineReady = new Promise<void>((resolve) => { releaseTimeline = resolve })
    await page.route('**/api/story-timeline*', async (route) => {
      await timelineReady
      await route.fulfill({ json: {
        novelId: 'scroll-novel',
        branchId: 'scroll-novel:main',
        chapters: chapters.map((chapter) => ({
          type: 'chapter',
          chapterId: chapter.id,
          chapterNo: chapter.order,
          title: chapter.title,
          wordCount: chapter.wordCount,
          summary: '后台加载完成的章节摘要。',
        })),
        branchNodes: [],
        edges: [],
      } })
    })
    await page.route('**/api/knowledge-view*', (route) => route.fulfill({ json: {
      ok: true,
      localOutlines: [],
      localCharacters: [],
      localCharacterRelations: [],
      localWorldEntries: [],
      localTimelineEvents: [],
      knowledgeRebuildStatus: null,
      jobOutcome: null,
    } }))

    await page.goto('/workspace?selectionKind=chapter&selectionChapterId=chapter-20&selectionChapterNo=20')
    await expect(page.getByTestId('workspace-chapter-reader')).toContainText('第20章正文')
    if (width < 1024) await page.getByRole('button', { name: '打开章节导航', exact: true }).click()
    const scroll = page.getByTestId('chapter-navigation-scroll')
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(500)

    // Use wheel input so the browser performs the upward scroll itself.
    await scroll.hover()
    await page.mouse.wheel(0, -10000)
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(0)
    releaseTimeline()
    await expect(page.getByTestId('timeline-chapter-1')).toContainText('后台加载完成的章节摘要。')
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(0)
    await expect(page.getByTestId('timeline-chapter-1')).toBeInViewport()

    if (width < 1024) {
      await page.getByRole('button', { name: '关闭章节导航', exact: true }).click()
      await page.getByRole('button', { name: '打开章节导航', exact: true }).click()
      await expect(page.getByTestId('timeline-chapter-20')).toBeInViewport()
      await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(500)
    }
  })
}
