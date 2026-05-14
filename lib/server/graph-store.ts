import { execute, queryAll, queryOne, withTransaction } from '@/lib/server/sqlite'
import { deleteBranchRetrievalIndexFromChapter } from '@/lib/server/retrieval-index'
import type {
  EntityLinkRow,
  EntityStateRow,
  EventLinkRow,
  GraphContextCacheRow,
  GraphEdge,
  GraphNode,
  LinkStatus,
} from '@/lib/server/graph-types'
import { uid } from '@/lib/utils'

type ActiveGraphQueryParams = {
  novelId: string
  branchId: string
  chapterNo: number
  includeLowConfidence?: boolean
  includePotentiallyStale?: boolean
  confirmedOnly?: boolean
}

type GraphContextCacheRecord = {
  id: string
  novelId: string
  branchId: string
  cacheKey: string
  asOfChapter: number
  seedEntityIds: string[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  contextText: string
  sourceHash: string
  createdAt: string
  updatedAt: string
}

type KnowledgeRelationMatchRow = {
  id: string
}

type EntityLinkEditParams = {
  id: string
  linkType?: string
  label?: string | null
  description?: string | null
  polarity?: EntityLinkRow['polarity']
  strength?: number
  validFromChapter?: number
  validToChapter?: number | null
  includeByDefault?: boolean
}

function appendStatusFilters(baseSql: string, includePotentiallyStale: boolean) {
  return includePotentiallyStale
    ? `${baseSql} AND status NOT IN ('rejected', 'outdated')`
    : `${baseSql} AND status NOT IN ('rejected', 'outdated', 'potentially_stale')`
}

function appendConfidenceFilter(baseSql: string, includeLowConfidence: boolean) {
  return includeLowConfidence ? baseSql : `${baseSql} AND confidence >= 0.4`
}

function appendGenericRelationFilter(baseSql: string, columnName: string) {
  return `${baseSql} AND TRIM(${columnName}) NOT IN ('', '关系', '人物关系', '角色关系', '关联', '联系', '相关')`
}

function appendConfirmedOnlyFilter(baseSql: string, confirmedOnly: boolean) {
  return confirmedOnly ? `${baseSql} AND status = 'user_confirmed'` : baseSql
}

function parseJsonArray<T>(value: string, fallback: T[]): T[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as T[]) : fallback
  } catch {
    return fallback
  }
}

export function loadActiveEntityLinks(params: ActiveGraphQueryParams) {
  const sql = appendConfidenceFilter(
    appendGenericRelationFilter(
      appendConfirmedOnlyFilter(
        appendStatusFilters(
          `
            SELECT id, novelId, branchId, sourceEntityId, targetEntityId, linkType, label, description,
                   polarity, strength, weight, sourceChapter, validFromChapter, validToChapter,
                   evidenceSpanId, evidenceQuote, confidence, status, includeByDefault
            FROM EntityLink
            WHERE novelId = ? AND branchId = ? AND validFromChapter <= ?
              AND (validToChapter IS NULL OR validToChapter >= ?)
          `,
          params.includePotentiallyStale ?? false
        ),
        params.confirmedOnly ?? false
      ),
      'linkType'
    ),
    params.includeLowConfidence ?? false
  )

  return queryAll<EntityLinkRow>(sql, params.novelId, params.branchId, params.chapterNo, params.chapterNo)
}

export function loadActiveEntityStates(params: ActiveGraphQueryParams) {
  const sql = appendConfidenceFilter(
    appendConfirmedOnlyFilter(
      appendStatusFilters(
        `
          SELECT id, novelId, branchId, entityId, stateType, stateValue, description, sourceChapter,
                 validFromChapter, validToChapter, evidenceSpanId, evidenceQuote, confidence, status, includeByDefault
          FROM EntityState
          WHERE novelId = ? AND branchId = ? AND validFromChapter <= ?
            AND (validToChapter IS NULL OR validToChapter >= ?)
        `,
        params.includePotentiallyStale ?? false
      ),
      params.confirmedOnly ?? false
    ),
    params.includeLowConfidence ?? false
  )

  return queryAll<EntityStateRow>(sql, params.novelId, params.branchId, params.chapterNo, params.chapterNo)
}

