import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import type { PresetCompatLibrary } from '@/lib/preset-compat/types'
import type { AISettings } from '@/lib/types'

let tempRoot: string | null = null

function createAiSettings(provider: 'openai-compatible' | 'ollama' = 'openai-compatible'): AISettings {
  return {
    rewrite: {
      provider,
      openAICompatible: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        model: 'rewrite-model',
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

async function createTempRoot() {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'retale-llm-debug-'))
  process.env.LLM_DEBUG_LOG_DIR = tempRoot
  return tempRoot
}

async function listJsonFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const nested: string[][] = await Promise.all(entries.map(async (entry): Promise<string[]> => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return listJsonFiles(entryPath)
    return entry.name.endsWith('.json') ? [entryPath] : []
  }))
  return nested.flat()
}

async function readFirstLog(folder: string) {
  const files = await listJsonFiles(path.join(String(tempRoot), folder))
  expect(files).toHaveLength(1)
  return JSON.parse(await fs.readFile(files[0], 'utf8')) as {
    provider: string
    streamed: boolean
    stage?: string
    presetCompat?: {
      runtimeSnapshot?: { activePresetId: string | null; activeSurfaceId: string | null }
    }
    request: { body: { messages?: Array<{ content: string }> } }
    response: {
      rawText?: string
      parsed?: unknown
      outputTransform?: {
        preRegexText?: string
        postRegexText?: string
        candidates?: Array<{
          preRegexText: string
          postRegexText: string
        }>
      }
      error?: string
      partial?: boolean
    }
  }
}

async function readLogs(folder: string) {
  const files = await listJsonFiles(path.join(String(tempRoot), folder))
  return Promise.all(files
    .sort((left: string, right: string) => left.localeCompare(right))
    .map(async (filePath: string) => JSON.parse(await fs.readFile(filePath, 'utf8')) as Awaited<ReturnType<typeof readFirstLog>>))
}

