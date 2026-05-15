import { NextResponse } from 'next/server'
import { reviseFutureJumpRun } from '@/lib/server/future-jump-service'

export async function POST(request: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params
    const body = await request.json()
    const result = await reviseFutureJumpRun({
      runId,
      userFeedback: String(body.userFeedback ?? ''),
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to revise future jump run'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
