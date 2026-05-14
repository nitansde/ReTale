import type { Chapter } from '@/lib/types'
import {
  buildCharacterDescriptionDelta,
  hasCharacterRoleCardProfile,
  mergeCharacterRoleCardProfiles,
  normalizeCharacterRoleCardProfile,
  type ChapterKnowledgeExtraction,
  type CharacterRoleCardProfile,
} from '@/lib/story-knowledge'
import { extractChapterKnowledgeOffline } from '@/lib/server/knowledge-extraction'
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
  rebuildBranchRetrievalIndex,
} from '@/lib/server/retrieval-index'
import { execute, queryAll, queryOne, type SqlParam, withTransaction } from '@/lib/server/sqlite'
import { htmlToPlainText, plainTextToHtml, uid } from '@/lib/utils'

type PersistImportedNovelParams = {
  novelId: string
  title: string
  chapters: Chapter[]
  author?: string | null
  sourceType?: string
}

type SnapshotCharacter = {
  name: string
  aliases: string[]
  status: string
  lastSeenChapter: number
  profile?: CharacterRoleCardProfile
}

type SnapshotRelation = {
  source: string
  target: string
  type: string
  polarity: string
  validFromChapter: number
  evidenceChapter: number
}

type SnapshotEvent = {
  chapter: number
  name: string
  summary: string
}

type SnapshotRule = {
  term: string
  definition: string
  firstSeenChapter: number
}

