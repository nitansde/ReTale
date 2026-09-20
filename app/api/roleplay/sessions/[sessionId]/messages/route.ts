import { NextResponse } from 'next/server'
import { apiRequestErrorResponse, MAX_GENERATION_JSON_BODY_BYTES, jsonError, readJsonObject, requireNonEmptyId, toErrorMessage } from '@/lib/server/api-route'
import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import { appendRoleplayMessage, createRoleplayLatestTurnVariant, deleteRoleplayBranch, deleteRoleplayTurn, findRoleplaySessionById } from '@/lib/server/roleplay-store'
import { uid } from '@/lib/utils'
import { parseRoleplayTurn, parseRoleplayScript } from '@/lib/roleplay-script'

export async function DELETE(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId: rawSessionId } = await context.params
    const sessionId = requireNonEmptyId(rawSessionId, 'sessionId')
    const body = await readJsonObject(request)
    const novelId = requireNonEmptyId(String(body.novelId ?? ''), 'novelId')
    const branchId = requireNonEmptyId(String(body.branchId ?? ''), 'branchId')
    const messageId = requireNonEmptyId(String(body.messageId ?? ''), 'messageId')
    const db = createNovelDatabaseAccess(novelId)
    const session = findRoleplaySessionById(sessionId, db)
    if (!session || session.novelId !== novelId || session.branchId !== branchId) {
      return jsonError('Roleplay session not found for the requested branch context', 404)
    }
    if (body.mode !== undefined && body.mode !== 'branch') return jsonError('Invalid deletion mode', 400)
    const result = await (body.mode === 'branch' ? deleteRoleplayBranch : deleteRoleplayTurn)({ sessionId, messageId }, db)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return apiRequestErrorResponse(error) ?? jsonError(toErrorMessage(error, 'Failed to delete roleplay request'), 500)
  }
}

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
    const turn = body.turn === undefined ? null : parseRoleplayTurn(body.turn)
    const script = body.script === undefined ? null : parseRoleplayScript(body.script)
    if ((body.turn !== undefined && (!turn || body.role !== 'user')) || (body.script !== undefined && (!script || body.role !== 'assistant'))) {
      return jsonError('Invalid roleplay script or turn', 400)
    }
    if (script) {
      const parent = session.messages.find((message) => message.id === body.parentMessageId)?.turn
      if (!parent || script.playerName !== parent.playerName || script.counterpartName !== parent.counterpartName
        || !script.blocks.some((block) => block.type === 'counterpart')) {
        return jsonError('Script does not match the parent turn', 400)
      }
    }
    const content = turn ? JSON.stringify({ turn }) : script ? JSON.stringify({ script }) : String(body.content ?? '')

    const result = mode === 'latest-turn-variant'
      ? await createRoleplayLatestTurnVariant({
        sessionId,
        sourceMessageId: body.sourceMessageId === undefined ? undefined : requireNonEmptyId(String(body.sourceMessageId ?? ''), 'sourceMessageId'),
        role: body.role === 'assistant' ? 'assistant' : 'user',
        content,
        parentMessageId: typeof body.parentMessageId === 'string' ? body.parentMessageId : null,
        forkedFromMessageId: typeof body.forkedFromMessageId === 'string' ? body.forkedFromMessageId : null,
        status: typeof body.status === 'string' ? body.status : 'active',
      }, db)
      : await appendRoleplayMessage({
        id: typeof body.id === 'string' && body.id.trim() ? body.id : uid('roleplay-message'),
        sessionId,
        role: body.role === 'assistant' ? 'assistant' : 'user',
        content,
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
