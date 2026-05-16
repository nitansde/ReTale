import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { normalizePresetCompatPresetImport, normalizePresetCompatStandaloneRegexImport } from '@/lib/preset-compat/normalize'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'

const fixturePath = path.join(process.cwd(), 'external', 'resets_example.json')
const evidenceDirectory = path.join(process.cwd(), '.sisyphus/evidence')

function buildWorkspacePayload() {
  return {
    currentNovelId: 'novel-001',
    currentChapterId: 'chapter-001',
    currentTab: 'editor',
    helperTab: 'trajectory',
    expandedVolumeIds: ['volume-001'],
    localNovels: [{ id: 'novel-001', title: 'Fixture Novel', summary: 'Preset compat UI fixture', tags: ['fixture'] }],
    localVolumes: [{ id: 'volume-001', novelId: 'novel-001', title: '第一卷', order: 1 }],
    localChapters: [{
      id: 'chapter-001',
      novelId: 'novel-001',
      volumeId: 'volume-001',
      title: '第1章 开场',
      order: 1,
      content: '<p>这里是一段测试正文。</p>',
      originalContent: '<p>这里是一段测试正文。</p>',
      status: 'draft',
      wordCount: 10,
      updatedAt: '2026-05-15',
      trajectory: [],
    }],
    localOutlines: [],
    localCharacters: [],
    localCharacterRelations: [],
    localWorldEntries: [],
    localTimelineEvents: [],
    rewriteCandidates: [],
    rewriteHistory: [],
    trajectories: [],
    rewriteMode: 'rewrite',
    rewriteTone: 'balanced',
    rewriteOutput: 'full',
    rewriteScope: 'chapter',
    selectionText: '',
    selectedParagraphIndex: null,
    thinkingLevel: 'standard',
    autoContinue: false,
    keepCanon: true,
    promptText: '',
    selectedPresetId: '',
    presets: [],
    constraints: [],
    focusMode: false,
    presetCompatSessionState: {
      'chapter:chapter-001::rewrite': {
        surfaceId: 'rewrite',
        phase: 'continue',
        resetPending: false,
      },
    },
    aiSettings: {
      rewrite: {
        provider: 'openai-compatible',
        openAICompatible: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'gpt-4.1-mini' },
        ollama: { baseUrl: 'http://localhost:11434', model: 'qwen3:8b' },
      },
      knowledgeExtraction: {
        provider: 'openai-compatible',
        openAICompatible: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'gpt-4.1-mini' },
        ollama: { baseUrl: 'http://localhost:11434', model: 'qwen3:8b' },
      },
      embeddings: {
        provider: 'openai-compatible',
        openAICompatible: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'text-embedding-3-large' },
        ollama: { baseUrl: 'http://localhost:11434', model: 'nomic-embed-text' },
        embeddingBatchSize: 16,
      },
    },
  }
}

