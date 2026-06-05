import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'
import type { AISettings } from '@/lib/types'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }
const originalDatabaseUrl = process.env.DATABASE_URL
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

function createMockAISettings(): AISettings {
  return {
    rewrite: {
      provider: 'openai-compatible',
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
      provider: 'ollama',
      openAICompatible: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        apiKeyConfigured: true,
        apiKeyMasked: 'test***key',
        model: 'knowledge-model',
        configured: true,
        parallelism: 1,
      },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'knowledge-model',
        configured: true,
        parallelism: 1,
      },
    },
    embeddings: {
      provider: 'ollama',
      openAICompatible: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        apiKeyConfigured: true,
        apiKeyMasked: 'test***key',
        model: 'unused-openai-embedding-model',
        configured: true,
      },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'snapshot-embedding-model',
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
    openThreads: [],
  }
}

function seedKnowledgeRebuildFixture(database: DatabaseSync, novelKey = 'novel_overlap', chapterCount = 1) {
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
  vi.unmock('@/lib/server/ai-settings')
  vi.unmock('@/lib/server/hanlp-bootstrap')
  vi.unmock('@/lib/server/hanlp-bootstrap-initializer')
  vi.unmock('@/lib/server/knowledge-extraction')
  vi.unmock('@/lib/server/ollama-local')
  vi.unmock('@/lib/server/retrieval-index')
  vi.doUnmock('@/lib/server/ai-settings')
  vi.doUnmock('@/lib/server/hanlp-bootstrap')
  vi.doUnmock('@/lib/server/hanlp-bootstrap-initializer')
  vi.doUnmock('@/lib/server/knowledge-extraction')
  vi.doUnmock('@/lib/server/ollama-local')
  vi.doUnmock('@/lib/server/retrieval-index')
  vi.resetModules()

  if (globalForSqlite.sqlite) {
    try {
      ;(globalForSqlite.sqlite as DatabaseSync & { close?: () => void }).close?.()
    } catch {
    }
    delete globalForSqlite.sqlite
  }

  process.env.DATABASE_URL = originalDatabaseUrl

  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('knowledge rebuild raw-text precompute overlap', () => {
  it('keeps dedicated retrieval rebuild visible while raw embedding is running, then builds LanceDB', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-retrieval-dedicated-worker')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_dedicated_retrieval_worker', 2)
    const aiSettings = createMockAISettings()
    const precomputeGate = createDeferred()
    let precomputeStarted = false
    let indexStarted = false

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => aiSettings,
      saveAISettings: vi.fn(),
      maskApiKey: (value: string) => value,
    }))

    vi.doMock('@/lib/server/retrieval-index', async () => {
      const actual = await vi.importActual<typeof import('@/lib/server/retrieval-index')>('@/lib/server/retrieval-index')
      return {
        ...actual,
        precomputeRawTextEmbeddingCache: vi.fn(async (params: Parameters<typeof actual.precomputeRawTextEmbeddingCache>[0]) => {
          precomputeStarted = true
          await params.onProgress?.({
            totalDocs: 2,
            completedDocs: 1,
            cacheHits: 1,
            cacheMisses: 1,
            failedDocs: 0,
            totalBatches: 2,
            completedBatches: 1,
          })
          await precomputeGate.promise
          return {
            totalDocs: 2,
            completedDocs: 2,
            cacheHits: 1,
            cacheMisses: 1,
            failedDocs: 0,
            totalBatches: 2,
            completedBatches: 2,
            degraded: false,
            cancelled: false,
            durationMs: 25,
          }
        }),
        rebuildBranchRetrievalIndex: vi.fn(async (_novelId: string, _branchId: string, options?: Parameters<typeof actual.rebuildBranchRetrievalIndex>[2]) => {
          indexStarted = true
          await options?.onProgress?.({ phase: 'loading', totalRows: 2, embeddedRows: 0, totalBatches: 2, completedBatches: 0 })
          await options?.onProgress?.({ phase: 'embedding', totalRows: 2, embeddedRows: 1, totalBatches: 2, completedBatches: 1 })
          await options?.onProgress?.({ phase: 'completed', totalRows: 2, embeddedRows: 2, totalBatches: 2, completedBatches: 2 })
          return { rowCount: 2, embeddingBatchCount: 2 }
        }),
      }
    })

    const { startKnowledgeRetrievalRebuildForNovel, runStartedKnowledgeRetrievalRebuildForNovel } = await import('@/lib/server/knowledge-rebuild')
    const started = await startKnowledgeRetrievalRebuildForNovel({ novelId, branchId, chapterRange: { startChapter: 1, endChapter: 2 } })
    expect(started.outcome).toBe('queued')

    const runPromise = runStartedKnowledgeRetrievalRebuildForNovel({ novelId, branchId, jobId: started.jobId })
    await waitForCondition(() => precomputeStarted, 'dedicated retrieval precompute start')

    const runningJob = queryOne<{ status: string; currentStep: string | null; progress: number; payloadJson: string | null }>(
      'SELECT status, currentStep, progress, payloadJson FROM KnowledgeJob WHERE id = ?',
      started.jobId,
    )
    const runningPayload = runningJob?.payloadJson ? JSON.parse(runningJob.payloadJson) as { phase?: string; rawTextEmbeddingProgress?: number } : null
    expect(runningJob).toMatchObject({
      status: 'running',
      currentStep: '等待原文 Embedding 预计算完成',
    })
    expect(runningJob?.progress).toBeGreaterThanOrEqual(0.94)
    expect(runningPayload).toMatchObject({
      phase: 'raw-embedding',
      rawTextEmbeddingProgress: 0.5,
    })

    precomputeGate.resolve()
    await expect(runPromise).resolves.toBeUndefined()

    const completedJob = queryOne<{ status: string; currentStep: string | null; progress: number; payloadJson: string | null }>(
      'SELECT status, currentStep, progress, payloadJson FROM KnowledgeJob WHERE id = ?',
      started.jobId,
    )
    const completedPayload = completedJob?.payloadJson ? JSON.parse(completedJob.payloadJson) as { phase?: string; rawTextEmbeddingProgress?: number; indexProgress?: { phase?: string } } : null
    expect(indexStarted).toBe(true)
    expect(completedJob).toMatchObject({
      status: 'succeeded',
      currentStep: '完成',
      progress: 1,
    })
    expect(completedPayload).toMatchObject({
      phase: 'index',
      rawTextEmbeddingProgress: 1,
      indexProgress: { phase: 'completed' },
    })
  })

  it('no-ops duplicate targeted retrieval workers once the job is already running', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-retrieval-targeted-duplicate-worker')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_targeted_duplicate_retrieval_worker', 2)
    const aiSettings = createMockAISettings()
    const precomputeGate = createDeferred<void>()
    let precomputeStarted = false
    let precomputeCalls = 0
    let indexCalls = 0

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => aiSettings,
      saveAISettings: vi.fn(),
      maskApiKey: (value: string) => value,
    }))

    vi.doMock('@/lib/server/retrieval-index', async () => {
      const actual = await vi.importActual<typeof import('@/lib/server/retrieval-index')>('@/lib/server/retrieval-index')
      return {
        ...actual,
        precomputeRawTextEmbeddingCache: vi.fn(async () => {
          precomputeCalls += 1
          precomputeStarted = true
          await precomputeGate.promise
          return {
            totalDocs: 2,
            completedDocs: 2,
            cacheHits: 1,
            cacheMisses: 1,
            failedDocs: 0,
            totalBatches: 2,
            completedBatches: 2,
            degraded: false,
            cancelled: false,
            durationMs: 25,
          }
        }),
        rebuildBranchRetrievalIndex: vi.fn(async () => {
          indexCalls += 1
          return { rowCount: 2, embeddingBatchCount: 2 }
        }),
      }
    })

    const primaryWorker = await import('@/lib/server/knowledge-rebuild')
    const started = await primaryWorker.startKnowledgeRetrievalRebuildForNovel({ novelId, branchId, chapterRange: { startChapter: 1, endChapter: 2 } })
    expect(started.outcome).toBe('queued')

    const primaryRun = primaryWorker.runStartedKnowledgeRetrievalRebuildForNovel({ novelId, branchId, jobId: started.jobId })
    await waitForCondition(() => precomputeStarted, 'retrieval targeted duplicate primary start')

    vi.resetModules()
    const duplicateWorker = await import('@/lib/server/knowledge-rebuild')
    await expect(duplicateWorker.runStartedKnowledgeRetrievalRebuildForNovel({ novelId, branchId, jobId: started.jobId })).resolves.toBeUndefined()

    const runningJob = queryOne<{ status: string; currentStep: string | null }>(
      'SELECT status, currentStep FROM KnowledgeJob WHERE id = ?',
      started.jobId,
    )
    expect(runningJob).toMatchObject({
      status: 'running',
      currentStep: '等待原文 Embedding 预计算完成',
    })
    expect(precomputeCalls).toBe(1)
    expect(indexCalls).toBe(0)

    precomputeGate.resolve()
    await expect(primaryRun).resolves.toBeUndefined()

    expect(precomputeCalls).toBe(1)
    expect(indexCalls).toBe(1)
    expect(queryOne<{ status: string }>('SELECT status FROM KnowledgeJob WHERE id = ?', started.jobId)?.status).toBe('succeeded')
  })

  it('exposes raw-text telemetry through rebuild status', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-rebuild-status-telemetry-surface')
    const novelId = `novel_status_${Math.random().toString(36).slice(2, 8)}`
    const branchId = `${novelId}:main`

    database.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run(novelId, 'Status Novel', 'workspace')
    database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run(branchId, novelId, 'main')
    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, progress, payloadJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'job_status_telemetry',
      novelId,
      branchId,
      'extract_chapter_knowledge',
      'running',
      'extract',
      0.45,
      JSON.stringify({
        steps: [
          {
            key: 'extract',
            label: '抽取章节知识',
            status: 'running',
            progress: 0.45,
            etaMinutes: 2,
            detail: null,
          },
        ],
        rawTextEmbeddingProgress: 0.6,
        rawTextEmbeddingCacheHitRate: 0.75,
        stageTimingsMs: {
          extract: 1200,
          raw_text_precompute: 340,
        },
        embeddingSettingsSnapshot: {
          provider: 'ollama',
          model: 'snapshot-embedding-model',
          embeddingBatchSize: 16,
        },
      })
    )

    const { buildKnowledgeProjection } = await import('@/lib/server/knowledge-view')
    const projection = await buildKnowledgeProjection([novelId])

    expect(projection.knowledgeRebuildStatus).toMatchObject({
      jobId: 'job_status_telemetry',
      novelId,
      status: 'running',
      rawTextEmbeddingProgress: 0.6,
      rawTextEmbeddingCacheHitRate: 0.75,
      stageTimingsMs: {
        extract: 1200,
        raw_text_precompute: 340,
      },
      embeddingSettingsSnapshot: {
        provider: 'ollama',
        model: 'snapshot-embedding-model',
        embeddingBatchSize: 16,
      },
    })
  })

  it('skips duplicate detached retrieval workers once another process claimed the job', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-retrieval-detached-claim')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_detached_retrieval_claim', 2)
    const aiSettings = createMockAISettings()
    const precomputeGate = createDeferred<void>()
    let precomputeCallCount = 0

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => aiSettings,
      saveAISettings: vi.fn(),
      maskApiKey: (value: string) => value,
    }))

    vi.doMock('@/lib/server/retrieval-index', async () => {
      const actual = await vi.importActual<typeof import('@/lib/server/retrieval-index')>('@/lib/server/retrieval-index')
      return {
        ...actual,
        precomputeRawTextEmbeddingCache: vi.fn(async () => {
          precomputeCallCount += 1
          await precomputeGate.promise
          return {
            totalDocs: 2,
            completedDocs: 2,
            cacheHits: 1,
            cacheMisses: 1,
            failedDocs: 0,
            totalBatches: 2,
            completedBatches: 2,
            degraded: false,
            cancelled: false,
            durationMs: 5,
          }
        }),
        rebuildBranchRetrievalIndex: vi.fn(async () => ({ rowCount: 2, embeddingBatchCount: 1 })),
      }
    })

    const firstModule = await import('@/lib/server/knowledge-rebuild')
    const started = await firstModule.startKnowledgeRetrievalRebuildForNovel({ novelId, branchId, chapterRange: { startChapter: 1, endChapter: 2 } })
    const firstRunPromise = firstModule.runStartedKnowledgeRetrievalRebuildForNovel({ novelId, branchId, jobId: started.jobId })

    await waitForCondition(() => precomputeCallCount === 1, 'first retrieval worker claim')

    vi.resetModules()
    const secondModule = await import('@/lib/server/knowledge-rebuild')
    await expect(secondModule.runStartedKnowledgeRetrievalRebuildForNovel({
      novelId,
      branchId,
      jobId: started.jobId,
    })).resolves.toBeUndefined()

    expect(precomputeCallCount).toBe(1)

    precomputeGate.resolve()
    await expect(firstRunPromise).resolves.toBeUndefined()
  })

  it('skips duplicate detached main rebuild workers once another process claimed the job', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-main-detached-claim')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_detached_main_claim', 1)
    const aiSettings = createMockAISettings()
    const extractionGate = createDeferred<void>()
    let extractionCallCount = 0

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
        extractionCallCount += 1
        await extractionGate.promise
        return {
          extraction: createMockExtraction(1),
          provider: 'ollama',
          model: aiSettings.knowledgeExtraction.ollama.model,
        }
      }),
    }))
    vi.doMock('@/lib/server/retrieval-index', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/retrieval-index')>()
      return {
        ...actual,
        rebuildBranchRetrievalIndex: vi.fn(async () => ({ rowCount: 0, embeddingBatchCount: 0 })),
      }
    })

    const firstModule = await import('@/lib/server/knowledge-rebuild')
    const started = await firstModule.startKnowledgeRebuildForNovel({ novelId, branchId })
    const firstRunPromise = firstModule.runStartedKnowledgeRebuildForNovel({ novelId, branchId, jobId: started.jobId })

    await waitForCondition(() => extractionCallCount === 1, 'first main rebuild worker claim')

    vi.resetModules()
    const secondModule = await import('@/lib/server/knowledge-rebuild')
    await expect(secondModule.runStartedKnowledgeRebuildForNovel({
      novelId,
      branchId,
      jobId: started.jobId,
    })).resolves.toBeUndefined()

    expect(extractionCallCount).toBe(1)

    extractionGate.resolve()
    await expect(firstRunPromise).resolves.toBeUndefined()
  })

  it('keeps raw-text precompute off the main SQLite rebuild path', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-rebuild-overlap-starts-early')
    const { novelId } = seedKnowledgeRebuildFixture(database)
    const aiSettings = createMockAISettings()
    const extractionGate = createDeferred<void>()
    const embeddingGate = createDeferred<void>()
    let extractionStarted = false
    let extractionFinished = false
    let precomputeStarted = false

    const embedTextsWithOllama = vi.fn(async (input: string | string[], configOverride?: { model?: string }) => {
      precomputeStarted = true
      expect(configOverride?.model).toBe(aiSettings.embeddings.ollama.model)
      await embeddingGate.promise
      const values = Array.isArray(input) ? input : [input]
      return {
        enabled: true,
        embeddings: values.map(() => [0.1, 0.2, 0.3]),
        model: configOverride?.model ?? aiSettings.embeddings.ollama.model,
      }
    })

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => aiSettings,
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap', () => ({
      runHanlpBootstrapForChapter: vi.fn(async (input: { chapterNo: number; rawText: string }) => ({
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
        extractionStarted = true
        await extractionGate.promise
        extractionFinished = true
        return {
          extraction: createMockExtraction(1),
          provider: 'ollama',
          model: aiSettings.knowledgeExtraction.ollama.model,
        }
      }),
    }))
    vi.doMock('@/lib/server/ollama-local', () => ({
      embedTextsWithOllama,
    }))
    vi.doMock('@/lib/server/retrieval-index', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/retrieval-index')>()
      return {
        ...actual,
        rebuildBranchRetrievalIndex: vi.fn(async () => ({ rowCount: 0, embeddingBatchCount: 0 })),
      }
    })

    const { rebuildKnowledgeForNovel } = await import('@/lib/server/knowledge-rebuild')
    const rebuildPromise = rebuildKnowledgeForNovel({ novelId })

    await waitForCondition(() => extractionStarted, 'extraction start')
    expect(extractionFinished).toBe(false)
    expect(precomputeStarted).toBe(false)

    extractionGate.resolve()
    embeddingGate.resolve()

    await expect(rebuildPromise).resolves.toMatchObject({ outcome: 'completed' })

    expect(embedTextsWithOllama).not.toHaveBeenCalled()
    const payloadRow = queryOne<{ payloadJson: string | null }>('SELECT payloadJson FROM KnowledgeJob WHERE novelId = ?', novelId)
    const payload = payloadRow?.payloadJson ? JSON.parse(payloadRow.payloadJson) as { rawTextEmbeddingProgress?: number; stageTimingsMs?: Record<string, number> } : null
    expect(payload?.rawTextEmbeddingProgress).toBeUndefined()
    expect(payload?.stageTimingsMs?.raw_text_precompute).toBeUndefined()
  })

  it('no-ops duplicate targeted main rebuild workers once the job is already running', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-main-targeted-duplicate-worker')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_targeted_duplicate_main_worker')
    const aiSettings = createMockAISettings()
    const extractionGate = createDeferred<void>()
    let extractionStarted = false
    let extractionCalls = 0

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
        extractionCalls += 1
        extractionStarted = true
        await extractionGate.promise
        return {
          extraction: createMockExtraction(1),
          provider: 'ollama',
          model: aiSettings.knowledgeExtraction.ollama.model,
        }
      }),
    }))
    vi.doMock('@/lib/server/retrieval-index', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/retrieval-index')>()
      return {
        ...actual,
        rebuildBranchRetrievalIndex: vi.fn(async () => ({ rowCount: 0, embeddingBatchCount: 0 })),
      }
    })

    const primaryWorker = await import('@/lib/server/knowledge-rebuild')
    const started = await primaryWorker.startKnowledgeRebuildForNovel({ novelId, branchId })
    expect(started.outcome).toBe('queued')

    const primaryRun = primaryWorker.runStartedKnowledgeRebuildForNovel({ novelId, branchId, jobId: started.jobId })
    await waitForCondition(() => extractionStarted, 'main targeted duplicate primary start')

    vi.resetModules()
    const duplicateWorker = await import('@/lib/server/knowledge-rebuild')
    await expect(duplicateWorker.runStartedKnowledgeRebuildForNovel({ novelId, branchId, jobId: started.jobId })).resolves.toBeUndefined()

    const runningJob = queryOne<{ status: string }>('SELECT status FROM KnowledgeJob WHERE id = ?', started.jobId)
    expect(runningJob?.status).toBe('running')
    expect(extractionCalls).toBe(1)

    extractionGate.resolve()
    await expect(primaryRun).resolves.toBeUndefined()

    expect(extractionCalls).toBe(1)
    expect(queryOne<{ status: string }>('SELECT status FROM KnowledgeJob WHERE id = ?', started.jobId)?.status).toBe('succeeded')
  })

  it('finishes ranged SQLite rebuilds without waiting for retrieval phases', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-rebuild-overlap-final-correctness')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_overlap_final_correctness')
    const aiSettings = createMockAISettings()
    const extractionGate = createDeferred<void>()
    const precomputeGate = createDeferred<void>()
    const events: string[] = []
    let extractionStarted = false
    let extractionFinished = false
    let precomputeStarted = false

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => aiSettings,
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap', () => ({
      runHanlpBootstrapForChapter: vi.fn(async (input: { chapterNo: number; rawText: string }) => ({
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
    vi.doMock('@/lib/server/context-builder', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/context-builder')>()
      return {
        ...actual,
        buildKnowledgeExtractionStoryState: vi.fn((params: { asOfChapter: number }) => {
          events.push(`story-state:${params.asOfChapter}`)
          return '# 已排序故事状态\n- 第 0 章之前暂无事实。'
        }),
      }
    })
    vi.doMock('@/lib/server/knowledge-extraction', () => ({
      extractChapterKnowledgeOffline: vi.fn(async () => {
        extractionStarted = true
        events.push('extract:start')
        await extractionGate.promise
        extractionFinished = true
        events.push('extract:finish')
        return {
          extraction: createMockExtraction(1),
          provider: 'ollama',
          model: aiSettings.knowledgeExtraction.ollama.model,
        }
      }),
    }))
    vi.doMock('@/lib/server/retrieval-index', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/retrieval-index')>()
      return {
        ...actual,
        precomputeRawTextEmbeddingCache: vi.fn(async (params: { chapterRange?: { startChapter?: number; endChapter?: number } }) => {
          precomputeStarted = true
          events.push('precompute:start')
          await precomputeGate.promise
          return {
            totalDocs: 1,
            completedDocs: 0,
            cacheHits: 0,
            cacheMisses: 1,
            failedDocs: 1,
            totalBatches: 1,
            completedBatches: 1,
            degraded: true,
            cancelled: false,
            durationMs: 0,
          }
        }),
        rebuildBranchRetrievalIndex: vi.fn(async () => {
          events.push('final-index:start')
          return { rowCount: 1, embeddingBatchCount: 1 }
        }),
      }
    })

    const { rebuildKnowledgeForNovel } = await import('@/lib/server/knowledge-rebuild')
    const rebuildPromise = rebuildKnowledgeForNovel({ novelId, chapterRange: { startChapter: 1, endChapter: 1 } })

    await waitForCondition(() => extractionStarted, 'extraction start')
    expect(extractionFinished).toBe(false)
    expect(precomputeStarted).toBe(false)

    extractionGate.resolve()
    await waitForCondition(() => extractionFinished, 'extraction completion before final index')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).not.toContain('final-index:start')
    expect(events).not.toContain('precompute:start')
    const waitingJob = queryOne<{ currentStep: string | null; payloadJson: string | null }>(
      'SELECT currentStep, payloadJson FROM KnowledgeJob WHERE novelId = ? AND branchId = ? ORDER BY createdAt DESC LIMIT 1',
      novelId,
      branchId,
    )
    const waitingPayload = waitingJob?.payloadJson ? JSON.parse(waitingJob.payloadJson) as { phase?: string } : null
    expect(waitingPayload?.phase).toBe('write')
    expect(waitingJob?.currentStep).toBe('完成')

    await expect(rebuildPromise).resolves.toMatchObject({ outcome: 'completed' })

    expect(events).toContain('extract:start')
    expect(events).toContain('story-state:0')
    expect(events).not.toContain('final-index:start')

    const chapter = queryOne<{ knowledgeStatus: string; isDirty: number }>(
      'SELECT knowledgeStatus, isDirty FROM KnowledgeChapter WHERE novelId = ? AND branchId = ? AND id = ?',
      novelId,
      branchId,
      'chapter-1',
    )
    expect(chapter).toMatchObject({ knowledgeStatus: 'ready', isDirty: 0 })

    const job = queryOne<{ status: string; payloadJson: string | null }>(
      'SELECT status, payloadJson FROM KnowledgeJob WHERE novelId = ? AND branchId = ? ORDER BY createdAt DESC LIMIT 1',
      novelId,
      branchId,
    )
    const payload = job?.payloadJson ? JSON.parse(job.payloadJson) as {
      rawTextEmbeddingProgress?: number
      rawTextEmbeddingCacheHitRate?: number
      stageTimingsMs?: Record<string, number>
    } : null

    expect(job?.status).toBe('succeeded')
    expect(payload?.rawTextEmbeddingProgress).toBeUndefined()
    expect(payload?.rawTextEmbeddingCacheHitRate).toBeUndefined()
    expect(payload?.stageTimingsMs?.raw_text_precompute).toBeUndefined()
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ?', branchId)?.count).toBe(0)
  })

  it('treats a resumed raw-embedding main job as already complete for SQLite purposes', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-rebuild-raw-embedding-resume')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_raw_embedding_resume')
    const aiSettings = createMockAISettings()
    const events: string[] = []
    const precomputeCalls: Array<{ chapterRange?: { startChapter?: number; endChapter?: number } }> = []

    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, progress, payloadJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'job_raw_embedding_resume',
      novelId,
      branchId,
      'extract_chapter_knowledge',
      'queued',
      '等待原文 Embedding 预计算完成',
      0.95,
      JSON.stringify({
        branchId,
        phase: 'raw-embedding',
        chapterRange: { startChapter: 1, endChapter: 1 },
        rebuildStartChapter: 1,
        pendingChapterIds: [],
        chapterWeightsById: {},
        totalChapterWeight: 0,
        processedChapterWeight: 0,
        extractedChapters: [],
        currentBatchChapters: [],
        totalChapterCount: 1,
        rawTextEmbeddingProgress: 0.25,
        rawTextEmbeddingPrecomputeCompleted: false,
        stageTimingsMs: {
          raw_text_precompute: 25,
        },
        embeddingSettingsSnapshot: {
          provider: 'ollama',
          model: 'snapshot-embedding-model',
          embeddingBatchSize: 1,
        },
      })
    )

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => aiSettings,
    }))
    vi.doMock('@/lib/server/retrieval-index', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/retrieval-index')>()
      return {
        ...actual,
        precomputeRawTextEmbeddingCache: vi.fn(async (params: { chapterRange?: { startChapter?: number; endChapter?: number } }) => {
          precomputeCalls.push(params)
          events.push('precompute:start')
          return {
            totalDocs: 1,
            completedDocs: 1,
            cacheHits: 1,
            cacheMisses: 0,
            failedDocs: 0,
            totalBatches: 1,
            completedBatches: 1,
            degraded: false,
            cancelled: false,
            durationMs: 1,
          }
        }),
        rebuildBranchRetrievalIndex: vi.fn(async () => {
          events.push('final-index:start')
          return { rowCount: 1, embeddingBatchCount: 0 }
        }),
      }
    })

    const { rebuildKnowledgeForNovel } = await import('@/lib/server/knowledge-rebuild')
    await expect(rebuildKnowledgeForNovel({
      novelId,
      jobId: 'job_raw_embedding_resume',
      chapterRange: { startChapter: 1, endChapter: 1 },
    })).resolves.toMatchObject({ outcome: 'completed' })

    expect(precomputeCalls).toHaveLength(0)
    expect(events).not.toContain('precompute:start')
    expect(events).not.toContain('final-index:start')
  })

  it('degrades gracefully after raw-text precompute retries are exhausted', async () => {
    vi.useFakeTimers()

    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-rebuild-overlap-degraded')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_degraded')
    const aiSettings = createMockAISettings()

    const embedTextsWithOllama = vi.fn(async () => {
      throw new Error('embedding backend unavailable')
    })

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => aiSettings,
    }))
    vi.doMock('@/lib/server/hanlp-bootstrap', () => ({
      runHanlpBootstrapForChapter: vi.fn(async (input: { chapterNo: number; rawText: string }) => ({
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
        extraction: createMockExtraction(1),
        provider: 'ollama',
        model: aiSettings.knowledgeExtraction.ollama.model,
      })),
    }))
    vi.doMock('@/lib/server/ollama-local', () => ({
      embedTextsWithOllama,
    }))
    vi.doMock('@/lib/server/retrieval-index', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/retrieval-index')>()
      return {
        ...actual,
        rebuildBranchRetrievalIndex: vi.fn(async () => ({ rowCount: 0, embeddingBatchCount: 0 })),
      }
    })

    const { rebuildKnowledgeForNovel } = await import('@/lib/server/knowledge-rebuild')
    const rebuildPromise = rebuildKnowledgeForNovel({ novelId })

    await vi.runAllTimersAsync()

    await expect(rebuildPromise).resolves.toMatchObject({ outcome: 'completed' })

    expect(embedTextsWithOllama).not.toHaveBeenCalled()

    const job = queryOne<{ status: string; payloadJson: string | null }>(
      'SELECT status, payloadJson FROM KnowledgeJob WHERE novelId = ? AND branchId = ? ORDER BY createdAt DESC LIMIT 1',
      novelId,
      branchId,
    )
    const payload = job?.payloadJson ? JSON.parse(job.payloadJson) as {
      rawTextEmbeddingProgress?: number
      rawTextEmbeddingCacheHitRate?: number
      stageTimingsMs?: Record<string, number>
    } : null

    expect(job?.status).toBe('succeeded')
    expect(payload?.rawTextEmbeddingProgress).toBeUndefined()
    expect(payload?.rawTextEmbeddingCacheHitRate).toBeUndefined()
    expect(payload?.stageTimingsMs?.raw_text_precompute).toBeUndefined()
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ?', branchId)?.count).toBe(0)
  })

})
