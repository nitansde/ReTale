import { buildChapterScopedGraphContext, buildGraphAwareContext } from '@/lib/server/graph-context'
import { loadEntityStatesByEntityIds } from '@/lib/server/graph-store'
import type { GraphAwareResult } from '@/lib/server/graph-types'
import { estimateTokenCount, normalizeBranchId } from '@/lib/server/knowledge-store'
import { searchLanceEvidence, type RetrievalDocSourceType } from '@/lib/server/retrieval-index'
import { queryAll, queryOne } from '@/lib/server/sqlite'
import {
  buildCharacterDescriptionDelta,
  buildCharacterRoleCardLines,
  hasCharacterRoleCardProfile,
  mergeCharacterRoleCardProfiles,
  normalizeCharacterRoleCardProfile,
  type CharacterRoleCardProfile,
} from '@/lib/story-knowledge'

export type GenerationContextRequest = {
  novelId: string
  branchId?: string
  chapterId: string
  selectedText: string
  operationType: 'expand' | 'rewrite' | 'roleplay' | 'polish' | 'continue'
  userInstruction: string
  excludedGraphEdgeIds?: string[]
  excludedEvidenceIds?: string[]
}

export type GenerationContextBlock = {
  id: string
  label: string
  enabled: boolean
  priority: 'highest' | 'high' | 'medium'
  content: string
}

export type GenerationContextPreview = {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  snapshotStatus: string
  selectedLineStart: number | null
  selectedLineEnd: number | null
  warnings: string[]
  blocks: GenerationContextBlock[]
  assembledContext: string
}

