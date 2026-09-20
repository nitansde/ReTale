import { expect, test } from '@playwright/test'
import { mockNovelResourceApi } from '@/tests/helpers/novel-resource-api-mock'

for (const mobile of [true, false]) {
  test(`reading position survives library navigation, reload and novel switching on ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 })
    const novels = ['a', 'b'].map((id) => ({ id: `novel-${id}`, title: `位置记忆 ${id.toUpperCase()}` }))
    const chapters = novels.flatMap((novel) => [1, 2, 3].map((order) => ({
      id: `${novel.id}-${order}`, novelId: novel.id, order, title: `第${order}章`,
      content: `<p>${novel.title} 第${order}章的正文。</p>`, status: 'draft', wordCount: 12, updatedAt: '2026-09-19',
    })))
    await mockNovelResourceApi(page, () => ({ localNovels: novels, localChapters: chapters }))
    await page.route('**/api/story-timeline*', (route) => {
      const novelId = new URL(route.request().url()).searchParams.get('novelId')
      return route.fulfill({ json: {
        novelId, branchId: `${novelId}:main`,
        chapters: chapters.filter((chapter) => chapter.novelId === novelId).map((chapter) => ({
          type: 'chapter', chapterNo: chapter.order, chapterId: chapter.id, title: chapter.title, wordCount: chapter.wordCount,
        })),
        branchNodes: [], edges: [],
      } })
    })
    await page.route('**/api/knowledge-view*', (route) => route.fulfill({ json: {
      ok: true, localOutlines: [], localCharacters: [], localCharacterRelations: [], localWorldEntries: [], localTimelineEvents: [], knowledgeRebuildStatus: null,
    } }))

    const expectChapter = async (id: string, order: number) => {
      await expect(page.getByTestId('workspace-chapter-reader')).toContainText(`位置记忆 ${id.toUpperCase()} 第${order}章的正文。`)
    }
    const openNovel = async (id: string) => {
      await page.getByRole('button').filter({ has: page.getByRole('heading', { name: `位置记忆 ${id.toUpperCase()}`, exact: true }) }).click()
      await expect(page).toHaveURL(/\/workspace/)
    }
    const selectChapter = async (id: string, order: number) => {
      if (mobile) await page.getByRole('button', { name: '打开章节导航', exact: true }).click()
      await page.getByTestId(`timeline-chapter-row-novel-${id}-${order}`).getByRole('button').first().click()
      await expectChapter(id, order)
    }
    const goHome = async () => {
      await page.getByRole('link', { name: '返回书库', exact: true }).filter({ visible: true }).click()
      await expect(page).toHaveURL(/\/library$/)
      await expect(page.getByRole('heading', { name: '位置记忆 A', exact: true })).toBeVisible()
    }

    await page.goto('/library', { waitUntil: 'networkidle' })
    await openNovel('a')
    await selectChapter('a', 3)
    await goHome()
    await openNovel('a')
    await expectChapter('a', 3)

    await goHome()
    await page.reload({ waitUntil: 'networkidle' })
    await openNovel('a')
    await expectChapter('a', 3)

    await goHome()
    await openNovel('b')
    await selectChapter('b', 2)
    await goHome()
    await openNovel('a')
    await expectChapter('a', 3)
    await goHome()
    await openNovel('b')
    await expectChapter('b', 2)
    await page.reload({ waitUntil: 'networkidle' })
    await expectChapter('b', 2)
  })
}
