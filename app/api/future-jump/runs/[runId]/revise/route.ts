import { NextResponse } from 'next/server'
import { isNotFoundErrorMessage, jsonError, readJsonObject, requireNonEmptyId, toErrorMessage } from '@/lib/server/api-route'
import { reviseFutureJumpRun } from '@/lib/server/future-jump-service'

export async function POST(request: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId: rawRunId } = await ctx.params
    const runId = requireNonEmptyId(rawRunId, 'runId')
    const body = await readJsonObject(request)
    const result = await reviseFutureJumpRun({
      runId,
      userFeedback: String(body.userFeedback ?? ''),
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = toErrorMessage(error, 'Failed to revise future jump run')
    return jsonError(message, isNotFoundErrorMessage(message) ? 404 : 400)
  }
}
