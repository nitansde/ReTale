import { expect, test } from '@playwright/test'
import {
  AUTOSAVE_EDIT_BURST_LENGTH,
  materializeAutosavePerformanceFixtures,
} from '../helpers/autosave-performance-fixtures'
import { mockNovelResourceApi, type MockNovelResourceMutation } from '../helpers/novel-resource-api-mock'

async function waitForObservedCountToStabilize(readCount: () => number, minCount: number) {
  const deadline = Date.now() + 15_000
  let lastCount = readCount()
  let stableIntervals = lastCount >= minCount ? 1 : 0

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    const currentCount = readCount()
    if (currentCount !== lastCount) {
      lastCount = currentCount
      stableIntervals = currentCount >= minCount ? 1 : 0
      continue
    }
    if (currentCount >= minCount) {
      stableIntervals += 1
      if (stableIntervals >= 5) return currentCount
    }
  }

  throw new Error(`Resource save count did not stabilize; observed ${lastCount}, expected at least ${minCount}.`)
}

test('large-novel edit burst keeps autosaves ordered and chapter-scoped', async ({ page }) => {
  test.setTimeout(90_000)
  const fixtures = materializeAutosavePerformanceFixtures()
  let persistedWorkspace = fixtures.workspace
  const resourceSaves: Array<MockNovelResourceMutation & { order: number }> = []
  let activeResourceSaves = 0
  let maximumActiveResourceSaves = 0

  await mockNovelResourceApi(page, () => persistedWorkspace, {
    onMutation: async (mutation) => {
      activeResourceSaves += 1
      maximumActiveResourceSaves = Math.max(maximumActiveResourceSaves, activeResourceSaves)
      resourceSaves.push({ ...mutation, order: resourceSaves.length + 1 })
      if (mutation.kind === 'chapter') {
        persistedWorkspace = {
          ...persistedWorkspace,
          localChapters: persistedWorkspace.localChapters.map((chapter) => chapter.id === mutation.id
            ? {
                ...chapter,
                content: typeof mutation.payload.content === 'string' ? mutation.payload.content : chapter.content,
                wordCount: typeof mutation.payload.wordCount === 'number' ? mutation.payload.wordCount : chapter.wordCount,
                updatedAt: typeof mutation.payload.updatedAtLabel === 'string' ? mutation.payload.updatedAtLabel : chapter.updatedAt,
              }
            : chapter),
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
      activeResourceSaves -= 1
    },
  })
  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        novelId: persistedWorkspace.currentNovelId,
        branchId: `${persistedWorkspace.currentNovelId}:main`,
        chapters: persistedWorkspace.localChapters.map((chapter) => ({
          type: 'chapter',
          chapterId: chapter.id,
          chapterNo: chapter.order,
          title: chapter.title,
          wordCount: chapter.wordCount,
        })),
        branchNodes: [],
        edges: [],
      }),
    })
  })
  await page.route('**/api/knowledge-view*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        localOutlines: [],
        localCharacters: [],
        localCharacterRelations: [],
        localWorldEntries: [],
        localTimelineEvents: [],
        knowledgeRebuildStatus: null,
        hanlpCacheSnapshot: null,
        knowledgeStatusOverview: null,
      }),
    })
  })

  await page.goto('/workspace', { waitUntil: 'networkidle' })
  const editor = page.getByTestId('workspace-chapter-reader').first()
  await page.getByTestId('workspace-reader-edit-toggle').click()
  await expect(editor).toBeVisible()

  const baselineSaveCount = resourceSaves.length
  await editor.click()
  await page.keyboard.press('Meta+A')
  await page.keyboard.insertText(fixtures.editBurst)
  await expect(page.getByTestId('workspace-chapter-body-view')).toContainText(fixtures.editBurst.slice(-64))

  await waitForObservedCountToStabilize(() => resourceSaves.length, baselineSaveCount + 1)
  const editSaves = resourceSaves.slice(baselineSaveCount)
  expect(editSaves.length).toBeGreaterThanOrEqual(1)
  expect(editSaves.length).toBeLessThanOrEqual(2)
  expect(editSaves.map((save) => save.order)).toEqual(
    Array.from({ length: editSaves.length }, (_, index) => baselineSaveCount + index + 1),
  )
  expect(maximumActiveResourceSaves).toBe(1)
  expect(editSaves.every((save) => save.kind === 'chapter' && save.id === persistedWorkspace.currentChapterId)).toBe(true)
  expect(editSaves.every((save) => save.payload.localChapters === undefined)).toBe(true)
  expect(editSaves.every((save) => save.payloadBytes > AUTOSAVE_EDIT_BURST_LENGTH)).toBe(true)
  expect(editSaves.at(-1)?.payload.content).toBe(`<p>${fixtures.editBurst}</p>`)
  expect(persistedWorkspace.localChapters.find((chapter) => chapter.id === persistedWorkspace.currentChapterId)?.content).toBe(`<p>${fixtures.editBurst}</p>`)

  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByTestId('workspace-chapter-body-view')).toContainText(fixtures.editBurst.slice(-64))
})
