import path from 'node:path'
import { createHash } from 'node:crypto'
import * as lancedb from '@lancedb/lancedb'
import { estimateTokenCount, type TextSpanInput } from '@/lib/server/knowledge-store'
import { loadStoredAISettings } from '@/lib/server/ai-settings'
import { embedTextsWithOpenAICompatible } from '@/lib/server/openai-compatible'
import { embedTextsWithOllama } from '@/lib/server/ollama-local'
import { queryAll } from '@/lib/server/sqlite'
import {
  buildCharacterDescriptionDelta,
  buildCharacterRoleCardLines,
  hasCharacterRoleCardProfile,
  mergeCharacterRoleCardProfiles,
  normalizeCharacterRoleCardProfile,
  type CharacterRoleCardProfile,
} from '@/lib/story-knowledge'

export type RetrievalDocSourceType =
  | 'text_span'
  | 'chapter_summary'
  | 'entity_profile'
  | 'event_summary'
  | 'worldbuilding'
  | 'relationship'
  | 'open_thread'

type RetrievalDocSeedRow = {
  id: string
  branchId: string
  sourceType: RetrievalDocSourceType
  sourceId: string
  chapterId: string
  chapterNo: number
  validFromChapter: number
  validToChapter: number
  lineStart: number
  lineEnd: number
  spanType: string
  title: string
  sourceLabel: string
  relatedEntityNames: string
  relatedEventNames: string
  relatedTerms: string
  text: string
  status: string
  includeByDefault: number
  tokenEstimate: number | null
  contentHash: string
}

type RetrievalDocRow = RetrievalDocSeedRow & {
  vector: number[]
}

type RetrievalDocSearchRow = RetrievalDocSeedRow & {
  vector?: number[] | Float32Array
  _score?: number
  _distance?: number
  _rowid?: bigint | number
}

type HybridCandidateRow = RetrievalDocSearchRow & {
  rawFtsScore: number
  rawVectorDistance: number | null
}

export type LanceEvidenceMatch = {
  id: string
  sourceType: RetrievalDocSourceType
  sourceId: string
  chapterId: string | null
  chapterNo: number
  lineStart: number | null
  lineEnd: number | null
  title: string | null
  sourceLabel: string
  text: string
  score: number
}

export type LanceEvidenceSearchResult = {
  matches: LanceEvidenceMatch[]
  warning?: string
}

type SourceTruthRow = {
  id: string
  validFromChapter: number
  validToChapter: number
  status: string
  includeByDefault: number
}

const LANCEDB_DIR = process.env.LANCEDB_DIR?.trim() || path.join(process.cwd(), '.lancedb')
const TABLE_PREFIX = 'retrieval_docs_'
const EMBEDDING_BATCH_SIZE = 16
const LANCE_INDEX_UNAVAILABLE_WARNING = 'Lance retrieval index is missing or stale for this branch; rebuild knowledge to refresh retrieval evidence.'

const SOURCE_TYPE_PRIORITY: Record<RetrievalDocSourceType, number> = {
  text_span: 1,
  relationship: 0.92,
  entity_profile: 0.84,
  event_summary: 0.78,
  worldbuilding: 0.72,
  chapter_summary: 0.64,
  open_thread: 0.58,
}

const SOURCE_TYPE_LIMITS: Record<RetrievalDocSourceType, number> = {
  text_span: 5,
  relationship: 2,
  entity_profile: 2,
  event_summary: 2,
  worldbuilding: 2,
  chapter_summary: 1,
  open_thread: 1,
}

