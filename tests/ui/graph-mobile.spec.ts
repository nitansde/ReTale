import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { mockNovelResourceApi } from '@/tests/helpers/novel-resource-api-mock'
import { LOCALE_STORAGE_KEY } from '@/lib/i18n/messages'

const evidenceDirectory = path.join(process.cwd(), 'tests/artifacts/evidence/graph-mobile')
const nodes = [
  { id: 'lin', label: '林砚', entityType: 'character', status: 'active', description: '循着旧信追查真相的书生。', importance: 5, confidence: 0.96, userConfirmed: true, score: 8, firstSeenChapter: 1 },
  { id: 'su', label: '苏九', entityType: 'character', status: 'active', description: '城中暗线的联络人。', importance: 4, confidence: 0.9, userConfirmed: true, score: 7 },
  { id: 'city', label: '雾隐城', entityType: 'location', status: 'active', importance: 3, confidence: 0.7, userConfirmed: false, score: 4 },
]
const edges = [
  { id: 'ally', source: 'lin', target: 'su', linkType: 'ally', description: '两人约定一同调查旧案，交换各自掌握的线索。', strength: 4, confidence: 0.96, validFromChapter: 1, validUntilChapter: 2147483647, status: 'user_confirmed', hop: 1, score: 8, includeInPrompt: true, evidenceQuote: '苏九将旧信放在桌上：“这次，我们一起查。”', evidenceLocation: { chapterNo: 1, lineStart: 1, lineEnd: 2 } },
  { id: 'city-edge', source: 'su', target: 'city', linkType: 'located_in', description: '苏九暂时在雾隐城落脚。', strength: 2, confidence: 0.35, validFromChapter: 1, validUntilChapter: 2147483647, status: 'ai_generated', hop: 2, score: 4, includeInPrompt: true },
]

async function setupGraph(page: Page, locale: 'zh' | 'en') {
  await page.context().addCookies([{ name: LOCALE_STORAGE_KEY, value: locale, domain: '127.0.0.1', path: '/' }])
  await mockNovelResourceApi(page, () => ({ currentNovelId: 'novel-graph', currentChapterId: 'chapter-graph', localNovels: [{ id: 'novel-graph', title: '雾城旧事', summary: '', tags: [] }], localChapters: [{ id: 'chapter-graph', novelId: 'novel-graph', title: '旧信与故人', order: 1, content: '<p>苏九将旧信放在桌上：“这次，我们一起查。”</p>', status: 'draft', wordCount: 30, updatedAt: '2026-09-20' }] }))
  await page.route('**/api/story-timeline*', (route) => route.fulfill({ json: { novelId: 'novel-graph', branchId: 'novel-graph:main', chapters: [{ type: 'chapter', chapterNo: 1, chapterId: 'chapter-graph', title: '旧信与故人', wordCount: 30 }], branchNodes: [], edges: [] } }))
  await page.route('**/api/knowledge-view*', (route) => route.fulfill({ json: { ok: true, localOutlines: [], localCharacterRelations: [], localWorldEntries: [], localTimelineEvents: [], localCharacters: [], knowledgeRebuildStatus: null, hanlpCacheSnapshot: null } }))
  await page.route('**/api/rag/graph-context*', (route) => route.fulfill({ json: { ok: true, novelId: 'novel-graph', branchId: 'novel-graph:main', chapterId: 'chapter-graph', chapterNo: 1, chapterTitle: '旧信与故人', warnings: [], graphContext: { seedEntities: [nodes[0]], nodes, edges, contextText: '', warnings: [], tokenEstimate: 100, status: 'ready' }, lanceEvidence: [{ id: 'evidence', sourceType: 'chapter_summary', sourceId: 'summary', chapterId: 'chapter-graph', chapterNo: 1, lineStart: null, lineEnd: null, title: null, sourceLabel: '章节摘要', text: '旧信让两人的命运再次交汇。', score: 0.9 }], tokenEstimate: 100 } }))
  await page.goto('/workspace', { waitUntil: 'networkidle' })
}

