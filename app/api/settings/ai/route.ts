import { NextResponse } from 'next/server'
import { normalizeAISettings, sanitizeAISettingsForClient } from '@/lib/ai-settings'
import type { AISettings, AIScenarioKey, AIScenarioSettings } from '@/lib/types'
import { loadStoredAISettings, saveStoredAISettings } from '@/lib/server/ai-settings'
import { normalizeOpenAICompatibleBaseUrl } from '@/lib/server/openai-compatible'

function normalizeOptionalText(value: unknown, field: string, maxLength: number) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized.length > maxLength) {
    throw new Error(`${field} is too long`)
  }
  return normalized
}

function normalizeScenarioPayload(
  scenario: AIScenarioKey,
  value: unknown,
  current: AISettings,
): AIScenarioSettings {
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

  return normalizeAISettings({
    [scenario]: {
      provider,
      openAICompatible: {
        baseUrl: openAIBaseUrl,
        apiKey: openAIApiKey,
        model: openAIModel,
      },
      ollama: {
        baseUrl: ollamaBaseUrl,
        model: ollamaModel,
      },
    },
  })[scenario]
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
