import type {
  AIProvider,
  AISettings,
  AIScenarioKey,
  AIScenarioSettings,
  OllamaProviderSettings,
  OpenAICompatibleProviderSettings,
} from '@/lib/types'

type LegacyFlatAISettings = Partial<{
  rewriteProvider: unknown
  knowledgeProvider: unknown
  baseUrl: unknown
  apiKey: unknown
  apiKeyConfigured: unknown
  apiKeyMasked: unknown
  model: unknown
  configured: unknown
  ollamaBaseUrl: unknown
  ollamaRewriteModel: unknown
  ollamaModel: unknown
  ollamaEmbeddingModel: unknown
}>

type PartialAISettings = Partial<{
  rewrite: unknown
  knowledgeExtraction: unknown
  embeddings: unknown
}>

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini'
const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

function normalizeProvider(value: unknown, fallback: AIProvider): AIProvider {
  return value === 'openai-compatible' || value === 'ollama' ? value : fallback
}

export function maskApiKey(apiKey: string) {
  if (!apiKey) {
    return ''
  }

  if (apiKey.length <= 8) {
    return `${apiKey.slice(0, 2)}***`
  }

  return `${apiKey.slice(0, 4)}***${apiKey.slice(-4)}`
}

function createDefaultOpenAICompatibleProviderSettings(): OpenAICompatibleProviderSettings {
  return {
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    apiKey: '',
    apiKeyConfigured: false,
    apiKeyMasked: '',
    model: DEFAULT_OPENAI_MODEL,
    configured: false,
  }
}

function createDefaultOllamaProviderSettings(): OllamaProviderSettings {
  return {
    baseUrl: DEFAULT_OLLAMA_BASE_URL,
    model: '',
    configured: false,
  }
}

export function createDefaultAISettings(): AISettings {
  return {
    rewrite: {
      provider: 'openai-compatible',
      openAICompatible: createDefaultOpenAICompatibleProviderSettings(),
      ollama: createDefaultOllamaProviderSettings(),
    },
    knowledgeExtraction: {
      provider: 'ollama',
      openAICompatible: createDefaultOpenAICompatibleProviderSettings(),
      ollama: createDefaultOllamaProviderSettings(),
    },
    embeddings: {
      provider: 'ollama',
      openAICompatible: createDefaultOpenAICompatibleProviderSettings(),
      ollama: createDefaultOllamaProviderSettings(),
    },
  }
}

function normalizeOpenAICompatibleProviderSettings(
  value: unknown,
  fallback: OpenAICompatibleProviderSettings
): OpenAICompatibleProviderSettings {
  const record = isRecord(value) ? value : {}
  const baseUrl = normalizeText(record.baseUrl) || fallback.baseUrl
  const apiKey = normalizeText(record.apiKey)
  const apiKeyConfigured = normalizeBoolean(record.apiKeyConfigured) ?? Boolean(apiKey || fallback.apiKey || fallback.apiKeyConfigured)
  const apiKeyMasked = normalizeText(record.apiKeyMasked) || (apiKey ? maskApiKey(apiKey) : fallback.apiKeyMasked ?? '')
  const model = normalizeText(record.model) || fallback.model
  const configured = normalizeBoolean(record.configured) ?? Boolean(baseUrl && model && (apiKey || apiKeyConfigured))

  return {
    baseUrl,
    apiKey,
    apiKeyConfigured,
    apiKeyMasked,
    model,
    configured,
  }
}

function normalizeOllamaProviderSettings(
  value: unknown,
  fallback: OllamaProviderSettings
): OllamaProviderSettings {
  const record = isRecord(value) ? value : {}
  const baseUrl = normalizeText(record.baseUrl) || fallback.baseUrl
  const model = normalizeText(record.model)
  const configured = normalizeBoolean(record.configured) ?? Boolean(baseUrl && model)

  return {
    baseUrl,
    model,
    configured,
  }
}