for (const scenario of [{ locale: 'zh' as const, width: 390 }, { locale: 'en' as const, width: 360 }]) {
  test(`graph mobile ${scenario.locale}: browse, inspect, filter and switch views`, async ({ page }) => {
    await page.setViewportSize({ width: scenario.width, height: 844 })
    await setupGraph(page, scenario.locale)
    const zh = scenario.locale === 'zh'
    await page.getByRole('button', { name: zh ? '更多选项' : 'More options', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: zh ? '图谱' : 'Graph', exact: true }).click()
    const browser = page.getByTestId('chapter-graph-browser')
    await expect(browser.getByTestId('graph-list')).toBeVisible()
    await expect(browser.getByTestId('graph-map')).toHaveCount(0)
    await expect(browser.getByRole('button', { name: zh ? /章节证据/ : /Chapter evidence/ })).toHaveCount(0)
    await expect(page.getByTestId('graph-selection-evidence')).toHaveCount(0)
    await expect(browser.getByTestId('graph-relation-card')).toHaveCount(1)
    await expect(browser).not.toContainText(/ai_generated|user_confirmed|located_in/)
    if (zh) await expect(browser).not.toContainText(/Seed|1-hop|2-hop|character/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    fs.mkdirSync(evidenceDirectory, { recursive: true })
    await page.screenshot({ animations: 'disabled', path: path.join(evidenceDirectory, `graph-${scenario.locale}-list.png`), fullPage: true })

    const card = browser.getByTestId('graph-relation-card').first()
    await card.click()
    const details = page.getByRole('dialog', { name: zh ? '图谱详情' : 'Graph details' })
    await expect(details).toBeVisible()
    await expect(details.getByText(edges[0].evidenceQuote!, { exact: true })).toHaveCount(1)
    await expect(details.getByRole('complementary').getByTestId('graph-selection-evidence')).toContainText(edges[0].evidenceQuote!)
    await expect(details).not.toContainText('旧信让两人的命运再次交汇。')
    await expect(details).toContainText(zh ? '1 层关联' : '1-hop')
    await expect(details.getByRole('button', { name: zh ? '跳转原文' : 'Jump to source' })).toBeVisible()
    await page.screenshot({ animations: 'disabled', path: path.join(evidenceDirectory, `graph-${scenario.locale}-details.png`) })
    await page.keyboard.press('Escape')
    await expect(details).not.toBeVisible()
    await expect(card).toBeFocused()
    await card.click()
    await details.getByRole('button', { name: zh ? '关闭详情' : 'Close details' }).click()
    await expect(details).not.toBeVisible()

    await browser.getByRole('button', { name: zh ? /^筛选/ : /^Filters/ }).click()
    await browser.getByRole('button', { name: zh ? '扩展关联' : 'Extended', exact: true }).click()
    await browser.getByRole('checkbox', { name: zh ? '隐藏低置信度' : 'Hide low confidence' }).uncheck()
    await expect(browser.getByTestId('graph-relation-card')).toHaveCount(1)
    const su = browser.getByRole('button', { name: zh ? '苏九 人物' : '苏九 Character', exact: true })
    await su.click()
    await expect(details).not.toBeVisible()
    await expect(su).toHaveAttribute('aria-pressed', 'true')
    // Both incoming and outgoing relationships belong to the selected entity.
    await expect(browser.getByTestId('graph-relation-card')).toHaveCount(2)
    await browser.getByTestId('graph-relation-card').first().click()
    await details.getByRole('button', { name: zh ? '关闭详情' : 'Close details' }).click()
    await expect(su).toHaveAttribute('aria-pressed', 'true')
    await expect(browser.getByTestId('graph-relation-card')).toHaveCount(2)
    await browser.getByRole('button', { name: zh ? '实体详情' : 'Entity details', exact: true }).click()
    await expect(details.getByRole('heading', { name: '苏九', exact: true })).toBeVisible()
    await expect(details.getByTestId('graph-selection-evidence')).toContainText(edges[0].evidenceQuote!)
    await details.getByRole('button', { name: zh ? '关闭详情' : 'Close details' }).click()
    await browser.getByRole('button', { name: zh ? '雾隐城 地点' : '雾隐城 Location', exact: true }).click()
    await expect(browser.getByTestId('graph-relation-card')).toHaveCount(1)
    await expect(browser.getByTestId('graph-relation-card')).toContainText('雾隐城')
    await expect(browser.getByTestId('graph-relation-card')).not.toContainText('林砚')
    await browser.getByTestId('graph-relation-card').click()
    await expect(details.getByTestId('graph-selection-evidence')).toContainText(zh ? '暂时没有与当前对象对应的证据。' : 'No evidence is available for this selection yet.')
    await expect(details).not.toContainText(edges[0].evidenceQuote!)
    await details.getByRole('button', { name: zh ? '关闭详情' : 'Close details' }).click()
    await browser.getByRole('checkbox', { name: zh ? '隐藏低置信度' : 'Hide low confidence' }).check()
    await expect(browser.getByTestId('graph-relation-card')).toHaveCount(0)
    await expect(browser.getByText(zh ? '当前筛选下没有与「雾隐城」相连的关系。' : 'No connections to 雾隐城 match the current filters.')).toBeVisible()
    await browser.getByRole('button', { name: zh ? '全部关系' : 'All relationships', exact: true }).click()
    await browser.getByRole('checkbox', { name: zh ? '隐藏低置信度' : 'Hide low confidence' }).uncheck()
    await expect(browser.getByTestId('graph-relation-card')).toHaveCount(2)
    await page.screenshot({ animations: 'disabled', path: path.join(evidenceDirectory, `graph-${scenario.locale}-all-relationships.png`), fullPage: true })
    await browser.getByRole('checkbox', { name: zh ? '隐藏低置信度' : 'Hide low confidence' }).check()
    await expect(browser.getByTestId('graph-relation-card')).toHaveCount(1)
    await browser.getByRole('button', { name: zh ? '图谱' : 'Map', exact: true }).click()
    await expect(browser.getByTestId('graph-map')).toBeVisible()
    await expect(browser.locator('.react-flow__node')).toHaveCount(2)
    const zoom = browser.getByRole('button', { name: zh ? '放大' : 'Zoom in', exact: true })
    await expect(zoom).toBeVisible()
    expect((await zoom.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await expect(browser.locator('.react-flow__minimap')).not.toBeVisible()
    await page.screenshot({ animations: 'disabled', path: path.join(evidenceDirectory, `graph-${scenario.locale}-map.png`), fullPage: true })
    await browser.getByRole('button', { name: zh ? '列表' : 'List', exact: true }).click()
    const search = browser.getByRole('searchbox')
    await search.fill('不存在')
    await expect(browser.getByText(zh ? '没有符合条件的内容' : 'No matching results')).toBeVisible()
    await browser.getByRole('button', { name: zh ? '重置筛选' : 'Reset filters' }).click()
    await expect(browser.getByTestId('graph-relation-card')).toHaveCount(2)
    await expect(browser.getByText('旧信让两人的命运再次交汇。')).not.toBeVisible()
    await browser.getByTestId('graph-relation-card').first().click()
    await details.getByRole('button', { name: zh ? '跳转原文' : 'Jump to source' }).click()
    await expect(page.getByTestId('workspace-chapter-reader').first()).toBeVisible()
    await expect(details).not.toBeVisible()
  })
}

test('graph desktop defaults to map and translates node metadata', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await setupGraph(page, 'zh')
  await page.getByTestId('workspace-chapter-view-toggle').getByRole('button', { name: '图谱' }).click()
  const browser = page.getByTestId('chapter-graph-browser')
  await expect(browser.getByTestId('graph-map')).toBeVisible()
  await expect(browser.locator('.react-flow__node').first()).toContainText('核心实体')
  await expect(browser.locator('.react-flow__node').first()).toContainText('相关度')
  await browser.locator('.react-flow__node').first().click()
  await expect(browser.getByText('活跃', { exact: true })).toBeVisible()
  await expect(browser.getByRole('dialog')).toHaveCount(0)
  fs.mkdirSync(evidenceDirectory, { recursive: true })
  await page.screenshot({ animations: 'disabled', path: path.join(evidenceDirectory, 'graph-desktop.png'), fullPage: true })
})
