import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS,
  withProviderModelDiscoveryDeadline,
} from '@/lib/server/provider-model-discovery'

function createStoredSettings() {
  return {
    rewrite: {
      provider: 'openai-compatible' as const,
      openAICompatible: { baseUrl: 'https://stored.test/v1', apiKey: 'stored-key', model: 'stored-model', configured: true },
      ollama: { baseUrl: 'http://127.0.0.1:11434', model: '', configured: false },
    },
    knowledgeExtraction: {
      provider: 'ollama' as const,
      openAICompatible: { baseUrl: 'https://stored.test/v1', apiKey: 'stored-key', model: 'stored-model', configured: true, parallelism: 1 },
      ollama: { baseUrl: 'http://127.0.0.1:11434', model: '', configured: false, parallelism: 1 },
    },
    embeddings: {
      provider: 'ollama' as const,
      openAICompatible: { baseUrl: 'https://stored.test/v1', apiKey: 'stored-key', model: 'stored-model', configured: true },
      ollama: { baseUrl: 'http://127.0.0.1:11434', model: '', configured: false },
      embeddingBatchSize: 16,
    },
  }
}

function mockProviderSettings() {
  vi.doMock('@/lib/server/ai-settings', () => ({
    loadStoredAISettings: () => createStoredSettings(),
  }))
  vi.doMock('@/lib/server/persistence', () => ({
    findAppSettings: () => [],
  }))
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('provider model discovery deadline', () => {
  it('aborts the whole operation after 10 seconds and clears its timer', async () => {
    vi.useFakeTimers()
    let operationSignal: AbortSignal | undefined

    const discoveryPromise = withProviderModelDiscoveryDeadline((signal) => {
      operationSignal = signal
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const rejection = expect(discoveryPromise).rejects.toMatchObject({
      name: 'TimeoutError',
      message: `Provider model discovery timed out after ${PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS}ms`,
    })

    await vi.advanceTimersByTimeAsync(PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS)

    await rejection
    expect(operationSignal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('propagates caller cancellation and removes its listener in finally', async () => {
    vi.useFakeTimers()
    const inputController = new AbortController()
    const removeEventListener = vi.spyOn(inputController.signal, 'removeEventListener')
    const reason = new DOMException('Client disconnected', 'AbortError')
    let operationSignal: AbortSignal | undefined

    const discoveryPromise = withProviderModelDiscoveryDeadline((signal) => {
      operationSignal = signal
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }, inputController.signal)
    const rejection = expect(discoveryPromise).rejects.toBe(reason)

    inputController.abort(reason)

    await rejection
    expect(operationSignal).not.toBe(inputController.signal)
    expect(operationSignal?.reason).toBe(reason)
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('provider model discovery fetches', () => {
  it('uses the composed signal for OpenAI-compatible /models', async () => {
    mockProviderSettings()
    const inputController = new AbortController()
    let fetchSignal: AbortSignal | null | undefined
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      fetchSignal = init?.signal
      return Promise.resolve(new Response(JSON.stringify({
        data: [
          { id: 'z-model' },
          { id: 'a-model', owned_by: 'owner' },
        ],
      }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const { listAvailableOpenAICompatibleModels } = await import('@/lib/server/openai-compatible')
    const result = await listAvailableOpenAICompatibleModels(
      'https://example.test/v1',
      'test-key',
      'rewrite',
      inputController.signal,
    )

    expect(fetchMock).toHaveBeenCalledWith('https://example.test/v1/models', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }))
    expect(fetchSignal).not.toBe(inputController.signal)
    expect(result.models.map((model) => model.id)).toEqual(['a-model', 'z-model'])
  })

  it('caps Ollama /api/show concurrency at four and preserves tag order and fallback filtering', async () => {
    vi.useFakeTimers()
    mockProviderSettings()
    const modelIds = ['text-0', 'text-1', 'fallback-text', 'text-3', 'text-4', 'text-5', 'fallback-embed']
    let activeShows = 0
    let maxActiveShows = 0
    const showSignals: AbortSignal[] = []
    let tagsSignal: AbortSignal | null | undefined

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString()
      if (url.endsWith('/api/tags')) {
        tagsSignal = init?.signal
        return new Response(JSON.stringify({
          models: modelIds.map((model) => ({ name: model, model })),
        }), { status: 200 })
      }

      const body = JSON.parse(String(init?.body)) as { model: string }
      showSignals.push(init?.signal as AbortSignal)
      activeShows += 1
      maxActiveShows = Math.max(maxActiveShows, activeShows)
      try {
        await new Promise((resolve) => setTimeout(resolve, 20 - modelIds.indexOf(body.model)))
        if (body.model.startsWith('fallback-')) {
          throw new Error('show unavailable')
        }
        return new Response(JSON.stringify({ capabilities: ['completion'] }), { status: 200 })
      } finally {
        activeShows -= 1
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { listAvailableOllamaTextModels } = await import('@/lib/server/ollama-local')
    const resultPromise = listAvailableOllamaTextModels('http://127.0.0.1:11434')

    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(maxActiveShows).toBe(4)
    expect(showSignals).toHaveLength(modelIds.length)
    expect(new Set(showSignals).size).toBe(1)
    expect(tagsSignal).toBe(showSignals[0])
    expect(result.models.map((model) => model.id)).toEqual([
      'text-0',
      'text-1',
      'fallback-text',
      'text-3',
      'text-4',
      'text-5',
    ])
  })

  it('rethrows the whole-operation timeout from an Ollama capability probe', async () => {
    vi.useFakeTimers()
    mockProviderSettings()

    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString()
      if (url.endsWith('/api/tags')) {
        return Promise.resolve(new Response(JSON.stringify({
          models: [{ name: 'text-model', model: 'text-model' }],
        }), { status: 200 }))
      }

      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { listAvailableOllamaTextModels } = await import('@/lib/server/ollama-local')
    const discoveryPromise = listAvailableOllamaTextModels('http://127.0.0.1:11434')
    const rejection = expect(discoveryPromise).rejects.toMatchObject({
      name: 'TimeoutError',
      message: `Provider model discovery timed out after ${PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS}ms`,
    })

    await vi.advanceTimersByTimeAsync(PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS)

    await rejection
  })

  it('rethrows cancellation from an Ollama capability probe', async () => {
    mockProviderSettings()
    const inputController = new AbortController()
    const reason = new DOMException('Client disconnected', 'AbortError')
    let showStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      showStarted = resolve
    })

    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString()
      if (url.endsWith('/api/tags')) {
        return Promise.resolve(new Response(JSON.stringify({
          models: [{ name: 'text-model', model: 'text-model' }],
        }), { status: 200 }))
      }

      showStarted?.()
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { listAvailableOllamaTextModels } = await import('@/lib/server/ollama-local')
    const discoveryPromise = listAvailableOllamaTextModels('http://127.0.0.1:11434', inputController.signal)
    const rejection = expect(discoveryPromise).rejects.toBe(reason)

    await started
    inputController.abort(reason)

    await rejection
  })
})
