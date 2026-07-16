import { NextResponse } from 'next/server'
import { buildGraphSubgraph } from '@/lib/server/graph-context'
import { findStoryBranch, normalizeBranchId } from '@/lib/server/knowledge-store'
import { runWithNovelDatabaseAccess } from '@/lib/server/database-access'

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

    const result = await runWithNovelDatabaseAccess(novelId, async () => {
      const branchId = normalizeBranchId(novelId, rawBranchId)
      const branch = findStoryBranch(branchId)
      if (!branch || branch.novelId !== novelId) {
        throw new Error('branchId does not belong to the requested novel')
      }
      return buildGraphSubgraph({
        novelId,
        branchId,
        chapterNo,
        entityIds,
        maxHops: normalizeMaxHops(searchParams.get('hops')),
        includeLowConfidence: searchParams.get('includeLowConfidence') === 'true',
        confirmedOnly: searchParams.get('confirmedOnly') === 'true',
      })
    })

    if (!result.seedEntities.length) {
      return NextResponse.json({ ok: false, error: 'Graph entities not found for the requested branch context' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load graph subgraph' },
      { status: error instanceof Error && error.message.includes('Invalid novel ID') ? 400 : error instanceof Error && (error.message.includes('not found') || error.message.includes('does not belong')) ? 404 : 500 }
    )
  }
}
