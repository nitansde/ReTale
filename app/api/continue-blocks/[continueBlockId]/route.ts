import { NextResponse } from 'next/server'
import { findContinueBlockById } from '@/lib/server/continue-block-store'

export async function GET(request: Request, ctx: RouteContext<'/api/continue-blocks/[continueBlockId]'>) {
  try {
    const { continueBlockId } = await ctx.params
    const { searchParams } = new URL(request.url)
    const novelId = searchParams.get('novelId')?.trim() ?? ''
    const branchId = searchParams.get('branchId')?.trim() ?? ''

    if (!novelId) {
      return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
    }
    if (!branchId) {
      return NextResponse.json({ ok: false, error: 'branchId is required' }, { status: 400 })
    }

    const detail = findContinueBlockById(continueBlockId)
    if (!detail || detail.novelId !== novelId || detail.branchId !== branchId) {
      return NextResponse.json({ ok: false, error: 'Continue block not found for the requested branch context' }, { status: 404 })
    }

    return NextResponse.json(detail)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load continue block detail' },
      { status: 500 }
    )
  }
}
