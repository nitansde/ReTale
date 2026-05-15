import { NextResponse } from 'next/server'
import { buildGenerationContext } from '@/lib/server/context-builder'

function normalizeOperationType(value: unknown) {
  const operationType = String(value ?? 'expand').trim()
  if (operationType === 'expand' || operationType === 'rewrite' || operationType === 'roleplay' || operationType === 'polish' || operationType === 'continue') {
    return operationType
  }
  return 'expand'
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean)))
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

    const result = await buildGenerationContext({
      novelId,
      branchId: body.branchId ? String(body.branchId) : undefined,
      chapterId,
      selectedText: String(body.selectedText ?? ''),
      operationType: normalizeOperationType(body.operationType),
      userInstruction: String(body.userInstruction ?? ''),
      excludedGraphEdgeIds: normalizeStringArray(body.excludedGraphEdgeIds),
      excludedEvidenceIds: normalizeStringArray(body.excludedEvidenceIds),
      whatIfSessionId: body.whatIfSessionId ? String(body.whatIfSessionId) : undefined,
      futureJumpRunId: body.futureJumpRunId ? String(body.futureJumpRunId) : undefined,
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to build generation context' },
      { status: 500 }
    )
  }
}
