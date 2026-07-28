import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { createDefaultAISettings } from '@/lib/ai-settings'
import type { AISettings } from '@/lib/types'

const fixturePath = path.join(process.cwd(), 'scripts/fixtures/workspace-import-smoke.txt')
const evidenceDirectory = path.join(process.cwd(), '.sisyphus/evidence/task-10-knowledge-ui')

async function expandKnowledgeDetails(page: Page) {
  const summary = page.getByTestId('workspace-knowledge-status')
  await expect(summary).toBeVisible()
  await expect(summary).toContainText(/故事分析|Story analysis/)
  await expect(summary).toContainText(/内容检索准备|Content search preparation/)
  await expect(summary).not.toContainText(/HanLP|LLM|Embedding|LanceDB|Ollama|provider|model/i)
  await expect(page.getByTestId('workspace-knowledge-advanced-details')).toHaveCount(0)
  await page.getByRole('button', { name: /高级详情|Advanced details/i }).click()
  await expect(page.getByTestId('workspace-knowledge-advanced-details')).toBeVisible()
}

test('knowledge workspace shows phase-local progress, advanced HanLP diagnostics, cache state, and character tiers', async ({ page }) => {
  fs.mkdirSync(evidenceDirectory, { recursive: true })

  await page.route('**/api/knowledge-view*', async (route) => {
    const requestUrl = new URL(route.request().url())
    const novelId = requestUrl.searchParams.get('novelId') ?? 'novel-001'

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        localOutlines: [],
        localCharacterRelations: [],
        localWorldEntries: [],
        localTimelineEvents: [],
        localCharacters: [
          {
            id: 'char-tier-0',
            novelId,
            name: '林砚',
            role: '主角',
            goal: '查清真相',
            trait: '冷静',
            note: '总是先看局势。',
            aliases: ['阿砚'],
            importanceTier: 'protagonist',
            classificationKey: 'tier0',
            classificationLabel: 'Tier 0',
            profile: {
              identity: { summary: '被卷入旧案的书生' },
              capability: { summary: '洞察布局' },
            },
          },
          {
            id: 'char-tier-1',
            novelId,
            name: '苏九',
            role: '重要配角',
            goal: '护住城中暗线',
            trait: '果决',
            note: '擅长先手。',
            aliases: ['九姑娘'],
            importanceTier: 'important',
            classificationKey: 'tier1',
            classificationLabel: 'Tier 1',
            profile: {
              identity: { summary: '暗线联络人' },
              speakingStyle: { summary: '说话极稳' },
            },
          },
          {
            id: 'char-tier-2',
            novelId,
            name: '灰袍老人',
            role: '篇章配角',
            goal: '看住旧祭坛',
            trait: '沉默',
            note: '只在这一卷高频出现。',
            aliases: [],
            importanceTier: 'arc',
            classificationKey: 'tier2',
            classificationLabel: 'Tier 2',
            profile: {
              identity: { summary: '守着祭坛的老人' },
            },
          },
        ],
        knowledgeRebuildStatus: {
          jobId: 'job-knowledge-ui',
          novelId,
          jobType: 'extract_chapter_knowledge',
          status: 'running',
          progress: 0.46,
          currentStep: 'HanLP 引导扫描',
          createdAt: '2026-05-20T12:00:00.000Z',
          updatedAt: '2026-05-20T12:01:00.000Z',
          etaMinutes: null,
          steps: [
            {
              key: 'hanlp-bootstrap',
              label: 'HanLP 引导扫描',
              status: 'running',
              progress: 0.5,
              etaMinutes: null,
              detail: '扫描第 2 / 4 章',
            },
            {
              key: 'extract',
              label: '章节抽取',
              status: 'pending',
              progress: 0,
              etaMinutes: null,
              detail: null,
            },
            {
              key: 'raw-embedding',
              label: '原文 Embedding 预计算',
              status: 'pending',
              progress: 0.35,
              etaMinutes: null,
              detail: '原文向量缓存 35%',
            },
          ],
          rawTextEmbeddingProgress: 0.35,
          rawTextEmbeddingCacheHitRate: 0.2,
          hanlpCacheStatus: 'running',
          hanlpCacheHitRate: 0.75,
          hanlpBootstrapProgress: 0.5,
          hanlpBootstrapCompletedChapterCount: 2,
          hanlpBootstrapTotalChapterCount: 4,
          hanlpBootstrapCacheHitCount: 3,
          hanlpBootstrapCacheMissCount: 1,
          hanlpBootstrapInitializedCharacterEntities: true,
          hanlpSettingsSnapshot: {
            hanlpScriptVersionHash: 'scriptabcdef123456',
            hanlpModelOrConfigHash: 'configfedcba654321',
            outputSchemaVersion: 'v1',
            pipelineVersion: 'knowledge-hanlp-v1',
          },
          stageTimingsMs: {
            'hanlp-bootstrap': 48000,
            raw_text_precompute: 12000,
          },
          embeddingSettingsSnapshot: {
            provider: 'ollama',
            model: 'qwen3-embedding:4b',
            embeddingBatchSize: 32,
          },
        },
        knowledgeStatusOverview: {
          knowledgeGraph: { status: 'partial', coveredChapterCount: 2, totalChapterCount: 4, validThroughChapterNo: 2 },
          extractionCache: { status: 'partial', coveredChapterCount: 2, totalChapterCount: 4, validThroughChapterNo: 2 },
          embeddingCache: { status: 'partial', coveredChapterCount: 1, totalChapterCount: 4, validThroughChapterNo: 1, provider: 'ollama', model: 'qwen3-embedding:4b' },
          retrievalIndex: { status: 'missing', indexedScopeCount: 0, task: null },
        },
      }),
    })
  })

  await page.goto('/library', { waitUntil: 'networkidle' })
  await expect(page.getByText('导入 TXT 小说')).toBeVisible()

  const importResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/import-txt') && response.request().method() === 'POST'
  )

  await page.locator('input[type=file]').setInputFiles(fixturePath)
  const importResponse = await importResponsePromise
  expect(importResponse.ok()).toBeTruthy()

  await page.goto('/workspace', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('progressbar')).toHaveCount(1)
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
  await expect(page.getByTestId('workspace-knowledge-status')).toContainText('50%')
  await expect(page.getByTestId('workspace-knowledge-status')).not.toContainText('46%')
  await expandKnowledgeDetails(page)
  await expect(page.getByRole('progressbar')).toHaveCount(1)

  await expect(page.getByTestId('workspace-hanlp-bootstrap-card')).toContainText('HanLP Bootstrap')
  await expect(page.getByTestId('workspace-hanlp-bootstrap-card')).toContainText('完成章节：2 / 4')
  await expect(page.getByTestId('workspace-hanlp-bootstrap-card')).toContainText('缓存命中率：75%')
  await expect(page.getByTestId('workspace-hanlp-bootstrap-card')).toContainText('当前阶段：扫描第 2 / 4 章')
  await expect(page.getByTestId('workspace-hanlp-bootstrap-card')).toContainText('预估剩余：计算中')
  await expect(page.getByTestId('workspace-hanlp-bootstrap-card')).toContainText('阶段耗时：48 秒')
  await expect(page.getByTestId('workspace-raw-embedding-card')).toContainText('原文 Embedding 预计算')
  await expect(page.getByTestId('workspace-raw-embedding-card')).toContainText('与抽取并行')
  await expect(page.getByTestId('workspace-raw-embedding-card')).toContainText('缓存命中率：20%')
  await expect(page.getByTestId('workspace-raw-embedding-card')).toContainText('阶段耗时：12 秒')
  await expect(page.getByTestId('workspace-raw-embedding-card')).toContainText('Ollama · qwen3-embedding:4b · batch 32')
  await expect(page.getByTestId('workspace-hanlp-cache-card')).toContainText(/HanLP (cache|缓存)/i)
  await expect(page.getByRole('button', { name: '删除 HanLP 缓存' })).toBeDisabled()
  await expect(page.getByTestId('workspace-hanlp-cache-card')).toContainText('当前知识重建任务仍在进行中或已暂停，需先终止或完成当前重建后才能删除缓存。')

  await page.screenshot({
    path: path.join(evidenceDirectory, 'task-10-hanlp-progress-ui.png'),
    fullPage: true,
  })

  await page.getByRole('button', { name: '人物' }).click()
  await expect(page.getByText(/Tier 0/i)).toBeVisible()
  await expect(page.getByText(/Tier 1/i)).toBeVisible()
  await expect(page.getByText(/Tier 2/i)).toBeVisible()

  await page.screenshot({
    path: path.join(evidenceDirectory, 'task-10-tier-labels-ui.png'),
    fullPage: true,
  })
})

