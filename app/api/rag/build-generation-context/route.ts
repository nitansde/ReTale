import { readJsonObject, apiRequestErrorResponse, MAX_GENERATION_JSON_BODY_BYTES } from '@/lib/server/api-route'
import { NextResponse } from 'next/server'
import { buildGenerationContext, type GenerationContextRagArtifacts } from '@/lib/server/context-builder'
import { runWithNovelDatabaseAccess } from '@/lib/server/database-access'
import {
  createGenerationContextSnapshot,
  loadGenerationContextSnapshot,
} from '@/lib/server/generation-context-snapshot'
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
    const body = await readJsonObject(request, MAX_GENERATION_JSON_BODY_BYTES)
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
    const writingSkillCardIds = effectiveOperationType === 'rewrite'
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

    const contextRequest = {
      novelId,
      branchId: body.branchId ? String(body.branchId) : undefined,
      chapterId,
      selectedText: String(body.selectedText ?? ''),
      sourceText: typeof body.sourceText === 'string' ? body.sourceText : undefined,
      operationType: effectiveOperationType,
      userInstruction: String(body.userInstruction ?? ''),
      roleplayMessages: Array.isArray(body.roleplayMessages) ? body.roleplayMessages : undefined,
      excludedGraphEdgeIds: normalizeStringArray(body.excludedGraphEdgeIds),
      excludedEvidenceIds: normalizeStringArray(body.excludedEvidenceIds),
      whatIfSessionId: body.whatIfSessionId ? String(body.whatIfSessionId) : undefined,
      futureJumpRunId: body.futureJumpRunId ? String(body.futureJumpRunId) : undefined,
      branchContextNodeId: body.branchContextNodeId ? String(body.branchContextNodeId) : undefined,
      branchContextInclusion: normalizeBranchContextInclusion(body.branchContextInclusion),
      writingSkillCardIds,
      writingSkillExampleCount,
      writingSkillSeed,
    } as const
    const { result, contextSnapshotId } = await runWithNovelDatabaseAccess(novelId, async () => {
      const cachedRagArtifacts = loadGenerationContextSnapshot({
        snapshotId: typeof body.contextSnapshotId === 'string' ? body.contextSnapshotId : null,
        request: contextRequest,
      })
      let ragArtifacts: GenerationContextRagArtifacts | null = null
      const result = await buildGenerationContext(contextRequest, {
        cachedRagArtifacts,
        onRagArtifacts: (artifacts) => {
          ragArtifacts = artifacts
        },
      })
      return {
        result,
        contextSnapshotId: ragArtifacts
          ? createGenerationContextSnapshot({ request: contextRequest, artifacts: ragArtifacts })
          : null,
      }
    })

    return NextResponse.json({ ok: true, ...result, contextSnapshotId })
  } catch (error) {
    const requestError = apiRequestErrorResponse(error)
    if (requestError) return requestError
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to build generation context' },
      { status: error instanceof Error && error.message.includes('Invalid novel ID') ? 400 : error instanceof Error && error.message.includes('not found') ? 404 : 500 }
    )
  }
}
