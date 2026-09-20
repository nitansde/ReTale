import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import { noStoreJson, noStoreJsonError, requireNonEmptyId } from '@/lib/server/api-route'
import type { RoleplaySessionDetail } from '@/lib/roleplay-types'

import { findRoleplaySessionById } from '@/lib/server/roleplay-store'
import { getRoleplayCharacterOptions } from '@/lib/server/roleplay-characters'

function toRoleplaySessionPayload(session: RoleplaySessionDetail) {
  return {
    ...session,
    sourceSnapshot: {
      chapterId: session.sourceChapterId,
      chapterNo: session.sourceChapterNo,
      chapterTitle: session.sourceChapterTitle,
      timelineNodeId: session.sourceTimelineNodeId,
      timelineNodeType: session.sourceTimelineNodeType,
      selectedText: session.sourceSelectedText,
      textSnapshot: session.sourceTextSnapshot,
      selectedLineStart: session.sourceSelectedLineStart,
      selectedLineEnd: session.sourceSelectedLineEnd,
    },
    messages: session.messages.map((message) => ({
      ...message,
      variantMetadata: {
        turnIndex: message.turnIndex,
        variantIndex: message.variantIndex,
        variantGroupId: message.variantGroupId,
      },
      forkMetadata: {
        parentMessageId: message.parentMessageId,
        forkedFromMessageId: message.forkedFromMessageId,
      },
    })),
  }
}

export async function GET(request: Request, ctx: RouteContext<'/api/roleplay/sessions/[sessionId]'>) {
  try {
    const { sessionId: rawSessionId } = await ctx.params
    const sessionId = requireNonEmptyId(rawSessionId, 'sessionId')
    const { searchParams } = new URL(request.url)
    const novelId = searchParams.get('novelId')?.trim() ?? ''
    const branchId = searchParams.get('branchId')?.trim() ?? ''

    if (!novelId) {
      return noStoreJsonError('novelId is required', 400)
    }
    if (!branchId) {
      return noStoreJsonError('branchId is required', 400)
    }

    const db = createNovelDatabaseAccess(novelId)

    const session = findRoleplaySessionById(sessionId, db)

    if (!session || session.novelId !== novelId || session.branchId !== branchId) {
      return noStoreJson({ ok: false, error: 'Roleplay session not found for the requested branch context' }, { status: 404 })
    }

    return noStoreJson({
      ...toRoleplaySessionPayload(session),
      timelineNodeId: db.queryOne<{ id: string }>('SELECT id FROM story_timeline_nodes WHERE roleplay_session_id = ? LIMIT 1', sessionId)?.id ?? null,
      characterOptions: getRoleplayCharacterOptions(session, db),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load roleplay session'
    return noStoreJsonError(message, message.endsWith(' is required') ? 400 : 500)
  }
}
