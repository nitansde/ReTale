import { getMainBranchId, searchEvidenceSpans } from '@/lib/server/knowledge-store'
import { queryAll, queryOne } from '@/lib/server/sqlite'

export type GenerationContextRequest = {
  novelId: string
  branchId?: string
  chapterId: string
  selectedText: string
  operationType: 'expand' | 'rewrite' | 'roleplay' | 'polish' | 'continue'
  userInstruction: string
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

type EntityRow = {
  id: string
  canonicalName: string
  description: string | null
  status: string | null
  aliases: Array<{ alias: string }>
}

type FactRow = {
  subjectEntityId: string | null
  objectEntityId: string | null
  predicate: string
  valueJson: string | null
  subjectCanonicalName: string | null
  objectCanonicalName: string | null
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

  return entities.map((entity) => ({
    ...entity,
    aliases: aliasesByEntityId.get(entity.id) ?? [],
  }))
}

export async function buildGenerationContextPreview(request: GenerationContextRequest): Promise<GenerationContextPreview> {
  const branchId = request.branchId ?? getMainBranchId(request.novelId)
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
            AND f.status != 'rejected'
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
          WHERE novelId = ? AND branchId = ? AND chapterNo <= ? AND status != 'rejected'
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
            AND status != 'rejected'
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
  const currentSummary = chapter.summary?.trim() || '当前章节尚未生成摘要。'
  const snapshot = parseJsonObject(snapshotRow?.snapshotJson ?? null, {
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

  const evidenceQuery = `${request.userInstruction}\n${request.selectedText}`.trim()
  const evidenceMatches = await searchEvidenceSpans({
    branchId,
    maxChapterNo: chapter.chapterNo,
    query: evidenceQuery,
    limit: 8,
  })
  const evidenceSpanIds = evidenceMatches.map((item) => item.spanId)
  const evidenceSpans = evidenceSpanIds.length
    ? queryAll<{ chapterNo: number; lineStart: number; lineEnd: number; text: string }>(
        `
          SELECT chapterNo, lineStart, lineEnd, text
          FROM TextSpan
          WHERE id IN (${evidenceSpanIds.map(() => '?').join(', ')}) AND branchId = ? AND chapterNo <= ?
          ORDER BY chapterNo DESC
        `,
        ...evidenceSpanIds,
        branchId,
        chapter.chapterNo
      )
    : []

  const warnings: string[] = []
  if (!snapshotRow || snapshotRow.status !== 'ready') {
    warnings.push('当前章节快照不是 ready，生成可能基于部分旧知识。')
  }

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
      content: renderBlock('截至当前章节的世界状态', [JSON.stringify(snapshot, null, 2)]),
    },
    {
      id: 'characters',
      label: '相关人物',
      enabled: true,
      priority: 'high',
      content: renderBlock(
        '相关人物',
        matchedEntities.length
          ? matchedEntities.map((entity) => `- ${entity.canonicalName}｜状态：${entity.status ?? '未知'}｜描述：${entity.description ?? '待补充'}`)
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
        '原文证据',
        evidenceSpans.length
          ? evidenceSpans.map((span) => `- 第 ${span.chapterNo} 章 ${span.lineStart}-${span.lineEnd} 行：${span.text}`)
          : ['- 没有检索到额外证据片段。']
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

  return {
    novelId: request.novelId,
    branchId,
    chapterId: request.chapterId,
    chapterNo: chapter.chapterNo,
    snapshotStatus: snapshotRow?.status ?? 'missing',
    selectedLineStart: selectionRange.lineStart,
    selectedLineEnd: selectionRange.lineEnd,
    warnings,
    assembledContext: blocks.filter((block) => block.enabled).map((block) => block.content).join('\n\n'),
    blocks,
  }
}
