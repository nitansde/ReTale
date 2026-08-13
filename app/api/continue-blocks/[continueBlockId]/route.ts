import { noStoreJson, noStoreJsonError, requireNonEmptyId } from '@/lib/server/api-route'
import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import { findContinueBlockById } from '@/lib/server/continue-block-store'

export async function GET(request: Request, ctx: RouteContext<'/api/continue-blocks/[continueBlockId]'>) {
  try {
    const { continueBlockId: rawContinueBlockId } = await ctx.params
    const continueBlockId = requireNonEmptyId(rawContinueBlockId, 'continueBlockId')
    const { searchParams } = new URL(request.url)
    const novelId = searchParams.get('novelId')?.trim() ?? ''
    const branchId = searchParams.get('branchId')?.trim() ?? ''

    if (!novelId) {
      return noStoreJsonError('novelId is required', 400)
    }
    if (!branchId) {
      return noStoreJsonError('branchId is required', 400)
    }

    const detail = findContinueBlockById(continueBlockId, createNovelDatabaseAccess(novelId))
    if (!detail || detail.novelId !== novelId || detail.branchId !== branchId) {
      return noStoreJsonError('Continue block not found for the requested branch context', 404)
    }

    return noStoreJson(detail)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load continue block detail'
    return noStoreJsonError(message, message.endsWith(' is required') ? 400 : 500)
  }
}
