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
      novelId: 'novel-rewrite-provider-contract',
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
  it('reuses preview RAG artifacts while rebuilding the generation prompt', async () => {
    const cachedContext = {
      novelId: 'novel-rewrite-provider-contract',
      branchId: 'novel-rewrite-provider-contract:main',
      chapterId: 'chapter-1',
      chapterNo: 1,
      selectedLineStart: 1,
      selectedLineEnd: 1,
      warnings: [],
      promptBlocks: [{ id: 'current-summary', label: 'Summary', enabled: true, priority: 'high' as const, content: '# Summary\nCached context marker' }],
      assembledContext: '# Summary\nCached context marker',
      graphContext: { seedEntities: [], nodes: [], edges: [], contextText: '', warnings: [], tokenEstimate: 0, status: 'ready' as const },
      lanceEvidence: [],
      tokenEstimate: 4,
    }
    const cachedRagArtifacts = {
      version: 1 as const,
      graph: {
        cacheKey: 'graph-cache-key',
        knowledgeFingerprint: 'graph-knowledge-fingerprint',
        context: cachedContext.graphContext,
      },
      evidence: {
        cacheKey: 'evidence-cache-key',
        retrievalFingerprint: 'evidence-retrieval-fingerprint',
        matches: [],
      },
    }
    const buildGenerationContext = vi.fn(() => cachedContext)
    const loadGenerationContextSnapshot = vi.fn(() => cachedRagArtifacts)
    vi.doMock('@/lib/server/context-builder', () => ({ buildGenerationContext }))
    vi.doMock('@/lib/server/generation-context-snapshot', () => ({ loadGenerationContextSnapshot }))
    vi.doMock('@/lib/server/database-access', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/database-access')>()
      return {
        ...actual,
        runWithNovelDatabaseAccess: (_novelId: string, callback: () => unknown) => callback(),
      }
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ result: '使用缓存完成' }) } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await importRouteWithProvider('openai-compatible')
    const response = await POST(createRequest({
      chapterId: 'chapter-1',
      branchId: 'novel-rewrite-provider-contract:main',
      contextSnapshotId: 'generation-context-1',
    }))

    expect(response.status).toBe(200)
    expect(loadGenerationContextSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      snapshotId: 'generation-context-1',
      request: expect.objectContaining({
        novelId: 'novel-rewrite-provider-contract',
        branchId: 'novel-rewrite-provider-contract:main',
        chapterId: 'chapter-1',
      }),
    }))
    expect(buildGenerationContext).toHaveBeenCalledWith(
      expect.objectContaining({
        novelId: 'novel-rewrite-provider-contract',
        branchId: 'novel-rewrite-provider-contract:main',
        chapterId: 'chapter-1',
        selectedText: '选段',
        userInstruction: '指令',
      }),
      { cachedRagArtifacts },
    )
    const providerBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }
    expect(providerBody.messages[1]?.content).toContain('Cached context marker')
  })

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
      error: 'Provider request timed out after 300000ms',
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
