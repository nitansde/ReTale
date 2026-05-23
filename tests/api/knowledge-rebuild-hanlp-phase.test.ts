import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }
const originalDatabaseUrl = process.env.DATABASE_URL
const originalHanlpBootstrapParallelism = process.env.HANLP_BOOTSTRAP_PARALLELISM
const API_TEST_TIMEOUT_MS = 30_000

vi.setConfig({ testTimeout: API_TEST_TIMEOUT_MS, hookTimeout: API_TEST_TIMEOUT_MS })

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function createMockAISettings(parallelism = 3) {
  return {
    rewrite: {
      provider: 'openai-compatible' as const,
      openAICompatible: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        apiKeyConfigured: true,
        apiKeyMasked: 'test***key',
        model: 'rewrite-model',
        configured: true,
      },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'rewrite-model',
        configured: true,
      },
    },
    knowledgeExtraction: {
      provider: 'openai-compatible' as const,
      openAICompatible: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        apiKeyConfigured: true,
        apiKeyMasked: 'test***key',
        model: 'knowledge-model',
        configured: true,
        parallelism,
      },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'unused-ollama-model',
        configured: true,
        parallelism,
      },
    },
    embeddings: {
      provider: 'ollama' as const,
      openAICompatible: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        apiKeyConfigured: true,
        apiKeyMasked: 'test***key',
        model: 'embedding-model',
        configured: true,
      },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'embedding-model',
        configured: true,
      },
      embeddingBatchSize: 1,
    },
  }
}

async function createTestDatabase(prefix: string) {
  const tempDatabase = createTempDatabaseCopy(prefix)
  cleanups.push(tempDatabase.cleanup)

  process.env.DATABASE_URL = tempDatabase.dbPath
  vi.resetModules()

  const sqliteModule = await import('@/lib/server/sqlite')
  globalForSqlite.sqlite = sqliteModule.sqlite

  return {
    database: sqliteModule.sqlite,
    queryOne: sqliteModule.queryOne,
    queryAll: sqliteModule.queryAll,
  }
}

function createMockExtraction(chapterNo: number) {
  return {
    chapterNo,
    summary: `summary-${chapterNo}`,
    characters: [],
    knownCharacterUpdates: [],
    unknownCharacterObservations: [],
    aliasDiscoveries: [],
    relations: [],
    events: [],
    worldbuilding: [],
    openThreads: [{
      name: `thread-${chapterNo}`,
      description: `open-thread-${chapterNo}`,
      evidence: [{ quote: `第${chapterNo}章原文内容。`, lineStart: 1, lineEnd: 1 }],
    }],
  }
}

function buildTestExtractionCandidateSourceHash(params: {
  chapterSourceHash: string
  settings: ReturnType<typeof createMockAISettings>['knowledgeExtraction']
}) {
  return createHash('sha256').update(JSON.stringify({
    chapterSourceHash: params.chapterSourceHash,
    settings: {
      provider: params.settings.provider,
      model: params.settings.openAICompatible.model,
      baseUrl: params.settings.openAICompatible.baseUrl,
      parallelism: params.settings.openAICompatible.parallelism,
      configured: params.settings.openAICompatible.configured,
    },
    schemaVersion: 'knowledge-extraction-candidate:v2',
  })).digest('hex')
}

