import { NextResponse } from 'next/server'
import { listRoleplaySessionsByNovel, createRoleplaySession } from '@/lib/server/roleplay-store'
import { uid } from '@/lib/utils'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const novelId = searchParams.get('novelId')?.trim() ?? ''
    if (!novelId) {
      return NextResponse.json({ error: 'novelId is required' }, { status: 400 })
    }

    return NextResponse.json({ sessions: listRoleplaySessionsByNovel(novelId) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load roleplay sessions'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = await createRoleplaySession({
      id: typeof body.id === 'string' && body.id.trim() ? body.id : uid('roleplay-session'),
      novelId: String(body.novelId ?? ''),
      branchId: String(body.branchId ?? ''),
      title: String(body.title ?? ''),
      subtitle: typeof body.subtitle === 'string' ? body.subtitle : null,
      sourceChapterId: typeof body.sourceChapterId === 'string' ? body.sourceChapterId : null,
      sourceChapterNo: Number(body.sourceChapterNo ?? 0),
      sourceChapterTitle: typeof body.sourceChapterTitle === 'string' ? body.sourceChapterTitle : null,
      sourceTimelineNodeId: typeof body.sourceTimelineNodeId === 'string' ? body.sourceTimelineNodeId : null,
      sourceTimelineNodeType: typeof body.sourceTimelineNodeType === 'string' ? body.sourceTimelineNodeType : null,
      sourceSelectedText: String(body.sourceSelectedText ?? ''),
      sourceTextSnapshot: String(body.sourceTextSnapshot ?? ''),
      sourceSelectedLineStart: Number.isInteger(body.sourceSelectedLineStart) ? Number(body.sourceSelectedLineStart) : null,
      sourceSelectedLineEnd: Number.isInteger(body.sourceSelectedLineEnd) ? Number(body.sourceSelectedLineEnd) : null,
      status: typeof body.status === 'string' && body.status.trim() ? body.status : 'active',
    })

    return NextResponse.json({ sessionId: result.session.id, timelineNodeId: result.timelineNodeId }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create roleplay session'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
