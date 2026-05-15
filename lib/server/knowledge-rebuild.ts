import type { AIProvider, Chapter, KnowledgeExtractionScenarioSettings, PersistedNovelState } from '@/lib/types'
import {
  buildCharacterDescriptionDelta,
  hasCharacterRoleCardProfile,
  type ChapterKnowledgeExtraction,
} from '@/lib/story-knowledge'
import { extractChapterKnowledgeOffline } from '@/lib/server/knowledge-extraction'
import { loadStoredAISettings } from '@/lib/server/ai-settings'
import { INF_CHAPTER } from '@/lib/server/chapter-interval'
import { buildKnowledgeExtractionStoryState } from '@/lib/server/context-builder'
import {
  buildTextSpansFromLines,
  enqueueKnowledgeJob,
  getMainBranchId,
  hashContent,
  markKnowledgeStaleFromChapter,
  splitChapterLines,
} from '@/lib/server/knowledge-store'
import {
  deleteBranchRetrievalIndex,
  precomputeRawTextEmbeddingCache,
  rebuildBranchRetrievalIndex,
  type RawTextEmbeddingPrecomputeResult,
  type RetrievalIndexBuildProgress,
} from '@/lib/server/retrieval-index'
import { execute, queryAll, queryOne, type SqlParam, withTransaction } from '@/lib/server/sqlite'
import { htmlToPlainText, plainTextToHtml, uid } from '@/lib/utils'
import { bootstrapOutlineNodesForFutureMap } from '@/lib/server/outline-bootstrap'

type PersistImportedNovelParams = {
  novelId: string
  title: string
  chapters: Chapter[]
  author?: string | null
  sourceType?: string
}

type KnowledgeChapterRow = {
  id: string
  novelId: string
  branchId: string
  chapterNo: number
  title: string | null
  rawText: string
  summary: string | null
  revision: number
  isDirty: number
  dirtyReason: string | null
  sourceHash: string
  knowledgeStatus: string
}

type KnowledgeRebuildPayloadChapter = {
  chapterId: string
  chapterNo: number
}

type ChapterExtractionCandidateStatus = 'queued' | 'extracting' | 'extracted' | 'resolving' | 'persisted' | 'failed' | 'stale'

type ChapterExtractionCandidateRow = {
  id: string
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  chapterRevision: number | null
  chapterSourceHash: string
  extractionJson: string
  status: ChapterExtractionCandidateStatus
  provider: string | null
  model: string | null
  errorMessage: string | null
}

type ChapterExtractionCandidate = {
  id: string
  chapterId: string
  chapterNo: number
  chapterRevision: number | null
  chapterSourceHash: string
  extractionJson: string
  status: ChapterExtractionCandidateStatus
  provider: string | null
  model: string | null
  errorMessage: string | null
}

type ResolvedChapterKnowledge = {
  extraction: ChapterKnowledgeExtraction
}

type KnowledgeRebuildStepKey = 'extract' | 'cleanup' | 'write' | 'index'

type KnowledgeRebuildStepStatus = 'pending' | 'running' | 'paused' | 'completed'

export type KnowledgeRebuildPayloadStep = {
  key: KnowledgeRebuildStepKey
  label: string
  status: KnowledgeRebuildStepStatus
  progress: number
  etaMinutes: number | null
  detail: string | null
}

type KnowledgeRebuildIndexProgress = RetrievalIndexBuildProgress

type KnowledgeRebuildEmbeddingSettingsSnapshot = {
  provider: AIProvider
  model: string
  embeddingBatchSize: number
}

type KnowledgeRebuildTelemetryUpdate = {
  rawTextEmbeddingProgress?: number
  rawTextEmbeddingCacheHitRate?: number
  stageTimingsMs?: Record<string, number>
}

type KnowledgeRebuildJobPayload = {
  branchId: string
  rebuildStartChapter?: number
  phase?: KnowledgeRebuildStepKey
  inlineCleanupCompleted?: boolean
  currentChapterId?: string | null
  pendingChapterIds?: string[]
  chapterWeightsById?: Record<string, number>
  totalChapterWeight?: number
  processedChapterWeight?: number
  extractedChapters?: KnowledgeRebuildPayloadChapter[]
  totalChapterCount?: number
  extractionSettings?: KnowledgeExtractionScenarioSettings
  rawTextEmbeddingProgress?: number
  rawTextEmbeddingCacheHitRate?: number
  stageTimingsMs?: Record<string, number>
  embeddingSettingsSnapshot?: KnowledgeRebuildEmbeddingSettingsSnapshot
  indexProgress?: KnowledgeRebuildIndexProgress
  stageStartedAtByKey?: Partial<Record<KnowledgeRebuildStepKey, string>>
  steps?: KnowledgeRebuildPayloadStep[]
}

type KnowledgeRebuildJobState = {
  payload: KnowledgeRebuildJobPayload
  pendingChapterIds: string[]
  chapterWeightsById: Record<string, number>
  totalChapterWeight: number
  processedChapterWeight: number
  extractedChapters: KnowledgeRebuildPayloadChapter[]
  phase: KnowledgeRebuildJobPayload['phase']
}

type RawTextEmbeddingPrecomputeRun = {
  promise: Promise<RawTextEmbeddingPrecomputeResult>
}

const KNOWLEDGE_REBUILD_STEP_ORDER: KnowledgeRebuildStepKey[] = ['extract', 'cleanup', 'write', 'index']

const RAW_TEXT_PRECOMPUTE_STAGE_KEY = 'raw_text_precompute'
const rawTextEmbeddingPrecomputeRuns = new Map<string, RawTextEmbeddingPrecomputeRun>()

const KNOWLEDGE_REBUILD_STEP_LABELS: Record<KnowledgeRebuildStepKey, string> = {
  extract: '抽取章节知识',
  cleanup: '清理旧知识',
  write: '写入结构化知识',
  index: '构建 Lance 检索索引',
}

export type KnowledgeRebuildJobOutcome = 'completed' | 'paused' | 'aborted'

class KnowledgeRebuildPausedError extends Error {
  constructor() {
    super('Knowledge rebuild paused')
  }
}

class KnowledgeRebuildAbortedError extends Error {
  constructor() {
    super('Knowledge rebuild aborted')
  }
}

function toChapterLike(params: { chapterId: string; novelId: string; title: string; chapterNo: number; rawText: string }): Chapter {
  return {
    id: params.chapterId,
    novelId: params.novelId,
    volumeId: 'volume-imported',
    title: params.title,
    order: params.chapterNo,
    content: plainTextToHtml(params.rawText),
    originalContent: plainTextToHtml(params.rawText),
    status: 'draft',
    wordCount: params.rawText.length,
    updatedAt: '刚刚',
  }
}

function chooseConciseKnowledgeText(existing: string | null | undefined, incoming: string | null | undefined) {
  const left = (existing ?? '').trim()
  const right = (incoming ?? '').trim()
  if (!left) return right
  if (!right) return left
  if (left === right) return left
  if (left.includes(right)) return right
  if (right.includes(left)) return left
  return left.length <= right.length ? left : right
}

function findEvidenceSpanId(chapterId: string, lineStart: number, lineEnd: number) {
  return (
    queryOne<{ id: string }>(
      `
        SELECT id
        FROM TextSpan
        WHERE chapterId = ? AND spanType = 'evidence' AND lineStart <= ? AND lineEnd >= ?
        LIMIT 1
      `,
      chapterId,
      lineStart,
      lineEnd
    )?.id ?? null
  )
}

