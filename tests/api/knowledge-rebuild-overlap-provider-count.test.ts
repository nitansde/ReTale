import { afterEach, describe, expect, it, vi } from 'vitest'

function createKnowledgeExtractionSettings() {
  return {
    provider: 'openai-compatible' as const,
    openAICompatible: {
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      apiKeyConfigured: true,
      apiKeyMasked: 'test***key',
      model: 'knowledge-model',
      configured: true,
      parallelism: 1,
    },
    ollama: {
      baseUrl: 'http://127.0.0.1:11434',
      model: 'unused-ollama-model',
      configured: true,
      parallelism: 1,
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  vi.unmock('@/lib/server/ai-settings')
})

describe('knowledge rebuild overlap provider count proof', () => {
  it('makes exactly one provider request in the real extractChapterKnowledgeOffline path', async () => {
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => ({
        rewrite: {
          provider: 'openai-compatible',
          openAICompatible: {
            baseUrl: 'https://example.test/v1',
            apiKey: 'test-key',
            apiKeyConfigured: true,
            apiKeyMasked: 'test***key',
            model: 'rewrite-model',
            configured: true,
          },
          ollama: {
            baseUrl: 'http://127.0.0.1:11434',
            model: 'rewrite-model',
            configured: true,
          },
        },
        knowledgeExtraction: createKnowledgeExtractionSettings(),
        embeddings: {
          provider: 'ollama',
          openAICompatible: {
            baseUrl: 'https://example.test/v1',
            apiKey: 'test-key',
            apiKeyConfigured: true,
            apiKeyMasked: 'test***key',
            model: 'embedding-model',
            configured: true,
          },
          ollama: {
            baseUrl: 'http://127.0.0.1:11434',
            model: 'embedding-model',
            configured: true,
          },
          embeddingBatchSize: 1,
        },
      }),
    }))

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        chapter_no: 1,
        summary: 'summary-1',
        characters: [],
        known_character_updates: [],
        unknown_character_observations: [],
        alias_discoveries: [],
        relations: [],
        events: [],
        worldbuilding: [],
        open_threads: [{
          name: '未解线索',
          description: '还有后续',
          evidence: [{ quote: '第一段原文内容。', line_start: 1, line_end: 1 }],
        }],
      }) } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { extractChapterKnowledgeOffline } = await import('@/lib/server/knowledge-extraction')
    const result = await extractChapterKnowledgeOffline({
      chapter: {
        id: 'chapter-proof',
        novelId: 'novel-proof',
        title: '第1章',
        content: '<p>第一段原文内容。</p>',
        order: 1,
      },
      chapterNo: 1,
      settings: createKnowledgeExtractionSettings(),
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
      messages?: Array<{ role: string; content: string }>
      response_format?: { type: string }
    }
    expect(requestBody.response_format).toEqual({ type: 'json_object' })
    expect(requestBody.messages?.[1]?.content).toContain('known_character_updates')
    expect(requestBody.messages?.[1]?.content).toContain('unknown_character_observations')
    expect(requestBody.messages?.[1]?.content).toContain('alias_discoveries')
    expect(result).toMatchObject({
      provider: 'openai-compatible',
      model: 'knowledge-model',
      extraction: {
        chapterNo: 1,
        summary: 'summary-1',
        characters: [],
        knownCharacterUpdates: [],
        unknownCharacterObservations: [],
        aliasDiscoveries: [],
        relations: [],
        events: [{
          name: 'summary-1',
          summary: 'summary-1',
          eventType: 'story',
          participants: [],
          consequences: '',
          importance: 2,
          evidence: [{ quote: '第一段原文内容。', lineStart: 1, lineEnd: 1 }],
        }],
        worldbuilding: [],
        openThreads: [{
          name: '未解线索',
          description: '还有后续',
          evidence: [{ quote: '第一段原文内容。', lineStart: 1, lineEnd: 1 }],
        }],
      },
    })
  })
})