test('knowledge workspace shows LanceDB Refresh progress inline', async ({ page }) => {
  fs.mkdirSync(evidenceDirectory, { recursive: true })

  const novelId = 'novel-001'
  let retrievalRefreshQueued = false

  const buildKnowledgePayload = () => ({
    ok: true,
    localOutlines: [],
    localCharacterRelations: [],
    localWorldEntries: [],
    localTimelineEvents: [],
    localCharacters: [],
    knowledgeRebuildStatus: retrievalRefreshQueued
      ? {
          jobId: 'job-lancedb-refresh',
          novelId,
          jobType: 'rebuild_retrieval_index',
          status: 'running',
          progress: 0.95,
          currentStep: '等待原文 Embedding 预计算完成',
          createdAt: '2026-05-20T12:00:00.000Z',
          updatedAt: '2026-05-20T12:01:00.000Z',
          etaMinutes: 2,
          chapterRange: { startChapter: 1, endChapter: 3 },
          steps: [
            {
              key: 'raw-embedding',
              label: '原文 Embedding 预计算',
              status: 'running',
              progress: 0.5,
              etaMinutes: 2,
              detail: '原文向量缓存 50%',
            },
            {
              key: 'index',
              label: '构建 Lance 检索索引',
              status: 'pending',
              progress: 0,
              etaMinutes: null,
              detail: null,
            },
          ],
          rawTextEmbeddingProgress: 0.5,
          rawTextEmbeddingCacheHitRate: 0.33,
          embeddingSettingsSnapshot: {
            provider: 'ollama',
            model: 'qwen3-embedding:4b',
            embeddingBatchSize: 32,
          },
        }
      : null,
    hanlpCacheSnapshot: null,
    knowledgeStatusOverview: {
      knowledgeGraph: {
        status: 'full',
        coveredChapterCount: 3,
        totalChapterCount: 3,
        validThroughChapterNo: 3,
      },
      extractionCache: {
        status: 'full',
        coveredChapterCount: 3,
        totalChapterCount: 3,
        validThroughChapterNo: 3,
      },
      embeddingCache: {
        status: retrievalRefreshQueued ? 'partial' : 'partial',
        coveredChapterCount: retrievalRefreshQueued ? 2 : 1,
        totalChapterCount: 3,
        validThroughChapterNo: retrievalRefreshQueued ? 2 : 1,
        provider: 'ollama',
        model: 'qwen3-embedding:4b',
      },
      retrievalIndex: {
        status: 'partial',
        indexedScopeCount: 1,
        chapterRange: { startChapter: 1, endChapter: 1 },
        task: retrievalRefreshQueued
          ? {
              jobId: 'job-lancedb-refresh',
              novelId,
              jobType: 'rebuild_retrieval_index',
              status: 'running',
              progress: 0.95,
              currentStep: '等待原文 Embedding 预计算完成',
              createdAt: '2026-05-20T12:00:00.000Z',
              updatedAt: '2026-05-20T12:01:00.000Z',
              etaMinutes: 2,
              chapterRange: { startChapter: 1, endChapter: 3 },
              steps: [
                {
                  key: 'raw-embedding',
                  label: '原文 Embedding 预计算',
                  status: 'running',
                  progress: 0.5,
                  etaMinutes: 2,
                  detail: '原文向量缓存 50%',
                },
              ],
              rawTextEmbeddingProgress: 0.5,
              rawTextEmbeddingCacheHitRate: 0.33,
            }
          : null,
      },
    },
    jobOutcome: retrievalRefreshQueued ? 'running' : null,
    actionError: null,
  })

  await page.route('**/api/knowledge-view*', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { action?: string }
      expect(body.action).toBe('rebuild-retrieval-index')
      retrievalRefreshQueued = true
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildKnowledgePayload()),
    })
  })

  await page.goto('/library', { waitUntil: 'networkidle' })
  await expect(page.getByText('导入 TXT 小说')).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(fixturePath)
  await page.waitForResponse((response) => response.url().includes('/api/import-txt') && response.request().method() === 'POST')

  await page.goto('/workspace', { waitUntil: 'networkidle' })
  await expandKnowledgeDetails(page)
  const overviewCard = page.getByTestId('workspace-knowledge-status-overview-card')
  await expect(overviewCard).toContainText('Embedding 缓存')
  await expect(overviewCard).toContainText('已连续覆盖到第 1 章')
  await expect(overviewCard).toContainText('LanceDB 当前只覆盖 前 1 章')
  await expect(overviewCard.getByRole('button', { name: /Refresh|刷新/i })).toBeVisible()

  await overviewCard.getByRole('button', { name: /Refresh|刷新/i }).click()

  await expect(overviewCard).toContainText('后台正在预热原文 Embedding，完成后会自动刷新 LanceDB')
  await expect(overviewCard).toContainText('任务状态：进行中')
  await expect(overviewCard).toContainText('阶段：原文向量缓存 50%')
  await expect(overviewCard).not.toContainText('95%')
  await expect(page.getByTestId('workspace-knowledge-status')).not.toContainText('95%')
  await expect(page.getByTestId('workspace-knowledge-status')).toContainText('50%')
  await expect(page.getByRole('progressbar')).toHaveCount(1)
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
  await expect(overviewCard.getByRole('button', { name: /Pause|暂停/i })).toBeVisible()
  await expect(overviewCard.getByRole('button', { name: /Abort|终止/i })).toBeVisible()
  await expect(page.getByTestId('workspace-embedding-cache-card')).toContainText('缓存命中率：33%')
  await expect(page.getByTestId('workspace-embedding-cache-card')).toContainText('Ollama · qwen3-embedding:4b · batch 32')

  await page.screenshot({
    path: path.join(evidenceDirectory, 'task-10-lancedb-refresh-progress-ui.png'),
    fullPage: true,
  })
})

