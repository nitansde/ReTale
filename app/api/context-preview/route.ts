import { NextResponse } from 'next/server'
import { buildGenerationContextPreview } from '@/lib/server/context-builder'
import { runWithNovelDatabaseAccess } from '@/lib/server/database-access'
import { PRODUCT_SURFACE_IDS, type ProductSurfaceId } from '@/lib/types'
import {
  createWritingSkillRuntimeSeed,
  normalizeWritingSkillCardIds,
} from '@/lib/writing-skill-selection'

const INVALID_OPERATION_TYPE_ERROR = `Invalid operationType. Expected one of: ${PRODUCT_SURFACE_IDS.join(', ')}`

function parseOperationType(value: unknown): ProductSurfaceId | null {
  const operationType = String(value ?? '').trim()
  return PRODUCT_SURFACE_IDS.includes(operationType as ProductSurfaceId)
    ? operationType as ProductSurfaceId
    : null
}

function normalizeBranchContextInclusion(value: unknown) {
  return value === 'include_selected' || value === 'ancestors_only'
    ? value
    : undefined
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const operationType = parseOperationType(body.operationType)
    if (!operationType) {
      return NextResponse.json({ ok: false, error: INVALID_OPERATION_TYPE_ERROR }, { status: 400 })
    }

    const novelId = String(body.novelId ?? '').trim()
    if (!novelId) {
      return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
    }
    const writingSkillCardIds = operationType !== 'roleplay'
      ? normalizeWritingSkillCardIds(body)
      : []
    const rawWritingSkillSeed = body.writingSkillSeed
    const writingSkillSeed = typeof rawWritingSkillSeed === 'number' && Number.isFinite(rawWritingSkillSeed)
      ? Math.floor(rawWritingSkillSeed) & 0x7fffffff
      : createWritingSkillRuntimeSeed()
    const rawWritingSkillExampleCount = body.writingSkillExampleCount
    const writingSkillExampleCount = typeof rawWritingSkillExampleCount === 'number' && Number.isFinite(rawWritingSkillExampleCount)
      ? Math.floor(rawWritingSkillExampleCount)
      : undefined

    const preview = await runWithNovelDatabaseAccess(novelId, () => buildGenerationContextPreview({
      novelId,
      branchId: body.branchId ? String(body.branchId) : undefined,
      chapterId: String(body.chapterId ?? ''),
      selectedText: String(body.selectedText ?? ''),
      sourceText: typeof body.sourceText === 'string' ? body.sourceText : undefined,
      operationType,
      userInstruction: String(body.userInstruction ?? ''),
      roleplayMessages: Array.isArray(body.roleplayMessages) ? body.roleplayMessages : undefined,
      whatIfSessionId: body.whatIfSessionId ? String(body.whatIfSessionId) : undefined,
      futureJumpRunId: body.futureJumpRunId ? String(body.futureJumpRunId) : undefined,
      branchContextNodeId: body.branchContextNodeId ? String(body.branchContextNodeId) : undefined,
      branchContextInclusion: normalizeBranchContextInclusion(body.branchContextInclusion),
      writingSkillCardIds,
      writingSkillExampleCount,
      writingSkillSeed,
    }))

    return NextResponse.json({ ok: true, preview })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to build generation context',
      },
      { status: error instanceof Error && (error.message.includes('Invalid novel ID') || error.message.includes('required')) ? 400 : error instanceof Error && error.message.includes('not found') ? 404 : 500 }
    )
  }
}