function updateKnowledgeJob(
  jobId: string,
  fields: {
    status?: string
    currentStep?: string | null
    progress?: number
    payload?: unknown
    errorMessage?: string | null
  }
) {
  let nextPayloadJson: string | null | undefined
  if (fields.status !== undefined || fields.currentStep !== undefined || fields.progress !== undefined || fields.payload !== undefined) {
    const currentRow = queryOne<{ status: string; currentStep: string | null; progress: number; payloadJson: string | null }>(
      'SELECT status, currentStep, progress, payloadJson FROM KnowledgeJob WHERE id = ?',
      jobId
    )
    const basePayload = fields.payload === undefined
      ? parseKnowledgeRebuildJobPayload(currentRow?.payloadJson ?? null)
      : normalizeKnowledgeRebuildJobPayload(fields.payload)

    if (basePayload) {
      nextPayloadJson = JSON.stringify(syncKnowledgeRebuildPayload(basePayload, {
        status: fields.status ?? currentRow?.status ?? 'queued',
        currentStep: fields.currentStep ?? currentRow?.currentStep ?? null,
        progress: fields.progress ?? currentRow?.progress ?? 0,
      }))
    } else if (fields.payload === null) {
      nextPayloadJson = null
    }
  }

  const entries = Object.entries(fields).flatMap<[string, SqlParam]>(([key, value]) => {
    if (value === undefined) return []
    if (key === 'payload') return nextPayloadJson === undefined ? [] : [['payloadJson', nextPayloadJson]]
    return [[key, value as SqlParam]]
  })
  if (fields.payload === undefined && nextPayloadJson !== undefined) {
    entries.push(['payloadJson', nextPayloadJson])
  }
  if (!entries.length) return
  execute(
    `UPDATE KnowledgeJob SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
    ...entries.map(([, value]) => value ?? null),
    jobId
  )
}

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function normalizeKnowledgeRebuildJobPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object' || typeof (payload as { branchId?: unknown }).branchId !== 'string') {
    return null
  }

  const candidate = payload as KnowledgeRebuildJobPayload & {
    stageStartedAtByKey?: Partial<Record<KnowledgeRebuildStepKey, string>>
  }
  const rawPhase = (payload as { phase?: unknown }).phase
  const normalizedPhase: KnowledgeRebuildJobPayload['phase'] = rawPhase === 'extract' || rawPhase === 'cleanup' || rawPhase === 'write' || rawPhase === 'index'
      ? rawPhase
      : undefined

  const embeddingSettingsSnapshot = candidate.embeddingSettingsSnapshot
  const normalizedSnapshot =
    embeddingSettingsSnapshot
    && typeof embeddingSettingsSnapshot.provider === 'string'
    && typeof embeddingSettingsSnapshot.model === 'string'
    && typeof embeddingSettingsSnapshot.embeddingBatchSize === 'number'
      ? {
          provider: embeddingSettingsSnapshot.provider,
          model: embeddingSettingsSnapshot.model,
          embeddingBatchSize: Math.max(1, Math.floor(embeddingSettingsSnapshot.embeddingBatchSize)),
        }
      : undefined

  return {
    ...candidate,
    phase: normalizedPhase,
    rawTextEmbeddingProgress: typeof candidate.rawTextEmbeddingProgress === 'number'
      ? clampProgress(candidate.rawTextEmbeddingProgress)
      : undefined,
    rawTextEmbeddingCacheHitRate: typeof candidate.rawTextEmbeddingCacheHitRate === 'number'
      ? clampProgress(candidate.rawTextEmbeddingCacheHitRate)
      : undefined,
    stageTimingsMs: {
      ...((candidate.stageTimingsMs && typeof candidate.stageTimingsMs === 'object') ? candidate.stageTimingsMs : {}),
    },
    embeddingSettingsSnapshot: normalizedSnapshot,
    stageStartedAtByKey: { ...(candidate.stageStartedAtByKey ?? {}) },
  }
}

function parseStageStartedAt(value: string | undefined) {
  if (!value) return Number.NaN
  return Date.parse(value)
}

function estimateStageEtaMinutes(progress: number, stageStartedAt: string | undefined) {
  if (progress <= 0.02 || progress >= 0.999) return null

  const startedAt = parseStageStartedAt(stageStartedAt)
  if (!Number.isFinite(startedAt)) return null

  const elapsedMs = Date.now() - startedAt
  if (elapsedMs <= 0) return null

  const estimatedTotalMs = elapsedMs / progress
  const remainingMs = Math.max(0, estimatedTotalMs - elapsedMs)
  return Math.max(1, Math.ceil(remainingMs / 60000))
}

function getKnowledgeExtractionSettingsSnapshot(payload: KnowledgeRebuildJobPayload) {
  void payload
  return loadStoredAISettings().knowledgeExtraction
}

function buildEmbeddingSettingsSnapshot(): KnowledgeRebuildEmbeddingSettingsSnapshot {
  const { embeddings } = loadStoredAISettings()
  return {
    provider: embeddings.provider,
    model: embeddings.provider === 'openai-compatible' ? embeddings.openAICompatible.model : embeddings.ollama.model,
    embeddingBatchSize: Math.max(1, Math.floor(embeddings.embeddingBatchSize || 1)),
  }
}

function getOrCreateEmbeddingSettingsSnapshot(payload: KnowledgeRebuildJobPayload) {
  return payload.embeddingSettingsSnapshot ?? buildEmbeddingSettingsSnapshot()
}

function isKnowledgeJobActivelyRunning(jobId: string) {
  const status = getKnowledgeJobRow(jobId)?.status
  return status === 'queued' || status === 'running'
}

function buildRawTextEmbeddingTelemetryUpdate(result: RawTextEmbeddingPrecomputeResult): KnowledgeRebuildTelemetryUpdate {
  const hasDocs = result.totalDocs > 0
  return {
    rawTextEmbeddingProgress: hasDocs ? result.completedDocs / result.totalDocs : 1,
    rawTextEmbeddingCacheHitRate: hasDocs ? result.cacheHits / result.totalDocs : 1,
    stageTimingsMs: {
      [RAW_TEXT_PRECOMPUTE_STAGE_KEY]: result.durationMs,
    },
  }
}

function ensureRawTextEmbeddingPrecomputeStarted(params: {
  jobId: string
  novelId: string
  branchId: string
  embeddingSettingsSnapshot: KnowledgeRebuildEmbeddingSettingsSnapshot
}) {
  const activeRun = rawTextEmbeddingPrecomputeRuns.get(params.jobId)
  if (activeRun) {
    return activeRun.promise
  }

  const startedAt = Date.now()
  const promise = precomputeRawTextEmbeddingCache({
    novelId: params.novelId,
    branchId: params.branchId,
    settingsSnapshot: params.embeddingSettingsSnapshot,
    maxConcurrentBatches: 2,
    shouldContinue: () => isKnowledgeJobActivelyRunning(params.jobId),
    onProgress: async (progress) => {
      updateKnowledgeRebuildJobTelemetry(params.jobId, {
        rawTextEmbeddingProgress: progress.totalDocs > 0 ? progress.completedDocs / progress.totalDocs : 1,
        rawTextEmbeddingCacheHitRate: progress.totalDocs > 0 ? progress.cacheHits / progress.totalDocs : 1,
      })
    },
  }).catch(() => ({
    totalDocs: 0,
    completedDocs: 0,
    cacheHits: 0,
    cacheMisses: 0,
    failedDocs: 0,
    totalBatches: 0,
    completedBatches: 0,
    degraded: true,
    cancelled: false,
    durationMs: Date.now() - startedAt,
  })).then((result) => {
    updateKnowledgeRebuildJobTelemetry(params.jobId, buildRawTextEmbeddingTelemetryUpdate(result))
    return result
  }).finally(() => {
    rawTextEmbeddingPrecomputeRuns.delete(params.jobId)
  })

  rawTextEmbeddingPrecomputeRuns.set(params.jobId, { promise })
  return promise
}

async function waitForRawTextEmbeddingPrecompute(jobId: string) {
  const run = rawTextEmbeddingPrecomputeRuns.get(jobId)
  return run ? run.promise : null
}

function getKnowledgeExtractionParallelism(settings: KnowledgeExtractionScenarioSettings) {
  const configuredParallelism = settings.provider === 'openai-compatible'
    ? settings.openAICompatible.parallelism
    : settings.ollama.parallelism

  return Math.max(1, configuredParallelism)
}

function getIndexProgressValue(progress?: KnowledgeRebuildIndexProgress) {
  if (!progress) return 0

  switch (progress.phase) {
    case 'loading':
      return 0.04
    case 'embedding': {
      const totalBatches = Math.max(1, progress.totalBatches)
      return 0.08 + clampProgress(progress.completedBatches / totalBatches) * 0.62
    }
    case 'creating_table':
      return 0.76
    case 'building_text_index':
      return 0.88
    case 'building_vector_index':
      return 0.96
    case 'completed':
      return 1
    default:
      return 0
  }
}

function getIndexCurrentStep(progress?: KnowledgeRebuildIndexProgress) {
  if (!progress) return '构建 Lance 检索索引'

  switch (progress.phase) {
    case 'loading':
      return '整理 Lance 检索文档'
    case 'embedding':
      return `生成检索向量（${progress.completedBatches}/${Math.max(progress.totalBatches, 1)} 批）`
    case 'creating_table':
      return '写入 Lance 检索表'
    case 'building_text_index':
      return '构建 Lance 全文索引'
    case 'building_vector_index':
      return '构建 Lance 向量索引'
    case 'completed':
      return '构建 Lance 检索索引'
    default:
      return '构建 Lance 检索索引'
  }
}

function buildKnowledgeRebuildSteps(payload: KnowledgeRebuildJobPayload, runtime: {
  status: string
  currentStep: string | null
  progress: number
}): KnowledgeRebuildPayloadStep[] {
  const phase = payload.phase ?? 'extract'
  const totalChapterWeight = Math.max(0, payload.totalChapterWeight ?? 0)
  const processedChapterWeight = Math.max(0, payload.processedChapterWeight ?? 0)
  const extractedChapters = Array.isArray(payload.extractedChapters) ? payload.extractedChapters : []
  const totalChapterCount = Math.max(
    0,
    payload.totalChapterCount
      ?? ((payload.pendingChapterIds?.length ?? 0) + extractedChapters.length)
  )
  const indexProgress = payload.indexProgress
  const stageStartedAtByKey = payload.stageStartedAtByKey ?? {}
  const currentPhaseIndex = KNOWLEDGE_REBUILD_STEP_ORDER.indexOf(phase)
  const currentPhaseOrder = currentPhaseIndex >= 0 ? currentPhaseIndex : 0
  const extractProgress = totalChapterWeight > 0
    ? clampProgress(processedChapterWeight / totalChapterWeight)
    : phase === 'extract'
      ? clampProgress(runtime.progress)
      : 0
  const writeCompletedCount = Math.max(0, totalChapterCount - extractedChapters.length)
  const writeProgress = totalChapterCount > 0
    ? clampProgress(writeCompletedCount / totalChapterCount)
    : phase === 'write'
      ? clampProgress(runtime.progress)
      : 0
  const indexStartedAt = stageStartedAtByKey.index
  const activeIndexProgress = getIndexProgressValue(indexProgress)
  const activeIndexEtaMinutes = runtime.status === 'paused'
    ? null
    : estimateStageEtaMinutes(activeIndexProgress, indexStartedAt)

  return KNOWLEDGE_REBUILD_STEP_ORDER.map((key, index) => {
    const isCurrent = index === currentPhaseOrder
    let status: KnowledgeRebuildStepStatus = 'pending'
    if (runtime.status === 'succeeded' || index < currentPhaseOrder) {
      status = 'completed'
    } else if (isCurrent) {
      status = runtime.status === 'paused' ? 'paused' : 'running'
    }

    let progress = 0
    let etaMinutes: number | null = null
    if (key === 'extract') {
      progress = status === 'completed' ? 1 : extractProgress
      etaMinutes = status === 'running' ? estimateStageEtaMinutes(progress, stageStartedAtByKey.extract) : null
    } else if (key === 'cleanup') {
      progress = status === 'completed' ? 1 : (phase === 'cleanup' ? 0.35 : 0)
    } else if (key === 'write') {
      progress = status === 'completed' ? 1 : writeProgress
      etaMinutes = status === 'running' ? estimateStageEtaMinutes(progress, stageStartedAtByKey.write) : null
    } else if (key === 'index') {
      progress = status === 'completed' ? 1 : (phase === 'index' ? activeIndexProgress : 0)
      etaMinutes = status === 'running' ? activeIndexEtaMinutes : null
    }

    return {
      key,
      label: KNOWLEDGE_REBUILD_STEP_LABELS[key],
      status,
      progress: clampProgress(progress),
      etaMinutes,
      detail: isCurrent ? runtime.currentStep : null,
    }
  })
}

function syncKnowledgeRebuildPayload(payload: KnowledgeRebuildJobPayload, runtime: {
  status: string
  currentStep: string | null
  progress: number
}) {
  const phase = payload.phase ?? 'extract'
  const stageStartedAtByKey = {
    ...(payload.stageStartedAtByKey ?? {}),
  }
  if (!stageStartedAtByKey[phase]) {
    stageStartedAtByKey[phase] = new Date().toISOString()
  }

  const syncedPayload: KnowledgeRebuildJobPayload = {
    ...payload,
    phase,
    totalChapterWeight: Math.max(0, payload.totalChapterWeight ?? 0),
    processedChapterWeight: Math.max(0, payload.processedChapterWeight ?? 0),
    totalChapterCount: Math.max(
      0,
      payload.totalChapterCount
        ?? ((payload.pendingChapterIds?.length ?? 0) + (payload.extractedChapters?.length ?? 0))
    ),
    stageStartedAtByKey,
  }
  syncedPayload.steps = buildKnowledgeRebuildSteps(syncedPayload, runtime)
  return syncedPayload
}

function getChapterProgressWeight(rawText: string | null) {
  const normalized = (rawText ?? '').trim()
  return Math.max(1, normalized.length)
}

function parseKnowledgeRebuildJobPayload(payloadJson: string | null) {
  if (!payloadJson) return null

  try {
    return normalizeKnowledgeRebuildJobPayload(JSON.parse(payloadJson))
  } catch {
    return null
  }
}

function getKnowledgeExtractionProgress(state: { processedChapterWeight: number; totalChapterWeight: number }) {
  if (state.totalChapterWeight <= 0 || state.processedChapterWeight >= state.totalChapterWeight) {
    return 0.8
  }

  return 0.1 + (state.processedChapterWeight / state.totalChapterWeight) * 0.7
}

function isKnowledgeRebuildControlError(error: unknown) {
  return error instanceof KnowledgeRebuildPausedError || error instanceof KnowledgeRebuildAbortedError
}

function getRebuildStartChapter(chapters: KnowledgeChapterRow[]) {
  const firstDirtyChapter = chapters.find((chapter) => chapter.isDirty || chapter.knowledgeStatus !== 'ready')
  return firstDirtyChapter?.chapterNo ?? chapters[0]?.chapterNo ?? 1
}

function getRebuildChapters(chapters: KnowledgeChapterRow[], rebuildStartChapter: number) {
  return chapters.filter((chapter) => chapter.chapterNo >= rebuildStartChapter)
}

function setWriteQueueInKnowledgeJob(jobId: string, chapters: Array<{ chapterId: string; chapterNo: number }>) {
  const state = getKnowledgeRebuildJobState(jobId)
  if (!state) return null

  const extractedChapters = chapters.map((chapter) => ({
    chapterId: chapter.chapterId,
    chapterNo: chapter.chapterNo,
  }))

  updateKnowledgeJob(jobId, {
    payload: {
      ...state.payload,
      phase: state.phase,
      pendingChapterIds: state.pendingChapterIds,
      chapterWeightsById: state.chapterWeightsById,
      totalChapterWeight: state.totalChapterWeight,
      processedChapterWeight: state.processedChapterWeight,
      extractedChapters,
    },
  })

  return {
    ...state,
    extractedChapters,
  }
}

function getKnowledgeRebuildJobState(jobId: string): KnowledgeRebuildJobState | null {
  const row = queryOne<{ payloadJson: string | null }>('SELECT payloadJson FROM KnowledgeJob WHERE id = ?', jobId)
  const payload = parseKnowledgeRebuildJobPayload(row?.payloadJson ?? null)
  if (!payload) {
    return null
  }

  return {
    payload,
    phase: payload.phase ?? 'extract',
    pendingChapterIds: Array.isArray(payload.pendingChapterIds) ? payload.pendingChapterIds : [],
    chapterWeightsById: payload.chapterWeightsById ?? {},
    totalChapterWeight: typeof payload.totalChapterWeight === 'number' ? Math.max(0, payload.totalChapterWeight) : 0,
    processedChapterWeight: typeof payload.processedChapterWeight === 'number' ? Math.max(0, payload.processedChapterWeight) : 0,
    extractedChapters: Array.isArray(payload.extractedChapters) ? payload.extractedChapters : [],
  }
}

function isKnowledgeRebuildJobStateInitialized(state: KnowledgeRebuildJobState | null) {
  if (!state) return false

  return state.pendingChapterIds.length > 0
    || Object.keys(state.chapterWeightsById).length > 0
    || state.totalChapterWeight > 0
    || state.processedChapterWeight > 0
    || state.extractedChapters.length > 0
    || state.phase !== 'extract'
}

function initializeKnowledgeRebuildJobState(jobId: string, payload: KnowledgeRebuildJobPayload) {
  const pendingChapterIds = payload.pendingChapterIds ?? []
  const chapterWeightsById = payload.chapterWeightsById ?? {}
  const totalChapterWeight =
    typeof payload.totalChapterWeight === 'number'
      ? Math.max(0, payload.totalChapterWeight)
      : pendingChapterIds.reduce((sum, chapterId) => sum + (chapterWeightsById[chapterId] ?? 0), 0)

  updateKnowledgeJob(jobId, {
    payload: {
      ...payload,
      phase: payload.phase ?? 'extract',
      pendingChapterIds,
      chapterWeightsById,
      totalChapterWeight,
      totalChapterCount: Math.max(0, payload.totalChapterCount ?? pendingChapterIds.length),
      currentChapterId: payload.currentChapterId ?? null,
      processedChapterWeight: Math.max(0, payload.processedChapterWeight ?? 0),
      extractedChapters: payload.extractedChapters ?? [],
      embeddingSettingsSnapshot: getOrCreateEmbeddingSettingsSnapshot(payload),
      stageStartedAtByKey: {
        ...(payload.stageStartedAtByKey ?? {}),
        [payload.phase ?? 'extract']: (payload.stageStartedAtByKey ?? {})[payload.phase ?? 'extract'] ?? new Date().toISOString(),
      },
    },
  })
}

export function mergeKnowledgeRebuildTelemetryPayloadForTesting(
  payload: KnowledgeRebuildJobPayload,
  telemetry: KnowledgeRebuildTelemetryUpdate
): KnowledgeRebuildJobPayload {
  return {
    ...payload,
    rawTextEmbeddingProgress: telemetry.rawTextEmbeddingProgress ?? payload.rawTextEmbeddingProgress,
    rawTextEmbeddingCacheHitRate: telemetry.rawTextEmbeddingCacheHitRate ?? payload.rawTextEmbeddingCacheHitRate,
    stageTimingsMs: {
      ...(payload.stageTimingsMs ?? {}),
      ...(telemetry.stageTimingsMs ?? {}),
    },
    embeddingSettingsSnapshot: getOrCreateEmbeddingSettingsSnapshot(payload),
  }
}

export function updateKnowledgeRebuildJobTelemetry(jobId: string, telemetry: KnowledgeRebuildTelemetryUpdate) {
  const row = queryOne<{ branchId: string | null; payloadJson: string | null }>(
    'SELECT branchId, payloadJson FROM KnowledgeJob WHERE id = ?',
    jobId
  )
  const parsedPayload = parseKnowledgeRebuildJobPayload(row?.payloadJson ?? null)
  const basePayload: KnowledgeRebuildJobPayload | null = parsedPayload ?? (typeof row?.branchId === 'string' ? { branchId: row.branchId } : null)
  if (!basePayload) return null

  const mergedPayload = mergeKnowledgeRebuildTelemetryPayloadForTesting(basePayload, telemetry)
  const pendingChapterIds = Array.isArray(basePayload.pendingChapterIds) ? basePayload.pendingChapterIds : []
  const chapterWeightsById = basePayload.chapterWeightsById ?? {}
  const extractedChapters = Array.isArray(basePayload.extractedChapters) ? basePayload.extractedChapters : []
  const phase = basePayload.phase ?? 'extract'
  const totalChapterWeight = typeof basePayload.totalChapterWeight === 'number'
    ? Math.max(0, basePayload.totalChapterWeight)
    : 0
  const processedChapterWeight = typeof basePayload.processedChapterWeight === 'number'
    ? Math.max(0, basePayload.processedChapterWeight)
    : 0

  updateKnowledgeJob(jobId, {
    payload: {
      ...mergedPayload,
      phase,
      currentChapterId: basePayload.currentChapterId ?? null,
      pendingChapterIds,
      chapterWeightsById,
      totalChapterWeight,
      processedChapterWeight,
      extractedChapters,
      totalChapterCount: basePayload.totalChapterCount ?? (pendingChapterIds.length + extractedChapters.length),
    },
  })

  return {
    phase,
    pendingChapterIds,
    chapterWeightsById,
    totalChapterWeight,
    processedChapterWeight,
    extractedChapters,
    payload: mergedPayload,
  }
}

function setKnowledgeRebuildJobIndexProgress(jobId: string, indexProgress: KnowledgeRebuildIndexProgress) {
  const state = getKnowledgeRebuildJobState(jobId)
  if (!state) {
    return null
  }

  const nextProgress = getIndexProgressValue(indexProgress)
  updateKnowledgeJob(jobId, {
    currentStep: getIndexCurrentStep(indexProgress),
    progress: 0.96 + nextProgress * 0.04,
    payload: {
      ...state.payload,
      phase: state.phase,
      currentChapterId: state.payload.currentChapterId ?? null,
      pendingChapterIds: state.pendingChapterIds,
      chapterWeightsById: state.chapterWeightsById,
      totalChapterWeight: state.totalChapterWeight,
      processedChapterWeight: state.processedChapterWeight,
      extractedChapters: state.extractedChapters,
      extractionSettings: state.payload.extractionSettings,
      rawTextEmbeddingProgress: state.payload.rawTextEmbeddingProgress,
      rawTextEmbeddingCacheHitRate: state.payload.rawTextEmbeddingCacheHitRate,
      stageTimingsMs: state.payload.stageTimingsMs,
      embeddingSettingsSnapshot: getOrCreateEmbeddingSettingsSnapshot(state.payload),
      indexProgress,
    },
  })

  return {
    ...state,
    payload: {
      ...state.payload,
      indexProgress,
    },
  }
}

function removePendingChaptersFromKnowledgeJob(jobId: string, chapterIds: string[]) {
  const state = getKnowledgeRebuildJobState(jobId)
  if (!state || !chapterIds.length) {
    return state
  }

  const removedIds = new Set(chapterIds.filter((chapterId) => chapterId !== state.payload.currentChapterId))
  if (!removedIds.size) {
    return state
  }

  let removedWeight = 0
  const pendingChapterIds = state.pendingChapterIds.filter((chapterId) => {
    if (!removedIds.has(chapterId)) return true
    removedWeight += state.chapterWeightsById[chapterId] ?? 0
    return false
  })

  if (pendingChapterIds.length === state.pendingChapterIds.length) {
    return state
  }

  const chapterWeightsById = { ...state.chapterWeightsById }
  for (const chapterId of chapterIds) {
    delete chapterWeightsById[chapterId]
  }
  const extractedChapters = state.extractedChapters.filter((chapter) => !removedIds.has(chapter.chapterId))

  const nextState: KnowledgeRebuildJobState = {
    ...state,
    pendingChapterIds,
    chapterWeightsById,
    totalChapterWeight: Math.max(0, state.totalChapterWeight - removedWeight),
    extractedChapters,
  }

  updateKnowledgeJob(jobId, {
    progress: getKnowledgeExtractionProgress(nextState),
    payload: {
      ...state.payload,
      phase: nextState.phase,
      pendingChapterIds: nextState.pendingChapterIds,
      chapterWeightsById: nextState.chapterWeightsById,
      totalChapterWeight: nextState.totalChapterWeight,
      processedChapterWeight: nextState.processedChapterWeight,
      extractedChapters: nextState.extractedChapters,
    },
  })

  return nextState
}

function completePendingChapterInKnowledgeJob(jobId: string, chapterId: string) {
  const state = getKnowledgeRebuildJobState(jobId)
  if (!state) {
    return null
  }

  if (!state.pendingChapterIds.includes(chapterId)) {
    return state
  }

  const chapterWeight = state.chapterWeightsById[chapterId] ?? 0
  const pendingChapterIds = state.pendingChapterIds.filter((id) => id !== chapterId)
  const chapterWeightsById = { ...state.chapterWeightsById }
  delete chapterWeightsById[chapterId]

  const nextState: KnowledgeRebuildJobState = {
    ...state,
    pendingChapterIds,
    chapterWeightsById,
    processedChapterWeight: Math.min(state.totalChapterWeight, state.processedChapterWeight + chapterWeight),
  }

  updateKnowledgeJob(jobId, {
    progress: getKnowledgeExtractionProgress(nextState),
    payload: {
      ...state.payload,
      currentChapterId: null,
      phase: state.phase,
      pendingChapterIds: nextState.pendingChapterIds,
      chapterWeightsById: nextState.chapterWeightsById,
      totalChapterWeight: nextState.totalChapterWeight,
      processedChapterWeight: nextState.processedChapterWeight,
      extractedChapters: state.extractedChapters,
    },
  })

  return nextState
}

function chapterStillExists(chapterId: string) {
  return Boolean(queryOne<{ id: string }>('SELECT id FROM KnowledgeChapter WHERE id = ? LIMIT 1', chapterId)?.id)
}

function setKnowledgeRebuildJobPhase(jobId: string, phase: NonNullable<KnowledgeRebuildJobPayload['phase']>) {
  const state = getKnowledgeRebuildJobState(jobId)
  if (!state) return null

  const nextState: KnowledgeRebuildJobState = {
    ...state,
    phase,
  }

  updateKnowledgeJob(jobId, {
    payload: {
      ...state.payload,
      phase,
      pendingChapterIds: state.pendingChapterIds,
      chapterWeightsById: state.chapterWeightsById,
      totalChapterWeight: state.totalChapterWeight,
      processedChapterWeight: state.processedChapterWeight,
      extractedChapters: state.extractedChapters,
      totalChapterCount: state.payload.totalChapterCount ?? (state.pendingChapterIds.length + state.extractedChapters.length),
      stageStartedAtByKey: {
        ...(state.payload.stageStartedAtByKey ?? {}),
        [phase]: (state.payload.stageStartedAtByKey ?? {})[phase] ?? new Date().toISOString(),
      },
    },
  })

  return nextState
}

function markInlineKnowledgeCleanupCompleted(jobId: string) {
  const state = getKnowledgeRebuildJobState(jobId)
  if (!state) return null

  updateKnowledgeJob(jobId, {
    payload: {
      ...state.payload,
      phase: state.phase,
      inlineCleanupCompleted: true,
      pendingChapterIds: state.pendingChapterIds,
      chapterWeightsById: state.chapterWeightsById,
      totalChapterWeight: state.totalChapterWeight,
      processedChapterWeight: state.processedChapterWeight,
      extractedChapters: state.extractedChapters,
      stageStartedAtByKey: {
        ...(state.payload.stageStartedAtByKey ?? {}),
        cleanup: (state.payload.stageStartedAtByKey ?? {}).cleanup ?? new Date().toISOString(),
      },
    },
  })

  return getKnowledgeRebuildJobState(jobId)
}

function removeExtractedChapterFromKnowledgeJob(jobId: string, chapterId: string) {
  const state = getKnowledgeRebuildJobState(jobId)
  if (!state) return null

  const extractedChapters = state.extractedChapters.filter((chapter) => chapter.chapterId !== chapterId)
  const nextState: KnowledgeRebuildJobState = {
    ...state,
    extractedChapters,
  }

  updateKnowledgeJob(jobId, {
    payload: {
      ...state.payload,
      phase: state.phase,
      pendingChapterIds: state.pendingChapterIds,
      chapterWeightsById: state.chapterWeightsById,
      totalChapterWeight: state.totalChapterWeight,
      processedChapterWeight: state.processedChapterWeight,
      extractedChapters,
    },
  })

  return nextState
}

function getKnowledgeJobRow(jobId: string) {
  return queryOne<{ status: string; errorMessage: string | null }>(
    'SELECT status, errorMessage FROM KnowledgeJob WHERE id = ?',
    jobId
  )
}

function assertKnowledgeRebuildContinues(jobId: string) {
  const job = getKnowledgeJobRow(jobId)
  if (!job) {
    throw new KnowledgeRebuildAbortedError()
  }

  if (job.status === 'paused') {
    throw new KnowledgeRebuildPausedError()
  }

  if (job.status !== 'queued' && job.status !== 'running') {
    throw new KnowledgeRebuildAbortedError()
  }
}

async function waitForKnowledgeJobCompletion(jobId: string, options?: { timeoutMs?: number; pollMs?: number }) {
  const timeoutMs = options?.timeoutMs ?? 10 * 60 * 1000
  const pollMs = options?.pollMs ?? 1000
  const startedAt = Date.now()

  while (Date.now() - startedAt <= timeoutMs) {
    const job = queryOne<{ status: string; errorMessage: string | null }>(
      'SELECT status, errorMessage FROM KnowledgeJob WHERE id = ?',
      jobId
    )

    if (!job) {
      throw new Error('Knowledge job not found')
    }

    if (job.status === 'succeeded') {
      return
    }

    if (job.status === 'failed') {
      throw new Error(job.errorMessage || 'Knowledge rebuild failed')
    }

    if (job.status === 'paused' || job.status === 'aborted') {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }

  updateKnowledgeJob(jobId, {
    status: 'failed',
    currentStep: '超时',
    errorMessage: 'Knowledge rebuild timed out',
  })
  throw new Error('Knowledge rebuild timed out')
}

function getKnowledgeJobOutcome(jobId: string): KnowledgeRebuildJobOutcome {
  const status = queryOne<{ status: string }>('SELECT status FROM KnowledgeJob WHERE id = ?', jobId)?.status
  if (status === 'paused') return 'paused'
  if (status === 'aborted') return 'aborted'
  return 'completed'
}

function upsertNovelRecord(params: { novelId: string; title: string; author?: string | null; sourceType?: string }) {
  execute(
    `
      INSERT INTO NovelRecord (id, title, author, sourceType)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        author = excluded.author,
        sourceType = excluded.sourceType,
        updatedAt = CURRENT_TIMESTAMP
    `,
    params.novelId,
    params.title,
    params.author ?? null,
    params.sourceType ?? 'txt'
  )
}

function upsertStoryBranch(novelId: string, branchId: string, name: string) {
  execute(
    `
      INSERT INTO StoryBranch (id, novelId, name)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        novelId = excluded.novelId,
        name = excluded.name,
        updatedAt = CURRENT_TIMESTAMP
    `,
    branchId,
    novelId,
    name
  )
}

function insertChapterLines(chapterId: string, lines: ReturnType<typeof splitChapterLines>) {
  for (const line of lines) {
    execute(
      'INSERT INTO ChapterLine (id, chapterId, lineNo, text, charStart, charEnd) VALUES (?, ?, ?, ?, ?, ?)',
      uid('line'),
      chapterId,
      line.lineNo,
      line.text,
      line.charStart,
      line.charEnd
    )
  }
}

function insertTextSpans(spans: ReturnType<typeof buildTextSpansFromLines>) {
  for (const span of spans) {
    execute(
      `
        INSERT INTO TextSpan (
          id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd, charStart, charEnd, text, spanType, tokenEstimate
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      span.id,
      span.novelId,
      span.branchId,
      span.chapterId,
      span.chapterNo,
      span.lineStart,
      span.lineEnd,
      span.charStart ?? null,
      span.charEnd ?? null,
      span.text,
      span.spanType,
      span.tokenEstimate ?? null
    )
  }
}

