import { NextResponse } from 'next/server'
import { jsonError, readJsonObject } from '@/lib/server/api-route'
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
} from '@/lib/server/knowledge-view'
import { getMainBranchId } from '@/lib/server/knowledge-store'
import { scheduleKnowledgeWorkerProcess } from '@/lib/server/knowledge-worker-scheduler'
import type { KnowledgeRebuildChapterRange } from '@/lib/types'

export const maxDuration = 3600
const KNOWLEDGE_VIEW_ACTIONS = new Set([
  'rebuild',
  'pause',
  'abort',
  'delete-hanlp-cache',
  'delete-extraction-cache',
  'delete-embedding-cache',
  'delete-knowledge',
  'rebuild-retrieval-index',
])

function buildSuccessResponse(projection: KnowledgeViewPayload | KnowledgeViewActionPayload) {
  return NextResponse.json({ ok: true, ...projection })
}

function scheduleQueuedKnowledgeJobs(novelId: string, projection: KnowledgeViewPayload | KnowledgeViewActionPayload) {
  const branchId = getMainBranchId(novelId)
  const activeJobs = [
    projection.knowledgeRebuildStatus,
    projection.knowledgeStatusOverview?.retrievalIndex.task,
  ].filter((job): job is NonNullable<typeof projection.knowledgeRebuildStatus> => Boolean(job?.jobId))

  for (const job of activeJobs) {
    if (job.status !== 'queued' || (job.jobType !== 'extract_chapter_knowledge' && job.jobType !== 'rebuild_retrieval_index')) {
      continue
    }

    scheduleKnowledgeWorkerProcess({
      novelId,
      branchId,
      jobId: job.jobId,
      jobType: job.jobType,
    })
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
    const statusOnly = searchParams.get('statusOnly') === '1'
    const projection = await buildKnowledgeProjection(
      novelId ? [novelId] : undefined,
      Number.isFinite(asOfChapter) && asOfChapter >= 1 ? asOfChapter : undefined,
      statusOnly ? { includeProjection: false, knowledgeStatusOverviewMode: 'lightweight' } : undefined
    )
    if (novelId) {
      scheduleQueuedKnowledgeJobs(novelId, projection)
    }
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
    const body = await readJsonObject(request)
    const novelId = String(body.novelId ?? '').trim()
    const action = String(body.action ?? 'rebuild').trim()
    const chapterRange = normalizePostChapterRange(body.chapterRange)
    if (!novelId) {
      return jsonError('novelId is required', 400)
    }
    if (!KNOWLEDGE_VIEW_ACTIONS.has(action)) {
      return jsonError('action is invalid', 400)
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
    const scheduledJobType = action === 'rebuild-retrieval-index'
      ? 'rebuild_retrieval_index'
      : 'extract_chapter_knowledge'

    if (
      (action === 'rebuild' || action === 'rebuild-retrieval-index')
      && (projection.jobOutcome === 'queued' || projection.jobOutcome === 'running')
      && scheduledJobId
    ) {
      scheduleKnowledgeWorkerProcess({
        novelId,
        branchId: getMainBranchId(novelId),
        jobId: scheduledJobId,
        jobType: scheduledJobType,
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