test('knowledge workspace keeps cache controls visible against the real backend', async ({ page }) => {
  fs.mkdirSync(evidenceDirectory, { recursive: true })

  await page.goto('/library', { waitUntil: 'networkidle' })
  await expect(page.getByText('导入 TXT 小说')).toBeVisible()

  const importResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/import-txt') && response.request().method() === 'POST'
  )
  await page.locator('input[type=file]').setInputFiles(fixturePath)
  const importResponse = await importResponsePromise
  expect(importResponse.ok()).toBeTruthy()

  const knowledgeResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/knowledge-view') && response.request().method() === 'GET'
  )
  await page.goto('/workspace', { waitUntil: 'networkidle' })
  const knowledgeResponse = await knowledgeResponsePromise
  expect(knowledgeResponse.ok()).toBeTruthy()
  await expandKnowledgeDetails(page)

  await expect(page.getByTestId('workspace-hanlp-cache-card')).toBeVisible()
  await expect(page.getByTestId('workspace-delete-hanlp-cache')).toBeVisible()
  await expect(page.getByTestId('workspace-delete-extraction-cache')).toBeVisible()
  await expect(page.getByTestId('workspace-delete-embedding-cache')).toBeVisible()

  await page.screenshot({
    path: path.join(evidenceDirectory, 'task-9-real-backend-cache-controls-ui.png'),
    fullPage: true,
  })
})

