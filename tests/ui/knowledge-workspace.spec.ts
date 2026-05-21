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
