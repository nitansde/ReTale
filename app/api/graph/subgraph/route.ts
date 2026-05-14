import { NextResponse } from 'next/server'
import { buildGraphSubgraph } from '@/lib/server/graph-context'
import { normalizeBranchId } from '@/lib/server/knowledge-store'

function normalizeMaxHops(value: string | null) {
  return Number(value) >= 2 ? 2 : 1
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const novelId = searchParams.get('novelId')?.trim() ?? ''
    const rawBranchId = searchParams.get('branchId')?.trim()
    const chapterNo = Number(searchParams.get('chapterNo'))
    const entityIds = (searchParams.get('entityId') ?? '')
      .split(',')
      .map((entityId) => entityId.trim())
      .filter(Boolean)

    if (!novelId) {
      return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
    }
    if (!Number.isFinite(chapterNo) || chapterNo < 1) {
      return NextResponse.json({ ok: false, error: 'chapterNo must be a positive number' }, { status: 400 })
    }
    if (!entityIds.length) {
      return NextResponse.json({ ok: false, error: 'entityId is required' }, { status: 400 })
    }

    const result = await buildGraphSubgraph({
      novelId,
      branchId: normalizeBranchId(novelId, rawBranchId),
      chapterNo,
      entityIds,
      maxHops: normalizeMaxHops(searchParams.get('hops')),
      includeLowConfidence: searchParams.get('includeLowConfidence') === 'true',
      confirmedOnly: searchParams.get('confirmedOnly') === 'true',
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load graph subgraph' },
      { status: 500 }
    )
  }
}