test('knowledge workspace stops polling when no job is active', async ({ page }) => {
  fs.mkdirSync(evidenceDirectory, { recursive: true })

  let knowledgeStatusRequestCount = 0
  let extractionDeleted = false
  let embeddingDeleted = false

  await page.route('**/api/knowledge-view*', async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      knowledgeStatusRequestCount += 1
    } else {
      const body = route.request().postDataJSON() as { action?: string }
      if (body.action === 'delete-extraction-cache') extractionDeleted = true
      if (body.action === 'delete-embedding-cache') embeddingDeleted = true
    }

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
        knowledgeStatusOverview: {
          knowledgeGraph: { status: 'full', coveredChapterCount: 64, totalChapterCount: 64, validThroughChapterNo: 64 },
          extractionCache: extractionDeleted
            ? { status: 'missing', coveredChapterCount: 0, totalChapterCount: 64, validThroughChapterNo: null }
            : { status: 'full', coveredChapterCount: 64, totalChapterCount: 64, validThroughChapterNo: 64 },
          embeddingCache: embeddingDeleted
            ? { status: 'missing', coveredChapterCount: 0, totalChapterCount: 64, validThroughChapterNo: null, provider: null, model: null }
            : { status: 'full', coveredChapterCount: 64, totalChapterCount: 64, validThroughChapterNo: 64, provider: 'ollama', model: 'qwen3-embedding:4b' },
          retrievalIndex: { status: 'full', indexedScopeCount: 64, chapterRange: null, task: null },
        },
        jobOutcome: method === 'POST' ? 'deleted' : null,
        actionError: null,
      }),
    })
  })

  await page.goto('/library', { waitUntil: 'networkidle' })
  await expect(page.getByText('导入 TXT 小说')).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(fixturePath)
  await page.waitForResponse((response) => response.url().includes('/api/import-txt') && response.request().method() === 'POST')

  await page.goto('/workspace', { waitUntil: 'networkidle' })
  await expandKnowledgeDetails(page)
  await expect(page.getByTestId('workspace-knowledge-status-overview-card')).toBeVisible()
  await expect(page.getByTestId('workspace-extraction-cache-card')).toContainText('64')
  await expect(page.getByTestId('workspace-embedding-cache-card')).toContainText('64')
  await expect(page.getByTestId('workspace-embedding-cache-card')).not.toContainText('100%')
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await expect(page.getByTestId('workspace-embedding-cache-card')).not.toContainText('缓存命中率')
  await expect(page.getByTestId('workspace-embedding-cache-card')).not.toContainText('阶段耗时')
  await expect(page.getByTestId('workspace-embedding-cache-card')).toContainText('Ollama · qwen3-embedding:4b')
  const initialRequestCount = knowledgeStatusRequestCount

  await page.waitForTimeout(4000)

  expect(knowledgeStatusRequestCount).toBe(initialRequestCount)

  await page.getByTestId('workspace-delete-extraction-cache').click()
  await page.getByRole('button', { name: '确认删除 LLM 抽取缓存' }).click()
  await expect(page.getByTestId('workspace-extraction-cache-card')).toContainText('0 / 64')
  await expect(page.getByTestId('workspace-extraction-cache-card')).toContainText('缺失')

  await page.getByTestId('workspace-delete-embedding-cache').click()
  await page.getByRole('button', { name: '确认删除原文 Embedding 缓存' }).click()
  await expect(page.getByTestId('workspace-embedding-cache-card')).toContainText('0 / 64')
  await expect(page.getByTestId('workspace-embedding-cache-card')).toContainText('缺失')
  await expect(page.getByTestId('workspace-embedding-cache-card')).not.toContainText('Ollama · qwen3-embedding:4b')
})

