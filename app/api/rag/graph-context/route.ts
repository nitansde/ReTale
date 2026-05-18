import { NextResponse } from 'next/server'
import { buildChapterGraphContext } from '@/lib/server/context-builder'
import { buildGraphAwareContext } from '@/lib/server/graph-context'
import { normalizeBranchId } from '@/lib/server/knowledge-store'
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
      const result = await buildChapterGraphContext({
        novelId,
        chapterId,
        maxHops: normalizeMaxHops(body.maxHops),
        includeLowConfidence: Boolean(body.includeLowConfidence),
        confirmedOnly: Boolean(body.confirmedOnly),
      })

      return NextResponse.json({ ok: true, ...result })
    }

    if (!Number.isFinite(chapterNo) || chapterNo < 1) {
      return NextResponse.json({ ok: false, error: 'chapterNo must be a positive number' }, { status: 400 })
    }
    if (!operationType) {
      return NextResponse.json({ ok: false, error: INVALID_OPERATION_TYPE_ERROR }, { status: 400 })
    }

    const result = await buildGraphAwareContext({
      novelId,
      branchId: normalizeBranchId(novelId, rawBranchId || undefined),
      chapterNo,
      selectedText,
      nearbyText,
      operationType,
      maxHops: normalizeMaxHops(body.maxHops),
      includeLowConfidence: Boolean(body.includeLowConfidence),
      confirmedOnly: Boolean(body.confirmedOnly),
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to build graph context' },
      { status: 500 }
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

    const result = await buildChapterGraphContext({
      novelId,
      chapterId,
      maxHops: normalizeMaxHops(searchParams.get('hops')),
      includeLowConfidence: searchParams.get('includeLowConfidence') === 'true',
      confirmedOnly: searchParams.get('confirmedOnly') === 'true',
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load chapter graph context' },
      { status: 500 }
    )
  }
}
