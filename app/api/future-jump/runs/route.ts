import { NextResponse } from 'next/server'
import { apiRequestErrorResponse, MAX_GENERATION_JSON_BODY_BYTES, jsonError, readJsonObject, toErrorMessage } from '@/lib/server/api-route'
import { createFutureJumpRun } from '@/lib/server/future-jump-service'
import type { FutureJumpCreateRequest } from '@/lib/story-branch-types'

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request, MAX_GENERATION_JSON_BODY_BYTES)
    const result = await createFutureJumpRun(body as unknown as FutureJumpCreateRequest)

    return NextResponse.json(result)
  } catch (error) {
    const requestError = apiRequestErrorResponse(error)
    if (requestError) return requestError
    const message = toErrorMessage(error, 'Failed to create future jump run')
    return jsonError(message, 500)
  }
}
