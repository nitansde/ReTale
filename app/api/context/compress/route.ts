import { z } from 'zod'
import { apiRequestErrorResponse, noStoreJson, noStoreJsonError, readJsonObject } from '@/lib/server/api-route'
import { runWithNovelDatabaseAccess } from '@/lib/server/database-access'
import { compressGeneratedHistory, expandGeneratedHistory, getGeneratedHistory } from '@/lib/server/generated-history'

export const maxDuration = 3600
const scopeSchema = z.object({
  novelId: z.string().trim().min(1), branchId: z.string().trim().min(1),
  branchContextNodeId: z.string().trim().min(1).optional(),
  branchContextInclusion: z.enum(['ancestors_only', 'include_selected']).optional(),
  roleplaySessionId: z.string().trim().min(1).optional(),
  roleplayLeafMessageId: z.string().trim().min(1).nullable().optional(),
})
export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request)
    const parsed = z.object({ scope: scopeSchema, count: z.number().int().positive().optional(), fingerprint: z.string().optional() }).safeParse(body)
    if (!parsed.success) return noStoreJsonError('Invalid compression request', 400)
    const { scope, count, fingerprint } = parsed.data
    return await runWithNovelDatabaseAccess(scope.novelId, async () => {
      const compression = count === undefined ? getGeneratedHistory(scope).preview
        : await compressGeneratedHistory({ scope, count, fingerprint: fingerprint ?? '', signal: request.signal })
      return noStoreJson({ ok: true, compression })
    })
  } catch (error) {
    return apiRequestErrorResponse(error) ?? noStoreJsonError(error instanceof Error ? error.message : '上下文压缩失败', 500)
  }
}

export async function DELETE(request: Request) {
  try {
    const parsed = z.object({ scope: scopeSchema, fingerprint: z.string().min(1) }).safeParse(await readJsonObject(request))
    if (!parsed.success) return noStoreJsonError('Invalid expansion request', 400)
    return await runWithNovelDatabaseAccess(parsed.data.scope.novelId, async () => {
      const compression = await expandGeneratedHistory(parsed.data)
      return noStoreJson({ ok: true, compression })
    })
  } catch (error) {
    return apiRequestErrorResponse(error) ?? noStoreJsonError(error instanceof Error ? error.message : '上下文展开失败', 500)
  }
}
