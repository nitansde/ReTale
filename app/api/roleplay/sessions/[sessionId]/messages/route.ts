import { NextResponse } from 'next/server'
import { isNotFoundErrorMessage, jsonError, readJsonObject, requireNonEmptyId, toErrorMessage } from '@/lib/server/api-route'
import { appendRoleplayMessage, createRoleplayLatestTurnVariant } from '@/lib/server/roleplay-store'
import { uid } from '@/lib/utils'

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId: rawSessionId } = await context.params
    const sessionId = requireNonEmptyId(rawSessionId, 'sessionId')
    const body = await readJsonObject(request)
    const mode = body.mode === 'latest-turn-variant' ? 'latest-turn-variant' : 'append'

    const result = mode === 'latest-turn-variant'
      ? await createRoleplayLatestTurnVariant({
        sessionId,
        role: body.role === 'assistant' ? 'assistant' : 'user',
        content: String(body.content ?? ''),
        parentMessageId: typeof body.parentMessageId === 'string' ? body.parentMessageId : null,
        forkedFromMessageId: typeof body.forkedFromMessageId === 'string' ? body.forkedFromMessageId : null,
        status: typeof body.status === 'string' ? body.status : 'active',
      })
      : await appendRoleplayMessage({
        id: typeof body.id === 'string' && body.id.trim() ? body.id : uid('roleplay-message'),
        sessionId,
        role: body.role === 'assistant' ? 'assistant' : 'user',
        content: String(body.content ?? ''),
        parentMessageId: typeof body.parentMessageId === 'string' ? body.parentMessageId : null,
        forkedFromMessageId: typeof body.forkedFromMessageId === 'string' ? body.forkedFromMessageId : null,
        variantGroupId: typeof body.variantGroupId === 'string' ? body.variantGroupId : null,
        status: typeof body.status === 'string' ? body.status : 'active',
      })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    const message = toErrorMessage(error, 'Failed to append roleplay message')
    return jsonError(message, isNotFoundErrorMessage(message) ? 404 : 400)
  }
}
