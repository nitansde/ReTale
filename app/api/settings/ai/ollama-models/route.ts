import { noStoreJson, noStoreJsonError } from '@/lib/server/api-route'
import { listAvailableOllamaEmbeddingModels, listAvailableOllamaTextModels } from '@/lib/server/ollama-local'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const baseUrl = searchParams.get('baseUrl')?.trim() || undefined
    const rawPurpose = searchParams.get('purpose')?.trim() ?? ''
    if (rawPurpose && rawPurpose !== 'text' && rawPurpose !== 'embedding') {
      return noStoreJsonError('purpose is invalid', 400)
    }
    const purpose = rawPurpose === 'embedding' ? 'embedding' : 'text'
    const result = purpose === 'embedding'
      ? await listAvailableOllamaEmbeddingModels(baseUrl, request.signal)
      : await listAvailableOllamaTextModels(baseUrl, request.signal)
    return noStoreJson({ ok: true, purpose, ...result })
  } catch (error) {
    return noStoreJsonError(error instanceof Error ? error.message : 'Failed to list local Ollama models', 500)
  }
}
