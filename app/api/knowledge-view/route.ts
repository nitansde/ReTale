import { NextResponse } from 'next/server'
import { buildKnowledgeProjection, rebuildAuthoritativeKnowledgeView } from '@/lib/server/knowledge-view'

function buildSuccessResponse(projection: Awaited<ReturnType<typeof buildKnowledgeProjection>>) {
  return NextResponse.json({ ok: true, ...projection })
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const novelId = searchParams.get('novelId')?.trim()
    const projection = await buildKnowledgeProjection(novelId ? [novelId] : undefined)
    return buildSuccessResponse(projection)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load knowledge view' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const novelId = String(body.novelId ?? '').trim()
    if (!novelId) {
      return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
    }

    const projection = await rebuildAuthoritativeKnowledgeView(novelId)
    return buildSuccessResponse(projection)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to rebuild knowledge view' },
      { status: 500 }
    )
  }
}
