import { after, NextResponse } from 'next/server'
import {
  abortAuthoritativeKnowledgeRebuild,
  buildKnowledgeProjection,
  deleteAuthoritativeKnowledgeGraph,
  deleteAuthoritativeHanlpCache,
  type KnowledgeViewActionPayload,
  type KnowledgeViewPayload,
  pauseAuthoritativeKnowledgeRebuild,
  rebuildAuthoritativeKnowledgeView,
  runAuthoritativeKnowledgeViewRebuild,
} from '@/lib/server/knowledge-view'

export const maxDuration = 3600

function buildSuccessResponse(projection: KnowledgeViewPayload | KnowledgeViewActionPayload) {
  return NextResponse.json({ ok: true, ...projection })
}

function scheduleAfterResponse(callback: () => Promise<void>) {
  try {
    after(callback)
  } catch (error) {
    if (error instanceof Error && error.message.includes('outside a request scope')) {
      return
    }

    console.warn('Falling back to timer-based knowledge rebuild scheduling', error)
    setTimeout(() => {
      void callback()
    }, 0)
  }
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
        : action === 'delete-hanlp-cache'
          ? await deleteAuthoritativeHanlpCache(novelId)
        : action === 'delete-knowledge'
          ? await deleteAuthoritativeKnowledgeGraph(novelId)
          : await rebuildAuthoritativeKnowledgeView(novelId)

    if (
      action === 'rebuild'
      && (projection.jobOutcome === 'queued' || projection.jobOutcome === 'running')
      && projection.knowledgeRebuildStatus?.jobId
    ) {
      const jobId = projection.knowledgeRebuildStatus.jobId
      scheduleAfterResponse(async () => {
        try {
          await runAuthoritativeKnowledgeViewRebuild(novelId, jobId)
        } catch (error) {
          console.error('Knowledge rebuild background worker failed', error)
        }
      })
    }

    return buildSuccessResponse(projection)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to rebuild knowledge view' },
      { status: 500 }
    )
  }
}
