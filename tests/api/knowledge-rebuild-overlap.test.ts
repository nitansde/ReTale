import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'
import type { AISettings } from '@/lib/types'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }
const originalDatabaseUrl = process.env.DATABASE_URL

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

function seedKnowledgeRebuildFixture(database: DatabaseSync, novelKey = 'novel_overlap') {
  const novelId = `${novelKey}_${Math.random().toString(36).slice(2, 8)}`
  const branchId = `${novelId}:main`
  database.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run(novelId, 'Fixture Novel', 'txt')
  database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run(branchId, novelId, 'main')
  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-1', novelId, branchId, 1, '第1章', '第一段原文内容。', null, 1, 1, 'Needs rebuild', 'chapter-hash-1', 'stale')
  database.prepare('INSERT INTO ChapterLine (id, chapterId, lineNo, text, charStart, charEnd) VALUES (?, ?, ?, ?, ?, ?)')
    .run('line-1', 'chapter-1', 1, '第一段原文内容。', 0, 8)
  database.prepare(
    `INSERT INTO TextSpan (
      id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd,
      charStart, charEnd, text, spanType, tokenEstimate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('span-1', novelId, branchId, 'chapter-1', 1, 1, 1, 0, 8, '第一段原文内容。', 'paragraph', 8)
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
  vi.resetModules()
  vi.unmock('@/lib/server/ai-settings')
  vi.unmock('@/lib/server/knowledge-extraction')
  vi.unmock('@/lib/server/ollama-local')
  vi.unmock('@/lib/server/retrieval-index')

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

  it('starts raw-text precompute before extraction finishes', async () => {
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
    vi.doMock('@/lib/server/knowledge-extraction', () => ({
      extractChapterKnowledgeOffline: vi.fn(async () => {
        extractionStarted = true
        await extractionGate.promise
        extractionFinished = true
        return {
          extraction: {
            chapterNo: 1,
            summary: 'summary',
            characters: [],
            relations: [],
            events: [],
            worldbuilding: [],
            openThreads: [],
          },
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

    await waitForCondition(() => extractionStarted && precomputeStarted, 'extract/precompute overlap')
    expect(extractionFinished).toBe(false)

    extractionGate.resolve()
    embeddingGate.resolve()

    await expect(rebuildPromise).resolves.toMatchObject({ outcome: 'completed' })

    expect(embedTextsWithOllama).toHaveBeenCalledTimes(1)
    const payloadRow = queryOne<{ payloadJson: string | null }>('SELECT payloadJson FROM KnowledgeJob WHERE novelId = ?', novelId)
    const payload = payloadRow?.payloadJson ? JSON.parse(payloadRow.payloadJson) as { rawTextEmbeddingProgress?: number; stageTimingsMs?: Record<string, number> } : null
    expect(payload?.rawTextEmbeddingProgress).toBe(1)
    expect(payload?.stageTimingsMs?.raw_text_precompute).toEqual(expect.any(Number))
  })

  it('preserves overlap and final rebuild correctness', async () => {
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
          extraction: {
            chapterNo: 1,
            summary: 'summary',
            characters: [],
            relations: [],
            events: [],
            worldbuilding: [],
            openThreads: [],
          },
          provider: 'ollama',
          model: aiSettings.knowledgeExtraction.ollama.model,
        }
      }),
    }))
    vi.doMock('@/lib/server/retrieval-index', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/retrieval-index')>()
      return {
        ...actual,
        precomputeRawTextEmbeddingCache: vi.fn(async () => {
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
    const rebuildPromise = rebuildKnowledgeForNovel({ novelId })

    await waitForCondition(() => extractionStarted && precomputeStarted, 'extract/precompute overlap')
    expect(extractionFinished).toBe(false)

    extractionGate.resolve()
    await waitForCondition(() => extractionFinished, 'extraction completion before final index')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).not.toContain('final-index:start')

    precomputeGate.resolve()

    await expect(rebuildPromise).resolves.toMatchObject({ outcome: 'completed' })

    expect(events).toContain('precompute:start')
    expect(events).toContain('extract:start')
    expect(events.indexOf('story-state:0')).toBeGreaterThan(events.indexOf('extract:finish'))
    expect(events.indexOf('final-index:start')).toBeGreaterThan(events.indexOf('story-state:0'))

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
    expect(payload?.rawTextEmbeddingProgress).toBe(0)
    expect(payload?.rawTextEmbeddingCacheHitRate).toBe(0)
    expect(payload?.stageTimingsMs?.raw_text_precompute).toEqual(expect.any(Number))
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ?', branchId)?.count).toBe(0)
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
    vi.doMock('@/lib/server/knowledge-extraction', () => ({
      extractChapterKnowledgeOffline: vi.fn(async () => ({
        extraction: {
          chapterNo: 1,
          summary: 'summary',
          characters: [],
          relations: [],
          events: [],
          worldbuilding: [],
          openThreads: [],
        },
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

    expect(embedTextsWithOllama).toHaveBeenCalledTimes(3)

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
    expect(payload?.rawTextEmbeddingProgress).toBe(0)
    expect(payload?.rawTextEmbeddingCacheHitRate).toBe(0)
    expect(payload?.stageTimingsMs?.raw_text_precompute).toEqual(expect.any(Number))
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ?', branchId)?.count).toBe(0)
  })
})
