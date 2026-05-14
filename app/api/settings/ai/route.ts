import { NextResponse } from 'next/server'
import { normalizeOpenAICompatibleBaseUrl } from '@/lib/server/openai-compatible'
import { findAppSettings, upsertAppSettings } from '@/lib/server/persistence'

const FALLBACK = {
  rewriteProvider: 'openai-compatible' as const,
  knowledgeProvider: 'ollama' as const,
  baseUrl: process.env.OPENAI_COMPATIBLE_BASE_URL ?? 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_COMPATIBLE_API_KEY ?? '',
  model: process.env.OPENAI_COMPATIBLE_MODEL ?? 'gpt-4.1-mini',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
  ollamaRewriteModel: process.env.OLLAMA_REWRITE_MODEL ?? '',
  ollamaModel: process.env.OLLAMA_MODEL ?? '',
  ollamaEmbeddingModel: process.env.OLLAMA_EMBEDDING_MODEL ?? '',
}

function maskApiKey(apiKey: string) {
  if (!apiKey) {
    return ''
  }

  if (apiKey.length <= 8) {
    return `${apiKey.slice(0, 2)}***`
  }

  return `${apiKey.slice(0, 4)}***${apiKey.slice(-4)}`
}

function normalizeOptionalText(value: unknown, field: string, maxLength: number) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized.length > maxLength) {
    throw new Error(`${field} is too long`)
  }
  return normalized
}

export async function GET() {
  const entries = findAppSettings([
      'OPENAI_COMPATIBLE_BASE_URL',
      'OPENAI_COMPATIBLE_API_KEY',
      'OPENAI_COMPATIBLE_MODEL',
      'AI_REWRITE_PROVIDER',
      'AI_KNOWLEDGE_PROVIDER',
      'OLLAMA_BASE_URL',
      'OLLAMA_REWRITE_MODEL',
      'OLLAMA_MODEL',
      'OLLAMA_EMBEDDING_MODEL',
    ])

  const map = Object.fromEntries(entries.map((item) => [item.key, item.value]))
  const rewriteProvider = FALLBACK.rewriteProvider
  const knowledgeProvider = FALLBACK.knowledgeProvider
  const ollamaBaseUrl = map.OLLAMA_BASE_URL?.trim() || FALLBACK.ollamaBaseUrl
  const storedApiKey = (map.OPENAI_COMPATIBLE_API_KEY ?? FALLBACK.apiKey).trim()
  const storedModel = (map.OPENAI_COMPATIBLE_MODEL ?? FALLBACK.model).trim()

  return NextResponse.json({
    rewriteProvider,
    knowledgeProvider,
    baseUrl: map.OPENAI_COMPATIBLE_BASE_URL ?? FALLBACK.baseUrl,
    apiKey: '',
    apiKeyConfigured: Boolean(storedApiKey),
    apiKeyMasked: maskApiKey(storedApiKey),
    model: storedModel,
    configured: Boolean(storedApiKey && storedModel),
    ollamaBaseUrl,
    ollamaRewriteModel: map.OLLAMA_REWRITE_MODEL ?? FALLBACK.ollamaRewriteModel,
    ollamaModel: map.OLLAMA_MODEL ?? FALLBACK.ollamaModel,
    ollamaEmbeddingModel: map.OLLAMA_EMBEDDING_MODEL ?? FALLBACK.ollamaEmbeddingModel,
  })
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>
    const rewriteProvider = FALLBACK.rewriteProvider
    const knowledgeProvider = FALLBACK.knowledgeProvider
    const currentApiKey = findAppSettings(['OPENAI_COMPATIBLE_API_KEY'])[0]?.value?.trim() ?? ''
    const rawBaseUrl = normalizeOptionalText(body.baseUrl, 'Base URL', 2000)
    const normalizedBaseUrl = rawBaseUrl ? normalizeOpenAICompatibleBaseUrl(rawBaseUrl) : ''
    const apiKey = normalizeOptionalText(body.apiKey, 'API key', 2000) || currentApiKey
    const model = normalizeOptionalText(body.model, 'Model', 300)
    const ollamaBaseUrl = normalizeOptionalText(body.ollamaBaseUrl, 'Ollama Base URL', 2000) || FALLBACK.ollamaBaseUrl
    const ollamaRewriteModel = normalizeOptionalText(body.ollamaRewriteModel, 'Ollama rewrite model', 300)
    const ollamaModel = normalizeOptionalText(body.ollamaModel, 'Ollama model', 300)
    const ollamaEmbeddingModel = normalizeOptionalText(body.ollamaEmbeddingModel, 'Ollama embedding model', 300)

    const items = [
      ['OPENAI_COMPATIBLE_BASE_URL', normalizedBaseUrl],
      ['OPENAI_COMPATIBLE_API_KEY', apiKey],
      ['OPENAI_COMPATIBLE_MODEL', model],
      ['AI_REWRITE_PROVIDER', rewriteProvider],
      ['AI_KNOWLEDGE_PROVIDER', knowledgeProvider],
      ['OLLAMA_BASE_URL', ollamaBaseUrl],
      ['OLLAMA_REWRITE_MODEL', ollamaRewriteModel],
      ['OLLAMA_MODEL', ollamaModel],
      ['OLLAMA_EMBEDDING_MODEL', ollamaEmbeddingModel],
    ] as const

    await upsertAppSettings(items)

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
