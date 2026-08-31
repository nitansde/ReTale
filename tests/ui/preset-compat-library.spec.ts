import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { buildPresetCompatCreativeRuntimePreview } from '@/lib/preset-compat/creative-runtime-preview'
import { normalizePresetCompatPresetImport, normalizePresetCompatStandaloneRegexImport } from '@/lib/preset-compat/normalize'
import { PRESET_COMPAT_EDITABLE_SURFACE_REGISTRY_IDS } from '@/lib/preset-compat/surface-contract'
import { resolvePresetCompatRuntime } from '@/lib/preset-compat/resolve-runtime'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import type { PresetCompatLibrary } from '@/lib/preset-compat/types'
import { ensureEvidenceDir, writeEvidenceFile } from '@/tests/helpers/evidence'
import { mockNovelResourceApi } from '@/tests/helpers/novel-resource-api-mock'

const WORKTREE_ROOT = process.cwd()
const fixturePath = path.join(WORKTREE_ROOT, 'tests/fixtures/preset-compat/synthetic-sillytavern-preset.json')

function buildRecoverableRewriteJob(params: {
  jobId: string
  content?: string | null
  userInstruction?: string
  status?: string
  progress?: number
  currentStep?: string | null
  presetCompat?: unknown
  metadata?: unknown
}) {
  const timestamp = '2026-05-15T01:23:45.000Z'
  return {
    jobId: params.jobId,
    status: params.status ?? (params.content == null ? 'queued' : 'succeeded'),
    progress: params.progress ?? (params.content == null ? 0.1 : 1),
    currentStep: params.currentStep ?? (params.content == null ? '已创建可恢复魔改任务' : '已完成魔改任务'),
    errorMessage: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    panel: {
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      chapterId: 'chapter-001',
      selectedText: '这里是一段测试正文。',
      sourceText: '这里是一段测试正文。',
      sourceTextOverride: null,
      userInstruction: params.userInstruction ?? '',
      rewriteLaunchSource: null,
      createdAt: timestamp,
    },
    result: params.content == null
      ? null
      : {
          provider: 'openai-compatible',
          title: '生成版本',
          summary: '基于当前章节知识状态与证据装配生成。',
          content: params.content,
          inputTokens: 42,
          outputTokens: 84,
          metadata: params.metadata ?? {},
          presetCompat: params.presetCompat ?? null,
        },
  }
}

function buildPreviewPromptRuntimeContext() {
  return {
    sessionPhase: 'new_chat' as const,
    surfaceContextBlocks: [{
      id: 'preview-named-transcript',
      label: 'Preview named transcript',
      content: 'Alice: Hello\nBob: Hi',
      abstraction: 'named_transcript' as const,
    }],
    namedTranscript: {
      kind: 'chat' as const,
      userName: 'Alice',
      assistantName: 'Bob',
    },
  }
}

function buildRewriteProviderPayload(library: PresetCompatLibrary, userInstruction: string) {
  const resolvedRuntime = resolvePresetCompatRuntime({
    library,
    surfaceId: 'rewrite',
    providerDefaults: {
      provider: 'openai-compatible',
      openAICompatible: {
        config: { baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'gpt-4.1-mini' },
        request: { temperature: 0.9 },
      },
      ollama: {
        config: { baseUrl: 'http://localhost:11434', model: 'qwen3:8b' },
        request: { temperature: 0.9 },
      },
    },
    promptRuleRuntimeContext: buildPreviewPromptRuntimeContext(),
  })
  const standalone = resolvedRuntime.activePreset
    ? resolvedRuntime.activePreset.attachedStandaloneRegexIds
        .map((regexId) => library.standaloneRegexes[regexId])
        .filter(Boolean)
    : []
  const embedded = resolvedRuntime.activePreset?.embeddedRegexes ?? []
  const preview = buildPresetCompatCreativeRuntimePreview({
    surfaceId: 'rewrite',
    resolvedRuntime,
    systemPrompt: '你是 ReTale 的小说扩写/魔改写作模型。',
    userPrompt: userInstruction,
    standalone,
    embedded,
  })

  return {
    systemPrompt: preview.systemPrompt,
    userPrompt: preview.userPrompt,
    warnings: preview.warnings,
    macroDiagnostics: preview.metadata.macroDiagnostics,
  }
}

