import { afterEach, describe, expect, it, vi } from 'vitest'
import { deserializePresetCompatResponseMetadata } from '@/lib/preset-compat/runtime-integration'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import type { PresetCompatMacroDiagnostic } from '@/lib/preset-compat/macro-context'
import type { PresetCompatLibrary } from '@/lib/preset-compat/types'
import type { AISettings } from '@/lib/types'

const REWRITE_ROUTE_RUNTIME_SURFACES = ['rewrite', 'roleplay'] as const

function createAiSettings(provider: 'openai-compatible' | 'ollama'): AISettings {
  return {
    rewrite: {
      provider,
      openAICompatible: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        model: 'openai-model',
      },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'ollama-model',
      },
    },
    knowledgeExtraction: {
      provider: 'openai-compatible',
      openAICompatible: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        model: 'knowledge-model',
        parallelism: 1,
      },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'knowledge-ollama',
        parallelism: 1,
      },
    },
    embeddings: {
      provider: 'openai-compatible',
      openAICompatible: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        model: 'embedding-model',
      },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'embedding-ollama',
      },
      embeddingBatchSize: 16,
    },
  }
}

function createCreativeLibrary(mode: 'default' | 'stream' = 'default'): PresetCompatLibrary {
  const library = createDefaultPresetCompatLibrary()

  library.standaloneRegexes['regex-input'] = {
    id: 'regex-input',
    name: 'Input regex',
    pattern: 'ALPHA',
    replacement: 'BETA',
    flags: 'g',
    disabled: false,
    placements: ['user_input'],
    trimStrings: [],
    promptOnly: true,
    markdownOnly: false,
    minDepth: null,
    maxDepth: null,
    substituteRegex: null,
    runOnEdit: true,
    passthrough: {},
  }

  library.standaloneRegexes['regex-output'] = {
    id: 'regex-output',
    name: 'Output regex',
    pattern: 'RAW OUTPUT',
    replacement: 'CLEAN OUTPUT',
    flags: 'g',
    disabled: false,
    placements: ['assistant_output'],
    trimStrings: [],
    promptOnly: false,
    markdownOnly: false,
    minDepth: null,
    maxDepth: null,
    substituteRegex: null,
    runOnEdit: true,
    passthrough: {},
  }

  library.standaloneRegexes['regex-stream-output'] = {
    id: 'regex-stream-output',
    name: 'Stream output regex',
    pattern: 'AlphaBeta',
    replacement: 'Omega',
    flags: 'g',
    disabled: false,
    placements: ['assistant_output'],
    trimStrings: [],
    promptOnly: false,
    markdownOnly: false,
    minDepth: null,
    maxDepth: null,
    substituteRegex: null,
    runOnEdit: true,
    passthrough: {},
  }

  for (const surfaceId of ['rewrite', 'future_jump', 'roleplay'] as const) {
    const presetId = `${surfaceId}-preset`
    library.builtinSystemPrompts[surfaceId] = {
      ...library.builtinSystemPrompts[surfaceId],
      content: `${surfaceId.toUpperCase()} RETALE BUILTIN SYSTEM`,
    }
    library.presets[presetId] = {
      id: presetId,
      name: `${surfaceId} preset`,
      sourceApiId: 'openai',
      promptRules: [
        {
          id: `${surfaceId}-user-rule`,
          name: `${surfaceId} user rule`,
          role: 'user',
          content: `${surfaceId.toUpperCase()} USER RULE`,
          enabled: true,
          marker: false,
          injectAsSystemPrompt: false,
          injectionPosition: 'before',
          injectionDepth: null,
          injectionOrder: 1,
          injectionTrigger: [],
          forbidOverrides: false,
          condition: null,
          passthrough: {},
        },
        {
          id: `${surfaceId}-system-rule`,
          name: `${surfaceId} system rule`,
          role: 'system',
          content: `${surfaceId.toUpperCase()} SYSTEM RULE`,
          enabled: true,
          marker: false,
          injectAsSystemPrompt: true,
          injectionPosition: 'before',
          injectionDepth: null,
          injectionOrder: 2,
          injectionTrigger: [],
          forbidOverrides: false,
          condition: null,
          passthrough: {},
        },
        {
          id: `${surfaceId}-system-rule-second`,
          name: `${surfaceId} second system rule`,
          role: 'system',
          content: `${surfaceId.toUpperCase()} SECOND SYSTEM RULE`,
          enabled: true,
          marker: false,
          injectAsSystemPrompt: true,
          injectionPosition: 'before',
          injectionDepth: null,
          injectionOrder: 3,
          injectionTrigger: [],
          forbidOverrides: false,
          condition: null,
          passthrough: {},
        },
      ],
      promptOrderLists: {
        [surfaceId]: [`${surfaceId}-user-rule`, `${surfaceId}-system-rule`, `${surfaceId}-system-rule-second`],
      },
      embeddedRegexes: [],
      attachedStandaloneRegexIds: ['regex-input', 'regex-output'],
      runtimeSampler: {
        temperature: 0.41,
        topP: 0.82,
        topK: 44,
        topA: null,
        minP: 0.06,
        presencePenalty: 0.33,
        frequencyPenalty: 0.27,
        repetitionPenalty: 1.19,
        openaiMaxContext: null,
        maxTokens: 2222,
        seed: 98765,
        candidateCount: null,
      },
      promptTemplate: {
        namesBehavior: null,
        sendIfEmpty: null,
        impersonationPrompt: null,
        newChatPrompt: null,
        newGroupChatPrompt: null,
        newExampleChatPrompt: null,
        continueNudgePrompt: null,
        wiFormat: null,
        scenarioFormat: null,
        personalityFormat: null,
        groupNudgePrompt: null,
        assistantPrefill: null,
        assistantImpersonation: null,
        continuePostfix: null,
        legacyMainPrompt: null,
        legacyNsfwPrompt: null,
        legacyJailbreakPrompt: null,
      },
      transport: {
        maxContextUnlocked: null,
        streamOpenAI: null,
        useSysprompt: null,
        squashSystemMessages: null,
        mediaInlining: null,
        inlineImageQuality: null,
        continuePrefill: null,
        functionCalling: null,
        showThoughts: null,
        reasoningEffort: null,
        verbosity: null,
        enableWebSearch: null,
        requestImages: null,
        requestImageAspectRatio: null,
        requestImageResolution: null,
      },
      preservedFields: {
        biasPresetSelected: null,
      },
      passthrough: {
        root: {
        },
      },
      importWarnings: [],
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    }
    library.surfaceBindings[surfaceId] = {
      ...library.surfaceBindings[surfaceId],
      enabled: true,
      presetId,
    }
  }

  if (mode === 'stream') {
    const streamPresetId = 'rewrite-preset'
    library.presets[streamPresetId] = {
      ...library.presets[streamPresetId],
      attachedStandaloneRegexIds: ['regex-input', 'regex-stream-output'],
    }
  }

  return library
}

function createTemplateSurfaceLibrary(): PresetCompatLibrary {
  const library = createCreativeLibrary()

  library.presets['rewrite-preset'] = {
    ...library.presets['rewrite-preset'],
    promptTemplate: {
      ...library.presets['rewrite-preset'].promptTemplate,
      newChatPrompt: 'CONTINUE SHOULD NOT SEE NEW CHAT',
      continueNudgePrompt: 'CONTINUE TEMPLATE FRAGMENT',
    },
  }

  library.presets['roleplay-preset'] = {
    ...library.presets['roleplay-preset'],
    promptTemplate: {
      ...library.presets['roleplay-preset'].promptTemplate,
      impersonationPrompt: 'ROLEPLAY IMPERSONATION TEMPLATE',
      newGroupChatPrompt: 'ROLEPLAY NEW GROUP TEMPLATE',
      groupNudgePrompt: 'ROLEPLAY GROUP NUDGE TEMPLATE',
    },
  }

  library.presets['rewrite-preset'] = {
    ...library.presets['rewrite-preset'],
    promptTemplate: {
      ...library.presets['rewrite-preset'].promptTemplate,
      newExampleChatPrompt: 'REWRITE NEW EXAMPLE TEMPLATE',
      newChatPrompt: 'REWRITE SHOULD NOT SEE NEW CHAT',
      wiFormat: '[WI]\n{0}\n[/WI]',
      scenarioFormat: '[SCENARIO]\n{{scenario}}\n[/SCENARIO]',
      personalityFormat: '[PERSONALITY]\n{{personality}}\n[/PERSONALITY]',
      namesBehavior: 1,
    },
  }

  return library
}

