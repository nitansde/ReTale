import { z } from 'zod'
import { apiRequestErrorResponse, noStoreJson, noStoreJsonError, readJsonObject } from '@/lib/server/api-route'
import { previewFutureJumpContext } from '@/lib/server/future-jump-service'
import { futureJumpCreateRequestSchema } from '@/lib/server/story-branch-contracts'

export async function POST(request: Request) {
  try {
    const body = z.object({
      novelId: z.string().min(1), branchId: z.string().min(1), sourceContext: futureJumpCreateRequestSchema.shape.sourceContext,
      targetOutlineNodeId: z.string().min(1), targetOutlineChapterId: z.string().min(1), userDirection: z.string().optional(),
    }).safeParse(await readJsonObject(request))
    if (!body.success) return noStoreJsonError('Invalid future context request', 400)
    return noStoreJson({ ok: true, ...await previewFutureJumpContext(body.data) })
  } catch (error) {
    return apiRequestErrorResponse(error) ?? noStoreJsonError(error instanceof Error ? error.message : 'Context preview failed', 500)
  }
}