export function loadActiveEventLinks(params: ActiveGraphQueryParams) {
  const sql = appendConfidenceFilter(
    appendStatusFilters(
      `
        SELECT id, novelId, branchId, sourceEventId, targetEventId, linkType, label, description,
               sourceChapter, validFromChapter, evidenceSpanId, evidenceQuote, confidence, status
        FROM EventLink
        WHERE novelId = ? AND branchId = ? AND validFromChapter <= ?
      `,
      params.includePotentiallyStale ?? false
    ),
    params.includeLowConfidence ?? false
  )

  return queryAll<EventLinkRow>(sql, params.novelId, params.branchId, params.chapterNo)
}

export function getGraphContextCache(params: {
  novelId: string
  branchId: string
  cacheKey: string
  asOfChapter: number
}) {
  const row = queryOne<GraphContextCacheRow>(
    `
      SELECT id, novelId, branchId, cacheKey, asOfChapter, seedEntityIdsJson, graphNodesJson,
             graphEdgesJson, contextText, sourceHash, createdAt, updatedAt
      FROM GraphContextCache
      WHERE novelId = ? AND branchId = ? AND cacheKey = ? AND asOfChapter = ?
      LIMIT 1
    `,
    params.novelId,
    params.branchId,
    params.cacheKey,
    params.asOfChapter
  )

  if (!row) {
    return null
  }

  return {
    id: row.id,
    novelId: row.novelId,
    branchId: row.branchId,
    cacheKey: row.cacheKey,
    asOfChapter: row.asOfChapter,
    seedEntityIds: parseJsonArray<string>(row.seedEntityIdsJson, []),
    nodes: parseJsonArray<GraphNode>(row.graphNodesJson, []),
    edges: parseJsonArray<GraphEdge>(row.graphEdgesJson, []),
    contextText: row.contextText,
    sourceHash: row.sourceHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } satisfies GraphContextCacheRecord
}

export function saveGraphContextCache(params: {
  novelId: string
  branchId: string
  cacheKey: string
  asOfChapter: number
  seedEntityIds: string[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  contextText: string
  sourceHash: string
}) {
  const existing = queryOne<{ id: string }>(
    'SELECT id FROM GraphContextCache WHERE branchId = ? AND cacheKey = ? AND asOfChapter = ? LIMIT 1',
    params.branchId,
    params.cacheKey,
    params.asOfChapter
  )

  const id = existing?.id ?? uid('graph-cache')
  execute(
    `
      INSERT INTO GraphContextCache (
        id, novelId, branchId, cacheKey, asOfChapter, seedEntityIdsJson,
        graphNodesJson, graphEdgesJson, contextText, sourceHash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(branchId, cacheKey, asOfChapter) DO UPDATE SET
        novelId = excluded.novelId,
        seedEntityIdsJson = excluded.seedEntityIdsJson,
        graphNodesJson = excluded.graphNodesJson,
        graphEdgesJson = excluded.graphEdgesJson,
        contextText = excluded.contextText,
        sourceHash = excluded.sourceHash,
        updatedAt = CURRENT_TIMESTAMP
    `,
    id,
    params.novelId,
    params.branchId,
    params.cacheKey,
    params.asOfChapter,
    JSON.stringify(params.seedEntityIds),
    JSON.stringify(params.nodes),
    JSON.stringify(params.edges),
    params.contextText,
    params.sourceHash
  )

  return id
}

export function invalidateGraphContextCacheFromChapter(params: {
  novelId: string
  branchId: string
  fromChapterNo: number
}) {
  execute(
    'DELETE FROM GraphContextCache WHERE novelId = ? AND branchId = ? AND asOfChapter >= ?',
    params.novelId,
    params.branchId,
    params.fromChapterNo
  )
}

export function updateEntityLinkStatus(params: { id: string; status: LinkStatus; includeByDefault?: boolean }) {
  const includeByDefault =
    params.includeByDefault === undefined
      ? null
      : params.includeByDefault
        ? 1
        : 0

  execute(
    `
      UPDATE EntityLink
      SET status = ?, includeByDefault = COALESCE(?, includeByDefault), updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    params.status,
    includeByDefault,
    params.id
  )
}

export function loadEntityLinkById(id: string) {
  return queryOne<EntityLinkRow>(
    `
      SELECT id, novelId, branchId, sourceEntityId, targetEntityId, linkType, label, description,
             polarity, strength, weight, sourceChapter, validFromChapter, validToChapter,
             evidenceSpanId, evidenceQuote, confidence, status, includeByDefault
      FROM EntityLink
      WHERE id = ?
      LIMIT 1
    `,
    id
  )
}

function loadMatchingKnowledgeRelationIds(link: EntityLinkRow) {
  return queryAll<KnowledgeRelationMatchRow>(
    `
      SELECT id
      FROM KnowledgeRelation
      WHERE novelId = ?
        AND branchId = ?
        AND sourceEntityId = ?
        AND targetEntityId = ?
        AND relationType = ?
        AND sourceChapter = ?
        AND validFromChapter = ?
        AND ((validToChapter IS NULL AND ? IS NULL) OR validToChapter = ?)
        AND ((evidenceSpanId IS NULL AND ? IS NULL) OR evidenceSpanId = ?)
    `,
    link.novelId,
    link.branchId,
    link.sourceEntityId,
    link.targetEntityId,
    link.linkType,
    link.sourceChapter,
    link.validFromChapter,
    link.validToChapter,
    link.validToChapter,
    link.evidenceSpanId,
    link.evidenceSpanId
  )
}

async function markDownstreamGraphArtifactsStale(params: { novelId: string; branchId: string; fromChapterNo: number }) {
  execute(
    `
      UPDATE ChapterSnapshot
      SET status = 'stale', updatedAt = CURRENT_TIMESTAMP
      WHERE novelId = ? AND branchId = ? AND chapterNo >= ?
    `,
    params.novelId,
    params.branchId,
    params.fromChapterNo
  )

  execute(
    'DELETE FROM GraphContextCache WHERE novelId = ? AND branchId = ? AND asOfChapter >= ?',
    params.novelId,
    params.branchId,
    params.fromChapterNo
  )

  await deleteBranchRetrievalIndexFromChapter(params.branchId, params.fromChapterNo)
}

function requireSingleKnowledgeRelationId(link: EntityLinkRow) {
  const matches = loadMatchingKnowledgeRelationIds(link)
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one matching KnowledgeRelation for edge ${link.id}, found ${matches.length}`)
  }

  return matches[0]!.id
}

