import { NextResponse } from 'next/server'
import { listAvailableOllamaEmbeddingModels, listAvailableOllamaTextModels } from '@/lib/server/ollama-local'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const baseUrl = searchParams.get('baseUrl')?.trim() || undefined
    const purpose = searchParams.get('purpose') === 'embedding' ? 'embedding' : 'text'
    const result = purpose === 'embedding'
      ? await listAvailableOllamaEmbeddingModels(baseUrl)
      : await listAvailableOllamaTextModels(baseUrl)
    return NextResponse.json({ ok: true, purpose, ...result })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to list local Ollama models',
      },
      { status: 500 }
    )
  }
}
