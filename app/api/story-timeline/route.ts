import { NextResponse } from 'next/server'
import { readJsonObject, apiRequestErrorResponse, noStoreJson } from '@/lib/server/api-route'
import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import { findStoryBranch, normalizeBranchId } from '@/lib/server/knowledge-store'
import { abortRecoverableRewriteJobsForDeletedTimelineNode } from '@/lib/server/recoverable-rewrite-jobs'
import { deleteStoryTimelineNode, findStoryTimelineNodeById, loadStoryTimeline } from '@/lib/server/story-timeline-store'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const novelId = searchParams.get('novelId')?.trim() ?? ''
    const rawBranchId = searchParams.get('branchId')?.trim() ?? ''

    if (!novelId) {
      return noStoreJson({ ok: false, error: 'novelId is required' }, { status: 400 })
    }
    if (!rawBranchId) {
      return noStoreJson({ ok: false, error: 'branchId is required' }, { status: 400 })
    }

    const branchId = normalizeBranchId(novelId, rawBranchId)
    const db = createNovelDatabaseAccess(novelId)
    const branch = findStoryBranch(branchId, db)
    if (!branch || branch.novelId !== novelId) {
      return noStoreJson({ ok: false, error: 'branchId does not belong to the requested novel' }, { status: 404 })
    }

    const payload = loadStoryTimeline(novelId, branchId, db)
    return noStoreJson(payload)
  } catch (error) {
    const requestError = apiRequestErrorResponse(error)
    if (requestError) return requestError
    return noStoreJson(
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

    const body = await readJsonObject(request)
    const nodeId = typeof body.nodeId === 'string' ? body.nodeId.trim() : ''
    if (!nodeId) {
      return NextResponse.json({ ok: false, error: 'nodeId is required' }, { status: 400 })
    }

    const branchId = normalizeBranchId(novelId, rawBranchId)
    const db = createNovelDatabaseAccess(novelId)
    const branch = findStoryBranch(branchId, db)
    if (!branch || branch.novelId !== novelId) {
      return NextResponse.json({ ok: false, error: 'branchId does not belong to the requested novel' }, { status: 404 })
    }

    const node = findStoryTimelineNodeById(nodeId, db)
    if (!node || node.novelId !== novelId || node.branchId !== branchId) {
      return NextResponse.json({ ok: false, error: 'Story timeline node not found for the requested branch context' }, { status: 404 })
    }

    abortRecoverableRewriteJobsForDeletedTimelineNode({
      novelId,
      branchId,
      nodeId,
      continueBlockId: node.continueBlockId,
      db,
    })
    deleteStoryTimelineNode(nodeId, db)
    return NextResponse.json({ ok: true, nodeId })
  } catch (error) {
    const requestError = apiRequestErrorResponse(error)
    if (requestError) return requestError
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to delete story timeline node' },
      { status: 500 }
    )
  }
}
