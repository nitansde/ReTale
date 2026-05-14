import type { Character, CharacterRelation, OutlineItem, TimelineEvent, WorldEntry, WorldEntryType } from '@/lib/types'
import {
  abortKnowledgeRebuildForNovel,
  deleteKnowledgeGraphForNovel,
  type KnowledgeRebuildJobOutcome,
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

type KnowledgeRebuildStatusRow = Omit<KnowledgeRebuildStatus, 'etaMinutes'>

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

  return {
    ...status,
    etaMinutes: status.status === 'paused' ? null : estimateRebuildEtaMinutes(status.progress, status.createdAt),
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

function toRelationStatus(validToChapter: number | null, polarity: string | null) {
  if (validToChapter !== null) return 'resolved' as const
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

export async function buildKnowledgeProjection(novelIds?: string[]): Promise<KnowledgeViewPayload> {
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
          ORDER BY importance DESC, canonicalName ASC
        `,
        ...branchIds
      )
    ),
    Promise.resolve(
      queryAll<{
        id: string
        sourceEntityId: string
        targetEntityId: string
        relationType: string
        strength: number
        validToChapter: number | null
        polarity: string | null
        sourceChapter: number
        sourceNovelId: string
      }>(
        `
          SELECT r.id, r.sourceEntityId, r.targetEntityId, r.relationType, r.strength, r.validToChapter, r.polarity, r.sourceChapter,
                 se.novelId as sourceNovelId
          FROM KnowledgeRelation r
          JOIN KnowledgeEntity se ON se.id = r.sourceEntityId
          WHERE r.branchId IN (${placeholders}) AND r.status != 'rejected'
          ORDER BY r.sourceChapter ASC, r.strength DESC
        `,
        ...branchIds
      )
    ),
    Promise.resolve(
      queryAll<{ id: string; novelId: string; term: string; category: string | null; definition: string }>(
        `
          SELECT id, novelId, term, category, definition
          FROM KnowledgeWorld
          WHERE branchId IN (${placeholders}) AND status != 'rejected'
          ORDER BY firstSeenChapter ASC, term ASC
        `,
        ...branchIds
      )
    ),
    Promise.resolve(
      queryAll<{ id: string; novelId: string; name: string; summary: string; chapterNo: number }>(
        `
          SELECT id, novelId, name, summary, chapterNo
          FROM KnowledgeEvent
          WHERE branchId IN (${placeholders}) AND status != 'rejected'
          ORDER BY chapterNo ASC, importance DESC
        `,
        ...branchIds
      )
    ),
    Promise.resolve(
      queryAll<{ id: string; novelId: string; predicate: string; valueJson: string | null; sourceChapter: number }>(
        `
          SELECT id, novelId, predicate, valueJson, sourceChapter
          FROM KnowledgeFact
          WHERE branchId IN (${placeholders}) AND factType = 'open_thread' AND status != 'rejected'
          ORDER BY sourceChapter ASC
        `,
        ...branchIds
      )
    ),
  ])

  const chapterIdByNovelAndNo = new Map<string, string>()
  for (const chapter of chapters) {
    chapterIdByNovelAndNo.set(`${chapter.novelId}:${chapter.chapterNo}`, chapter.id)
  }

  const localCharacters: Character[] = entities.map((entity) => ({
    id: entity.id,
    novelId: entity.novelId,
    name: entity.canonicalName,
    role: entity.importance >= 4 ? '主要人物' : '角色',
    goal: '待从知识库中补充',
    trait: entity.status ? `状态：${entity.status}` : '待补充',
    note: entity.description ?? '',
  }))

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
        status: toRelationStatus(relation.validToChapter, relation.polarity),
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
