import { NextResponse } from 'next/server'
import { findStoryBranch, normalizeBranchId } from '@/lib/server/knowledge-store'
import { abortRecoverableRewriteJobsForDeletedTimelineNode } from '@/lib/server/recoverable-rewrite-jobs'
import { deleteStoryTimelineNode, findStoryTimelineNodeById, loadStoryTimeline } from '@/lib/server/story-timeline-store'

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

export async function DELETE(request: Request) {
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

    const body = await request.json() as { nodeId?: unknown }
    const nodeId = typeof body.nodeId === 'string' ? body.nodeId.trim() : ''
    if (!nodeId) {
      return NextResponse.json({ ok: false, error: 'nodeId is required' }, { status: 400 })
    }

    const branchId = normalizeBranchId(novelId, rawBranchId)
    const branch = findStoryBranch(branchId)
    if (!branch || branch.novelId !== novelId) {
      return NextResponse.json({ ok: false, error: 'branchId does not belong to the requested novel' }, { status: 404 })
    }

    const node = findStoryTimelineNodeById(nodeId)
    if (!node || node.novelId !== novelId || node.branchId !== branchId) {
      return NextResponse.json({ ok: false, error: 'Story timeline node not found for the requested branch context' }, { status: 404 })
    }

    abortRecoverableRewriteJobsForDeletedTimelineNode({
      novelId,
      branchId,
      nodeId,
      continueBlockId: node.continueBlockId,
    })
    deleteStoryTimelineNode(nodeId)
    return NextResponse.json({ ok: true, nodeId })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to delete story timeline node' },
      { status: 500 }
    )
  }
}
