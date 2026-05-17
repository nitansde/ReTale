import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chatbook-llm-debug-'))
  process.env.LLM_DEBUG_LOG_DIR = tempRoot
  return tempRoot
}

async function listJsonFiles(directory: string) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
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
    request: { body: { messages?: Array<{ content: string }> } }
    response: { rawText?: string; parsed?: unknown; error?: string; partial?: boolean }
  }
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
      choices: [{ message: { content: JSON.stringify({ candidates: ['one', 'two', 'three'] }) } }],
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

    expect(result.content).toEqual(['one', 'two', 'three'])
    await expect(fs.readdir(root)).resolves.toEqual([])
  })

  it('writes OpenAI-compatible rewrite prompt and response logs into the rewrite folder', async () => {
    await createTempRoot()
    process.env.LLM_DEBUG_LOG = '1'
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createAiSettings(),
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ candidates: ['raw one', 'raw two', 'raw three'] }) } }],
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
