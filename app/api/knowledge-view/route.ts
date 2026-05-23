import { after, NextResponse } from 'next/server'
import {
  abortAuthoritativeKnowledgeRebuild,
  buildKnowledgeProjection,
  deleteAuthoritativeEmbeddingCache,
  deleteAuthoritativeExtractionCache,
  deleteAuthoritativeKnowledgeGraph,
  deleteAuthoritativeHanlpCache,
  type KnowledgeViewActionPayload,
  type KnowledgeViewPayload,
  pauseAuthoritativeKnowledgeRebuild,
  rebuildAuthoritativeRetrievalIndex,
  rebuildAuthoritativeKnowledgeView,
  runAuthoritativeRetrievalIndexRebuild,
  runAuthoritativeKnowledgeViewRebuild,
} from '@/lib/server/knowledge-view'
import type { KnowledgeRebuildChapterRange } from '@/lib/types'

export const maxDuration = 3600

function buildSuccessResponse(projection: KnowledgeViewPayload | KnowledgeViewActionPayload) {
  return NextResponse.json({ ok: true, ...projection })
}

function scheduleAfterResponse(callback: () => Promise<void>) {
  if (process.env.NODE_ENV === 'test') {
    void callback
    return
  }

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

function normalizePostChapterRange(value: unknown): KnowledgeRebuildChapterRange | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as KnowledgeRebuildChapterRange
  const startChapter = typeof candidate.startChapter === 'number' && Number.isFinite(candidate.startChapter)
    ? Math.max(1, Math.floor(candidate.startChapter))
    : undefined
  const endChapter = typeof candidate.endChapter === 'number' && Number.isFinite(candidate.endChapter)
    ? Math.max(1, Math.floor(candidate.endChapter))
    : undefined
  if (startChapter === undefined && endChapter === undefined) return undefined
  if (startChapter !== undefined && endChapter !== undefined && startChapter > endChapter) {
    return { startChapter: endChapter, endChapter: startChapter }
  }
  return {
    ...(startChapter !== undefined ? { startChapter } : {}),
    ...(endChapter !== undefined ? { endChapter } : {}),
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
    const chapterRange = normalizePostChapterRange(body.chapterRange)
    if (!novelId) {
      return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
    }

    const projection = action === 'pause'
      ? await pauseAuthoritativeKnowledgeRebuild(novelId)
      : action === 'abort'
        ? await abortAuthoritativeKnowledgeRebuild(novelId)
        : action === 'delete-hanlp-cache'
          ? await deleteAuthoritativeHanlpCache(novelId)
        : action === 'delete-extraction-cache'
          ? await deleteAuthoritativeExtractionCache(novelId)
        : action === 'delete-embedding-cache'
          ? await deleteAuthoritativeEmbeddingCache(novelId)
        : action === 'delete-knowledge'
          ? await deleteAuthoritativeKnowledgeGraph(novelId)
          : action === 'rebuild-retrieval-index'
            ? await rebuildAuthoritativeRetrievalIndex(novelId, chapterRange)
          : await rebuildAuthoritativeKnowledgeView(novelId, chapterRange)

    const scheduledJobId = action === 'rebuild-retrieval-index'
      ? projection.knowledgeStatusOverview?.retrievalIndex.task?.jobId
      : projection.knowledgeRebuildStatus?.jobId

    if (
      (action === 'rebuild' || action === 'rebuild-retrieval-index')
      && (projection.jobOutcome === 'queued' || projection.jobOutcome === 'running')
      && scheduledJobId
    ) {
      const jobId = scheduledJobId
      scheduleAfterResponse(async () => {
        try {
          if (action === 'rebuild-retrieval-index') {
            await runAuthoritativeRetrievalIndexRebuild(novelId, jobId)
            return
          }

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
