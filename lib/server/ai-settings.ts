import { normalizeAISettings } from '@/lib/ai-settings'
import type { AISettings } from '@/lib/types'
import { findAppSettings, upsertAppSettings } from '@/lib/server/persistence'

const AI_SETTINGS_V2_KEY = 'AI_SETTINGS_V2'

const LEGACY_SETTING_KEYS = [
  AI_SETTINGS_V2_KEY,
  'OPENAI_COMPATIBLE_BASE_URL',
  'OPENAI_COMPATIBLE_API_KEY',
  'OPENAI_COMPATIBLE_MODEL',
  'AI_REWRITE_PROVIDER',
  'AI_KNOWLEDGE_PROVIDER',
  'OLLAMA_BASE_URL',
  'OLLAMA_REWRITE_MODEL',
  'OLLAMA_MODEL',
  'OLLAMA_EMBEDDING_MODEL',
] as const

function parseStoredSettingsBlob(value: string | null | undefined) {
  const raw = value?.trim()
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function buildLegacyStoredSettings(map: Partial<Record<(typeof LEGACY_SETTING_KEYS)[number], string>>) {
  return {
    rewriteProvider: map.AI_REWRITE_PROVIDER ?? 'openai-compatible',
    knowledgeProvider: map.AI_KNOWLEDGE_PROVIDER ?? 'ollama',
    baseUrl: map.OPENAI_COMPATIBLE_BASE_URL ?? process.env.OPENAI_COMPATIBLE_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey: map.OPENAI_COMPATIBLE_API_KEY ?? process.env.OPENAI_COMPATIBLE_API_KEY ?? '',
    apiKeyConfigured: Boolean((map.OPENAI_COMPATIBLE_API_KEY ?? process.env.OPENAI_COMPATIBLE_API_KEY ?? '').trim()),
    apiKeyMasked: '',
    model: map.OPENAI_COMPATIBLE_MODEL ?? process.env.OPENAI_COMPATIBLE_MODEL ?? 'gpt-4.1-mini',
    configured: Boolean(
      (map.OPENAI_COMPATIBLE_BASE_URL ?? process.env.OPENAI_COMPATIBLE_BASE_URL ?? '').trim() &&
      (map.OPENAI_COMPATIBLE_MODEL ?? process.env.OPENAI_COMPATIBLE_MODEL ?? '').trim() &&
      (map.OPENAI_COMPATIBLE_API_KEY ?? process.env.OPENAI_COMPATIBLE_API_KEY ?? '').trim()
    ),
    ollamaBaseUrl: map.OLLAMA_BASE_URL ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
    ollamaRewriteModel: map.OLLAMA_REWRITE_MODEL ?? process.env.OLLAMA_REWRITE_MODEL ?? '',
    ollamaModel: map.OLLAMA_MODEL ?? process.env.OLLAMA_MODEL ?? '',
    ollamaEmbeddingModel: map.OLLAMA_EMBEDDING_MODEL ?? process.env.OLLAMA_EMBEDDING_MODEL ?? '',
  }
}

export function loadStoredAISettings(): AISettings {
  const entries = findAppSettings([...LEGACY_SETTING_KEYS])
  const map = Object.fromEntries(entries.map((item) => [item.key, item.value])) as Partial<Record<(typeof LEGACY_SETTING_KEYS)[number], string>>
  const parsed = parseStoredSettingsBlob(map.AI_SETTINGS_V2)
  if (parsed) {
    return normalizeAISettings(parsed)
  }

  return normalizeAISettings(buildLegacyStoredSettings(map))
}

export async function saveStoredAISettings(settings: AISettings) {
  await upsertAppSettings([[AI_SETTINGS_V2_KEY, JSON.stringify(normalizeAISettings(settings))]])
}
