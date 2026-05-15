import { NextResponse } from 'next/server'
import { normalizeAISettings, sanitizeAISettingsForClient } from '@/lib/ai-settings'
import type { AISettings, AIScenarioKey } from '@/lib/types'
import { loadStoredAISettings, saveStoredAISettings } from '@/lib/server/ai-settings'
import { normalizeOpenAICompatibleBaseUrl } from '@/lib/server/openai-compatible'

const MAX_KNOWLEDGE_EXTRACTION_PARALLELISM = 20
const MAX_EMBEDDING_BATCH_SIZE = 128

function normalizeOptionalText(value: unknown, field: string, maxLength: number) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized.length > maxLength) {
    throw new Error(`${field} is too long`)
  }
  return normalized
}

function normalizeOptionalParallelism(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value.trim(), 10)
      : Number.NaN

  if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_KNOWLEDGE_EXTRACTION_PARALLELISM) {
    throw new Error(`${field} must be an integer between 1 and ${MAX_KNOWLEDGE_EXTRACTION_PARALLELISM}`)
  }

  return Math.floor(parsed)
}

function normalizeOptionalEmbeddingBatchSize(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value.trim(), 10)
      : Number.NaN

  if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_EMBEDDING_BATCH_SIZE) {
    throw new Error(`${field} must be an integer between 1 and ${MAX_EMBEDDING_BATCH_SIZE}`)
  }

  return Math.floor(parsed)
}

function normalizeScenarioPayload<K extends AIScenarioKey>(
  scenario: K,
  value: unknown,
  current: AISettings,
): AISettings[K] {
  const fallback = current[scenario]
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const openAIRecord = record.openAICompatible && typeof record.openAICompatible === 'object' && !Array.isArray(record.openAICompatible)
    ? record.openAICompatible as Record<string, unknown>
    : {}
  const ollamaRecord = record.ollama && typeof record.ollama === 'object' && !Array.isArray(record.ollama)
    ? record.ollama as Record<string, unknown>
    : {}

  const rawOpenAIBaseUrl = normalizeOptionalText(openAIRecord.baseUrl, `${scenario} OpenAI Base URL`, 2000)
  const openAIBaseUrl = rawOpenAIBaseUrl ? normalizeOpenAICompatibleBaseUrl(rawOpenAIBaseUrl) : ''
  const submittedApiKey = normalizeOptionalText(openAIRecord.apiKey, `${scenario} OpenAI API key`, 2000)
  const openAIApiKey = submittedApiKey || fallback.openAICompatible.apiKey
  const openAIModel = normalizeOptionalText(openAIRecord.model, `${scenario} OpenAI model`, 300)
  const ollamaBaseUrl = normalizeOptionalText(ollamaRecord.baseUrl, `${scenario} Ollama Base URL`, 2000) || fallback.ollama.baseUrl
  const ollamaModel = normalizeOptionalText(ollamaRecord.model, `${scenario} Ollama model`, 300)
  const provider = record.provider === 'openai-compatible' || record.provider === 'ollama'
    ? record.provider
    : fallback.provider
  const knowledgeExtractionParallelism = scenario === 'knowledgeExtraction'
    ? {
        openAICompatible: normalizeOptionalParallelism(
          openAIRecord.parallelism,
          'knowledgeExtraction OpenAI parallelism'
        ) ?? current.knowledgeExtraction.openAICompatible.parallelism,
        ollama: normalizeOptionalParallelism(
          ollamaRecord.parallelism,
          'knowledgeExtraction Ollama parallelism'
        ) ?? current.knowledgeExtraction.ollama.parallelism,
      }
    : null
  const embeddingBatchSize = scenario === 'embeddings'
    ? normalizeOptionalEmbeddingBatchSize(
        record.embeddingBatchSize,
        'embeddings embedding batch size'
      ) ?? current.embeddings.embeddingBatchSize
    : null

  return normalizeAISettings({
    [scenario]: {
      provider,
      openAICompatible: {
        baseUrl: openAIBaseUrl,
        apiKey: openAIApiKey,
        model: openAIModel,
        ...(knowledgeExtractionParallelism ? { parallelism: knowledgeExtractionParallelism.openAICompatible } : {}),
      },
      ollama: {
        baseUrl: ollamaBaseUrl,
        model: ollamaModel,
        ...(knowledgeExtractionParallelism ? { parallelism: knowledgeExtractionParallelism.ollama } : {}),
      },
      ...(embeddingBatchSize ? { embeddingBatchSize } : {}),
    },
  })[scenario] as AISettings[K]
}

export async function GET() {
  return NextResponse.json(sanitizeAISettingsForClient(loadStoredAISettings()))
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>
    const current = loadStoredAISettings()
    const next = normalizeAISettings({
      rewrite: normalizeScenarioPayload('rewrite', body.rewrite, current),
      knowledgeExtraction: normalizeScenarioPayload('knowledgeExtraction', body.knowledgeExtraction, current),
      embeddings: normalizeScenarioPayload('embeddings', body.embeddings, current),
    })

    await saveStoredAISettings(next)

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to save AI settings',
      },
      { status: 400 }
    )
  }
}
