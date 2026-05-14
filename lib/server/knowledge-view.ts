import type { Character, CharacterRelation, OutlineItem, TimelineEvent, WorldEntry, WorldEntryType } from '@/lib/types'
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
  pauseKnowledgeRebuildForNovel,
  rebuildKnowledgeForNovel,
} from '@/lib/server/knowledge-rebuild'
import { getMainBranchId } from '@/lib/server/knowledge-store'
import { queryAll } from '@/lib/server/sqlite'

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
  progress: number
  currentStep: string | null
  createdAt: string
  updatedAt: string
  etaMinutes: number | null
  steps: KnowledgeRebuildPayloadStep[]
}

export type KnowledgeViewPayload = KnowledgeProjectionPayload & {
  knowledgeRebuildStatus: KnowledgeRebuildStatus | null
}

export type KnowledgeViewActionOutcome = KnowledgeRebuildJobOutcome | 'deleted' | 'idle'

export type KnowledgeViewActionPayload = KnowledgeViewPayload & {
  jobOutcome: KnowledgeViewActionOutcome
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

  const status = queryAll<KnowledgeRebuildStatusRow>(
    `
      SELECT id as jobId, novelId, status, progress, currentStep, createdAt, updatedAt
           , payloadJson
      FROM KnowledgeJob
      WHERE novelId = ? AND jobType = 'extract_chapter_knowledge' AND status IN ('queued', 'running', 'paused')
      ORDER BY updatedAt DESC, createdAt DESC
      LIMIT 1
    `,
    novelIds[0]
  )[0] ?? null

  if (!status) {
    return null
  }

  const steps = parseKnowledgeRebuildSteps(status.payloadJson)
  const activeStep = steps.find((step) => step.status === 'running' || step.status === 'paused') ?? null

  return {
    ...status,
    etaMinutes: status.status === 'paused'
      ? null
      : activeStep?.etaMinutes ?? estimateRebuildEtaMinutes(status.progress, status.createdAt),
    steps,
  }
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
  const role = profile?.identity?.summary?.trim() || (importance >= 4 ? '主要人物' : '角色')
  const goal = profile?.capability?.summary?.trim() || profile?.likes?.summary?.trim() || '待补充'
  const trait = profile?.personality?.summary?.trim() || (state?.stateValue ? `状态：${state.stateValue}` : '待补充')
  const safeProfile = profile
  const note = safeProfile && hasCharacterRoleCardProfile(safeProfile)
    ? buildCharacterRoleCardLines(safeProfile, { includeEvidence: false, includeNotes: true }).slice(3).join('｜')
    : (state?.description?.trim() || '')
  return { role, goal, trait, note }
}

export async function buildKnowledgeProjection(novelIds?: string[], asOfChapter?: number): Promise<KnowledgeViewPayload> {
  const novels = novelIds?.length
    ? queryAll<{ id: string }>(
        `SELECT id FROM NovelRecord WHERE id IN (${novelIds.map(() => '?').join(', ')})`,
        ...novelIds
      )
    : queryAll<{ id: string }>('SELECT id FROM NovelRecord')

  if (!novels.length) {
    return {
      ...createEmptyProjection(),
      knowledgeRebuildStatus: getKnowledgeRebuildStatus(novelIds),
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
        importance: number
      }>(
        `
          SELECT id, novelId, canonicalName, description, status, importance
          FROM KnowledgeEntity
          WHERE branchId IN (${placeholders}) AND entityType = 'character'
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
            WHERE r.branchId IN (${placeholders}) AND r.status NOT IN ('rejected', 'outdated', 'potentially_stale')
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

  const localCharacters: Character[] = entities.map((entity) => {
    const profile = characterProfileByEntityId.get(entity.id)
    const state = characterStateByEntityId.get(entity.id)
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
    knowledgeRebuildStatus: getKnowledgeRebuildStatus(novelIds),
  }
}

export async function rebuildAuthoritativeKnowledgeView(novelId: string): Promise<KnowledgeViewActionPayload> {
  if (!novelId.trim()) {
    return {
      ...createEmptyProjection(),
      knowledgeRebuildStatus: null,
      jobOutcome: 'idle',
    }
  }

  const rebuildResult = await rebuildKnowledgeForNovel({
    novelId,
    branchId: getMainBranchId(novelId),
  })

  return {
    ...(await buildKnowledgeProjection([novelId])),
    jobOutcome: rebuildResult.outcome,
  }
}

export async function pauseAuthoritativeKnowledgeRebuild(novelId: string): Promise<KnowledgeViewActionPayload> {
  if (!novelId.trim()) {
    return {
      ...createEmptyProjection(),
      knowledgeRebuildStatus: null,
      jobOutcome: 'idle',
    }
  }

  const jobOutcome = await pauseKnowledgeRebuildForNovel({
    novelId,
    branchId: getMainBranchId(novelId),
  })

  return {
    ...(await buildKnowledgeProjection([novelId])),
    jobOutcome,
  }
}

export async function abortAuthoritativeKnowledgeRebuild(novelId: string): Promise<KnowledgeViewActionPayload> {
  if (!novelId.trim()) {
    return {
      ...createEmptyProjection(),
      knowledgeRebuildStatus: null,
      jobOutcome: 'idle',
    }
  }

  const jobOutcome = await abortKnowledgeRebuildForNovel({
    novelId,
    branchId: getMainBranchId(novelId),
  })

  return {
    ...(await buildKnowledgeProjection([novelId])),
    jobOutcome,
  }
}

export async function deleteAuthoritativeKnowledgeGraph(novelId: string): Promise<KnowledgeViewActionPayload> {
  if (!novelId.trim()) {
    return {
      ...createEmptyProjection(),
      knowledgeRebuildStatus: null,
      jobOutcome: 'idle',
    }
  }

  const jobOutcome = await deleteKnowledgeGraphForNovel({
    novelId,
    branchId: getMainBranchId(novelId),
  })

  return {
    ...(await buildKnowledgeProjection([novelId])),
    jobOutcome,
  }
}