async function deleteNovelProjectionArtifacts(novelId: string, branchId: string) {
  await withTransaction(async () => {
    execute(
      `
        DELETE FROM future_jump_revisions
        WHERE run_id IN (
          SELECT id FROM future_jump_runs
          WHERE base_branch_id = ?
             OR session_id IN (SELECT id FROM what_if_sessions WHERE novel_id = ?)
        )
      `,
      branchId,
      novelId
    )
    execute(
      `
        DELETE FROM future_jump_runs
        WHERE base_branch_id = ?
           OR session_id IN (SELECT id FROM what_if_sessions WHERE novel_id = ?)
      `,
      branchId,
      novelId
    )
    execute('DELETE FROM story_timeline_nodes WHERE novel_id = ?', novelId)
    execute('DELETE FROM what_if_sessions WHERE novel_id = ?', novelId)
    execute('DELETE FROM outline_node_chapters WHERE outline_node_id IN (SELECT id FROM outline_nodes WHERE novel_id = ?)', novelId)
    execute('DELETE FROM outline_nodes WHERE novel_id = ?', novelId)
    execute('DELETE FROM chapter_extraction_candidates WHERE novel_id = ?', novelId)
    execute('DELETE FROM KnowledgeJob WHERE novelId = ?', novelId)
    execute('DELETE FROM NovelRecord WHERE id = ?', novelId)
  })
}