export type GenerationContextEvidence = {
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

export type GenerationContextBuildResult = {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  snapshotStatus: string
  selectedLineStart: number | null
  selectedLineEnd: number | null
  warnings: string[]
  promptBlocks: GenerationContextBlock[]
  assembledContext: string
  graphContext: GraphAwareResult
  lanceEvidence: GenerationContextEvidence[]
  tokenEstimate: number
}

export type ChapterGraphContextRequest = {
  novelId: string
  chapterId: string
  maxHops?: 1 | 2
  includeLowConfidence?: boolean
  confirmedOnly?: boolean
}

export type ChapterGraphContextResult = {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  chapterTitle: string
  snapshotStatus: string
  warnings: string[]
  graphContext: GraphAwareResult
  lanceEvidence: GenerationContextEvidence[]
  tokenEstimate: number
}

type EntityRow = {
  id: string
  canonicalName: string
  description: string | null
  status: string | null
  aliases: Array<{ alias: string }>
  profile?: CharacterRoleCardProfile
}

type FactRow = {
  subjectEntityId: string | null
  objectEntityId: string | null
  predicate: string
  valueJson: string | null
  subjectCanonicalName: string | null
  objectCanonicalName: string | null
}

type EntityStatePreviewRow = {
  entityId: string
  stateValue: string
  description: string | null
}

type SnapshotCharacter = {
  name: string
  aliases?: string[]
  status?: string
  lastSeenChapter?: number
  profile?: CharacterRoleCardProfile
}

type SnapshotRelationship = {
  source: string
  target: string
  type: string
  polarity?: string
  validFromChapter?: number
  evidenceChapter?: number
}

type SnapshotEvent = {
  chapter: number
  name: string
  summary: string
}

type SnapshotRule = {
  term: string
  definition: string
  firstSeenChapter?: number
}

type SnapshotThread = {
  name: string
  description: string
}

type ParsedSnapshot = {
  major_characters: SnapshotCharacter[]
  active_relationships: SnapshotRelationship[]
  recent_events: SnapshotEvent[]
  world_rules: SnapshotRule[]
  open_threads: SnapshotThread[]
  forbidden_future_facts: string
}

function formatOutputConstraints(operationType: GenerationContextRequest['operationType']) {
  const modeSpecific =
    operationType === 'expand'
      ? '- 如果是扩写：保留原意，增加细节、动作、心理、氛围。'
      : operationType === 'rewrite'
        ? '- 如果是魔改/重写：允许改变当前片段走向，但要保持前文一致。'
        : operationType === 'polish'
          ? '- 如果是润色：尽量不改变情节事实。'
          : '- 保持前文连续性，不要引入未来章节事实。'

  return [
    '- 只输出小说正文。',
    '- 不要输出分析。',
    '- 不要输出 Markdown 标题。',
    '- 保持原文叙事视角。',
    '- 不要使用当前章节之后的事实。',
    modeSpecific,
  ].join('\n')
}

function selectWindow<T>(items: T[], start: number, end: number) {
  return items.slice(Math.max(0, start), Math.min(items.length, end))
}

function inferSelectionRange(lines: Array<{ lineNo: number; text: string }>, selectedText: string) {
  const trimmed = selectedText.trim()
  if (!trimmed) return { lineStart: null, lineEnd: null }

  for (const line of lines) {
    if (line.text.includes(trimmed) || trimmed.includes(line.text)) {
      return { lineStart: line.lineNo, lineEnd: line.lineNo }
    }
  }

  const fragments = trimmed.split(/\s+/).filter(Boolean).slice(0, 4)
  const matched = lines.filter((line) => fragments.some((fragment) => fragment.length >= 2 && line.text.includes(fragment)))
  if (!matched.length) return { lineStart: null, lineEnd: null }
  return {
    lineStart: matched[0].lineNo,
    lineEnd: matched[matched.length - 1].lineNo,
  }
}

function buildNeighborhoodText(lines: Array<{ lineNo: number; text: string }>, lineStart: number | null, lineEnd: number | null) {
  if (lineStart === null || lineEnd === null) {
    return lines.slice(0, 20).map((line) => `${line.lineNo}. ${line.text}`).join('\n')
  }

  const startIndex = Math.max(0, lineStart - 1 - 20)
  const endIndex = Math.min(lines.length, lineEnd + 20)
  return selectWindow(lines, startIndex, endIndex).map((line) => `${line.lineNo}. ${line.text}`).join('\n')
}

function parseJsonObject<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function renderBlock(label: string, lines: string[]) {
  return [`# ${label}`, ...lines].join('\n')
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

function buildNeighborhoodExcerpt(text: string, maxLines = 10) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .join(' ')
}

function loadCharacterProfilesByEntityId(params: {
  novelId: string
  branchId: string
  entityIds: string[]
  chapterNo: number
}) {
  if (!params.entityIds.length) return new Map<string, CharacterRoleCardProfile>()
  const rows = queryAll<{ subjectEntityId: string | null; valueJson: string | null; sourceChapter: number }>(
    `
      SELECT subjectEntityId, valueJson, sourceChapter
      FROM KnowledgeFact
      WHERE novelId = ? AND branchId = ? AND factType = 'character_profile'
        AND subjectEntityId IN (${params.entityIds.map(() => '?').join(', ')})
        AND validFromChapter <= ?
        AND (validToChapter IS NULL OR validToChapter >= ?)
        AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
      ORDER BY validFromChapter ASC, sourceChapter ASC
    `,
    params.novelId,
    params.branchId,
    ...params.entityIds,
    params.chapterNo,
    params.chapterNo,
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

function renderSnapshotForPrompt(snapshot: ParsedSnapshot) {
  const lines: string[] = []

  lines.push('人物状态：')
  lines.push(
    ...(snapshot.major_characters.length
      ? snapshot.major_characters.slice(0, 8).map((character) => {
          const aliasText = character.aliases?.length ? `｜别名：${character.aliases.slice(0, 3).join('、')}` : ''
          const chapterText = typeof character.lastSeenChapter === 'number' ? `｜最近出现：第 ${character.lastSeenChapter} 章` : ''
          const profile = character.profile
          const profileText = profile && hasCharacterRoleCardProfile(profile)
            ? `｜${buildCharacterRoleCardLines(profile, { includeEvidence: false, includeNotes: true }).slice(0, 4).join('｜')}`
            : ''
          return `- ${character.name}｜状态：${character.status?.trim() || '未知'}${aliasText}${chapterText}${profileText}`
        })
      : ['- 暂无人物状态。'])
  )

  lines.push('', '关键关系：')
  lines.push(
    ...(snapshot.active_relationships.length
      ? snapshot.active_relationships.slice(0, 8).map((relation) => {
          const polarity = relation.polarity?.trim() ? `｜${relation.polarity}` : ''
          const chapterText = typeof relation.validFromChapter === 'number' ? `｜起始：第 ${relation.validFromChapter} 章` : ''
          return `- ${relation.source} ↔ ${relation.target}｜${relation.type}${polarity}${chapterText}`
        })
      : ['- 暂无关键关系。'])
  )

  lines.push('', '近期事件：')
  lines.push(
    ...(snapshot.recent_events.length
      ? snapshot.recent_events.slice(0, 6).map((event) => `- 第 ${event.chapter} 章｜${event.name}｜${event.summary}`)
      : ['- 暂无近期事件。'])
  )

  lines.push('', '世界设定：')
  lines.push(
    ...(snapshot.world_rules.length
      ? snapshot.world_rules.slice(0, 8).map((rule) => `- ${rule.term}｜${rule.definition}`)
      : ['- 暂无稳定设定。'])
  )

  lines.push('', '未解线索：')
  lines.push(
    ...(snapshot.open_threads.length
      ? snapshot.open_threads.slice(0, 6).map((thread) => `- ${thread.name}｜${thread.description}`)
      : ['- 暂无线索。'])
  )

  lines.push('', `未来章节限制：${snapshot.forbidden_future_facts}`)

  return renderBlock('截至当前章节的世界状态', lines)
}

function buildEnrichedEvidenceQuery(params: {
  userInstruction: string
  selectedText: string
  neighborhoodText: string
  matchedEntities: EntityRow[]
  relatedEvents: Array<{ name: string }>
  relatedWorlds: Array<{ term: string }>
  graphContext: GraphAwareResult
}) {
  const focusTerms = uniqueStrings([
    ...params.matchedEntities.map((entity) => entity.canonicalName),
    ...params.graphContext.seedEntities.map((entity) => entity.label),
    ...params.graphContext.nodes.map((node) => node.label),
    ...params.graphContext.edges.flatMap((edge) => [edge.label ?? null, edge.linkType]),
    ...params.relatedEvents.map((event) => event.name),
    ...params.relatedWorlds.map((world) => world.term),
  ]).slice(0, 18)

  const query = [
    params.userInstruction.trim(),
    params.selectedText.trim(),
    buildNeighborhoodExcerpt(params.neighborhoodText),
    focusTerms.join(' '),
  ].filter(Boolean).join('\n')

  return {
    query,
    queryTerms: focusTerms,
    graphTerms: focusTerms,
  }
}

function formatEvidenceLocation(item: GenerationContextEvidence) {
  if (item.lineStart !== null && item.lineEnd !== null) {
    return `第 ${item.chapterNo} 章 ${item.lineStart}-${item.lineEnd} 行`
  }
  if (item.lineStart !== null) {
    return `第 ${item.chapterNo} 章 第 ${item.lineStart} 行`
  }
  return `第 ${item.chapterNo} 章`
}

function formatEvidenceBlockLine(item: GenerationContextEvidence) {
  const title = item.title?.trim() ? `｜${item.title.trim()}` : ''
  return `- [${item.sourceLabel}] ${formatEvidenceLocation(item)}${title}：${item.text}`
}

function buildFilteredGraphContextText(params: {
  graphContext: GraphAwareResult
  excludedGraphEdgeIds: Set<string>
  latestStateByEntityId: Map<string, EntityStatePreviewRow>
  chapterNo: number
}) {
  const nodesById = new Map(params.graphContext.nodes.map((node) => [node.id, node] as const))
  const stateLines = params.graphContext.seedEntities.flatMap((entity) => {
    const summary = params.latestStateByEntityId.get(entity.id)
    const text = summary ? `${summary.stateValue}｜${summary.description?.trim() || '待从图谱状态补充'}` : ''
    return text ? [`- ${entity.label}：截至第${params.chapterNo}章，${text}`] : []
  })
  const relationLines = params.graphContext.edges
    .filter((edge) => edge.includeInPrompt && !params.excludedGraphEdgeIds.has(edge.id))
    .slice(0, 10)
    .map((edge) => {
      const source = nodesById.get(edge.source)?.label ?? edge.source
      const target = nodesById.get(edge.target)?.label ?? edge.target
      const description = edge.description ? `｜${edge.description}` : ''
      const evidence = edge.evidenceQuote ? `｜证据：${edge.evidenceQuote}` : ''
      return `- ${source} 与 ${target}：${edge.linkType}${description}${evidence}`
    })

  return [
    '【GraphRAG 相关人物状态】',
    ...(stateLines.length ? stateLines : ['- 未命中明确人物状态。']),
    '',
    '【GraphRAG 关键关系】',
    ...(relationLines.length ? relationLines : ['- 未命中明确关系边。']),
    '',
    '【禁止】',
    `- 不要使用第 ${params.chapterNo} 章之后的事实。`,
  ].join('\n')
}

function createEmptyGraphContext(warnings: string[]): GraphAwareResult {
  return {
    seedEntities: [],
    nodes: [],
    edges: [],
    contextText: '',
    warnings,
    tokenEstimate: 0,
    status: 'ready',
  }
}

function buildChapterGraphEvidenceQuery(params: {
  chapterTitle: string
  chapterSummary: string
  graphContext: GraphAwareResult
}) {
  const queryTerms = uniqueStrings([
    params.chapterTitle,
    ...params.graphContext.seedEntities.map((entity) => entity.label),
    ...params.graphContext.nodes.map((node) => node.label),
    ...params.graphContext.edges.flatMap((edge) => [edge.label ?? null, edge.linkType]),
  ]).slice(0, 18)

  return {
    query: [params.chapterTitle.trim(), params.chapterSummary.trim(), queryTerms.join(' ')].filter(Boolean).join('\n'),
    queryTerms,
    graphTerms: queryTerms,
  }
}

function loadEntitiesWithAliases(novelId: string, branchId: string, chapterNo: number) {
  const entities = queryAll<{
    id: string
    canonicalName: string
    description: string | null
    status: string | null
  }>(
    `
      SELECT id, canonicalName, description, status
      FROM KnowledgeEntity
      WHERE novelId = ? AND branchId = ? AND firstSeenChapter <= ?
      ORDER BY importance DESC, canonicalName ASC
      LIMIT 24
    `,
    novelId,
    branchId,
    chapterNo
  )

  if (!entities.length) return [] as EntityRow[]

  const entityIds = entities.map((entity) => entity.id)
  const aliases = queryAll<{ entityId: string; alias: string }>(
    `SELECT entityId, alias FROM EntityAlias WHERE entityId IN (${entityIds.map(() => '?').join(', ')})`,
    ...entityIds
  )

  const aliasesByEntityId = new Map<string, Array<{ alias: string }>>()
  for (const alias of aliases) {
    const current = aliasesByEntityId.get(alias.entityId) ?? []
    current.push({ alias: alias.alias })
    aliasesByEntityId.set(alias.entityId, current)
  }
  const profileByEntityId = loadCharacterProfilesByEntityId({
    novelId,
    branchId,
    entityIds,
    chapterNo,
  })

  return entities.map((entity) => ({
    ...entity,
    aliases: aliasesByEntityId.get(entity.id) ?? [],
    profile: profileByEntityId.get(entity.id),
  }))
}

export async function buildGenerationContext(request: GenerationContextRequest): Promise<GenerationContextBuildResult> {
  const excludedGraphEdgeIds = new Set((request.excludedGraphEdgeIds ?? []).map((item) => item.trim()).filter(Boolean))
  const excludedEvidenceIds = new Set((request.excludedEvidenceIds ?? []).map((item) => item.trim()).filter(Boolean))
  const branchId = normalizeBranchId(request.novelId, request.branchId)
  const chapter = queryOne<{ id: string; chapterNo: number; summary: string | null }>(
    'SELECT id, chapterNo, summary FROM KnowledgeChapter WHERE id = ? AND novelId = ? AND branchId = ? LIMIT 1',
    request.chapterId,
    request.novelId,
    branchId
  )

  if (!chapter) {
    throw new Error('Chapter not found in knowledge store')
  }

  const [lines, recentChapters, snapshotRow, entities, facts, events, worlds] = await Promise.all([
    Promise.resolve(
      queryAll<{ lineNo: number; text: string }>(
        'SELECT lineNo, text FROM ChapterLine WHERE chapterId = ? ORDER BY lineNo ASC',
        chapter.id
      )
    ),
    Promise.resolve(
      queryAll<{ chapterNo: number; title: string | null; summary: string | null }>(
        `
          SELECT chapterNo, title, summary
          FROM KnowledgeChapter
          WHERE novelId = ? AND branchId = ? AND chapterNo <= ?
          ORDER BY chapterNo DESC
          LIMIT 4
        `,
        request.novelId,
        branchId,
        chapter.chapterNo
      )
    ),
    Promise.resolve(
      queryOne<{ snapshotJson: string; status: string }>(
        `
          SELECT snapshotJson, status
          FROM ChapterSnapshot
          WHERE novelId = ? AND branchId = ? AND chapterNo = ?
          LIMIT 1
        `,
        request.novelId,
        branchId,
        chapter.chapterNo
      )
    ),
    Promise.resolve(loadEntitiesWithAliases(request.novelId, branchId, chapter.chapterNo)),
    Promise.resolve(
      queryAll<FactRow & { sourceChapter: number }>(
        `
          SELECT f.subjectEntityId, f.objectEntityId, f.predicate, f.valueJson, f.sourceChapter,
                 se.canonicalName as subjectCanonicalName,
                 oe.canonicalName as objectCanonicalName
          FROM KnowledgeFact f
          LEFT JOIN KnowledgeEntity se ON se.id = f.subjectEntityId
          LEFT JOIN KnowledgeEntity oe ON oe.id = f.objectEntityId
          WHERE f.novelId = ? AND f.branchId = ? AND f.validFromChapter <= ?
            AND (f.validToChapter IS NULL OR f.validToChapter >= ?)
            AND f.status NOT IN ('rejected', 'outdated', 'potentially_stale')
          ORDER BY f.sourceChapter DESC
          LIMIT 30
        `,
        request.novelId,
        branchId,
        chapter.chapterNo,
        chapter.chapterNo
      )
    ),
    Promise.resolve(
      queryAll<{ chapterNo: number; name: string; summary: string }>(
        `
          SELECT chapterNo, name, summary
          FROM KnowledgeEvent
          WHERE novelId = ? AND branchId = ? AND chapterNo <= ?
            AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
          ORDER BY importance DESC, chapterNo DESC
          LIMIT 12
        `,
        request.novelId,
        branchId,
        chapter.chapterNo
      )
    ),
    Promise.resolve(
      queryAll<{ term: string; category: string | null; definition: string }>(
        `
          SELECT term, category, definition
          FROM KnowledgeWorld
          WHERE novelId = ? AND branchId = ? AND validFromChapter <= ?
            AND (validToChapter IS NULL OR validToChapter >= ?)
            AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
          ORDER BY firstSeenChapter ASC
          LIMIT 12
        `,
        request.novelId,
        branchId,
        chapter.chapterNo,
        chapter.chapterNo
      )
    ),
  ])

  const selectionRange = inferSelectionRange(lines, request.selectedText)
  const neighborhoodText = buildNeighborhoodText(lines, selectionRange.lineStart, selectionRange.lineEnd)
  const graphContext = await buildGraphAwareContext({
    novelId: request.novelId,
    branchId,
    chapterNo: chapter.chapterNo,
    selectedText: request.selectedText,
    nearbyText: neighborhoodText,
    operationType: request.operationType === 'continue' ? 'expand' : request.operationType === 'roleplay' ? 'dialogue' : request.operationType,
    maxHops: 1,
    includeLowConfidence: false,
  })
  const currentSummary = chapter.summary?.trim() || '当前章节尚未生成摘要。'
  const snapshot = parseJsonObject<ParsedSnapshot>(snapshotRow?.snapshotJson ?? null, {
    major_characters: [],
    active_relationships: [],
    recent_events: [],
    world_rules: [],
    open_threads: [],
    forbidden_future_facts: `Do not use any facts from chapters > ${chapter.chapterNo}.`,
  })

  const entityContext = `${request.selectedText}\n${neighborhoodText}`
  const matchedEntities = entities.filter((entity) => {
    if (entityContext.includes(entity.canonicalName)) return true
    return entity.aliases.some((alias) => entityContext.includes(alias.alias))
  })
  const relatedEntityIds = new Set(matchedEntities.map((item) => item.id))
  const matchedStates = matchedEntities.length
    ? loadEntityStatesByEntityIds({
        novelId: request.novelId,
        branchId,
        chapterNo: chapter.chapterNo,
        includeLowConfidence: false,
        entityIds: matchedEntities.map((entity) => entity.id),
        limit: 24,
      })
    : []
  const latestStateByEntityId = new Map<string, EntityStatePreviewRow>()
  for (const state of matchedStates) {
    if (latestStateByEntityId.has(state.entityId)) continue
    latestStateByEntityId.set(state.entityId, state)
  }

  const relatedFacts = facts.filter((fact) => {
    return Boolean(
      (fact.subjectEntityId && relatedEntityIds.has(fact.subjectEntityId)) ||
      (fact.objectEntityId && relatedEntityIds.has(fact.objectEntityId)) ||
      fact.predicate.includes(request.selectedText.slice(0, 12))
    )
  }).slice(0, 12)

  const relatedEvents = events.filter((event) => {
    return matchedEntities.some((entity) => event.summary.includes(entity.canonicalName) || event.name.includes(entity.canonicalName))
  }).slice(0, 8)

  const relatedWorlds = worlds.filter((world) => {
    return request.selectedText.includes(world.term) || neighborhoodText.includes(world.term)
  }).slice(0, 8)

  const graphContextText = buildFilteredGraphContextText({
    graphContext,
    excludedGraphEdgeIds,
    latestStateByEntityId,
    chapterNo: chapter.chapterNo,
  })

  const graphContextForEvidenceQuery = {
    ...graphContext,
    contextText: graphContextText,
    edges: graphContext.edges.filter((edge) => edge.includeInPrompt && !excludedGraphEdgeIds.has(edge.id)),
  }

  const warnings: string[] = []
  const evidenceQuery = buildEnrichedEvidenceQuery({
    userInstruction: request.userInstruction,
    selectedText: request.selectedText,
    neighborhoodText,
    matchedEntities,
    relatedEvents,
    relatedWorlds,
    graphContext: graphContextForEvidenceQuery,
  })
  const lanceEvidenceResult = await searchLanceEvidence({
    novelId: request.novelId,
    branchId,
    maxChapterNo: chapter.chapterNo,
    query: evidenceQuery.query,
    queryTerms: evidenceQuery.queryTerms,
    graphTerms: evidenceQuery.graphTerms,
    limit: 10,
  })
  const lanceEvidence = lanceEvidenceResult.matches
  if (lanceEvidenceResult.warning) {
    warnings.push(lanceEvidenceResult.warning)
  }
  const promptEvidence = lanceEvidence.filter((item) => !excludedEvidenceIds.has(item.id))

  if (!snapshotRow || snapshotRow.status !== 'ready') {
    warnings.push('当前章节快照不是 ready，生成可能基于部分旧知识。')
  }
  warnings.push(...graphContext.warnings)

  const blocks: GenerationContextBlock[] = [
    {
      id: 'user-instruction',
      label: '任务',
      enabled: true,
      priority: 'highest',
      content: renderBlock('任务', [`操作类型：${request.operationType}`, `用户要求：${request.userInstruction || '按当前模式生成。'}`]),
    },
    {
      id: 'selected-text',
      label: '选中文本',
      enabled: true,
      priority: 'highest',
      content: renderBlock('选中文本', [request.selectedText || '（未提供选中文本）']),
    },
    {
      id: 'neighborhood',
      label: '选区附近原文',
      enabled: true,
      priority: 'highest',
      content: renderBlock('选区附近原文', [neighborhoodText]),
    },
    {
      id: 'current-summary',
      label: '当前章节摘要',
      enabled: true,
      priority: 'high',
      content: renderBlock('当前章节摘要', [currentSummary]),
    },
    {
      id: 'recent-summaries',
      label: '最近章节摘要',
      enabled: true,
      priority: 'high',
      content: renderBlock(
        '最近章节摘要',
        recentChapters
          .slice()
          .sort((a, b) => a.chapterNo - b.chapterNo)
          .map((item) => `- 第 ${item.chapterNo} 章 ${item.title ?? ''}：${item.summary ?? '暂无摘要'}`)
      ),
    },
    {
      id: 'snapshot',
      label: '世界快照',
      enabled: true,
      priority: 'high',
      content: renderSnapshotForPrompt(snapshot),
    },
    {
      id: 'graph-context',
      label: 'GraphRAG 图谱上下文',
      enabled: true,
      priority: 'high',
      content: graphContextText,
    },
    {
      id: 'characters',
      label: '相关人物',
      enabled: true,
      priority: 'high',
      content: renderBlock(
        '相关人物',
        matchedEntities.length
          ? matchedEntities.map((entity) => {
              const state = latestStateByEntityId.get(entity.id)
              const compactDescription = buildCharacterDescriptionDelta(entity.profile ?? {}, state?.description?.trim() || entity.description?.trim() || '')
              const profile = entity.profile
              const profileText = profile && hasCharacterRoleCardProfile(profile)
                ? buildCharacterRoleCardLines(profile, { includeEvidence: false, includeNotes: true }).slice(0, 5).join('｜')
                : compactDescription || '待从图谱状态补充'
              return `- ${entity.canonicalName}｜状态：${state?.stateValue ?? '未知'}｜${profileText}`
            })
          : ['- 未命中明确人物。']
      ),
    },
    {
      id: 'facts',
      label: '相关事实',
      enabled: true,
      priority: 'high',
      content: renderBlock(
        '相关事实',
        relatedFacts.length
          ? relatedFacts.map((fact) => {
              const parsed = parseJsonObject(fact.valueJson, {})
              const valueText = typeof parsed === 'object' ? JSON.stringify(parsed) : String(parsed)
              return `- ${fact.subjectCanonicalName ?? '（无主语）'} ${fact.predicate} ${fact.objectCanonicalName ?? ''} ${valueText}`.trim()
            })
          : ['- 未命中额外事实。']
      ),
    },
    {
      id: 'events',
      label: '相关事件',
      enabled: true,
      priority: 'medium',
      content: renderBlock(
        '相关事件',
        relatedEvents.length
          ? relatedEvents.map((event) => `- 第 ${event.chapterNo} 章｜${event.name}｜${event.summary}`)
          : ['- 未命中额外事件。']
      ),
    },
    {
      id: 'worldbuilding',
      label: '相关设定',
      enabled: true,
      priority: 'medium',
      content: renderBlock(
        '相关世界设定',
        relatedWorlds.length
          ? relatedWorlds.map((world) => `- ${world.term}｜${world.category ?? 'concept'}｜${world.definition}`)
          : ['- 未命中额外设定。']
      ),
    },
    {
      id: 'evidence',
      label: '原文证据',
      enabled: true,
      priority: 'medium',
      content: renderBlock(
        'Lance 检索证据',
        promptEvidence.length
          ? promptEvidence.map((item) => formatEvidenceBlockLine(item))
          : ['- 没有检索到额外 Lance 证据。']
      ),
    },
    {
      id: 'output-constraints',
      label: '输出要求',
      enabled: true,
      priority: 'high',
      content: renderBlock('输出要求', [formatOutputConstraints(request.operationType)]),
    },
  ]

  const assembledContext = blocks.filter((block) => block.enabled).map((block) => block.content).join('\n\n')

  return {
    novelId: request.novelId,
    branchId,
    chapterId: request.chapterId,
    chapterNo: chapter.chapterNo,
    snapshotStatus: snapshotRow?.status ?? 'missing',
    selectedLineStart: selectionRange.lineStart,
    selectedLineEnd: selectionRange.lineEnd,
    warnings,
    promptBlocks: blocks,
    assembledContext,
    graphContext,
    lanceEvidence,
    tokenEstimate: estimateTokenCount(assembledContext),
  }
}

export async function buildChapterGraphContext(request: ChapterGraphContextRequest): Promise<ChapterGraphContextResult> {
  const chapter = queryOne<{ id: string; branchId: string; chapterNo: number; title: string | null; summary: string | null }>(
    `
      SELECT id, branchId, chapterNo, title, summary
      FROM KnowledgeChapter
      WHERE id = ? AND novelId = ?
      LIMIT 1
    `,
    request.chapterId,
    request.novelId
  )

  if (!chapter) {
    throw new Error('Chapter not found in knowledge store')
  }

  const snapshot = queryOne<{ status: string }>(
    `
      SELECT status
      FROM ChapterSnapshot
      WHERE novelId = ? AND branchId = ? AND chapterNo = ?
      LIMIT 1
    `,
    request.novelId,
    chapter.branchId,
    chapter.chapterNo
  )

  const graphContext = await buildChapterScopedGraphContext({
    novelId: request.novelId,
    branchId: chapter.branchId,
    chapterNo: chapter.chapterNo,
    maxHops: request.maxHops ?? 1,
    includeLowConfidence: request.includeLowConfidence ?? false,
    confirmedOnly: request.confirmedOnly ?? false,
  })

  const chapterTitle = chapter.title?.trim() || `第 ${chapter.chapterNo} 章`
  const chapterSummary = chapter.summary?.trim() || ''
  const warnings = [...graphContext.warnings]
  if (!snapshot || snapshot.status !== 'ready') {
    warnings.unshift('当前章节快照不是 ready，图谱可能还没有完全同步。')
  }
  const evidenceQuery = buildChapterGraphEvidenceQuery({
    chapterTitle,
    chapterSummary,
    graphContext,
  })
  const lanceEvidenceResult = evidenceQuery.queryTerms.length || chapterSummary
      ? await searchLanceEvidence({
          novelId: request.novelId,
          branchId: chapter.branchId,
          maxChapterNo: chapter.chapterNo,
          query: evidenceQuery.query,
          queryTerms: evidenceQuery.queryTerms,
          graphTerms: evidenceQuery.graphTerms,
          limit: 8,
        })
    : { matches: [] }
  const lanceEvidence = lanceEvidenceResult.matches
  if (lanceEvidenceResult.warning) {
    warnings.push(lanceEvidenceResult.warning)
  }

  return {
    novelId: request.novelId,
    branchId: chapter.branchId,
    chapterId: chapter.id,
    chapterNo: chapter.chapterNo,
    chapterTitle,
    snapshotStatus: snapshot?.status ?? 'missing',
    warnings,
    graphContext: graphContext.nodes.length || graphContext.edges.length || graphContext.seedEntities.length
      ? graphContext
      : createEmptyGraphContext(warnings),
    lanceEvidence,
    tokenEstimate: estimateTokenCount(
      [graphContext.contextText, ...lanceEvidence.slice(0, 4).map((item) => item.text)].filter(Boolean).join('\n')
    ),
  }
}

export async function buildGenerationContextPreview(request: GenerationContextRequest): Promise<GenerationContextPreview> {
  const result = await buildGenerationContext(request)
  return {
    novelId: result.novelId,
    branchId: result.branchId,
    chapterId: result.chapterId,
    chapterNo: result.chapterNo,
    snapshotStatus: result.snapshotStatus,
    selectedLineStart: result.selectedLineStart,
    selectedLineEnd: result.selectedLineEnd,
    warnings: result.warnings,
    blocks: result.promptBlocks,
    assembledContext: result.assembledContext,
  }
}