function createDebugPresetLibrary(mode: 'default' | 'rewrite-output' | 'stream-output' = 'default'): PresetCompatLibrary {
  const library = createDefaultPresetCompatLibrary()
  library.standaloneRegexes['rewrite-output-regex'] = {
    id: 'rewrite-output-regex',
    name: 'Rewrite output regex',
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
  library.standaloneRegexes['stream-output-regex'] = {
    id: 'stream-output-regex',
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
  library.presets['debug-preset'] = {
    id: 'debug-preset',
    name: 'Debug Preset',
    sourceApiId: 'openai',
    promptRules: [
      {
        id: 'debug-user-rule',
        name: 'Debug user rule',
        role: 'user',
        content: 'DEBUG PRESET USER RULE',
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
    promptOrderLists: { rewrite: ['debug-user-rule'] },
    embeddedRegexes: [],
    attachedStandaloneRegexIds: mode === 'rewrite-output'
      ? ['rewrite-output-regex']
      : mode === 'stream-output'
        ? ['stream-output-regex']
        : [],
    runtimeSampler: {
      temperature: 0.51,
      topP: null,
      topK: null,
      topA: null,
      minP: null,
      presencePenalty: null,
      frequencyPenalty: null,
      repetitionPenalty: null,
      openaiMaxContext: null,
      maxTokens: null,
      seed: null,
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
    preservedFields: { biasPresetSelected: null },
    passthrough: {},
    importWarnings: [],
    createdAt: '2026-05-17T00:00:00.000Z',
    updatedAt: '2026-05-17T00:00:00.000Z',
  }
  library.surfaceBindings.rewrite = {
    ...library.surfaceBindings.rewrite,
    enabled: true,
    presetId: 'debug-preset',
  }
  return library
}

async function waitForFirstLog(folder: string) {
  const directory = path.join(String(tempRoot), folder)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const files = await listJsonFiles(directory)
      if (files.length > 0) {
        expect(files).toHaveLength(1)
        return JSON.parse(await fs.readFile(files[0], 'utf8')) as Awaited<ReturnType<typeof readFirstLog>>
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
      if (code !== 'ENOENT') throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return readFirstLog(folder)
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules()
  delete process.env.LLM_DEBUG_LOG
  delete process.env.LLM_DEBUG_LOG_DIR
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }
})

describe('llm debug logging', () => {
  it('does not create prompt logs when the debug flag is disabled', async () => {
    const root = await createTempRoot()
    process.env.LLM_DEBUG_LOG = '0'
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings(),
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ result: 'one' }) } }],
    }), { status: 200 })))

    const { generateRewriteWithOpenAICompatible } = await import('@/lib/server/openai-compatible')
    const result = await generateRewriteWithOpenAICompatible({
      sourceText: 'source marker',
      mode: 'heavy',
      tone: 'dramatic',
      scope: 'selection',
      prompt: 'prompt marker',
      keepCanon: true,
      autoContinue: false,
      thoughtLevel: 'none',
    }, {
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'rewrite-model',
    })

    expect(result.content).toEqual(['one'])
    await expect(fs.readdir(root)).resolves.toEqual([])
  })

  it('writes OpenAI-compatible rewrite prompt and response logs into the rewrite folder', async () => {
    await createTempRoot()
    process.env.LLM_DEBUG_LOG = '1'
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings(),
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ result: 'raw one' }) } }],
    }), { status: 200 })))

    const { generateRewriteWithOpenAICompatible } = await import('@/lib/server/openai-compatible')
    await generateRewriteWithOpenAICompatible({
      sourceText: 'source marker',
      mode: 'heavy',
      tone: 'dramatic',
      scope: 'selection',
      prompt: 'prompt marker',
      keepCanon: true,
      autoContinue: false,
      thoughtLevel: 'none',
    }, {
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'rewrite-model',
    })

    const log = await readFirstLog('rewrite')
    expect(log.provider).toBe('openai-compatible')
    expect(log.streamed).toBe(false)
    expect(log.request.body.messages?.at(-1)?.content).toContain('prompt marker')
    expect(log.response.rawText).toContain('raw one')
    expect(JSON.stringify(log)).not.toContain('Bearer')
  })

  it('writes resolved preset compatibility metadata into rewrite debug logs', async () => {
    await createTempRoot()
    process.env.LLM_DEBUG_LOG = '1'
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings(),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createDebugPresetLibrary(),
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ result: 'raw one' }) } }],
    }), { status: 200 })))

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(new Request('http://localhost/api/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-llm-debug',
        sourceText: 'source marker',
        selectedText: 'selected marker',
        prompt: 'prompt marker',
        userInstruction: 'instruction marker',
        operationType: 'rewrite',
        mode: 'heavy',
        tone: 'dramatic',
        scope: 'selection',
        stream: false,
      }),
    }))

    expect(response.status).toBe(200)
    const log = await readFirstLog('rewrite')
    expect(log.presetCompat?.runtimeSnapshot).toMatchObject({
      activePresetId: 'debug-preset',
      activeSurfaceId: 'rewrite',
    })
    expect(log.request.body.messages?.at(-1)?.content).toContain('DEBUG PRESET USER RULE')
  })

  it('writes route-level debug artifacts with pre/post regex candidate text for rewrite responses', async () => {
    await createTempRoot()
    process.env.LLM_DEBUG_LOG = '1'
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings(),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createDebugPresetLibrary('rewrite-output'),
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ result: 'RAW OUTPUT one' }) } }],
    }), { status: 200 })))

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(new Request('http://localhost/api/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-llm-debug',
        sourceText: 'source marker',
        selectedText: 'selected marker',
        prompt: 'prompt marker',
        userInstruction: 'instruction marker',
        operationType: 'rewrite',
        mode: 'heavy',
        tone: 'dramatic',
        scope: 'selection',
        stream: false,
      }),
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      result: { content: 'CLEAN OUTPUT one' },
      candidates: [{ content: 'CLEAN OUTPUT one' }],
    })

    const logs = await readLogs('rewrite')
    expect(logs).toHaveLength(2)
    const providerLog = logs.find((log) => log.stage !== 'output-runtime')
    const runtimeLog = logs.find((log) => log.stage === 'output-runtime')
    expect(providerLog?.response.rawText).toContain('RAW OUTPUT one')
    expect(runtimeLog?.response.outputTransform?.candidates).toEqual([
      { preRegexText: 'RAW OUTPUT one', postRegexText: 'CLEAN OUTPUT one' },
    ])
  })

  it('writes knowledge extraction logs into the knowledge-extraction folder', async () => {
    await createTempRoot()
    process.env.LLM_DEBUG_LOG = '1'
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings(),
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        chapter_no: 7,
        summary: '',
        characters: [],
        relations: [],
        events: [],
        worldbuilding: [],
        open_threads: [{ name: 'thread', description: 'open marker', evidence: [] }],
      }) } }],
    }), { status: 200 })))

    const { extractChapterKnowledgeWithOpenAICompatible } = await import('@/lib/server/openai-compatible')
    await extractChapterKnowledgeWithOpenAICompatible({
      chapterTitle: 'Chapter',
      chapterNo: 7,
      rawText: 'knowledge prompt marker',
      mode: 'focused',
    }, {
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'knowledge-model',
    })

    const log = await readFirstLog('knowledge-extraction')
    expect(log.stage).toBe('extract')
    expect(log.request.body.messages?.[1]?.content).toContain('knowledge prompt marker')
    expect(log.response.rawText).toContain('open marker')
  })

  it('writes accumulated Ollama stream text after the stream is consumed', async () => {
    await createTempRoot()
    process.env.LLM_DEBUG_LOG = '1'
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('ollama'),
    }))
    vi.doMock('@/lib/server/persistence', () => ({
      findAppSettings: () => [],
    }))
    const streamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('{"message":{"content":"Alpha"},"done":false}\n'))
        controller.enqueue(encoder.encode('{"message":{"content":"Beta"},"done":true}\n'))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ model: 'ollama-model' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(streamBody, { status: 200 })))

    const { streamRewriteWithOllama } = await import('@/lib/server/ollama-local')
    const result = await streamRewriteWithOllama({
      systemPrompt: 'system prompt marker',
      userPrompt: 'user prompt marker',
    }, {
      baseUrl: 'http://127.0.0.1:11434',
      model: 'ollama-model',
    })

    expect(result.stream).toBeDefined()
    await expect(new Response(result.stream).text()).resolves.toBe('AlphaBeta')
    const log = await readFirstLog('rewrite')
    expect(log.provider).toBe('ollama')
    expect(log.streamed).toBe(true)
    expect(log.request.body.messages?.[1]?.content).toBe('user prompt marker')
    expect(log.response.rawText).toBe('AlphaBeta')
  })

  it('writes route-level debug artifacts with pre/post regex text for streamed rewrites', async () => {
    await createTempRoot()
    process.env.LLM_DEBUG_LOG = '1'
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('ollama'),
    }))
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => createDebugPresetLibrary('stream-output'),
    }))
    vi.doMock('@/lib/server/persistence', () => ({
      findAppSettings: () => [],
    }))
    const streamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('{"message":{"content":"Alpha"},"done":false}\n'))
        controller.enqueue(encoder.encode('{"message":{"content":"Beta"},"done":true}\n'))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ model: 'ollama-model' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(streamBody, { status: 200 })))

    const { POST } = await import('@/app/api/rewrite/route')
    const response = await POST(new Request('http://localhost/api/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-llm-debug',
        sourceText: 'source marker',
        selectedText: 'selected marker',
        prompt: 'prompt marker',
        userInstruction: 'instruction marker',
        operationType: 'rewrite',
        mode: 'heavy',
        tone: 'dramatic',
        scope: 'selection',
        stream: true,
      }),
    }))

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('Omega')

    const logs = await readLogs('rewrite')
    expect(logs).toHaveLength(2)
    const providerLog = logs.find((log) => log.stage !== 'output-runtime')
    const runtimeLog = logs.find((log) => log.stage === 'output-runtime')
    expect(providerLog?.response.rawText).toBe('AlphaBeta')
    expect(runtimeLog?.response.outputTransform).toEqual({
      preRegexText: 'AlphaBeta',
      postRegexText: 'Omega',
    })
  })

  it('writes Ollama knowledge extraction logs into the knowledge-extraction folder', async () => {
    await createTempRoot()
    process.env.LLM_DEBUG_LOG = '1'
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('ollama'),
    }))
    vi.doMock('@/lib/server/persistence', () => ({
      findAppSettings: () => [],
    }))
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ model: 'knowledge-ollama' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        message: {
          content: JSON.stringify({
            chapter_no: 8,
            summary: '',
            characters: [],
            relations: [],
            events: [],
            worldbuilding: [],
            open_threads: [{ name: 'ollama-thread', description: 'ollama open marker', evidence: [] }],
          }),
        },
      }), { status: 200 })))

    const { extractChapterKnowledgeWithOllama } = await import('@/lib/server/ollama-local')
    const result = await extractChapterKnowledgeWithOllama({
      chapterTitle: 'Chapter',
      chapterNo: 8,
      rawText: 'ollama knowledge prompt marker',
      mode: 'focused',
    }, {
      baseUrl: 'http://127.0.0.1:11434',
      model: 'knowledge-ollama',
    })

    expect(result.extraction?.openThreads[0]?.description).toBe('ollama open marker')
    const log = await readFirstLog('knowledge-extraction')
    expect(log.provider).toBe('ollama')
    expect(log.stage).toBe('extract')
    expect(log.request.body.messages?.[1]?.content).toContain('ollama knowledge prompt marker')
    expect(log.response.rawText).toContain('ollama open marker')
  })

  it('logs Ollama stream error chunks as partial failures instead of success', async () => {
    await createTempRoot()
    process.env.LLM_DEBUG_LOG = '1'
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings('ollama'),
    }))
    vi.doMock('@/lib/server/persistence', () => ({
      findAppSettings: () => [],
    }))
    const streamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('{"message":{"content":"Alpha"},"done":false}\n'))
        controller.enqueue(encoder.encode('{"error":"boom"}\n'))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ model: 'ollama-model' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(streamBody, { status: 200 })))

    const { streamRewriteWithOllama } = await import('@/lib/server/ollama-local')
    const result = await streamRewriteWithOllama({
      systemPrompt: 'system prompt marker',
      userPrompt: 'user prompt marker',
    }, {
      baseUrl: 'http://127.0.0.1:11434',
      model: 'ollama-model',
    })

    expect(result.stream).toBeDefined()
    await expect(new Response(result.stream).text()).rejects.toThrow('boom')
    const log = await waitForFirstLog('rewrite')
    expect(log.response.rawText).toBe('Alpha')
    expect(log.response.error).toBe('boom')
    expect(log.response.partial).toBe(true)
  })
})
