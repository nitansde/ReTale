import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  vi.unmock('@/lib/server/ai-settings')
})

describe('Ollama embedding error formatting', () => {
  it('includes endpoint, model, input count, timeout, and fetch cause details', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => ({
        rewrite: {
          provider: 'openai-compatible',
          openAICompatible: { baseUrl: 'https://example.test/v1', apiKey: '', apiKeyConfigured: false, apiKeyMasked: '', model: 'unused', configured: false },
          ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'unused', configured: false },
        },
        knowledgeExtraction: {
          provider: 'openai-compatible',
          openAICompatible: { baseUrl: 'https://example.test/v1', apiKey: '', apiKeyConfigured: false, apiKeyMasked: '', model: 'unused', configured: false, parallelism: 1 },
          ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'unused', configured: false, parallelism: 1 },
        },
        embeddings: {
          provider: 'ollama',
          embeddingBatchSize: 16,
          openAICompatible: { baseUrl: 'https://example.test/v1', apiKey: '', apiKeyConfigured: false, apiKeyMasked: '', model: 'unused-openai', configured: false },
          ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'unit-test-embedding-model', configured: true },
        },
      }),
    }))

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        models: [{ model: 'unit-test-embedding-model' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        capabilities: ['embedding'],
      }), { status: 200 }))
      .mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), {
        cause: {
          name: 'SocketError',
          code: 'ECONNRESET',
          message: 'socket hang up',
        },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const { embedTextsWithOllama } = await import('@/lib/server/ollama-local')
    const result = await embedTextsWithOllama(['alpha', 'beta'])

    expect(result).toMatchObject({
      enabled: false,
      model: 'unit-test-embedding-model',
      error: expect.stringContaining('endpoint=http://127.0.0.1:11434/api/embed'),
    })
    expect(result.error).toContain('baseUrl=http://127.0.0.1:11434')
    expect(result.error).toContain('model=unit-test-embedding-model')
    expect(result.error).toContain('inputCount=2')
    expect(result.error).toContain('timeoutMs=600000')
    expect(result.error).toContain('errorName=TypeError')
    expect(result.error).toContain('errorMessage=fetch failed')
    expect(result.error).toContain('causeName=SocketError')
    expect(result.error).toContain('causeCode=ECONNRESET')
    expect(result.error).toContain('causeMessage=socket hang up')
  })
})
