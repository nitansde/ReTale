import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_EMBEDDING_API_KEY, LOCAL_EMBEDDING_BASE_URL } from '@/lib/local-embedding'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.unstubAllGlobals()
})

describe('local embedding OpenAI-compatible input handling', () => {
  it('keeps documents unchanged and adds the Qwen instruction only to queries', async () => {
    const ensureLocalEmbeddingRuntimeRunning = vi.fn().mockResolvedValue(undefined)
    vi.doMock('@/lib/server/local-embedding-runtime', () => ({ ensureLocalEmbeddingRuntimeRunning }))
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: vi.fn(() => ({
        embeddings: {
          openAICompatible: {
            baseUrl: LOCAL_EMBEDDING_BASE_URL,
            apiKey: LOCAL_EMBEDDING_API_KEY,
            model: 'qwen3-embedding-0.6b-q8_0',
          },
        },
      })),
    }))

    const requestBodies: Array<{ input: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as { input: string })
      return new Response(JSON.stringify({
        model: 'qwen3-embedding-0.6b-q8_0',
        data: [{ embedding: [0.1, 0.2] }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))

    const { embedTextsWithOpenAICompatible } = await import('@/lib/server/openai-compatible')
    const config = {
      baseUrl: LOCAL_EMBEDDING_BASE_URL,
      apiKey: LOCAL_EMBEDDING_API_KEY,
      model: 'qwen3-embedding-0.6b-q8_0',
    }
    await embedTextsWithOpenAICompatible('原文段落', config, { inputType: 'document' })
    await embedTextsWithOpenAICompatible('谁拿走了钥匙？', config, { inputType: 'query' })

    expect(requestBodies[0]?.input).toBe('原文段落')
    expect(requestBodies[1]?.input).toBe(
      'Instruct: Given a query about a novel, retrieve passages, entities, events, and relationships relevant to the query\nQuery: 谁拿走了钥匙？',
    )
    expect(ensureLocalEmbeddingRuntimeRunning).toHaveBeenCalledTimes(2)
  })
})
