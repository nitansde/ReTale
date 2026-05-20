import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

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

describe('knowledge rebuild HanLP orchestration', () => {
  it('runs HanLP before extraction, records cache telemetry, and writes chapters in stable order', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-rebuild-hanlp-phase-order')
    const { novelId } = seedKnowledgeRebuildFixture(database, 'novel_hanlp_phase_order', 3)
    const aiSettings = createMockAISettings(3)
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
        buildKnowledgeExtractionStoryState: vi.fn((params: { asOfChapter: number }) => {
          events.push(`write:${params.asOfChapter + 1}`)
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

    await waitForCondition(() => events.includes('hanlp:init') && events.filter((event) => event.startsWith('extract:start:')).length === 3, 'extraction start after HanLP')
    expect(events.indexOf('hanlp:init')).toBeGreaterThan(events.indexOf('hanlp:end:3:runner'))
    expect(events.findIndex((event) => event.startsWith('extract:start:'))).toBeGreaterThan(events.indexOf('hanlp:init'))

    extractionGates.get(3)?.resolve()
    extractionGates.get(2)?.resolve()
    extractionGates.get(1)?.resolve()

    await expect(rebuildPromise).resolves.toMatchObject({ outcome: 'completed' })

    expect(hanlpRunnerCalls).toBe(2)
    expect(extractionCalls).toBe(3)
    expect(events.filter((event) => event.startsWith('write:')).slice(-3)).toEqual(['write:1', 'write:2', 'write:3'])

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
      'index',
    ])
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

  it('passes combined story-state and HanLP chapter context into extraction calls', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-rebuild-hanlp-prompt-context')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_hanlp_prompt_context', 2)
    const aiSettings = createMockAISettings(1)
    const extractionSpy = vi.fn(async (params: { chapterNo: number }) => ({
      extraction: createMockExtraction(params.chapterNo),
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
  })
})