function seedKnowledgeRebuildFixture(database: DatabaseSync, novelKey = 'novel_hanlp', chapterCount = 3) {
  const novelId = `${novelKey}_${Math.random().toString(36).slice(2, 8)}`
  const branchId = `${novelId}:main`
  database.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run(novelId, 'Fixture Novel', 'txt')
  database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run(branchId, novelId, 'main')
  const insertChapter = database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertLine = database.prepare('INSERT INTO ChapterLine (id, chapterId, lineNo, text, charStart, charEnd) VALUES (?, ?, ?, ?, ?, ?)')
  const insertSpan = database.prepare(
    `INSERT INTO TextSpan (
      id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd,
      charStart, charEnd, text, spanType, tokenEstimate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  for (let chapterNo = 1; chapterNo <= chapterCount; chapterNo += 1) {
    const chapterId = `chapter-${chapterNo}`
    const rawText = `第${chapterNo}章原文内容。`
    insertChapter.run(chapterId, novelId, branchId, chapterNo, `第${chapterNo}章`, rawText, null, 1, 1, 'Needs rebuild', `chapter-hash-${chapterNo}`, 'stale')
    insertLine.run(`line-${chapterNo}`, chapterId, 1, rawText, 0, rawText.length)
    insertSpan.run(`span-${chapterNo}`, novelId, branchId, chapterId, chapterNo, 1, 1, 0, rawText.length, rawText, 'paragraph', rawText.length)
  }

  return { novelId, branchId }
}

async function waitForCondition(check: () => boolean, label: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(`Timed out waiting for ${label}`)
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
  vi.unmock('@/lib/server/ai-settings')
  vi.unmock('@/lib/server/hanlp-bootstrap')
  vi.unmock('@/lib/server/hanlp-bootstrap-initializer')
  vi.unmock('@/lib/server/knowledge-extraction')
  vi.unmock('@/lib/server/context-builder')
  vi.unmock('@/lib/server/retrieval-index')
  vi.doUnmock('@/lib/server/context-builder')

  if (globalForSqlite.sqlite) {
    try {
      ;(globalForSqlite.sqlite as DatabaseSync & { close?: () => void }).close?.()
    } catch {
    }
    delete globalForSqlite.sqlite
  }

  process.env.DATABASE_URL = originalDatabaseUrl
  process.env.HANLP_BOOTSTRAP_PARALLELISM = originalHanlpBootstrapParallelism

  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('knowledge rebuild HanLP orchestration', () => {
  it('runs HanLP first, then writes each extraction batch before starting the next batch', async () => {
    process.env.HANLP_BOOTSTRAP_PARALLELISM = '3'
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-rebuild-hanlp-phase-order')
    const { novelId } = seedKnowledgeRebuildFixture(database, 'novel_hanlp_phase_order', 3)
    const aiSettings = createMockAISettings(2)
    const events: string[] = []
    let hanlpRunnerCalls = 0
    let extractionCalls = 0
    const hanlpGates = new Map([
      [1, createDeferred<void>()],
      [2, createDeferred<void>()],
      [3, createDeferred<void>()],
    ])
    const extractionGates = new Map([
      [1, createDeferred<void>()],
      [2, createDeferred<void>()],
      [3, createDeferred<void>()],
    ])

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => aiSettings,
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap', () => ({
      runHanlpBootstrapForChapter: vi.fn(async (input: { chapterNo: number }) => {
        events.push(`hanlp:start:${input.chapterNo}`)
        await hanlpGates.get(input.chapterNo)?.promise
        const source = input.chapterNo === 1 ? 'cache' as const : 'runner' as const
        if (source === 'runner') {
          hanlpRunnerCalls += 1
        }
        events.push(`hanlp:end:${input.chapterNo}:${source}`)
        return {
          source,
          cache: {} as never,
          result: {} as never,
          output: { people: [], locations: [], organizations: [], settings: [], entities: [] },
          cacheKey: {} as never,
          scriptPath: '/tmp/mock-hanlp.py',
          normalizedChapterText: `第${input.chapterNo}章原文内容。`,
        }
      }),
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap-initializer', () => ({
      initializeHanlpBootstrapCharacterEntities: vi.fn(async () => {
        events.push('hanlp:init')
        return {
          createdOrUpdatedEntityIds: ['entity-1'],
          characterDecisions: [],
          promptContext: { characters: [], locations: [], organizations: [], settings: [] },
        }
      }),
    }))
    vi.doMock('@/lib/server/knowledge-extraction', () => ({
      extractChapterKnowledgeOffline: vi.fn(async (params: { chapterNo: number }) => {
        extractionCalls += 1
        events.push(`extract:start:${params.chapterNo}`)
        await extractionGates.get(params.chapterNo)?.promise
        events.push(`extract:end:${params.chapterNo}`)
        return {
          extraction: createMockExtraction(params.chapterNo),
          provider: 'openai-compatible' as const,
          model: aiSettings.knowledgeExtraction.openAICompatible.model,
        }
      }),
    }))
    vi.doMock('@/lib/server/context-builder', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/context-builder')>()
      return {
        ...actual,
        buildKnowledgeExtractionStoryState: vi.fn((params: { novelId: string; branchId: string; asOfChapter: number }) => {
          const readyCount = queryOne<{ count: number }>(
            `SELECT COUNT(*) AS count
             FROM KnowledgeChapter
             WHERE novelId = ? AND branchId = ? AND chapterNo <= ? AND knowledgeStatus = 'ready' AND isDirty = 0`,
            params.novelId,
            params.branchId,
            params.asOfChapter,
          )?.count ?? 0
          events.push(`story:${params.asOfChapter + 1}:ready:${readyCount}`)
          return '# 已排序故事状态\n- 无前情。'
        }),
      }
    })
    vi.doMock('@/lib/server/retrieval-index', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/retrieval-index')>()
      return {
        ...actual,
        precomputeRawTextEmbeddingCache: vi.fn(async () => ({
          totalDocs: 0,
          completedDocs: 0,
          cacheHits: 0,
          cacheMisses: 0,
          failedDocs: 0,
          totalBatches: 0,
          completedBatches: 0,
          degraded: false,
          cancelled: false,
          durationMs: 0,
        })),
        rebuildBranchRetrievalIndex: vi.fn(async () => ({ rowCount: 0, embeddingBatchCount: 0 })),
      }
    })

    const { rebuildKnowledgeForNovel } = await import('@/lib/server/knowledge-rebuild')
    const rebuildPromise = rebuildKnowledgeForNovel({ novelId })

    await waitForCondition(() => events.filter((event) => event.startsWith('hanlp:start:')).length === 3, 'HanLP batch start')
    expect(events.some((event) => event.startsWith('extract:start:'))).toBe(false)

    hanlpGates.get(3)?.resolve()
    hanlpGates.get(2)?.resolve()
    hanlpGates.get(1)?.resolve()

    await waitForCondition(() => events.includes('hanlp:init') && events.filter((event) => event.startsWith('extract:start:')).length === 2, 'first extraction batch start after HanLP')
    expect(events.indexOf('hanlp:init')).toBeGreaterThan(events.indexOf('hanlp:end:3:runner'))
    expect(events.findIndex((event) => event.startsWith('extract:start:'))).toBeGreaterThan(events.indexOf('hanlp:init'))

    extractionGates.get(2)?.resolve()
    extractionGates.get(1)?.resolve()

    await waitForCondition(() => events.includes('extract:start:3'), 'second extraction batch start')
    expect(events.indexOf('story:3:ready:2')).toBeGreaterThan(events.indexOf('extract:end:2'))
    expect(events.indexOf('story:3:ready:2')).toBeLessThan(events.indexOf('extract:start:3'))
    extractionGates.get(3)?.resolve()

    await expect(rebuildPromise).resolves.toMatchObject({ outcome: 'completed' })

    expect(hanlpRunnerCalls).toBe(2)
    expect(extractionCalls).toBe(3)

    const jobRow = queryOne<{ payloadJson: string | null; status: string }>(
      'SELECT payloadJson, status FROM KnowledgeJob WHERE novelId = ? ORDER BY createdAt DESC LIMIT 1',
      novelId,
    )
    const payload = JSON.parse(jobRow?.payloadJson ?? '{}') as {
      hanlpBootstrap?: {
        totalChapterCount: number
        completedChapterCount: number
        cacheHitCount: number
        cacheMissCount: number
        initializedCharacterEntities: boolean
      }
      stageTimingsMs?: Record<string, number>
      steps?: Array<{ key: string; progress: number; status: string }>
    }

    expect(jobRow?.status).toBe('succeeded')
    expect(payload.hanlpBootstrap).toMatchObject({
      totalChapterCount: 3,
      completedChapterCount: 3,
      cacheHitCount: 1,
      cacheMissCount: 2,
      initializedCharacterEntities: true,
    })
    expect(payload.stageTimingsMs?.['hanlp-bootstrap']).toEqual(expect.any(Number))
    expect(payload.steps?.map((step) => step.key)).toEqual([
      'hanlp-bootstrap',
      'extract',
      'batch-sync',
      'cleanup',
      'write',
      'raw-embedding',
      'index',
    ])
  })

  it('runs HanLP for every chapter while limiting extraction, progress, and cleanup to the requested chapter range', async () => {
    process.env.HANLP_BOOTSTRAP_PARALLELISM = '4'
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-rebuild-range')
    const { novelId } = seedKnowledgeRebuildFixture(database, 'novel_hanlp_range', 5)
    const aiSettings = createMockAISettings(4)
    const hanlpCalls: number[] = []
    const extractionCalls: number[] = []
    const rebuildBranchRetrievalIndex = vi.fn(async () => ({ rowCount: 0, embeddingBatchCount: 0 }))
    const cachedChapterTwoHash = buildTestExtractionCandidateSourceHash({
      chapterSourceHash: 'chapter-hash-2',
      settings: aiSettings.knowledgeExtraction,
    })

    database.prepare("UPDATE KnowledgeChapter SET summary = ?, knowledgeStatus = 'ready', isDirty = 0 WHERE id = ?")
      .run('keep chapter 4 summary', 'chapter-4')
    database.prepare(
      `INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, firstSeenChapter, lastSeenChapter, importanceTier, status, userConfirmed
      ) VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, 0)`
    ).run('entity-range-preserved', novelId, `${novelId}:main`, '跨章角色', 2, 4, 'arc', 'ready')
    database.prepare('INSERT INTO EntityAppearance (id, entityId, chapterId, chapterNo, lineStart, lineEnd) VALUES (?, ?, ?, ?, ?, ?)')
      .run('appearance-range-stale', 'entity-range-preserved', 'chapter-2', 2, 1, 1)
    database.prepare('INSERT INTO EntityAppearance (id, entityId, chapterId, chapterNo, lineStart, lineEnd) VALUES (?, ?, ?, ?, ?, ?)')
      .run('appearance-range-keep', 'entity-range-preserved', 'chapter-4', 4, 1, 1)
    database.prepare('INSERT INTO EntityAlias (id, entityId, alias, sourceChapter) VALUES (?, ?, ?, ?)')
      .run('alias-range-stale', 'entity-range-preserved', '旧称', 2)
    database.prepare('INSERT INTO EntityAlias (id, entityId, alias, sourceChapter) VALUES (?, ?, ?, ?)')
      .run('alias-range-keep', 'entity-range-preserved', '后文称呼', 4)
    database.prepare('INSERT INTO EntityAliasMapping (id, novelId, branchId, alias, entityId, sourceAliasId, sourceChapter) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('mapping-range-stale', novelId, `${novelId}:main`, '旧称', 'entity-range-preserved', 'alias-range-stale', 2)
    database.prepare('INSERT INTO EntityAliasMapping (id, novelId, branchId, alias, entityId, sourceAliasId, sourceChapter) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('mapping-range-keep', novelId, `${novelId}:main`, '后文称呼', 'entity-range-preserved', 'alias-range-keep', 4)
    database.prepare(
      `INSERT INTO chapter_extraction_candidates (
        id, novel_id, branch_id, chapter_id, chapter_no, chapter_revision,
        chapter_source_hash, extraction_json, status, provider, model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'cached-candidate-chapter-2',
      novelId,
      `${novelId}:main`,
      'chapter-2',
      2,
      1,
      cachedChapterTwoHash,
      JSON.stringify(createMockExtraction(2)),
      'extracted',
      'openai-compatible',
      aiSettings.knowledgeExtraction.openAICompatible.model,
    )

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => aiSettings,
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap', () => ({
      runHanlpBootstrapForChapter: vi.fn(async (input: { chapterNo: number; rawText: string }) => {
        hanlpCalls.push(input.chapterNo)
        return {
          source: 'cache' as const,
          cache: {} as never,
          result: {} as never,
          output: { people: [], locations: [], organizations: [], settings: [], entities: [] },
          cacheKey: {} as never,
          scriptPath: '/tmp/mock-hanlp.py',
          normalizedChapterText: input.rawText,
        }
      }),
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap-initializer', () => ({
      initializeHanlpBootstrapCharacterEntities: vi.fn(async () => ({
        createdOrUpdatedEntityIds: [],
        characterDecisions: [],
        promptContext: { characters: [], locations: [], organizations: [], settings: [] },
      })),
    }))
    vi.doMock('@/lib/server/knowledge-extraction', () => ({
      extractChapterKnowledgeOffline: vi.fn(async (params: { chapterNo: number }) => {
        extractionCalls.push(params.chapterNo)
        return {
          extraction: createMockExtraction(params.chapterNo),
          provider: 'openai-compatible' as const,
          model: aiSettings.knowledgeExtraction.openAICompatible.model,
        }
      }),
    }))
    vi.doMock('@/lib/server/retrieval-index', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/retrieval-index')>()
      return {
        ...actual,
        precomputeRawTextEmbeddingCache: vi.fn(async () => ({
          totalDocs: 0,
          completedDocs: 0,
          cacheHits: 0,
          cacheMisses: 0,
          failedDocs: 0,
          totalBatches: 0,
          completedBatches: 0,
          degraded: false,
          cancelled: false,
          durationMs: 0,
        })),
        rebuildBranchRetrievalIndex,
      }
    })

    const { rebuildKnowledgeForNovel } = await import('@/lib/server/knowledge-rebuild')
    await expect(rebuildKnowledgeForNovel({ novelId, chapterRange: { startChapter: 2, endChapter: 3 } })).resolves.toMatchObject({ outcome: 'completed' })

    const jobPayload = JSON.parse(queryOne<{ payloadJson: string | null }>(
      'SELECT payloadJson FROM KnowledgeJob WHERE novelId = ? ORDER BY createdAt DESC LIMIT 1',
      novelId,
    )?.payloadJson ?? '{}') as {
      chapterRange?: { startChapter?: number; endChapter?: number }
      totalChapterCount?: number
      hanlpBootstrap?: { totalChapterCount?: number; completedChapterCount?: number }
    }
    const chapterFour = queryOne<{ summary: string | null; knowledgeStatus: string }>('SELECT summary, knowledgeStatus FROM KnowledgeChapter WHERE id = ?', 'chapter-4')
    const preservedEntity = queryOne<{ id: string; lastSeenChapter: number | null }>('SELECT id, lastSeenChapter FROM KnowledgeEntity WHERE id = ?', 'entity-range-preserved')
    const staleAppearance = queryOne<{ id: string }>('SELECT id FROM EntityAppearance WHERE id = ?', 'appearance-range-stale')
    const keptAppearance = queryOne<{ id: string }>('SELECT id FROM EntityAppearance WHERE id = ?', 'appearance-range-keep')
    const staleAlias = queryOne<{ id: string }>('SELECT id FROM EntityAlias WHERE id = ?', 'alias-range-stale')
    const keptAlias = queryOne<{ id: string }>('SELECT id FROM EntityAlias WHERE id = ?', 'alias-range-keep')
    const staleMapping = queryOne<{ id: string }>('SELECT id FROM EntityAliasMapping WHERE id = ?', 'mapping-range-stale')
    const keptMapping = queryOne<{ id: string }>('SELECT id FROM EntityAliasMapping WHERE id = ?', 'mapping-range-keep')
    const cachedCandidate = queryOne<{ status: string; processingBatchId: string | null; processingResultJson: string | null }>(
      'SELECT status, processing_batch_id AS processingBatchId, processing_result_json AS processingResultJson FROM chapter_extraction_candidates WHERE id = ?',
      'cached-candidate-chapter-2',
    )
    const freshCandidate = queryOne<{ processingBatchId: string | null; processingResultJson: string | null }>(
      'SELECT processing_batch_id AS processingBatchId, processing_result_json AS processingResultJson FROM chapter_extraction_candidates WHERE chapter_id = ?',
      'chapter-3',
    )
    const sharedBatch = queryOne<{ batchContextJson: string | null }>(
      'SELECT batch_context_json AS batchContextJson FROM chapter_extraction_processing_batches WHERE id = ?',
      cachedCandidate?.processingBatchId ?? '',
    )

    expect(hanlpCalls).toEqual([1, 2, 3, 4, 5])
    expect(extractionCalls).toEqual([3])
    expect(rebuildBranchRetrievalIndex).not.toHaveBeenCalled()
    expect(jobPayload).toMatchObject({
      chapterRange: { startChapter: 2, endChapter: 3 },
      totalChapterCount: 2,
      hanlpBootstrap: {
        totalChapterCount: 5,
        completedChapterCount: 5,
      },
    })
    expect(chapterFour).toEqual({ summary: 'keep chapter 4 summary', knowledgeStatus: 'ready' })
    expect(preservedEntity).toEqual({ id: 'entity-range-preserved', lastSeenChapter: 4 })
    expect(staleAppearance).toBeNull()
    expect(keptAppearance).toEqual({ id: 'appearance-range-keep' })
    expect(staleAlias).toBeNull()
    expect(keptAlias).toEqual({ id: 'alias-range-keep' })
    expect(staleMapping).toBeNull()
    expect(keptMapping).toEqual({ id: 'mapping-range-keep' })
    expect(cachedCandidate?.status).toBe('persisted')
    expect(cachedCandidate?.processingBatchId).toBeTruthy()
    expect(freshCandidate?.processingBatchId).toBe(cachedCandidate?.processingBatchId)
    const cachedProcessingResult = JSON.parse(cachedCandidate?.processingResultJson ?? '{}') as {
      schemaVersion?: string
      resolved?: { extraction?: { summary?: string } }
    }
    const freshProcessingResult = JSON.parse(freshCandidate?.processingResultJson ?? '{}') as {
      schemaVersion?: string
      resolved?: { extraction?: { summary?: string } }
    }
    const sharedBatchContext = JSON.parse(sharedBatch?.batchContextJson ?? '{}') as {
      batch?: { chapterNos?: number[] }
    }
    expect(cachedProcessingResult).toMatchObject({
      schemaVersion: 'knowledge-extraction-processing:v2',
      resolved: { extraction: { summary: 'summary-2' } },
    })
    expect(freshProcessingResult).toMatchObject({
      schemaVersion: 'knowledge-extraction-processing:v2',
      resolved: { extraction: { summary: 'summary-3' } },
    })
    expect(sharedBatchContext).toMatchObject({
      batch: { chapterNos: [2, 3] },
    })
  })

  it('skips per-chapter HanLP checks when the book coverage marker is complete', async () => {
    process.env.HANLP_BOOTSTRAP_PARALLELISM = '4'
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-rebuild-hanlp-marker-full')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_hanlp_marker_full', 3)
    const aiSettings = createMockAISettings(3)
    const hanlpCalls: number[] = []
    const initializerCalls: string[] = []
    const extractionCalls: number[] = []

    database.prepare('INSERT INTO hanlp_bootstrap_coverage (id, novel_id, valid_through_chapter_no) VALUES (?, ?, ?)')
      .run('marker-full', novelId, 3)

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => aiSettings,
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap', () => ({
      runHanlpBootstrapForChapter: vi.fn(async (input: { chapterNo: number }) => {
        hanlpCalls.push(input.chapterNo)
        throw new Error('HanLP should be skipped when coverage marker is complete')
      }),
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap-initializer', () => ({
      initializeHanlpBootstrapCharacterEntities: vi.fn(async (params: { branchId: string }) => {
        initializerCalls.push(params.branchId)
        return {
          createdOrUpdatedEntityIds: [],
          characterDecisions: [],
          promptContext: { characters: [], locations: [], organizations: [], settings: [] },
        }
      }),
    }))
    vi.doMock('@/lib/server/knowledge-extraction', () => ({
      extractChapterKnowledgeOffline: vi.fn(async (params: { chapterNo: number }) => {
        extractionCalls.push(params.chapterNo)
        return {
          extraction: createMockExtraction(params.chapterNo),
          provider: 'openai-compatible' as const,
          model: aiSettings.knowledgeExtraction.openAICompatible.model,
        }
      }),
    }))
    vi.doMock('@/lib/server/retrieval-index', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/retrieval-index')>()
      return {
        ...actual,
        precomputeRawTextEmbeddingCache: vi.fn(async () => ({
          totalDocs: 0,
          completedDocs: 0,
          cacheHits: 0,
          cacheMisses: 0,
          failedDocs: 0,
          totalBatches: 0,
          completedBatches: 0,
          degraded: false,
          cancelled: false,
          durationMs: 0,
        })),
        rebuildBranchRetrievalIndex: vi.fn(async () => ({ rowCount: 0, embeddingBatchCount: 0 })),
      }
    })

    const { rebuildKnowledgeForNovel } = await import('@/lib/server/knowledge-rebuild')
    await expect(rebuildKnowledgeForNovel({ novelId })).resolves.toMatchObject({ outcome: 'completed' })

    const payload = JSON.parse(queryOne<{ payloadJson: string | null }>(
      'SELECT payloadJson FROM KnowledgeJob WHERE novelId = ? ORDER BY createdAt DESC LIMIT 1',
      novelId,
    )?.payloadJson ?? '{}') as {
      hanlpBootstrap?: {
        totalChapterCount?: number
        completedChapterCount?: number
        cacheHitCount?: number
        cacheMissCount?: number
        initializedCharacterEntities?: boolean
      }
    }

    expect(hanlpCalls).toEqual([])
    expect(initializerCalls).toEqual([branchId])
    expect(extractionCalls).toEqual([1, 2, 3])
    expect(payload.hanlpBootstrap).toMatchObject({
      totalChapterCount: 3,
      completedChapterCount: 3,
      cacheHitCount: 0,
      cacheMissCount: 0,
      initializedCharacterEntities: true,
    })
  })

  it('resumes HanLP from the first chapter after partial book coverage', async () => {
    process.env.HANLP_BOOTSTRAP_PARALLELISM = '4'
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-rebuild-hanlp-marker-partial')
    const { novelId } = seedKnowledgeRebuildFixture(database, 'novel_hanlp_marker_partial', 5)
    const aiSettings = createMockAISettings(5)
    const hanlpCalls: number[] = []

    database.prepare('INSERT INTO hanlp_bootstrap_coverage (id, novel_id, valid_through_chapter_no) VALUES (?, ?, ?)')
      .run('marker-partial', novelId, 2)

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => aiSettings,
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap', () => ({
      runHanlpBootstrapForChapter: vi.fn(async (input: { chapterNo: number; rawText: string }) => {
        hanlpCalls.push(input.chapterNo)
        return {
          source: 'runner' as const,
          cache: {} as never,
          result: {} as never,
          output: { people: [], locations: [], organizations: [], settings: [], entities: [] },
          cacheKey: {} as never,
          scriptPath: '/tmp/mock-hanlp.py',
          normalizedChapterText: input.rawText,
        }
      }),
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap-initializer', () => ({
      initializeHanlpBootstrapCharacterEntities: vi.fn(async () => ({
        createdOrUpdatedEntityIds: [],
        characterDecisions: [],
        promptContext: { characters: [], locations: [], organizations: [], settings: [] },
      })),
    }))
    vi.doMock('@/lib/server/knowledge-extraction', () => ({
      extractChapterKnowledgeOffline: vi.fn(async (params: { chapterNo: number }) => ({
        extraction: createMockExtraction(params.chapterNo),
        provider: 'openai-compatible' as const,
        model: aiSettings.knowledgeExtraction.openAICompatible.model,
      })),
    }))
    vi.doMock('@/lib/server/retrieval-index', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/retrieval-index')>()
      return {
        ...actual,
        precomputeRawTextEmbeddingCache: vi.fn(async () => ({
          totalDocs: 0,
          completedDocs: 0,
          cacheHits: 0,
          cacheMisses: 0,
          failedDocs: 0,
          totalBatches: 0,
          completedBatches: 0,
          degraded: false,
          cancelled: false,
          durationMs: 0,
        })),
        rebuildBranchRetrievalIndex: vi.fn(async () => ({ rowCount: 0, embeddingBatchCount: 0 })),
      }
    })

    const { rebuildKnowledgeForNovel } = await import('@/lib/server/knowledge-rebuild')
    await expect(rebuildKnowledgeForNovel({ novelId })).resolves.toMatchObject({ outcome: 'completed' })

    const payload = JSON.parse(queryOne<{ payloadJson: string | null }>(
      'SELECT payloadJson FROM KnowledgeJob WHERE novelId = ? ORDER BY createdAt DESC LIMIT 1',
      novelId,
    )?.payloadJson ?? '{}') as {
      hanlpBootstrap?: { totalChapterCount?: number; completedChapterCount?: number; cacheMissCount?: number }
    }
    const marker = queryOne<{ validThroughChapterNo: number }>(
      'SELECT valid_through_chapter_no AS validThroughChapterNo FROM hanlp_bootstrap_coverage WHERE novel_id = ?',
      novelId,
    )

    expect(hanlpCalls).toEqual([3, 4, 5])
    expect(payload.hanlpBootstrap).toMatchObject({
      totalChapterCount: 5,
      completedChapterCount: 5,
      cacheMissCount: 3,
    })
    expect(marker?.validThroughChapterNo).toBe(5)
  })

  it('rebuilds the first 50 chapters from existing extraction cache without stack overflow', async () => {
    process.env.HANLP_BOOTSTRAP_PARALLELISM = '25'
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-rebuild-first-50-cache')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_first_50_cache', 50)
    const aiSettings = createMockAISettings(10)

    const insertCandidate = database.prepare(
      `INSERT INTO chapter_extraction_candidates (
        id, novel_id, branch_id, chapter_id, chapter_no, chapter_revision,
        chapter_source_hash, extraction_json, status, provider, model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (let chapterNo = 1; chapterNo <= 50; chapterNo += 1) {
      insertCandidate.run(
        `cached-candidate-${chapterNo}`,
        novelId,
        branchId,
        `chapter-${chapterNo}`,
        chapterNo,
        1,
        buildTestExtractionCandidateSourceHash({
          chapterSourceHash: `chapter-hash-${chapterNo}`,
          settings: aiSettings.knowledgeExtraction,
        }),
        JSON.stringify(createMockExtraction(chapterNo)),
        'extracted',
        'openai-compatible',
        aiSettings.knowledgeExtraction.openAICompatible.model,
      )
    }

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => aiSettings,
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap', () => ({
      runHanlpBootstrapForChapter: vi.fn(async (input: { rawText: string }) => ({
        source: 'cache' as const,
        cache: {} as never,
        result: {} as never,
        output: { people: [], locations: [], organizations: [], settings: [], entities: [] },
        cacheKey: {} as never,
        scriptPath: '/tmp/mock-hanlp.py',
        normalizedChapterText: input.rawText,
      })),
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap-initializer', () => ({
      initializeHanlpBootstrapCharacterEntities: vi.fn(async () => ({
        createdOrUpdatedEntityIds: [],
        characterDecisions: [],
        promptContext: { characters: [], locations: [], organizations: [], settings: [] },
      })),
    }))
    vi.doMock('@/lib/server/knowledge-extraction', () => ({
      extractChapterKnowledgeOffline: vi.fn(async () => {
        throw new Error('Extraction should not run when all first-50 candidates are cached')
      }),
    }))
    vi.doMock('@/lib/server/retrieval-index', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/retrieval-index')>()
      return {
        ...actual,
        precomputeRawTextEmbeddingCache: vi.fn(async () => ({
          totalDocs: 0,
          completedDocs: 0,
          cacheHits: 0,
          cacheMisses: 0,
          failedDocs: 0,
          totalBatches: 0,
          completedBatches: 0,
          degraded: false,
          cancelled: false,
          durationMs: 0,
        })),
        rebuildBranchRetrievalIndex: vi.fn(async () => ({ rowCount: 0, embeddingBatchCount: 0 })),
      }
    })

    const { rebuildKnowledgeForNovel } = await import('@/lib/server/knowledge-rebuild')
    await expect(rebuildKnowledgeForNovel({ novelId, chapterRange: { startChapter: 1, endChapter: 50 } })).resolves.toMatchObject({ outcome: 'completed' })

    expect(queryOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM chapter_extraction_candidates WHERE branch_id = ? AND processing_result_json IS NOT NULL',
      branchId,
    )?.count).toBe(50)
    const firstBatchCache = queryOne<{ processingBatchId: string | null }>(
      'SELECT processing_batch_id AS processingBatchId FROM chapter_extraction_candidates WHERE chapter_id = ?',
      'chapter-1',
    )
    const lastBatchCache = queryOne<{ processingBatchId: string | null }>(
      'SELECT processing_batch_id AS processingBatchId FROM chapter_extraction_candidates WHERE chapter_id = ?',
      'chapter-50',
    )
    const firstBatchContext = JSON.parse(queryOne<{ batchContextJson: string | null }>(
      'SELECT batch_context_json AS batchContextJson FROM chapter_extraction_processing_batches WHERE id = ?',
      firstBatchCache?.processingBatchId ?? '',
    )?.batchContextJson ?? '{}') as { batch?: { chapterNos?: number[] } }
    const lastBatchContext = JSON.parse(queryOne<{ batchContextJson: string | null }>(
      'SELECT batch_context_json AS batchContextJson FROM chapter_extraction_processing_batches WHERE id = ?',
      lastBatchCache?.processingBatchId ?? '',
    )?.batchContextJson ?? '{}') as { batch?: { chapterNos?: number[] } }

    expect(queryOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM chapter_extraction_processing_batches WHERE branch_id = ?',
      branchId,
    )?.count).toBe(5)
    expect(firstBatchContext.batch?.chapterNos).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(lastBatchContext.batch?.chapterNos).toEqual([41, 42, 43, 44, 45, 46, 47, 48, 49, 50])
  })

  it('clears stale batch processing cache when a candidate is re-extracted', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-rebuild-processing-cache-invalidation')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_processing_cache_invalidation', 1)
    const aiSettings = createMockAISettings(1)
    const chapterSourceHash = buildTestExtractionCandidateSourceHash({
      chapterSourceHash: 'chapter-hash-1',
      settings: aiSettings.knowledgeExtraction,
    })

    database.prepare(
      `INSERT INTO chapter_extraction_candidates (
        id, novel_id, branch_id, chapter_id, chapter_no, chapter_revision,
        chapter_source_hash, extraction_json, processing_result_json, status, provider, model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'stale-processing-candidate',
      novelId,
      branchId,
      'chapter-1',
      1,
      1,
      chapterSourceHash,
      JSON.stringify({ ...createMockExtraction(1), summary: 'old extraction summary' }),
      JSON.stringify({
        schemaVersion: 'knowledge-extraction-processing:v1',
        batch: { chapterIds: ['chapter-1'], chapterNos: [1], aliasDiscoveries: [] },
        resolved: { extraction: { ...createMockExtraction(1), summary: 'stale processing summary' } },
      }),
      'failed',
      'openai-compatible',
      aiSettings.knowledgeExtraction.openAICompatible.model,
    )

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => aiSettings,
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap', () => ({
      runHanlpBootstrapForChapter: vi.fn(async (input: { rawText: string }) => ({
        source: 'cache' as const,
        cache: {} as never,
        result: {} as never,
        output: { people: [], locations: [], organizations: [], settings: [], entities: [] },
        cacheKey: {} as never,
        scriptPath: '/tmp/mock-hanlp.py',
        normalizedChapterText: input.rawText,
      })),
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap-initializer', () => ({
      initializeHanlpBootstrapCharacterEntities: vi.fn(async () => ({
        createdOrUpdatedEntityIds: [],
        characterDecisions: [],
        promptContext: { characters: [], locations: [], organizations: [], settings: [] },
      })),
    }))
    vi.doMock('@/lib/server/knowledge-extraction', () => ({
      extractChapterKnowledgeOffline: vi.fn(async () => ({
        extraction: { ...createMockExtraction(1), summary: 'fresh extraction summary' },
        provider: 'openai-compatible' as const,
        model: aiSettings.knowledgeExtraction.openAICompatible.model,
      })),
    }))
    vi.doMock('@/lib/server/retrieval-index', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/retrieval-index')>()
      return {
        ...actual,
        precomputeRawTextEmbeddingCache: vi.fn(async () => ({
          totalDocs: 0,
          completedDocs: 0,
          cacheHits: 0,
          cacheMisses: 0,
          failedDocs: 0,
          totalBatches: 0,
          completedBatches: 0,
          degraded: false,
          cancelled: false,
          durationMs: 0,
        })),
        rebuildBranchRetrievalIndex: vi.fn(async () => ({ rowCount: 0, embeddingBatchCount: 0 })),
      }
    })

    const { rebuildKnowledgeForNovel } = await import('@/lib/server/knowledge-rebuild')
    await expect(rebuildKnowledgeForNovel({ novelId })).resolves.toMatchObject({ outcome: 'completed' })

    expect(queryOne<{ summary: string | null }>(
      'SELECT summary FROM KnowledgeChapter WHERE id = ?',
      'chapter-1',
    )?.summary).toBe('fresh extraction summary')

    const processingResult = queryOne<{ processingBatchId: string | null; processingResultJson: string | null }>(
      'SELECT processing_batch_id AS processingBatchId, processing_result_json AS processingResultJson FROM chapter_extraction_candidates WHERE id = ?',
      'stale-processing-candidate',
    )
    const resolvedPayload = JSON.parse(processingResult?.processingResultJson ?? '{}') as {
      schemaVersion?: string
      resolved?: { extraction?: { summary?: string } }
    }
    expect(processingResult?.processingBatchId).toBeTruthy()
    expect(resolvedPayload).toMatchObject({
      schemaVersion: 'knowledge-extraction-processing:v2',
      resolved: { extraction: { summary: 'fresh extraction summary' } },
    })
  })

  it('can pause during HanLP before any extraction starts', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-rebuild-hanlp-pause')
    const { novelId } = seedKnowledgeRebuildFixture(database, 'novel_hanlp_pause', 1)
    const aiSettings = createMockAISettings(1)
    const hanlpGate = createDeferred<void>()
    let extractionCalls = 0

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => aiSettings,
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap', () => ({
      runHanlpBootstrapForChapter: vi.fn(async () => {
        await hanlpGate.promise
        return {
          source: 'runner' as const,
          cache: {} as never,
          result: {} as never,
          output: { people: [], locations: [], organizations: [], settings: [], entities: [] },
          cacheKey: {} as never,
          scriptPath: '/tmp/mock-hanlp.py',
          normalizedChapterText: '第1章原文内容。',
        }
      }),
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap-initializer', () => ({
      initializeHanlpBootstrapCharacterEntities: vi.fn(async () => ({
        createdOrUpdatedEntityIds: [],
        characterDecisions: [],
        promptContext: { characters: [], locations: [], organizations: [], settings: [] },
      })),
    }))
    vi.doMock('@/lib/server/knowledge-extraction', () => ({
      extractChapterKnowledgeOffline: vi.fn(async () => {
        extractionCalls += 1
        return {
          extraction: createMockExtraction(1),
          provider: 'openai-compatible' as const,
          model: aiSettings.knowledgeExtraction.openAICompatible.model,
        }
      }),
    }))
    vi.doMock('@/lib/server/retrieval-index', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/retrieval-index')>()
      return {
        ...actual,
        precomputeRawTextEmbeddingCache: vi.fn(async () => ({
          totalDocs: 0,
          completedDocs: 0,
          cacheHits: 0,
          cacheMisses: 0,
          failedDocs: 0,
          totalBatches: 0,
          completedBatches: 0,
          degraded: false,
          cancelled: false,
          durationMs: 0,
        })),
        rebuildBranchRetrievalIndex: vi.fn(async () => ({ rowCount: 0, embeddingBatchCount: 0 })),
      }
    })

    const { pauseKnowledgeRebuildForNovel, rebuildKnowledgeForNovel } = await import('@/lib/server/knowledge-rebuild')
    const rebuildPromise = rebuildKnowledgeForNovel({ novelId })

    await waitForCondition(
      () => Boolean(queryOne<{ currentStep: string | null }>('SELECT currentStep FROM KnowledgeJob WHERE novelId = ?', novelId)?.currentStep?.includes('HanLP')),
      'HanLP current step'
    )

    await expect(pauseKnowledgeRebuildForNovel({ novelId })).resolves.toBe('paused')
    hanlpGate.resolve()

    await expect(rebuildPromise).resolves.toMatchObject({ outcome: 'paused' })
    expect(extractionCalls).toBe(0)
    expect(queryOne<{ status: string }>('SELECT status FROM KnowledgeJob WHERE novelId = ?', novelId)?.status).toBe('paused')
  })

  it('can abort during HanLP before any extraction starts', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-rebuild-hanlp-abort')
    const { novelId } = seedKnowledgeRebuildFixture(database, 'novel_hanlp_abort', 1)
    const aiSettings = createMockAISettings(1)
    const hanlpGate = createDeferred<void>()
    let extractionCalls = 0

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => aiSettings,
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap', () => ({
      runHanlpBootstrapForChapter: vi.fn(async () => {
        await hanlpGate.promise
        return {
          source: 'runner' as const,
          cache: {} as never,
          result: {} as never,
          output: { people: [], locations: [], organizations: [], settings: [], entities: [] },
          cacheKey: {} as never,
          scriptPath: '/tmp/mock-hanlp.py',
          normalizedChapterText: '第1章原文内容。',
        }
      }),
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap-initializer', () => ({
      initializeHanlpBootstrapCharacterEntities: vi.fn(async () => ({
        createdOrUpdatedEntityIds: [],
        characterDecisions: [],
        promptContext: { characters: [], locations: [], organizations: [], settings: [] },
      })),
    }))
    vi.doMock('@/lib/server/knowledge-extraction', () => ({
      extractChapterKnowledgeOffline: vi.fn(async () => {
        extractionCalls += 1
        return {
          extraction: createMockExtraction(1),
          provider: 'openai-compatible' as const,
          model: aiSettings.knowledgeExtraction.openAICompatible.model,
        }
      }),
    }))
    vi.doMock('@/lib/server/retrieval-index', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/retrieval-index')>()
      return {
        ...actual,
        precomputeRawTextEmbeddingCache: vi.fn(async () => ({
          totalDocs: 0,
          completedDocs: 0,
          cacheHits: 0,
          cacheMisses: 0,
          failedDocs: 0,
          totalBatches: 0,
          completedBatches: 0,
          degraded: false,
          cancelled: false,
          durationMs: 0,
        })),
        rebuildBranchRetrievalIndex: vi.fn(async () => ({ rowCount: 0, embeddingBatchCount: 0 })),
      }
    })

    const { abortKnowledgeRebuildForNovel, rebuildKnowledgeForNovel } = await import('@/lib/server/knowledge-rebuild')
    const rebuildPromise = rebuildKnowledgeForNovel({ novelId })

    await waitForCondition(
      () => Boolean(queryOne<{ currentStep: string | null }>('SELECT currentStep FROM KnowledgeJob WHERE novelId = ?', novelId)?.currentStep?.includes('HanLP')),
      'HanLP current step'
    )

    await expect(abortKnowledgeRebuildForNovel({ novelId })).resolves.toBe('aborted')
    hanlpGate.resolve()

    await expect(rebuildPromise).resolves.toMatchObject({ outcome: 'aborted' })
    expect(extractionCalls).toBe(0)
    expect(queryOne<{ status: string }>('SELECT status FROM KnowledgeJob WHERE novelId = ?', novelId)?.status).toBe('aborted')
  })

  it('recreates bootstrapped formal characters with their HanLP tier and projected classification after cleanup', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-rebuild-hanlp-tier-preservation')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_hanlp_tier_preservation', 1)
    const aiSettings = createMockAISettings(1)

    database.prepare(
      `INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, description,
        firstSeenChapter, lastSeenChapter, importanceTier, status, userConfirmed
      ) VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, ?, 0)`
    ).run('entity-linyan-bootstrap', novelId, branchId, '林砚', '旧引导描述', 1, 1, 'protagonist', 'hanlp_bootstrap')
    database.prepare(
      `INSERT INTO hanlp_bootstrap_entities (
        id, novel_id, branch_id, chapter_id, chapter_no, entity_text, entity_type,
        total_count, chapter_count, coverage_ratio, score, source_cache_id, source_result_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
    ).run('hanlp-person-linyan', novelId, branchId, 'chapter-1', 1, '林砚', 'person', 12, 1, 1, 0.99)

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => aiSettings,
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap', () => ({
      runHanlpBootstrapForChapter: vi.fn(async (input: { rawText: string }) => ({
        source: 'cache' as const,
        cache: {} as never,
        result: {} as never,
        output: { people: [], locations: [], organizations: [], settings: [], entities: [] },
        cacheKey: {} as never,
        scriptPath: '/tmp/mock-hanlp.py',
        normalizedChapterText: input.rawText,
      })),
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap-initializer', () => ({
      initializeHanlpBootstrapCharacterEntities: vi.fn(async () => ({
        createdOrUpdatedEntityIds: [],
        characterDecisions: [],
        promptContext: { characters: [], locations: [], organizations: [], settings: [] },
      })),
    }))
    vi.doMock('@/lib/server/knowledge-extraction', () => ({
      extractChapterKnowledgeOffline: vi.fn(async () => ({
        extraction: {
          chapterNo: 1,
          summary: 'summary-1',
          characters: [{
            name: '林砚',
            aliases: [],
            descriptionDelta: '剑意更稳',
            profile: {},
            status: '活跃',
            evidence: [{ quote: '林砚剑意更稳。', lineStart: 1, lineEnd: 1 }],
          }],
          knownCharacterUpdates: [],
          unknownCharacterObservations: [],
          aliasDiscoveries: [],
          relations: [],
          events: [],
          worldbuilding: [],
          openThreads: [{
            name: 'thread-1',
            description: 'proof',
            evidence: [{ quote: '第1章原文内容。', lineStart: 1, lineEnd: 1 }],
          }],
        },
        provider: 'openai-compatible' as const,
        model: aiSettings.knowledgeExtraction.openAICompatible.model,
      })),
    }))
    vi.doMock('@/lib/server/retrieval-index', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/retrieval-index')>()
      return {
        ...actual,
        precomputeRawTextEmbeddingCache: vi.fn(async () => ({
          totalDocs: 0,
          completedDocs: 0,
          cacheHits: 0,
          cacheMisses: 0,
          failedDocs: 0,
          totalBatches: 0,
          completedBatches: 0,
          degraded: false,
          cancelled: false,
          durationMs: 0,
        })),
        rebuildBranchRetrievalIndex: vi.fn(async () => ({ rowCount: 0, embeddingBatchCount: 0 })),
      }
    })

    const { rebuildKnowledgeForNovel } = await import('@/lib/server/knowledge-rebuild')
    await expect(rebuildKnowledgeForNovel({ novelId })).resolves.toMatchObject({ outcome: 'completed' })

    const rebuiltEntity = queryOne<{
      id: string
      canonicalName: string
      importanceTier: string | null
      status: string | null
    }>(
      `SELECT id, canonicalName, importanceTier, status
       FROM KnowledgeEntity
       WHERE branchId = ? AND canonicalName = ?
       ORDER BY createdAt DESC
       LIMIT 1`,
      branchId,
      '林砚',
    )
    const oldEntity = queryOne<{ id: string }>('SELECT id FROM KnowledgeEntity WHERE id = ?', 'entity-linyan-bootstrap')

    const { buildKnowledgeProjection } = await import('@/lib/server/knowledge-view')
    const projection = await buildKnowledgeProjection([novelId], 1)
    const projectedCharacter = projection.localCharacters.find((character) => character.id === rebuiltEntity?.id)

    expect(oldEntity).toBeNull()
    expect(rebuiltEntity).toMatchObject({
      canonicalName: '林砚',
      importanceTier: 'protagonist',
      status: '活跃',
    })
    expect(projectedCharacter).toMatchObject({
      name: '林砚',
      importanceTier: 'protagonist',
      classificationKey: 'tier0',
      classificationLabel: 'Tier 0',
    })
  })

  it('passes combined story-state and HanLP chapter context into extraction calls', async () => {
    const { database, queryAll } = await createTestDatabase('chatbook-knowledge-rebuild-hanlp-prompt-context')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_hanlp_prompt_context', 2)
    const aiSettings = createMockAISettings(1)
    const extractionSpy = vi.fn(async (params: { chapterNo: number }) => ({
      extraction: params.chapterNo === 2
        ? {
            ...createMockExtraction(params.chapterNo),
            worldbuilding: [
              {
                term: '北京',
                category: 'organization',
                definition: '主角抵达的城池。',
                evidence: [{ quote: '阿离和老周走进北京黑塔。', lineStart: 1, lineEnd: 1 }],
              },
              {
                term: '黑塔',
                category: 'location',
                definition: '训练学徒的组织。',
                evidence: [{ quote: '阿离和老周走进北京黑塔。', lineStart: 1, lineEnd: 1 }],
              },
              {
                term: '夜雨',
                category: 'location',
                definition: '本章出现的场景氛围。',
                evidence: [{ quote: '夜雨落在塔檐。', lineStart: 2, lineEnd: 2 }],
              },
            ],
          }
        : createMockExtraction(params.chapterNo),
      provider: 'openai-compatible' as const,
      model: aiSettings.knowledgeExtraction.openAICompatible.model,
    }))

    database.prepare(
      `
        INSERT INTO KnowledgeEntity (
          id, novelId, branchId, entityType, canonicalName, description,
          firstSeenChapter, lastSeenChapter, importanceTier, status, userConfirmed
        ) VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, ?, 1)
      `,
    ).run('entity-zhou', novelId, branchId, '周执事', '周执事是黑塔执事。', 1, 2, 'important', 'user_confirmed')
    database.prepare('INSERT INTO EntityAlias (id, entityId, alias, sourceChapter, confidence, userConfirmed) VALUES (?, ?, ?, ?, ?, ?)')
      .run('alias-old-zhou', 'entity-zhou', '老周', 1, 0.9, 0)
    database.prepare(
      'INSERT INTO EntityAliasMapping (id, novelId, branchId, alias, entityId, sourceAliasId, sourceChapter) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('alias-mapping-old-zhou', novelId, branchId, '老周', 'entity-zhou', 'alias-old-zhou', 1)
    database.prepare(
      `
        INSERT INTO hanlp_bootstrap_entities (
          id, novel_id, branch_id, chapter_id, chapter_no, entity_text, entity_type,
          total_count, chapter_count, coverage_ratio, score, source_cache_id, source_result_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      `,
    ).run('hanlp-person-zhou', novelId, branchId, 'chapter-2', 2, '老周', 'person', 2, 1, 0, 0.95)
    database.prepare(
      `
        INSERT INTO hanlp_bootstrap_entities (
          id, novel_id, branch_id, chapter_id, chapter_no, entity_text, entity_type,
          total_count, chapter_count, coverage_ratio, score, source_cache_id, source_result_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      `,
    ).run('hanlp-location-beijing', novelId, branchId, 'chapter-2', 2, '北京', 'location', 1, 1, 0, 0.4)
    database.prepare(
      `
        INSERT INTO hanlp_bootstrap_entities (
          id, novel_id, branch_id, chapter_id, chapter_no, entity_text, entity_type,
          total_count, chapter_count, coverage_ratio, score, source_cache_id, source_result_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      `,
    ).run('hanlp-org-blacktower', novelId, branchId, 'chapter-2', 2, '黑塔', 'organization', 1, 1, 0, 0.6)
    database.prepare(
      `
        INSERT INTO hanlp_bootstrap_entities (
          id, novel_id, branch_id, chapter_id, chapter_no, entity_text, entity_type,
          total_count, chapter_count, coverage_ratio, score, source_cache_id, source_result_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      `,
    ).run('hanlp-setting-night-rain', novelId, branchId, 'chapter-2', 2, '夜雨', 'setting', 1, 1, 0, 0.3)

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => aiSettings,
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap', () => ({
      runHanlpBootstrapForChapter: vi.fn(async (input: { chapterId: string; chapterNo: number; rawText: string }) => ({
        source: 'cache' as const,
        cache: {} as never,
        result: {} as never,
        output: { people: [], locations: [], organizations: [], settings: [], entities: [] },
        cacheKey: {} as never,
        scriptPath: '/tmp/mock-hanlp.py',
        normalizedChapterText: input.rawText,
      })),
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap-initializer', () => ({
      initializeHanlpBootstrapCharacterEntities: vi.fn(async () => ({
        createdOrUpdatedEntityIds: [],
        characterDecisions: [],
        promptContext: { characters: [], locations: [], organizations: [], settings: [] },
      })),
    }))
    vi.doMock('@/lib/server/knowledge-extraction', () => ({
      extractChapterKnowledgeOffline: extractionSpy,
    }))
    vi.doMock('@/lib/server/context-builder', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/context-builder')>()
      return {
        ...actual,
        buildKnowledgeExtractionStoryState: vi.fn((params: { asOfChapter: number }) => `# 截至第 ${params.asOfChapter} 章的故事状态\n- 老周曾在前章出现。`),
      }
    })
    vi.doMock('@/lib/server/retrieval-index', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/retrieval-index')>()
      return {
        ...actual,
        precomputeRawTextEmbeddingCache: vi.fn(async () => ({
          totalDocs: 0,
          completedDocs: 0,
          cacheHits: 0,
          cacheMisses: 0,
          failedDocs: 0,
          totalBatches: 0,
          completedBatches: 0,
          degraded: false,
          cancelled: false,
          durationMs: 0,
        })),
        rebuildBranchRetrievalIndex: vi.fn(async () => ({ rowCount: 0, embeddingBatchCount: 0 })),
      }
    })

    const { rebuildKnowledgeForNovel } = await import('@/lib/server/knowledge-rebuild')

    await expect(rebuildKnowledgeForNovel({ novelId })).resolves.toMatchObject({ outcome: 'completed' })

    const chapterTwoCall = extractionSpy.mock.calls.find(([params]) => params.chapterNo === 2)?.[0] as { storyStateText?: string } | undefined
    expect(chapterTwoCall?.storyStateText).toContain('# 截至第 1 章的故事状态')
    expect(chapterTwoCall?.storyStateText).toContain('HanLP 当前章节实体提示')
    expect(chapterTwoCall?.storyStateText).toContain('Tier 1 重要配角：周执事（别名：老周）')
    expect(chapterTwoCall?.storyStateText).toContain('HanLP 地点词：北京')
    expect(chapterTwoCall?.storyStateText).toContain('HanLP 组织词：黑塔')
    expect(chapterTwoCall?.storyStateText).toContain('HanLP 场景/设定词：夜雨')
    expect(queryAll<{ term: string; category: string }>(
      'SELECT term, category FROM KnowledgeWorld WHERE branchId = ? ORDER BY term ASC',
      branchId,
    )).toEqual([
      { term: '北京', category: 'location' },
      { term: '夜雨', category: 'setting' },
      { term: '黑塔', category: 'organization' },
    ])
  })
})
