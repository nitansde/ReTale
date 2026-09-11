import { jsonError, readJsonObject, apiRequestErrorResponse, MAX_GENERATION_JSON_BODY_BYTES } from '@/lib/server/api-route'
import { NextResponse } from 'next/server'
import { createWhatIfSessionFromRewrite } from '@/lib/server/what-if-service'

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request, MAX_GENERATION_JSON_BODY_BYTES)
    const result = await createWhatIfSessionFromRewrite({
      novelId: String(body.novelId ?? ''),
      branchId: String(body.branchId ?? ''),
      sourceChapterNo: Number(body.sourceChapterNo ?? 0),
      selectedText: String(body.selectedText ?? ''),
      originalText: String(body.originalText ?? ''),
      generatedText: String(body.generatedText ?? ''),
      inputTokens: typeof body.inputTokens === 'number' ? body.inputTokens : null,
      outputTokens: typeof body.outputTokens === 'number' ? body.outputTokens : null,
      userInstruction: String(body.userInstruction ?? ''),
      titleHint: typeof body.titleHint === 'string' ? body.titleHint : null,
      subtitleHint: typeof body.subtitleHint === 'string' ? body.subtitleHint : null,
    })

    return NextResponse.json(result)
  } catch (error) {
    const requestError = apiRequestErrorResponse(error)
    if (requestError) return requestError
    const message = error instanceof Error ? error.message : 'Failed to create what-if session'
    return jsonError(message, 500)
  }
}