export async function confirmEntityLink(id: string) {
  const link = loadEntityLinkById(id)
  if (!link) return null

  await withTransaction(async () => {
    const relationId = requireSingleKnowledgeRelationId(link)

    execute(
      `
        UPDATE EntityLink
        SET status = 'user_confirmed',
            confidence = CASE WHEN confidence < 0.95 THEN 0.95 ELSE confidence END,
            includeByDefault = 1,
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      id
    )

    execute(
      `
        UPDATE KnowledgeRelation
        SET status = 'user_confirmed',
            confidence = CASE WHEN confidence < 0.95 THEN 0.95 ELSE confidence END,
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      relationId
    )

    await markDownstreamGraphArtifactsStale({
      novelId: link.novelId,
      branchId: link.branchId,
      fromChapterNo: link.validFromChapter,
    })
  })

  return loadEntityLinkById(id)
}

export async function rejectEntityLink(id: string) {
  const link = loadEntityLinkById(id)
  if (!link) return null

  await withTransaction(async () => {
    const relationId = requireSingleKnowledgeRelationId(link)

    execute(
      `
        UPDATE EntityLink
        SET status = 'rejected', includeByDefault = 0, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      id
    )

    execute(
      `
        UPDATE KnowledgeRelation
        SET status = 'rejected', updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      relationId
    )

    await markDownstreamGraphArtifactsStale({
      novelId: link.novelId,
      branchId: link.branchId,
      fromChapterNo: link.validFromChapter,
    })
  })

  return loadEntityLinkById(id)
}

