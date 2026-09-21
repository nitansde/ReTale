// Run from the repository root while `npm run dev:test` is listening on port 3000.
// Screenshots use the real mobile UI with authored, bilingual API fixtures.
// No manuscript, saved settings, model provider, or production data is accessed.
import fs from 'node:fs/promises'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { chromium, expect } from '@playwright/test'
import { registerTypeScriptHooks } from './typescript-runtime.mjs'

await registerTypeScriptHooks()
const bundledPreset = await fs.readFile('config/presets/retale-default-zh-CN.json', 'utf8')
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/config/presets/retale-default-zh-CN.json') {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(`export default ${bundledPreset}`)}` }
    }
    return nextResolve(specifier, context)
  },
})
const { mockNovelResourceApi } = await import('../tests/helpers/novel-resource-api-mock.ts')
const { createDefaultAISettings } = await import('../lib/ai-settings.ts')
const { createDefaultPresetCompatLibrary } = await import('../lib/preset-compat/surface-contract.ts')
const { countChineseFriendlyWords } = await import('../lib/utils.ts')

const baseURL = 'http://127.0.0.1:3000'
const output = path.resolve('docs/images')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch()

try {
  for (const locale of ['zh', 'en']) {
    const zh = locale === 'zh'
    const choose = (chinese, english) => zh ? chinese : english
    const title = choose('雾城来信', 'Letters from the Mist')
    const chapterTitles = choose(['第一章 雨夜来信', '第二章 渡口之约', '第三章 灯塔重逢'], ['Chapter 1 · The Letter', 'Chapter 2 · The Crossing', 'Chapter 3 · The Lighthouse'])
    const paragraphs = choose([
      '沈遥把信推过桌面：“末班渡船开走前，你还有一次选择。”',
      '窗外的雨落在青石阶上。林舟认出信封上的字迹，却没有伸手。三年前，父亲留下的最后一封信，也是这样用蓝线缠着。',
      '“我一个人去。”他说。',
      '沈遥收起伞，倚在门边。她没有劝他，只把第二张船票压在油灯下面。灯火透过薄纸，照出背面的一行小字：不要相信守塔的人。',
      '远处传来汽笛声。林舟抬起头，第一次发现她的衣袖已经湿透。',
      '他终于拿起了信。封口里藏着半片铜钥匙，断面参差，像是被人仓促折开。',
      '“另外一半呢？”',
      '沈遥望向河对岸。浓雾之中，灯塔的光忽然熄了。',
    ], [
      'Shen slid the letter across the table. “You still have a choice, until the last ferry leaves.”',
      'Rain tapped the stone steps. Lin knew the handwriting, but kept his hands still. His father’s last letter had been tied with the same blue thread.',
      '“I’m going alone,” he said.',
      'Shen folded her umbrella. Without arguing, she placed a second ticket beneath the lamp. Its light revealed a note on the back: Do not trust the lighthouse keeper.',
      'A ferry horn sounded. Lin looked up and noticed her sleeves were soaked through.',
      'He opened the letter. Inside lay half a brass key, snapped roughly in two.',
      '“Where is the other half?”',
      'Shen turned toward the river. Across the water, the lighthouse went dark.',
    ])
    const instruction = choose('让林舟决定和沈遥一起赴约。保留铜钥匙的伏笔，用动作表现他从戒备到信任的转变。', 'Have Lin invite Shen to go with him. Keep the brass-key clue, and show his growing trust through small actions.')
    const novelId = 'readme-demo'
    const branchId = `${novelId}:main`
    const chapters = chapterTitles.map((chapterTitle, index) => ({
      id: `readme-chapter-${index + 1}`, novelId, title: chapterTitle, order: index + 1,
      content: paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join(''),
      status: 'draft', wordCount: countChineseFriendlyWords(paragraphs.join('\n')), updatedAt: '2026-09-20',
    }))
    const workspace = { currentNovelId: novelId, currentChapterId: chapters[0].id, localNovels: [{ id: novelId, title, summary: '', tags: [] }], localChapters: chapters }
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: zh ? 'zh-CN' : 'en-US', reducedMotion: 'reduce' })
    await context.addCookies([{ name: 'retale.locale', value: locale, domain: '127.0.0.1', path: '/' }])
    const page = await context.newPage()
    const errors = []
    const unexpected = []
    page.on('pageerror', (error) => errors.push(error.message))
    // Catch every API request before registering specific fixtures. Unexpected calls fail closed.
    await page.route('**/api/**', async (route) => {
      unexpected.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
      await route.fulfill({ status: 501, json: { error: 'No README fixture for this request' } })
    })
    await mockNovelResourceApi(page, () => workspace)
    const ai = createDefaultAISettings()
    for (const scenario of ['rewrite', 'knowledgeExtraction']) {
      ai[scenario].openAICompatible = { ...ai[scenario].openAICompatible, baseUrl: 'https://readme.invalid/v1', model: 'demo-model', apiKeyConfigured: true, configured: true }
    }
    await page.route('**/api/settings/ai', (route) => route.fulfill({ json: ai }))
    await page.route('**/api/settings/preset-compat', (route) => route.fulfill({ json: createDefaultPresetCompatLibrary() }))
    await page.route('**/api/writing-skills?*', (route) => route.fulfill({ json: { cards: [] } }))
    await page.route('**/api/rewrite*', (route) => route.fulfill({ json: { ok: true, job: null } }))
    const coverage = { status: 'full', coveredChapterCount: 3, totalChapterCount: 3, validThroughChapterNo: 3 }
    await page.route('**/api/knowledge-view*', (route) => route.fulfill({ json: {
      ok: true, localOutlines: [], localCharacterRelations: [], localWorldEntries: [], localTimelineEvents: [], localCharacters: [], knowledgeRebuildStatus: null, hanlpCacheSnapshot: null,
      knowledgeStatusOverview: { knowledgeGraph: coverage, extractionCache: coverage, embeddingCache: { ...coverage, provider: null, model: null }, retrievalIndex: { status: 'full', indexedScopeCount: 3, task: null } },
    } }))
    const branchNodes = [
      { nodeType: 'rewrite', title: choose('这一次，一起赴约', 'This time, together'), parentNodeId: null, continueBlockId: 'demo-rewrite' },
      { nodeType: 'continue_block', title: choose('渡船上的第二封信', 'A second letter on the ferry'), parentNodeId: 'readme-branch-0', continueBlockId: 'demo-continue' },
      { nodeType: 'what_if', title: choose('如果他选择留下', 'What if he stayed?'), parentNodeId: null, whatIfSessionId: 'demo-if' },
    ].map((node, index) => ({ type: 'branch_node', id: `readme-branch-${index}`, anchorChapterNo: 1, subtitle: null, laneIndex: 0, colorToken: null, sourceChapterNo: null, targetChapterNo: null, continueBlockId: null, whatIfSessionId: null, futureJumpRunId: null, status: 'active', ...node }))
    await page.route('**/api/story-timeline*', (route) => route.fulfill({ json: { novelId, branchId, chapters: chapters.map((chapter) => ({ type: 'chapter', chapterNo: chapter.order, chapterId: chapter.id, title: chapter.title, wordCount: chapter.wordCount })), branchNodes, edges: [{ fromNodeId: 'readme-branch-0', toNodeId: 'readme-branch-1' }] } }))
    const names = choose(['林舟', '沈遥', '雾城'], ['Lin', 'Shen', 'Mist City'])
    const nodes = names.map((label, index) => ({ id: `entity-${index}`, label, entityType: index === 2 ? 'location' : 'character', status: 'active', importance: 5 - index, confidence: 0.96, userConfirmed: true, score: 8 - index, firstSeenChapter: 1 }))
    const edge = { id: 'demo-relationship', source: nodes[0].id, target: nodes[1].id, linkType: 'ally', description: choose('沈遥带来父亲旧案的线索，并为林舟准备了第二张船票。', 'Shen brings a clue about Lin’s father and leaves a second ferry ticket for him.'), strength: 4, confidence: 0.96, validFromChapter: 1, validUntilChapter: 2147483647, status: 'user_confirmed', hop: 1, score: 8, includeInPrompt: true, evidenceQuote: paragraphs[3], evidenceLocation: { chapterNo: 1, lineStart: 4, lineEnd: 4 } }
    const graphContext = { seedEntities: [nodes[0]], nodes, edges: [edge], contextText: edge.description, warnings: [], tokenEstimate: 280, status: 'ready' }
    await page.route('**/api/rag/graph-context*', (route) => route.fulfill({ json: { ok: true, novelId, branchId, chapterId: chapters[0].id, chapterNo: 1, chapterTitle: chapterTitles[0], warnings: [], graphContext, lanceEvidence: [], tokenEstimate: 280 } }))
    await page.route('**/api/rag/build-generation-context', (route) => {
      const request = route.request().postDataJSON()
      const systemPrompt = choose('保留人物动机、铜钥匙和灯塔的线索，根据用户要求创作新的章节。', 'Keep the characters’ motives, the brass key, and the lighthouse clue. Write a new chapter following the reader’s direction.')
      const userPrompt = request.userInstruction || instruction
      return route.fulfill({ json: { ok: true, novelId, branchId, chapterId: chapters[0].id, chapterNo: 1, chapterTitle: chapterTitles[0], warnings: [], graphContext, lanceEvidence: [], tokenEstimate: 1280, promptBlocks: [], assembledContext: systemPrompt, systemPrompt, userPrompt, requestMessages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] } })
    })
    const capture = async (name) => {
      await page.evaluate(() => document.fonts.ready)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: path.join(output, `mobile-${name}-${locale}.png`), animations: 'disabled', style: 'nextjs-portal { display: none !important; }' })
    }
    await page.goto(`${baseURL}/workspace`, { waitUntil: 'networkidle' })
    const reader = page.getByTestId('workspace-chapter-reader')
    await expect(reader).toBeVisible()
    await capture('reading')
    await reader.evaluate((element) => {
      const text = element.querySelectorAll('p')[2].firstChild
      const range = document.createRange()
      range.selectNodeContents(text)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    await page.getByTestId('workspace-chapter-rewrite-entry').click()
    const rewrite = page.getByRole('dialog')
    await rewrite.locator('textarea').first().fill(instruction)
    await expect(page.getByTestId('workspace-context-token-estimate')).toContainText('1,280')
    await rewrite.locator('textarea').first().blur()
    await capture('rewrite')
    await rewrite.getByRole('button', { name: choose('关闭', 'Close'), exact: true }).click()
    await page.getByRole('button', { name: choose('打开章节导航', 'Open chapter navigation'), exact: true }).click()
    await expect(page.getByTestId('timeline-chapter-1')).toBeVisible()
    await capture('branches')
    await page.getByRole('button', { name: choose('关闭章节导航', 'Close chapter navigation'), exact: true }).click()
    await page.getByRole('button', { name: choose('更多选项', 'More options'), exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: choose('图谱', 'Graph'), exact: true }).click()
    await page.getByTestId('graph-relation-card').first().click()
    await expect(page.getByTestId('graph-selection-evidence')).toContainText(paragraphs[3])
    await capture('evidence')
    if (errors.length || unexpected.length) throw new Error(JSON.stringify({ locale, errors, unexpected }, null, 2))
    console.log(`Captured four mobile screenshots (${locale}), with no page errors or unhandled API calls.`)
    await context.close()
  }
} finally {
  await browser.close()
}