test('workspace preset-compat library modal imports fixture JSON, shows statuses, resets context state, edits bindings, and exports JSON', async ({ page }) => {
  fs.mkdirSync(evidenceDirectory, { recursive: true })
  const fixtureText = fs.readFileSync(fixturePath, 'utf8')
  let library = createDefaultPresetCompatLibrary()
  let presetImportCounter = 0
  let regexImportCounter = 0

  await page.route('**/api/workspace', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) })
      return
    }
    await route.fulfill({ status: 200, body: JSON.stringify(buildWorkspacePayload()) })
  })
  await page.route('**/api/settings/ai', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) })
      return
    }
    await route.fulfill({ status: 200, body: JSON.stringify(buildWorkspacePayload().aiSettings) })
  })
  await page.route('**/api/knowledge-view*', async (route) => {
    await route.fulfill({
      status: 200,
      body: JSON.stringify({
        ok: true,
        localOutlines: [],
        localCharacters: [],
        localCharacterRelations: [],
        localWorldEntries: [],
        localTimelineEvents: [],
        knowledgeRebuildStatus: null,
        jobOutcome: null,
      }),
    })
  })
  await page.route('**/api/story-timeline*', async (route) => {
    await route.fulfill({
      status: 200,
      body: JSON.stringify({
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        chapters: [{ type: 'chapter', chapterNo: 1, chapterId: 'chapter-001', title: '第1章 开场', wordCount: 10 }],
        branchNodes: [],
        edges: [],
      }),
    })
  })
  await page.route('**/api/settings/preset-compat', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { library: typeof library }
      library = {
        ...body.library,
        revision: body.library.revision + 1,
      }
      await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, library }) })
      return
    }
    await route.fulfill({ status: 200, body: JSON.stringify(library) })
  })
  await page.route('**/api/settings/preset-compat/import', async (route) => {
    const body = route.request().postDataJSON() as { kind: 'preset' | 'regex'; jsonText: string; nameHint?: string }

    if (body.kind === 'preset') {
      expect(body.jsonText).toContain('"temperature": 1')
      expect(body.jsonText).toContain('"➡️扩写/转述输入"')
      presetImportCounter += 1
      const { preset, warnings } = normalizePresetCompatPresetImport(JSON.parse(body.jsonText), {
        nameHint: body.nameHint,
        existingNames: Object.values(library.presets).map((entry) => entry.name),
        now: '2026-05-15T00:00:00.000Z',
        idFactory: () => `preset-ui-${presetImportCounter}`,
      })
      library = {
        ...library,
        presets: {
          ...library.presets,
          [preset.id]: preset,
        },
        lastImportedAt: '2026-05-15T00:00:00.000Z',
      }
      await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, library, importedIds: [preset.id], warnings }) })
      return
    }

    const { regexes, warnings } = normalizePresetCompatStandaloneRegexImport(JSON.parse(body.jsonText), {
      existingNames: Object.values(library.standaloneRegexes).map((entry) => entry.name),
      idFactory: () => {
        regexImportCounter += 1
        return `regex-ui-${regexImportCounter}`
      },
    })
    for (const regexRecord of regexes) {
      library = {
        ...library,
        standaloneRegexes: {
          ...library.standaloneRegexes,
          [regexRecord.id]: regexRecord,
        },
      }
    }
    library = {
      ...library,
      lastImportedAt: '2026-05-15T00:00:00.000Z',
    }
    await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, library, importedIds: regexes.map((entry) => entry.id), warnings }) })
  })

  await page.goto('/workspace', { waitUntil: 'networkidle' })
  await page.getByTestId('preset-compat-library-open').click()
  await expect(page.getByTestId('preset-compat-library-modal')).toBeVisible()
  await expect(page.getByText('全局预设兼容库')).toBeVisible()

  await page.getByTestId('preset-compat-preset-import-input').setInputFiles(fixturePath)
  await expect(page.getByRole('button', { name: /resets_example/ }).first()).toBeVisible()

  const importedPreset = library.presets['preset-ui-1']
  expect(importedPreset).toBeDefined()
  const firstRuleId = importedPreset.promptRules[0]?.id
  expect(firstRuleId).toBeTruthy()

  await expect(page.getByTestId('preset-compat-status-surface-rewrite')).toBeVisible()
  const rewriteStatusCard = page.getByTestId('preset-compat-status-surface-rewrite')
  await expect(rewriteStatusCard.getByText('字段', { exact: true })).toBeVisible()
  await expect(page.getByTestId('preset-compat-session-state-rewrite')).toHaveText(/会话阶段：continue · 正常/)
  await expect(rewriteStatusCard.getByText(/上下文窗口：.*route → contextWindow.maxContextTokens/)).toBeVisible()
  await expect(rewriteStatusCard.getByText(/流式策略：开启 · route → stream.enabled/)).toBeVisible()
  await expect(page.getByTestId('preset-compat-session-reset-rewrite')).toBeVisible()
  await expect(page.getByText('不提供重置').first()).toBeVisible()

  await page.getByTestId('preset-compat-session-reset-rewrite').click()
  await expect(page.getByTestId('preset-compat-session-state-rewrite')).toHaveText(/会话阶段：new_chat · 待重置/)

  await page.getByTestId('preset-compat-regex-import-input').setInputFiles({
    name: 'resets-example-regex.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      regex_scripts: [{
        id: 'fixture-regex-1',
        scriptName: 'Fixture standalone regex',
        findRegex: 'hero',
        replaceString: 'protagonist',
        trimStrings: [],
        placement: 2,
        disabled: false,
        markdownOnly: false,
        promptOnly: false,
        runOnEdit: false,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
      }],
    })),
  })
  const firstStandaloneAttachButton = page.locator('[data-testid^="preset-compat-standalone-regex-attach-"]').first()
  await expect(firstStandaloneAttachButton).toBeVisible()
  const firstStandaloneRegexId = Object.keys(library.standaloneRegexes)[0]
  expect(firstStandaloneRegexId).toBeTruthy()

  for (const surfaceId of ['rewrite', 'expand', 'roleplay', 'polish', 'continue', 'future_jump_rewrite']) {
    await page.getByTestId(`preset-compat-binding-${surfaceId}`).selectOption('preset-ui-1')
  }

  await page.getByTestId(`preset-compat-rule-toggle-${firstRuleId}`).uncheck()
  await page.getByTestId(`preset-compat-rule-toggle-${firstRuleId}`).check()
  await page.getByTestId(`preset-compat-rule-content-${firstRuleId}`).fill('Updated from Playwright.')
  await expect(page.getByTestId(`preset-compat-rule-content-${firstRuleId}`)).toHaveValue('Updated from Playwright.')

  await firstStandaloneAttachButton.click()
  await expect(firstStandaloneAttachButton).toContainText('Detach from preset')

  const presetDownloadPromise = page.waitForEvent('download')
  await page.getByTestId('preset-compat-preset-export-preset-ui-1').click()
  const presetDownload = await presetDownloadPromise
  const presetDownloadPath = path.join(evidenceDirectory, 'task-9-preset-export.json')
  await presetDownload.saveAs(presetDownloadPath)
  const exportedPresetJson = JSON.parse(fs.readFileSync(presetDownloadPath, 'utf8')) as Record<string, unknown>
  expect(Array.isArray(exportedPresetJson.prompts)).toBe(true)
  expect(Array.isArray(exportedPresetJson.prompt_order)).toBe(true)

  await page.getByTestId('preset-compat-preset-delete-preset-ui-1').click()
  await expect(page.getByText('已删除预设“resets_example”，并已保存。')).toBeVisible()
  expect(library.presets['preset-ui-1']).toBeUndefined()
  expect(library.surfaceBindings.rewrite.presetId).toBeNull()
  expect(library.surfaceBindings.future_jump_rewrite.presetId).toBeNull()
  expect(Object.keys(library.standaloneRegexes).length).toBeGreaterThan(0)

  await page.getByRole('button', { name: '保存兼容库' }).click()
  await expect(page.getByText('预设兼容库已保存。')).toBeVisible()

  const regexDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出正则包' }).click()
  const regexDownload = await regexDownloadPromise
  const regexDownloadPath = path.join(evidenceDirectory, 'task-9-regex-export.json')
  await regexDownload.saveAs(regexDownloadPath)
  const exportedRegexJson = JSON.parse(fs.readFileSync(regexDownloadPath, 'utf8')) as Record<string, unknown>
  expect(Array.isArray(exportedRegexJson.regex_scripts)).toBe(true)

  await page.getByTestId('preset-compat-regex-import-input').setInputFiles({
    name: 'malformed-regex.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ regex_scripts: [null, { scriptName: 'Broken regex', replaceString: 'x' }] })),
  })
  await expect(page.getByText('Regex entry 1 was not an object and was skipped.')).toBeVisible()
  await expect(page.getByText('resets_example')).toHaveCount(0)

  await page.screenshot({ path: path.join(evidenceDirectory, 'task-9-library-ui.png'), fullPage: true })
})