test('saving AI settings waits for the current full knowledge projection refresh', async ({ page }) => {
  let aiSettings: AISettings = createDefaultAISettings()
  let postedEmbeddingModel: string | null = null
  let settingsSaved = false
  let refreshedRequest: { novelId: string; asOfChapter: string | null } | null = null
  let releaseProjectionRefresh: (() => void) | null = null
  let markProjectionRefreshStarted: (() => void) | null = null
  const projectionRefreshStarted = new Promise<void>((resolve) => {
    markProjectionRefreshStarted = resolve
  })

  await page.route('**/api/settings/ai', async (route) => {
    if (route.request().method() === 'POST') {
      aiSettings = route.request().postDataJSON() as AISettings
      postedEmbeddingModel = aiSettings.embeddings.ollama.model
      settingsSaved = true
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
      return
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(aiSettings) })
  })

  await page.route('**/api/knowledge-view*', async (route) => {
    const requestUrl = new URL(route.request().url())
    const novelId = requestUrl.searchParams.get('novelId') ?? ''
    const isFullProjection = requestUrl.searchParams.get('statusOnly') !== '1'

    if (settingsSaved && isFullProjection) {
      refreshedRequest = { novelId, asOfChapter: requestUrl.searchParams.get('asOfChapter') }
      markProjectionRefreshStarted?.()
      await new Promise<void>((resolve) => {
        releaseProjectionRefresh = resolve
      })
    }

    const embeddingCache = settingsSaved && isFullProjection
      ? { status: 'missing', coveredChapterCount: 0, totalChapterCount: 1, validThroughChapterNo: null, provider: null, model: null }
      : { status: 'full', coveredChapterCount: 1, totalChapterCount: 1, validThroughChapterNo: 1, provider: 'ollama', model: 'qwen3-embedding:4b' }

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
        knowledgeStatusOverview: {
          knowledgeGraph: { status: 'full', coveredChapterCount: 1, totalChapterCount: 1, validThroughChapterNo: 1 },
          extractionCache: { status: 'full', coveredChapterCount: 1, totalChapterCount: 1, validThroughChapterNo: 1 },
          embeddingCache,
          retrievalIndex: { status: 'full', indexedScopeCount: 1, task: null },
        },
        jobOutcome: null,
        actionError: null,
      }),
    })
  })

  await page.goto('/library', { waitUntil: 'networkidle' })
  await page.locator('input[type=file]').setInputFiles(fixturePath)
  await page.waitForResponse((response) => response.url().includes('/api/import-txt') && response.request().method() === 'POST')
  await page.goto('/workspace', { waitUntil: 'networkidle' })
  await expandKnowledgeDetails(page)

  const embeddingCard = page.getByTestId('workspace-embedding-cache-card')
  await expect(embeddingCard).toContainText('qwen3-embedding:4b')

  const settingsButton = page.getByTestId('preset-compat-library-open').locator('xpath=following-sibling::button[1]')
  await settingsButton.click()
  const settingsHeading = page.getByRole('heading', { name: /模型服务配置|Model service settings/ })
  await expect(settingsHeading).toBeVisible()

  const embeddingScenario = page.getByRole('heading', { name: /Embedding 场景|Embedding scenario/ }).locator('..').locator('..').locator('..')
  const changedEmbeddingModel = 'nomic-embed-text:settings-refresh'
  const embeddingModelInput = embeddingScenario.getByPlaceholder('nomic-embed-text')
  await embeddingModelInput.fill(changedEmbeddingModel)
  await expect(embeddingModelInput).toHaveValue(changedEmbeddingModel)

  await page.getByRole('button', { name: /保存设置|Save settings/ }).click()
  await projectionRefreshStarted

  expect(postedEmbeddingModel).toBe(changedEmbeddingModel)
  expect(refreshedRequest).toEqual({ novelId: expect.stringMatching(/^novel[_-]/), asOfChapter: '1' })
  await expect(settingsHeading).toBeVisible()
  await expect(embeddingCard).toContainText('qwen3-embedding:4b')

  releaseProjectionRefresh?.()

  await expect(embeddingCard).toContainText('0 / 1')
  await expect(embeddingCard).toContainText(/缺失|Missing/)
  await expect(embeddingCard).not.toContainText('qwen3-embedding:4b')
  await expect(settingsHeading).toHaveCount(0)
})


