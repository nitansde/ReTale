import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultAISettings } from '@/lib/ai-settings'
import { loadStoredAISettings } from '@/lib/server/ai-settings'
import { findAppSettings } from '@/lib/server/persistence'

vi.mock('@/lib/server/persistence', () => ({
  findAppSettings: vi.fn(() => []),
  upsertAppSettings: vi.fn(),
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.mocked(findAppSettings).mockReset()
  vi.mocked(findAppSettings).mockReturnValue([])
})

describe('embedding API settings', () => {
  it('uses an embedding default independently of the writing model', () => {
    vi.stubEnv('OPENAI_COMPATIBLE_MODEL', 'writing-only-model')
    vi.stubEnv('OPENAI_COMPATIBLE_EMBEDDING_MODEL', '')
    expect(createDefaultAISettings().embeddings.openAICompatible.model).toBe('text-embedding-3-small')
    const settings = loadStoredAISettings()
    expect(settings.rewrite.openAICompatible.model).toBe('writing-only-model')
    expect(settings.embeddings.openAICompatible.model).toBe('text-embedding-3-small')
  })

  it('honors the embedding environment override and preserves saved configurations', () => {
    vi.stubEnv('OPENAI_COMPATIBLE_EMBEDDING_MODEL', 'custom-api-embedding')
    expect(loadStoredAISettings().embeddings.openAICompatible.model).toBe('custom-api-embedding')
    const saved = createDefaultAISettings()
    saved.embeddings.openAICompatible.model = 'saved-embedding-model'
    vi.mocked(findAppSettings).mockReturnValue([{
      id: 'test-ai-settings', key: 'AI_SETTINGS_V2', value: JSON.stringify(saved),
      createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-19T00:00:00.000Z',
    }])
    expect(loadStoredAISettings().embeddings.openAICompatible.model).toBe('saved-embedding-model')
  })
})
