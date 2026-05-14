import { NextResponse } from 'next/server'
import {
  abortAuthoritativeKnowledgeRebuild,
  buildKnowledgeProjection,
  deleteAuthoritativeKnowledgeGraph,
  type KnowledgeViewActionPayload,
  type KnowledgeViewPayload,
  pauseAuthoritativeKnowledgeRebuild,
  rebuildAuthoritativeKnowledgeView,
} from '@/lib/server/knowledge-view'

function buildSuccessResponse(projection: KnowledgeViewPayload | KnowledgeViewActionPayload) {
  return NextResponse.json({ ok: true, ...projection })
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const novelId = searchParams.get('novelId')?.trim()
    const asOfChapter = Number(searchParams.get('asOfChapter'))
    const projection = await buildKnowledgeProjection(
      novelId ? [novelId] : undefined,
      Number.isFinite(asOfChapter) && asOfChapter >= 1 ? asOfChapter : undefined
    )
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
    const action = String(body.action ?? 'rebuild').trim()
    if (!novelId) {
      return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
    }

    const projection = action === 'pause'
      ? await pauseAuthoritativeKnowledgeRebuild(novelId)
      : action === 'abort'
        ? await abortAuthoritativeKnowledgeRebuild(novelId)
        : action === 'delete-knowledge'
          ? await deleteAuthoritativeKnowledgeGraph(novelId)
          : await rebuildAuthoritativeKnowledgeView(novelId)

    return buildSuccessResponse(projection)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to rebuild knowledge view' },
      { status: 500 }
    )
  }
}