async function clearKnowledgeGraphData(novelId: string, branchId: string) {
  await withTransaction(async () => {
    execute('DELETE FROM EntityMention WHERE novelId = ? AND branchId = ?', novelId, branchId)
    execute(
      'DELETE FROM FactEvidence WHERE factId IN (SELECT id FROM KnowledgeFact WHERE novelId = ? AND branchId = ?)',
      novelId,
      branchId
    )
    execute('DELETE FROM KnowledgeFact WHERE novelId = ? AND branchId = ?', novelId, branchId)
    execute('DELETE FROM KnowledgeRelation WHERE novelId = ? AND branchId = ?', novelId, branchId)
    execute('DELETE FROM EntityLink WHERE novelId = ? AND branchId = ?', novelId, branchId)
    execute('DELETE FROM EntityState WHERE novelId = ? AND branchId = ?', novelId, branchId)
    execute(
      'DELETE FROM EventParticipant WHERE eventId IN (SELECT id FROM KnowledgeEvent WHERE novelId = ? AND branchId = ?)',
      novelId,
      branchId
    )
    execute('DELETE FROM KnowledgeEvent WHERE novelId = ? AND branchId = ?', novelId, branchId)
    execute('DELETE FROM EventLink WHERE novelId = ? AND branchId = ?', novelId, branchId)
    execute('DELETE FROM KnowledgeWorld WHERE novelId = ? AND branchId = ?', novelId, branchId)
    execute(
      'DELETE FROM EntityAppearance WHERE entityId IN (SELECT id FROM KnowledgeEntity WHERE novelId = ? AND branchId = ?)',
      novelId,
      branchId
    )
    execute(
      'DELETE FROM EntityAlias WHERE entityId IN (SELECT id FROM KnowledgeEntity WHERE novelId = ? AND branchId = ?)',
      novelId,
      branchId
    )
    execute('DELETE FROM KnowledgeEntity WHERE novelId = ? AND branchId = ?', novelId, branchId)
  })
}

async function clearExtractionCandidatesFromChapter(branchId: string, fromChapterNo: number) {
  execute(
    'DELETE FROM chapter_extraction_candidates WHERE branch_id = ? AND chapter_no >= ?',
    branchId,
    fromChapterNo
  )
}

async function clearDerivedKnowledgeFromChapter(novelId: string, branchId: string, fromChapterNo: number) {
  await withTransaction(async () => {
    execute(
      'DELETE FROM EntityMention WHERE novelId = ? AND branchId = ? AND chapterNo >= ?',
      novelId,
      branchId,
      fromChapterNo
    )
    execute(
      `
        DELETE FROM FactEvidence
        WHERE chapterNo >= ?
           OR factId IN (
             SELECT id FROM KnowledgeFact
             WHERE novelId = ? AND branchId = ? AND sourceChapter >= ? AND status != 'user_confirmed'
           )
      `,
      fromChapterNo,
      novelId,
      branchId,
      fromChapterNo
    )
    execute(
      "DELETE FROM KnowledgeFact WHERE novelId = ? AND branchId = ? AND sourceChapter >= ? AND status != 'user_confirmed'",
      novelId,
      branchId,
      fromChapterNo
    )
    execute(
      "DELETE FROM KnowledgeRelation WHERE novelId = ? AND branchId = ? AND sourceChapter >= ? AND status != 'user_confirmed'",
      novelId,
      branchId,
      fromChapterNo
    )
    execute(
      "DELETE FROM EntityLink WHERE novelId = ? AND branchId = ? AND sourceChapter >= ? AND status != 'user_confirmed'",
      novelId,
      branchId,
      fromChapterNo
    )
    execute(
      "DELETE FROM EntityState WHERE novelId = ? AND branchId = ? AND sourceChapter >= ? AND status != 'user_confirmed'",
      novelId,
      branchId,
      fromChapterNo
    )
    execute(
      'DELETE FROM EventParticipant WHERE eventId IN (SELECT id FROM KnowledgeEvent WHERE novelId = ? AND branchId = ? AND chapterNo >= ? AND status != \'user_confirmed\')',
      novelId,
      branchId,
      fromChapterNo
    )
    execute(
      "DELETE FROM KnowledgeEvent WHERE novelId = ? AND branchId = ? AND chapterNo >= ? AND status != 'user_confirmed'",
      novelId,
      branchId,
      fromChapterNo
    )
    execute(
      "DELETE FROM EventLink WHERE novelId = ? AND branchId = ? AND sourceChapter >= ? AND status != 'user_confirmed'",
      novelId,
      branchId,
      fromChapterNo
    )
    execute(
      "DELETE FROM KnowledgeWorld WHERE novelId = ? AND branchId = ? AND validFromChapter >= ? AND status != 'user_confirmed'",
      novelId,
      branchId,
      fromChapterNo
    )
    execute(
      'DELETE FROM EntityAppearance WHERE entityId IN (SELECT id FROM KnowledgeEntity WHERE novelId = ? AND branchId = ?) AND chapterNo >= ?',
      novelId,
      branchId,
      fromChapterNo
    )
    execute(
      'DELETE FROM EntityAlias WHERE entityId IN (SELECT id FROM KnowledgeEntity WHERE novelId = ? AND branchId = ?) AND sourceChapter >= ?',
      novelId,
      branchId,
      fromChapterNo
    )
    execute(
      'DELETE FROM EntityAlias WHERE entityId IN (SELECT id FROM KnowledgeEntity WHERE novelId = ? AND branchId = ? AND firstSeenChapter >= ? AND userConfirmed = 0)',
      novelId,
      branchId,
      fromChapterNo
    )
    execute(
      'DELETE FROM EntityAppearance WHERE entityId IN (SELECT id FROM KnowledgeEntity WHERE novelId = ? AND branchId = ? AND firstSeenChapter >= ? AND userConfirmed = 0)',
      novelId,
      branchId,
      fromChapterNo
    )
    execute(
      'DELETE FROM KnowledgeEntity WHERE novelId = ? AND branchId = ? AND firstSeenChapter >= ? AND userConfirmed = 0',
      novelId,
      branchId,
      fromChapterNo
    )
    execute(
      `
        UPDATE KnowledgeEntity
        SET lastSeenChapter = COALESCE(
              (
                SELECT MAX(a.chapterNo)
                FROM EntityAppearance a
                WHERE a.entityId = KnowledgeEntity.id
              ),
              firstSeenChapter
            ),
            updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ?
      `,
      novelId,
      branchId
    )
    execute(
      `
        UPDATE KnowledgeChapter
        SET summary = CASE WHEN chapterNo >= ? THEN NULL ELSE summary END,
            knowledgeStatus = CASE WHEN chapterNo >= ? THEN 'stale' ELSE knowledgeStatus END,
            updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ?
      `,
      fromChapterNo,
      fromChapterNo,
      novelId,
      branchId
    )
  })
}

function readChapterExtractionCandidate(row: ChapterExtractionCandidateRow | null | undefined): ChapterExtractionCandidate | null {
  if (!row) return null

  return {
    id: row.id,
    chapterId: row.chapterId,
    chapterNo: row.chapterNo,
    chapterRevision: row.chapterRevision,
    chapterSourceHash: row.chapterSourceHash,
    extractionJson: row.extractionJson,
    status: row.status,
    provider: row.provider,
    model: row.model,
    errorMessage: row.errorMessage,
  }
}

function loadChapterExtractionCandidate(params: { branchId: string; chapterId: string; chapterSourceHash: string }) {
  return readChapterExtractionCandidate(
    queryOne<ChapterExtractionCandidateRow>(
      `
        SELECT id,
               novel_id AS novelId,
               branch_id AS branchId,
               chapter_id AS chapterId,
               chapter_no AS chapterNo,
               chapter_revision AS chapterRevision,
               chapter_source_hash AS chapterSourceHash,
               extraction_json AS extractionJson,
               status,
               provider,
               model,
               error_message AS errorMessage
        FROM chapter_extraction_candidates
        WHERE branch_id = ? AND chapter_id = ? AND chapter_source_hash = ?
        LIMIT 1
      `,
      params.branchId,
      params.chapterId,
      params.chapterSourceHash
    )
  )
}

function upsertChapterExtractionCandidate(params: {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  chapterRevision?: number | null
  chapterSourceHash: string
  extractionJson: string
  status: ChapterExtractionCandidateStatus
  provider?: string | null
  model?: string | null
  errorMessage?: string | null
}) {
  execute(
    'UPDATE chapter_extraction_candidates SET status = \'stale\', updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND chapter_id = ? AND chapter_source_hash != ?',
    params.branchId,
    params.chapterId,
    params.chapterSourceHash
  )

  execute(
    `
      INSERT INTO chapter_extraction_candidates (
        id,
        novel_id,
        branch_id,
        chapter_id,
        chapter_no,
        chapter_revision,
        chapter_source_hash,
        extraction_json,
        status,
        provider,
        model,
        error_message
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(branch_id, chapter_id, chapter_source_hash) DO UPDATE SET
        chapter_no = excluded.chapter_no,
        chapter_revision = excluded.chapter_revision,
        extraction_json = excluded.extraction_json,
        status = excluded.status,
        provider = excluded.provider,
        model = excluded.model,
        error_message = excluded.error_message,
        updated_at = CURRENT_TIMESTAMP
    `,
    uid('candidate'),
    params.novelId,
    params.branchId,
    params.chapterId,
    params.chapterNo,
    params.chapterRevision ?? null,
    params.chapterSourceHash,
    params.extractionJson,
    params.status,
    params.provider ?? null,
    params.model ?? null,
    params.errorMessage ?? null,
  )
}

