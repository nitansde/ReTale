import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamRewriteWithOpenAICompatible } from '@/lib/server/openai-compatible'
import {
  NON_STREAM_PROVIDER_TIMEOUT_MS,
  requestProviderEndpoint,
  STREAM_PROVIDER_IDLE_TIMEOUT_MS,
} from '@/lib/server/provider-request'

function createAbortError(message = 'The operation was aborted') {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('provider request timeout semantics', () => {
  it('does not abort a non-stream request at older 20s or 30s timeout call-site values', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(createAbortError()), { once: true })

        setTimeout(() => {
          resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
        }, 30_000)
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const requestPromise = requestProviderEndpoint({
      provider: 'openai-compatible',
      action: 'Provider request',
      url: 'https://example.test/v1/chat/completions',
      model: 'model',
      requestBody: { stream: false },
      requestInit: { method: 'POST' },
      timeoutMs: 20_000,
      streamed: false,
    })

    let settled = false
    void requestPromise.then(() => {
      settled = true
    }, () => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(20_000)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(10_000)
    const { response, cleanup } = await requestPromise
    await expect(response.json()).resolves.toEqual({ ok: true })
    cleanup()
  })

  it('aborts a non-stream request after the 5-minute minimum when no response arrives', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(createAbortError()), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const requestPromise = requestProviderEndpoint({
      provider: 'openai-compatible',
      action: 'Provider request',
      url: 'https://example.test/v1/chat/completions',
      model: 'model',
      requestBody: { stream: false },
      requestInit: { method: 'POST' },
      timeoutMs: 20_000,
      streamed: false,
    })

    let settled = false
    void requestPromise.then(() => {
      settled = true
    }, () => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(30_000)
    expect(settled).toBe(false)

    const rejectionPromise = expect(requestPromise).rejects.toThrow(`Provider request timed out after ${NON_STREAM_PROVIDER_TIMEOUT_MS}ms`)
    await vi.advanceTimersByTimeAsync(NON_STREAM_PROVIDER_TIMEOUT_MS - 30_000)
    await rejectionPromise
  })

  it('still honors an explicit caller abort during a non-stream request', async () => {
    vi.useFakeTimers()

    const inputController = new AbortController()
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(createAbortError()), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const requestPromise = requestProviderEndpoint({
      provider: 'openai-compatible',
      action: 'Provider request',
      url: 'https://example.test/v1/chat/completions',
      model: 'model',
      requestBody: { stream: false },
      requestInit: { method: 'POST' },
      timeoutMs: 20_000,
      streamed: false,
      inputSignal: inputController.signal,
    })

    const rejectionPromise = expect(requestPromise).rejects.toThrow('Provider request aborted')
    inputController.abort()
    await vi.runAllTimersAsync()

    await rejectionPromise
  })

  it('allows a slow initial streamed response for nearly three minutes', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(createAbortError()), { once: true })

        setTimeout(() => {
          const encoder = new TextEncoder()
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Alpha"}}]}\n\n'))
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
            },
          })

          resolve(new Response(body, { status: 200 }))
        }, STREAM_PROVIDER_IDLE_TIMEOUT_MS - 1000)
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const resultPromise = streamRewriteWithOpenAICompatible({
      systemPrompt: 'system prompt',
      userPrompt: 'user prompt',
    }, {
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'stream-model',
    })

    let settled = false
    void resultPromise.then(() => {
      settled = true
    }, () => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(30_000)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(STREAM_PROVIDER_IDLE_TIMEOUT_MS - 31_000)
    const result = await resultPromise

    expect(result.enabled).toBe(true)
    expect(result.error).toBeUndefined()
    await expect(new Response(result.stream).text()).resolves.toBe('Alpha')
  })

  it('resets the inactivity timer whenever streamed bytes arrive', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal
      const encoder = new TextEncoder()

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener('abort', () => controller.error(createAbortError()), { once: true })
          setTimeout(() => controller.enqueue(encoder.encode('A')), 1000)
          setTimeout(() => controller.enqueue(encoder.encode('B')), 170_000)
        },
      })

      return Promise.resolve(new Response(body, { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const { response } = await requestProviderEndpoint({
      provider: 'openai-compatible',
      action: 'Provider request',
      url: 'https://example.test/v1/chat/completions',
      model: 'stream-model',
      requestBody: { stream: true },
      requestInit: { method: 'POST' },
      timeoutMs: STREAM_PROVIDER_IDLE_TIMEOUT_MS,
      streamed: true,
    })

    const textPromise = new Response(response.body).text()
    let settled = false
    void textPromise.then(() => {
      settled = true
    }, () => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(169_000)
    await vi.advanceTimersByTimeAsync(STREAM_PROVIDER_IDLE_TIMEOUT_MS - 1000)
    expect(settled).toBe(false)

    const rejectionPromise = expect(textPromise).rejects.toThrow('Provider request stream timed out after 180000ms of inactivity')
    await vi.advanceTimersByTimeAsync(1001)
    await rejectionPromise
  })

  it('still honors an explicit caller abort during streaming', async () => {
    vi.useFakeTimers()

    const inputController = new AbortController()
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener('abort', () => controller.error(createAbortError()), { once: true })
        },
      })

      return Promise.resolve(new Response(body, { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const { response } = await requestProviderEndpoint({
      provider: 'openai-compatible',
      action: 'Provider request',
      url: 'https://example.test/v1/chat/completions',
      model: 'stream-model',
      requestBody: { stream: true },
      requestInit: { method: 'POST' },
      timeoutMs: STREAM_PROVIDER_IDLE_TIMEOUT_MS,
      streamed: true,
      inputSignal: inputController.signal,
    })

    const textPromise = new Response(response.body).text()
    const rejectionPromise = expect(textPromise).rejects.toThrow('Provider request aborted')
    inputController.abort()
    await vi.runAllTimersAsync()

    await rejectionPromise
  })

  it('does not abort OpenAI-compatible embeddings before the 5-minute minimum', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(createAbortError()), { once: true })

        setTimeout(() => {
          resolve(new Response(JSON.stringify({
            data: [{ embedding: [0.1, 0.2, 0.3] }],
            model: 'embedding-model',
          }), { status: 200 }))
        }, 30_000)
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { embedTextsWithOpenAICompatible } = await import('@/lib/server/openai-compatible')
    const resultPromise = embedTextsWithOpenAICompatible('hello', {
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'embedding-model',
    })

    let settled = false
    void resultPromise.then(() => {
      settled = true
    }, () => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(20_000)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(10_000)
    await expect(resultPromise).resolves.toMatchObject({
      enabled: true,
      model: 'embedding-model',
      embeddings: [[0.1, 0.2, 0.3]],
    })
  })

  it('does not abort candidate promotion provider requests before the 5-minute minimum', async () => {
    vi.useFakeTimers()

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => ({
        rewrite: {
          provider: 'openai-compatible',
          openAICompatible: { baseUrl: 'https://example.test/v1', apiKey: 'test-key', model: 'rewrite-model', configured: true },
          ollama: { baseUrl: 'http://127.0.0.1:11434', model: '', configured: false },
        },
        knowledgeExtraction: {
          provider: 'openai-compatible',
          openAICompatible: { baseUrl: 'https://example.test/v1', apiKey: 'test-key', model: 'knowledge-model', configured: true, parallelism: 1 },
          ollama: { baseUrl: 'http://127.0.0.1:11434', model: '', configured: false, parallelism: 1 },
        },
        embeddings: {
          provider: 'openai-compatible',
          openAICompatible: { baseUrl: 'https://example.test/v1', apiKey: 'test-key', model: 'embedding-model', configured: true },
          ollama: { baseUrl: 'http://127.0.0.1:11434', model: '', configured: false },
          embeddingBatchSize: 16,
        },
      }),
    }))

    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(createAbortError()), { once: true })

        setTimeout(() => {
          resolve(new Response(JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ summary: '候选角色总结', description_delta: '候选角色总结', status: '活跃', profile: {} }) } }],
          }), { status: 200 }))
        }, 121_000)
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { generateCandidatePromotionSummary } = await import('@/lib/server/candidate-promotion-summary')
    const resultPromise = generateCandidatePromotionSummary({
      candidateName: '候选角色',
      firstSeenChapter: 1,
      lastSeenChapter: 3,
      chapterCount: 3,
      mentionCount: 5,
      observations: [{ chapterNo: 3, mentionCount: 2, observation: '他持续出现', evidenceQuote: '证据片段' }],
    })

    let settled = false
    void resultPromise.then(() => {
      settled = true
    }, () => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(120_000)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1_000)
    await expect(resultPromise).resolves.toMatchObject({
      summary: '候选角色总结',
      descriptionDelta: '候选角色总结',
      status: '活跃',
    })
  })
})
