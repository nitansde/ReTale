import { NextResponse } from 'next/server'
import { findStoryBranch, normalizeBranchId } from '@/lib/server/knowledge-store'
import { loadStoryTimeline } from '@/lib/server/story-timeline-store'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const novelId = searchParams.get('novelId')?.trim() ?? ''
    const rawBranchId = searchParams.get('branchId')?.trim() ?? ''

    if (!novelId) {
      return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
    }
    if (!rawBranchId) {
      return NextResponse.json({ ok: false, error: 'branchId is required' }, { status: 400 })
    }

    const branchId = normalizeBranchId(novelId, rawBranchId)
    const branch = findStoryBranch(branchId)
    if (!branch || branch.novelId !== novelId) {
      return NextResponse.json({ ok: false, error: 'branchId does not belong to the requested novel' }, { status: 404 })
    }

    const payload = loadStoryTimeline(novelId, branchId)
    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load story timeline' },
      { status: 500 }
    )
  }
}