type SnapshotThread = {
  name: string
  description: string
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

type KnowledgeEntityRow = {
  id: string
  canonicalName: string
  status: string | null
  description: string | null
  lastSeenChapter: number | null
}

type KnowledgeRebuildPayloadChapter = {
  chapterId: string
  chapterNo: number
  extraction: ChapterKnowledgeExtraction
}

type KnowledgeRebuildStepKey = 'extract' | 'cleanup' | 'write' | 'snapshot' | 'index'

type KnowledgeRebuildStepStatus = 'pending' | 'running' | 'paused' | 'completed'

export type KnowledgeRebuildPayloadStep = {
  key: KnowledgeRebuildStepKey
  label: string
  status: KnowledgeRebuildStepStatus
  progress: number
  etaMinutes: number | null
  detail: string | null
}

type KnowledgeRebuildJobPayload = {
  branchId: string
  phase?: KnowledgeRebuildStepKey
  currentChapterId?: string | null
  pendingChapterIds?: string[]
  chapterWeightsById?: Record<string, number>
  totalChapterWeight?: number
  processedChapterWeight?: number
  extractedChapters?: KnowledgeRebuildPayloadChapter[]
  totalChapterCount?: number
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

const KNOWLEDGE_REBUILD_STEP_ORDER: KnowledgeRebuildStepKey[] = ['extract', 'cleanup', 'write', 'snapshot', 'index']

const KNOWLEDGE_REBUILD_STEP_LABELS: Record<KnowledgeRebuildStepKey, string> = {
  extract: '抽取章节知识',
  cleanup: '清理旧知识',
  write: '写入结构化知识',
  snapshot: '构建章节快照',
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

function createEmptySnapshot(chapterNo: number) {
  return {
    as_of_chapter: chapterNo,
    major_characters: [] as SnapshotCharacter[],
    active_relationships: [] as SnapshotRelation[],
    recent_events: [] as SnapshotEvent[],
    world_rules: [] as SnapshotRule[],
    open_threads: [] as SnapshotThread[],
    forbidden_future_facts: `Do not use any facts from chapters > ${chapterNo}.`,
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

function loadCharacterProfilesByEntityId(params: {
  novelId: string
  branchId: string
  entityIds: string[]
  maxChapterNo?: number
}) {
  if (!params.entityIds.length) {
    return new Map<string, CharacterRoleCardProfile>()
  }

  const chapterFilter = typeof params.maxChapterNo === 'number'
    ? 'AND validFromChapter <= ? AND (validToChapter IS NULL OR validToChapter >= ?)'
    : ''
  const rows = queryAll<{ subjectEntityId: string | null; valueJson: string | null; sourceChapter: number }>(
    `
      SELECT subjectEntityId, valueJson, sourceChapter
      FROM KnowledgeFact
      WHERE novelId = ? AND branchId = ? AND factType = 'character_profile'
        AND subjectEntityId IN (${params.entityIds.map(() => '?').join(', ')})
        AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
        ${chapterFilter}
      ORDER BY validFromChapter ASC, sourceChapter ASC
    `,
    params.novelId,
    params.branchId,
    ...params.entityIds,
    ...(typeof params.maxChapterNo === 'number' ? [params.maxChapterNo, params.maxChapterNo] : [])
  )

  const profileByEntityId = new Map<string, CharacterRoleCardProfile>()
  for (const row of rows) {
    const entityId = row.subjectEntityId?.trim()
    if (!entityId || !row.valueJson) continue
    try {
      const parsed = JSON.parse(row.valueJson) as { profile?: unknown }
      const profile = normalizeCharacterRoleCardProfile(parsed.profile)
      if (!hasCharacterRoleCardProfile(profile)) continue
      profileByEntityId.set(entityId, mergeCharacterRoleCardProfiles(profileByEntityId.get(entityId), profile))
    } catch {
    }
  }

  return profileByEntityId
}

function isGenericSnapshotRelationType(value: string) {
  const normalized = value.trim().toLocaleLowerCase('en-US')
  return !normalized
    || normalized === '关系'
    || normalized === '人物关系'
    || normalized === '角色关系'
    || normalized === '关联'
    || normalized === '联系'
    || normalized === '相关'
    || normalized === 'relation'
    || normalized === 'relationship'
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
  return payload as KnowledgeRebuildJobPayload
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

function estimateIndexStageTotalMs(totalChapterCount: number) {
  return Math.max(30_000, 12_000 + totalChapterCount * 4_000)
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
  const indexTotalMs = estimateIndexStageTotalMs(totalChapterCount)
  const indexElapsedMs = Number.isFinite(parseStageStartedAt(indexStartedAt))
    ? Math.max(0, Date.now() - parseStageStartedAt(indexStartedAt))
    : 0
  const activeIndexProgress = clampProgress(indexElapsedMs / indexTotalMs)
  const activeIndexEtaMinutes = runtime.status === 'paused'
    ? null
    : Math.max(1, Math.ceil(Math.max(0, indexTotalMs - indexElapsedMs) / 60000))

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
    } else if (key === 'snapshot') {
      progress = status === 'completed' ? 1 : (phase === 'snapshot' ? 0.55 : 0)
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

function hasUsableExtractedKnowledge(extraction: ChapterKnowledgeExtraction) {
  return extraction.characters.length > 0
    || extraction.relations.length > 0
    || extraction.events.length > 0
    || extraction.worldbuilding.length > 0
    || extraction.openThreads.length > 0
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
      stageStartedAtByKey: {
        ...(payload.stageStartedAtByKey ?? {}),
        [payload.phase ?? 'extract']: (payload.stageStartedAtByKey ?? {})[payload.phase ?? 'extract'] ?? new Date().toISOString(),
      },
    },
  })
}

function setCurrentKnowledgeJobChapter(jobId: string, chapterId: string | null) {
  const state = getKnowledgeRebuildJobState(jobId)
  if (!state) {
    return null
  }

  updateKnowledgeJob(jobId, {
    payload: {
      ...state.payload,
      currentChapterId: chapterId,
      phase: state.phase,
      pendingChapterIds: state.pendingChapterIds,
      chapterWeightsById: state.chapterWeightsById,
      totalChapterWeight: state.totalChapterWeight,
      processedChapterWeight: state.processedChapterWeight,
      extractedChapters: state.extractedChapters,
    },
  })

  return {
    ...state,
    payload: {
      ...state.payload,
      currentChapterId: chapterId,
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

function appendExtractedChapterToKnowledgeJob(jobId: string, chapter: KnowledgeRebuildPayloadChapter) {
  const state = getKnowledgeRebuildJobState(jobId)
  if (!state) return null

  const extractedChapters = [...state.extractedChapters.filter((item) => item.chapterId !== chapter.chapterId), chapter]
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

async function clearDerivedKnowledge(novelId: string, branchId: string) {
  await withTransaction(async () => {
    execute('DELETE FROM GraphContextCache WHERE novelId = ? AND branchId = ?', novelId, branchId)
    execute('DELETE FROM ChapterSnapshot WHERE novelId = ? AND branchId = ?', novelId, branchId)
    execute(
      'DELETE FROM FactEvidence WHERE factId IN (SELECT id FROM KnowledgeFact WHERE novelId = ? AND branchId = ?)',
      novelId,
      branchId
    )
    execute(
      "DELETE FROM KnowledgeFact WHERE novelId = ? AND branchId = ? AND status != 'user_confirmed'",
      novelId,
      branchId
    )
    execute(
      "DELETE FROM KnowledgeRelation WHERE novelId = ? AND branchId = ? AND status != 'user_confirmed'",
      novelId,
      branchId
    )
    execute(
      "DELETE FROM EntityLink WHERE novelId = ? AND branchId = ? AND status != 'user_confirmed'",
      novelId,
      branchId
    )
    execute(
      "DELETE FROM EntityState WHERE novelId = ? AND branchId = ? AND status != 'user_confirmed'",
      novelId,
      branchId
    )
    execute(
      'DELETE FROM EventParticipant WHERE eventId IN (SELECT id FROM KnowledgeEvent WHERE novelId = ? AND branchId = ?)',
      novelId,
      branchId
    )
    execute(
      "DELETE FROM KnowledgeEvent WHERE novelId = ? AND branchId = ? AND status != 'user_confirmed'",
      novelId,
      branchId
    )
    execute(
      "DELETE FROM EventLink WHERE novelId = ? AND branchId = ? AND status != 'user_confirmed'",
      novelId,
      branchId
    )
    execute(
      "DELETE FROM KnowledgeWorld WHERE novelId = ? AND branchId = ? AND status != 'user_confirmed'",
      novelId,
      branchId
    )
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
    execute('DELETE FROM KnowledgeEntity WHERE novelId = ? AND branchId = ? AND userConfirmed = 0', novelId, branchId)
  })
}

async function clearKnowledgeGraphData(novelId: string, branchId: string) {
  await withTransaction(async () => {
    execute('DELETE FROM GraphContextCache WHERE novelId = ? AND branchId = ?', novelId, branchId)
    execute('DELETE FROM ChapterSnapshot WHERE novelId = ? AND branchId = ?', novelId, branchId)
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

async function getOrCreateCharacterEntity(params: {
  novelId: string
  branchId: string
  name: string
  description: string
  status: string
  chapterNo: number
}) {
  const existing = queryOne<{ id: string }>(
    `
      SELECT id
      FROM KnowledgeEntity
      WHERE branchId = ? AND canonicalName = ? AND entityType = 'character'
      LIMIT 1
    `,
    params.branchId,
    params.name
  )

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
    params.name,
    params.description,
    params.chapterNo,
    params.chapterNo,
    params.status
  )
  return id
}

function findCharacterEntityIdByName(branchId: string, name: string) {
  return queryOne<{ id: string }>(
    `
      SELECT id
      FROM KnowledgeEntity
      WHERE branchId = ? AND canonicalName = ? AND entityType = 'character'
      LIMIT 1
    `,
    branchId,
    name
  )?.id ?? null
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
    const entityId = await getOrCreateCharacterEntity({
      novelId: params.novelId,
      branchId: params.branchId,
      name: item.name,
      description: item.descriptionDelta,
      status: item.status,
      chapterNo: params.chapterNo,
    })
    entityIdByName.set(item.name, entityId)

    for (const alias of item.aliases) {
      execute(
        `
          INSERT INTO EntityAlias (id, entityId, alias, sourceChapter)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(entityId, alias) DO UPDATE SET sourceChapter = excluded.sourceChapter
        `,
        uid('alias'),
        entityId,
        alias,
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

    const primaryEvidence = item.evidence[0]
    const primaryEvidenceSpanId = primaryEvidence
      ? findEvidenceSpanId(params.chapterId, primaryEvidence.lineStart, primaryEvidence.lineEnd)
      : null

    execute(
      `
        INSERT INTO EntityState (
          id, novelId, branchId, entityId, stateType, stateValue, description,
          sourceChapter, validFromChapter, evidenceSpanId, evidenceQuote, confidence, status, includeByDefault
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai_generated', 1)
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
      primaryEvidenceSpanId,
      primaryEvidence?.quote ?? null,
      0.7
    )

    execute(
      `
        INSERT INTO KnowledgeFact (
          id, novelId, branchId, factType, subjectEntityId, predicate, valueJson, sourceChapter, validFromChapter
        )
        VALUES (?, ?, ?, 'character_status', ?, 'status', ?, ?, ?)
      `,
      uid('fact'),
      params.novelId,
      params.branchId,
      entityId,
      JSON.stringify({ status: item.status, descriptionDelta: item.descriptionDelta }),
      params.chapterNo,
      params.chapterNo
    )

    if (hasCharacterRoleCardProfile(item.profile)) {
      execute(
        `
          INSERT INTO KnowledgeFact (
            id, novelId, branchId, factType, subjectEntityId, predicate, valueJson, sourceChapter, validFromChapter
          )
          VALUES (?, ?, ?, 'character_profile', ?, 'role_card', ?, ?, ?)
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
        params.chapterNo
      )
    }
  }

  for (const relation of params.extraction.relations) {
    const sourceEntityId = entityIdByName.get(relation.source) ?? findCharacterEntityIdByName(params.branchId, relation.source)
    const targetEntityId = entityIdByName.get(relation.target) ?? findCharacterEntityIdByName(params.branchId, relation.target)
    if (!sourceEntityId || !targetEntityId) continue
    entityIdByName.set(relation.source, sourceEntityId)
    entityIdByName.set(relation.target, targetEntityId)
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
          AND (validToChapter IS NULL OR validToChapter >= ?)
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
            id, novelId, branchId, sourceEntityId, targetEntityId, relationType, polarity, strength, sourceChapter, validFromChapter, evidenceSpanId
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          AND (validToChapter IS NULL OR validToChapter >= ?)
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
          polarity, strength, weight, sourceChapter, validFromChapter, validToChapter,
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
      null,
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
      const entityId = entityIdByName.get(participant.name)
      if (!entityId) continue
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
          SET definition = ?, validToChapter = NULL, evidenceSpanId = ?, updatedAt = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        chooseConciseKnowledgeText(existingWorld?.definition, item.definition),
        evidence ? findEvidenceSpanId(params.chapterId, evidence.lineStart, evidence.lineEnd) : null,
        existing.id
      )
      continue
    }

    execute(
      `
        INSERT INTO KnowledgeWorld (
          id, novelId, branchId, term, category, definition, firstSeenChapter, validFromChapter, evidenceSpanId
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      uid('world'),
      params.novelId,
      params.branchId,
      item.term,
      item.category,
      item.definition,
      params.chapterNo,
      params.chapterNo,
      evidence ? findEvidenceSpanId(params.chapterId, evidence.lineStart, evidence.lineEnd) : null
    )
  }

  for (const thread of params.extraction.openThreads) {
    const factId = uid('fact-thread')
    execute(
      `
        INSERT INTO KnowledgeFact (id, novelId, branchId, factType, predicate, valueJson, sourceChapter, validFromChapter)
        VALUES (?, ?, ?, 'open_thread', ?, ?, ?, ?)
      `,
      factId,
      params.novelId,
      params.branchId,
      thread.name,
      JSON.stringify({ description: thread.description }),
      params.chapterNo,
      params.chapterNo
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

async function buildSnapshotsForNovel(params: { novelId: string; branchId: string }) {
  const chapters = queryAll<KnowledgeChapterRow>(
    'SELECT id, novelId, branchId, chapterNo, title, rawText, summary, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus FROM KnowledgeChapter WHERE novelId = ? AND branchId = ? ORDER BY chapterNo ASC',
    params.novelId,
    params.branchId
  )

  let runningHash = ''
  for (const chapter of chapters) {
    const entities = queryAll<KnowledgeEntityRow & { importance: number }>(
      `
        SELECT id, canonicalName, status, description, lastSeenChapter, importance
        FROM KnowledgeEntity
        WHERE novelId = ? AND branchId = ? AND firstSeenChapter <= ?
        ORDER BY importance DESC, canonicalName ASC
        LIMIT 16
      `,
      params.novelId,
      params.branchId,
      chapter.chapterNo
    )
    const entityIds = entities.map((entity) => entity.id)
    const aliases = entityIds.length
      ? queryAll<{ entityId: string; alias: string }>(
          `SELECT entityId, alias FROM EntityAlias WHERE entityId IN (${entityIds.map(() => '?').join(', ')})`,
          ...entityIds
        )
      : []
    const aliasesByEntityId = new Map<string, string[]>()
    for (const alias of aliases) {
      const current = aliasesByEntityId.get(alias.entityId) ?? []
      current.push(alias.alias)
      aliasesByEntityId.set(alias.entityId, current)
    }
    const profileByEntityId = loadCharacterProfilesByEntityId({
      novelId: params.novelId,
      branchId: params.branchId,
      entityIds,
      maxChapterNo: chapter.chapterNo,
    })

    const activeStates = entityIds.length
      ? queryAll<{
          entityId: string
          stateValue: string
          validFromChapter: number
          sourceChapter: number
          confidence: number
        }>(
          `
            SELECT entityId, stateValue, validFromChapter, sourceChapter, confidence
            FROM EntityState
            WHERE novelId = ? AND branchId = ?
              AND entityId IN (${entityIds.map(() => '?').join(', ')})
              AND validFromChapter <= ?
              AND (validToChapter IS NULL OR validToChapter >= ?)
              AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
            ORDER BY validFromChapter DESC, sourceChapter DESC, confidence DESC
          `,
          params.novelId,
          params.branchId,
          ...entityIds,
          chapter.chapterNo,
          chapter.chapterNo
        )
      : []
    const latestStateByEntityId = new Map<string, string>()
    for (const state of activeStates) {
      if (latestStateByEntityId.has(state.entityId)) continue
      latestStateByEntityId.set(state.entityId, state.stateValue)
    }

    const relations = queryAll<{
      relationType: string
      polarity: string | null
      validFromChapter: number
      sourceChapter: number
      sourceName: string
      targetName: string
    }>(
      `
        SELECT r.relationType, r.polarity, r.validFromChapter, r.sourceChapter,
               se.canonicalName as sourceName,
               te.canonicalName as targetName
        FROM KnowledgeRelation r
        JOIN KnowledgeEntity se ON se.id = r.sourceEntityId
        JOIN KnowledgeEntity te ON te.id = r.targetEntityId
        WHERE r.novelId = ? AND r.branchId = ? AND r.validFromChapter <= ?
          AND (r.validToChapter IS NULL OR r.validToChapter >= ?)
          AND r.status NOT IN ('rejected', 'outdated', 'potentially_stale')
        ORDER BY CASE r.status WHEN 'user_confirmed' THEN 0 ELSE 1 END, r.strength DESC, r.sourceChapter DESC
        LIMIT 24
      `,
      params.novelId,
      params.branchId,
      chapter.chapterNo,
      chapter.chapterNo
    )

    const events = queryAll<{ chapterNo: number; name: string; summary: string }>(
      `
        SELECT chapterNo, name, summary
        FROM KnowledgeEvent
        WHERE novelId = ? AND branchId = ? AND chapterNo <= ?
        ORDER BY chapterNo DESC, importance DESC
        LIMIT 6
      `,
      params.novelId,
      params.branchId,
      chapter.chapterNo
    )

    const worlds = queryAll<{ term: string; definition: string; firstSeenChapter: number | null }>(
      `
        SELECT term, definition, firstSeenChapter
        FROM KnowledgeWorld
        WHERE novelId = ? AND branchId = ? AND validFromChapter <= ?
          AND (validToChapter IS NULL OR validToChapter >= ?)
          AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
        ORDER BY firstSeenChapter ASC
        LIMIT 24
      `,
      params.novelId,
      params.branchId,
      chapter.chapterNo,
      chapter.chapterNo
    )

    const openThreadFacts = queryAll<{ predicate: string; valueJson: string | null }>(
      `
        SELECT predicate, valueJson
        FROM KnowledgeFact
        WHERE novelId = ? AND branchId = ? AND factType = 'open_thread' AND validFromChapter <= ?
          AND (validToChapter IS NULL OR validToChapter >= ?)
        ORDER BY sourceChapter DESC
        LIMIT 8
      `,
      params.novelId,
      params.branchId,
      chapter.chapterNo,
      chapter.chapterNo
    )

    const snapshot = createEmptySnapshot(chapter.chapterNo)
    snapshot.major_characters = entities.map((entity) => ({
      name: entity.canonicalName,
      aliases: aliasesByEntityId.get(entity.id) ?? [],
      status: latestStateByEntityId.get(entity.id) ?? '活跃',
      lastSeenChapter: entity.lastSeenChapter ? Math.min(entity.lastSeenChapter, chapter.chapterNo) : chapter.chapterNo,
      profile: hasCharacterRoleCardProfile(profileByEntityId.get(entity.id)) ? profileByEntityId.get(entity.id) : undefined,
    }))
    const dedupedRelations = new Map<string, SnapshotRelation>()
    for (const relation of relations) {
      if (isGenericSnapshotRelationType(relation.relationType)) continue
      const key = [relation.sourceName, relation.targetName, relation.relationType]
        .map((part) => part.trim().toLocaleLowerCase('en-US'))
        .join('::')
      const nextRelation: SnapshotRelation = {
        source: relation.sourceName,
        target: relation.targetName,
        type: relation.relationType,
        polarity: relation.polarity ?? 'neutral',
        validFromChapter: relation.validFromChapter,
        evidenceChapter: relation.sourceChapter,
      }
      const existing = dedupedRelations.get(key)
      if (!existing) {
        dedupedRelations.set(key, nextRelation)
        continue
      }
      if (nextRelation.validFromChapter > existing.validFromChapter || nextRelation.evidenceChapter > existing.evidenceChapter) {
        dedupedRelations.set(key, nextRelation)
      }
    }
    snapshot.active_relationships = [...dedupedRelations.values()].slice(0, 16)
    snapshot.recent_events = events.map((event) => ({
      chapter: event.chapterNo,
      name: event.name,
      summary: event.summary,
    }))
    const dedupedWorlds = new Map<string, SnapshotRule>()
    for (const world of worlds) {
      const key = world.term.trim().toLocaleLowerCase('en-US')
      if (!key) continue
      const nextRule: SnapshotRule = {
        term: world.term,
        definition: world.definition,
        firstSeenChapter: world.firstSeenChapter ?? chapter.chapterNo,
      }
      const existing = dedupedWorlds.get(key)
      if (!existing) {
        dedupedWorlds.set(key, nextRule)
        continue
      }
      dedupedWorlds.set(key, {
        term: existing.term,
        definition: chooseConciseKnowledgeText(existing.definition, nextRule.definition),
        firstSeenChapter: Math.min(existing.firstSeenChapter, nextRule.firstSeenChapter),
      })
    }
    snapshot.world_rules = [...dedupedWorlds.values()].slice(0, 12)
    snapshot.open_threads = openThreadFacts.map((fact) => {
      const parsed = fact.valueJson ? (JSON.parse(fact.valueJson) as { description?: string }) : {}
      return {
        name: fact.predicate,
        description: parsed.description ?? fact.predicate,
      }
    })

    runningHash = hashContent(`${runningHash}:${chapter.sourceHash}`)
    execute(
      `
        INSERT INTO ChapterSnapshot (id, novelId, branchId, chapterId, chapterNo, snapshotJson, sourceRevisionHash, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ready')
        ON CONFLICT(novelId, branchId, chapterNo) DO UPDATE SET
          chapterId = excluded.chapterId,
          snapshotJson = excluded.snapshotJson,
          sourceRevisionHash = excluded.sourceRevisionHash,
          status = excluded.status,
          updatedAt = CURRENT_TIMESTAMP
      `,
      uid('snapshot'),
      params.novelId,
      params.branchId,
      chapter.id,
      chapter.chapterNo,
      JSON.stringify(snapshot),
      runningHash
    )
  }
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
    let jobState = getKnowledgeRebuildJobState(job.id)
    if (!isKnowledgeRebuildJobStateInitialized(jobState)) {
      const chapterWeightsById = Object.fromEntries(chapters.map((chapter) => [chapter.id, getChapterProgressWeight(chapter.rawText)]))
      const totalChapterWeight = chapters.reduce((sum, chapter) => sum + (chapterWeightsById[chapter.id] ?? 0), 0)

      initializeKnowledgeRebuildJobState(job.id, {
        branchId,
        phase: 'extract',
        pendingChapterIds: chapters.map((chapter) => chapter.id),
        chapterWeightsById,
        totalChapterWeight,
        totalChapterCount: chapters.length,
        processedChapterWeight: 0,
        extractedChapters: [],
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

      if (currentJobState.phase === 'extract') {
        const currentChapters = queryAll<KnowledgeChapterRow>(
          'SELECT id, novelId, branchId, chapterNo, title, rawText, summary, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus FROM KnowledgeChapter WHERE novelId = ? AND branchId = ? ORDER BY chapterNo ASC',
          params.novelId,
          branchId
        )
        const remainingChapters = currentChapters.filter((chapter) => currentJobState.pendingChapterIds.includes(chapter.id))

        if (!remainingChapters.length) {
          if (!currentJobState.extractedChapters.some((chapter) => hasUsableExtractedKnowledge(chapter.extraction))) {
            throw new Error('Knowledge rebuild aborted because structured extraction returned no usable knowledge')
          }
          setKnowledgeRebuildJobPhase(job.id, 'cleanup')
          continue
        }

        const chapter = remainingChapters[0]
        const stateWithCurrentChapter = setCurrentKnowledgeJobChapter(job.id, chapter.id)

        updateKnowledgeJob(job.id, {
          currentStep: `抽取第 ${chapter.chapterNo} 章`,
          progress: getKnowledgeExtractionProgress(stateWithCurrentChapter ?? jobState),
        })

        const chapterLike = toChapterLike({
          chapterId: chapter.id,
          novelId: params.novelId,
          title: chapter.title ?? `第${chapter.chapterNo}章`,
          chapterNo: chapter.chapterNo,
          rawText: chapter.rawText,
        })
        const extractionResult = await extractChapterKnowledgeOffline({
          chapter: chapterLike,
          chapterNo: chapter.chapterNo,
        })

        assertKnowledgeRebuildContinues(job.id)

        if (!chapterStillExists(chapter.id)) {
          removePendingChaptersFromKnowledgeJob(job.id, [chapter.id])
          continue
        }

        appendExtractedChapterToKnowledgeJob(job.id, {
          chapterId: chapter.id,
          chapterNo: chapter.chapterNo,
          extraction: extractionResult.extraction,
        })
        const completedState = completePendingChapterInKnowledgeJob(job.id, chapter.id)

        updateKnowledgeJob(job.id, {
          currentStep: `抽取第 ${chapter.chapterNo} 章（${extractionResult.provider}${extractionResult.model ? `: ${extractionResult.model}` : ''}）`,
          progress: getKnowledgeExtractionProgress(completedState ?? stateWithCurrentChapter ?? jobState),
        })
        continue
      }

      if (currentJobState.phase === 'cleanup') {
        updateKnowledgeJob(job.id, { currentStep: '清理旧知识', progress: 0.8 })
        assertKnowledgeRebuildContinues(job.id)
        await clearDerivedKnowledge(params.novelId, branchId)
        setKnowledgeRebuildJobPhase(job.id, 'write')
        continue
      }

      if (currentJobState.phase === 'write') {
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

        if (!writeQueue.length) {
          setKnowledgeRebuildJobPhase(job.id, 'snapshot')
          continue
        }

        const chapter = writeQueue[0]
        updateKnowledgeJob(job.id, {
          currentStep: `写入第 ${chapter.chapterNo} 章知识`,
          progress: 0.82 + (1 / Math.max(1, writeQueue.length)) * 0.08,
        })

        assertKnowledgeRebuildContinues(job.id)
        await persistChapterExtraction({
          novelId: params.novelId,
          branchId,
          chapterId: chapter.chapterId,
          chapterNo: chapter.chapterNo,
          extraction: chapter.extraction,
        })
        removeExtractedChapterFromKnowledgeJob(job.id, chapter.chapterId)
        continue
      }

      updateKnowledgeJob(job.id, { currentStep: '构建章节快照', progress: 0.9 })
      assertKnowledgeRebuildContinues(job.id)
      await buildSnapshotsForNovel({ novelId: params.novelId, branchId })
      break
    }

    setKnowledgeRebuildJobPhase(job.id, 'index')
    updateKnowledgeJob(job.id, { currentStep: '构建 Lance 检索索引', progress: 0.96 })
    assertKnowledgeRebuildContinues(job.id)
    await rebuildBranchRetrievalIndex(params.novelId, branchId)

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

export async function syncWorkspacePayloadToKnowledgeStore(payload: {
  localNovels?: Array<{ id: string; title: string; summary: string; tags: string[] }>
  localChapters?: Chapter[]
  currentNovelId?: string
}) {
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
        await waitForKnowledgeJobCompletion(activeJob.id)
      }

      await deleteBranchRetrievalIndex(branchId)

      await withTransaction(async () => {
        execute('DELETE FROM NovelRecord WHERE id = ?', novel.id)
      })
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
    const existingSnapshotCount = queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM ChapterSnapshot WHERE novelId = ? AND branchId = ?',
      novelId,
      branchId
    )?.count ?? 0
    const shouldBootstrapKnowledge = novelChapters.length > 0 && (existing.length === 0 || existingSnapshotCount === 0)

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

      if (activeJob?.status === 'paused') {
        continue
      }

      if (activeJob?.id) {
        await waitForKnowledgeJobCompletion(activeJob.id)
      }
      await rebuildKnowledgeForNovel({ novelId, branchId })
    }
  }
}