function updateChapterKnowledgeStatus(params: {
  chapterId: string
  knowledgeStatus: string
  dirtyReason?: string | null
}) {
  execute(
    `
      UPDATE KnowledgeChapter
      SET knowledgeStatus = ?,
          dirtyReason = ?,
          updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    params.knowledgeStatus,
    params.dirtyReason ?? null,
    params.chapterId
  )
}

function updateExistingChapterExtractionCandidate(params: {
  candidateId: string
  status: ChapterExtractionCandidateStatus
  errorMessage?: string | null
}) {
  execute(
    `
      UPDATE chapter_extraction_candidates
      SET status = ?,
          error_message = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    params.status,
    params.errorMessage ?? null,
    params.candidateId
  )
}

async function extractChapterCandidates(params: {
  novelId: string
  branchId: string
  chapter: KnowledgeChapterRow
  settings: KnowledgeExtractionScenarioSettings
  assertCanContinue?: () => void | Promise<void>
}) {
  const existing = loadChapterExtractionCandidate({
    branchId: params.branchId,
    chapterId: params.chapter.id,
    chapterSourceHash: params.chapter.sourceHash,
  })
  if (existing?.status === 'extracted' || existing?.status === 'persisted') {
    return existing
  }

  upsertChapterExtractionCandidate({
    novelId: params.novelId,
    branchId: params.branchId,
    chapterId: params.chapter.id,
    chapterNo: params.chapter.chapterNo,
    chapterRevision: params.chapter.revision,
    chapterSourceHash: params.chapter.sourceHash,
    extractionJson: existing?.extractionJson ?? '{}',
    status: 'extracting',
    errorMessage: null,
  })

  const chapterLike = toChapterLike({
    chapterId: params.chapter.id,
    novelId: params.novelId,
    title: params.chapter.title ?? `第${params.chapter.chapterNo}章`,
    chapterNo: params.chapter.chapterNo,
    rawText: params.chapter.rawText,
  })
  const extractionResult = await extractChapterKnowledgeOffline({
    chapter: chapterLike,
    chapterNo: params.chapter.chapterNo,
    settings: params.settings,
    assertCanContinue: params.assertCanContinue,
  })

  upsertChapterExtractionCandidate({
    novelId: params.novelId,
    branchId: params.branchId,
    chapterId: params.chapter.id,
    chapterNo: params.chapter.chapterNo,
    chapterRevision: params.chapter.revision,
    chapterSourceHash: params.chapter.sourceHash,
    extractionJson: JSON.stringify(extractionResult.extraction),
    status: 'extracted',
    provider: extractionResult.provider,
    model: extractionResult.model,
    errorMessage: null,
  })

  return loadChapterExtractionCandidate({
    branchId: params.branchId,
    chapterId: params.chapter.id,
    chapterSourceHash: params.chapter.sourceHash,
  })
}

function resolveChapterCandidate(params: {
  candidate: ChapterExtractionCandidate
  storyState: string
}): ResolvedChapterKnowledge {
  void params.storyState

  const parsed = JSON.parse(params.candidate.extractionJson) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Chapter ${params.candidate.chapterNo} candidate payload is invalid`)
  }

  return {
    extraction: parsed as ChapterKnowledgeExtraction,
  }
}

async function persistResolvedChapterKnowledge(params: {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  candidateId: string
  resolved: ResolvedChapterKnowledge
}) {
  await withTransaction(async () => {
    await persistChapterExtraction({
      novelId: params.novelId,
      branchId: params.branchId,
      chapterId: params.chapterId,
      chapterNo: params.chapterNo,
      extraction: params.resolved.extraction,
    })
    updateExistingChapterExtractionCandidate({
      candidateId: params.candidateId,
      status: 'persisted',
      errorMessage: null,
    })
  })
}

async function rebuildDerivedIndexes(params: {
  novelId: string
  branchId: string
  onProgress?: (progress: KnowledgeRebuildIndexProgress) => void | Promise<void>
}) {
  await rebuildBranchRetrievalIndex(params.novelId, params.branchId, {
    onProgress: params.onProgress,
  })
}

const BLOCKED_CHARACTER_MENTIONS = new Set([
  '他',
  '她',
  '它',
  '他们',
  '她们',
  '它们',
  '那人',
  '这人',
  '那位',
  '这位',
  '对方',
  '某人',
  '此人',
  '别人',
  '男人',
  '女人',
  '少女',
  '少年',
  '老者',
])

type CharacterEntityResolution =
  | { kind: 'blocked' }
  | { kind: 'ambiguous' }
  | { kind: 'unresolved' }
  | { kind: 'resolved'; entityId: string }

function normalizeCharacterMentionName(name: string) {
  return name.trim()
}

function isBlockedCharacterMention(name: string) {
  return BLOCKED_CHARACTER_MENTIONS.has(normalizeCharacterMentionName(name))
}

function resolveCharacterEntityByName(params: {
  branchId: string
  name: string
  chapterNo: number
}): CharacterEntityResolution {
  const normalizedName = normalizeCharacterMentionName(params.name)
  if (!normalizedName || isBlockedCharacterMention(normalizedName)) {
    return { kind: 'blocked' }
  }

  const rows = queryAll<{
    id: string
    matchSource: 'canonical' | 'alias'
    userConfirmed: number
  }>(
    `
      SELECT e.id AS id, 'canonical' AS matchSource, e.userConfirmed AS userConfirmed
      FROM KnowledgeEntity e
      WHERE e.branchId = ?
        AND e.entityType = 'character'
        AND e.canonicalName = ?
        AND e.firstSeenChapter <= ?
      UNION ALL
      SELECT e.id AS id, 'alias' AS matchSource, e.userConfirmed AS userConfirmed
      FROM EntityAlias a
      JOIN KnowledgeEntity e ON e.id = a.entityId
      WHERE e.branchId = ?
        AND e.entityType = 'character'
        AND a.alias = ?
        AND a.sourceChapter <= ?
    `,
    params.branchId,
    normalizedName,
    params.chapterNo,
    params.branchId,
    normalizedName,
    params.chapterNo,
  )

  const matches = rows.reduce<Array<{ id: string; matchSource: 'canonical' | 'alias'; userConfirmed: number }>>((acc, row) => {
    if (acc.some((item) => item.id === row.id)) return acc
    acc.push(row)
    return acc
  }, [])

  if (!matches.length) {
    return { kind: 'unresolved' }
  }

  if (matches.length === 1) {
    return { kind: 'resolved', entityId: matches[0].id }
  }

  const canonicalMatches = matches.filter((match) => match.matchSource === 'canonical')
  if (canonicalMatches.length === 1) {
    return { kind: 'resolved', entityId: canonicalMatches[0].id }
  }

  return { kind: 'ambiguous' }
}

function findResolvedCharacterEntityId(params: {
  branchId: string
  name: string
  chapterNo: number
}) {
  const resolution = resolveCharacterEntityByName(params)
  return resolution.kind === 'resolved' ? resolution.entityId : null
}

function insertEntityMention(params: {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  entityId: string | null
  mentionText: string
  resolutionKind: 'resolved' | 'ambiguous' | 'blocked'
  evidence?: { quote: string; lineStart: number; lineEnd: number } | null
}) {
  execute(
    `
      INSERT INTO EntityMention (
        id, novelId, branchId, chapterId, chapterNo, entityId, mentionText, resolutionKind, evidenceSpanId, evidenceQuote
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    uid('mention'),
    params.novelId,
    params.branchId,
    params.chapterId,
    params.chapterNo,
    params.entityId,
    params.mentionText,
    params.resolutionKind,
    params.evidence ? findEvidenceSpanId(params.chapterId, params.evidence.lineStart, params.evidence.lineEnd) : null,
    params.evidence?.quote ?? null,
  )
}

