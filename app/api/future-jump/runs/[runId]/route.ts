import { NextResponse } from 'next/server'
import { jsonError, requireNonEmptyId } from '@/lib/server/api-route'
import { deleteFutureJumpRun, findFutureJumpRunById } from '@/lib/server/future-jump-store'
import { findWhatIfSessionById } from '@/lib/server/what-if-store'

export async function GET(request: Request, ctx: RouteContext<'/api/future-jump/runs/[runId]'>) {
  try {
    const { runId: rawRunId } = await ctx.params
    const runId = requireNonEmptyId(rawRunId, 'runId')
    const { searchParams } = new URL(request.url)
    const branchId = searchParams.get('branchId')?.trim() ?? ''

    if (!branchId) {
      return jsonError('branchId is required', 400)
    }

    const run = findFutureJumpRunById(runId)
    if (!run || run.baseBranchId !== branchId) {
      return NextResponse.json({ ok: false, error: 'Future jump run not found for the requested branch context' }, { status: 404 })
    }

    const session = findWhatIfSessionById(run.sessionId)
    if (!session || session.baseBranchId !== branchId) {
      return NextResponse.json({ ok: false, error: 'Future jump run is not accessible in the requested branch context' }, { status: 404 })
    }

    return NextResponse.json(run)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load future jump run'
    return jsonError(message, message.endsWith(' is required') ? 400 : 500)
  }
}

export async function DELETE(request: Request, ctx: RouteContext<'/api/future-jump/runs/[runId]'>) {
  try {
    const { runId: rawRunId } = await ctx.params
    const runId = requireNonEmptyId(rawRunId, 'runId')
    const { searchParams } = new URL(request.url)
    const branchId = searchParams.get('branchId')?.trim() ?? ''

    if (!branchId) {
      return jsonError('branchId is required', 400)
    }

    const run = findFutureJumpRunById(runId)
    if (!run || run.baseBranchId !== branchId) {
      return NextResponse.json({ ok: false, error: 'Future jump run not found for the requested branch context' }, { status: 404 })
    }

    const session = findWhatIfSessionById(run.sessionId)
    if (!session || session.baseBranchId !== branchId) {
      return NextResponse.json({ ok: false, error: 'Future jump run is not accessible in the requested branch context' }, { status: 404 })
    }

    await deleteFutureJumpRun(runId)
    return NextResponse.json({ ok: true, runId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete future jump run'
    return jsonError(message, message.endsWith(' is required') ? 400 : 500)
  }
}
