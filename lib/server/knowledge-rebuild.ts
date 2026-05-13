import type { Chapter } from '@/lib/types'
import { type ChapterKnowledgeExtraction } from '@/lib/story-knowledge'
import { extractChapterKnowledgeOffline } from '@/lib/server/knowledge-extraction'
import {
  buildTextSpansFromLines,
  enqueueKnowledgeJob,
  getMainBranchId,
  hashContent,
  replaceChapterFts,
  splitChapterLines,
} from '@/lib/server/knowledge-store'
import { execute, queryAll, queryOne, withTransaction } from '@/lib/server/sqlite'
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
    errorMessage?: string | null
  }
) {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined)
  if (!entries.length) return
  execute(
    `UPDATE KnowledgeJob SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
    ...entries.map(([, value]) => value ?? null),
    jobId
  )
}

function getChapterProgressWeight(rawText: string | null) {
  const normalized = (rawText ?? '').trim()
  return Math.max(1, normalized.length)
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

    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }

  throw new Error('Knowledge rebuild timed out')
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
  }

  for (const relation of params.extraction.relations) {
    const sourceEntityId = entityIdByName.get(relation.source)
    const targetEntityId = entityIdByName.get(relation.target)
    if (!sourceEntityId || !targetEntityId) continue
    const evidence = relation.evidence[0]

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
      evidence ? findEvidenceSpanId(params.chapterId, evidence.lineStart, evidence.lineEnd) : null
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
      execute(
        `
          UPDATE KnowledgeWorld
          SET definition = ?, validToChapter = NULL, evidenceSpanId = ?, updatedAt = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        item.definition,
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
        LIMIT 16
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
        ORDER BY firstSeenChapter ASC
        LIMIT 12
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
      status: entity.status ?? '活跃',
      lastSeenChapter: entity.lastSeenChapter ?? chapter.chapterNo,
    }))
    snapshot.active_relationships = relations.map((relation) => ({
      source: relation.sourceName,
      target: relation.targetName,
      type: relation.relationType,
      polarity: relation.polarity ?? 'neutral',
      validFromChapter: relation.validFromChapter,
      evidenceChapter: relation.sourceChapter,
    }))
    snapshot.recent_events = events.map((event) => ({
      chapter: event.chapterNo,
      name: event.name,
      summary: event.summary,
    }))
    snapshot.world_rules = worlds.map((world) => ({
      term: world.term,
      definition: world.definition,
      firstSeenChapter: world.firstSeenChapter ?? chapter.chapterNo,
    }))
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
  const activeJob = queryOne<{ id: string }>(
    "SELECT id FROM KnowledgeJob WHERE novelId = ? AND branchId = ? AND jobType = 'extract_chapter_knowledge' AND status IN ('queued', 'running') ORDER BY createdAt DESC LIMIT 1",
    params.novelId,
    branchId
  )

  if (activeJob?.id) {
    await waitForKnowledgeJobCompletion(activeJob.id)
    return { jobId: activeJob.id }
  }

  const job = await enqueueKnowledgeJob({
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
    const existingDerivedKnowledgeCount = queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM ChapterSnapshot WHERE novelId = ? AND branchId = ?',
      params.novelId,
      branchId
    )?.count ?? 0
    const extractedChapters: Array<{
      chapterId: string
      chapterNo: number
      extraction: ChapterKnowledgeExtraction
    }> = []
    const totalChapterWeight = Math.max(1, chapters.reduce((sum, chapter) => sum + getChapterProgressWeight(chapter.rawText), 0))
    let processedChapterWeight = 0

    updateKnowledgeJob(job.id, { status: 'running', currentStep: '抽取章节知识', progress: 0.05 })

    for (let index = 0; index < chapters.length; index += 1) {
      const chapter = chapters[index]
      const chapterWeight = getChapterProgressWeight(chapter.rawText)
      updateKnowledgeJob(job.id, {
        currentStep: `抽取第 ${chapter.chapterNo} 章`,
        progress: 0.1 + (processedChapterWeight / totalChapterWeight) * 0.7,
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

      if (existingDerivedKnowledgeCount > 0 && extractionResult.provider === 'fallback') {
        throw new Error('Knowledge rebuild aborted because structured extraction failed and fallback would overwrite existing knowledge')
      }

      processedChapterWeight += chapterWeight

      updateKnowledgeJob(job.id, {
        currentStep: `抽取第 ${chapter.chapterNo} 章（Ollama${extractionResult.model ? `: ${extractionResult.model}` : ''}）`,
        progress: 0.1 + (processedChapterWeight / totalChapterWeight) * 0.7,
      })

      extractedChapters.push({
        chapterId: chapter.id,
        chapterNo: chapter.chapterNo,
        extraction: extractionResult.extraction,
      })
    }

    updateKnowledgeJob(job.id, { currentStep: '清理旧知识', progress: 0.8 })
    await clearDerivedKnowledge(params.novelId, branchId)

    for (let index = 0; index < extractedChapters.length; index += 1) {
      const chapter = extractedChapters[index]
      updateKnowledgeJob(job.id, {
        currentStep: `写入第 ${chapter.chapterNo} 章知识`,
        progress: 0.82 + ((index + 1) / Math.max(1, extractedChapters.length)) * 0.08,
      })

      await persistChapterExtraction({
        novelId: params.novelId,
        branchId,
        chapterId: chapter.chapterId,
        chapterNo: chapter.chapterNo,
        extraction: chapter.extraction,
      })
    }

    updateKnowledgeJob(job.id, { currentStep: '构建章节快照', progress: 0.9 })
    await buildSnapshotsForNovel({ novelId: params.novelId, branchId })
    updateKnowledgeJob(job.id, { status: 'succeeded', currentStep: '完成', progress: 1 })

    return { jobId: job.id }
  } catch (error) {
    updateKnowledgeJob(job.id, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Knowledge rebuild failed',
    })
    throw error
  }
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

  const spans = chapterRows.flatMap((row) =>
    buildTextSpansFromLines({
      novelId: params.novelId,
      branchId,
      chapterId: row.chapterId,
      chapterNo: row.chapterNo,
      text: row.rawText,
      lines: splitChapterLines(row.rawText),
    })
  )
  if (spans.length) {
    await replaceChapterFts(spans)
  }

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

  if (!chapters.length) return

  const groupedByNovel = new Map<string, Chapter[]>()
  for (const chapter of chapters) {
    const current = groupedByNovel.get(chapter.novelId) ?? []
    current.push(chapter)
    groupedByNovel.set(chapter.novelId, current)
  }

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
    const existingById = new Map(existing.map((item) => [item.id, item]))
    const existingSnapshotCount = queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM ChapterSnapshot WHERE novelId = ? AND branchId = ?',
      novelId,
      branchId
    )?.count ?? 0
    const activeJobCount = queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM KnowledgeJob WHERE novelId = ? AND branchId = ? AND status IN ('queued', 'running')",
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

    if (refreshedSpans.length) {
      await replaceChapterFts(refreshedSpans)
    }

    if (shouldBootstrapKnowledge) {
      if (activeJobCount === 0) {
        await rebuildKnowledgeForNovel({ novelId, branchId })
      }
      continue
    }

    if (firstChangedChapterNo !== null) {
      execute(
        `
          UPDATE ChapterSnapshot
          SET status = 'stale', updatedAt = CURRENT_TIMESTAMP
          WHERE novelId = ? AND branchId = ? AND chapterNo >= ?
        `,
        novelId,
        branchId,
        firstChangedChapterNo
      )
      execute(
        `
          UPDATE KnowledgeChapter
          SET isDirty = 1,
              dirtyReason = ?,
              knowledgeStatus = 'stale',
              updatedAt = CURRENT_TIMESTAMP
          WHERE novelId = ? AND branchId = ? AND chapterNo >= ?
        `,
        `Workspace changed from chapter ${firstChangedChapterNo}`,
        novelId,
        branchId,
        firstChangedChapterNo
      )
      if (activeJobCount === 0) {
        await enqueueKnowledgeJob({
          novelId,
          branchId,
          jobType: 'rebuild_from_chapter',
          currentStep: `等待从第 ${firstChangedChapterNo} 章重建`,
          payload: { fromChapterNo: firstChangedChapterNo },
        })
      }
    }
  }
}