export async function editEntityLink(params: EntityLinkEditParams) {
  const link = loadEntityLinkById(params.id)
  if (!link) return null

  const nextLinkType = params.linkType ?? link.linkType
  const nextPolarity = params.polarity === undefined ? link.polarity : params.polarity
  const nextStrength = params.strength ?? link.strength
  const nextValidFromChapter = params.validFromChapter ?? link.validFromChapter
  const nextValidToChapter = params.validToChapter === undefined ? link.validToChapter : params.validToChapter
  const nextLabel = params.label === undefined ? link.label : params.label
  const nextDescription = params.description === undefined ? link.description : params.description
  const nextIncludeByDefault = params.includeByDefault === undefined ? link.includeByDefault : params.includeByDefault ? 1 : 0
  const affectedFromChapter = Math.min(link.validFromChapter, nextValidFromChapter)

  await withTransaction(async () => {
    const relationId = requireSingleKnowledgeRelationId(link)

    execute(
      `
        UPDATE EntityLink
        SET linkType = ?,
            label = ?,
            description = ?,
            polarity = ?,
            strength = ?,
            validFromChapter = ?,
            validToChapter = ?,
            includeByDefault = ?,
            status = 'user_confirmed',
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      nextLinkType,
      nextLabel,
      nextDescription,
      nextPolarity,
      nextStrength,
      nextValidFromChapter,
      nextValidToChapter,
      nextIncludeByDefault,
      params.id
    )

    execute(
      `
        UPDATE KnowledgeRelation
        SET relationType = ?,
            polarity = ?,
            strength = ?,
            validFromChapter = ?,
            validToChapter = ?,
            status = 'user_confirmed',
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      nextLinkType,
      nextPolarity,
      nextStrength,
      nextValidFromChapter,
      nextValidToChapter,
      relationId
    )

    await markDownstreamGraphArtifactsStale({
      novelId: link.novelId,
      branchId: link.branchId,
      fromChapterNo: affectedFromChapter,
    })
  })

  return loadEntityLinkById(params.id)
}

export function loadEntityLinksByEntityIds(params: ActiveGraphQueryParams & { entityIds: string[]; limit?: number }) {
  const limit = params.limit ?? 40
  const entityFilter = params.entityIds.length
    ? `AND (sourceEntityId IN (${params.entityIds.map(() => '?').join(', ')}) OR targetEntityId IN (${params.entityIds.map(() => '?').join(', ')}))`
    : ''
  const statusFilter = params.includePotentiallyStale ?? false
    ? "status NOT IN ('rejected', 'outdated')"
    : "status NOT IN ('rejected', 'outdated', 'potentially_stale')"
  const confidenceFilter = params.includeLowConfidence ?? false ? '' : 'AND confidence >= 0.4'
  const confirmedOnlyFilter = params.confirmedOnly ? "AND status = 'user_confirmed'" : ''
  const genericRelationFilter = "AND TRIM(linkType) NOT IN ('', '关系', '人物关系', '角色关系', '关联', '联系', '相关')"

  return queryAll<EntityLinkRow>(
    `
      SELECT id, novelId, branchId, sourceEntityId, targetEntityId, linkType, label, description,
             polarity, strength, weight, sourceChapter, validFromChapter, validToChapter,
             evidenceSpanId, evidenceQuote, confidence, status, includeByDefault
      FROM EntityLink
      WHERE novelId = ? AND branchId = ? AND validFromChapter <= ?
        AND (validToChapter IS NULL OR validToChapter >= ?)
        AND ${statusFilter}
        ${confidenceFilter}
        ${confirmedOnlyFilter}
        ${genericRelationFilter}
        ${entityFilter}
      ORDER BY sourceChapter DESC, strength DESC, confidence DESC
      LIMIT ?
    `,
    params.novelId,
    params.branchId,
    params.chapterNo,
    params.chapterNo,
    ...params.entityIds,
    ...params.entityIds,
    limit
  )
}

export function loadEntityStatesByEntityIds(params: ActiveGraphQueryParams & { entityIds: string[]; limit?: number }) {
  const limit = params.limit ?? 40
  const entityFilter = params.entityIds.length
    ? `AND entityId IN (${params.entityIds.map(() => '?').join(', ')})`
    : ''
  const statusFilter = params.includePotentiallyStale ?? false
    ? "status NOT IN ('rejected', 'outdated')"
    : "status NOT IN ('rejected', 'outdated', 'potentially_stale')"
  const confidenceFilter = params.includeLowConfidence ?? false ? '' : 'AND confidence >= 0.4'
  const confirmedOnlyFilter = params.confirmedOnly ? "AND status = 'user_confirmed'" : ''

  return queryAll<EntityStateRow>(
    `
      SELECT id, novelId, branchId, entityId, stateType, stateValue, description, sourceChapter,
             validFromChapter, validToChapter, evidenceSpanId, evidenceQuote, confidence, status, includeByDefault
      FROM EntityState
      WHERE novelId = ? AND branchId = ? AND validFromChapter <= ?
        AND (validToChapter IS NULL OR validToChapter >= ?)
        AND ${statusFilter}
        ${confidenceFilter}
        ${confirmedOnlyFilter}
        ${entityFilter}
      ORDER BY sourceChapter DESC, confidence DESC
      LIMIT ?
    `,
    params.novelId,
    params.branchId,
    params.chapterNo,
    params.chapterNo,
    ...params.entityIds,
    limit
  )
}
