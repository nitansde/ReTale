import { NextResponse } from 'next/server'
import { buildChapterGraphContext } from '@/lib/server/context-builder'
import { buildGraphAwareContext } from '@/lib/server/graph-context'
import { findStoryBranch, normalizeBranchId } from '@/lib/server/knowledge-store'
import { runWithNovelDatabaseAccess } from '@/lib/server/database-access'
import { PRODUCT_SURFACE_IDS, type ProductSurfaceId } from '@/lib/types'

const INVALID_OPERATION_TYPE_ERROR = `Invalid operationType. Expected one of: ${PRODUCT_SURFACE_IDS.join(', ')}`

function parseOperationType(value: unknown): ProductSurfaceId | null {
  const operationType = String(value ?? '').trim()
  return PRODUCT_SURFACE_IDS.includes(operationType as ProductSurfaceId)
    ? operationType as ProductSurfaceId
    : null
}

function normalizeMaxHops(value: unknown) {
  return Number(value) >= 2 ? 2 : 1
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
    }

    const novelId = String(body.novelId ?? '').trim()
    const chapterId = String(body.chapterId ?? '').trim()
    const rawBranchId = String(body.branchId ?? '').trim()
    const chapterNo = Number(body.chapterNo)
    const selectedText = String(body.selectedText ?? '')
    const nearbyText = String(body.nearbyText ?? '')
    const operationTypeInput = body.operationType
    const operationType = operationTypeInput === undefined && chapterId ? null : parseOperationType(operationTypeInput)

    if (!novelId) {
      return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
    }

    if (operationTypeInput !== undefined && !operationType) {
      return NextResponse.json({ ok: false, error: INVALID_OPERATION_TYPE_ERROR }, { status: 400 })
    }

    if (chapterId) {
      const result = await runWithNovelDatabaseAccess(novelId, () => buildChapterGraphContext({
        novelId,
        chapterId,
        maxHops: normalizeMaxHops(body.maxHops),
        includeLowConfidence: Boolean(body.includeLowConfidence),
        confirmedOnly: Boolean(body.confirmedOnly),
      }))

      return NextResponse.json({ ok: true, ...result })
    }

    if (!Number.isFinite(chapterNo) || chapterNo < 1) {
      return NextResponse.json({ ok: false, error: 'chapterNo must be a positive number' }, { status: 400 })
    }
    if (!operationType) {
      return NextResponse.json({ ok: false, error: INVALID_OPERATION_TYPE_ERROR }, { status: 400 })
    }

    const result = await runWithNovelDatabaseAccess(novelId, async () => {
      const branchId = normalizeBranchId(novelId, rawBranchId || undefined)
      const branch = findStoryBranch(branchId)
      if (!branch || branch.novelId !== novelId) {
        throw new Error('branchId does not belong to the requested novel')
      }
      return buildGraphAwareContext({
        novelId,
        branchId,
        chapterNo,
        selectedText,
        nearbyText,
        operationType,
        maxHops: normalizeMaxHops(body.maxHops),
        includeLowConfidence: Boolean(body.includeLowConfidence),
        confirmedOnly: Boolean(body.confirmedOnly),
      })
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to build graph context' },
      { status: error instanceof Error && error.message.includes('Invalid novel ID') ? 400 : error instanceof Error && (error.message.includes('not found') || error.message.includes('does not belong')) ? 404 : 500 }
    )
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const novelId = searchParams.get('novelId')?.trim() ?? ''
    const chapterId = searchParams.get('chapterId')?.trim() ?? ''

    if (!novelId) {
      return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
    }
    if (!chapterId) {
      return NextResponse.json({ ok: false, error: 'chapterId is required' }, { status: 400 })
    }

    const result = await runWithNovelDatabaseAccess(novelId, () => buildChapterGraphContext({
      novelId,
      chapterId,
      maxHops: normalizeMaxHops(searchParams.get('hops')),
      includeLowConfidence: searchParams.get('includeLowConfidence') === 'true',
      confirmedOnly: searchParams.get('confirmedOnly') === 'true',
    }))

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load chapter graph context' },
      { status: error instanceof Error && error.message.includes('Invalid novel ID') ? 400 : error instanceof Error && error.message.includes('not found') ? 404 : 500 }
    )
  }
}
