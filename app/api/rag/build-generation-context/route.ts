import { apiRequestErrorResponse, MAX_GENERATION_JSON_BODY_BYTES, noStoreJson, readJsonObject } from '@/lib/server/api-route'
import { NextResponse } from 'next/server'
import { runWithNovelDatabaseAccess } from '@/lib/server/database-access'
import { buildGenerationPromptPreview, prepareGenerationPrompt } from '@/lib/server/generation-prompt'
import { PRODUCT_SURFACE_IDS, type ProductSurfaceId } from '@/lib/types'

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request, MAX_GENERATION_JSON_BODY_BYTES)
    const novelId = String(body.novelId ?? '').trim()
    const chapterId = String(body.chapterId ?? '').trim()
    if (!novelId || !chapterId) {
      return NextResponse.json({ ok: false, error: 'novelId and chapterId are required' }, { status: 400 })
    }
    if (!PRODUCT_SURFACE_IDS.includes(String(body.operationType ?? '').trim() as ProductSurfaceId)) {
      return NextResponse.json({ ok: false, error: `Invalid operationType. Expected one of: ${PRODUCT_SURFACE_IDS.join(', ')}` }, { status: 400 })
    }
    return await runWithNovelDatabaseAccess(novelId, async () => noStoreJson(
      buildGenerationPromptPreview(await prepareGenerationPrompt({ ...body, novelId, chapterId }, { previewOnly: true })),
    ))
  } catch (error) {
    const requestError = apiRequestErrorResponse(error)
    if (requestError) return requestError
    const message = error instanceof Error ? error.message : 'Failed to build generation context'
    return NextResponse.json({ ok: false, error: message }, { status: message.includes('Invalid novel ID') ? 400 : message.includes('not found') ? 404 : 500 })
  }
}
