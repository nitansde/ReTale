import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('settings AI route validation', () => {
  it('rejects invalid OpenAI model discovery scenarios with stable 400 JSON', async () => {
    const listAvailableOpenAICompatibleModels = vi.fn()
    vi.doMock('@/lib/server/openai-compatible', () => ({
      listAvailableOpenAICompatibleModels,
    }))

    const { POST } = await import('@/app/api/settings/ai/openai-models/route')
    const response = await POST(new Request('http://localhost/api/settings/ai/openai-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'invalid-scenario' }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'scenario is invalid' })
    expect(listAvailableOpenAICompatibleModels).not.toHaveBeenCalled()
  })

  it('rejects malformed AI settings JSON with stable 400 errors', async () => {
    const loadStoredAISettings = vi.fn()
    const saveStoredAISettings = vi.fn()
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings,
      saveStoredAISettings,
      AI_SETTINGS_V2_KEY: 'AI_SETTINGS_V2',
      OLLAMA_TIMEOUT_MS_KEY: 'OLLAMA_TIMEOUT_MS',
      loadProtectedAISettingsResetSnapshot: vi.fn(),
      validateProtectedAISettingsResetSnapshot: vi.fn(),
    }))

    const { POST } = await import('@/app/api/settings/ai/route')
    const response = await POST(new Request('http://localhost/api/settings/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Invalid JSON body' })
    expect(loadStoredAISettings).not.toHaveBeenCalled()
    expect(saveStoredAISettings).not.toHaveBeenCalled()
  })

  it('rejects invalid Ollama discovery purposes with stable 400 JSON', async () => {
    const listAvailableOllamaEmbeddingModels = vi.fn()
    const listAvailableOllamaTextModels = vi.fn()
    vi.doMock('@/lib/server/ollama-local', () => ({
      listAvailableOllamaEmbeddingModels,
      listAvailableOllamaTextModels,
    }))

    const { GET } = await import('@/app/api/settings/ai/ollama-models/route')
    const response = await GET(new Request('http://localhost/api/settings/ai/ollama-models?purpose=invalid'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'purpose is invalid' })
    expect(listAvailableOllamaEmbeddingModels).not.toHaveBeenCalled()
    expect(listAvailableOllamaTextModels).not.toHaveBeenCalled()
  })

  it('forwards the OpenAI discovery request signal', async () => {
    const listAvailableOpenAICompatibleModels = vi.fn().mockResolvedValue({
      baseUrl: 'https://example.test/v1',
      models: [],
    })
    vi.doMock('@/lib/server/openai-compatible', () => ({
      listAvailableOpenAICompatibleModels,
    }))

    const { POST } = await import('@/app/api/settings/ai/openai-models/route')
    const request = new Request('http://localhost/api/settings/ai/openai-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        scenario: 'embeddings',
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(listAvailableOpenAICompatibleModels).toHaveBeenCalledWith(
      'https://example.test/v1',
      'test-key',
      'embeddings',
      request.signal,
    )
  })

  it('forwards the Ollama discovery request signal for both purposes', async () => {
    const listAvailableOllamaEmbeddingModels = vi.fn().mockResolvedValue({
      baseUrl: 'http://127.0.0.1:11434',
      models: [],
    })
    const listAvailableOllamaTextModels = vi.fn().mockResolvedValue({
      baseUrl: 'http://127.0.0.1:11434',
      models: [],
    })
    vi.doMock('@/lib/server/ollama-local', () => ({
      listAvailableOllamaEmbeddingModels,
      listAvailableOllamaTextModels,
    }))

    const { GET } = await import('@/app/api/settings/ai/ollama-models/route')
    const textRequest = new Request('http://localhost/api/settings/ai/ollama-models?baseUrl=http%3A%2F%2F127.0.0.1%3A11434&purpose=text')
    const embeddingRequest = new Request('http://localhost/api/settings/ai/ollama-models?baseUrl=http%3A%2F%2F127.0.0.1%3A11434&purpose=embedding')

    expect((await GET(textRequest)).status).toBe(200)
    expect((await GET(embeddingRequest)).status).toBe(200)
    expect(listAvailableOllamaTextModels).toHaveBeenCalledWith('http://127.0.0.1:11434', textRequest.signal)
    expect(listAvailableOllamaEmbeddingModels).toHaveBeenCalledWith('http://127.0.0.1:11434', embeddingRequest.signal)
  })

})
