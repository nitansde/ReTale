import { NextResponse } from 'next/server'
import { noStoreJson } from '@/lib/server/api-route'
import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import { findStoryBranch, normalizeBranchId } from '@/lib/server/knowledge-store'
import { deleteWhatIfSession, findWhatIfSessionById } from '@/lib/server/what-if-store'

export async function GET(request: Request, ctx: RouteContext<'/api/what-if/sessions/[sessionId]'>) {
  try {
    const { sessionId } = await ctx.params
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

    const session = findWhatIfSessionById(sessionId, db)
    if (!session || session.novelId !== novelId || session.baseBranchId !== branchId) {
      return noStoreJson({ ok: false, error: 'What-if session not found for the requested branch context' }, { status: 404 })
    }

    return noStoreJson(session)
  } catch (error) {
    return noStoreJson(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load what-if session' },
      { status: error instanceof Error && error.message.includes('Invalid novel ID') ? 400 : 500 }
    )
  }
}

export async function DELETE(request: Request, ctx: RouteContext<'/api/what-if/sessions/[sessionId]'>) {
  try {
    const { sessionId } = await ctx.params
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
    const db = createNovelDatabaseAccess(novelId)
    const branch = findStoryBranch(branchId, db)
    if (!branch || branch.novelId !== novelId) {
      return NextResponse.json({ ok: false, error: 'branchId does not belong to the requested novel' }, { status: 404 })
    }

    const session = findWhatIfSessionById(sessionId, db)
    if (!session || session.novelId !== novelId || session.baseBranchId !== branchId) {
      return NextResponse.json({ ok: false, error: 'What-if session not found for the requested branch context' }, { status: 404 })
    }

    await deleteWhatIfSession(sessionId, db)
    return NextResponse.json({ ok: true, sessionId })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to delete what-if session' },
      { status: error instanceof Error && error.message.includes('Invalid novel ID') ? 400 : 500 }
    )
  }
}
