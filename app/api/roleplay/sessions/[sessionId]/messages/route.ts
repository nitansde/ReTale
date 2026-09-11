import { NextResponse } from 'next/server'
import { apiRequestErrorResponse, MAX_GENERATION_JSON_BODY_BYTES, jsonError, readJsonObject, requireNonEmptyId, toErrorMessage } from '@/lib/server/api-route'
import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import { appendRoleplayMessage, createRoleplayLatestTurnVariant, findRoleplaySessionById } from '@/lib/server/roleplay-store'
import { uid } from '@/lib/utils'

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId: rawSessionId } = await context.params
    const sessionId = requireNonEmptyId(rawSessionId, 'sessionId')
    const body = await readJsonObject(request, MAX_GENERATION_JSON_BODY_BYTES)
    const novelId = requireNonEmptyId(String(body.novelId ?? ''), 'novelId')
    const branchId = requireNonEmptyId(String(body.branchId ?? ''), 'branchId')
    const db = createNovelDatabaseAccess(novelId)
    const session = findRoleplaySessionById(sessionId, db)
    if (!session || session.novelId !== novelId || session.branchId !== branchId) {
      return jsonError('Roleplay session not found for the requested branch context', 404)
    }
    const mode = body.mode === 'latest-turn-variant' ? 'latest-turn-variant' : 'append'

    const result = mode === 'latest-turn-variant'
      ? await createRoleplayLatestTurnVariant({
        sessionId,
        role: body.role === 'assistant' ? 'assistant' : 'user',
        content: String(body.content ?? ''),
        parentMessageId: typeof body.parentMessageId === 'string' ? body.parentMessageId : null,
        forkedFromMessageId: typeof body.forkedFromMessageId === 'string' ? body.forkedFromMessageId : null,
        status: typeof body.status === 'string' ? body.status : 'active',
      }, db)
      : await appendRoleplayMessage({
        id: typeof body.id === 'string' && body.id.trim() ? body.id : uid('roleplay-message'),
        sessionId,
        role: body.role === 'assistant' ? 'assistant' : 'user',
        content: String(body.content ?? ''),
        parentMessageId: typeof body.parentMessageId === 'string' ? body.parentMessageId : null,
        forkedFromMessageId: typeof body.forkedFromMessageId === 'string' ? body.forkedFromMessageId : null,
        variantGroupId: typeof body.variantGroupId === 'string' ? body.variantGroupId : null,
        status: typeof body.status === 'string' ? body.status : 'active',
      }, db)

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    const requestError = apiRequestErrorResponse(error)
    if (requestError) return requestError
    const message = toErrorMessage(error, 'Failed to append roleplay message')
    return jsonError(message, 500)
  }
}
