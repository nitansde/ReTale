import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import * as lancedb from '@lancedb/lancedb'
import type { AIProvider, EmbeddingsScenarioSettings, KnowledgeRebuildChapterRange } from '@/lib/types'
import { INF_CHAPTER } from '@/lib/server/chapter-interval'
import { estimateTokenCount, type TextSpanInput } from '@/lib/server/knowledge-store'
import { loadStoredAISettings } from '@/lib/server/ai-settings'
import { embedTextsWithOpenAICompatible } from '@/lib/server/openai-compatible'
import { embedTextsWithOllama } from '@/lib/server/ollama-local'
import {
  buildCanonicalRetrievalEmbeddingInput,
  buildEmbeddingInputHash,
  deleteRawTextEmbeddingCacheEntries,
  garbageCollectRawTextEmbeddingCacheEntries,
  lookupRawTextEmbeddingCacheEntries,
  upsertRawTextEmbeddingCacheEntries,
} from '@/lib/server/retrieval-embedding-cache'
import {
  loadExplicitAuthoredContext,
  hasExplicitAuthoredContextSelection,
  type AuthoredRetrievalSeed,
} from '@/lib/server/authored-context'
import { execute, queryAll, queryOne } from '@/lib/server/sqlite'
import {
  buildCharacterDescriptionDelta,
  buildCharacterRoleCardLines,
  hasCharacterRoleCardProfile,
  mergeCharacterRoleCardProfiles,
  normalizeCharacterRoleCardProfile,
  type CharacterRoleCardProfile,
} from '@/lib/story-knowledge'
import { getCharacterClassificationMetadata, type CharacterImportanceTier } from '@/lib/server/hanlp-contracts'

export type RetrievalDocSourceType =
  | 'text_span'
  | 'chapter_summary'
  | 'entity_profile'
  | 'event_summary'
  | 'worldbuilding'
  | 'relationship'
  | 'open_thread'
  | 'authored_delta'
  | 'future_jump_bridge'
  | 'future_jump_revision'

type RetrievalDocSeedRow = {
  id: string
  branchId: string
  sourceType: RetrievalDocSourceType
  sourceId: string
  chapterId: string
  chapterNo: number
  validFromChapter: number
  validUntilChapter: number
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
  embeddingProvider: AIProvider
  embeddingModel: string
  embeddingDimension: number
}

type RetrievalDocEmbeddingPlanRow = {
  row: RetrievalDocSeedRow
  rowIndex: number
  embeddingInput: string
  embeddingInputHash: string
  cachedVector: number[] | null
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
  validUntilChapter: number
  status: string
  includeByDefault: number
}

type ActiveRetrievalIndexRow = {
  scopeKey: string
  tableName: string
  scopeStartChapter: number | null
  scopeEndChapter: number | null
}

type LanceDatabase = Awaited<ReturnType<typeof getDatabase>>

export type RetrievalIndexBuildPhase = 'loading' | 'embedding' | 'creating_table' | 'building_text_index' | 'building_vector_index' | 'completed'

export type RetrievalIndexBuildProgress = {
  phase: RetrievalIndexBuildPhase
  totalRows: number
  embeddedRows: number
  totalBatches: number
  completedBatches: number
}

export type RetrievalIndexBuildResult = {
  rowCount: number
  embeddingBatchCount: number
}

export type RawTextEmbeddingPrecomputeSettingsSnapshot = {
  provider: AIProvider
  model: string
  embeddingBatchSize: number
}

export type RawTextEmbeddingPrecomputeProgress = {
  totalDocs: number
  completedDocs: number
  cacheHits: number
  cacheMisses: number
  failedDocs: number
  totalBatches: number
  completedBatches: number
  degraded: boolean
}

export type RawTextEmbeddingPrecomputeResult = RawTextEmbeddingPrecomputeProgress & {
  cancelled: boolean
  durationMs: number
}

const LANCEDB_DIR = process.env.LANCEDB_DIR?.trim() || path.join(process.cwd(), '.lancedb')
const TABLE_PREFIX = 'retrieval_docs_'
const DEFAULT_EMBEDDING_BATCH_SIZE = 16
const RETRIEVAL_EMBEDDING_RETRY_DELAYS_MS = [500, 1500] as const
const OLLAMA_RETRIEVAL_EMBEDDING_MAX_BATCH_CHARS = 6000
const LANCEDB_INDEX_LOG_PREFIX = '[LanceDB Index]'
const LANCE_INDEX_UNAVAILABLE_WARNING = 'Lance retrieval index is missing or stale for this branch; rebuild knowledge to refresh retrieval evidence.'
const PACKABLE_TEXT_SPAN_TYPES = new Set(['paragraph', 'evidence', 'summary'])
const MAX_PACKED_TEXT_SPAN_TOKENS = 320
const MAX_PACKED_TEXT_SPAN_ITEMS = 8
const FULL_RETRIEVAL_INDEX_SCOPE_KEY = 'full'
const branchRetrievalIndexLocks = new Map<string, Promise<void>>()

const SOURCE_TYPE_PRIORITY: Record<RetrievalDocSourceType, number> = {
  text_span: 1,
  relationship: 0.92,
  entity_profile: 0.84,
  event_summary: 0.78,
  worldbuilding: 0.72,
  chapter_summary: 0.64,
  open_thread: 0.58,
  authored_delta: 0.91,
  future_jump_bridge: 0.88,
  future_jump_revision: 0.94,
}

const SOURCE_TYPE_LIMITS: Record<RetrievalDocSourceType, number> = {
  text_span: 5,
  relationship: 2,
  entity_profile: 2,
  event_summary: 2,
  worldbuilding: 2,
  chapter_summary: 1,
  open_thread: 1,
  authored_delta: 3,
  future_jump_bridge: 1,
  future_jump_revision: 1,
}

function scoreAuthoredRetrievalSeed(params: {
  row: AuthoredRetrievalSeed
  queryTerms: string[]
  graphTerms: string[]
}) {
  const haystack = [params.row.title, params.row.text, params.row.sourceLabel].join('\n').toLowerCase()
  const allTerms = Array.from(new Set([...params.queryTerms, ...params.graphTerms].map((term) => term.trim()).filter(Boolean)))
  const matchedTerms = allTerms.filter((term) => haystack.includes(term.toLowerCase()))
  const overlapScore = allTerms.length ? matchedTerms.length / allTerms.length : 0.4
  const baseScore = params.row.sourceType === 'future_jump_revision'
    ? 0.9
    : params.row.sourceType === 'future_jump_bridge'
      ? 0.82
      : 0.78

  return baseScore + overlapScore * 0.18
}

function buildExplicitAuthoredMatches(params: {
  novelId: string
  branchId: string
  queryTerms: string[]
  graphTerms: string[]
  whatIfSessionId?: string
  futureJumpRunId?: string
}) {
  if (!hasExplicitAuthoredContextSelection(params)) {
    return [] as LanceEvidenceMatch[]
  }

  const authoredContext = loadExplicitAuthoredContext({
    novelId: params.novelId,
    branchId: params.branchId,
    whatIfSessionId: params.whatIfSessionId,
    futureJumpRunId: params.futureJumpRunId,
  })

  return authoredContext.retrievalSeeds
    .map<LanceEvidenceMatch>((row) => ({
      id: row.id,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      chapterId: null,
      chapterNo: row.chapterNo,
      lineStart: null,
      lineEnd: null,
      title: row.title,
      sourceLabel: row.sourceLabel,
      text: row.text,
      score: scoreAuthoredRetrievalSeed({
        row,
        queryTerms: params.queryTerms,
        graphTerms: params.graphTerms,
      }),
    }))
    .sort((left, right) => right.score - left.score || right.chapterNo - left.chapterNo)
}