function createRouteEffectsLibrary(params: {
  streamOpenAI?: boolean | null
  openaiMaxContext?: number | null
  maxContextUnlocked?: boolean | null
} = {}): PresetCompatLibrary {
  const library = createCreativeLibrary()

  library.presets['rewrite-preset'] = {
    ...library.presets['rewrite-preset'],
    runtimeSampler: {
      ...library.presets['rewrite-preset'].runtimeSampler,
      openaiMaxContext: params.openaiMaxContext ?? null,
    },
    transport: {
      ...library.presets['rewrite-preset'].transport,
      streamOpenAI: params.streamOpenAI ?? null,
      maxContextUnlocked: params.maxContextUnlocked ?? null,
    },
  }

  return library
}

function createMacroRuntimeLibrary(): PresetCompatLibrary {
  const library = createDefaultPresetCompatLibrary()
  const presetId = 'rewrite-macro-preset'

  library.presets[presetId] = {
    id: presetId,
    name: 'rewrite macro preset',
    sourceApiId: 'openai',
    promptRules: [
      {
        id: 'rewrite-macro-user-rule',
        name: 'rewrite macro user rule',
        role: 'user',
        content: 'Speaker {{user}} meets {{char}}. Unsupported={{input}} Missing={{lastMessage}}.',
        enabled: true,
        marker: false,
        injectAsSystemPrompt: false,
        injectionPosition: 'before',
        injectionDepth: null,
        injectionOrder: 1,
        injectionTrigger: [],
        forbidOverrides: false,
        condition: null,
        passthrough: {},
      },
    ],
    promptOrderLists: {
      rewrite: ['rewrite-macro-user-rule'],
    },
    embeddedRegexes: [],
    attachedStandaloneRegexIds: [],
    runtimeSampler: {
      temperature: null,
      topP: null,
      topK: null,
      topA: null,
      minP: null,
      presencePenalty: null,
      frequencyPenalty: null,
      repetitionPenalty: null,
      openaiMaxContext: null,
      maxTokens: null,
      seed: 2468,
      candidateCount: null,
    },
    promptTemplate: {
      namesBehavior: 1,
      sendIfEmpty: null,
      impersonationPrompt: null,
      newChatPrompt: null,
      newGroupChatPrompt: null,
      newExampleChatPrompt: null,
      continueNudgePrompt: null,
      wiFormat: null,
      scenarioFormat: null,
      personalityFormat: null,
      groupNudgePrompt: null,
      assistantPrefill: null,
      assistantImpersonation: null,
      continuePostfix: null,
      legacyMainPrompt: null,
      legacyNsfwPrompt: null,
      legacyJailbreakPrompt: null,
    },
    transport: {
      maxContextUnlocked: null,
      streamOpenAI: null,
      useSysprompt: null,
      squashSystemMessages: null,
      mediaInlining: null,
      inlineImageQuality: null,
      continuePrefill: null,
      functionCalling: null,
      showThoughts: null,
      reasoningEffort: null,
      verbosity: null,
      enableWebSearch: null,
      requestImages: null,
      requestImageAspectRatio: null,
      requestImageResolution: null,
    },
    preservedFields: {
      biasPresetSelected: null,
    },
    passthrough: {},
    importWarnings: [],
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
  }

  library.surfaceBindings.rewrite = {
    ...library.surfaceBindings.rewrite,
    enabled: true,
    presetId,
  }

  return library
}

function createRequest(operationType: string, body: Record<string, unknown>) {
  return new Request('http://localhost/api/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      novelId: 'novel-preset-runtime',
      sourceText: '原文 ALPHA',
      selectedText: '选段 ALPHA',
      prompt: '补充提示 ALPHA',
      userInstruction: '指令 ALPHA',
      mode: 'heavy',
      tone: 'dramatic',
      scope: 'selection',
      operationType,
      ...body,
    }),
  })
}