function hashValue(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function getBranchTableName(branchId: string) {
  return `${TABLE_PREFIX}${hashValue(branchId).slice(0, 16)}`
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const next: string[] = []

  for (const raw of values) {
    const value = raw?.trim()
    if (!value) continue
    if (seen.has(value)) continue
    seen.add(value)
    next.push(value)
  }

  return next
}

function serializeTerms(values: Array<string | null | undefined>) {
  return uniqueStrings(values).join('\n')
}

function buildContentHash(parts: Array<string | number | null | undefined>) {
  return hashValue(parts.map((part) => (part === null || part === undefined ? '' : String(part))).join('::'))
}

function toVectorValues(value: unknown) {
  if (Array.isArray(value)) {
    return value
  }
  if (ArrayBuffer.isView(value) && 'length' in value && typeof value.length === 'number') {
    return Array.from(value as unknown as ArrayLike<unknown>)
  }
  if (value && typeof value === 'object') {
    const record = value as {
      toArray?: () => ArrayLike<unknown> | Iterable<unknown>
      [Symbol.iterator]?: () => Iterator<unknown>
    }
    if (typeof record.toArray === 'function') {
      return Array.from(record.toArray())
    }
    if (typeof record[Symbol.iterator] === 'function') {
      return Array.from(value as Iterable<unknown>)
    }
  }
  return null
}

function getTextSpanSourceLabel(spanType: string) {
  if (spanType === 'scene') return '相似场景'
  if (spanType === 'summary') return '章节摘录'
  if (spanType === 'paragraph') return '原文段落'
  return '原文证据'
}

function buildRetrievalEmbeddingText(row: RetrievalDocSeedRow) {
  return [
    row.sourceLabel,
    row.title,
    row.relatedEntityNames.replace(/\n/g, ' '),
    row.relatedEventNames.replace(/\n/g, ' '),
    row.relatedTerms.replace(/\n/g, ' '),
    row.text,
  ].filter(Boolean).join('\n')
}

async function embedRetrievalRows(rows: RetrievalDocSeedRow[]) {
  if (!rows.length) return [] as RetrievalDocRow[]

  const settings = loadStoredAISettings().embeddings
  const vectors: number[][] = []
  for (let index = 0; index < rows.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = rows.slice(index, index + EMBEDDING_BATCH_SIZE)
    const result = settings.provider === 'openai-compatible'
      ? await embedTextsWithOpenAICompatible(batch.map(buildRetrievalEmbeddingText), settings.openAICompatible)
      : await embedTextsWithOllama(batch.map(buildRetrievalEmbeddingText), settings.ollama)
    if (!result.enabled || !result.embeddings) {
      throw new Error(result.error || 'Failed to generate retrieval embeddings')
    }
    if (result.embeddings.length !== batch.length) {
      throw new Error(`Ollama returned ${result.embeddings.length} embeddings for ${batch.length} retrieval rows`)
    }
    vectors.push(...result.embeddings)
  }

  const dimension = vectors[0]?.length ?? 0
  if (!dimension || vectors.some((vector) => vector.length !== dimension)) {
    throw new Error('Retrieval embedding dimensions are inconsistent across LanceDB rows')
  }

  return rows.map((row, index) => ({
    ...row,
    vector: vectors[index],
  }))
}

async function embedRetrievalQuery(query: string) {
  const settings = loadStoredAISettings().embeddings
  const result = settings.provider === 'openai-compatible'
    ? await embedTextsWithOpenAICompatible(query, settings.openAICompatible)
    : await embedTextsWithOllama(query, settings.ollama)
  if (!result.enabled || !result.embeddings?.[0]) {
    throw new Error(result.error || 'Failed to generate LanceDB query embedding')
  }
  return result.embeddings[0]
}

function toRetrievalDocRow(span: TextSpanInput): RetrievalDocSeedRow {
  return {
    id: span.id,
    branchId: span.branchId,
    sourceType: 'text_span',
    sourceId: span.id,
    chapterId: span.chapterId,
    chapterNo: span.chapterNo,
    validFromChapter: span.chapterNo,
    validToChapter: -1,
    lineStart: span.lineStart,
    lineEnd: span.lineEnd,
    spanType: span.spanType,
    title: span.spanType,
    sourceLabel: getTextSpanSourceLabel(span.spanType),
    relatedEntityNames: '',
    relatedEventNames: '',
    relatedTerms: serializeTerms([span.spanType]),
    text: span.text,
    status: 'ready',
    includeByDefault: 1,
    tokenEstimate: span.tokenEstimate ?? null,
    contentHash: buildContentHash([
      span.chapterId,
      span.spanType,
      span.lineStart,
      span.lineEnd,
      span.text,
    ]),
  }
}

async function getDatabase() {
  return lancedb.connect(LANCEDB_DIR)
}

async function hasBranchTable(branchId: string) {
  const database = await getDatabase()
  const tableNames = await database.tableNames()
  return tableNames.includes(getBranchTableName(branchId))
}

async function openBranchTable(branchId: string) {
  if (!(await hasBranchTable(branchId))) {
    return null
  }

  const database = await getDatabase()
  return database.openTable(getBranchTableName(branchId))
}

export async function hasBranchRetrievalIndex(branchId: string) {
  return hasBranchTable(branchId)
}

async function ensureTextIndex(table: Awaited<ReturnType<typeof openBranchTable>> extends infer T ? Exclude<T, null> : never) {
  try {
    await table.createIndex('text', {
      config: lancedb.Index.fts(),
    })
  } catch {
  }
}

async function ensureVectorIndex(table: Awaited<ReturnType<typeof openBranchTable>> extends infer T ? Exclude<T, null> : never) {
  try {
    await table.createIndex('vector')
  } catch {
  }
}

function isUsableStoredVector(value: unknown) {
  const values = toVectorValues(value)
  if (!values?.length) {
    return false
  }
  return values.every((item) => Number.isFinite(Number(item)))
}

async function hasUsableVectorColumn(table: Awaited<ReturnType<typeof openBranchTable>> extends infer T ? Exclude<T, null> : never) {
  try {
    const rows = await table.query().limit(1).toArray() as Array<{ vector?: unknown }>
    if (!rows.length) return true
    return isUsableStoredVector(rows[0]?.vector)
  } catch {
    return false
  }
}

async function createOrReplaceBranchTable(branchId: string, rows: RetrievalDocSeedRow[]) {
  const database = await getDatabase()
  const embeddedRows = await embedRetrievalRows(rows)
  const table = await database.createTable(getBranchTableName(branchId), embeddedRows, { mode: 'overwrite' })
  await ensureTextIndex(table)
  await ensureVectorIndex(table)
  return table
}

function loadBranchTextSpans(novelId: string, branchId: string) {
  return queryAll<TextSpanInput>(
    `
      SELECT id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd, charStart, charEnd, text, spanType, tokenEstimate
      FROM TextSpan
      WHERE novelId = ? AND branchId = ?
      ORDER BY chapterNo ASC, lineStart ASC, lineEnd ASC
    `,
    novelId,
    branchId
  )
}

function loadBranchChapterSummaryDocs(novelId: string, branchId: string) {
  return queryAll<{ id: string; chapterNo: number; title: string | null; summary: string | null }>(
    `
      SELECT id, chapterNo, title, summary
      FROM KnowledgeChapter
      WHERE novelId = ? AND branchId = ? AND summary IS NOT NULL AND TRIM(summary) != ''
      ORDER BY chapterNo ASC
    `,
    novelId,
    branchId
  ).map((row) => ({
    id: `chapter-summary:${row.id}`,
    branchId,
    sourceType: 'chapter_summary' as const,
    sourceId: row.id,
    chapterId: row.id,
    chapterNo: row.chapterNo,
    validFromChapter: row.chapterNo,
    validToChapter: -1,
    lineStart: -1,
    lineEnd: -1,
    spanType: '',
    title: row.title?.trim() || `第 ${row.chapterNo} 章`,
    sourceLabel: '章节摘要',
    relatedEntityNames: '',
    relatedEventNames: '',
    relatedTerms: serializeTerms([row.title]),
    text: row.summary?.trim() || '',
    status: 'ready',
    includeByDefault: 1,
    tokenEstimate: estimateTokenCount(row.summary?.trim() || ''),
    contentHash: buildContentHash([row.id, row.chapterNo, row.title, row.summary]),
  }))
}

function loadBranchEntityProfileDocs(novelId: string, branchId: string) {
  const entities = queryAll<{
    id: string
    entityType: string
    canonicalName: string
    description: string | null
    firstSeenChapter: number | null
    lastSeenChapter: number | null
  }>(
    `
      SELECT id, entityType, canonicalName, description, firstSeenChapter, lastSeenChapter
      FROM KnowledgeEntity
      WHERE novelId = ? AND branchId = ?
      ORDER BY firstSeenChapter ASC, canonicalName ASC
    `,
    novelId,
    branchId
  )

  if (!entities.length) return [] as RetrievalDocSeedRow[]

  const entityIds = entities.map((entity) => entity.id)
  const aliases = queryAll<{ entityId: string; alias: string }>(
    `
      SELECT entityId, alias
      FROM EntityAlias
      WHERE entityId IN (${entityIds.map(() => '?').join(', ')})
      ORDER BY sourceChapter ASC, alias ASC
    `,
    ...entityIds
  )

  const aliasesByEntityId = new Map<string, string[]>()
  for (const alias of aliases) {
    const current = aliasesByEntityId.get(alias.entityId) ?? []
    current.push(alias.alias)
    aliasesByEntityId.set(alias.entityId, current)
  }
  const profileRows = queryAll<{ subjectEntityId: string | null; valueJson: string | null; sourceChapter: number; validFromChapter: number | null }>(
    `
      SELECT subjectEntityId, valueJson, sourceChapter, validFromChapter
      FROM KnowledgeFact
      WHERE novelId = ? AND branchId = ? AND factType = 'character_profile'
        AND subjectEntityId IN (${entityIds.map(() => '?').join(', ')})
        AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
      ORDER BY validFromChapter ASC, sourceChapter ASC
    `,
    novelId,
    branchId,
    ...entityIds,
  )
  const profileRowsByEntityId = new Map<string, Array<{ valueJson: string; sourceChapter: number; validFromChapter: number }>>()
  for (const row of profileRows) {
    const entityId = row.subjectEntityId?.trim()
    if (!entityId || !row.valueJson) continue
    const current = profileRowsByEntityId.get(entityId) ?? []
    current.push({
      valueJson: row.valueJson,
      sourceChapter: row.sourceChapter,
      validFromChapter: row.validFromChapter ?? row.sourceChapter,
    })
    profileRowsByEntityId.set(entityId, current)
  }

  return entities.flatMap((entity) => {
    const aliasList = uniqueStrings(aliasesByEntityId.get(entity.id) ?? [])
    const rows = profileRowsByEntityId.get(entity.id) ?? []
    if (!rows.length) {
      const text = [
        `实体：${entity.canonicalName}`,
        `类型：${entity.entityType}`,
        aliasList.length ? `别名：${aliasList.join('、')}` : null,
      ].filter(Boolean).join('\n')
      const chapterNo = entity.firstSeenChapter ?? entity.lastSeenChapter ?? 0
      return [{
        id: `entity-profile:${entity.id}:base`,
        branchId,
        sourceType: 'entity_profile' as const,
        sourceId: entity.id,
        chapterId: '',
        chapterNo,
        validFromChapter: chapterNo,
        validToChapter: -1,
        lineStart: -1,
        lineEnd: -1,
        spanType: '',
        title: entity.canonicalName,
        sourceLabel: '人物卡',
        relatedEntityNames: serializeTerms([entity.canonicalName, ...aliasList]),
        relatedEventNames: '',
        relatedTerms: serializeTerms([entity.canonicalName, entity.entityType, ...aliasList]),
        text,
        status: 'ready',
        includeByDefault: 1,
        tokenEstimate: estimateTokenCount(text),
        contentHash: buildContentHash([entity.id, entity.entityType, entity.canonicalName, aliasList.join('|'), 'base']),
      }]
    }

    let cumulativeProfile: CharacterRoleCardProfile = {}
    return rows.flatMap((row, index) => {
      try {
        const parsed = JSON.parse(row.valueJson) as { profile?: unknown }
        const profile = normalizeCharacterRoleCardProfile(parsed.profile)
        if (!hasCharacterRoleCardProfile(profile)) return []
        cumulativeProfile = mergeCharacterRoleCardProfiles(cumulativeProfile, profile)
        const profileLines = buildCharacterRoleCardLines(cumulativeProfile, { includeEvidence: true, includeNotes: true })
        const compactDescription = buildCharacterDescriptionDelta(cumulativeProfile, '')
        const nextRow = rows[index + 1]
        const validFromChapter = Math.max(0, row.validFromChapter || row.sourceChapter)
        const validToChapter = nextRow ? Math.max(validFromChapter, nextRow.validFromChapter - 1) : -1
        const text = [
          `实体：${entity.canonicalName}`,
          `类型：${entity.entityType}`,
          compactDescription ? `描述：${compactDescription}` : null,
          aliasList.length ? `别名：${aliasList.join('、')}` : null,
          ...profileLines,
        ].filter(Boolean).join('\n')

        return [{
          id: `entity-profile:${entity.id}:${validFromChapter}:${index}`,
          branchId,
          sourceType: 'entity_profile' as const,
          sourceId: entity.id,
          chapterId: '',
          chapterNo: validFromChapter,
          validFromChapter,
          validToChapter,
          lineStart: -1,
          lineEnd: -1,
          spanType: '',
          title: entity.canonicalName,
          sourceLabel: '人物卡',
          relatedEntityNames: serializeTerms([entity.canonicalName, ...aliasList]),
          relatedEventNames: '',
          relatedTerms: serializeTerms([
            entity.canonicalName,
            entity.entityType,
            ...aliasList,
            compactDescription,
            ...profileLines,
          ]),
          text,
          status: 'ready',
          includeByDefault: 1,
          tokenEstimate: estimateTokenCount(text),
          contentHash: buildContentHash([
            entity.id,
            entity.entityType,
            entity.canonicalName,
            validFromChapter,
            validToChapter,
            aliasList.join('|'),
            JSON.stringify(cumulativeProfile),
          ]),
        }]
      } catch {
        return []
      }
    })
  })
}

function loadBranchEventSummaryDocs(novelId: string, branchId: string) {
  const events = queryAll<{
    id: string
    name: string
    summary: string
    eventType: string | null
    chapterNo: number
    lineStart: number | null
    lineEnd: number | null
    consequences: string | null
    status: string
  }>(
    `
      SELECT id, name, summary, eventType, chapterNo, lineStart, lineEnd, consequences, status
      FROM KnowledgeEvent
      WHERE novelId = ? AND branchId = ?
      ORDER BY chapterNo ASC, importance DESC, name ASC
    `,
    novelId,
    branchId
  )

  if (!events.length) return [] as RetrievalDocSeedRow[]

  const eventIds = events.map((event) => event.id)
  const participants = queryAll<{ eventId: string; canonicalName: string; role: string | null }>(
    `
      SELECT ep.eventId, ke.canonicalName, ep.role
      FROM EventParticipant ep
      JOIN KnowledgeEntity ke ON ke.id = ep.entityId
      WHERE ep.eventId IN (${eventIds.map(() => '?').join(', ')})
      ORDER BY ke.canonicalName ASC
    `,
    ...eventIds
  )

  const participantsByEventId = new Map<string, Array<{ canonicalName: string; role: string | null }>>()
  for (const participant of participants) {
    const current = participantsByEventId.get(participant.eventId) ?? []
    current.push(participant)
    participantsByEventId.set(participant.eventId, current)
  }

  return events.map((event) => {
    const eventParticipants = participantsByEventId.get(event.id) ?? []
    const participantNames = uniqueStrings(eventParticipants.map((item) => item.canonicalName))
    const text = [
      `事件：${event.name}`,
      event.eventType?.trim() ? `类型：${event.eventType.trim()}` : null,
      `摘要：${event.summary}`,
      event.consequences?.trim() ? `后果：${event.consequences.trim()}` : null,
      eventParticipants.length
        ? `参与者：${eventParticipants.map((item) => (item.role ? `${item.canonicalName}（${item.role}）` : item.canonicalName)).join('、')}`
        : null,
    ].filter(Boolean).join('\n')

    return {
      id: `event-summary:${event.id}`,
      branchId,
      sourceType: 'event_summary' as const,
      sourceId: event.id,
      chapterId: '',
      chapterNo: event.chapterNo,
      validFromChapter: event.chapterNo,
      validToChapter: -1,
      lineStart: event.lineStart ?? -1,
      lineEnd: event.lineEnd ?? -1,
      spanType: '',
      title: event.name,
      sourceLabel: '事件摘要',
      relatedEntityNames: serializeTerms(participantNames),
      relatedEventNames: serializeTerms([event.name]),
      relatedTerms: serializeTerms([event.name, event.eventType, ...participantNames]),
      text,
      status: event.status,
      includeByDefault: 1,
      tokenEstimate: estimateTokenCount(text),
      contentHash: buildContentHash([
        event.id,
        event.name,
        event.summary,
        event.eventType,
        event.chapterNo,
        event.consequences,
        participantNames.join('|'),
      ]),
    }
  })
}

function loadBranchWorldbuildingDocs(novelId: string, branchId: string) {
  return queryAll<{
    id: string
    term: string
    category: string | null
    definition: string
    firstSeenChapter: number | null
    validFromChapter: number | null
    validToChapter: number | null
    status: string
  }>(
    `
      SELECT id, term, category, definition, firstSeenChapter, validFromChapter, validToChapter, status
      FROM KnowledgeWorld
      WHERE novelId = ? AND branchId = ?
      ORDER BY firstSeenChapter ASC, term ASC
    `,
    novelId,
    branchId
  ).map((row) => {
    const chapterNo = row.firstSeenChapter ?? row.validFromChapter ?? 0
    const text = [
      `设定：${row.term}`,
      row.category?.trim() ? `分类：${row.category.trim()}` : null,
      `定义：${row.definition}`,
    ].filter(Boolean).join('\n')

    return {
      id: `worldbuilding:${row.id}`,
      branchId,
      sourceType: 'worldbuilding' as const,
      sourceId: row.id,
      chapterId: '',
      chapterNo,
      validFromChapter: row.validFromChapter ?? chapterNo,
      validToChapter: row.validToChapter ?? -1,
      lineStart: -1,
      lineEnd: -1,
      spanType: '',
      title: row.term,
      sourceLabel: '世界设定',
      relatedEntityNames: '',
      relatedEventNames: '',
      relatedTerms: serializeTerms([row.term, row.category]),
      text,
      status: row.status,
      includeByDefault: 1,
      tokenEstimate: estimateTokenCount(text),
      contentHash: buildContentHash([
        row.id,
        row.term,
        row.category,
        row.definition,
        row.firstSeenChapter,
        row.validFromChapter,
        row.validToChapter,
      ]),
    }
  })
}

function loadBranchRelationshipDocs(novelId: string, branchId: string) {
  return queryAll<{
    id: string
    sourceChapter: number
    validFromChapter: number
    validToChapter: number | null
    linkType: string
    label: string | null
    description: string | null
    polarity: string | null
    strength: number
    evidenceQuote: string | null
    status: string
    includeByDefault: number
    sourceName: string
    targetName: string
    chapterId: string | null
    lineStart: number | null
    lineEnd: number | null
  }>(
    `
      SELECT el.id, el.sourceChapter, el.validFromChapter, el.validToChapter, el.linkType, el.label,
             el.description, el.polarity, el.strength, el.evidenceQuote, el.status, el.includeByDefault,
             se.canonicalName AS sourceName, te.canonicalName AS targetName,
             ts.chapterId AS chapterId, ts.lineStart AS lineStart, ts.lineEnd AS lineEnd
      FROM EntityLink el
      JOIN KnowledgeEntity se ON se.id = el.sourceEntityId
      JOIN KnowledgeEntity te ON te.id = el.targetEntityId
      LEFT JOIN TextSpan ts ON ts.id = el.evidenceSpanId
      WHERE el.novelId = ? AND el.branchId = ?
      ORDER BY el.validFromChapter ASC, el.sourceChapter ASC
    `,
    novelId,
    branchId
  ).map((row) => {
    const title = `${row.sourceName} ↔ ${row.targetName}`
    const text = [
      `关系：${title}`,
      `类型：${row.label?.trim() || row.linkType}`,
      row.description?.trim() ? `描述：${row.description.trim()}` : null,
      row.polarity?.trim() ? `极性：${row.polarity.trim()}` : null,
      `强度：${row.strength}`,
      row.evidenceQuote?.trim() ? `证据：${row.evidenceQuote.trim()}` : null,
    ].filter(Boolean).join('\n')

    return {
      id: `relationship:${row.id}`,
      branchId,
      sourceType: 'relationship' as const,
      sourceId: row.id,
      chapterId: row.chapterId ?? '',
      chapterNo: row.sourceChapter,
      validFromChapter: row.validFromChapter,
      validToChapter: row.validToChapter ?? -1,
      lineStart: row.lineStart ?? -1,
      lineEnd: row.lineEnd ?? -1,
      spanType: '',
      title,
      sourceLabel: '人物关系',
      relatedEntityNames: serializeTerms([row.sourceName, row.targetName]),
      relatedEventNames: '',
      relatedTerms: serializeTerms([row.sourceName, row.targetName, row.linkType, row.label, row.description]),
      text,
      status: row.status,
      includeByDefault: row.includeByDefault,
      tokenEstimate: estimateTokenCount(text),
      contentHash: buildContentHash([
        row.id,
        row.sourceName,
        row.targetName,
        row.linkType,
        row.label,
        row.description,
        row.validFromChapter,
        row.validToChapter,
        row.evidenceQuote,
      ]),
    }
  })
}

function loadBranchOpenThreadDocs(novelId: string, branchId: string) {
  const facts = queryAll<{
    id: string
    predicate: string
    valueJson: string | null
    sourceChapter: number
    validFromChapter: number
    validToChapter: number | null
    status: string
  }>(
    `
      SELECT id, predicate, valueJson, sourceChapter, validFromChapter, validToChapter, status
      FROM KnowledgeFact
      WHERE novelId = ? AND branchId = ? AND factType = 'open_thread'
      ORDER BY sourceChapter ASC, predicate ASC
    `,
    novelId,
    branchId
  )

  if (!facts.length) return [] as RetrievalDocSeedRow[]

  const factIds = facts.map((fact) => fact.id)
  const evidenceRows = queryAll<{ factId: string; chapterId: string; chapterNo: number; lineStart: number | null; lineEnd: number | null; quote: string }>(
    `
      SELECT factId, chapterId, chapterNo, lineStart, lineEnd, quote
      FROM FactEvidence
      WHERE factId IN (${factIds.map(() => '?').join(', ')})
      ORDER BY chapterNo DESC, lineStart DESC
    `,
    ...factIds
  )

  const evidenceByFactId = new Map<string, { chapterId: string; chapterNo: number; lineStart: number | null; lineEnd: number | null; quote: string }>()
  for (const evidence of evidenceRows) {
    if (!evidenceByFactId.has(evidence.factId)) {
      evidenceByFactId.set(evidence.factId, evidence)
    }
  }

  return facts.map((fact) => {
    const evidence = evidenceByFactId.get(fact.id)
    let description = ''
    try {
      const parsed = fact.valueJson ? JSON.parse(fact.valueJson) as { description?: string } : null
      description = parsed?.description?.trim() || ''
    } catch {
      description = ''
    }

    const text = [
      `线索：${fact.predicate}`,
      description ? `描述：${description}` : null,
      evidence?.quote?.trim() ? `证据：${evidence.quote.trim()}` : null,
    ].filter(Boolean).join('\n')

    return {
      id: `open-thread:${fact.id}`,
      branchId,
      sourceType: 'open_thread' as const,
      sourceId: fact.id,
      chapterId: evidence?.chapterId ?? '',
      chapterNo: fact.sourceChapter,
      validFromChapter: fact.validFromChapter,
      validToChapter: fact.validToChapter ?? -1,
      lineStart: evidence?.lineStart ?? -1,
      lineEnd: evidence?.lineEnd ?? -1,
      spanType: '',
      title: fact.predicate,
      sourceLabel: '未解线索',
      relatedEntityNames: '',
      relatedEventNames: '',
      relatedTerms: serializeTerms([fact.predicate]),
      text,
      status: fact.status,
      includeByDefault: 1,
      tokenEstimate: estimateTokenCount(text),
      contentHash: buildContentHash([
        fact.id,
        fact.predicate,
        fact.valueJson,
        fact.sourceChapter,
        evidence?.quote,
      ]),
    }
  })
}

function loadBranchRetrievalDocs(novelId: string, branchId: string) {
  return [
    ...loadBranchTextSpans(novelId, branchId).map(toRetrievalDocRow),
    ...loadBranchChapterSummaryDocs(novelId, branchId),
    ...loadBranchEntityProfileDocs(novelId, branchId),
    ...loadBranchEventSummaryDocs(novelId, branchId),
    ...loadBranchWorldbuildingDocs(novelId, branchId),
    ...loadBranchRelationshipDocs(novelId, branchId),
    ...loadBranchOpenThreadDocs(novelId, branchId),
  ]
}

async function openBranchSearchTable(branchId: string) {
  const existingTable = await openBranchTable(branchId)
  if (existingTable) {
    if (await hasUsableVectorColumn(existingTable)) {
      return {
        table: existingTable,
      }
    }
    return {
      table: null,
      warning: LANCE_INDEX_UNAVAILABLE_WARNING,
    }
  }

  return {
    table: null,
    warning: LANCE_INDEX_UNAVAILABLE_WARNING,
  }
}

function extractQueryTerms(query: string, extraTerms: string[] = []) {
  const splitTerms = query
    .split(/[\s,，。！？!?:：;；、()（）【】《》“”"'`]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)

  return uniqueStrings([...extraTerms, ...splitTerms]).slice(0, 24)
}

function buildLancePredicate(maxChapterNo: number) {
  return [
    `chapterNo <= ${maxChapterNo}`,
    `validFromChapter <= ${maxChapterNo}`,
    `(validToChapter < 0 OR validToChapter >= ${maxChapterNo})`,
    `includeByDefault = 1`,
    `status NOT IN ('rejected', 'outdated')`,
  ].join(' AND ')
}

function shouldRebuildTable(error: unknown) {
  if (!(error instanceof Error)) return false
  return /No field named/i.test(error.message)
    || /Schema error/i.test(error.message)
    || /vector/i.test(error.message)
}

function buildSourceTruthMap(rows: SourceTruthRow[]) {
  return new Map(rows.map((row) => [row.id, row]))
}

async function loadSourceTruthRows(rows: RetrievalDocSearchRow[]) {
  const byType = new Map<RetrievalDocSourceType, string[]>()
  for (const row of rows) {
    const current = byType.get(row.sourceType) ?? []
    current.push(row.sourceId)
    byType.set(row.sourceType, current)
  }

  return {
    entityProfile: buildSourceTruthMap(
      (byType.get('entity_profile')?.length
        ? queryAll<SourceTruthRow>(
            `
              SELECT id, COALESCE(firstSeenChapter, 0) AS validFromChapter, -1 AS validToChapter, 'ready' AS status, 1 AS includeByDefault
              FROM KnowledgeEntity
              WHERE id IN (${byType.get('entity_profile')?.map(() => '?').join(', ')})
            `,
            ...(byType.get('entity_profile') ?? [])
          )
        : [])
    ),
    relationship: buildSourceTruthMap(
      (byType.get('relationship')?.length
        ? queryAll<SourceTruthRow>(
            `
              SELECT id, validFromChapter, COALESCE(validToChapter, -1) AS validToChapter, status, includeByDefault
              FROM EntityLink
              WHERE id IN (${byType.get('relationship')?.map(() => '?').join(', ')})
            `,
            ...(byType.get('relationship') ?? [])
          )
        : [])
    ),
    worldbuilding: buildSourceTruthMap(
      (byType.get('worldbuilding')?.length
        ? queryAll<SourceTruthRow>(
            `
              SELECT id, COALESCE(validFromChapter, 0) AS validFromChapter, COALESCE(validToChapter, -1) AS validToChapter, status, 1 AS includeByDefault
              FROM KnowledgeWorld
              WHERE id IN (${byType.get('worldbuilding')?.map(() => '?').join(', ')})
            `,
            ...(byType.get('worldbuilding') ?? [])
          )
        : [])
    ),
    eventSummary: buildSourceTruthMap(
      (byType.get('event_summary')?.length
        ? queryAll<SourceTruthRow>(
            `
              SELECT id, chapterNo AS validFromChapter, -1 AS validToChapter, status, 1 AS includeByDefault
              FROM KnowledgeEvent
              WHERE id IN (${byType.get('event_summary')?.map(() => '?').join(', ')})
            `,
            ...(byType.get('event_summary') ?? [])
          )
        : [])
    ),
    openThread: buildSourceTruthMap(
      (byType.get('open_thread')?.length
        ? queryAll<SourceTruthRow>(
            `
              SELECT id, COALESCE(validFromChapter, 0) AS validFromChapter, COALESCE(validToChapter, -1) AS validToChapter, status, 1 AS includeByDefault
              FROM KnowledgeFact
              WHERE id IN (${byType.get('open_thread')?.map(() => '?').join(', ')})
            `,
            ...(byType.get('open_thread') ?? [])
          )
        : [])
    ),
  }
}

function matchesSourceTruth(row: RetrievalDocSearchRow, maxChapterNo: number, sourceTruth: Awaited<ReturnType<typeof loadSourceTruthRows>>) {
  const current = row.sourceType === 'relationship'
    ? sourceTruth.relationship.get(row.sourceId)
    : row.sourceType === 'entity_profile'
      ? sourceTruth.entityProfile.get(row.sourceId)
    : row.sourceType === 'worldbuilding'
      ? sourceTruth.worldbuilding.get(row.sourceId)
      : row.sourceType === 'event_summary'
        ? sourceTruth.eventSummary.get(row.sourceId)
          : row.sourceType === 'open_thread'
            ? sourceTruth.openThread.get(row.sourceId)
            : null

  if (!current) {
    return row.sourceType === 'text_span' || row.sourceType === 'chapter_summary'
  }

  if (current.includeByDefault !== 1) return false
  if (current.status === 'rejected' || current.status === 'outdated') return false
  if (current.validFromChapter > maxChapterNo) return false
  if (current.validToChapter >= 0 && current.validToChapter < maxChapterNo) return false
  return true
}

function scoreRetrievalRow(params: {
  row: HybridCandidateRow
  maxChapterNo: number
  graphTerms: string[]
  maxFtsScore: number
  maxVectorScore: number
}) {
  const row = params.row
  const haystack = [row.title, row.text, row.relatedEntityNames, row.relatedEventNames, row.relatedTerms]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()

  const matchedGraphTerms = params.graphTerms.filter((term) => haystack.includes(term.toLowerCase()))
  const graphEntityOverlap = params.graphTerms.length ? matchedGraphTerms.length / params.graphTerms.length : 0
  const ftsScore = params.maxFtsScore > 0 ? Math.max(0, row.rawFtsScore / params.maxFtsScore) : 0
  const vectorRawScore = row.rawVectorDistance === null ? 0 : 1 / (1 + Math.max(row.rawVectorDistance, 0))
  const vectorScore = params.maxVectorScore > 0 ? Math.max(0, vectorRawScore / params.maxVectorScore) : 0
  const chapterDistance = Math.max(0, params.maxChapterNo - row.chapterNo)
  const recencyScore = 1 / (1 + chapterDistance)
  const evidenceQuality = row.lineStart >= 0 || row.lineEnd >= 0
    ? 1
    : row.sourceType === 'relationship' || row.sourceType === 'entity_profile'
      ? 0.9
      : row.title
        ? 0.8
        : 0.65

  return vectorScore * 0.35
    + ftsScore * 0.25
    + graphEntityOverlap * 0.25
    + recencyScore * 0.1
    + evidenceQuality * 0.05
}

function mergeHybridCandidateRows(ftsRows: RetrievalDocSearchRow[], vectorRows: RetrievalDocSearchRow[]) {
  const merged = new Map<string, HybridCandidateRow>()

  const upsertRow = (row: RetrievalDocSearchRow, source: 'fts' | 'vector') => {
    const current = merged.get(row.id)
    const next: HybridCandidateRow = current
      ? {
          ...current,
          ...row,
          rawFtsScore: current.rawFtsScore,
          rawVectorDistance: current.rawVectorDistance,
        }
      : {
          ...row,
          rawFtsScore: 0,
          rawVectorDistance: null,
        }

    if (source === 'fts') {
      next.rawFtsScore = Math.max(next.rawFtsScore, row._score ?? 0)
    } else if (row._distance !== undefined && Number.isFinite(row._distance)) {
      next.rawVectorDistance = next.rawVectorDistance === null
        ? row._distance
        : Math.min(next.rawVectorDistance, row._distance)
    }

    merged.set(row.id, next)
  }

  for (const row of ftsRows) {
    upsertRow(row, 'fts')
  }
  for (const row of vectorRows) {
    upsertRow(row, 'vector')
  }

  return Array.from(merged.values())
}

function pickDiverseEvidenceRows(rows: LanceEvidenceMatch[], limit: number) {
  const picked: LanceEvidenceMatch[] = []
  const pickedIds = new Set<string>()
  const counts = new Map<RetrievalDocSourceType, number>()

  for (const row of rows) {
    const nextCount = counts.get(row.sourceType) ?? 0
    if (nextCount >= SOURCE_TYPE_LIMITS[row.sourceType]) {
      continue
    }
    picked.push(row)
    pickedIds.add(row.id)
    counts.set(row.sourceType, nextCount + 1)
    if (picked.length >= limit) {
      return picked
    }
  }

  for (const row of rows) {
    if (pickedIds.has(row.id)) continue
    picked.push(row)
    if (picked.length >= limit) {
      return picked
    }
  }

  return picked
}

export async function replaceChapterRetrievalIndex(spans: TextSpanInput[]) {
  if (!spans.length) return

  const novelId = spans[0]?.novelId
  const branchId = spans[0]?.branchId
  if (!novelId || !branchId) return

  await rebuildBranchRetrievalIndex(novelId, branchId)
}

export async function rebuildBranchRetrievalIndex(novelId: string, branchId: string) {
  const rows = loadBranchRetrievalDocs(novelId, branchId)
  await deleteBranchRetrievalIndex(branchId)
  if (!rows.length) return
  await createOrReplaceBranchTable(branchId, rows)
}

export async function deleteBranchRetrievalIndex(branchId: string) {
  if (!(await hasBranchTable(branchId))) {
    return
  }

  const database = await getDatabase()
  await database.dropTable(getBranchTableName(branchId))
}

export async function deleteBranchRetrievalIndexFromChapter(branchId: string, fromChapterNo: number) {
  const table = await openBranchTable(branchId)
  if (!table) return

  await table.delete(`chapterNo >= ${fromChapterNo}`)
}

export async function searchLanceEvidence(params: {
  novelId: string
  branchId: string
  maxChapterNo: number
  query: string
  queryTerms?: string[]
  graphTerms?: string[]
  limit?: number
}): Promise<LanceEvidenceSearchResult> {
  const query = params.query.trim()
  if (!query) {
    return {
      matches: [],
    }
  }

  const queryTerms = extractQueryTerms(query, params.queryTerms ?? [])
  const graphTerms = extractQueryTerms((params.graphTerms ?? []).join('\n'), params.graphTerms ?? [])
  const searchLimit = Math.max((params.limit ?? 10) * 6, 40)

  const runSearch = async () => {
    const { table, warning } = await openBranchSearchTable(params.branchId)
    if (!table) {
      return {
        ftsRows: [] as RetrievalDocSearchRow[],
        vectorRows: [] as RetrievalDocSearchRow[],
        warning: warning ?? LANCE_INDEX_UNAVAILABLE_WARNING,
      }
    }

    const predicate = buildLancePredicate(params.maxChapterNo)
    const queryVector = await embedRetrievalQuery(query)

    const [ftsRows, vectorRows] = await Promise.all([
      table
        .query()
        .where(predicate)
        .fullTextSearch(query)
        .withRowId()
        .limit(searchLimit)
        .toArray() as Promise<RetrievalDocSearchRow[]>,
      table
        .query()
        .where(predicate)
        .nearestTo(queryVector)
        .column('vector')
        .withRowId()
        .limit(searchLimit)
        .toArray() as Promise<RetrievalDocSearchRow[]>,
    ])

    return { ftsRows, vectorRows }
  }

  let searchRows: { ftsRows: RetrievalDocSearchRow[]; vectorRows: RetrievalDocSearchRow[]; warning?: string }
  try {
    searchRows = await runSearch()
  } catch (error) {
    if (!shouldRebuildTable(error)) {
      throw error
    }

    return {
      matches: [],
      warning: LANCE_INDEX_UNAVAILABLE_WARNING,
    }
  }

  if (searchRows.warning) {
    return {
      matches: [],
      warning: searchRows.warning,
    }
  }

  const rows = mergeHybridCandidateRows(searchRows.ftsRows, searchRows.vectorRows)

  if (!rows.length) {
    return {
      matches: [],
    }
  }

  const sourceTruth = await loadSourceTruthRows(rows)
  const filtered = rows.filter((row) => matchesSourceTruth(row, params.maxChapterNo, sourceTruth))
  if (!filtered.length) {
    return {
      matches: [],
    }
  }

  const maxFtsScore = Math.max(...filtered.map((row) => row.rawFtsScore), 0)
  const maxVectorScore = Math.max(
    ...filtered.map((row) => (row.rawVectorDistance === null ? 0 : 1 / (1 + Math.max(row.rawVectorDistance, 0)))),
    0
  )

  const reranked = filtered
    .map((row) => ({
      id: row.id,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      chapterId: row.chapterId || null,
      chapterNo: row.chapterNo,
      lineStart: row.lineStart >= 0 ? row.lineStart : null,
      lineEnd: row.lineEnd >= 0 ? row.lineEnd : null,
      title: row.title || null,
      sourceLabel: row.sourceLabel,
      text: row.text,
      score: scoreRetrievalRow({
        row,
        maxChapterNo: params.maxChapterNo,
        graphTerms: graphTerms.length ? graphTerms : queryTerms,
        maxFtsScore,
        maxVectorScore,
      }),
    }))
    .sort(
      (left, right) => right.score - left.score
        || SOURCE_TYPE_PRIORITY[right.sourceType] - SOURCE_TYPE_PRIORITY[left.sourceType]
        || right.chapterNo - left.chapterNo
    )

  return {
    matches: pickDiverseEvidenceRows(reranked, params.limit ?? 10),
  }
}
