import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import type { AISettings } from '@/lib/types'

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

function createRequest(body: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceText: '原文',
      selectedText: '选段',
      prompt: '提示',
      userInstruction: '指令',
      mode: 'heavy',
      tone: 'dramatic',
      scope: 'selection',
      operationType: 'rewrite',
      stream: false,
      ...body,
    }),
  })
}

async function importRouteWithProvider(provider: 'openai-compatible' | 'ollama') {
  vi.doMock('@/lib/server/ai-settings', () => ({
    loadStoredAISettings: () => createAiSettings(provider),
  }))
  vi.doMock('@/lib/server/preset-compat-library', () => ({
    loadStoredPresetCompatLibrary: () => createDefaultPresetCompatLibrary(),
  }))

  return import('@/app/api/rewrite/route')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('/api/rewrite provider error contract', () => {
  it('returns successful OpenAI-compatible rewrite content and metadata without fallback markers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ result: '真实改写结果' }) } }],
      usage: { prompt_tokens: 12, completion_tokens: 34 },
    }), { status: 200 })))

    const { POST } = await importRouteWithProvider('openai-compatible')
    const response = await POST(createRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      provider: 'openai-compatible',
      result: {
        content: '真实改写结果',
        inputTokens: 12,
        outputTokens: 34,
      },
      candidates: [{ content: '真实改写结果' }],
    })
  })

  it('returns successful Ollama rewrite content and metadata without fallback markers', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ model: 'ollama-model' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        message: { content: JSON.stringify({ result: '本地改写结果' }) },
        prompt_eval_count: 5,
        eval_count: 8,
      }), { status: 200 })))

    const { POST } = await importRouteWithProvider('ollama')
    const response = await POST(createRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      provider: 'ollama',
      result: {
        content: '本地改写结果',
        inputTokens: 5,
        outputTokens: 8,
      },
      candidates: [{ content: '本地改写结果' }],
    })
  })

  it('maps timeout failures to a stable provider_request_failed payload', async () => {
    const timeoutError = new Error('aborted')
    timeoutError.name = 'AbortError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError))

    const { POST } = await importRouteWithProvider('openai-compatible')
    const response = await POST(createRequest())

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'provider_request_failed',
      provider: 'openai-compatible',
      error: 'Provider request timed out after 20000ms',
    })
  })

  it('maps malformed provider JSON to a stable provider_request_failed payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"result":' } }],
    }), { status: 200 })))

    const { POST } = await importRouteWithProvider('openai-compatible')
    const response = await POST(createRequest())

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'provider_request_failed',
      provider: 'openai-compatible',
      error: 'Provider returned malformed JSON.',
    })
  })

  it('maps empty provider content to a stable provider_request_failed payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ result: '' }) } }],
    }), { status: 200 })))

    const { POST } = await importRouteWithProvider('openai-compatible')
    const response = await POST(createRequest())

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'provider_request_failed',
      provider: 'openai-compatible',
      error: 'Provider returned empty content.',
    })
  })

  it('maps network failures to a stable provider_request_failed payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    const { POST } = await importRouteWithProvider('openai-compatible')
    const response = await POST(createRequest())

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'provider_request_failed',
      provider: 'openai-compatible',
      error: 'Provider request failed',
    })
  })
})