function hashValue(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function getBranchTableName(branchId: string) {
  return `${TABLE_PREFIX}${hashValue(branchId).slice(0, 16)}`
}

function getVersionedBranchTableName(branchId: string) {
  return `${getBranchTableName(branchId)}_${Date.now().toString(36)}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

function getRetrievalIndexScope(chapterRange?: KnowledgeRebuildChapterRange) {
  if (!chapterRange) {
    return {
      scopeKey: FULL_RETRIEVAL_INDEX_SCOPE_KEY,
      scopeStartChapter: null,
      scopeEndChapter: null,
    }
  }

  const { startChapter, endChapter } = normalizeKnowledgeRebuildChapterRange(chapterRange)
  return {
    scopeKey: `chapter-range:${startChapter}:${endChapter ?? 'open'}`,
    scopeStartChapter: startChapter,
    scopeEndChapter: endChapter ?? null,
  }
}

function getActiveBranchTableRows(branchId: string) {
  return queryAll<ActiveRetrievalIndexRow>(
    `
      SELECT scopeKey, tableName, scopeStartChapter, scopeEndChapter
      FROM ActiveRetrievalIndex
      WHERE branchId = ?
    `,
    branchId,
  )
}

function getActiveBranchTableName(branchId: string, scopeKey = FULL_RETRIEVAL_INDEX_SCOPE_KEY) {
  return queryOne<ActiveRetrievalIndexRow>(
    `
      SELECT scopeKey, tableName, scopeStartChapter, scopeEndChapter
      FROM ActiveRetrievalIndex
      WHERE branchId = ? AND scopeKey = ?
    `,
    branchId,
    scopeKey,
  )?.tableName ?? null
}

function setActiveBranchTableName(branchId: string, tableName: string, scope: ReturnType<typeof getRetrievalIndexScope>) {
  execute(
    `
      INSERT INTO ActiveRetrievalIndex (branchId, scopeKey, tableName, scopeStartChapter, scopeEndChapter, updatedAt)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(branchId, scopeKey) DO UPDATE SET
        tableName = excluded.tableName,
        scopeStartChapter = excluded.scopeStartChapter,
        scopeEndChapter = excluded.scopeEndChapter,
        updatedAt = CURRENT_TIMESTAMP
    `,
    branchId,
    scope.scopeKey,
    tableName,
    scope.scopeStartChapter,
    scope.scopeEndChapter,
  )
}

function clearActiveBranchTableName(branchId: string, scopeKey?: string) {
  if (scopeKey) {
    execute('DELETE FROM ActiveRetrievalIndex WHERE branchId = ? AND scopeKey = ?', branchId, scopeKey)
    return
  }

  execute('DELETE FROM ActiveRetrievalIndex WHERE branchId = ?', branchId)
}

function branchTableNameBelongsToBranch(branchId: string, tableName: string) {
  const baseName = getBranchTableName(branchId)
  return tableName === baseName || tableName.startsWith(`${baseName}_`)
}

async function withBranchRetrievalIndexLock<T>(branchId: string, callback: () => Promise<T>) {
  const previousLock = branchRetrievalIndexLocks.get(branchId) ?? Promise.resolve()
  let releaseLock: () => void = () => undefined
  const currentLock = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  const nextLock = previousLock.catch(() => undefined).then(() => currentLock)
  branchRetrievalIndexLocks.set(branchId, nextLock)

  await previousLock.catch(() => undefined)
  try {
    return await callback()
  } finally {
    releaseLock()
    if (branchRetrievalIndexLocks.get(branchId) === nextLock) {
      branchRetrievalIndexLocks.delete(branchId)
    }
  }
}

async function dropInactiveBranchTable(database: LanceDatabase, branchId: string, tableName: string) {
  if (!branchTableNameBelongsToBranch(branchId, tableName) || getActiveBranchTableRows(branchId).some((row) => row.tableName === tableName)) {
    return
  }

  try {
    const tableNames = await database.tableNames()
    if (tableNames.includes(tableName)) {
      await database.dropTable(tableName)
    }
  } catch (error) {
    const cleanupMessage = error instanceof Error ? error.message : 'unknown LanceDB cleanup error'
    logLanceIndex(`failed to drop inactive retrieval table ${tableName}: ${cleanupMessage}`)
  }
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

export function mergeRetrievalDocGroups(...groups: RetrievalDocSeedRow[][]) {
  const rows: RetrievalDocSeedRow[] = []
  for (const group of groups) {
    for (const row of group) {
      rows.push(row)
    }
  }
  return rows
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

function getTextSpanTokenEstimate(span: TextSpanInput) {
  return span.tokenEstimate ?? estimateTokenCount(span.text)
}

function textSpanIsInChapterRange(span: TextSpanInput, chapterRange?: KnowledgeRebuildChapterRange) {
  if (!chapterRange) return true
  const startChapter = typeof chapterRange.startChapter === 'number' ? Math.max(1, Math.floor(chapterRange.startChapter)) : 1
  const endChapter = typeof chapterRange.endChapter === 'number' ? Math.max(1, Math.floor(chapterRange.endChapter)) : null
  return span.chapterNo >= startChapter && (endChapter === null || span.chapterNo <= endChapter)
}

function shouldPackTextSpan(span: TextSpanInput) {
  if (!PACKABLE_TEXT_SPAN_TYPES.has(span.spanType)) {
    return false
  }

  if (!span.text.trim()) {
    return false
  }

  return true
}

function buildPackedTextSpan(spans: TextSpanInput[]) {
  const first = spans[0]
  const last = spans[spans.length - 1]
  const text = spans.map((span) => span.text.trim()).filter(Boolean).join('\n\n')
  const tokenEstimate = estimateTokenCount(text)
  const contentHash = buildContentHash([
    first.branchId,
    first.chapterId,
    first.spanType,
    first.lineStart,
    last.lineEnd,
    ...spans.map((span) => span.id),
    ...spans.map((span) => span.text),
  ])

  return {
    id: `packed-span:${contentHash.slice(0, 24)}`,
    novelId: first.novelId,
    branchId: first.branchId,
    chapterId: first.chapterId,
    chapterNo: first.chapterNo,
    lineStart: Math.min(...spans.map((span) => span.lineStart)),
    lineEnd: Math.max(...spans.map((span) => span.lineEnd)),
    charStart: spans[0]?.charStart ?? null,
    charEnd: spans[spans.length - 1]?.charEnd ?? null,
    text,
    spanType: first.spanType,
    tokenEstimate,
  } satisfies TextSpanInput
}

function loadPackedBranchTextSpans(novelId: string, branchId: string, chapterRange?: KnowledgeRebuildChapterRange) {
  const spans = loadBranchTextSpans(novelId, branchId).filter((span) => textSpanIsInChapterRange(span, chapterRange))
  const packed: TextSpanInput[] = []
  const packableGroups = new Map<string, TextSpanInput[]>()

  for (const span of spans) {
    if (!shouldPackTextSpan(span)) {
      packed.push(span)
      continue
    }

    const groupKey = [span.branchId, span.chapterId, span.chapterNo, span.spanType].join('::')
    const current = packableGroups.get(groupKey) ?? []
    current.push(span)
    packableGroups.set(groupKey, current)
  }

  for (const group of packableGroups.values()) {
    let currentPack: TextSpanInput[] = []
    let currentPackTokens = 0

    const flushPack = () => {
      if (!currentPack.length) return
      packed.push(currentPack.length === 1 ? currentPack[0] : buildPackedTextSpan(currentPack))
      currentPack = []
      currentPackTokens = 0
    }

    for (const span of group) {
      const spanTokens = getTextSpanTokenEstimate(span)
      const canAppend = currentPack.length > 0
        && currentPackTokens + spanTokens <= MAX_PACKED_TEXT_SPAN_TOKENS
        && currentPack.length < MAX_PACKED_TEXT_SPAN_ITEMS

      if (!canAppend) {
        flushPack()
      }

      currentPack.push(span)
      currentPackTokens += spanTokens
    }

    flushPack()
  }

  return packed.sort((left, right) => left.chapterNo - right.chapterNo || left.lineStart - right.lineStart || left.lineEnd - right.lineEnd || left.spanType.localeCompare(right.spanType))
}

function buildRetrievalEmbeddingText(row: RetrievalDocSeedRow) {
  return buildCanonicalRetrievalEmbeddingInput({
    sourceLabel: row.sourceLabel,
    title: row.title,
    relatedEntityNames: row.relatedEntityNames,
    relatedEventNames: row.relatedEventNames,
    relatedTerms: row.relatedTerms,
    text: row.text,
  })
}

function buildRetrievalEmbeddingInput(row: RetrievalDocSeedRow) {
  const text = buildRetrievalEmbeddingText(row)
  return {
    text,
    embeddingInputHash: buildEmbeddingInputHash(text),
  }
}

export function buildRawTextRetrievalEmbeddingInput(row: RetrievalDocSeedRow) {
  return buildRetrievalEmbeddingInput(row)
}

async function embedTextsForRawTextPrecompute(
  embeddingInputs: string[],
  settingsSnapshot: RawTextEmbeddingPrecomputeSettingsSnapshot,
) {
  const result = settingsSnapshot.provider === 'openai-compatible'
    ? await embedTextsWithOpenAICompatible(embeddingInputs, { model: settingsSnapshot.model })
    : await embedTextsWithOllama(embeddingInputs, { model: settingsSnapshot.model })

  if (!result.enabled || !result.embeddings) {
    throw new Error(result.error || 'Failed to generate raw-text precompute embeddings')
  }

  if (result.embeddings.length !== embeddingInputs.length) {
    throw new Error(`Embedding provider returned ${result.embeddings.length} embeddings for ${embeddingInputs.length} raw-text docs`)
  }

  const dimension = result.embeddings[0]?.length ?? 0
  if (!dimension || result.embeddings.some((vector) => vector.length !== dimension)) {
    throw new Error('Raw-text precompute embedding dimensions are inconsistent within an embedding batch')
  }

  return result.embeddings
}

async function waitForRawTextPrecomputeRetry(delayMs: number, shouldContinue?: () => boolean | Promise<boolean>) {
  if (shouldContinue && !(await shouldContinue())) {
    return false
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs))

  if (shouldContinue && !(await shouldContinue())) {
    return false
  }

  return true
}

export async function precomputeRawTextEmbeddingCache(params: {
  novelId: string
  branchId: string
  settingsSnapshot: RawTextEmbeddingPrecomputeSettingsSnapshot
  chapterRange?: KnowledgeRebuildChapterRange
  maxConcurrentBatches?: number
  shouldContinue?: () => boolean | Promise<boolean>
  onProgress?: (progress: RawTextEmbeddingPrecomputeProgress) => void | Promise<void>
}): Promise<RawTextEmbeddingPrecomputeResult> {
  const startedAt = Date.now()
  const maxConcurrentBatches = Math.max(1, Math.floor(params.maxConcurrentBatches ?? 2))
  const cacheScope = {
    novelId: params.novelId,
    branchId: params.branchId,
    provider: params.settingsSnapshot.provider,
    model: params.settingsSnapshot.model,
  }
  const rawTextDocs = loadRawTextRetrievalDocs(params.novelId, params.branchId, params.chapterRange)
  const docsWithInputs = rawTextDocs.map((row) => ({
    row,
    ...buildRawTextRetrievalEmbeddingInput(row),
  }))
  const reachableEmbeddingInputHashes = docsWithInputs.map((item) => item.embeddingInputHash)
  const hits = await lookupRawTextEmbeddingCacheEntries({
    scope: cacheScope,
    embeddingInputHashes: reachableEmbeddingInputHashes,
    touchOnHit: true,
  })

  const hitHashes = new Set(hits.map((entry) => entry.embeddingInputHash))
  const hitDocsCount = docsWithInputs.filter((item) => hitHashes.has(item.embeddingInputHash)).length
  const missingDocs = docsWithInputs.filter((item) => !hitHashes.has(item.embeddingInputHash))
  const batchSize = Math.max(1, Math.floor(params.settingsSnapshot.embeddingBatchSize || DEFAULT_EMBEDDING_BATCH_SIZE))
  const missingBatches = Array.from(
    { length: Math.ceil(missingDocs.length / batchSize) },
    (_, index) => missingDocs.slice(index * batchSize, (index + 1) * batchSize),
  ).filter((batch) => batch.length > 0)

  const progress: RawTextEmbeddingPrecomputeProgress = {
    totalDocs: docsWithInputs.length,
    completedDocs: hitDocsCount,
    cacheHits: hitDocsCount,
    cacheMisses: missingDocs.length,
    failedDocs: 0,
    totalBatches: missingBatches.length,
    completedBatches: 0,
    degraded: false,
  }
  let cancelled = false

  const finalizeReachableCacheSet = async () => {
    if (cancelled) {
      return
    }

    if (params.chapterRange) {
      return
    }

    await garbageCollectRawTextEmbeddingCacheEntries({
      scope: cacheScope,
      reachableEmbeddingInputHashes,
    })
  }

  await params.onProgress?.({ ...progress })

  if (!missingBatches.length) {
    await finalizeReachableCacheSet()
    return {
      ...progress,
      cancelled: false,
      durationMs: Date.now() - startedAt,
    }
  }

  let nextBatchIndex = 0

  const runBatch = async (batch: typeof missingBatches[number]) => {
    const embeddingInputs = batch.map((item) => item.text)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const embeddings = await embedTextsForRawTextPrecompute(embeddingInputs, params.settingsSnapshot)
        await upsertRawTextEmbeddingCacheEntries({
          scope: cacheScope,
          entries: batch.map((item, index) => ({
            embeddingInput: item.text,
            vector: embeddings[index],
          })),
        })
        progress.completedDocs += batch.length
        return
      } catch (error) {
        if (attempt >= 2) {
          progress.failedDocs += batch.length
          progress.degraded = true
          return
        }

        const shouldRetry = await waitForRawTextPrecomputeRetry(attempt === 0 ? 500 : 1500, params.shouldContinue)
        if (!shouldRetry) {
          cancelled = true
          return
        }
      }
    }
  }

  const worker = async () => {
    while (nextBatchIndex < missingBatches.length) {
      if (params.shouldContinue && !(await params.shouldContinue())) {
        cancelled = true
        return
      }

      const batchIndex = nextBatchIndex
      nextBatchIndex += 1
      const batch = missingBatches[batchIndex]
      await runBatch(batch)
      progress.completedBatches += 1
      await params.onProgress?.({ ...progress })
      if (cancelled) {
        return
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrentBatches, missingBatches.length) }, () => worker())
  )
  await finalizeReachableCacheSet()

  return {
    ...progress,
    cancelled,
    durationMs: Date.now() - startedAt,
  }
}

function formatElapsed(elapsedMs: number) {
  return `${(elapsedMs / 1000).toFixed(1)}s`
}

function formatRetrievalBatchPreview(rows: Array<Pick<RetrievalDocEmbeddingPlanRow, 'row'>>) {
  return rows
    .slice(0, 3)
    .map(({ row }) => `id=${row.id}, source=${row.sourceType}/${row.sourceId}, chapter=${row.chapterNo}`)
    .join(' | ')
}

type RetrievalErrorLikeDetails = {
  name: string | null
  code: string | null
  message: string | null
}

function readRetrievalErrorLikeDetails(value: unknown): RetrievalErrorLikeDetails {
  if (value instanceof Error) {
    const record = value as Error & { code?: unknown }
    return {
      name: value.name || null,
      code: typeof record.code === 'string' || typeof record.code === 'number' ? String(record.code) : null,
      message: value.message || null,
    }
  }

  if (typeof value === 'string') {
    return {
      name: null,
      code: null,
      message: value,
    }
  }

  if (!value || typeof value !== 'object') {
    return {
      name: null,
      code: null,
      message: null,
    }
  }

  const record = value as Record<string, unknown>
  return {
    name: typeof record.name === 'string' ? record.name : null,
    code: typeof record.code === 'string' || typeof record.code === 'number' ? String(record.code) : null,
    message: typeof record.message === 'string' ? record.message : null,
  }
}

function buildRetrievalBatchErrorMessage(
  rows: Array<Pick<RetrievalDocEmbeddingPlanRow, 'row'>>,
  error: unknown,
) {
  const preview = formatRetrievalBatchPreview(rows)
  return `Failed to generate retrieval embeddings for batchSize=${rows.length}${preview ? `, preview=${preview}` : ''}: ${getErrorMessage(error)}`
}

function logLanceIndex(message: string) {
  console.log(`${LANCEDB_INDEX_LOG_PREFIX} ${message}`)
}

function getEmbeddingBatchSize(settings: EmbeddingsScenarioSettings) {
  return Math.max(1, Math.floor(settings.embeddingBatchSize || DEFAULT_EMBEDDING_BATCH_SIZE))
}

async function embedRetrievalRowBatch(
  rows: Array<Pick<RetrievalDocEmbeddingPlanRow, 'row' | 'embeddingInput'>>,
  settings: EmbeddingsScenarioSettings,
) {
  if (!rows.length) return [] as RetrievalDocRow[]

  const embeddingInputs = rows.map((item) => item.embeddingInput)
  const result = settings.provider === 'openai-compatible'
    ? await embedTextsWithOpenAICompatible(embeddingInputs, settings.openAICompatible)
    : await embedTextsWithOllama(embeddingInputs, settings.ollama)
  if (!result.enabled || !result.embeddings) {
    throw new Error(result.error || 'Failed to generate retrieval embeddings')
  }
  const embeddings = result.embeddings
  if (embeddings.length !== rows.length) {
    throw new Error(`Embedding provider returned ${embeddings.length} embeddings for ${rows.length} retrieval rows`)
  }

  const dimension = embeddings[0]?.length ?? 0
  if (!dimension || embeddings.some((vector) => vector.length !== dimension)) {
    throw new Error('Retrieval embedding dimensions are inconsistent within an embedding batch')
  }

  return rows.map(({ row }, index) => ({
    ...row,
    vector: embeddings[index],
  }))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isRetryableRetrievalEmbeddingError(error: unknown) {
  const topLevelDetails = readRetrievalErrorLikeDetails(error)
  const nestedCause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined
  const causeDetails = readRetrievalErrorLikeDetails(nestedCause)
  const normalizedHaystack = [
    topLevelDetails.name,
    topLevelDetails.code,
    topLevelDetails.message,
    causeDetails.name,
    causeDetails.code,
    causeDetails.message,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase()

  return normalizedHaystack.includes('fetch failed')
    || normalizedHaystack.includes('timed out')
    || normalizedHaystack.includes('aborterror')
    || normalizedHaystack.includes('ecconnreset')
    || normalizedHaystack.includes('econnreset')
    || normalizedHaystack.includes('econnrefused')
    || normalizedHaystack.includes('etimedout')
    || normalizedHaystack.includes('socket hang up')
    || normalizedHaystack.includes('und_err')
}

async function waitForRetrievalEmbeddingRetry(delayMs: number) {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

async function embedRetrievalRowBatchWithRetry(
  rows: Array<Pick<RetrievalDocEmbeddingPlanRow, 'row' | 'embeddingInput'>>,
  settings: EmbeddingsScenarioSettings,
) {
  let lastError: unknown = null

  for (let attempt = 0; attempt <= RETRIEVAL_EMBEDDING_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await embedRetrievalRowBatch(rows, settings)
    } catch (error) {
      lastError = error
      if (!isRetryableRetrievalEmbeddingError(error) || attempt >= RETRIEVAL_EMBEDDING_RETRY_DELAYS_MS.length) {
        throw new Error(buildRetrievalBatchErrorMessage(rows, error))
      }

      const delayMs = RETRIEVAL_EMBEDDING_RETRY_DELAYS_MS[attempt]
      logLanceIndex(`embedding retry ${attempt + 1}/${RETRIEVAL_EMBEDDING_RETRY_DELAYS_MS.length + 1} in ${delayMs}ms: ${buildRetrievalBatchErrorMessage(rows, error)}`)
      await waitForRetrievalEmbeddingRetry(delayMs)
    }
  }

  throw new Error(buildRetrievalBatchErrorMessage(rows, lastError ?? 'unknown retrieval embedding failure'))
}

function buildRetrievalEmbeddingBatches(
  rows: RetrievalDocEmbeddingPlanRow[],
  settings: EmbeddingsScenarioSettings,
  embeddingBatchSize: number,
) {
  const maxRows = Math.max(1, Math.floor(embeddingBatchSize))
  const maxChars = settings.provider === 'ollama'
    ? OLLAMA_RETRIEVAL_EMBEDDING_MAX_BATCH_CHARS
    : Number.POSITIVE_INFINITY
  const batches: RetrievalDocEmbeddingPlanRow[][] = []
  let currentBatch: RetrievalDocEmbeddingPlanRow[] = []
  let currentChars = 0

  const flushBatch = () => {
    if (!currentBatch.length) return
    batches.push(currentBatch)
    currentBatch = []
    currentChars = 0
  }

  for (const row of rows) {
    const inputChars = row.embeddingInput.length
    const exceedsRowLimit = currentBatch.length >= maxRows
    const exceedsCharLimit = currentBatch.length > 0 && currentChars + inputChars > maxChars

    if (exceedsRowLimit || exceedsCharLimit) {
      flushBatch()
    }

    currentBatch.push(row)
    currentChars += inputChars
  }

  flushBatch()
  return batches
}

function getEmbeddingModel(settings: EmbeddingsScenarioSettings) {
  return settings.provider === 'openai-compatible'
    ? settings.openAICompatible.model
    : settings.ollama.model
}

function buildRawTextEmbeddingCacheScope(novelId: string, branchId: string, settings: EmbeddingsScenarioSettings) {
  return {
    novelId,
    branchId,
    provider: settings.provider,
    model: getEmbeddingModel(settings),
  }
}

async function buildRetrievalEmbeddingPlan(params: {
  novelId: string
  branchId: string
  rows: RetrievalDocSeedRow[]
  embeddingSettings: EmbeddingsScenarioSettings
}) {
  const plannedRows = params.rows.map<RetrievalDocEmbeddingPlanRow>((row, rowIndex) => {
    const { text, embeddingInputHash } = buildRetrievalEmbeddingInput(row)
    return {
      row,
      rowIndex,
      embeddingInput: text,
      embeddingInputHash,
      cachedVector: null,
    }
  })

  const rawTextRows = plannedRows.filter((item) => item.row.sourceType === 'text_span')
  if (!rawTextRows.length) {
    return plannedRows
  }

  const cacheScope = buildRawTextEmbeddingCacheScope(params.novelId, params.branchId, params.embeddingSettings)
  const cacheHits = await lookupRawTextEmbeddingCacheEntries({
    scope: cacheScope,
    embeddingInputHashes: rawTextRows.map((item) => item.embeddingInputHash),
    touchOnHit: true,
  })
  const cacheHitVectors = new Map(cacheHits.map((entry) => [entry.embeddingInputHash, entry.vector]))

  for (const item of rawTextRows) {
    item.cachedVector = cacheHitVectors.get(item.embeddingInputHash) ?? null
  }

  return plannedRows
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
    validUntilChapter: INF_CHAPTER,
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

async function resolveBranchTableName(branchId: string, database: Awaited<ReturnType<typeof getDatabase>>) {
  const tableNames = await database.tableNames()
  const activeTableName = getActiveBranchTableName(branchId, FULL_RETRIEVAL_INDEX_SCOPE_KEY)
  if (activeTableName) {
    return branchTableNameBelongsToBranch(branchId, activeTableName) && tableNames.includes(activeTableName)
      ? activeTableName
      : null
  }

  const legacyTableName = getBranchTableName(branchId)
  return tableNames.includes(legacyTableName) ? legacyTableName : null
}

async function hasBranchTable(branchId: string) {
  const database = await getDatabase()
  return Boolean(await resolveBranchTableName(branchId, database))
}

async function openBranchTable(branchId: string) {
  const database = await getDatabase()
  const tableName = await resolveBranchTableName(branchId, database)
  if (!tableName) {
    return null
  }

  return database.openTable(tableName)
}

export async function hasBranchRetrievalIndex(branchId: string) {
  return hasBranchTable(branchId)
}

async function ensureTextIndex(table: Awaited<ReturnType<typeof openBranchTable>> extends infer T ? Exclude<T, null> : never) {
  try {
    await table.createIndex('text', {
      config: lancedb.Index.fts(),
      waitTimeoutSeconds: 3600,
    })
    await table.waitForIndex(['text_idx'], 3600)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'unknown LanceDB FTS index error'
  }
}

async function ensureVectorIndex(table: Awaited<ReturnType<typeof openBranchTable>> extends infer T ? Exclude<T, null> : never) {
  try {
    await table.createIndex('vector', { waitTimeoutSeconds: 3600 })
    await table.waitForIndex(['vector_idx'], 3600)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'unknown LanceDB vector index error'
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

type NormalizedKnowledgeRebuildChapterRange = {
  startChapter: number
  endChapter?: number
}

function normalizeKnowledgeRebuildChapterRange(chapterRange: KnowledgeRebuildChapterRange): NormalizedKnowledgeRebuildChapterRange {
  const startChapter = typeof chapterRange.startChapter === 'number'
    ? Math.max(1, Math.floor(chapterRange.startChapter))
    : 1
  const endChapter = typeof chapterRange.endChapter === 'number'
    ? Math.max(startChapter, Math.floor(chapterRange.endChapter))
    : undefined

  return {
    startChapter,
    endChapter,
  }
}

function docOverlapsChapterRange(row: Pick<RetrievalDocSeedRow, 'validFromChapter' | 'validUntilChapter'>, chapterRange: KnowledgeRebuildChapterRange) {
  const { startChapter, endChapter } = normalizeKnowledgeRebuildChapterRange(chapterRange)

  if (row.validUntilChapter <= startChapter) {
    return false
  }

  if (endChapter === undefined) {
    return true
  }

  return row.validFromChapter <= endChapter
}

async function writeBranchTableRows(params: {
  branchId: string
  rows: RetrievalDocEmbeddingPlanRow[]
  novelId: string
  scope: ReturnType<typeof getRetrievalIndexScope>
  embeddingSettings: EmbeddingsScenarioSettings
  embeddingBatchSize: number
  onProgress?: (progress: RetrievalIndexBuildProgress) => void | Promise<void>
}) {
  const {
    branchId,
    rows,
    novelId,
    scope,
    embeddingSettings,
    embeddingBatchSize,
    onProgress,
  } = params

  const database = await getDatabase()
  const rawTextCacheScope = buildRawTextEmbeddingCacheScope(novelId, branchId, embeddingSettings)
  const liveRows = rows.filter((item) => item.row.sourceType !== 'text_span' || !item.cachedVector)
  const liveBatches = buildRetrievalEmbeddingBatches(liveRows, embeddingSettings, embeddingBatchSize)
  let totalBatches = Math.max(Math.ceil(rows.length / embeddingBatchSize), liveBatches.length)
  const embeddingProvider = embeddingSettings.provider
  const embeddingModel = getEmbeddingModel(embeddingSettings)
  const embeddingStartedAt = Date.now()
  let embeddingElapsedMs = 0
  let writeElapsedMs = 0
  let completedBatches = 0
  let embeddedRowsCount = 0
  let expectedVectorDimension: number | null = null
  const resolvedRows = Array<RetrievalDocRow | null>(rows.length).fill(null)
  const deferredRawTextRows: RetrievalDocEmbeddingPlanRow[] = []

  const assignResolvedRow = (plannedRow: RetrievalDocEmbeddingPlanRow, vector: number[]) => {
    if (!vector.length) {
      throw new Error('Retrieval embedding vector must be non-empty during LanceDB rebuild')
    }
    if (vector.some((value) => !Number.isFinite(value))) {
      throw new Error('Retrieval embedding vector contains a non-finite value during LanceDB rebuild')
    }
    if (expectedVectorDimension === null) {
      expectedVectorDimension = vector.length
    } else if (expectedVectorDimension !== vector.length) {
      throw new Error('Retrieval embedding dimensions are inconsistent across cached and live LanceDB rows')
    }
    resolvedRows[plannedRow.rowIndex] = {
      ...plannedRow.row,
      vector,
      embeddingProvider,
      embeddingModel,
      embeddingDimension: vector.length,
    }
  }

  logLanceIndex(`embedding started: docs=${rows.length}, batchSize=${embeddingBatchSize}, liveBatches=${liveBatches.length}`)

  for (const batch of liveBatches) {
    const embeddingBatchStartedAt = Date.now()
    const embeddedBatch = await embedRetrievalRowBatchWithRetry(batch, embeddingSettings)
    embeddingElapsedMs += Date.now() - embeddingBatchStartedAt
    const batchDimension = embeddedBatch[0]?.vector.length ?? 0

    if (!batchDimension || embeddedBatch.some((row) => row.vector.length !== batchDimension)) {
      throw new Error('Retrieval embedding dimensions are inconsistent within a LanceDB write batch')
    }
    if (expectedVectorDimension === null) {
      expectedVectorDimension = batchDimension
    } else if (expectedVectorDimension !== batchDimension) {
      throw new Error('Retrieval embedding dimensions are inconsistent across LanceDB batches')
    }

    for (const [batchIndex, embeddedRow] of embeddedBatch.entries()) {
      assignResolvedRow(batch[batchIndex], embeddedRow.vector)
    }

    const rawTextBatch = batch
      .map((item, itemIndex) => ({ item, vector: embeddedBatch[itemIndex]?.vector }))
      .filter((entry): entry is { item: RetrievalDocEmbeddingPlanRow; vector: number[] } => entry.item.row.sourceType === 'text_span' && Array.isArray(entry.vector))
    if (rawTextBatch.length) {
      await upsertRawTextEmbeddingCacheEntries({
        scope: rawTextCacheScope,
        entries: rawTextBatch.map(({ item, vector }) => ({
          embeddingInput: item.embeddingInput,
          vector,
        })),
      })
    }

    embeddedRowsCount = resolvedRows.filter(Boolean).length
    completedBatches += 1

    const embeddingWallElapsedMs = Date.now() - embeddingStartedAt
    const docsPerSec = embeddingWallElapsedMs > 0
      ? (embeddedRowsCount / (embeddingWallElapsedMs / 1000)).toFixed(1)
      : '0.0'

    logLanceIndex(`embedding progress: embedded=${embeddedRowsCount}/${rows.length}, docsPerSec=${docsPerSec}`)
    await onProgress?.({
      phase: 'embedding',
      totalRows: rows.length,
      embeddedRows: embeddedRowsCount,
      totalBatches,
      completedBatches,
    })
  }

  for (const item of rows) {
    if (item.row.sourceType !== 'text_span' || !item.cachedVector) {
      continue
    }

    if (expectedVectorDimension !== null && item.cachedVector.length !== expectedVectorDimension) {
      deferredRawTextRows.push({
        ...item,
        cachedVector: null,
      })
      continue
    }

    assignResolvedRow(item, item.cachedVector)
  }

  if (deferredRawTextRows.length) {
    await deleteRawTextEmbeddingCacheEntries({
      scope: rawTextCacheScope,
      embeddingInputHashes: deferredRawTextRows.map((item) => item.embeddingInputHash),
    })

    const deferredBatches = buildRetrievalEmbeddingBatches(deferredRawTextRows, embeddingSettings, embeddingBatchSize)
    totalBatches = Math.max(totalBatches, completedBatches + deferredBatches.length)

    for (const batch of deferredBatches) {
      const embeddingBatchStartedAt = Date.now()
      const embeddedBatch = await embedRetrievalRowBatchWithRetry(batch, embeddingSettings)
      embeddingElapsedMs += Date.now() - embeddingBatchStartedAt

      const batchDimension = embeddedBatch[0]?.vector.length ?? 0
      if (!batchDimension || embeddedBatch.some((row) => row.vector.length !== batchDimension)) {
        throw new Error('Retrieval embedding dimensions are inconsistent within a LanceDB write batch')
      }
      if (expectedVectorDimension === null) {
        expectedVectorDimension = batchDimension
      } else if (expectedVectorDimension !== batchDimension) {
        throw new Error('Retrieval embedding dimensions are inconsistent across cached and live LanceDB rows')
      }

      for (const [batchIndex, embeddedRow] of embeddedBatch.entries()) {
        assignResolvedRow(batch[batchIndex], embeddedRow.vector)
      }

      await upsertRawTextEmbeddingCacheEntries({
        scope: rawTextCacheScope,
        entries: batch.map((item, itemIndex) => ({
          embeddingInput: item.embeddingInput,
          vector: embeddedBatch[itemIndex].vector,
        })),
      })

      embeddedRowsCount = resolvedRows.filter(Boolean).length
      completedBatches += 1

      const embeddingWallElapsedMs = Date.now() - embeddingStartedAt
      const docsPerSec = embeddingWallElapsedMs > 0
        ? (embeddedRowsCount / (embeddingWallElapsedMs / 1000)).toFixed(1)
        : '0.0'

      logLanceIndex(`embedding progress: embedded=${embeddedRowsCount}/${rows.length}, docsPerSec=${docsPerSec}`)
      await onProgress?.({
        phase: 'embedding',
        totalRows: rows.length,
        embeddedRows: embeddedRowsCount,
        totalBatches,
        completedBatches,
      })
    }
  }

  const finalRows = resolvedRows.filter((row): row is RetrievalDocRow => Boolean(row))
  if (finalRows.length !== rows.length) {
    throw new Error(`Failed to resolve all retrieval rows for LanceDB rebuild: expected ${rows.length} but received ${finalRows.length}`)
  }

  const writeStartedAt = Date.now()
  logLanceIndex(`LanceDB write started: rows=${finalRows.length}`)
  const tableName = getVersionedBranchTableName(branchId)
  const previousActiveTableName = getActiveBranchTableName(branchId, scope.scopeKey)
  let table: Awaited<ReturnType<typeof database.createTable>>
  try {
    table = await database.createTable(tableName, finalRows)
  } catch (error) {
    await dropInactiveBranchTable(database, branchId, tableName)
    throw error
  }
  writeElapsedMs = Date.now() - writeStartedAt
  logLanceIndex(`embedding done: elapsed=${formatElapsed(embeddingElapsedMs)}`)
  logLanceIndex(`LanceDB write done: elapsed=${formatElapsed(writeElapsedMs)}`)

  try {
    await onProgress?.({
      phase: 'creating_table',
      totalRows: rows.length,
      embeddedRows: finalRows.length,
      totalBatches,
      completedBatches: totalBatches,
    })

    const textIndexStartedAt = Date.now()
    logLanceIndex('create FTS index started')
    await onProgress?.({
      phase: 'building_text_index',
      totalRows: rows.length,
      embeddedRows: finalRows.length,
      totalBatches,
      completedBatches: totalBatches,
    })
    const textIndexError = await ensureTextIndex(table)
    logLanceIndex(`create FTS index done: elapsed=${formatElapsed(Date.now() - textIndexStartedAt)}${textIndexError ? `, error=${textIndexError}` : ''}`)
    if (textIndexError) {
      throw new Error(`Failed to create LanceDB FTS index: ${textIndexError}`)
    }

    const vectorIndexStartedAt = Date.now()
    logLanceIndex('create vector index started')
    await onProgress?.({
      phase: 'building_vector_index',
      totalRows: rows.length,
      embeddedRows: finalRows.length,
      totalBatches,
      completedBatches: totalBatches,
    })
    const vectorIndexError = await ensureVectorIndex(table)
    logLanceIndex(`create vector index done: elapsed=${formatElapsed(Date.now() - vectorIndexStartedAt)}${vectorIndexError ? `, error=${vectorIndexError}` : ''}`)
    if (vectorIndexError) {
      throw new Error(`Failed to create LanceDB vector index: ${vectorIndexError}`)
    }

    setActiveBranchTableName(branchId, tableName, scope)
    if (previousActiveTableName && previousActiveTableName !== tableName) {
      await dropInactiveBranchTable(database, branchId, previousActiveTableName)
    }
  } catch (error) {
    await dropInactiveBranchTable(database, branchId, tableName)
    throw error
  }
  return table
}

async function createOrReplaceBranchTable(
  branchId: string,
  rows: RetrievalDocEmbeddingPlanRow[],
  novelId: string,
  scope: ReturnType<typeof getRetrievalIndexScope>,
  embeddingSettings: EmbeddingsScenarioSettings,
  embeddingBatchSize: number,
  onProgress?: (progress: RetrievalIndexBuildProgress) => void | Promise<void>
) {
  return writeBranchTableRows({
    branchId,
    rows,
    novelId,
    scope,
    embeddingSettings,
    embeddingBatchSize,
    onProgress,
  })
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
    validUntilChapter: INF_CHAPTER,
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
    importanceTier: CharacterImportanceTier | null
    firstSeenChapter: number | null
    lastSeenChapter: number | null
  }>(
    `
      SELECT id, entityType, canonicalName, description, importanceTier, firstSeenChapter, lastSeenChapter
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
      SELECT entityId, alias, sourceChapter
      FROM EntityAlias
      WHERE entityId IN (${entityIds.map(() => '?').join(', ')})
      UNION ALL
      SELECT entityId, alias, sourceChapter
      FROM EntityAliasMapping
      WHERE entityId IN (${entityIds.map(() => '?').join(', ')})
      ORDER BY sourceChapter ASC, alias ASC
    `,
    ...entityIds,
    ...entityIds
  )

  const aliasesByEntityId = new Map<string, string[]>()
  for (const alias of aliases) {
    const current = aliasesByEntityId.get(alias.entityId) ?? []
    current.push(alias.alias)
    aliasesByEntityId.set(alias.entityId, current)
  }
  const profileRows = queryAll<{
    id: string
    subjectEntityId: string | null
    valueJson: string | null
    sourceChapter: number
    validFromChapter: number | null
    validUntilChapter: number
  }>(
    `
      SELECT id, subjectEntityId, valueJson, sourceChapter, validFromChapter, validUntilChapter
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
  const profileRowsByEntityId = new Map<string, Array<{
    id: string
    valueJson: string
    sourceChapter: number
    validFromChapter: number
    validUntilChapter: number
  }>>()
  for (const row of profileRows) {
    const entityId = row.subjectEntityId?.trim()
    if (!entityId || !row.valueJson) continue
    const current = profileRowsByEntityId.get(entityId) ?? []
    current.push({
      id: row.id,
      valueJson: row.valueJson,
      sourceChapter: row.sourceChapter,
      validFromChapter: row.validFromChapter ?? row.sourceChapter,
      validUntilChapter: row.validUntilChapter,
    })
    profileRowsByEntityId.set(entityId, current)
  }

  return entities.flatMap((entity) => {
    const aliasList = uniqueStrings(aliasesByEntityId.get(entity.id) ?? [])
    const classification = getCharacterClassificationMetadata(entity.importanceTier)
    const classificationTerms = classification
      ? [classification.key, classification.label, entity.importanceTier]
      : [entity.importanceTier]
    const rows = profileRowsByEntityId.get(entity.id) ?? []
    if (!rows.length) {
      const text = [
        `实体：${entity.canonicalName}`,
        `类型：${entity.entityType}`,
        classification ? `分级：${classification.label}` : null,
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
        validUntilChapter: INF_CHAPTER,
        lineStart: -1,
        lineEnd: -1,
        spanType: '',
        title: entity.canonicalName,
        sourceLabel: '人物卡',
        relatedEntityNames: serializeTerms([entity.canonicalName, ...aliasList]),
        relatedEventNames: '',
        relatedTerms: serializeTerms([entity.canonicalName, entity.entityType, ...classificationTerms, ...aliasList]),
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
        const nextTransitionChapter = nextRow ? Math.max(validFromChapter + 1, nextRow.validFromChapter) : INF_CHAPTER
        const explicitValidUntilChapter = row.validUntilChapter
        const validUntilChapter = Math.max(validFromChapter + 1, Math.min(explicitValidUntilChapter, nextTransitionChapter))
        const text = [
          `实体：${entity.canonicalName}`,
          `类型：${entity.entityType}`,
          classification ? `分级：${classification.label}` : null,
          compactDescription ? `描述：${compactDescription}` : null,
          aliasList.length ? `别名：${aliasList.join('、')}` : null,
          ...profileLines,
        ].filter(Boolean).join('\n')

        return [{
          id: `entity-profile:${entity.id}:${validFromChapter}:${index}`,
          branchId,
          sourceType: 'entity_profile' as const,
          sourceId: row.id,
          chapterId: '',
          chapterNo: validFromChapter,
          validFromChapter,
          validUntilChapter,
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
            ...classificationTerms,
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
            validUntilChapter,
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
      validUntilChapter: INF_CHAPTER,
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
    validUntilChapter: number
    status: string
  }>(
    `
      SELECT id, term, category, definition, firstSeenChapter, validFromChapter, validUntilChapter, status
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
      validUntilChapter: row.validUntilChapter,
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
        row.validUntilChapter,
      ]),
    }
  })
}

function loadBranchRelationshipDocs(novelId: string, branchId: string) {
  return queryAll<{
    id: string
    sourceChapter: number
    validFromChapter: number
    validUntilChapter: number
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
      SELECT el.id, el.sourceChapter, el.validFromChapter, el.validUntilChapter, el.linkType, el.label,
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
      validUntilChapter: row.validUntilChapter,
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
        row.validUntilChapter,
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
    validUntilChapter: number
    status: string
  }>(
    `
      SELECT id, predicate, valueJson, sourceChapter, validFromChapter, validUntilChapter, status
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
      validUntilChapter: fact.validUntilChapter,
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

export function loadRawTextRetrievalDocs(novelId: string, branchId: string, chapterRange?: KnowledgeRebuildChapterRange) {
  return loadPackedBranchTextSpans(novelId, branchId, chapterRange).map(toRetrievalDocRow)
}

export function loadKnowledgeDerivedRetrievalDocs(novelId: string, branchId: string) {
  return mergeRetrievalDocGroups(
    loadBranchChapterSummaryDocs(novelId, branchId),
    loadBranchEntityProfileDocs(novelId, branchId),
    loadBranchEventSummaryDocs(novelId, branchId),
    loadBranchWorldbuildingDocs(novelId, branchId),
    loadBranchRelationshipDocs(novelId, branchId),
    loadBranchOpenThreadDocs(novelId, branchId),
  )
}

function loadScopedKnowledgeDerivedRetrievalDocs(novelId: string, branchId: string, chapterRange: KnowledgeRebuildChapterRange) {
  return loadKnowledgeDerivedRetrievalDocs(novelId, branchId)
    .filter((row) => docOverlapsChapterRange(row, chapterRange))
}

function loadRetrievalDocsForRebuild(params: {
  novelId: string
  branchId: string
  chapterRange?: KnowledgeRebuildChapterRange
}) {
  return params.chapterRange
    ? mergeRetrievalDocGroups(
        loadRawTextRetrievalDocs(params.novelId, params.branchId, params.chapterRange),
        loadScopedKnowledgeDerivedRetrievalDocs(params.novelId, params.branchId, params.chapterRange),
      )
    : loadBranchRetrievalDocs(params.novelId, params.branchId)
}

export function loadBranchRetrievalDocs(novelId: string, branchId: string) {
  return mergeRetrievalDocGroups(
    loadRawTextRetrievalDocs(novelId, branchId),
    loadKnowledgeDerivedRetrievalDocs(novelId, branchId),
  )
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
    `validUntilChapter > ${maxChapterNo}`,
    `includeByDefault = 1`,
    `status NOT IN ('rejected', 'outdated', 'potentially_stale')`,
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
              SELECT id, validFromChapter,
                     validUntilChapter,
                     status,
                     1 AS includeByDefault
              FROM KnowledgeFact
              WHERE id IN (${byType.get('entity_profile')?.map(() => '?').join(', ')})
              UNION ALL
              SELECT id, COALESCE(firstSeenChapter, 0) AS validFromChapter, ${INF_CHAPTER} AS validUntilChapter, 'ready' AS status, 1 AS includeByDefault
              FROM KnowledgeEntity
              WHERE id IN (${byType.get('entity_profile')?.map(() => '?').join(', ')})
            `,
            ...(byType.get('entity_profile') ?? []),
            ...(byType.get('entity_profile') ?? [])
          )
        : [])
    ),
    relationship: buildSourceTruthMap(
      (byType.get('relationship')?.length
        ? queryAll<SourceTruthRow>(
            `
              SELECT id, validFromChapter, validUntilChapter, status, includeByDefault
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
              SELECT id, validFromChapter, validUntilChapter, status, 1 AS includeByDefault
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
              SELECT id, chapterNo AS validFromChapter, ${INF_CHAPTER} AS validUntilChapter, status, 1 AS includeByDefault
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
              SELECT id, validFromChapter, validUntilChapter, status, 1 AS includeByDefault
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
  if (current.status === 'rejected' || current.status === 'outdated' || current.status === 'potentially_stale') return false
  if (current.validFromChapter > maxChapterNo) return false
  if (current.validUntilChapter <= maxChapterNo) return false
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

export async function rebuildBranchRetrievalIndex(
  novelId: string,
  branchId: string,
  options?: {
    chapterRange?: KnowledgeRebuildChapterRange
    onProgress?: (progress: RetrievalIndexBuildProgress) => void | Promise<void>
  }
): Promise<RetrievalIndexBuildResult> {
  return withBranchRetrievalIndexLock(branchId, () => rebuildBranchRetrievalIndexUnlocked(novelId, branchId, options))
}

async function rebuildBranchRetrievalIndexUnlocked(
  novelId: string,
  branchId: string,
  options?: {
    chapterRange?: KnowledgeRebuildChapterRange
    onProgress?: (progress: RetrievalIndexBuildProgress) => void | Promise<void>
  }
): Promise<RetrievalIndexBuildResult> {
  const scope = getRetrievalIndexScope(options?.chapterRange)
  const totalStartedAt = Date.now()
  await options?.onProgress?.({
    phase: 'loading',
    totalRows: 0,
    embeddedRows: 0,
    totalBatches: 0,
    completedBatches: 0,
  })
  logLanceIndex('build retrieval docs started')
  const docBuildStartedAt = Date.now()
  const rows = loadRetrievalDocsForRebuild({
    novelId,
    branchId,
    chapterRange: options?.chapterRange,
  })
  logLanceIndex(`build retrieval docs done: docs=${rows.length}, elapsed=${formatElapsed(Date.now() - docBuildStartedAt)}`)

  const embeddingSettings = loadStoredAISettings().embeddings
  const embeddingBatchSize = getEmbeddingBatchSize(embeddingSettings)
  const plannedRows = await buildRetrievalEmbeddingPlan({
    novelId,
    branchId,
    rows,
    embeddingSettings,
  })
  const totalBatches = Math.ceil(rows.length / embeddingBatchSize)
  await options?.onProgress?.({
    phase: rows.length ? 'embedding' : 'completed',
    totalRows: rows.length,
    embeddedRows: plannedRows.filter((item) => item.row.sourceType === 'text_span' && item.cachedVector).length,
    totalBatches,
    completedBatches: 0,
  })

  if (!rows.length) {
    if (scope.scopeKey === FULL_RETRIEVAL_INDEX_SCOPE_KEY) {
      await deleteBranchRetrievalIndexUnlocked(branchId)
    } else {
      await deleteBranchRetrievalIndexScopeUnlocked(branchId, scope.scopeKey)
    }
    logLanceIndex(`rebuild done: totalElapsed=${formatElapsed(Date.now() - totalStartedAt)}`)
    return {
      rowCount: 0,
      embeddingBatchCount: 0,
    }
  }

  await createOrReplaceBranchTable(branchId, plannedRows, novelId, scope, embeddingSettings, embeddingBatchSize, options?.onProgress)
  await options?.onProgress?.({
    phase: 'completed',
    totalRows: rows.length,
    embeddedRows: rows.length,
    totalBatches,
    completedBatches: totalBatches,
  })
  logLanceIndex(`rebuild done: totalElapsed=${formatElapsed(Date.now() - totalStartedAt)}`)
  return {
    rowCount: rows.length,
    embeddingBatchCount: totalBatches,
  }
}

async function deleteBranchRetrievalIndexScopeUnlocked(branchId: string, scopeKey: string) {
  const database = await getDatabase()
  const tableNames = await database.tableNames()
  const activeTableName = getActiveBranchTableName(branchId, scopeKey)

  try {
    if (activeTableName && branchTableNameBelongsToBranch(branchId, activeTableName) && tableNames.includes(activeTableName)) {
      await database.dropTable(activeTableName)
    }
  } finally {
    clearActiveBranchTableName(branchId, scopeKey)
  }
}

async function deleteBranchRetrievalIndexUnlocked(branchId: string) {
  const database = await getDatabase()
  const tableNames = await database.tableNames()
  const branchTableNames = tableNames.filter((tableName) => branchTableNameBelongsToBranch(branchId, tableName))
  try {
    await Promise.all(branchTableNames.map((tableName) => database.dropTable(tableName)))
  } finally {
    clearActiveBranchTableName(branchId)
  }
}

export async function deleteBranchRetrievalIndex(branchId: string) {
  await withBranchRetrievalIndexLock(branchId, () => deleteBranchRetrievalIndexUnlocked(branchId))
}

export async function deleteBranchRetrievalIndexFromChapter(branchId: string, _fromChapterNo: number) {
  await deleteBranchRetrievalIndex(branchId)
}

export async function searchLanceEvidence(params: {
  novelId: string
  branchId: string
  maxChapterNo: number
  query: string
  queryTerms?: string[]
  graphTerms?: string[]
  limit?: number
  whatIfSessionId?: string
  futureJumpRunId?: string
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
  const explicitAuthoredMatches = buildExplicitAuthoredMatches({
    novelId: params.novelId,
    branchId: params.branchId,
    queryTerms,
    graphTerms,
    whatIfSessionId: params.whatIfSessionId,
    futureJumpRunId: params.futureJumpRunId,
  })

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
      matches: pickDiverseEvidenceRows(explicitAuthoredMatches, params.limit ?? 10),
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
    matches: pickDiverseEvidenceRows(
      [...reranked, ...explicitAuthoredMatches].sort(
        (left, right) => right.score - left.score
          || SOURCE_TYPE_PRIORITY[right.sourceType] - SOURCE_TYPE_PRIORITY[left.sourceType]
          || right.chapterNo - left.chapterNo
      ),
      params.limit ?? 10
    ),
  }
}
