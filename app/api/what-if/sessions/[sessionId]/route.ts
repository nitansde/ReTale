import { NextResponse } from 'next/server'
import { findWhatIfSessionById } from '@/lib/server/what-if-store'

export async function GET(request: Request, ctx: RouteContext<'/api/what-if/sessions/[sessionId]'>) {
  try {
    const { sessionId } = await ctx.params
    const { searchParams } = new URL(request.url)
    const novelId = searchParams.get('novelId')?.trim() ?? ''
    const branchId = searchParams.get('branchId')?.trim() ?? ''

    if (!novelId) {
      return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
    }
    if (!branchId) {
      return NextResponse.json({ ok: false, error: 'branchId is required' }, { status: 400 })
    }

    const session = findWhatIfSessionById(sessionId)
    if (!session || session.novelId !== novelId || session.baseBranchId !== branchId) {
      return NextResponse.json({ ok: false, error: 'What-if session not found for the requested branch context' }, { status: 404 })
    }

    return NextResponse.json(session)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load what-if session' },
      { status: 500 }
    )
  }
}
