import { afterEach, describe, expect, it, vi } from 'vitest'
import { embedTextsWithOpenAICompatible } from '@/lib/server/openai-compatible'
import { embedTextsWithOllama } from '@/lib/server/ollama-local'

vi.mock('@/lib/server/ai-settings', () => ({ loadStoredAISettings: () => ({
  embeddings: {
    provider: 'ollama',
    ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'search-test' },
    openAICompatible: { baseUrl: 'https://example.test/v1', model: 'search-test', apiKey: 'test' },
  },
}) }))
afterEach(() => vi.unstubAllGlobals())

for (const provider of ['ollama', 'openai'] as const) {
  describe(`${provider} search cancellation`, () => {
    it('cancels an in-flight embedding request instead of waiting for the provider timeout', async () => {
      const controller = new AbortController()
      let sent!: () => void
      const started = new Promise<void>((resolve) => { sent = resolve })
      vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ model: 'search-test' }] }))
        if (url.endsWith('/api/show')) return new Response(JSON.stringify({ capabilities: ['embedding'] }))
        sent()
        return new Promise<Response>((_resolve, reject) => {
          const fail = () => reject(new DOMException('Aborted', 'AbortError'))
          if (init.signal?.aborted) fail()
          else init.signal?.addEventListener('abort', fail, { once: true })
        })
      }))
      const pending = provider === 'ollama'
        ? embedTextsWithOllama('森林', undefined, { signal: controller.signal })
        : embedTextsWithOpenAICompatible('森林', undefined, { inputType: 'query', signal: controller.signal })
      await started
      controller.abort()
      expect((await pending).error).toBeTruthy()
    })
  })
}
