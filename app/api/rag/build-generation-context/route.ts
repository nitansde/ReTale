import { NextResponse } from 'next/server'
import { buildGenerationContext } from '@/lib/server/context-builder'
import { runWithNovelDatabaseAccess } from '@/lib/server/database-access'
import { PRODUCT_SURFACE_IDS, type ProductSurfaceId } from '@/lib/types'

const INVALID_OPERATION_TYPE_ERROR = `Invalid operationType. Expected one of: ${PRODUCT_SURFACE_IDS.join(', ')}`

function parseOperationType(value: unknown): ProductSurfaceId | null {
  const operationType = String(value ?? '').trim()
  return PRODUCT_SURFACE_IDS.includes(operationType as ProductSurfaceId)
    ? operationType as ProductSurfaceId
    : null
}

function resolveGenerationRouteOperationType(operationType: ProductSurfaceId): ProductSurfaceId {
  return operationType === 'roleplay' ? 'roleplay' : 'rewrite'
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean)))
}

function normalizeBranchContextInclusion(value: unknown) {
  return value === 'include_selected' || value === 'ancestors_only'
    ? value
    : undefined
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
    }

    const novelId = String(body.novelId ?? '').trim()
    const chapterId = String(body.chapterId ?? '').trim()
    if (!novelId || !chapterId) {
      return NextResponse.json({ ok: false, error: 'novelId and chapterId are required' }, { status: 400 })
    }

    const operationType = parseOperationType(body.operationType)
    if (!operationType) {
      return NextResponse.json({ ok: false, error: INVALID_OPERATION_TYPE_ERROR }, { status: 400 })
    }
    const effectiveOperationType = resolveGenerationRouteOperationType(operationType)

    const result = await runWithNovelDatabaseAccess(novelId, () => buildGenerationContext({
      novelId,
      branchId: body.branchId ? String(body.branchId) : undefined,
      chapterId,
      selectedText: String(body.selectedText ?? ''),
      operationType: effectiveOperationType,
      userInstruction: String(body.userInstruction ?? ''),
      roleplayMessages: Array.isArray(body.roleplayMessages) ? body.roleplayMessages : undefined,
      excludedGraphEdgeIds: normalizeStringArray(body.excludedGraphEdgeIds),
      excludedEvidenceIds: normalizeStringArray(body.excludedEvidenceIds),
      whatIfSessionId: body.whatIfSessionId ? String(body.whatIfSessionId) : undefined,
      futureJumpRunId: body.futureJumpRunId ? String(body.futureJumpRunId) : undefined,
      branchContextNodeId: body.branchContextNodeId ? String(body.branchContextNodeId) : undefined,
      branchContextInclusion: normalizeBranchContextInclusion(body.branchContextInclusion),
    }))

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to build generation context' },
      { status: error instanceof Error && error.message.includes('Invalid novel ID') ? 400 : error instanceof Error && error.message.includes('not found') ? 404 : 500 }
    )
  }
}
