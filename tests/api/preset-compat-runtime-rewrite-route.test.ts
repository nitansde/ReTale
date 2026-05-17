import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import type { PresetCompatMacroDiagnostic } from '@/lib/preset-compat/macro-context'
import type { PresetCompatLibrary, PresetCompatSurfaceId } from '@/lib/preset-compat/types'
import type { AISettings } from '@/lib/types'

const CREATIVE_SURFACES = ['rewrite', 'expand', 'roleplay', 'polish', 'continue'] as const

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

  for (const surfaceId of CREATIVE_SURFACES) {
    const presetId = `${surfaceId}-preset`
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
          injectionTrigger: null,
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
          injectionTrigger: null,
          forbidOverrides: false,
          condition: null,
          passthrough: {},
        },
      ],
      promptOrderLists: {
        [surfaceId]: [`${surfaceId}-user-rule`, `${surfaceId}-system-rule`],
      },
      embeddedRegexes: [],
      attachedStandaloneRegexIds: ['regex-input', 'regex-output'],
      runtimeSampler: {
        temperature: 0.41,
        topP: 0.82,
        topK: 44,
        minP: 0.06,
        presencePenalty: 0.33,
        frequencyPenalty: 0.27,
        repetitionPenalty: 1.19,
        maxTokens: 2222,
      },
      passthrough: {
        root: {
          seed: 98765,
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

function createRequest(operationType: PresetCompatSurfaceId, body: Record<string, unknown>) {
  return new Request('http://localhost/api/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('preset compat rewrite route runtime', () => {
  it.each(CREATIVE_SURFACES)('applies runtime prompt rules, regexes, and sampler options for %s', async (surfaceId) => {
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
              candidates: ['RAW OUTPUT', 'SECOND RAW OUTPUT', 'THIRD RAW OUTPUT'],
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
      candidates: Array<{ content: string }>
    }
    expect(payload.provider).toBe('openai-compatible')
    expect(payload.candidates.map((candidate) => candidate.content)).toEqual([
      'CLEAN OUTPUT',
      'SECOND CLEAN OUTPUT',
      'THIRD CLEAN OUTPUT',
    ])

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const requestBody = JSON.parse(String(requestInit.body)) as {
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
    expect(requestBody.messages[1]?.content).toContain('## Imported Preset System Rules')
    expect(requestBody.messages[1]?.content).toContain(`${surfaceId.toUpperCase()} SYSTEM RULE`)
    expect(requestBody.messages[1]?.content.trim().endsWith(`${surfaceId.toUpperCase()} SYSTEM RULE`)).toBe(true)
    expect(requestBody.messages[2]?.content.startsWith('## Imported Preset User Rules')).toBe(true)
    expect(requestBody.messages[2]?.content).toContain(`${surfaceId.toUpperCase()} USER RULE`)
    expect(requestBody.messages[2]?.content).toContain('BETA')
    expect(requestBody.messages[2]?.content).not.toContain('ALPHA')
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
    await expect(response.text()).resolves.toBe('Omega')

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
    expect(requestBody.messages[1]?.content.startsWith('## Imported Preset User Rules')).toBe(true)
    expect(requestBody.messages[1]?.content).toContain('BETA')
    expect(requestBody.messages[1]?.content).not.toContain('ALPHA')
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
        surfaceContextBlocks: [
          {
            id: 'named-transcript',
            label: 'Named Transcript',
            content: 'Alice: hello\nBob: hi',
            abstraction: 'named_transcript',
          },
        ],
      },
    }))

    expect(response.status).toBe(200)
    const payload = await response.json() as {
      metadata?: {
        macroDiagnostics: PresetCompatMacroDiagnostic[]
      }
      candidates: Array<{ content: string }>
    }
    expect(payload.candidates.map((candidate) => candidate.content)).toEqual(['RAW OUTPUT'])
    expect(payload.metadata?.macroDiagnostics).toEqual([
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
    ])

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const requestBody = JSON.parse(String(requestInit.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    expect(requestBody.messages[2]?.content).toContain('Speaker Alice meets Bob.')
    expect(requestBody.messages[2]?.content).not.toContain('{{user}}')
    expect(requestBody.messages[2]?.content).not.toContain('{{char}}')
    expect(requestBody.messages[2]?.content).not.toContain('{{input}}')
    expect(requestBody.messages[2]?.content).not.toContain('{{lastMessage}}')
  })
})
