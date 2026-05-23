import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'

const fixturePath = path.join(process.cwd(), 'scripts/fixtures/workspace-import-smoke.txt')
const evidenceDirectory = path.join(process.cwd(), '.sisyphus/evidence/task-10-knowledge-ui')

test('knowledge workspace shows HanLP progress, cache state, and character tiers', async ({ page }) => {
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

  await page.goto('/workspace', { waitUntil: 'networkidle' })

  await expect(page.getByTestId('workspace-hanlp-bootstrap-card')).toContainText('HanLP Bootstrap')
  await expect(page.getByTestId('workspace-hanlp-bootstrap-card')).toContainText('完成章节：2 / 4')
  await expect(page.getByTestId('workspace-hanlp-bootstrap-card')).toContainText('缓存命中率：75%')
  await expect(page.getByTestId('workspace-hanlp-bootstrap-card')).toContainText('当前阶段：扫描第 2 / 4 章')
  await expect(page.getByTestId('workspace-hanlp-bootstrap-card')).toContainText('预估剩余：计算中')
  await expect(page.getByTestId('workspace-hanlp-bootstrap-card')).toContainText('阶段耗时：48 秒')
  await expect(page.getByTestId('workspace-raw-embedding-card')).toContainText('原文 Embedding 预计算')
  await expect(page.getByTestId('workspace-raw-embedding-card')).toContainText('与抽取并行')
  await expect(page.getByTestId('workspace-raw-embedding-card')).toContainText('缓存预热进度')
  await expect(page.getByTestId('workspace-raw-embedding-card')).toContainText('35%')
  await expect(page.getByTestId('workspace-raw-embedding-card')).toContainText('缓存命中率：20%')
  await expect(page.getByTestId('workspace-raw-embedding-card')).toContainText('阶段耗时：12 秒')
  await expect(page.getByTestId('workspace-raw-embedding-card')).toContainText('Ollama · qwen3-embedding:4b · batch 32')
  await expect(page.getByTestId('workspace-hanlp-cache-card')).toContainText('HanLP cache')
  await expect(page.getByRole('button', { name: '删除 HanLP 缓存' })).toBeDisabled()
  await expect(page.getByTestId('workspace-hanlp-cache-card')).toContainText('当前知识重建任务仍在进行中或已暂停，需先终止或完成当前重建后才能删除缓存。')

  await page.screenshot({
    path: path.join(evidenceDirectory, 'task-10-hanlp-progress-ui.png'),
    fullPage: true,
  })

  await page.getByRole('button', { name: '人物' }).click()
  await expect(page.getByText('Tier 0 主角')).toBeVisible()
  await expect(page.getByText('Tier 1 重要配角')).toBeVisible()
  await expect(page.getByText('Tier 2 篇章配角')).toBeVisible()

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
  const overviewCard = page.getByTestId('workspace-knowledge-status-overview-card')
  await expect(overviewCard).toContainText('Embedding 缓存')
  await expect(overviewCard).toContainText('已连续覆盖到第 1 章')
  await expect(overviewCard).toContainText('LanceDB 当前只覆盖 前 1 章')
  await expect(overviewCard.getByRole('button', { name: 'Refresh' })).toBeVisible()

  await overviewCard.getByRole('button', { name: 'Refresh' }).click()

  await expect(overviewCard).toContainText('后台正在刷新 LanceDB 检索索引')
  await expect(overviewCard).toContainText('任务状态：进行中')
  await expect(overviewCard).toContainText('95%')
  await expect(overviewCard).toContainText('阶段：原文向量缓存 50%')
  await expect(overviewCard.getByRole('button', { name: 'Pause' })).toBeVisible()
  await expect(overviewCard.getByRole('button', { name: 'Abort' })).toBeVisible()

  await page.screenshot({
    path: path.join(evidenceDirectory, 'task-10-lancedb-refresh-progress-ui.png'),
    fullPage: true,
  })
})