function buildLegacyScenarioDefaults(legacy: LegacyFlatAISettings, defaults: AISettings): AISettings {
  return {
    rewrite: {
      provider: normalizeProvider(legacy.rewriteProvider, defaults.rewrite.provider),
      openAICompatible: normalizeOpenAICompatibleProviderSettings(
        {
          baseUrl: legacy.baseUrl,
          apiKey: legacy.apiKey,
          apiKeyConfigured: legacy.apiKeyConfigured,
          apiKeyMasked: legacy.apiKeyMasked,
          model: legacy.model,
          configured: legacy.configured,
        },
        defaults.rewrite.openAICompatible
      ),
      ollama: normalizeOllamaProviderSettings(
        {
          baseUrl: legacy.ollamaBaseUrl,
          model: legacy.ollamaRewriteModel,
        },
        defaults.rewrite.ollama
      ),
    },
    knowledgeExtraction: {
      provider: normalizeProvider(legacy.knowledgeProvider, defaults.knowledgeExtraction.provider),
      openAICompatible: normalizeOpenAICompatibleProviderSettings(
        {
          baseUrl: legacy.baseUrl,
          apiKey: legacy.apiKey,
          apiKeyConfigured: legacy.apiKeyConfigured,
          apiKeyMasked: legacy.apiKeyMasked,
          model: legacy.model,
          configured: legacy.configured,
        },
        defaults.knowledgeExtraction.openAICompatible
      ),
      ollama: normalizeOllamaProviderSettings(
        {
          baseUrl: legacy.ollamaBaseUrl,
          model: legacy.ollamaModel,
        },
        defaults.knowledgeExtraction.ollama
      ),
    },
    embeddings: {
      provider: defaults.embeddings.provider,
      openAICompatible: normalizeOpenAICompatibleProviderSettings(
        {
          baseUrl: legacy.baseUrl,
          apiKey: legacy.apiKey,
          apiKeyConfigured: legacy.apiKeyConfigured,
          apiKeyMasked: legacy.apiKeyMasked,
          model: legacy.model,
          configured: legacy.configured,
        },
        defaults.embeddings.openAICompatible
      ),
      ollama: normalizeOllamaProviderSettings(
        {
          baseUrl: legacy.ollamaBaseUrl,
          model: legacy.ollamaEmbeddingModel,
        },
        defaults.embeddings.ollama
      ),
    },
  }
}

function normalizeScenarioSettings(
  value: unknown,
  fallback: AIScenarioSettings,
  legacyFallback: AIScenarioSettings
): AIScenarioSettings {
  const record = isRecord(value) ? value : {}

  return {
    provider: normalizeProvider(record.provider, legacyFallback.provider),
    openAICompatible: normalizeOpenAICompatibleProviderSettings(
      record.openAICompatible,
      legacyFallback.openAICompatible ?? fallback.openAICompatible
    ),
    ollama: normalizeOllamaProviderSettings(record.ollama, legacyFallback.ollama ?? fallback.ollama),
  }
}

export function normalizeAISettings(value?: unknown): AISettings {
  const defaults = createDefaultAISettings()
  if (!isRecord(value)) {
    return defaults
  }

  const partial = value as PartialAISettings
  const legacy = value as LegacyFlatAISettings
  const legacyFallback = buildLegacyScenarioDefaults(legacy, defaults)

  return {
    rewrite: normalizeScenarioSettings(partial.rewrite, defaults.rewrite, legacyFallback.rewrite),
    knowledgeExtraction: normalizeScenarioSettings(
      partial.knowledgeExtraction,
      defaults.knowledgeExtraction,
      legacyFallback.knowledgeExtraction
    ),
    embeddings: normalizeScenarioSettings(partial.embeddings, defaults.embeddings, legacyFallback.embeddings),
  }
}

export function sanitizeAISettingsForClient(settings: AISettings): AISettings {
  const normalized = normalizeAISettings(settings)

  const sanitizeScenario = (scenario: AIScenarioKey) => {
    const current = normalized[scenario]
    return {
      ...current,
      openAICompatible: {
        ...current.openAICompatible,
        apiKey: '',
        apiKeyConfigured: Boolean(current.openAICompatible.apiKeyConfigured || current.openAICompatible.apiKey),
        apiKeyMasked: current.openAICompatible.apiKey
          ? maskApiKey(current.openAICompatible.apiKey)
          : current.openAICompatible.apiKeyMasked ?? '',
        configured: Boolean(
          current.openAICompatible.baseUrl &&
          current.openAICompatible.model &&
          (current.openAICompatible.apiKey || current.openAICompatible.apiKeyConfigured)
        ),
      },
    }
  }

  return {
    rewrite: sanitizeScenario('rewrite'),
    knowledgeExtraction: sanitizeScenario('knowledgeExtraction'),
    embeddings: sanitizeScenario('embeddings'),
  }
}
