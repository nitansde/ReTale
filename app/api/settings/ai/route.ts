import { NextResponse } from 'next/server'
import { findAppSettings, upsertAppSettings } from '@/lib/server/persistence'

const FALLBACK = {
  rewriteProvider: (process.env.AI_REWRITE_PROVIDER === 'ollama' ? 'ollama' : 'openai-compatible') as 'openai-compatible' | 'ollama',
  baseUrl: process.env.OPENAI_COMPATIBLE_BASE_URL ?? 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_COMPATIBLE_API_KEY ?? '',
  model: process.env.OPENAI_COMPATIBLE_MODEL ?? 'gpt-4.1-mini',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
  ollamaRewriteModel: process.env.OLLAMA_REWRITE_MODEL ?? '',
  ollamaModel: process.env.OLLAMA_MODEL ?? '',
  ollamaEmbeddingModel: process.env.OLLAMA_EMBEDDING_MODEL ?? '',
}

export async function GET() {
  const entries = findAppSettings([
      'OPENAI_COMPATIBLE_BASE_URL',
      'OPENAI_COMPATIBLE_API_KEY',
      'OPENAI_COMPATIBLE_MODEL',
      'AI_REWRITE_PROVIDER',
      'OLLAMA_BASE_URL',
      'OLLAMA_REWRITE_MODEL',
      'OLLAMA_MODEL',
      'OLLAMA_EMBEDDING_MODEL',
    ])

  const map = Object.fromEntries(entries.map((item) => [item.key, item.value]))
  const rewriteProvider = map.AI_REWRITE_PROVIDER === 'ollama' ? 'ollama' : FALLBACK.rewriteProvider
  const ollamaBaseUrl = map.OLLAMA_BASE_URL?.trim() || FALLBACK.ollamaBaseUrl

  return NextResponse.json({
    rewriteProvider,
    baseUrl: map.OPENAI_COMPATIBLE_BASE_URL ?? FALLBACK.baseUrl,
    apiKey: map.OPENAI_COMPATIBLE_API_KEY ?? FALLBACK.apiKey,
    model: map.OPENAI_COMPATIBLE_MODEL ?? FALLBACK.model,
    configured: Boolean((map.OPENAI_COMPATIBLE_API_KEY ?? FALLBACK.apiKey) && (map.OPENAI_COMPATIBLE_MODEL ?? FALLBACK.model)),
    ollamaBaseUrl,
    ollamaRewriteModel: map.OLLAMA_REWRITE_MODEL ?? FALLBACK.ollamaRewriteModel,
    ollamaModel: map.OLLAMA_MODEL ?? FALLBACK.ollamaModel,
    ollamaEmbeddingModel: map.OLLAMA_EMBEDDING_MODEL ?? FALLBACK.ollamaEmbeddingModel,
  })
}

export async function POST(request: Request) {
  const body = await request.json()
  const rewriteProvider = body.rewriteProvider === 'ollama' ? 'ollama' : 'openai-compatible'
  const ollamaBaseUrl = String(body.ollamaBaseUrl ?? '').trim() || FALLBACK.ollamaBaseUrl
  const items = [
    ['OPENAI_COMPATIBLE_BASE_URL', body.baseUrl ?? ''],
    ['OPENAI_COMPATIBLE_API_KEY', body.apiKey ?? ''],
    ['OPENAI_COMPATIBLE_MODEL', body.model ?? ''],
    ['AI_REWRITE_PROVIDER', rewriteProvider],
    ['OLLAMA_BASE_URL', ollamaBaseUrl],
    ['OLLAMA_REWRITE_MODEL', body.ollamaRewriteModel ?? ''],
    ['OLLAMA_MODEL', body.ollamaModel ?? ''],
    ['OLLAMA_EMBEDDING_MODEL', body.ollamaEmbeddingModel ?? ''],
  ] as const

  await upsertAppSettings(items)

  return NextResponse.json({ ok: true })
}
