import { NextResponse } from 'next/server'
import { createFutureJumpRun } from '@/lib/server/future-jump-service'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = await createFutureJumpRun({
      sessionId: String(body.sessionId ?? ''),
      targetOutlineNodeId: String(body.targetOutlineNodeId ?? ''),
      targetOutlineChapterId: String(body.targetOutlineChapterId ?? ''),
      parentTimelineNodeId: typeof body.parentTimelineNodeId === 'string' ? body.parentTimelineNodeId : null,
      userDirection: typeof body.userDirection === 'string' ? body.userDirection : null,
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create future jump run'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
