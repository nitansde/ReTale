import type { Character, CharacterRelation, KnowledgeRebuildChapterRange, OutlineItem, TimelineEvent, WorldEntry, WorldEntryType } from '@/lib/types'
import {
  buildCharacterDescriptionDelta,
  buildCharacterRoleCardLines,
  hasCharacterRoleCardProfile,
  mergeCharacterRoleCardProfiles,
  normalizeCharacterRoleCardProfile,
  type CharacterRoleCardProfile,
} from '@/lib/story-knowledge'
import {
  abortKnowledgeRebuildForNovel,
  deleteKnowledgeGraphForNovel,
  type KnowledgeRebuildJobOutcome,
  type KnowledgeRebuildPayloadStep,
  type KnowledgeRebuildStartOutcome,
  pauseKnowledgeRebuildForNovel,
  runStartedKnowledgeRebuildForNovel,
  startKnowledgeRebuildForNovel,
} from '@/lib/server/knowledge-rebuild'
import { getCharacterClassificationMetadata, type CharacterImportanceTier } from '@/lib/server/hanlp-contracts'
import { getMainBranchId } from '@/lib/server/knowledge-store'
import { execute, queryAll, queryOne } from '@/lib/server/sqlite'

function isGenericRelationLabel(value: string) {
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

export type KnowledgeProjectionPayload = {
  localCharacters: Character[]
  localCharacterRelations: CharacterRelation[]
  localWorldEntries: WorldEntry[]
  localTimelineEvents: TimelineEvent[]
  localOutlines: OutlineItem[]
}

export type KnowledgeRebuildStatus = {
  jobId: string
  novelId: string
  status: string
  errorMessage?: string | null
  progress: number
  currentStep: string | null
  createdAt: string
  updatedAt: string
  etaMinutes: number | null
  steps: KnowledgeRebuildPayloadStep[]
  chapterRange?: KnowledgeRebuildChapterRange
  rawTextEmbeddingProgress?: number
  rawTextEmbeddingCacheHitRate?: number
  hanlpCacheStatus?: 'queued' | 'running' | 'paused' | 'ready' | 'empty'
  hanlpCacheHitRate?: number
  hanlpBootstrapProgress?: number
  hanlpBootstrapCompletedChapterCount?: number
  hanlpBootstrapTotalChapterCount?: number
  hanlpBootstrapCacheHitCount?: number
  hanlpBootstrapCacheMissCount?: number
  hanlpBootstrapInitializedCharacterEntities?: boolean
  hanlpSettingsSnapshot?: {
    hanlpScriptVersionHash: string
    hanlpModelOrConfigHash: string
    outputSchemaVersion: string
    pipelineVersion: string
  }
  stageTimingsMs?: Record<string, number>
  embeddingSettingsSnapshot?: {
    provider: string
    model: string
    embeddingBatchSize: number
  }
}

export type HanlpCacheSnapshot = {
  status: NonNullable<KnowledgeRebuildStatus['hanlpCacheStatus']>
  settingsSnapshot?: NonNullable<KnowledgeRebuildStatus['hanlpSettingsSnapshot']>
}

export type KnowledgeViewPayload = KnowledgeProjectionPayload & {
  knowledgeRebuildStatus: KnowledgeRebuildStatus | null
  hanlpCacheSnapshot: HanlpCacheSnapshot | null
}

export type KnowledgeViewActionOutcome = KnowledgeRebuildJobOutcome | KnowledgeRebuildStartOutcome | 'blocked' | 'deleted' | 'idle'

export type KnowledgeViewActionError = {
  code: 'active-rebuild'
  message: string
}

export type KnowledgeViewActionPayload = KnowledgeViewPayload & {
  jobOutcome: KnowledgeViewActionOutcome
  actionError: KnowledgeViewActionError | null
}

function createEmptyProjection(): KnowledgeProjectionPayload {
  return {
    localCharacters: [],
    localCharacterRelations: [],
    localWorldEntries: [],
    localTimelineEvents: [],
    localOutlines: [],
  }
}

type KnowledgeRebuildStatusRow = Omit<KnowledgeRebuildStatus, 'etaMinutes' | 'steps'> & {
  payloadJson: string | null
}

function isKnowledgeRebuildPayloadStep(value: unknown): value is KnowledgeRebuildPayloadStep {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return typeof candidate.key === 'string'
    && typeof candidate.label === 'string'
    && typeof candidate.status === 'string'
    && typeof candidate.progress === 'number'
    && (candidate.etaMinutes === null || typeof candidate.etaMinutes === 'number')
    && (candidate.detail === null || typeof candidate.detail === 'string')
}

function parseKnowledgeRebuildSteps(payloadJson: string | null) {
  if (!payloadJson) return [] as KnowledgeRebuildPayloadStep[]

  try {
    const payload = JSON.parse(payloadJson) as { steps?: unknown }
    if (!Array.isArray(payload.steps)) return []
    return payload.steps.filter(isKnowledgeRebuildPayloadStep)
  } catch {
    return [] as KnowledgeRebuildPayloadStep[]
  }
}

type KnowledgeRebuildTelemetryStatusFields = Pick<
  KnowledgeRebuildStatus,
  | 'rawTextEmbeddingProgress'
  | 'rawTextEmbeddingCacheHitRate'
  | 'hanlpCacheHitRate'
  | 'hanlpBootstrapProgress'
  | 'hanlpBootstrapCompletedChapterCount'
  | 'hanlpBootstrapTotalChapterCount'
  | 'hanlpBootstrapCacheHitCount'
  | 'hanlpBootstrapCacheMissCount'
  | 'hanlpBootstrapInitializedCharacterEntities'
  | 'hanlpSettingsSnapshot'
  | 'stageTimingsMs'
  | 'embeddingSettingsSnapshot'
> & Pick<KnowledgeRebuildStatus, 'chapterRange'>

function parseKnowledgeRebuildTelemetryStatusFields(payloadJson: string | null): KnowledgeRebuildTelemetryStatusFields {
  if (!payloadJson) return {}

  try {
    const payload = JSON.parse(payloadJson) as {
      rawTextEmbeddingProgress?: unknown
      rawTextEmbeddingCacheHitRate?: unknown
      hanlpBootstrap?: unknown
      stageTimingsMs?: unknown
      embeddingSettingsSnapshot?: unknown
      chapterRange?: unknown
    }

    const telemetry: KnowledgeRebuildTelemetryStatusFields = {}

    if (payload.chapterRange && typeof payload.chapterRange === 'object') {
      const range = payload.chapterRange as Record<string, unknown>
      const startChapter = typeof range.startChapter === 'number' && Number.isFinite(range.startChapter)
        ? Math.max(1, Math.floor(range.startChapter))
        : undefined
      const endChapter = typeof range.endChapter === 'number' && Number.isFinite(range.endChapter)
        ? Math.max(1, Math.floor(range.endChapter))
        : undefined
      if (startChapter !== undefined || endChapter !== undefined) {
        telemetry.chapterRange = {
          ...(startChapter !== undefined ? { startChapter } : {}),
          ...(endChapter !== undefined ? { endChapter } : {}),
        }
      }
    }

    if (typeof payload.rawTextEmbeddingProgress === 'number' && Number.isFinite(payload.rawTextEmbeddingProgress)) {
      telemetry.rawTextEmbeddingProgress = payload.rawTextEmbeddingProgress
    }

    if (typeof payload.rawTextEmbeddingCacheHitRate === 'number' && Number.isFinite(payload.rawTextEmbeddingCacheHitRate)) {
      telemetry.rawTextEmbeddingCacheHitRate = payload.rawTextEmbeddingCacheHitRate
    }

    if (payload.hanlpBootstrap && typeof payload.hanlpBootstrap === 'object') {
      const hanlp = payload.hanlpBootstrap as Record<string, unknown>
      const completedChapterCount = typeof hanlp.completedChapterCount === 'number' && Number.isFinite(hanlp.completedChapterCount)
        ? Math.max(0, Math.floor(hanlp.completedChapterCount))
        : null
      const totalChapterCount = typeof hanlp.totalChapterCount === 'number' && Number.isFinite(hanlp.totalChapterCount)
        ? Math.max(0, Math.floor(hanlp.totalChapterCount))
        : null

      if (completedChapterCount !== null) {
        telemetry.hanlpBootstrapCompletedChapterCount = completedChapterCount
      }
      if (totalChapterCount !== null) {
        telemetry.hanlpBootstrapTotalChapterCount = totalChapterCount
      }
      if (completedChapterCount !== null && totalChapterCount !== null) {
        telemetry.hanlpBootstrapProgress = totalChapterCount > 0 ? Math.min(1, completedChapterCount / totalChapterCount) : 1
      }
      if (typeof hanlp.cacheHitCount === 'number' && Number.isFinite(hanlp.cacheHitCount)) {
        telemetry.hanlpBootstrapCacheHitCount = Math.max(0, Math.floor(hanlp.cacheHitCount))
      }
      if (typeof hanlp.cacheMissCount === 'number' && Number.isFinite(hanlp.cacheMissCount)) {
        telemetry.hanlpBootstrapCacheMissCount = Math.max(0, Math.floor(hanlp.cacheMissCount))
      }
      const totalCacheLookups = (telemetry.hanlpBootstrapCacheHitCount ?? 0) + (telemetry.hanlpBootstrapCacheMissCount ?? 0)
      if (totalCacheLookups > 0) {
        telemetry.hanlpCacheHitRate = (telemetry.hanlpBootstrapCacheHitCount ?? 0) / totalCacheLookups
      }
      if (typeof hanlp.initializedCharacterEntities === 'boolean') {
        telemetry.hanlpBootstrapInitializedCharacterEntities = hanlp.initializedCharacterEntities
      }
    }

    if (payload.stageTimingsMs && typeof payload.stageTimingsMs === 'object') {
      const safeTimings = Object.fromEntries(
        Object.entries(payload.stageTimingsMs as Record<string, unknown>)
          .filter((entry): entry is [string, number] => (
            typeof entry[1] === 'number' && Number.isFinite(entry[1])
          ))
      )
      if (Object.keys(safeTimings).length) {
        telemetry.stageTimingsMs = safeTimings
      }
    }

    if (payload.embeddingSettingsSnapshot && typeof payload.embeddingSettingsSnapshot === 'object') {
      const snapshot = payload.embeddingSettingsSnapshot as Record<string, unknown>
      if (
        typeof snapshot.provider === 'string'
        && typeof snapshot.model === 'string'
        && typeof snapshot.embeddingBatchSize === 'number'
        && Number.isFinite(snapshot.embeddingBatchSize)
      ) {
        telemetry.embeddingSettingsSnapshot = {
          provider: snapshot.provider,
          model: snapshot.model,
          embeddingBatchSize: Math.max(1, Math.floor(snapshot.embeddingBatchSize)),
        }
      }
    }

    return telemetry
  } catch {
    return {}
  }
}

type HanlpCacheSnapshotRow = {
  hanlpScriptVersionHash: string
  hanlpModelOrConfigHash: string
  outputSchemaVersion: string
  pipelineVersion: string
}

function getHanlpCacheSnapshot(novelId: string, branchId: string, status?: KnowledgeRebuildStatus | null): HanlpCacheSnapshot {
  const cacheRow = queryOne<HanlpCacheSnapshotRow>(
    `
      SELECT
        hanlp_script_version_hash AS hanlpScriptVersionHash,
        hanlp_model_or_config_hash AS hanlpModelOrConfigHash,
        output_schema_version AS outputSchemaVersion,
        pipeline_version AS pipelineVersion
      FROM hanlp_bootstrap_cache
      WHERE novel_id = ? AND branch_id = ?
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `,
    novelId,
    branchId,
  ) ?? null

  const activeHanlpStep = status?.steps.find((step) => step.key === 'hanlp-bootstrap' && (step.status === 'running' || step.status === 'paused')) ?? null
  const cacheStatus: NonNullable<KnowledgeRebuildStatus['hanlpCacheStatus']> = activeHanlpStep?.status === 'paused'
    ? 'paused'
    : activeHanlpStep?.status === 'running'
      ? 'running'
      : status?.status === 'queued'
        ? 'queued'
        : cacheRow
          ? 'ready'
          : 'empty'

  return {
    status: cacheStatus,
    settingsSnapshot: cacheRow
      ? {
          hanlpScriptVersionHash: cacheRow.hanlpScriptVersionHash,
          hanlpModelOrConfigHash: cacheRow.hanlpModelOrConfigHash,
          outputSchemaVersion: cacheRow.outputSchemaVersion,
          pipelineVersion: cacheRow.pipelineVersion,
        }
      : undefined,
  }
}

function createIdleActionPayload(): KnowledgeViewActionPayload {
  return {
    ...createEmptyProjection(),
    knowledgeRebuildStatus: null,
    hanlpCacheSnapshot: null,
    jobOutcome: 'idle',
    actionError: null,
  }
}

function buildActiveRebuildBlockedMessage(status: KnowledgeRebuildStatus, cacheLabel: string) {
  return `Cannot delete ${cacheLabel} while a knowledge rebuild is ${status.status} for this novel branch.`
}

function getActiveKnowledgeRebuildRow(novelId: string, branchId: string) {
  return queryOne<Pick<KnowledgeRebuildStatus, 'jobId' | 'novelId' | 'status'>>(
    `
      SELECT id as jobId, novelId, status
      FROM KnowledgeJob
      WHERE novelId = ? AND branchId = ? AND jobType = 'extract_chapter_knowledge' AND status IN ('queued', 'running', 'paused')
      ORDER BY updatedAt DESC, createdAt DESC
      LIMIT 1
    `,
    novelId,
    branchId,
  ) ?? null
}

async function deleteBranchScopedCacheForNovel(params: {
  novelId: string
  cacheLabel: string
  deleteRows: (novelId: string, branchId: string) => void
}): Promise<KnowledgeViewActionPayload> {
  const trimmedNovelId = params.novelId.trim()
  if (!trimmedNovelId) {
    return createIdleActionPayload()
  }

  const branchId = getMainBranchId(trimmedNovelId)
  const activeJob = getActiveKnowledgeRebuildRow(trimmedNovelId, branchId)

  if (activeJob) {
    const projection = await buildKnowledgeProjection([trimmedNovelId])
    return {
      ...projection,
      jobOutcome: 'blocked',
      actionError: {
        code: 'active-rebuild',
        message: buildActiveRebuildBlockedMessage({
          ...activeJob,
          progress: 0,
          currentStep: null,
          createdAt: '',
          updatedAt: '',
          etaMinutes: null,
          steps: [],
        }, params.cacheLabel),
      },
    }
  }

  params.deleteRows(trimmedNovelId, branchId)

  return {
    ...(await buildKnowledgeProjection([trimmedNovelId])),
    jobOutcome: 'deleted',
    actionError: null,
  }
}

async function deleteHanlpCacheForNovel(novelId: string): Promise<KnowledgeViewActionPayload> {
  return deleteBranchScopedCacheForNovel({
    novelId,
    cacheLabel: 'HanLP cache',
    deleteRows: (trimmedNovelId, branchId) => {
      execute('DELETE FROM hanlp_bootstrap_entities WHERE novel_id = ? AND branch_id = ?', trimmedNovelId, branchId)
      execute('DELETE FROM hanlp_bootstrap_results WHERE novel_id = ? AND branch_id = ?', trimmedNovelId, branchId)
      execute('DELETE FROM hanlp_bootstrap_cache WHERE novel_id = ? AND branch_id = ?', trimmedNovelId, branchId)
    },
  })
}

async function deleteExtractionCacheForNovel(novelId: string): Promise<KnowledgeViewActionPayload> {
  return deleteBranchScopedCacheForNovel({
    novelId,
    cacheLabel: 'LLM extraction cache',
    deleteRows: (trimmedNovelId, branchId) => {
      execute('DELETE FROM chapter_extraction_candidates WHERE novel_id = ? AND branch_id = ?', trimmedNovelId, branchId)
    },
  })
}

async function deleteEmbeddingCacheForNovel(novelId: string): Promise<KnowledgeViewActionPayload> {
  return deleteBranchScopedCacheForNovel({
    novelId,
    cacheLabel: 'raw embedding cache',
    deleteRows: (_trimmedNovelId, branchId) => {
      execute('DELETE FROM RawTextEmbeddingCache WHERE branchId = ?', branchId)
    },
  })
}

function parseSqliteUtcTimestamp(value: string) {
  const normalized = value.trim().replace(' ', 'T')
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`
  const parsed = Date.parse(withZone)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function estimateRebuildEtaMinutes(progress: number, createdAt: string) {
  if (progress <= 0.02 || progress >= 0.999) return null

  const startedAt = parseSqliteUtcTimestamp(createdAt)
  if (!Number.isFinite(startedAt)) return null

  const elapsedMs = Date.now() - startedAt
  if (elapsedMs <= 0) return null

  const estimatedTotalMs = elapsedMs / progress
  const remainingMs = Math.max(0, estimatedTotalMs - elapsedMs)
  return Math.max(1, Math.ceil(remainingMs / 60000))
}

function getKnowledgeRebuildStatus(novelIds?: string[]): KnowledgeRebuildStatus | null {
  if (!novelIds?.length || novelIds.length !== 1) {
    return null
  }

  const branchId = getMainBranchId(novelIds[0])

  const status = queryAll<KnowledgeRebuildStatusRow>(
    `
      SELECT id as jobId, novelId, status, errorMessage, progress, currentStep, createdAt, updatedAt
           , payloadJson
      FROM KnowledgeJob
      WHERE novelId = ? AND branchId = ? AND jobType = 'extract_chapter_knowledge'
      ORDER BY updatedAt DESC, createdAt DESC
      LIMIT 1
    `,
    novelIds[0],
    branchId,
  )[0] ?? null

  if (!status) {
    return null
  }

  if (status.status !== 'queued' && status.status !== 'running' && status.status !== 'paused' && status.status !== 'failed') {
    return null
  }

  const steps = parseKnowledgeRebuildSteps(status.payloadJson)
  const telemetry = parseKnowledgeRebuildTelemetryStatusFields(status.payloadJson)
  const activeStep = steps.find((step) => step.status === 'running' || step.status === 'paused') ?? null
  const provisionalStatus = {
    ...status,
    etaMinutes: status.status === 'paused'
      ? null
      : activeStep?.etaMinutes ?? estimateRebuildEtaMinutes(status.progress, status.createdAt),
    steps,
    ...telemetry,
  } satisfies KnowledgeRebuildStatus
  const hanlpCacheSnapshot = getHanlpCacheSnapshot(novelIds[0], branchId, provisionalStatus)

  return {
    ...provisionalStatus,
    hanlpCacheStatus: hanlpCacheSnapshot.status,
    hanlpSettingsSnapshot: telemetry.hanlpSettingsSnapshot ?? hanlpCacheSnapshot.settingsSnapshot,
  }
}

function getKnowledgeViewHanlpCacheSnapshot(novelIds?: string[], status?: KnowledgeRebuildStatus | null): HanlpCacheSnapshot | null {
  if (!novelIds?.length || novelIds.length !== 1) {
    return null
  }

  return getHanlpCacheSnapshot(novelIds[0], getMainBranchId(novelIds[0]), status)
}

function toWorldEntryType(category: string | null): WorldEntryType {
  switch (category) {
    case 'geography':
      return 'location'
    case 'politics':
      return 'organization'
    case 'rule':
      return 'rule'
    case 'item':
      return 'item'
    case 'history':
      return 'history'
    default:
      return 'scene'
  }
}

function toRelationStrength(strength: number) {
  if (strength >= 4) return 'strong' as const
  if (strength <= 2) return 'weak' as const
  return 'medium' as const
}

function toRelationStatus(polarity: string | null) {
  if (polarity === 'negative') return 'strained' as const
  if (polarity === 'mixed') return 'hidden' as const
  return 'active' as const
}

function dedupeById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const next: string[] = []
  for (const raw of values) {
    const value = raw?.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    next.push(value)
  }
  return next
}

function loadCharacterAliasesByEntityId(entityIds: string[]) {
  if (!entityIds.length) return new Map<string, string[]>()
  const rows = queryAll<{ entityId: string; alias: string }>(
    `
      SELECT entityId, alias
      FROM EntityAlias
      WHERE entityId IN (${entityIds.map(() => '?').join(', ')})
      UNION ALL
      SELECT entityId, alias
      FROM EntityAliasMapping
      WHERE entityId IN (${entityIds.map(() => '?').join(', ')})
    `,
    ...entityIds,
    ...entityIds,
  )

  const aliasesByEntityId = new Map<string, string[]>()
  for (const row of rows) {
    const current = aliasesByEntityId.get(row.entityId) ?? []
    current.push(row.alias)
    aliasesByEntityId.set(row.entityId, current)
  }

  for (const [entityId, aliases] of aliasesByEntityId) {
    aliasesByEntityId.set(entityId, uniqueStrings(aliases))
  }

  return aliasesByEntityId
}

function loadCharacterProfilesByEntityId(entityIds: string[], asOfChapter?: number) {
  if (!entityIds.length) return new Map<string, CharacterRoleCardProfile>()
  const chapterFilter = typeof asOfChapter === 'number'
    ? `AND validFromChapter <= ? AND validUntilChapter > ?`
    : ''
  const rows = queryAll<{ subjectEntityId: string | null; valueJson: string | null; sourceChapter: number }>(
    `
      SELECT subjectEntityId, valueJson, sourceChapter
      FROM KnowledgeFact
      WHERE factType = 'character_profile'
        AND subjectEntityId IN (${entityIds.map(() => '?').join(', ')})
        AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
        ${chapterFilter}
      ORDER BY validFromChapter ASC, sourceChapter ASC
    `,
    ...entityIds,
    ...(typeof asOfChapter === 'number' ? [asOfChapter, asOfChapter] : []),
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

type CharacterStatePreview = {
  entityId: string
  stateValue: string
  description: string | null
}

function loadCharacterStatesByEntityId(entityIds: string[], asOfChapter?: number) {
  if (!entityIds.length || typeof asOfChapter !== 'number') {
    return new Map<string, CharacterStatePreview>()
  }

  const rows = queryAll<CharacterStatePreview & { sourceChapter: number }>(
    `
      SELECT entityId, stateValue, description, sourceChapter
      FROM EntityState
      WHERE stateType = 'character_status'
        AND entityId IN (${entityIds.map(() => '?').join(', ')})
        AND validFromChapter <= ?
        AND validUntilChapter > ?
        AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
      ORDER BY validFromChapter DESC, sourceChapter DESC, confidence DESC
    `,
    ...entityIds,
    asOfChapter,
    asOfChapter,
  )

  const stateByEntityId = new Map<string, CharacterStatePreview>()
  for (const row of rows) {
    if (!stateByEntityId.has(row.entityId)) {
      stateByEntityId.set(row.entityId, row)
    }
  }

  return stateByEntityId
}

function projectCharacterCompatibilityFields(
  profile: CharacterRoleCardProfile | undefined,
  state: CharacterStatePreview | undefined,
  importance: number,
) {
  const role = profile?.identity?.content?.trim() || profile?.identity?.summary?.trim() || (importance >= 4 ? '主要人物' : '角色')
  const goal = profile?.capability?.content?.trim() || profile?.capability?.summary?.trim() || profile?.likes?.content?.trim() || profile?.likes?.summary?.trim() || '待补充'
  const trait = profile?.personality?.content?.trim() || profile?.personality?.summary?.trim() || (state?.stateValue ? `状态：${state.stateValue}` : '待补充')
  const safeProfile = profile
  const note = safeProfile && hasCharacterRoleCardProfile(safeProfile)
    ? buildCharacterRoleCardLines(safeProfile, { includeEvidence: false, includeNotes: true }).slice(3).join('｜')
    : (state?.description?.trim() || '')
  return { role, goal, trait, note }
}

export async function buildKnowledgeProjection(novelIds?: string[], asOfChapter?: number): Promise<KnowledgeViewPayload> {
  const knowledgeRebuildStatus = getKnowledgeRebuildStatus(novelIds)
  const hanlpCacheSnapshot = getKnowledgeViewHanlpCacheSnapshot(novelIds, knowledgeRebuildStatus)
  const novels = novelIds?.length
    ? queryAll<{ id: string }>(
        `SELECT id FROM NovelRecord WHERE id IN (${novelIds.map(() => '?').join(', ')})`,
        ...novelIds
      )
    : queryAll<{ id: string }>('SELECT id FROM NovelRecord')

  if (!novels.length) {
    return {
      ...createEmptyProjection(),
      knowledgeRebuildStatus,
      hanlpCacheSnapshot,
    }
  }

  const branchIds = novels.map((novel) => getMainBranchId(novel.id))
  const applyAsOfChapter = typeof asOfChapter === 'number' && Number.isFinite(asOfChapter) && novels.length === 1

  const placeholders = branchIds.map(() => '?').join(', ')
  const [chapters, entities, relations, worlds, events, openThreadFacts] = await Promise.all([
    Promise.resolve(
      queryAll<{ id: string; novelId: string; branchId: string; chapterNo: number; title: string | null }>(
        `SELECT id, novelId, branchId, chapterNo, title FROM KnowledgeChapter WHERE branchId IN (${placeholders})`,
        ...branchIds
      )
    ),
    Promise.resolve(
      queryAll<{
        id: string
        novelId: string
        canonicalName: string
        description: string | null
        status: string | null
        importanceTier: CharacterImportanceTier | null
        importance: number
      }>(
        `
          SELECT id, novelId, canonicalName, description, status, importanceTier, importance
          FROM KnowledgeEntity
          WHERE branchId IN (${placeholders}) AND entityType = 'character'
            AND importanceTier IN ('protagonist', 'important', 'arc')
            AND (status IS NULL OR status NOT IN ('rejected', 'outdated', 'potentially_stale'))
            ${applyAsOfChapter ? 'AND (firstSeenChapter IS NULL OR firstSeenChapter <= ?)' : ''}
          ORDER BY importance DESC, canonicalName ASC
        `,
        ...branchIds,
        ...(applyAsOfChapter ? [asOfChapter!] : [])
      )
    ),
    Promise.resolve(
        queryAll<{
          id: string
          sourceEntityId: string
          targetEntityId: string
          relationType: string
          strength: number
          validUntilChapter: number
          polarity: string | null
          sourceChapter: number
          sourceNovelId: string
        }>(
          `
            SELECT r.id, r.sourceEntityId, r.targetEntityId, r.relationType, r.strength, r.validUntilChapter, r.polarity, r.sourceChapter,
                   se.novelId as sourceNovelId
            FROM KnowledgeRelation r
            JOIN KnowledgeEntity se ON se.id = r.sourceEntityId
            JOIN KnowledgeEntity te ON te.id = r.targetEntityId
            WHERE r.branchId IN (${placeholders}) AND r.status NOT IN ('rejected', 'outdated', 'potentially_stale')
              AND se.entityType = 'character' AND se.importanceTier IN ('protagonist', 'important', 'arc')
              AND te.entityType = 'character' AND te.importanceTier IN ('protagonist', 'important', 'arc')
              AND (se.status IS NULL OR se.status NOT IN ('rejected', 'outdated', 'potentially_stale'))
              AND (te.status IS NULL OR te.status NOT IN ('rejected', 'outdated', 'potentially_stale'))
              ${applyAsOfChapter ? `AND r.validFromChapter <= ? AND r.validUntilChapter > ?` : ''}
            ORDER BY r.sourceChapter ASC, r.strength DESC
          `,
          ...branchIds,
          ...(applyAsOfChapter ? [asOfChapter!, asOfChapter!] : [])
        )
      ),
    Promise.resolve(
      queryAll<{ id: string; novelId: string; term: string; category: string | null; definition: string }>(
        `
          SELECT id, novelId, term, category, definition
          FROM KnowledgeWorld
          WHERE branchId IN (${placeholders}) AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
            ${applyAsOfChapter ? `AND validFromChapter <= ? AND validUntilChapter > ?` : ''}
          ORDER BY firstSeenChapter ASC, term ASC
        `,
        ...branchIds,
        ...(applyAsOfChapter ? [asOfChapter!, asOfChapter!] : [])
      )
    ),
    Promise.resolve(
      queryAll<{ id: string; novelId: string; name: string; summary: string; chapterNo: number }>(
        `
          SELECT id, novelId, name, summary, chapterNo
          FROM KnowledgeEvent
          WHERE branchId IN (${placeholders}) AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
            ${applyAsOfChapter ? 'AND chapterNo <= ?' : ''}
          ORDER BY chapterNo ASC, importance DESC
        `,
        ...branchIds,
        ...(applyAsOfChapter ? [asOfChapter!] : [])
      )
    ),
    Promise.resolve(
      queryAll<{ id: string; novelId: string; predicate: string; valueJson: string | null; sourceChapter: number }>(
        `
          SELECT id, novelId, predicate, valueJson, sourceChapter
          FROM KnowledgeFact
          WHERE branchId IN (${placeholders}) AND factType = 'open_thread' AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
            ${applyAsOfChapter ? `AND validFromChapter <= ? AND validUntilChapter > ?` : ''}
          ORDER BY sourceChapter ASC
        `,
        ...branchIds,
        ...(applyAsOfChapter ? [asOfChapter!, asOfChapter!] : [])
      )
    ),
  ])

  const chapterIdByNovelAndNo = new Map<string, string>()
  for (const chapter of chapters) {
    chapterIdByNovelAndNo.set(`${chapter.novelId}:${chapter.chapterNo}`, chapter.id)
  }

  const characterProfileByEntityId = loadCharacterProfilesByEntityId(entities.map((entity) => entity.id), applyAsOfChapter ? asOfChapter : undefined)
  const characterStateByEntityId = loadCharacterStatesByEntityId(entities.map((entity) => entity.id), applyAsOfChapter ? asOfChapter : undefined)
  const characterAliasesByEntityId = loadCharacterAliasesByEntityId(entities.map((entity) => entity.id))

  const localCharacters: Character[] = entities.map((entity) => {
    const profile = characterProfileByEntityId.get(entity.id)
    const state = characterStateByEntityId.get(entity.id)
    const classification = getCharacterClassificationMetadata(entity.importanceTier)
    const projected = projectCharacterCompatibilityFields(profile, state, entity.importance)
    return {
      id: entity.id,
      novelId: entity.novelId,
      name: entity.canonicalName,
      role: projected.role,
      goal: projected.goal,
      trait: projected.trait,
      note: projected.note || buildCharacterDescriptionDelta(profile ?? {}, state?.description ?? ''),
      profile,
      aliases: characterAliasesByEntityId.get(entity.id) ?? [],
      importanceTier: entity.importanceTier,
      classificationKey: classification?.key ?? null,
      classificationLabel: classification?.label ?? null,
    }
  })

  const localCharacterRelations: CharacterRelation[] = dedupeById(
    relations
      .filter((relation) => !isGenericRelationLabel(relation.relationType))
      .map((relation) => ({
        id: relation.id,
        novelId: relation.sourceNovelId,
        fromCharacterId: relation.sourceEntityId,
        toCharacterId: relation.targetEntityId,
        label: relation.relationType,
        strength: toRelationStrength(relation.strength),
        status: toRelationStatus(relation.polarity),
        note: relation.polarity ? `极性：${relation.polarity}` : '',
        chapterIds: chapterIdByNovelAndNo.get(`${relation.sourceNovelId}:${relation.sourceChapter}`)
          ? [chapterIdByNovelAndNo.get(`${relation.sourceNovelId}:${relation.sourceChapter}`)!]
          : [],
      }))
  )

  const localWorldEntries: WorldEntry[] = worlds.map((world) => ({
    id: world.id,
    novelId: world.novelId,
    title: world.term,
    type: toWorldEntryType(world.category),
    content: world.definition,
  }))

  const localTimelineEvents: TimelineEvent[] = events.map((event, index) => ({
    id: event.id,
    novelId: event.novelId,
    title: event.name,
    phase: `第 ${event.chapterNo} 章`,
    worldline: '主线',
    summary: event.summary,
    order: index + 1,
    chapterIds: chapterIdByNovelAndNo.get(`${event.novelId}:${event.chapterNo}`)
      ? [chapterIdByNovelAndNo.get(`${event.novelId}:${event.chapterNo}`)!]
      : [],
  }))

  const localOutlines: OutlineItem[] = openThreadFacts.map((fact) => {
    let summary = fact.predicate
    if (fact.valueJson) {
      try {
        const parsed = JSON.parse(fact.valueJson) as { description?: string }
        summary = parsed.description?.trim() || summary
      } catch {
      }
    }

    return {
      id: fact.id,
      novelId: fact.novelId,
      title: fact.predicate,
      type: 'foreshadow',
      summary,
      relatedChapterIds: chapterIdByNovelAndNo.get(`${fact.novelId}:${fact.sourceChapter}`)
        ? [chapterIdByNovelAndNo.get(`${fact.novelId}:${fact.sourceChapter}`)!]
        : [],
    }
  })

  return {
    localCharacters,
    localCharacterRelations,
    localWorldEntries,
    localTimelineEvents,
    localOutlines,
    knowledgeRebuildStatus,
    hanlpCacheSnapshot,
  }
}

export async function rebuildAuthoritativeKnowledgeView(novelId: string, chapterRange?: KnowledgeRebuildChapterRange): Promise<KnowledgeViewActionPayload> {
  if (!novelId.trim()) {
    return createIdleActionPayload()
  }

  const rebuildResult = await startKnowledgeRebuildForNovel({
    novelId,
    branchId: getMainBranchId(novelId),
    chapterRange,
  })

  return {
    ...(await buildKnowledgeProjection([novelId])),
    jobOutcome: rebuildResult.outcome,
    actionError: null,
  }
}

export async function runAuthoritativeKnowledgeViewRebuild(novelId: string, jobId: string) {
  const normalizedNovelId = novelId.trim()
  const normalizedJobId = jobId.trim()
  if (!normalizedNovelId || !normalizedJobId) return

  await runStartedKnowledgeRebuildForNovel({
    novelId: normalizedNovelId,
    branchId: getMainBranchId(normalizedNovelId),
    jobId: normalizedJobId,
  })
}

export async function pauseAuthoritativeKnowledgeRebuild(novelId: string): Promise<KnowledgeViewActionPayload> {
  if (!novelId.trim()) {
    return createIdleActionPayload()
  }

  const jobOutcome = await pauseKnowledgeRebuildForNovel({
    novelId,
    branchId: getMainBranchId(novelId),
  })

  return {
    ...(await buildKnowledgeProjection([novelId])),
    jobOutcome,
    actionError: null,
  }
}

export async function abortAuthoritativeKnowledgeRebuild(novelId: string): Promise<KnowledgeViewActionPayload> {
  if (!novelId.trim()) {
    return createIdleActionPayload()
  }

  const jobOutcome = await abortKnowledgeRebuildForNovel({
    novelId,
    branchId: getMainBranchId(novelId),
  })

  return {
    ...(await buildKnowledgeProjection([novelId])),
    jobOutcome,
    actionError: null,
  }
}

export async function deleteAuthoritativeKnowledgeGraph(novelId: string): Promise<KnowledgeViewActionPayload> {
  if (!novelId.trim()) {
    return createIdleActionPayload()
  }

  const jobOutcome = await deleteKnowledgeGraphForNovel({
    novelId,
    branchId: getMainBranchId(novelId),
  })

  return {
    ...(await buildKnowledgeProjection([novelId])),
    jobOutcome,
    actionError: null,
  }
}

export async function deleteAuthoritativeHanlpCache(novelId: string): Promise<KnowledgeViewActionPayload> {
  return deleteHanlpCacheForNovel(novelId)
}

export async function deleteAuthoritativeExtractionCache(novelId: string): Promise<KnowledgeViewActionPayload> {
  return deleteExtractionCacheForNovel(novelId)
}

export async function deleteAuthoritativeEmbeddingCache(novelId: string): Promise<KnowledgeViewActionPayload> {
  return deleteEmbeddingCacheForNovel(novelId)
}
