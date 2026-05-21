import { NextResponse } from 'next/server'
import { appendRoleplayMessage, createRoleplayLatestTurnVariant } from '@/lib/server/roleplay-store'
import { uid } from '@/lib/utils'

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params
    const body = await request.json()
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
    const message = error instanceof Error ? error.message : 'Failed to append roleplay message'
    const status = /not found/u.test(message) ? 404 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
