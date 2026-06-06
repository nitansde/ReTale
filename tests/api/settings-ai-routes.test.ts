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
})