test('knowledge status keeps truthful fallback, queued, redacted, and mobile target semantics', async ({ page }) => {
  let operationStatus: 'running' | 'queued' = 'running'

  await page.route('**/api/knowledge-view*', async (route) => {
    const requestUrl = new URL(route.request().url())
    const novelId = requestUrl.searchParams.get('novelId') ?? 'novel-001'
    const diagnostic = 'Retry provider request Authorization: Bearer browser-secret token=browser-token at /Users/alice/private/job.ts\n    at run (/Users/alice/private/job.ts:42:9)'
    const job = {
      jobId: 'job-truthful-progress',
      novelId,
      jobType: 'extract_chapter_knowledge',
      status: operationStatus,
      progress: 0.63,
      currentStep: diagnostic,
      errorMessage: null,
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:01.000Z',
      etaMinutes: null,
      steps: [],
    }

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
        knowledgeRebuildStatus: job,
        hanlpCacheSnapshot: null,
        knowledgeStatusOverview: {
          knowledgeGraph: { status: 'full', coveredChapterCount: 4, totalChapterCount: 4, validThroughChapterNo: 4 },
          extractionCache: { status: 'full', coveredChapterCount: 4, totalChapterCount: 4, validThroughChapterNo: 4 },
          embeddingCache: { status: 'full', coveredChapterCount: 4, totalChapterCount: 4, validThroughChapterNo: 4, provider: 'ollama', model: 'qwen3-embedding:4b' },
          retrievalIndex: { status: 'partial', indexedScopeCount: 63, task: null },
        },
        jobOutcome: operationStatus,
        actionError: null,
      }),
    })
  })

  await page.goto('/library', { waitUntil: 'networkidle' })
  await page.locator('input[type=file]').setInputFiles(fixturePath)
  await page.waitForResponse((response) => response.url().includes('/api/import-txt') && response.request().method() === 'POST')
  await page.goto('/workspace', { waitUntil: 'domcontentloaded' })

  const summary = page.getByTestId('workspace-knowledge-status')
  await expect(summary).toContainText('63%')
  await expect(summary).toContainText(/部分覆盖|Partial coverage/)
  await expect(page.getByRole('progressbar', { name: /后台任务整体进度|Overall background job progress/ })).toHaveAttribute('aria-valuenow', '63')
  await expect(page.getByRole('progressbar')).toHaveCount(1)
  await expect(summary).not.toContainText(/browser-secret|browser-token|\/Users\/alice|job\.ts:42/i)

  await expandKnowledgeDetails(page)
  const advanced = page.getByTestId('workspace-knowledge-advanced-details')
  await expect(advanced).toContainText('Retry provider request')
  await expect(advanced).toContainText('[REDACTED]')
  await expect(advanced).not.toContainText(/browser-secret|browser-token|\/Users\/alice|job\.ts:42/i)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: /更多选项|More options/ }).click()
  await page.getByRole('button', { name: /打开知识状态|Open knowledge status/ }).click()
  await page.getByRole('button', { name: /高级详情|Advanced details/i }).click()
  const mobileAdvanced = page.getByTestId('workspace-knowledge-advanced-details')
  await expect(mobileAdvanced).toBeVisible()
  const undersizedTargets = await mobileAdvanced.locator('button, input, select').evaluateAll((controls) => controls
    .map((control) => ({ text: control.textContent, height: control.getBoundingClientRect().height }))
    .filter((control) => control.height < 44))
  expect(undersizedTargets).toEqual([])

  operationStatus = 'queued'
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /更多选项|More options/ }).click()
  await page.getByRole('button', { name: /打开知识状态|Open knowledge status/ }).click()
  await expect(page.getByTestId('workspace-knowledge-status')).toContainText(/已排队|Queued/)
  await expect(page.getByTestId('workspace-knowledge-status')).not.toContainText('0%')
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await page.getByRole('button', { name: /高级详情|Advanced details/i }).click()
  await expect(page.getByTestId('workspace-knowledge-advanced-details')).toContainText(/本地知识图谱重建已排队|Local knowledge graph rebuild queued/)
})