async function getOrCreateCharacterEntity(params: {
  novelId: string
  branchId: string
  name: string
  description: string
  status: string
  chapterNo: number
}) {
  const normalizedName = normalizeCharacterMentionName(params.name)
  const resolution = resolveCharacterEntityByName({
    branchId: params.branchId,
    name: normalizedName,
    chapterNo: params.chapterNo,
  })

  if (resolution.kind === 'blocked' || resolution.kind === 'ambiguous') {
    return null
  }

  const existing = resolution.kind === 'resolved'
    ? { id: resolution.entityId }
    : null

  if (existing) {
    execute(
      `
        UPDATE KnowledgeEntity
        SET description = ?, status = ?, lastSeenChapter = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      params.description,
      params.status,
      params.chapterNo,
      existing.id
    )
    return existing.id
  }

  const id = uid('entity')
  execute(
    `
      INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, description, firstSeenChapter, lastSeenChapter, status
      )
      VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?)
    `,
    id,
    params.novelId,
    params.branchId,
    normalizedName,
    params.description,
    params.chapterNo,
    params.chapterNo,
    params.status
  )
  return id
}

async function persistChapterExtraction(params: {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  extraction: ChapterKnowledgeExtraction
}) {
  const entityIdByName = new Map<string, string>()

  for (const item of params.extraction.characters) {
    const normalizedItemName = normalizeCharacterMentionName(item.name)
    const primaryEvidence = item.evidence[0] ?? null
    const resolution = resolveCharacterEntityByName({
      branchId: params.branchId,
      name: normalizedItemName,
      chapterNo: params.chapterNo,
    })

    if (resolution.kind === 'blocked' || resolution.kind === 'ambiguous') {
      insertEntityMention({
        novelId: params.novelId,
        branchId: params.branchId,
        chapterId: params.chapterId,
        chapterNo: params.chapterNo,
        entityId: null,
        mentionText: normalizedItemName,
        resolutionKind: resolution.kind,
        evidence: primaryEvidence,
      })
      continue
    }

    const entityId = await getOrCreateCharacterEntity({
      novelId: params.novelId,
      branchId: params.branchId,
      name: normalizedItemName,
      description: item.descriptionDelta,
      status: item.status,
      chapterNo: params.chapterNo,
    })
    if (!entityId) continue

    insertEntityMention({
      novelId: params.novelId,
      branchId: params.branchId,
      chapterId: params.chapterId,
      chapterNo: params.chapterNo,
      entityId,
      mentionText: normalizedItemName,
      resolutionKind: 'resolved',
      evidence: primaryEvidence,
    })

    entityIdByName.set(normalizedItemName, entityId)

    for (const alias of item.aliases) {
      const normalizedAlias = normalizeCharacterMentionName(alias)
      if (!normalizedAlias || isBlockedCharacterMention(normalizedAlias)) continue
      entityIdByName.set(normalizedAlias, entityId)
      execute(
        `
          INSERT INTO EntityAlias (id, entityId, alias, sourceChapter)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(entityId, alias) DO UPDATE SET sourceChapter = excluded.sourceChapter
        `,
        uid('alias'),
        entityId,
        normalizedAlias,
        params.chapterNo
      )
    }

    for (const evidence of item.evidence) {
      execute(
        `
          INSERT INTO EntityAppearance (id, entityId, chapterId, chapterNo, lineStart, lineEnd, evidenceSpanId)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        uid('appearance'),
        entityId,
        params.chapterId,
        params.chapterNo,
        evidence.lineStart,
        evidence.lineEnd,
        findEvidenceSpanId(params.chapterId, evidence.lineStart, evidence.lineEnd)
      )
    }

    const primaryEvidenceSpanId = primaryEvidence
      ? findEvidenceSpanId(params.chapterId, primaryEvidence.lineStart, primaryEvidence.lineEnd)
      : null

    const activeEntityState = queryOne<{
      id: string
      stateValue: string
      status: string
    }>(
      `
        SELECT id, stateValue, status
        FROM EntityState
        WHERE novelId = ? AND branchId = ? AND entityId = ? AND stateType = 'character_status'
          AND validFromChapter <= ?
          AND validUntilChapter > ?
          AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
        ORDER BY CASE status WHEN 'user_confirmed' THEN 0 ELSE 1 END, sourceChapter DESC, confidence DESC
        LIMIT 1
      `,
      params.novelId,
      params.branchId,
      entityId,
      params.chapterNo,
      params.chapterNo,
    )

    let nextEntityStateStatus = 'ai_generated'
    let shouldInsertEntityState = true
    if (activeEntityState) {
      if (activeEntityState.stateValue === (item.status || 'unknown')) {
        shouldInsertEntityState = false
      } else if (activeEntityState.status === 'user_confirmed') {
        nextEntityStateStatus = 'conflicted'
      } else {
        execute(
          `
            UPDATE EntityState
            SET validUntilChapter = ?, updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          params.chapterNo,
          activeEntityState.id
        )
      }
    }

    if (shouldInsertEntityState) {
      execute(
        `
          INSERT INTO EntityState (
            id, novelId, branchId, entityId, stateType, stateValue, description,
            sourceChapter, validFromChapter, validUntilChapter,
            evidenceSpanId, evidenceQuote, confidence, status, includeByDefault
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `,
        uid('entity-state'),
        params.novelId,
        params.branchId,
        entityId,
        'character_status',
        item.status || 'unknown',
        item.descriptionDelta || null,
        params.chapterNo,
        params.chapterNo,
        INF_CHAPTER,
        primaryEvidenceSpanId,
        primaryEvidence?.quote ?? null,
        0.7,
        nextEntityStateStatus
      )
    }

    execute(
      `
          INSERT INTO KnowledgeFact (
            id, novelId, branchId, factType, subjectEntityId, predicate, valueJson, sourceChapter, validFromChapter, validUntilChapter
          )
          VALUES (?, ?, ?, 'character_status', ?, 'status', ?, ?, ?, ?)
      `,
      uid('fact'),
      params.novelId,
      params.branchId,
      entityId,
      JSON.stringify({ status: item.status, descriptionDelta: item.descriptionDelta }),
      params.chapterNo,
      params.chapterNo,
      INF_CHAPTER
    )

    if (hasCharacterRoleCardProfile(item.profile)) {
      execute(
        `
          INSERT INTO KnowledgeFact (
            id, novelId, branchId, factType, subjectEntityId, predicate, valueJson, sourceChapter, validFromChapter, validUntilChapter
          )
          VALUES (?, ?, ?, 'character_profile', ?, 'role_card', ?, ?, ?, ?)
        `,
        uid('fact-profile'),
        params.novelId,
        params.branchId,
        entityId,
        JSON.stringify({
          profile: item.profile,
          descriptionDelta: buildCharacterDescriptionDelta(item.profile, item.descriptionDelta),
        }),
        params.chapterNo,
        params.chapterNo,
        INF_CHAPTER
      )
    }
  }

  for (const relation of params.extraction.relations) {
    const normalizedSourceName = normalizeCharacterMentionName(relation.source)
    const normalizedTargetName = normalizeCharacterMentionName(relation.target)
    const sourceEntityId = entityIdByName.get(normalizedSourceName) ?? findResolvedCharacterEntityId({
      branchId: params.branchId,
      name: normalizedSourceName,
      chapterNo: params.chapterNo,
    })
    const targetEntityId = entityIdByName.get(normalizedTargetName) ?? findResolvedCharacterEntityId({
      branchId: params.branchId,
      name: normalizedTargetName,
      chapterNo: params.chapterNo,
    })
    if (!sourceEntityId || !targetEntityId) continue
    entityIdByName.set(normalizedSourceName, sourceEntityId)
    entityIdByName.set(normalizedTargetName, targetEntityId)
    const evidence = relation.evidence[0]
    const evidenceSpanId = evidence ? findEvidenceSpanId(params.chapterId, evidence.lineStart, evidence.lineEnd) : null

    const existingRelation = queryOne<{
      id: string
      status: string | null
      polarity: string | null
      strength: number | null
      sourceChapter: number | null
      validFromChapter: number | null
      evidenceSpanId: string | null
    }>(
      `
        SELECT id, status, polarity, strength, sourceChapter, validFromChapter, evidenceSpanId
        FROM KnowledgeRelation
        WHERE novelId = ? AND branchId = ? AND sourceEntityId = ? AND targetEntityId = ? AND relationType = ?
          AND validFromChapter <= ?
          AND validUntilChapter > ?
          AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
        ORDER BY CASE status WHEN 'user_confirmed' THEN 0 ELSE 1 END, sourceChapter DESC
        LIMIT 1
      `,
      params.novelId,
      params.branchId,
      sourceEntityId,
      targetEntityId,
      relation.type,
      params.chapterNo,
      params.chapterNo
    )

    if (existingRelation) {
      if (existingRelation.status !== 'user_confirmed') {
        execute(
          `
            UPDATE KnowledgeRelation
            SET polarity = ?,
                strength = ?,
                sourceChapter = ?,
                validFromChapter = ?,
                evidenceSpanId = ?,
                updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          existingRelation.polarity && existingRelation.polarity !== 'neutral' ? existingRelation.polarity : relation.polarity,
          Math.max(existingRelation.strength ?? relation.strength, relation.strength),
          Math.max(existingRelation.sourceChapter ?? params.chapterNo, params.chapterNo),
          Math.min(existingRelation.validFromChapter ?? relation.validFromChapter, relation.validFromChapter),
          evidenceSpanId ?? existingRelation.evidenceSpanId,
          existingRelation.id
        )
      }
    } else {
      execute(
        `
          INSERT INTO KnowledgeRelation (
            id, novelId, branchId, sourceEntityId, targetEntityId, relationType, polarity, strength, sourceChapter, validFromChapter, validUntilChapter, evidenceSpanId
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        uid('relation'),
        params.novelId,
        params.branchId,
        sourceEntityId,
        targetEntityId,
        relation.type,
        relation.polarity,
        relation.strength,
        params.chapterNo,
        relation.validFromChapter,
        INF_CHAPTER,
        evidenceSpanId
      )
    }

    const existingLink = queryOne<{
      id: string
      status: string | null
      polarity: string | null
      strength: number | null
      sourceChapter: number | null
      validFromChapter: number | null
      evidenceSpanId: string | null
      evidenceQuote: string | null
      description: string | null
    }>(
      `
        SELECT id, status, polarity, strength, sourceChapter, validFromChapter, evidenceSpanId, evidenceQuote, description
        FROM EntityLink
        WHERE novelId = ? AND branchId = ? AND sourceEntityId = ? AND targetEntityId = ? AND linkType = ?
          AND validFromChapter <= ?
          AND validUntilChapter > ?
          AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
        ORDER BY CASE status WHEN 'user_confirmed' THEN 0 ELSE 1 END, sourceChapter DESC
        LIMIT 1
      `,
      params.novelId,
      params.branchId,
      sourceEntityId,
      targetEntityId,
      relation.type,
      params.chapterNo,
      params.chapterNo
    )

    if (existingLink) {
      if (existingLink.status !== 'user_confirmed') {
        execute(
          `
            UPDATE EntityLink
            SET label = ?,
                description = ?,
                polarity = ?,
                strength = ?,
                sourceChapter = ?,
                validFromChapter = ?,
                evidenceSpanId = ?,
                evidenceQuote = ?,
                updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          relation.type,
          chooseConciseKnowledgeText(existingLink.description, relation.change) || null,
          existingLink.polarity && existingLink.polarity !== 'neutral' ? existingLink.polarity : relation.polarity,
          Math.max(existingLink.strength ?? relation.strength, relation.strength),
          Math.max(existingLink.sourceChapter ?? params.chapterNo, params.chapterNo),
          Math.min(existingLink.validFromChapter ?? relation.validFromChapter, relation.validFromChapter),
          evidenceSpanId ?? existingLink.evidenceSpanId,
          evidence?.quote ?? existingLink.evidenceQuote,
          existingLink.id
        )
      }
      continue
    }

    execute(
      `
          INSERT INTO EntityLink (
            id, novelId, branchId, sourceEntityId, targetEntityId, linkType, label, description,
            polarity, strength, weight, sourceChapter, validFromChapter, validUntilChapter,
            evidenceSpanId, evidenceQuote, confidence, status, includeByDefault
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai_generated', 1)
        `,
      uid('entity-link'),
      params.novelId,
      params.branchId,
      sourceEntityId,
      targetEntityId,
      relation.type,
      relation.type,
      relation.change || null,
      relation.polarity,
        relation.strength,
          1,
          params.chapterNo,
          relation.validFromChapter,
          INF_CHAPTER,
          evidenceSpanId,
          evidence?.quote ?? null,
        0.7
    )
  }

  for (const event of params.extraction.events) {
    const evidence = event.evidence[0]
    const eventId = uid('event')

    execute(
      `
        INSERT INTO KnowledgeEvent (
          id, novelId, branchId, name, summary, eventType, chapterNo, lineStart, lineEnd, importance, consequences, evidenceSpanId
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      eventId,
      params.novelId,
      params.branchId,
      event.name,
      event.summary,
      event.eventType,
      params.chapterNo,
      evidence?.lineStart ?? null,
      evidence?.lineEnd ?? null,
      event.importance,
      event.consequences,
      evidence ? findEvidenceSpanId(params.chapterId, evidence.lineStart, evidence.lineEnd) : null
    )

    for (const participant of event.participants) {
      const normalizedParticipantName = normalizeCharacterMentionName(participant.name)
      const entityId = entityIdByName.get(normalizedParticipantName) ?? findResolvedCharacterEntityId({
        branchId: params.branchId,
        name: normalizedParticipantName,
        chapterNo: params.chapterNo,
      })
      if (!entityId) continue
      entityIdByName.set(normalizedParticipantName, entityId)
      execute(
        'INSERT INTO EventParticipant (id, eventId, entityId, role) VALUES (?, ?, ?, ?)',
        uid('participant'),
        eventId,
        entityId,
        participant.role
      )
    }
  }

  for (const item of params.extraction.worldbuilding) {
    const evidence = item.evidence[0]
    const existing = queryOne<{ id: string }>(
      'SELECT id FROM KnowledgeWorld WHERE branchId = ? AND term = ? AND category IS ?',
      params.branchId,
      item.term,
      item.category
    )

    if (existing) {
      const existingWorld = queryOne<{ status: string | null; definition: string | null }>(
        'SELECT status, definition FROM KnowledgeWorld WHERE id = ?',
        existing.id
      )
      if (existingWorld?.status === 'user_confirmed') {
        continue
      }
      execute(
        `
          UPDATE KnowledgeWorld
          SET definition = ?, validUntilChapter = ?, evidenceSpanId = ?, updatedAt = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        chooseConciseKnowledgeText(existingWorld?.definition, item.definition),
        INF_CHAPTER,
        evidence ? findEvidenceSpanId(params.chapterId, evidence.lineStart, evidence.lineEnd) : null,
        existing.id
      )
      continue
    }

    execute(
        `
        INSERT INTO KnowledgeWorld (
          id, novelId, branchId, term, category, definition, firstSeenChapter, validFromChapter, validUntilChapter, evidenceSpanId
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      uid('world'),
      params.novelId,
      params.branchId,
      item.term,
      item.category,
      item.definition,
      params.chapterNo,
      params.chapterNo,
      INF_CHAPTER,
      evidence ? findEvidenceSpanId(params.chapterId, evidence.lineStart, evidence.lineEnd) : null
    )
  }

  for (const thread of params.extraction.openThreads) {
    const factId = uid('fact-thread')
      execute(
        `
        INSERT INTO KnowledgeFact (id, novelId, branchId, factType, predicate, valueJson, sourceChapter, validFromChapter, validUntilChapter)
        VALUES (?, ?, ?, 'open_thread', ?, ?, ?, ?, ?)
      `,
      factId,
      params.novelId,
      params.branchId,
      thread.name,
      JSON.stringify({ description: thread.description }),
      params.chapterNo,
      params.chapterNo,
      INF_CHAPTER
    )

    const evidence = thread.evidence[0]
    if (evidence) {
      execute(
        `
          INSERT INTO FactEvidence (id, factId, chapterId, chapterNo, lineStart, lineEnd, quote, evidenceSpanId)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        uid('fact-evidence'),
        factId,
        params.chapterId,
        params.chapterNo,
        evidence.lineStart,
        evidence.lineEnd,
        evidence.quote,
        findEvidenceSpanId(params.chapterId, evidence.lineStart, evidence.lineEnd)
      )
    }
  }

  execute(
    `
      UPDATE KnowledgeChapter
      SET summary = ?, isDirty = 0, dirtyReason = NULL, knowledgeStatus = 'ready', updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    params.extraction.summary,
    params.chapterId
  )
}

export async function rebuildKnowledgeForNovel(params: { novelId: string; branchId?: string }) {
  const branchId = params.branchId ?? getMainBranchId(params.novelId)
  const activeJob = queryOne<{ id: string; status: string }>(
    "SELECT id, status FROM KnowledgeJob WHERE novelId = ? AND branchId = ? AND jobType = 'extract_chapter_knowledge' AND status IN ('queued', 'running', 'paused') ORDER BY updatedAt DESC, createdAt DESC LIMIT 1",
    params.novelId,
    branchId
  )

  if (activeJob?.id) {
    if (activeJob.status !== 'paused') {
      await waitForKnowledgeJobCompletion(activeJob.id)
      return { jobId: activeJob.id, outcome: getKnowledgeJobOutcome(activeJob.id) }
    }
  }

  const job = activeJob?.status === 'paused'
    ? { id: activeJob.id }
    : await enqueueKnowledgeJob({
        novelId: params.novelId,
        branchId,
        jobType: 'extract_chapter_knowledge',
        currentStep: '准备重建',
        payload: { branchId },
      })

  if (!job?.id) {
    throw new Error('Failed to create knowledge job')
  }

  try {
    const chapters = queryAll<KnowledgeChapterRow>(
      'SELECT id, novelId, branchId, chapterNo, title, rawText, summary, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus FROM KnowledgeChapter WHERE novelId = ? AND branchId = ? ORDER BY chapterNo ASC',
      params.novelId,
      branchId
    )
    const defaultRebuildStartChapter = getRebuildStartChapter(chapters)
    const defaultRebuildChapters = getRebuildChapters(chapters, defaultRebuildStartChapter)
    let jobState = getKnowledgeRebuildJobState(job.id)
    if (!isKnowledgeRebuildJobStateInitialized(jobState)) {
      const chapterWeightsById = Object.fromEntries(defaultRebuildChapters.map((chapter) => [chapter.id, getChapterProgressWeight(chapter.rawText)]))
      const totalChapterWeight = defaultRebuildChapters.reduce((sum, chapter) => sum + (chapterWeightsById[chapter.id] ?? 0), 0)

        initializeKnowledgeRebuildJobState(job.id, {
          branchId,
          rebuildStartChapter: defaultRebuildStartChapter,
          phase: 'extract',
          inlineCleanupCompleted: false,
          pendingChapterIds: defaultRebuildChapters.map((chapter) => chapter.id),
        chapterWeightsById,
        totalChapterWeight,
        totalChapterCount: defaultRebuildChapters.length,
        processedChapterWeight: 0,
        extractedChapters: [],
        embeddingSettingsSnapshot: buildEmbeddingSettingsSnapshot(),
        indexProgress: undefined,
        stageStartedAtByKey: {
          extract: new Date().toISOString(),
        },
      })
      jobState = getKnowledgeRebuildJobState(job.id)
    }

    updateKnowledgeJob(job.id, {
      status: 'running',
      errorMessage: null,
      currentStep: jobState?.phase === 'extract' ? '抽取章节知识' : '继续知识重建',
      progress: Math.max(0.05, queryOne<{ progress: number }>('SELECT progress FROM KnowledgeJob WHERE id = ?', job.id)?.progress ?? 0),
    })

    while (true) {
      assertKnowledgeRebuildContinues(job.id)
      jobState = getKnowledgeRebuildJobState(job.id)
      if (!jobState) {
        throw new Error('Knowledge rebuild job state is missing')
      }

        const currentJobState = jobState
        const rebuildStartChapter = currentJobState.payload.rebuildStartChapter ?? defaultRebuildStartChapter

        if (currentJobState.phase === 'extract') {
          if (!currentJobState.payload.inlineCleanupCompleted) {
            updateKnowledgeJob(job.id, {
              currentStep: '清理旧知识',
              progress: 0.02,
            })
            assertKnowledgeRebuildContinues(job.id)
            await clearExtractionCandidatesFromChapter(branchId, rebuildStartChapter)
            await clearDerivedKnowledgeFromChapter(params.novelId, branchId, rebuildStartChapter)
            markInlineKnowledgeCleanupCompleted(job.id)
            continue
          }

          const currentChapters = queryAll<KnowledgeChapterRow>(
          'SELECT id, novelId, branchId, chapterNo, title, rawText, summary, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus FROM KnowledgeChapter WHERE novelId = ? AND branchId = ? ORDER BY chapterNo ASC',
            params.novelId,
            branchId
          )
          const remainingChapters = currentChapters
            .filter((chapter) => chapter.chapterNo >= rebuildStartChapter && currentJobState.pendingChapterIds.includes(chapter.id))
            .sort((left, right) => left.chapterNo - right.chapterNo)

          ensureRawTextEmbeddingPrecomputeStarted({
            jobId: job.id,
            novelId: params.novelId,
            branchId,
            embeddingSettingsSnapshot: getOrCreateEmbeddingSettingsSnapshot(currentJobState.payload),
          })

          if (!remainingChapters.length) {
            setWriteQueueInKnowledgeJob(
              job.id,
              getRebuildChapters(currentChapters, rebuildStartChapter).map((chapter) => ({
                chapterId: chapter.id,
                chapterNo: chapter.chapterNo,
              }))
            )
            setKnowledgeRebuildJobPhase(job.id, 'write')
            continue
          }

          const extractionSettings = getKnowledgeExtractionSettingsSnapshot(currentJobState.payload)
          const configuredParallelism = getKnowledgeExtractionParallelism(extractionSettings)
          const extractionBatch = remainingChapters.slice(0, Math.min(configuredParallelism, remainingChapters.length))
          updateKnowledgeJob(job.id, {
            currentStep: `并行抽取候选知识（剩余 ${remainingChapters.length} 章，本批 ${extractionBatch.length} 章，最大并发 ${configuredParallelism}）`,
            progress: getKnowledgeExtractionProgress(currentJobState),
          })

          await Promise.all(
            extractionBatch.map(async (chapter) => {
              assertKnowledgeRebuildContinues(job.id)

              if (!chapterStillExists(chapter.id)) {
                removePendingChaptersFromKnowledgeJob(job.id, [chapter.id])
                return
              }

              try {
                await extractChapterCandidates({
                  novelId: params.novelId,
                  branchId,
                  chapter,
                  settings: extractionSettings,
                  assertCanContinue: () => assertKnowledgeRebuildContinues(job.id),
                })
              } catch (error) {
                if (isKnowledgeRebuildControlError(error)) {
                  throw error
                }

                upsertChapterExtractionCandidate({
                  novelId: params.novelId,
                  branchId,
                  chapterId: chapter.id,
                  chapterNo: chapter.chapterNo,
                  chapterRevision: chapter.revision,
                  chapterSourceHash: chapter.sourceHash,
                  extractionJson: '{}',
                  status: 'failed',
                  errorMessage: error instanceof Error ? error.message : `Chapter ${chapter.chapterNo} candidate extraction failed`,
                })
              } finally {
                const nextState = completePendingChapterInKnowledgeJob(job.id, chapter.id) ?? getKnowledgeRebuildJobState(job.id)
                updateKnowledgeJob(job.id, {
                  currentStep: `并行抽取候选知识（已完成第 ${chapter.chapterNo} 章）`,
                  progress: getKnowledgeExtractionProgress(nextState ?? currentJobState),
                })
              }
            })
          )
          continue
        }

        if (currentJobState.phase === 'cleanup') {
          setKnowledgeRebuildJobPhase(job.id, 'extract')
          continue
        }

        if (currentJobState.phase === 'write') {
          const currentChapters = queryAll<KnowledgeChapterRow>(
            'SELECT id, novelId, branchId, chapterNo, title, rawText, summary, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus FROM KnowledgeChapter WHERE novelId = ? AND branchId = ? ORDER BY chapterNo ASC',
            params.novelId,
            branchId
          )
          const chapterById = new Map(currentChapters.map((chapter) => [chapter.id, chapter]))
          const writeQueue = currentJobState.extractedChapters
            .filter((chapter) => chapterStillExists(chapter.chapterId))
            .sort((left, right) => left.chapterNo - right.chapterNo)

          if (writeQueue.length !== currentJobState.extractedChapters.length) {
          for (const chapter of currentJobState.extractedChapters) {
            if (!chapterStillExists(chapter.chapterId)) {
              removeExtractedChapterFromKnowledgeJob(job.id, chapter.chapterId)
            }
          }
          continue
        }

          if (!writeQueue.length) break

          const queuedChapter = writeQueue[0]
          const chapter = chapterById.get(queuedChapter.chapterId)
          if (!chapter) {
            removeExtractedChapterFromKnowledgeJob(job.id, queuedChapter.chapterId)
            continue
          }

          updateKnowledgeJob(job.id, {
            currentStep: `按章节顺序整理并写入第 ${chapter.chapterNo} 章知识`,
            progress: currentJobState.payload.totalChapterCount
              ? 0.82 + ((currentJobState.payload.totalChapterCount - writeQueue.length) / currentJobState.payload.totalChapterCount) * 0.14
              : 0.82,
          })

          assertKnowledgeRebuildContinues(job.id)
          const storyState = buildKnowledgeExtractionStoryState({
            novelId: params.novelId,
            branchId,
            asOfChapter: Math.max(0, chapter.chapterNo - 1),
            currentChapterText: chapter.rawText,
          })
          const candidate = loadChapterExtractionCandidate({
            branchId,
            chapterId: chapter.id,
            chapterSourceHash: chapter.sourceHash,
          })

          if (candidate?.status === 'persisted' && chapter.knowledgeStatus === 'ready' && chapter.isDirty === 0) {
            removeExtractedChapterFromKnowledgeJob(job.id, chapter.id)
            continue
          }

          if (!candidate || candidate.status === 'failed' || candidate.status === 'stale') {
            updateChapterKnowledgeStatus({
              chapterId: chapter.id,
              knowledgeStatus: 'degraded',
              dirtyReason: candidate?.errorMessage ?? 'Candidate missing or unavailable for ordered apply',
            })
            removeExtractedChapterFromKnowledgeJob(job.id, chapter.id)
            continue
          }

          try {
            updateExistingChapterExtractionCandidate({
              candidateId: candidate.id,
              status: 'resolving',
              errorMessage: null,
            })

            const resolved = resolveChapterCandidate({
              candidate,
              storyState,
            })
            await persistResolvedChapterKnowledge({
              novelId: params.novelId,
              branchId,
              chapterId: chapter.id,
              chapterNo: chapter.chapterNo,
              candidateId: candidate.id,
              resolved,
            })
          } catch (error) {
            if (isKnowledgeRebuildControlError(error)) {
              throw error
            }

            updateExistingChapterExtractionCandidate({
              candidateId: candidate.id,
              status: 'failed',
              errorMessage: error instanceof Error ? error.message : `Chapter ${chapter.chapterNo} ordered apply failed`,
            })
            updateChapterKnowledgeStatus({
              chapterId: chapter.id,
              knowledgeStatus: 'degraded',
              dirtyReason: error instanceof Error ? error.message : 'Ordered apply failed',
            })
          } finally {
            removeExtractedChapterFromKnowledgeJob(job.id, chapter.id)
          }
          continue
        }

    }

    assertKnowledgeRebuildContinues(job.id)
    await waitForRawTextEmbeddingPrecompute(job.id)
    assertKnowledgeRebuildContinues(job.id)
    setKnowledgeRebuildJobPhase(job.id, 'index')
    setKnowledgeRebuildJobIndexProgress(job.id, {
      phase: 'loading',
      totalRows: 0,
      embeddedRows: 0,
      totalBatches: 0,
      completedBatches: 0,
    })
    await rebuildDerivedIndexes({
      novelId: params.novelId,
      branchId,
      onProgress: async (indexProgress) => {
        assertKnowledgeRebuildContinues(job.id)
        setKnowledgeRebuildJobIndexProgress(job.id, indexProgress)
      },
    })

    updateKnowledgeJob(job.id, { status: 'succeeded', currentStep: '完成', progress: 1 })

    return { jobId: job.id, outcome: 'completed' as const }
  } catch (error) {
    if (error instanceof KnowledgeRebuildPausedError) {
      updateKnowledgeJob(job.id, { status: 'paused', currentStep: '已暂停' })
      return { jobId: job.id, outcome: 'paused' as const }
    }

    if (error instanceof KnowledgeRebuildAbortedError) {
      updateKnowledgeJob(job.id, {
        status: 'aborted',
        currentStep: null,
        progress: 0,
        payload: {
          branchId,
          phase: 'extract',
          currentChapterId: null,
          pendingChapterIds: [],
          chapterWeightsById: {},
          totalChapterWeight: 0,
          totalChapterCount: 0,
          processedChapterWeight: 0,
          extractedChapters: [],
          embeddingSettingsSnapshot: getOrCreateEmbeddingSettingsSnapshot({ branchId }),
          indexProgress: undefined,
          stageStartedAtByKey: {},
        },
      })
      return { jobId: job.id, outcome: 'aborted' as const }
    }

    updateKnowledgeJob(job.id, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Knowledge rebuild failed',
    })
    throw error
  }
}

export async function pauseKnowledgeRebuildForNovel(params: { novelId: string; branchId?: string }) {
  const branchId = params.branchId ?? getMainBranchId(params.novelId)
  const activeJob = queryOne<{ id: string }>(
    "SELECT id FROM KnowledgeJob WHERE novelId = ? AND branchId = ? AND jobType = 'extract_chapter_knowledge' AND status IN ('queued', 'running') ORDER BY updatedAt DESC, createdAt DESC LIMIT 1",
    params.novelId,
    branchId
  )

  if (!activeJob?.id) {
    return 'idle' as const
  }

  updateKnowledgeJob(activeJob.id, { status: 'paused', currentStep: '已暂停' })
  return 'paused' as const
}

export async function abortKnowledgeRebuildForNovel(params: { novelId: string; branchId?: string }) {
  const branchId = params.branchId ?? getMainBranchId(params.novelId)
  const activeJob = queryOne<{ id: string }>(
    "SELECT id FROM KnowledgeJob WHERE novelId = ? AND branchId = ? AND jobType = 'extract_chapter_knowledge' AND status IN ('queued', 'running', 'paused') ORDER BY updatedAt DESC, createdAt DESC LIMIT 1",
    params.novelId,
    branchId
  )

  if (!activeJob?.id) {
    return 'idle' as const
  }

  updateKnowledgeJob(activeJob.id, { status: 'aborted', currentStep: null, progress: 0 })
  return 'aborted' as const
}

export async function deleteKnowledgeGraphForNovel(params: { novelId: string; branchId?: string }) {
  const branchId = params.branchId ?? getMainBranchId(params.novelId)
  await abortKnowledgeRebuildForNovel({ novelId: params.novelId, branchId })
  await clearKnowledgeGraphData(params.novelId, branchId)
  return 'deleted' as const
}

export async function persistImportedNovelToKnowledgeStore(params: PersistImportedNovelParams) {
  const branchId = getMainBranchId(params.novelId)
  upsertNovelRecord({
    novelId: params.novelId,
    title: params.title,
    author: params.author ?? null,
    sourceType: params.sourceType ?? 'txt',
  })
  upsertStoryBranch(params.novelId, branchId, 'main')

  const chapterRows = params.chapters
    .filter((chapter) => !chapter.parentChapterId)
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((chapter, index) => {
      const rawText = chapter.content
        .replace(/<\/p>/g, '\n\n')
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim()
      return {
        source: chapter,
        chapterId: chapter.id,
        chapterNo: index + 1,
        rawText,
        sourceHash: hashContent(rawText),
      }
    })

  await withTransaction(async () => {
    for (const row of chapterRows) {
      execute(
        `
          INSERT INTO KnowledgeChapter (
            id, novelId, branchId, chapterNo, title, rawText, revision, isDirty, sourceHash, knowledgeStatus
          )
          VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, 'queued')
        `,
        row.chapterId,
        params.novelId,
        branchId,
        row.chapterNo,
        row.source.title,
        row.rawText,
        row.sourceHash
      )

      const lines = splitChapterLines(row.rawText)
      insertChapterLines(row.chapterId, lines)
      insertTextSpans(
        buildTextSpansFromLines({
          novelId: params.novelId,
          branchId,
          chapterId: row.chapterId,
          chapterNo: row.chapterNo,
          text: row.rawText,
          lines,
        })
      )
    }
  })

  await enqueueKnowledgeJob({
    novelId: params.novelId,
    branchId,
    jobType: 'import_novel',
    currentStep: '导入完成，等待知识重建',
    payload: { title: params.title, chapterCount: chapterRows.length },
  })

  await rebuildKnowledgeForNovel({ novelId: params.novelId, branchId })

  return {
    novelId: params.novelId,
    branchId,
    chapterCount: chapterRows.length,
  }
}

type WorkspaceKnowledgeSyncPayload = {
  localNovels?: Array<{ id: string; title: string; summary: string; tags: string[] }>
  localChapters?: Chapter[]
  localOutlines?: PersistedNovelState['localOutlines']
  localTimelineEvents?: PersistedNovelState['localTimelineEvents']
  currentNovelId?: string
}

let workspaceKnowledgeSyncQueue: Promise<void> = Promise.resolve()

async function performWorkspacePayloadToKnowledgeStoreSync(payload: WorkspaceKnowledgeSyncPayload) {
  const novelMetaById = new Map((payload.localNovels ?? []).map((item) => [item.id, item]))
  const chapters = (payload.localChapters ?? [])
    .filter((chapter) => !chapter.parentChapterId)
    .slice()
    .sort((a, b) => a.order - b.order)

  const groupedByNovel = new Map<string, Chapter[]>()
  for (const chapter of chapters) {
    const current = groupedByNovel.get(chapter.novelId) ?? []
    current.push(chapter)
    groupedByNovel.set(chapter.novelId, current)
  }

  const desiredNovelIds = new Set(groupedByNovel.keys())
  const staleNovelIds = queryAll<{ id: string }>('SELECT id FROM NovelRecord').filter((row) => !desiredNovelIds.has(row.id))

  if (staleNovelIds.length) {
    for (const novel of staleNovelIds) {
      const branchId = getMainBranchId(novel.id)
      const activeJob = queryOne<{ id: string }>(
        "SELECT id FROM KnowledgeJob WHERE novelId = ? AND branchId = ? AND jobType = 'extract_chapter_knowledge' AND status IN ('queued', 'running') ORDER BY createdAt DESC LIMIT 1",
        novel.id,
        branchId
      )

      if (activeJob?.id) {
        await abortKnowledgeRebuildForNovel({ novelId: novel.id, branchId })
      }

      await deleteBranchRetrievalIndex(branchId)

      await deleteNovelProjectionArtifacts(novel.id, branchId)
    }
  }

  if (!desiredNovelIds.size) return

  const orderedNovelIds = Array.from(groupedByNovel.keys()).sort((left, right) => {
    if (left === payload.currentNovelId) return -1
    if (right === payload.currentNovelId) return 1
    return 0
  })

  for (const novelId of orderedNovelIds) {
    const novelChapters = groupedByNovel.get(novelId) ?? []
    const branchId = getMainBranchId(novelId)
    const novelMeta = novelMetaById.get(novelId)
    upsertNovelRecord({
      novelId,
      title: novelMeta?.title?.trim() || novelChapters[0]?.title?.replace(/^第\s*[0-9一二三四五六七八九十百千零两]+\s*章\s*/, '') || novelId,
    })
    upsertStoryBranch(novelId, branchId, 'main')

    const existing = queryAll<KnowledgeChapterRow>(
      'SELECT id, novelId, branchId, chapterNo, title, rawText, summary, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus FROM KnowledgeChapter WHERE novelId = ? AND branchId = ? ORDER BY chapterNo ASC',
      novelId,
      branchId
    )
    const desiredChapterIds = new Set(novelChapters.map((chapter) => chapter.id))
    const staleChapters = existing.filter((chapter) => !desiredChapterIds.has(chapter.id))
    const activeJob = queryOne<{ id: string; status: string }>(
      "SELECT id, status FROM KnowledgeJob WHERE novelId = ? AND branchId = ? AND jobType = 'extract_chapter_knowledge' AND status IN ('queued', 'running', 'paused') ORDER BY updatedAt DESC, createdAt DESC LIMIT 1",
      novelId,
      branchId
    )
    if (staleChapters.length) {
      await withTransaction(async () => {
        for (const chapter of staleChapters) {
          execute('DELETE FROM KnowledgeChapter WHERE id = ?', chapter.id)
        }
      })

      if (activeJob?.id) {
        removePendingChaptersFromKnowledgeJob(
          activeJob.id,
          staleChapters.map((chapter) => chapter.id)
        )
      }
    }
    const existingById = new Map(existing.map((item) => [item.id, item]))
    const existingStructuredKnowledgeCount = queryOne<{ count: number }>(
      `
        SELECT (
          (SELECT COUNT(*) FROM KnowledgeEntity WHERE novelId = ? AND branchId = ?)
          + (SELECT COUNT(*) FROM KnowledgeFact WHERE novelId = ? AND branchId = ?)
          + (SELECT COUNT(*) FROM KnowledgeRelation WHERE novelId = ? AND branchId = ?)
          + (SELECT COUNT(*) FROM EntityLink WHERE novelId = ? AND branchId = ?)
          + (SELECT COUNT(*) FROM EntityState WHERE novelId = ? AND branchId = ?)
          + (SELECT COUNT(*) FROM KnowledgeEvent WHERE novelId = ? AND branchId = ?)
          + (SELECT COUNT(*) FROM KnowledgeWorld WHERE novelId = ? AND branchId = ?)
        ) AS count
      `,
      novelId,
      branchId,
      novelId,
      branchId,
      novelId,
      branchId,
      novelId,
      branchId,
      novelId,
      branchId,
      novelId,
      branchId,
      novelId,
      branchId
    )?.count ?? 0
    const shouldBootstrapKnowledge = novelChapters.length > 0 && (existing.length === 0 || existingStructuredKnowledgeCount === 0)

    let firstChangedChapterNo: number | null = null
    const refreshedSpans: ReturnType<typeof buildTextSpansFromLines> = []

    for (let index = 0; index < novelChapters.length; index += 1) {
      const chapter = novelChapters[index]
      const chapterNo = index + 1
      const rawText = htmlToPlainText(chapter.content)
      const sourceHash = hashContent(rawText)
      const lines = splitChapterLines(rawText)
      const spans = buildTextSpansFromLines({
        novelId,
        branchId,
        chapterId: chapter.id,
        chapterNo,
        text: rawText,
        lines,
      })
      const current = existingById.get(chapter.id)

      if (!current) {
        execute(
          `
            INSERT INTO KnowledgeChapter (
              id, novelId, branchId, chapterNo, title, rawText, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
            )
            VALUES (?, ?, ?, ?, ?, ?, 1, 1, 'Created from workspace sync', ?, 'stale')
          `,
          chapter.id,
          novelId,
          branchId,
          chapterNo,
          chapter.title,
          rawText,
          sourceHash
        )
        insertChapterLines(chapter.id, lines)
        insertTextSpans(spans)
        refreshedSpans.push(...spans)
        firstChangedChapterNo = firstChangedChapterNo === null ? chapterNo : Math.min(firstChangedChapterNo, chapterNo)
        continue
      }

      if (current.sourceHash === sourceHash && current.chapterNo === chapterNo && current.title === chapter.title) {
        continue
      }

      execute(
        `
          UPDATE KnowledgeChapter
          SET chapterNo = ?, title = ?, rawText = ?, sourceHash = ?, revision = ?, isDirty = 1,
              dirtyReason = 'Updated from workspace sync', knowledgeStatus = 'stale', updatedAt = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        chapterNo,
        chapter.title,
        rawText,
        sourceHash,
        current.sourceHash === sourceHash ? current.revision : current.revision + 1,
        chapter.id
      )
        execute('DELETE FROM ChapterLine WHERE chapterId = ?', chapter.id)
      execute('DELETE FROM TextSpan WHERE chapterId = ?', chapter.id)
      insertChapterLines(chapter.id, lines)
      insertTextSpans(spans)
      refreshedSpans.push(...spans)
      firstChangedChapterNo = firstChangedChapterNo === null ? chapterNo : Math.min(firstChangedChapterNo, chapterNo)
    }

    const invalidationFromChapterNo = [
      firstChangedChapterNo,
      staleChapters.length ? Math.min(...staleChapters.map((chapter) => chapter.chapterNo)) : null,
    ].reduce<number | null>((current, value) => {
      if (value === null) return current
      if (current === null) return value
      return Math.min(current, value)
    }, null)

    if (shouldBootstrapKnowledge || staleChapters.length || firstChangedChapterNo !== null) {
      if (invalidationFromChapterNo !== null) {
        await markKnowledgeStaleFromChapter({
          novelId,
          branchId,
          fromChapterNo: invalidationFromChapterNo,
        })
      }

      if (activeJob?.id) {
        await abortKnowledgeRebuildForNovel({ novelId, branchId })
      }
    }

    await bootstrapOutlineNodesForFutureMap({
      novelId,
      branchId,
      workspaceState: payload,
    })
  }
}

export async function syncWorkspacePayloadToKnowledgeStore(payload: WorkspaceKnowledgeSyncPayload) {
  const run = workspaceKnowledgeSyncQueue.then(() => performWorkspacePayloadToKnowledgeStoreSync(payload))
  workspaceKnowledgeSyncQueue = run.catch(() => undefined)
  return run
}
