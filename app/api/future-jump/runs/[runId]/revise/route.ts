import { NextResponse } from 'next/server'
import { apiRequestErrorResponse, MAX_GENERATION_JSON_BODY_BYTES, jsonError, readJsonObject, requireNonEmptyId, toErrorMessage } from '@/lib/server/api-route'
import { reviseFutureJumpRun } from '@/lib/server/future-jump-service'

export async function POST(request: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId: rawRunId } = await ctx.params
    const runId = requireNonEmptyId(rawRunId, 'runId')
    const body = await readJsonObject(request, MAX_GENERATION_JSON_BODY_BYTES)
    const result = await reviseFutureJumpRun({
      runId,
      novelId: String(body.novelId ?? ''),
      userFeedback: String(body.userFeedback ?? ''),
    })

    return NextResponse.json(result)
  } catch (error) {
    const requestError = apiRequestErrorResponse(error)
    if (requestError) return requestError
    const message = toErrorMessage(error, 'Failed to revise future jump run')
    return jsonError(message, 500)
  }
}