function readPresetCompatHeader(response: Response) {
  const raw = response.headers.get('X-ReTale-Preset-Compat')
  expect(raw).toBeTruthy()
  return JSON.parse(Buffer.from(String(raw), 'base64').toString('utf8')) as {
    macroDiagnostics: PresetCompatMacroDiagnostic[]
    fieldStatuses: Array<{ field: string; status: string; reason: string }>
    contextWindow: null | {
      supported: boolean
      requestedMaxContextTokens: number | null
      effectiveMaxContextTokens: number | null
      unlockMaximum: boolean
      tokenEstimate: number | null
      trimmedBlockIds: string[]
    }
    streamPolicy: null | {
      supported: boolean
      requested: boolean | null
      effective: boolean
      source: string
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.doUnmock('@/lib/preset-compat/runtime-integration')
  vi.doUnmock('@/lib/server/writing-skill-runtime')
  vi.resetModules()
})

describe('preset compat rewrite route runtime', () => {
  it.each([
    { provider: 'openai-compatible', stream: false, chapterId: 'chapter-rp' },
    { provider: 'openai-compatible', stream: true, chapterId: 'chapter-rp' },
    { provider: 'openai-compatible', stream: false, chapterId: null },
    { provider: 'openai-compatible', stream: true, chapterId: null },
    { provider: 'ollama', stream: false, chapterId: 'chapter-rp' },
    { provider: 'ollama', stream: true, chapterId: 'chapter-rp' },
  ] as const)('sends complete RP history through the provider transport with old presets and tight budgets (%j)', async ({ provider, stream, chapterId }) => {
    const library = createCreativeLibrary()
    library.builtinSystemPrompts.roleplay.content = '旧版规则：你是小说魔改模型，优先输出可替换原文的正文。'
    library.presets['roleplay-preset'].runtimeSampler.openaiMaxContext = 20
    vi.doMock('@/lib/server/ai-settings', () => ({ loadStoredAISettings: () => createAiSettings(provider) }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({ loadStoredPresetCompatLibrary: () => library }))
    vi.doMock('@/lib/utils', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/utils')>()),
      estimateTokenCount: (text: string) => text.length,
    }))
    vi.doMock('@/lib/server/context-builder', () => ({ buildGenerationContext: async () => ({
      chapterNo: 3, promptBlocks: [
        { id: 'neighborhood', label: '原章节', enabled: true, priority: 'highest', content: '旧场景背景应当让位于当前故事'.repeat(10) },
      ],
    }) }))
    const reply = JSON.stringify({ blocks: [{ type: 'counterpart', text: '她握住船桨。“到对岸去。”' }] })
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith('/api/tags')) return Response.json({ models: [{ model: 'ollama-model' }] })
      if (provider === 'ollama') return stream
        ? new Response(`${JSON.stringify({ message: { content: reply }, done: true })}\n`)
        : Response.json({ message: { content: reply } })
      return stream
        ? new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
        : Response.json({ choices: [{ message: { content: reply } }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const history = Array.from({ length: 14 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: index === 13 ? '旁白：两人已登船，离开了原先的房间。\n沈月：你想去哪里？' : `历史第${index + 1}条：约好去渡口。`,
    }))
    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest('roleplay', {
      stream, chapterId, roleplayMessages: history, disabledBlockIds: ['roleplay-history'],
      roleplayTurn: { playerName: '林舟', counterpartName: '沈月', storyGuidance: '小船继续前进。', dialogue: '先到对岸去吧。', maxCharacters: 600 },
    }))
    expect(response.status).toBe(200)
    if (stream) expect(await response.text()).toBe(reply)
    else expect((await response.json()).candidates[0].content).toBe(reply)
    const providerCall = fetchMock.mock.calls.find(([url]) => /\/(chat\/completions|api\/chat)$/.test(String(url)))!
    const requestBody = JSON.parse(String((providerCall[1] as RequestInit).body)) as { messages: Array<{ role: string; content: string }>; format?: unknown }
    if (provider === 'ollama' && !stream) expect(requestBody.format).toBe('json')
    const system = requestBody.messages.find((message) => message.role === 'system')!.content
    const prompt = requestBody.messages.find((message) => message.role === 'user')!.content
    expect(system).toContain('旧版规则')
    expect(system.indexOf('已有 RP 历史是当前故事进度')).toBeGreaterThan(system.indexOf('ROLEPLAY SYSTEM RULE'))
    expect(prompt).toContain('这是继续对话')
    expect(prompt).not.toContain('这是故事的第一轮')
    for (const message of history) expect(prompt).toContain(message.content)
    expect(prompt.match(/# 当前角色扮演对话/g)).toHaveLength(1)
    expect(prompt.indexOf('# 当前角色扮演对话')).toBeGreaterThan(prompt.indexOf('选段 BETA'))
    expect(prompt.lastIndexOf('先到对岸去吧。')).toBeGreaterThan(prompt.indexOf('两人已登船'))
    expect(prompt).not.toContain('旧场景背景应当让位于当前故事')
    const metadata = readPresetCompatHeader(response)
    expect(metadata.contextWindow?.trimmedBlockIds).not.toContain('roleplay-history')
    expect(metadata.fieldStatuses.find((field) => field.field === 'openai_max_context')?.status).toBe('degraded')
  })

  it('uses only the current book preset override, including an explicit opt-out', async () => {
    const library = createCreativeLibrary()
    library.presets['book-preset'] = { ...library.presets['rewrite-preset'], id: 'book-preset', name: 'Book preset' }
    library.novelRewritePresetIds = { 'book-a': 'book-preset', 'book-b': null }
    vi.doMock('@/lib/server/ai-settings', () => ({ loadStoredAISettings: () => createAiSettings('openai-compatible') }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({ loadStoredPresetCompatLibrary: () => library }))
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ result: 'RAW OUTPUT' }) } }] })))
    const { POST } = await import('@/app/api/rewrite/route')
    for (const [novelId, activePresetId] of [['book-a', 'book-preset'], ['book-b', null], ['book-c', 'rewrite-preset']]) {
      const response = await POST(createRequest('rewrite', { novelId, stream: false }))
      expect(response.status).toBe(200)
      const payload = await response.json()
      expect(payload.presetCompat.runtimeSnapshot.activePresetId).toBe(activePresetId)
    }
    expect(library.surfaceBindings.rewrite.presetId).toBe('rewrite-preset')
  })

  it.each(REWRITE_ROUTE_RUNTIME_SURFACES)('applies runtime prompt rules, regexes, and sampler options for %s', async (surfaceId) => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createCreativeLibrary(),
    }))

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              result: 'RAW OUTPUT',
            }),
          },
        },
      ],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest(surfaceId, { stream: false }))

    expect(response.status).toBe(200)
    const payload = await response.json() as {
      provider: string
      result: { content: string }
      candidates: Array<{ content: string }>
      presetCompat: {
        runtimeSnapshot: { activePresetId: string; activeSurfaceId: string | null }
        fieldStatuses: Array<{ field: string; status: string; reason: string }>
        streamPolicy: { effective: boolean; source: string }
      }
    }
    expect(payload.provider).toBe('openai-compatible')
    expect(payload.result.content).toBe('CLEAN OUTPUT')
    expect(payload.candidates.map((candidate) => candidate.content)).toEqual(['CLEAN OUTPUT'])
    expect(payload.presetCompat.fieldStatuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'openai_max_tokens', status: 'applied', reason: 'SUPPORTED_RUNTIME' }),
      expect.objectContaining({ field: 'seed', status: 'degraded', reason: 'PROVIDER_ONLY' }),
    ]))
    expect(payload.presetCompat.streamPolicy).toMatchObject({ effective: false, source: 'explicit_request' })
    expect(payload.presetCompat.runtimeSnapshot).toMatchObject({
      activePresetId: `${surfaceId}-preset`,
      activeSurfaceId: surfaceId,
    })

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const requestBody = JSON.parse(String(requestInit.body)) as {
      seed?: number
      top_p?: number
      frequency_penalty?: number
      presence_penalty?: number
      max_tokens?: number
      messages: Array<{ role: string; content: string }>
    }

    expect(requestBody.top_p).toBe(0.82)
    expect(requestBody.frequency_penalty).toBe(0.27)
    expect(requestBody.presence_penalty).toBe(0.33)
    expect(requestBody.max_tokens).toBe(2222)
    expect(requestBody.seed).toBeUndefined()
    expect(requestBody.messages[0]?.content).toBe([
      `${surfaceId.toUpperCase()} RETALE BUILTIN SYSTEM`,
      `${surfaceId.toUpperCase()} SYSTEM RULE`,
      `${surfaceId.toUpperCase()} SECOND SYSTEM RULE`,
    ].join('\n\n'))
    expect(requestBody.messages[0]?.content).not.toContain('## Imported Preset System Rules')
    expect(requestBody.messages[1]?.content.startsWith(`${surfaceId.toUpperCase()} USER RULE`)).toBe(true)
    expect(requestBody.messages[1]?.content).not.toContain('## Imported Preset User Rules')
    expect(requestBody.messages[1]?.content).toContain('BETA')
    expect(requestBody.messages[1]?.content).not.toContain('ALPHA')
  })

  it('returns a structured missing-provider error for streamed rewrite requests instead of fake output', async () => {
    const aiSettings = createAiSettings('openai-compatible')
    aiSettings.rewrite.openAICompatible = {
      ...aiSettings.rewrite.openAICompatible,
      apiKey: '',
      apiKeyConfigured: false,
      configured: false,
    }

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => aiSettings,
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createCreativeLibrary('stream'),
    }))
    vi.stubGlobal('fetch', vi.fn())

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest('rewrite', { stream: true }))

    expect(response.status).toBe(400)
    const payload = await response.json() as {
      ok: false
      error: string
      code: string
      provider: string
      guidance: string
      presetCompat: {
        streamPolicy: { effective: boolean; source: string }
      }
    }

    expect(payload).toMatchObject({
      ok: false,
      error: 'OpenAI-compatible config not set',
      code: 'provider_not_configured',
      provider: 'openai-compatible',
    })
    expect(payload.guidance).toContain('Open AI Settings')
    expect(payload.presetCompat.streamPolicy).toMatchObject({ effective: true, source: 'explicit_request' })
    expect(readPresetCompatHeader(response).streamPolicy).toMatchObject({ effective: true, source: 'explicit_request' })
  })

  it('uses source text as the continuation body when selected text is omitted', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createCreativeLibrary(),
    }))

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              candidates: ['RAW OUTPUT'],
            }),
          },
        },
      ],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest('rewrite', {
      stream: false,
      selectedText: '',
      sourceText: '上一个 block 的最新正文 ALPHA',
      userInstruction: '把情绪压低。',
    }))

    expect(response.status).toBe(200)
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const requestBody = JSON.parse(String(requestInit.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    expect(requestBody.messages[1]?.content).toContain('用户要求：把情绪压低。')
    expect(requestBody.messages[1]?.content).toContain('任务类型：续写后续故事')
    expect(requestBody.messages[1]?.content).toContain('任务要求：接着上下文中给出的已有正文，继续根据用户指令写接下来的故事。')
    expect(requestBody.messages[1]?.content).toContain('输出要求：只输出后续新正文，不要复述、解释或重新输出已有正文。')
    expect(requestBody.messages[1]?.content).toContain('# 已有正文（从这里之后继续写）\n上一个 block 的最新正文 BETA')
    expect(requestBody.messages[1]?.content.indexOf('选中行：未知')).toBeLessThan(
      requestBody.messages[1]?.content.indexOf('# 已有正文（从这里之后继续写）')
    )
    expect(requestBody.messages[1]?.content.indexOf('# 已有正文（从这里之后继续写）')).toBeLessThan(
      requestBody.messages[1]?.content.lastIndexOf('# 任务')
    )
    expect(requestBody.messages[1]?.content.trim().endsWith([
      '# 任务',
      '任务类型：续写后续故事',
      '用户要求：把情绪压低。',
      '任务要求：接着上下文中给出的已有正文，继续根据用户指令写接下来的故事。',
      '输出要求：只输出后续新正文，不要复述、解释或重新输出已有正文。',
    ].join('\n'))).toBe(true)
    expect(requestBody.messages[1]?.content).not.toContain('操作类型：rewrite')
    expect(requestBody.messages[1]?.content).not.toContain('不要改写')
    expect(requestBody.messages[1]?.content).not.toContain('# 选中文本')
  })

  it('uses source text as the continuation body when selected text is truly absent', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createCreativeLibrary(),
    }))

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ candidates: ['RAW OUTPUT'] }) } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest('rewrite', {
      stream: false,
      selectedText: undefined,
      sourceText: '省略 selectedText 时的续写正文 ALPHA',
      userInstruction: '继续压低情绪。',
    }))

    expect(response.status).toBe(200)
    const requestBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }
    const content = requestBody.messages[1]?.content ?? ''
    expect(content).toContain('# 已有正文（从这里之后继续写）\n省略 selectedText 时的续写正文 BETA')
    expect(content).toContain('任务类型：续写后续故事')
    expect(content).toContain('用户要求：继续压低情绪。')
    expect(content).not.toContain('# 选中文本')
    expect(content.indexOf('# 已有正文（从这里之后继续写）')).toBeLessThan(content.lastIndexOf('# 任务'))
  })

  it('routes generic future-jump rewrite requests through rewrite surface bindings', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createCreativeLibrary(),
    }))

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              candidates: ['RAW OUTPUT'],
            }),
          },
        },
      ],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest('future_jump', { stream: false }))

    expect(response.status).toBe(200)
    const payload = await response.json() as {
      candidates: Array<{ content: string }>
      presetCompat: {
        runtimeSnapshot: { activePresetId: string; activeSurfaceId: string | null }
      }
    }
    expect(payload.candidates.map((candidate) => candidate.content)).toEqual(['CLEAN OUTPUT'])
    expect(payload.presetCompat.runtimeSnapshot).toMatchObject({
      activePresetId: 'rewrite-preset',
      activeSurfaceId: 'rewrite',
    })

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const requestBody = JSON.parse(String(requestInit.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    expect(requestBody.messages[0]?.content).toBe([
      'REWRITE RETALE BUILTIN SYSTEM',
      'REWRITE SYSTEM RULE',
      'REWRITE SECOND SYSTEM RULE',
    ].join('\n\n'))
    expect(requestBody.messages[1]?.content.startsWith('REWRITE USER RULE')).toBe(true)
    expect(requestBody.messages[1]?.content).toContain('BETA')
    expect(requestBody.messages[1]?.content).not.toContain('ALPHA')
  })

  it('buffers stream output only when active assistant regexes need the final text and passes ollama sampler options', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('ollama'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createCreativeLibrary('stream'),
    }))

    const streamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('{"message":{"content":"Alpha"},"done":false}\n'))
        controller.enqueue(encoder.encode('{"message":{"content":"Beta"},"done":true}\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ model: 'ollama-model' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(streamBody, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest('rewrite', { stream: true }))

    expect(response.status).toBe(200)
    expect(deserializePresetCompatResponseMetadata(String(response.headers.get('X-ReTale-Preset-Compat'))).streamPolicy).toMatchObject({
      supported: true,
      effective: true,
      source: 'explicit_request',
    })
    await expect(response.text()).resolves.toBe('Omega')
    const presetCompat = readPresetCompatHeader(response)
    expect(presetCompat.streamPolicy).toMatchObject({ effective: true, source: 'explicit_request' })

    const requestInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    const requestBody = JSON.parse(String(requestInit.body)) as {
      options?: Record<string, number>
      messages: Array<{ role: string; content: string }>
    }

    expect(requestBody.options).toMatchObject({
      temperature: 0.41,
      top_p: 0.82,
      top_k: 44,
      min_p: 0.06,
      repeat_penalty: 1.19,
      num_predict: 2222,
      seed: 98765,
    })
    expect(requestBody.messages[1]?.content.startsWith('REWRITE USER RULE')).toBe(true)
    expect(requestBody.messages[1]?.content).not.toContain('## Imported Preset User Rules')
    expect(requestBody.messages[1]?.content).toContain('BETA')
    expect(requestBody.messages[1]?.content).not.toContain('ALPHA')
  })

  it('uses stream precedence explicit override > preset value > provider default and reports it in metadata', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createRouteEffectsLibrary({ streamOpenAI: true }),
    }))

    const firstStreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"流式结果一"}}]}\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n'))
        controller.close()
      },
    })
    const secondStreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"流式结果二"}}]}\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(firstStreamBody, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ result: 'RAW OUTPUT' }) } }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(secondStreamBody, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')

    const presetDrivenResponse = await POST(createRequest('rewrite', {}))
    expect(presetDrivenResponse.status).toBe(200)
    expect(await presetDrivenResponse.text()).toBe('流式结果一')
    expect(deserializePresetCompatResponseMetadata(String(presetDrivenResponse.headers.get('X-ReTale-Preset-Compat'))).streamPolicy).toMatchObject({
      supported: true,
      requested: true,
      effective: true,
      source: 'preset',
    })

    const explicitOffResponse = await POST(createRequest('rewrite', { stream: false }))
    expect(explicitOffResponse.status).toBe(200)
    const explicitOffPayload = await explicitOffResponse.json() as {
      presetCompat: {
        streamPolicy: { source: string; effective: boolean; requested: boolean | null }
      }
    }
    expect(explicitOffPayload.presetCompat.streamPolicy).toMatchObject({
      source: 'explicit_request',
      effective: false,
      requested: true,
    })

    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createRouteEffectsLibrary({ streamOpenAI: false }),
    }))
    vi.resetModules()
    const { POST: POSTWithDisabledPreset } = await import('@/app/api/rewrite/route')
    const explicitOnResponse = await POSTWithDisabledPreset(createRequest('rewrite', { stream: true }))
    expect(explicitOnResponse.status).toBe(200)
    expect(await explicitOnResponse.text()).toBe('流式结果二')
    expect(deserializePresetCompatResponseMetadata(String(explicitOnResponse.headers.get('X-ReTale-Preset-Compat'))).streamPolicy).toMatchObject({
      supported: true,
      requested: false,
      effective: true,
      source: 'explicit_request',
    })

    const firstRequestBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as { stream?: boolean }
    const secondRequestBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as { stream?: boolean; response_format?: unknown }
    const thirdRequestBody = JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body)) as { stream?: boolean }
    expect(firstRequestBody.stream).toBe(true)
    expect(secondRequestBody.stream).toBeUndefined()
    expect(secondRequestBody.response_format).toEqual({ type: 'json_object' })
    expect(thirdRequestBody.stream).toBe(true)
  })

  it('omits oversized preset compat response headers instead of overflowing clients', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createCreativeLibrary(),
    }))
    vi.doMock('@/lib/preset-compat/runtime-integration', async () => {
      const actual = await vi.importActual<typeof import('@/lib/preset-compat/runtime-integration')>('@/lib/preset-compat/runtime-integration')
      return {
        ...actual,
        serializePresetCompatResponseMetadata: () => 'a'.repeat(20_000),
      }
    })

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ result: 'RAW OUTPUT' }) } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest('rewrite', { stream: false }))

    expect(response.status).toBe(200)
    expect(response.headers.get('X-ReTale-Preset-Compat')).toBeNull()
    expect(response.headers.get('X-ReTale-Preset-Metadata-Omitted')).toBe('size-limit')
    await expect(response.json()).resolves.toMatchObject({
      result: { content: 'CLEAN OUTPUT' },
    })
  })

  it('reads full chat completion JSON bodies returned to streaming OpenAI-compatible requests', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createRouteEffectsLibrary({ streamOpenAI: false }),
    }))

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: [
              { type: 'text', text: '完整响应' },
              { type: 'text', text: '正文' },
            ],
          },
        },
      ],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest('rewrite', { stream: true }))

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('完整响应正文')
    expect(deserializePresetCompatResponseMetadata(String(response.headers.get('X-ReTale-Preset-Compat'))).streamPolicy).toMatchObject({
      effective: true,
      source: 'explicit_request',
    })
    const requestBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as { stream?: boolean }
    expect(requestBody.stream).toBe(true)
  })

  it('expands macro-bearing bound presets into provider payloads and returns macro diagnostics metadata', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createMacroRuntimeLibrary(),
    }))

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              candidates: ['RAW OUTPUT'],
            }),
          },
        },
      ],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest('rewrite', {
      stream: false,
      presetCompatRuntimeContext: {
        namedTranscript: {
          kind: 'chat',
          userName: 'Alice',
          assistantName: 'Bob',
        },
      },
    }))

    expect(response.status).toBe(200)
    const expectedDiagnostics: PresetCompatMacroDiagnostic[] = [
      {
        code: 'UNSUPPORTED_MACRO',
        message: 'Macro is not supported on rewrite: input',
        macroName: 'input',
        surfaceId: 'rewrite',
        phase: 'apply-runtime',
      },
      {
        code: 'MISSING_CONTEXT_VALUE',
        message: 'Macro requires runtime context value: lastmessage',
        macroName: 'lastmessage',
        surfaceId: 'rewrite',
        phase: 'apply-runtime',
      },
    ]
    const payload = await response.json() as {
      metadata?: {
        macroDiagnostics: PresetCompatMacroDiagnostic[]
      }
      candidates: Array<{ content: string }>
      presetCompat: {
        macroDiagnostics: PresetCompatMacroDiagnostic[]
      }
    }
    expect(payload.candidates.map((candidate) => candidate.content)).toEqual(['RAW OUTPUT'])
    expect(payload.metadata?.macroDiagnostics).toEqual(expectedDiagnostics)
    expect(payload.presetCompat.macroDiagnostics).toEqual(expectedDiagnostics)
    expect(readPresetCompatHeader(response).macroDiagnostics).toEqual(expectedDiagnostics)

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const requestBody = JSON.parse(String(requestInit.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    expect(requestBody.messages[1]?.content).toContain('Speaker Alice meets Bob.')
    expect(requestBody.messages[1]?.content).not.toContain('{{user}}')
    expect(requestBody.messages[1]?.content).not.toContain('{{char}}')
    expect(requestBody.messages[1]?.content).not.toContain('{{input}}')
    expect(requestBody.messages[1]?.content).not.toContain('{{lastMessage}}')
  })

  it('renders user macros from protagonist context and falls back to 主人公', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createMacroRuntimeLibrary(),
    }))

    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ candidates: ['RAW OUTPUT'] }) } }],
    }), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    await POST(createRequest('rewrite', {
      stream: false,
      presetCompatRuntimeContext: {
        protagonistName: '林砚',
      },
    }))
    await POST(createRequest('rewrite', { stream: false }))

    const firstRequestBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ role: string; content: string }>
    }
    const secondRequestBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as {
      messages: Array<{ role: string; content: string }>
    }

    expect(firstRequestBody.messages[1]?.content).toContain('Speaker 林砚 meets')
    expect(secondRequestBody.messages[1]?.content).toContain('Speaker 主人公 meets')
    expect(secondRequestBody.messages[1]?.content).not.toContain('{{user}}')
  })

  it('trims context blocks deterministically from lowest-priority tails when openai_max_context is applied', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createRouteEffectsLibrary({
        openaiMaxContext: 8,
        maxContextUnlocked: false,
      }),
    }))
    vi.doMock('@/lib/utils', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/utils')>()),
      estimateTokenCount: (text: string) => text.trim().split(/\s+/).filter(Boolean).length,
    }))
    vi.doMock('@/lib/server/context-builder', () => ({
      buildGenerationContext: async () => ({
        novelId: 'novel-budget',
        branchId: 'novel-budget:main',
        chapterId: 'chapter-budget',
        chapterNo: 3,
        selectedLineStart: 1,
        selectedLineEnd: 2,
        warnings: [],
        promptBlocks: [
          { id: 'highest-block', label: '最高优先级', enabled: true, priority: 'highest', content: 'H1 H2 H3 H4' },
          { id: 'high-block', label: '高优先级', enabled: true, priority: 'high', content: 'A1 A2 A3 A4' },
          { id: 'medium-block', label: '中优先级', enabled: true, priority: 'medium', content: 'M1 M2 M3 M4' },
        ],
        assembledContext: 'unused',
        graphContext: { nodes: [], edges: [], seedEntities: [], contextText: '', warnings: [] },
        lanceEvidence: [],
        tokenEstimate: 12,
      }),
    }))

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ result: 'RAW OUTPUT' }) } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest('rewrite', {
      stream: false,
      novelId: 'novel-budget',
      chapterId: 'chapter-budget',
    }))

    expect(response.status).toBe(200)
    const payload = await response.json() as {
      presetCompat: {
        contextWindow: {
          supported: boolean
          requestedMaxContextTokens: number | null
          effectiveMaxContextTokens: number | null
          tokenEstimate: number | null
          trimmedBlockIds: string[]
        } | null
        fieldStatuses: Array<{ field: string; status: string; reason: string }>
      }
    }
    expect(payload.presetCompat.contextWindow).toMatchObject({
      supported: true,
      requestedMaxContextTokens: 8,
      effectiveMaxContextTokens: 8,
      tokenEstimate: 8,
      trimmedBlockIds: ['medium-block'],
    })
    expect(payload.presetCompat.fieldStatuses.find((status) => status.field === 'openai_max_context')).toMatchObject({
      status: 'applied',
      reason: 'SUPPORTED_RUNTIME',
    })
    expect(payload.presetCompat.fieldStatuses.find((status) => status.field === 'max_context_unlocked')).toMatchObject({
      status: 'preserved',
      reason: 'PRESERVED_EXPORT_ONLY',
    })

    const requestBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }
    expect(requestBody.messages[1]?.content).toContain('H1 H2 H3 H4')
    expect(requestBody.messages[1]?.content).toContain('A1 A2 A3 A4')
    expect(requestBody.messages[1]?.content).not.toContain('M1 M2 M3 M4')
  })

  it.each(['expand', 'polish', 'continue', 'totally-unknown-mode'])('rejects invalid public operation type %s with a deterministic 400', async (operationType) => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createCreativeLibrary(),
    }))

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ result: 'RAW OUTPUT' }) } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest('rewrite', {
      operationType,
      stream: false,
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid operationType. Expected one of: rewrite, future_jump, roleplay',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses imported stream_openai when the request does not override streaming', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('ollama'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => {
        const library = createCreativeLibrary('stream')
        library.presets['rewrite-preset'] = {
          ...library.presets['rewrite-preset'],
          transport: {
            ...library.presets['rewrite-preset'].transport,
            streamOpenAI: true,
          },
        }
        return library
      },
    }))

    const streamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('{"message":{"content":"Alpha"},"done":false}\n'))
        controller.enqueue(encoder.encode('{"message":{"content":"Beta"},"done":true}\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ model: 'ollama-model' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(streamBody, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest('rewrite', {}))

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('Omega')
    expect(readPresetCompatHeader(response).streamPolicy).toMatchObject({
      effective: true,
      requested: true,
      source: 'preset',
    })
  })

  it('trims context blocks to the configured max-context budget and reports the effective budget', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => {
        const library = createCreativeLibrary()
        library.presets['rewrite-preset'] = {
          ...library.presets['rewrite-preset'],
          runtimeSampler: {
            ...library.presets['rewrite-preset'].runtimeSampler,
            openaiMaxContext: 20,
          },
          transport: {
            ...library.presets['rewrite-preset'].transport,
            maxContextUnlocked: true,
          },
        }
        return library
      },
    }))
    vi.doMock('@/lib/utils', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/utils')>()),
      estimateTokenCount: (text: string) => text.trim().split(/\s+/).filter(Boolean).length,
    }))
    vi.doMock('@/lib/server/context-builder', () => ({
      buildGenerationContext: async () => ({
        novelId: 'novel-1',
        branchId: 'novel-1:main',
        chapterId: 'chapter-1',
        chapterNo: 12,
        selectedLineStart: 4,
        selectedLineEnd: 5,
        warnings: [],
        promptBlocks: [
          { id: 'current-summary', label: '当前章节摘要', enabled: true, priority: 'high', content: 'summary keep keep keep keep' },
          { id: 'worldbuilding', label: '相关设定', enabled: true, priority: 'medium', content: 'world trim trim trim trim trim trim trim trim trim trim trim trim trim trim trim trim trim trim' },
        ],
        assembledContext: '',
        graphContext: { nodes: [], edges: [], seedEntities: [], contextText: '', warnings: [] },
        lanceEvidence: [],
        tokenEstimate: 0,
      }),
    }))

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ candidates: ['RAW OUTPUT'] }) } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest('rewrite', {
      stream: false,
      novelId: 'novel-1',
      chapterId: 'chapter-1',
    }))

    expect(response.status).toBe(200)
    const payload = await response.json() as {
      presetCompat: {
        contextWindow: {
          supported: boolean
          requestedMaxContextTokens: number
          effectiveMaxContextTokens: number
          unlockMaximum: boolean
          trimmedBlockIds: string[]
        }
        fieldStatuses: Array<{ field: string; status: string; reason: string }>
      }
    }
    const requestBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }

    expect(payload.presetCompat.contextWindow).toMatchObject({
      supported: true,
      requestedMaxContextTokens: 20,
      effectiveMaxContextTokens: 20,
      unlockMaximum: true,
      trimmedBlockIds: ['worldbuilding'],
    })
    expect(payload.presetCompat.fieldStatuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'openai_max_context', status: 'applied', reason: 'SUPPORTED_RUNTIME' }),
      expect.objectContaining({ field: 'max_context_unlocked', status: 'preserved', reason: 'PRESERVED_EXPORT_ONLY' }),
    ]))
    expect(requestBody.messages[1]?.content).toContain('summary keep keep keep keep')
    expect(requestBody.messages[1]?.content).not.toContain('world trim trim trim')
  })

  it('honors max context unlock so large imported budgets keep rewrite context blocks', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createRouteEffectsLibrary({
        openaiMaxContext: 1_000_000,
        maxContextUnlocked: true,
      }),
    }))
    vi.doMock('@/lib/server/context-builder', () => ({
      buildGenerationContext: async () => ({
        novelId: 'novel-unlocked-context',
        branchId: 'novel-unlocked-context:main',
        chapterId: 'chapter-unlocked-context',
        chapterNo: 7,
        selectedLineStart: null,
        selectedLineEnd: null,
        warnings: [],
        promptBlocks: [
          { id: 'current-summary', label: '当前章节摘要', enabled: true, priority: 'high' as const, content: '# 当前章节摘要\n稳定摘要必须保留' },
          { id: 'chapter-state', label: '截至当前章节的知识状态', enabled: true, priority: 'high' as const, content: '# 截至当前章节的知识状态\n稳定状态必须保留' },
          { id: 'branch-lineage-full-text', label: '当前分支谱系全文', enabled: true, priority: 'highest' as const, content: '# 当前分支谱系全文\n原始章节正文：\n前文正文必须保留' },
        ],
        assembledContext: '',
        graphContext: { nodes: [], edges: [], seedEntities: [], contextText: '', warnings: [] },
        lanceEvidence: [],
        tokenEstimate: 0,
      }),
    }))

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ candidates: ['RAW OUTPUT'] }) } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest('rewrite', {
      stream: false,
      novelId: 'novel-unlocked-context',
      chapterId: 'chapter-unlocked-context',
      selectedText: '选中文本尾部',
    }))

    expect(response.status).toBe(200)
    const payload = await response.json() as {
      presetCompat: {
        contextWindow: {
          requestedMaxContextTokens: number
          effectiveMaxContextTokens: number
          unlockMaximum: boolean
          trimmedBlockIds: string[]
        } | null
        fieldStatuses: Array<{ field: string; status: string; reason: string }>
      }
    }
    const requestBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }
    const content = requestBody.messages[1]?.content ?? ''

    expect(payload.presetCompat.contextWindow).toMatchObject({
      requestedMaxContextTokens: 1_000_000,
      effectiveMaxContextTokens: 1_000_000,
      unlockMaximum: true,
      trimmedBlockIds: [],
    })
    expect(payload.presetCompat.fieldStatuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'openai_max_context', status: 'applied', reason: 'SUPPORTED_RUNTIME' }),
      expect.objectContaining({ field: 'max_context_unlocked', status: 'preserved', reason: 'PRESERVED_EXPORT_ONLY' }),
    ]))
    expect(content).toContain('# 当前章节摘要\n稳定摘要必须保留')
    expect(content).toContain('# 截至当前章节的知识状态\n稳定状态必须保留')
    expect(content).toContain('# 当前分支谱系全文\n原始章节正文：\n前文正文必须保留')
    expect(content.indexOf('# 当前章节摘要')).toBeLessThan(content.indexOf('# 当前分支谱系全文'))
    expect(content.indexOf('# 当前分支谱系全文')).toBeLessThan(content.indexOf('# 选中文本'))
    expect(content.indexOf('# 选中文本')).toBeLessThan(content.lastIndexOf('# 任务'))
  })

  it('degrades formatting statuses for context blocks removed by max-context trimming', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => {
        const library = createTemplateSurfaceLibrary()
        library.presets['rewrite-preset'] = {
          ...library.presets['rewrite-preset'],
          runtimeSampler: {
            ...library.presets['rewrite-preset'].runtimeSampler,
            openaiMaxContext: 8,
          },
          transport: {
            ...library.presets['rewrite-preset'].transport,
            maxContextUnlocked: true,
          },
        }
        return library
      },
    }))
    vi.doMock('@/lib/utils', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/utils')>()),
      estimateTokenCount: (text: string) => text.trim().split(/\s+/).filter(Boolean).length,
    }))
    vi.doMock('@/lib/server/context-builder', () => ({
      buildGenerationContext: async () => ({
        novelId: 'novel-trim-format',
        branchId: 'novel-trim-format:main',
        chapterId: 'chapter-trim-format',
        chapterNo: 8,
        selectedLineStart: 2,
        selectedLineEnd: 3,
        warnings: [],
        promptBlocks: [
          { id: 'current-summary', label: '当前章节摘要', enabled: true, priority: 'high', content: 'summary keep keep keep keep' },
          { id: 'worldbuilding', label: '相关设定', enabled: true, priority: 'medium', content: 'world trim trim trim trim trim trim trim trim trim trim trim trim trim trim trim trim trim trim' },
        ],
        assembledContext: '',
        graphContext: { nodes: [], edges: [], seedEntities: [], contextText: '', warnings: [] },
        lanceEvidence: [],
        tokenEstimate: 0,
      }),
    }))

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ candidates: ['RAW OUTPUT'] }) } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest('rewrite', {
      stream: false,
      novelId: 'novel-trim-format',
      chapterId: 'chapter-trim-format',
    }))

    expect(response.status).toBe(200)
    const payload = await response.json() as {
      presetCompat: {
        fieldStatuses: Array<{ field: string; status: string; reason: string }>
      }
    }
    const requestBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }

    expect(requestBody.messages[1]?.content).toContain('summary keep keep keep keep')
    expect(requestBody.messages[1]?.content).not.toContain('world trim trim trim')
    expect(requestBody.messages[1]?.content).not.toContain('[WI]')
    expect(payload.presetCompat.fieldStatuses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'wi_format',
        status: 'degraded',
        reason: 'WORLD_INFO_CONTEXT_REQUIRED',
      }),
    ]))
  })

  it('injects matching prompt-template fragments on continue, roleplay-group, and example-chat surfaces', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createTemplateSurfaceLibrary(),
    }))

    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              candidates: ['RAW OUTPUT'],
            }),
          },
        },
      ],
    }), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')

    await POST(createRequest('rewrite', {
      stream: false,
      presetCompatRuntimeContext: {
        sessionPhase: 'continue',
      },
    }))

    await POST(createRequest('roleplay', {
      stream: false,
      presetCompatRuntimeContext: {
        sessionPhase: 'new_group_chat',
        hasGroupContext: true,
        hasImpersonationContext: true,
      },
    }))

    await POST(createRequest('rewrite', {
      stream: false,
      presetCompatRuntimeContext: {
        sessionPhase: 'new_example_chat',
        hasExampleContext: true,
      },
    }))

    const continueBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }
    expect(continueBody.messages[0]?.content).not.toContain('CONTINUE TEMPLATE FRAGMENT')
    expect(continueBody.messages[0]?.content).not.toContain('CONTINUE SHOULD NOT SEE NEW CHAT')

    const roleplayBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }
    expect(roleplayBody.messages[0]?.content).not.toContain('ROLEPLAY NEW GROUP TEMPLATE')
    expect(roleplayBody.messages[0]?.content).toContain('ROLEPLAY GROUP NUDGE TEMPLATE')
    expect(roleplayBody.messages[0]?.content).not.toContain('ROLEPLAY IMPERSONATION TEMPLATE')

    const exampleBody = JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }
    expect(exampleBody.messages[0]?.content).not.toContain('REWRITE NEW EXAMPLE TEMPLATE')
    expect(exampleBody.messages[0]?.content).not.toContain('REWRITE SHOULD NOT SEE NEW CHAT')
  })

  it('wraps only matching context blocks for formatting fields and safely degrades names behavior without transcript names', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createTemplateSurfaceLibrary(),
    }))
    vi.doMock('@/lib/server/context-builder', () => ({
      buildGenerationContext: async () => ({
        novelId: 'novel-1',
        branchId: 'novel-1:main',
        chapterId: 'chapter-1',
        chapterNo: 12,
        selectedLineStart: 4,
        selectedLineEnd: 5,
        warnings: [],
        promptBlocks: [
          { id: 'current-summary', label: '当前章节摘要', enabled: true, priority: 'high', content: '# 当前章节摘要\n雨夜里的对峙一触即发。' },
          { id: 'characters', label: '相关人物', enabled: true, priority: 'high', content: '# 相关人物\n- 林澈｜状态：克制｜话少但护短' },
          { id: 'worldbuilding', label: '相关设定', enabled: true, priority: 'medium', content: '# 相关世界设定\n- 月海｜location｜银蓝潮汐会吞没码头' },
          { id: 'output-constraints', label: '输出要求', enabled: true, priority: 'high', content: '# 输出要求\n- 只输出正文。' },
        ],
        assembledContext: [
          '# 当前章节摘要\n雨夜里的对峙一触即发。',
          '# 相关人物\n- 林澈｜状态：克制｜话少但护短',
          '# 相关世界设定\n- 月海｜location｜银蓝潮汐会吞没码头',
          '# 输出要求\n- 只输出正文。',
        ].join('\n\n'),
        graphContext: { nodes: [], edges: [], seedEntities: [], contextText: '', warnings: [] },
        lanceEvidence: [],
        tokenEstimate: 0,
      }),
    }))

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ candidates: ['RAW OUTPUT'] }) } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest('rewrite', {
      stream: false,
      novelId: 'novel-1',
      chapterId: 'chapter-1',
    }))

    expect(response.status).toBe(200)
    const requestBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }

    expect(requestBody.messages[1]?.content.match(/\[WI\]/g)?.length ?? 0).toBe(1)
    expect(requestBody.messages[1]?.content.match(/\[SCENARIO\]/g)?.length ?? 0).toBe(1)
    expect(requestBody.messages[1]?.content.match(/\[PERSONALITY\]/g)?.length ?? 0).toBe(1)
    expect(requestBody.messages[1]?.content).toContain('[WI]\n# 相关世界设定\n- 月海｜location｜银蓝潮汐会吞没码头\n[/WI]')
    expect(requestBody.messages[1]?.content).toContain('[SCENARIO]\n# 当前章节摘要\n雨夜里的对峙一触即发。\n[/SCENARIO]')
    expect(requestBody.messages[1]?.content).toContain('[PERSONALITY]\n# 相关人物\n- 林澈｜状态：克制｜话少但护短\n[/PERSONALITY]')
    expect(requestBody.messages[1]?.content).toContain('# 输出要求\n- 只输出正文。')
    expect(requestBody.messages[1]?.content).not.toContain('USER:')
  })

  it('ignores disabled matching blocks for formatting so omitted blocks are not wrapped', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createTemplateSurfaceLibrary(),
    }))
    vi.doMock('@/lib/server/context-builder', () => ({
      buildGenerationContext: async () => ({
        novelId: 'novel-2',
        branchId: 'novel-2:main',
        chapterId: 'chapter-2',
        chapterNo: 9,
        selectedLineStart: 1,
        selectedLineEnd: 2,
        warnings: [],
        promptBlocks: [
          { id: 'current-summary', label: '当前章节摘要', enabled: true, priority: 'high', content: '# 当前章节摘要\n雨夜里的对峙一触即发。' },
          { id: 'characters', label: '相关人物', enabled: true, priority: 'high', content: '# 相关人物\n- 林澈｜状态：克制｜话少但护短' },
          { id: 'worldbuilding', label: '相关设定', enabled: true, priority: 'medium', content: '# 相关世界设定\n- 月海｜location｜银蓝潮汐会吞没码头' },
        ],
        assembledContext: [
          '# 当前章节摘要\n雨夜里的对峙一触即发。',
          '# 相关人物\n- 林澈｜状态：克制｜话少但护短',
          '# 相关世界设定\n- 月海｜location｜银蓝潮汐会吞没码头',
        ].join('\n\n'),
        graphContext: { nodes: [], edges: [], seedEntities: [], contextText: '', warnings: [] },
        lanceEvidence: [],
        tokenEstimate: 0,
      }),
    }))

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ candidates: ['RAW OUTPUT'] }) } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest('rewrite', {
      stream: false,
      novelId: 'novel-2',
      chapterId: 'chapter-2',
      disabledBlockIds: ['worldbuilding'],
    }))

    expect(response.status).toBe(200)
    const requestBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }

    expect(requestBody.messages[1]?.content).not.toContain('[WI]')
    expect(requestBody.messages[1]?.content).not.toContain('# 相关世界设定')
    expect(requestBody.messages[1]?.content).toContain('[SCENARIO]\n# 当前章节摘要\n雨夜里的对峙一触即发。\n[/SCENARIO]')
    expect(requestBody.messages[1]?.content).toContain('[PERSONALITY]\n# 相关人物\n- 林澈｜状态：克制｜话少但护短\n[/PERSONALITY]')
  })

  it('inserts each selected writing skill once and omits a disabled writing-skill block', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createCreativeLibrary(),
    }))

    const skillPrompts = new Map([
      ['writing-skill-card-1', '## 本次指定写作技巧：技巧甲\n技巧甲唯一内容'],
      ['writing-skill-card-2', '## 本次指定写作技巧：技巧乙\n技巧乙唯一内容'],
    ])
    const createWritingSkillBundle = (cardIds: string[], seed: number) => {
      const blocks = cardIds.map((cardId) => ({
        id: `writing-skill:${cardId}`,
        label: `写作技巧：${cardId}`,
        enabled: true,
        priority: 'highest' as const,
        content: skillPrompts.get(cardId) ?? '',
      }))
      return {
        runtimes: [],
        records: cardIds.map((cardId) => ({
          skillCardId: cardId,
          exampleCount: 2,
          seed,
          selectedExampleRefs: [`${cardId}-example-1`, `${cardId}-example-2`],
        })),
        prompt: blocks.map((block) => block.content).join('\n\n'),
        blocks,
      }
    }
    const resolveWritingSkillRuntimes = vi.fn((input: { cardIds: string[]; seed: number }) => (
      createWritingSkillBundle(input.cardIds, input.seed)
    ))
    const buildGenerationContext = vi.fn(async (input: { writingSkillCardIds?: string[]; writingSkillSeed?: number }) => {
      const writingSkillBundle = createWritingSkillBundle(
        input.writingSkillCardIds ?? [],
        input.writingSkillSeed ?? 1,
      )
      const promptBlocks = [
        { id: 'current-summary', label: '当前章节摘要', enabled: true, priority: 'high' as const, content: '# 当前章节摘要\n稳定摘要' },
        ...writingSkillBundle.blocks,
      ]
      return {
        novelId: 'novel-writing-skills',
        branchId: 'novel-writing-skills:main',
        chapterId: 'chapter-writing-skills',
        chapterNo: 8,
        selectedLineStart: 2,
        selectedLineEnd: 3,
        warnings: [],
        promptBlocks,
        assembledContext: promptBlocks.map((block) => block.content).join('\n\n'),
        graphContext: { nodes: [], edges: [], seedEntities: [], contextText: '', warnings: [] },
        lanceEvidence: [],
        tokenEstimate: 0,
      }
    })
    vi.doMock('@/lib/server/writing-skill-runtime', () => ({
      resolveWritingSkillRuntimes,
    }))
    vi.doMock('@/lib/server/context-builder', () => ({
      buildGenerationContext,
    }))

    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ candidates: ['RAW OUTPUT'] }) } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    const baseWritingSkillRequest = {
      stream: false,
      novelId: 'novel-writing-skills',
      chapterId: 'chapter-writing-skills',
      writingSkillCardIds: ['writing-skill-card-1', 'writing-skill-card-2'],
      writingSkillExampleCount: 2,
      writingSkillSeed: 13579,
    }

    const enabledResponse = await POST(createRequest('rewrite', baseWritingSkillRequest))
    const disabledResponse = await POST(createRequest('rewrite', {
      ...baseWritingSkillRequest,
      disabledBlockIds: ['writing-skill:writing-skill-card-2'],
    }))

    expect(enabledResponse.status).toBe(200)
    expect(disabledResponse.status).toBe(200)
    const enabledBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }
    const disabledBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }
    const enabledPrompt = enabledBody.messages[1]?.content ?? ''
    const disabledPrompt = disabledBody.messages[1]?.content ?? ''

    expect(enabledPrompt.match(/技巧甲唯一内容/g)?.length ?? 0).toBe(1)
    expect(enabledPrompt.match(/技巧乙唯一内容/g)?.length ?? 0).toBe(1)
    expect(disabledPrompt.match(/技巧甲唯一内容/g)?.length ?? 0).toBe(1)
    expect(disabledPrompt).not.toContain('技巧乙唯一内容')
    expect(resolveWritingSkillRuntimes).toHaveBeenNthCalledWith(1, expect.objectContaining({
      cardIds: ['writing-skill-card-1', 'writing-skill-card-2'],
      seed: 13579,
    }))
    expect(resolveWritingSkillRuntimes).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cardIds: ['writing-skill-card-1'],
      seed: 13579,
    }))
    expect(buildGenerationContext).toHaveBeenNthCalledWith(1, expect.objectContaining({
      writingSkillCardIds: ['writing-skill-card-1', 'writing-skill-card-2'],
      writingSkillSeed: 13579,
    }), { cachedRagArtifacts: null })
    expect(buildGenerationContext).toHaveBeenNthCalledWith(2, expect.objectContaining({
      writingSkillCardIds: ['writing-skill-card-1'],
      writingSkillSeed: 13579,
    }), { cachedRagArtifacts: null })
  })

  it('forwards branch lineage selectors into buildGenerationContext for rewrite requests', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createCreativeLibrary(),
    }))
    const buildGenerationContext = vi.fn(async () => ({
      novelId: 'novel-lineage',
      branchId: 'novel-lineage:main',
      chapterId: 'chapter-lineage',
      chapterNo: 10,
      selectedLineStart: 1,
      selectedLineEnd: 2,
      warnings: [],
      promptBlocks: [
        { id: 'current-summary', label: '当前章节摘要', enabled: true, priority: 'high' as const, content: '# 当前章节摘要\n稳定摘要' },
        { id: 'branch-lineage-full-text', label: '当前分支谱系全文', enabled: true, priority: 'highest' as const, content: '# 当前分支谱系全文\n原始章节正文：\n原始正文\n\nRewrite 根节点全文（RE-01）：\n重写正文\n\nContinue 祖先全文（CONT-01）：\n续写正文' },
      ],
      assembledContext: '# 当前章节摘要\n稳定摘要\n\n# 当前分支谱系全文\n原始章节正文：\n原始正文\n\nRewrite 根节点全文（RE-01）：\n重写正文\n\nContinue 祖先全文（CONT-01）：\n续写正文',
      graphContext: { nodes: [], edges: [], seedEntities: [], contextText: '', warnings: [] },
      lanceEvidence: [],
      tokenEstimate: 0,
    }))
    vi.doMock('@/lib/server/context-builder', () => ({
      buildGenerationContext,
    }))

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ candidates: ['RAW OUTPUT'] }) } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest('rewrite', {
      stream: false,
      novelId: 'novel-lineage',
      chapterId: 'chapter-lineage',
      branchContextNodeId: 'continue-node-7',
      branchContextInclusion: 'include_selected',
    }))

    expect(response.status).toBe(200)
    expect(buildGenerationContext).toHaveBeenCalledWith(expect.objectContaining({
      branchContextNodeId: 'continue-node-7',
      branchContextInclusion: 'include_selected',
    }), { cachedRagArtifacts: null })

    const requestBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }
    expect(requestBody.messages[1]?.content).toContain('原始章节正文：')
    expect(requestBody.messages[1]?.content).toContain('重写正文')
    expect(requestBody.messages[1]?.content).toContain('续写正文')
    const content = requestBody.messages[1]?.content ?? ''
    expect(content.indexOf('# 当前章节摘要\n稳定摘要')).toBeLessThan(content.indexOf('# 当前分支谱系全文'))
    expect(content.match(/^# 选中文本$/gm)?.length ?? 0).toBe(1)
    expect(content.indexOf('# 当前分支谱系全文')).toBeLessThan(content.indexOf('# 选中文本'))
    expect(content.indexOf('选中行：1 - 2')).toBeGreaterThan(content.indexOf('# 当前分支谱系全文'))
    expect(content.indexOf('选中行：1 - 2')).toBeLessThan(content.indexOf('# 选中文本'))
    expect(content.indexOf('# 选中文本')).toBeLessThan(content.lastIndexOf('# 任务'))
    expect(content.trim().endsWith([
      '# 任务',
      '操作类型：rewrite',
      '用户要求：指令 BETA',
    ].join('\n'))).toBe(true)
  })

  it('uses branch lineage as the sole continuation body when that context block is active', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('openai-compatible'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createCreativeLibrary(),
    }))
    const buildGenerationContext = vi.fn(async () => ({
      novelId: 'novel-lineage',
      branchId: 'novel-lineage:main',
      chapterId: 'chapter-lineage',
      chapterNo: 10,
      selectedLineStart: null,
      selectedLineEnd: null,
      warnings: [],
      promptBlocks: [
        { id: 'current-summary', label: '当前章节摘要', enabled: true, priority: 'high' as const, content: '# 当前章节摘要\n稳定摘要' },
        { id: 'branch-lineage-full-text', label: '当前分支谱系全文', enabled: true, priority: 'highest' as const, content: '# 当前分支谱系全文\n原始章节正文：\n原始正文\n\nContinue 祖先全文（CONT-01）：\n当前续写正文 ALPHA' },
      ],
      assembledContext: '# 当前章节摘要\n稳定摘要\n\n# 当前分支谱系全文\n原始章节正文：\n原始正文\n\nContinue 祖先全文（CONT-01）：\n当前续写正文 ALPHA',
      graphContext: { nodes: [], edges: [], seedEntities: [], contextText: '', warnings: [] },
      lanceEvidence: [],
      tokenEstimate: 0,
    }))
    vi.doMock('@/lib/server/context-builder', () => ({
      buildGenerationContext,
    }))

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ candidates: ['RAW OUTPUT'] }) } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(createRequest('rewrite', {
      stream: false,
      novelId: 'novel-lineage',
      chapterId: 'chapter-lineage',
      selectedText: '',
      sourceText: '当前续写正文 ALPHA',
      branchContextNodeId: 'continue-node-7',
      branchContextInclusion: 'include_selected',
    }))

    expect(response.status).toBe(200)
    const requestBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }
    const content = requestBody.messages[1]?.content ?? ''
    expect(content.match(/当前续写正文 BETA/g)).toHaveLength(1)
    expect(content).not.toContain('# 已有正文（从这里之后继续写）')
    expect(content).not.toContain('# 选中文本')
    expect(content).toContain('任务类型：续写后续故事')
  })
})