function buildWorkspacePayload() {
  return {
    currentNovelId: 'novel-001',
    currentChapterId: 'chapter-001',
    currentTab: 'editor',
    helperTab: 'trajectory',
    localNovels: [{ id: 'novel-001', title: 'Fixture Novel', summary: 'Preset compat UI fixture', tags: ['fixture'] }],
    localChapters: [{
      id: 'chapter-001',
      novelId: 'novel-001',
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

test('workspace preset-compat library modal imports fixture JSON, edits bindings and generation settings, keeps server session state out, and exports JSON', async ({ page }) => {
  const evidenceDirectory = ensureEvidenceDir('task-9')
  const fixtureText = fs.readFileSync(fixturePath, 'utf8')
  let library = createDefaultPresetCompatLibrary()
  let presetImportCounter = 0
  let regexImportCounter = 0

  await mockNovelResourceApi(page, buildWorkspacePayload)
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

  await page.getByTestId('preset-compat-preset-import-input').setInputFiles({
    name: 'synthetic-sillytavern-preset.json',
    mimeType: 'application/json',
    buffer: Buffer.from(fixtureText),
  })
  await expect(page.getByRole('button', { name: /synthetic-sillytavern-preset/ }).first()).toBeVisible()

  const importedPreset = library.presets['preset-ui-1']
  expect(importedPreset).toBeDefined()
  const mainRuleId = importedPreset.promptRules.find((rule) => rule.id === 'synthetic-main')?.id
  expect(mainRuleId).toBe('synthetic-main')
  await expect(page.locator('select[data-testid^="preset-compat-binding-"]')).toHaveCount(PRESET_COMPAT_EDITABLE_SURFACE_REGISTRY_IDS.length)
  await expect(page.getByTestId('preset-compat-binding-summary-rewrite')).toContainText('魔改、续写和重生')
  await expect(page.getByTestId('preset-compat-binding-summary-future_jump')).toContainText('用于 Future Jump')
  await expect(page.getByTestId('preset-compat-binding-roleplay')).toBeVisible()
  await expect(page.getByTestId('preset-compat-binding-expand')).toHaveCount(0)
  await expect(page.getByTestId('preset-compat-binding-polish')).toHaveCount(0)
  await expect(page.getByTestId('preset-compat-binding-continue')).toHaveCount(0)
  await expect(page.getByTestId(`preset-compat-rule-content-${mainRuleId}`)).toBeVisible()
  await expect(page.getByTestId('preset-compat-preview-surface-select')).toHaveValue('rewrite')
  await expect(page.getByTestId('preset-compat-preview-surface-rewrite')).toHaveCount(0)
  await page.getByTestId('preset-compat-preview-generate').click()

  await expect(page.getByTestId('preset-compat-preview-surface-rewrite')).toBeVisible()
  await expect(page.getByTestId('preset-compat-preview-surface-future_jump')).toHaveCount(0)
  await expect(page.getByTestId('preset-compat-session-state-rewrite')).toHaveText(/会话阶段：new_chat · 正常/)
  await expect(page.getByTestId('preset-compat-session-reset-rewrite')).toHaveCount(0)
  await expect(page.getByText('导入备注')).toHaveCount(0)

  await page.getByTestId('preset-compat-preview-surface-select').selectOption('future_jump')
  await expect(page.getByTestId('preset-compat-preview-surface-rewrite')).toHaveCount(0)
  await expect(page.getByTestId('preset-compat-session-reset-rewrite')).toHaveCount(0)
  await page.getByTestId('preset-compat-preview-generate').click()
  await expect(page.getByTestId('preset-compat-preview-surface-future_jump')).toBeVisible()
  await expect(page.getByTestId('preset-compat-preview-surface-rewrite')).toHaveCount(0)
  await expect(page.getByTestId('preset-compat-session-reset-future_jump')).toHaveCount(0)

  await page.getByTestId('preset-compat-preview-surface-select').selectOption('rewrite')
  await page.getByTestId('preset-compat-preview-generate').click()
  await expect(page.getByTestId('preset-compat-session-reset-rewrite')).toHaveCount(0)

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
  const standaloneRegexId = 'fixture-regex-1'
  const standaloneAttachButton = page.getByTestId(`preset-compat-standalone-regex-attach-${standaloneRegexId}`)
  await expect(standaloneAttachButton).toBeVisible()
  expect(library.standaloneRegexes[standaloneRegexId]).toBeDefined()

  for (const surfaceId of ['rewrite', 'future_jump', 'roleplay'] as const) {
    await page.getByTestId(`preset-compat-binding-${surfaceId}`).selectOption('preset-ui-1')
  }

  await page.getByTestId('preset-compat-runtime-openai-max-context').fill('16384')
  await page.getByTestId('preset-compat-runtime-max-tokens').fill('2048')
  await page.getByTestId('preset-compat-runtime-temperature').fill('0.55')
  await page.getByTestId('preset-compat-runtime-frequency-penalty').fill('0.2')
  await page.getByTestId('preset-compat-runtime-presence-penalty').fill('0.1')
  await page.getByTestId('preset-compat-runtime-top-p').fill('0.85')
  await page.getByTestId('preset-compat-transport-stream-openai').selectOption('true')

  await page.getByTestId(`preset-compat-rule-toggle-${mainRuleId}`).uncheck()
  await page.getByTestId(`preset-compat-rule-toggle-${mainRuleId}`).check()
  await page.getByTestId(`preset-compat-rule-content-${mainRuleId}`).fill('Updated from Playwright.')
  await expect(page.getByTestId(`preset-compat-rule-content-${mainRuleId}`)).toHaveValue('Updated from Playwright.')

  await standaloneAttachButton.click()
  await expect(standaloneAttachButton).toContainText('Detach from preset')

  const presetDownloadPromise = page.waitForEvent('download')
  await page.getByTestId('preset-compat-preset-export-preset-ui-1').click()
  const presetDownload = await presetDownloadPromise
  const presetDownloadPath = path.join(evidenceDirectory, 'task-9-preset-export.json')
  await presetDownload.saveAs(presetDownloadPath)
  const exportedPresetJson = JSON.parse(fs.readFileSync(presetDownloadPath, 'utf8')) as Record<string, unknown>
  expect(Array.isArray(exportedPresetJson.prompts)).toBe(true)
  expect(Array.isArray(exportedPresetJson.prompt_order)).toBe(true)
  expect(exportedPresetJson).toMatchObject({
    openai_max_context: 16384,
    openai_max_tokens: 2048,
    temperature: 0.55,
    top_p: 0.85,
    frequency_penalty: 0.2,
    presence_penalty: 0.1,
    stream_openai: true,
  })

  await page.getByTestId('preset-compat-preset-delete-preset-ui-1').click()
  await expect(page.getByText('已删除预设“synthetic-sillytavern-preset”，并已保存。')).toBeVisible()
  expect(library.presets['preset-ui-1']).toBeUndefined()
  expect(library.surfaceBindings.rewrite.presetId).toBeNull()
  expect(library.surfaceBindings.future_jump.presetId).toBeNull()
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
  await expect(page.getByText('没有导入任何正则条目。')).toBeVisible()
  await expect(page.getByText('synthetic-sillytavern-preset')).toHaveCount(0)

  await page.screenshot({ path: path.join(evidenceDirectory, 'task-9-library-ui.png'), fullPage: true })
})

test('workspace rewrite flow saves a macro-bearing preset binding and sends Alice/Bob-expanded runtime payload', async ({ page }) => {
  const evidenceDirectory = ensureEvidenceDir('task-11')
  let library = createDefaultPresetCompatLibrary()
  let presetImportCounter = 0
  let rewriteProviderPayload: ReturnType<typeof buildRewriteProviderPayload> | null = null
  let rewriteMacroRuleId: string | null = null

  await mockNovelResourceApi(page, buildWorkspacePayload)
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
  await page.route('**/api/rag/build-generation-context', async (route) => {
    await route.fulfill({
      status: 200,
      body: JSON.stringify({
        ok: true,
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        chapterId: 'chapter-001',
        chapterNo: 1,
        chapterTitle: '第1章 开场',
        selectedLineStart: 1,
        selectedLineEnd: 1,
        warnings: [],
        promptBlocks: [{
          id: 'named-transcript',
          label: 'Named transcript',
          enabled: true,
          priority: 'high',
          content: 'Alice: 先看看这里。\nBob: 我在听。',
          abstraction: 'named_transcript',
        }],
        assembledContext: 'Alice: 先看看这里。\nBob: 我在听。',
        lanceEvidence: [],
        tokenEstimate: 42,
        graphContext: {
          seedEntities: [],
          nodes: [],
          edges: [],
          contextText: '',
          warnings: [],
          tokenEstimate: 42,
          status: 'ready',
        },
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
    const body = route.request().postDataJSON() as { kind: 'preset'; jsonText: string; nameHint?: string }
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
  })
  let rewriteJobContent = ''
  await page.route('**/api/rewrite*', async (route) => {
    if (route.request().method() === 'GET') {
      const url = new URL(route.request().url())
      const jobId = url.searchParams.get('jobId')
      if (!jobId) {
        await route.fulfill({ json: { ok: true, job: null } })
        return
      }

      expect(jobId).toBe('rewrite-job-preset-compat-1')
      await route.fulfill({
        json: {
          ok: true,
          job: buildRecoverableRewriteJob({
            jobId: 'rewrite-job-preset-compat-1',
            content: rewriteJobContent,
            presetCompat: {
              warnings: rewriteProviderPayload?.warnings ?? [],
              macroDiagnostics: rewriteProviderPayload?.macroDiagnostics ?? [],
            },
            metadata: {
              warnings: rewriteProviderPayload?.warnings ?? [],
            },
          }),
        },
      })
      return
    }

    const body = route.request().postDataJSON() as {
      userInstruction?: string
      operationType?: string
      recoverableRewriteJob?: boolean
      stream?: boolean
    }
    expect(route.request().url()).toContain('/api/rewrite')
    expect(body.operationType).toBe('rewrite')
    expect(body.recoverableRewriteJob).toBe(true)
    expect(body.stream).toBe(true)

    const activePresetId = library.surfaceBindings.rewrite.presetId
    const activePreset = activePresetId ? library.presets[activePresetId] : null
    const macroRule = rewriteMacroRuleId
      ? activePreset?.promptRules.find((rule) => rule.id === rewriteMacroRuleId)
      : null

    rewriteProviderPayload = buildRewriteProviderPayload(library, macroRule?.content ?? body.userInstruction ?? '')
    rewriteJobContent = rewriteProviderPayload.userPrompt
    writeEvidenceFile('task-11/rewrite-provider-payload.json', JSON.stringify(rewriteProviderPayload, null, 2))
    await route.fulfill({
      json: {
        ok: true,
        job: buildRecoverableRewriteJob({
          jobId: 'rewrite-job-preset-compat-1',
          userInstruction: body.userInstruction,
        }),
      },
    })
  })

  await page.goto('/workspace', { waitUntil: 'networkidle' })
  await page.getByTestId('preset-compat-library-open').click()
  await expect(page.getByTestId('preset-compat-library-modal')).toBeVisible()
  await page.getByTestId('preset-compat-preset-import-input').setInputFiles(fixturePath)
  await expect(page.getByRole('button', { name: /synthetic-sillytavern-preset/ }).first()).toBeVisible()
  const importedPreset = library.presets['preset-ui-1']
  expect(importedPreset).toBeDefined()
  const macroRuleId = importedPreset.promptRules.find((rule) => rule.id === 'synthetic-main' && !rule.forbidOverrides)?.id
  expect(macroRuleId).toBe('synthetic-main')
  rewriteMacroRuleId = macroRuleId ?? null
  await page.getByTestId(`preset-compat-rule-content-${macroRuleId}`).fill('Playwright macro proof: {{user}} talks to {{char}}.')
  await page.getByTestId('preset-compat-binding-rewrite').selectOption('preset-ui-1')
  await page.getByRole('button', { name: '保存兼容库' }).click()
  await expect(page.getByText('预设兼容库已保存。')).toBeVisible()
  await page.mouse.click(12, 12)
  await expect(page.getByTestId('preset-compat-library-modal')).toBeHidden()

  await page.locator('[contenteditable="true"]').evaluate((editor) => {
    const paragraph = editor.querySelector('p')
    const textNode = paragraph?.firstChild
    if (!paragraph || !textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('Failed to resolve editor text node for selection')
    }

    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, textNode.textContent?.length ?? 0)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })

  await page.getByTestId('workspace-chapter-rewrite-entry').click()
  await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
  const rewriteResponsePromise = page.waitForResponse((response) => response.url().includes('/api/rewrite') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '生成版本' }).click()
  await rewriteResponsePromise
  await expect(page.getByTestId('workspace-action-overlay')).toContainText('Alice')
  await expect(page.getByTestId('workspace-action-overlay')).toContainText('Bob')

  const runtimePayload = rewriteProviderPayload as ReturnType<typeof buildRewriteProviderPayload> | null
  expect(runtimePayload).not.toBeNull()
  expect(runtimePayload?.userPrompt ?? '').toContain('Alice')
  expect(runtimePayload?.userPrompt ?? '').toContain('Bob')

  await page.screenshot({ path: path.join(evidenceDirectory, 'task-11-ui-preset-macro.png'), fullPage: true })
})

test('workspace rewrite flow shows a localized creation error when the provider is missing', async ({ page }) => {
  await mockNovelResourceApi(page, buildWorkspacePayload)
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
  await page.route('**/api/rag/build-generation-context', async (route) => {
    await route.fulfill({
      status: 200,
      body: JSON.stringify({
        ok: true,
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        chapterId: 'chapter-001',
        chapterNo: 1,
        chapterTitle: '第1章 开场',
        selectedLineStart: 1,
        selectedLineEnd: 1,
        warnings: [],
        promptBlocks: [{
          id: 'current-summary',
          label: '当前章节摘要',
          enabled: true,
          priority: 'high',
          content: '# 当前章节摘要\n这里是一段测试正文。',
        }],
        assembledContext: '# 当前章节摘要\n这里是一段测试正文。',
        lanceEvidence: [],
        tokenEstimate: 12,
        graphContext: {
          seedEntities: [],
          nodes: [],
          edges: [],
          contextText: '',
          warnings: [],
          tokenEstimate: 12,
          status: 'ready',
        },
      }),
    })
  })
  await page.route('**/api/settings/preset-compat', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify(createDefaultPresetCompatLibrary()) })
  })
  await page.route('**/api/rewrite*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, job: null }) })
      return
    }

    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        error: 'OpenAI-compatible config not set',
        code: 'provider_not_configured',
        provider: 'openai-compatible',
        guidance: 'Open AI Settings, configure the OpenAI-compatible rewrite base URL, API key, and model, then try again.',
      }),
    })
  })

  await page.goto('/workspace', { waitUntil: 'networkidle' })
  await page.locator('[contenteditable="true"]').evaluate((editor) => {
    const paragraph = editor.querySelector('p')
    const textNode = paragraph?.firstChild
    if (!paragraph || !textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('Failed to resolve editor text node for selection')
    }

    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, textNode.textContent?.length ?? 0)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })

  await page.getByTestId('workspace-chapter-rewrite-entry').click()
  await expect(page.getByTestId('workspace-action-overlay')).toBeVisible()
  await page.getByRole('button', { name: '生成版本' }).click()
  await expect(page.getByTestId('rewrite-flow-error')).toContainText('创建可恢复改写任务失败')
  await expect(page.getByTestId('workspace-action-overlay')).toContainText('创建可恢复改写任务失败')
})
