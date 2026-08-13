import { expect, test } from '@playwright/test'
import type { PersistedNovelState } from '../../lib/types'
import {
  AUTOSAVE_EDIT_BURST_LENGTH,
  AUTOSAVE_PERFORMANCE_CHAPTER_COUNT,
  materializeAutosavePerformanceFixtures,
} from '../helpers/autosave-performance-fixtures'

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

  throw new Error(`Workspace POST count did not stabilize; observed ${lastCount}, expected at least ${minCount}.`)
}

test('Phase 0 large-workspace edit burst characterizes autosave count, order, and payload', async ({ page }) => {
  test.setTimeout(90_000)
  const fixtures = materializeAutosavePerformanceFixtures()
  let persistedWorkspace = fixtures.workspace
  const workspacePosts: Array<{ order: number; payload: PersistedNovelState; payloadBytes: number }> = []
  let activeWorkspacePosts = 0
  let maximumActiveWorkspacePosts = 0

  await page.route('**/api/workspace*', async (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      activeWorkspacePosts += 1
      maximumActiveWorkspacePosts = Math.max(maximumActiveWorkspacePosts, activeWorkspacePosts)
      const body = request.postData() ?? ''
      const payload = JSON.parse(body) as PersistedNovelState
      workspacePosts.push({ order: workspacePosts.length + 1, payload, payloadBytes: Buffer.byteLength(body) })
      persistedWorkspace = payload
      await new Promise((resolve) => setTimeout(resolve, 25))
      activeWorkspacePosts -= 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
      return
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(persistedWorkspace) })
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
  const editor = page.locator('[contenteditable="true"]').first()
  await expect(editor).toBeVisible()

  const baselinePostCount = workspacePosts.length
  await editor.click()
  await page.keyboard.press('Meta+A')
  await page.keyboard.insertText(fixtures.editBurst)
  await expect(page.getByTestId('workspace-chapter-body-view')).toContainText(fixtures.editBurst.slice(-64))

  await waitForObservedCountToStabilize(() => workspacePosts.length, baselinePostCount + 1)
  const editPosts = workspacePosts.slice(baselinePostCount)
  expect(editPosts.length).toBeGreaterThanOrEqual(1)
  expect(editPosts.length).toBeLessThanOrEqual(2)
  expect(editPosts.map((post) => post.order)).toEqual(
    Array.from({ length: editPosts.length }, (_, index) => baselinePostCount + index + 1),
  )
  expect(maximumActiveWorkspacePosts).toBe(1)
  expect(editPosts.every((post) => post.payload.localChapters.length === AUTOSAVE_PERFORMANCE_CHAPTER_COUNT)).toBe(true)
  expect(editPosts.every((post) => post.payloadBytes > AUTOSAVE_EDIT_BURST_LENGTH)).toBe(true)
  expect(editPosts.at(-1)?.payload.localChapters.find((chapter) => chapter.id === persistedWorkspace.currentChapterId)?.content).toBe(`<p>${fixtures.editBurst}</p>`)

  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByTestId('workspace-chapter-body-view')).toContainText(fixtures.editBurst.slice(-64))
})
