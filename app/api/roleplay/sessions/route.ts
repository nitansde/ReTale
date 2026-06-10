import { NextResponse } from 'next/server'
import { isNotFoundErrorMessage, jsonError, readJsonObject, toErrorMessage } from '@/lib/server/api-route'
import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import { listRoleplaySessionsByNovel, createRoleplaySession } from '@/lib/server/roleplay-store'
import type { RoleplaySourceNodeType } from '@/lib/roleplay-types'
import { uid } from '@/lib/utils'

function parseRoleplaySourceNodeType(value: unknown): RoleplaySourceNodeType | null {
  return value === 'chapter'
    || value === 'rewrite'
    || value === 'continue_block'
    || value === 'what_if'
    || value === 'future_jump'
    || value === 'roleplay_session'
    ? value
    : null
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const novelId = searchParams.get('novelId')?.trim() ?? ''
    if (!novelId) {
      return jsonError('novelId is required', 400)
    }

    return NextResponse.json({ sessions: listRoleplaySessionsByNovel(novelId, createNovelDatabaseAccess(novelId)) })
  } catch (error) {
    const message = toErrorMessage(error, 'Failed to load roleplay sessions')
    return jsonError(message, isNotFoundErrorMessage(message) ? 404 : 400)
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request)
    const novelId = String(body.novelId ?? '')
    const db = createNovelDatabaseAccess(novelId)
    const result = await createRoleplaySession({
      id: typeof body.id === 'string' && body.id.trim() ? body.id : uid('roleplay-session'),
      novelId,
      branchId: String(body.branchId ?? ''),
      title: String(body.title ?? ''),
      subtitle: typeof body.subtitle === 'string' ? body.subtitle : null,
      sourceChapterId: typeof body.sourceChapterId === 'string' ? body.sourceChapterId : null,
      sourceChapterNo: Number(body.sourceChapterNo ?? 0),
      sourceChapterTitle: typeof body.sourceChapterTitle === 'string' ? body.sourceChapterTitle : null,
      sourceTimelineNodeId: typeof body.sourceTimelineNodeId === 'string' ? body.sourceTimelineNodeId : null,
      sourceTimelineNodeType: parseRoleplaySourceNodeType(body.sourceTimelineNodeType),
      sourceSelectedText: String(body.sourceSelectedText ?? ''),
      sourceTextSnapshot: String(body.sourceTextSnapshot ?? ''),
      sourceSelectedLineStart: Number.isInteger(body.sourceSelectedLineStart) ? Number(body.sourceSelectedLineStart) : null,
      sourceSelectedLineEnd: Number.isInteger(body.sourceSelectedLineEnd) ? Number(body.sourceSelectedLineEnd) : null,
      status: typeof body.status === 'string' && body.status.trim() ? body.status : 'active',
    }, db)

    return NextResponse.json({ sessionId: result.session.id, timelineNodeId: result.timelineNodeId }, { status: 201 })
  } catch (error) {
    const message = toErrorMessage(error, 'Failed to create roleplay session')
    return jsonError(message, isNotFoundErrorMessage(message) ? 404 : 400)
  }
}
