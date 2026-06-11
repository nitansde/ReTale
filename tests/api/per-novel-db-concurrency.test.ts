import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'

const cleanupDirectories: string[] = []
const cleanupDatabases: DatabaseSync[] = []
const originalDataDir = process.env.RETALE_DATA_DIR
const API_TEST_TIMEOUT_MS = 30_000
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }

vi.setConfig({ testTimeout: API_TEST_TIMEOUT_MS, hookTimeout: API_TEST_TIMEOUT_MS })

function restoreEnvVar(name: 'RETALE_DATA_DIR', originalValue: string | undefined) {
  if (originalValue === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = originalValue
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

async function waitForCondition(check: () => boolean, label: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(`Timed out waiting for ${label}`)
}

function getDatabaseFilePath(database: DatabaseSync) {
  return (database.prepare('PRAGMA database_list').get() as { file: string }).file
}

function getBranchRetrievalTableBaseName(branchId: string) {
  return `retrieval_docs_${createHash('sha256').update(branchId).digest('hex').slice(0, 16)}`
}

function openSecondaryDatabase(dbFilePath: string) {
  const database = new DatabaseSync(dbFilePath)
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA busy_timeout = 5000')
  cleanupDatabases.push(database)
  return database
}

function seedNovel(database: DatabaseSync, novelId: string, title: string) {
  const branchId = `${novelId}:main`
  database.prepare('INSERT OR IGNORE INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run(novelId, title, 'workspace')
  database.prepare('INSERT OR IGNORE INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run(branchId, novelId, 'main')
  return { novelId, branchId }
}

function seedKnowledgeRebuildFixture(database: DatabaseSync, novelId: string, chapterCount = 1) {
  const { branchId } = seedNovel(database, novelId, `${novelId} title`)
  const insertChapter = database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertLine = database.prepare(
    'INSERT INTO ChapterLine (id, chapterId, lineNo, text, charStart, charEnd) VALUES (?, ?, ?, ?, ?, ?)'
  )
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

function buildWorkspaceRuntimePayload(novelId: string, chapterContent: string) {
  return {
    currentNovelId: novelId,
    currentChapterId: `${novelId}-chapter-1`,
    localNovels: [
      {
        id: novelId,
        title: `${novelId} runtime`,
        summary: '',
        tags: [],
      },
    ],
    localVolumes: [
      {
        id: `${novelId}-volume-1`,
        novelId,
        title: '第一卷',
        order: 1,
      },
    ],
    localChapters: [
      {
        id: `${novelId}-chapter-1`,
        novelId,
        volumeId: `${novelId}-volume-1`,
        title: '第一章',
        order: 1,
        content: `<p>${chapterContent}</p>`,
        originalContent: `<p>${chapterContent}</p>`,
        status: 'draft',
        wordCount: chapterContent.length,
        updatedAt: '刚刚',
      },
    ],
  }
}

async function persistRuntimePayload(payload: Record<string, unknown>, db?: unknown) {
  const { normalizeWorkspaceState } = await import('@/lib/workspace-state')
  const { persistWorkspaceRuntimeState } = await import('@/lib/server/workspace-resilience')
  return persistWorkspaceRuntimeState(normalizeWorkspaceState(payload), 'singleton', db as never)
}

function insertRecoverableRewriteJob(database: DatabaseSync, novelId: string, branchId: string, jobId = 'job-rewrite') {
  database.prepare(
    `INSERT INTO KnowledgeJob (
      id, novelId, branchId, jobType, status, progress, currentStep, payloadJson
    ) VALUES (?, ?, ?, 'rewrite_generation', 'running', ?, ?, ?)`
  ).run(
    jobId,
    novelId,
    branchId,
    0.2,
    'streaming',
    JSON.stringify({
      request: { mode: 'rewrite' },
      panel: {
        novelId,
        branchId,
        chapterId: 'chapter-1',
        selectedText: '旧内容',
        sourceText: '旧内容',
        sourceTextOverride: null,
        userInstruction: '增强张力',
        rewriteLaunchSource: 'chapter',
        branchContextNodeId: null,
        branchContextInclusion: null,
        continueBlockId: null,
        createdAt: new Date().toISOString(),
      },
      result: {
        provider: 'openai-compatible',
        title: '旧结果',
        summary: '旧摘要',
        content: '旧改写结果',
        inputTokens: 11,
        outputTokens: 22,
        metadata: null,
        presetCompat: null,
      },
    })
  )
}

function insertKnowledgeJob(database: DatabaseSync, novelId: string, branchId: string, jobId = 'job-knowledge') {
  database.prepare(
    `INSERT INTO KnowledgeJob (
      id, novelId, branchId, jobType, status, progress, currentStep, payloadJson
    ) VALUES (?, ?, ?, 'extract_chapter_knowledge', 'running', ?, ?, ?)`
  ).run(jobId, novelId, branchId, 0.4, 'extracting', JSON.stringify({ branchId, phase: 'extract' }))
}

function createMockAISettings() {
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
      embeddingBatchSize: 16,
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
    },
  }
}

function createMockRetrievalDatabase() {
  type StoredRow = Record<string, unknown>
  type MockTable = {
    rows: StoredRow[]
    createIndex: (column: string, options?: unknown) => Promise<void>
    waitForIndex: (names: string[], timeout?: number) => Promise<void>
    add: (rows: StoredRow[]) => Promise<void>
    delete: (predicate: string) => Promise<void>
    query: () => {
      where: (predicate: string) => {
        fullTextSearch: (query: string) => {
          withRowId: () => {
            limit: (value: number) => {
              toArray: () => Promise<StoredRow[]>
            }
          }
        }
        nearestTo: (vector: unknown) => {
          nprobes: (value: number) => {
            column: (column: string) => {
              withRowId: () => {
                limit: (value: number) => {
                  toArray: () => Promise<StoredRow[]>
                }
              }
            }
          }
        }
      }
      limit: (value: number) => {
        toArray: () => Promise<StoredRow[]>
      }
    }
  }

  const tokenizePredicate = (predicate: string) => {
    const matches = predicate.match(/\(|\)|<=|>=|!=|=|<|>|\bAND\b|\bOR\b|'[^']*'|-?\d+|\w+/gu)
    return matches ?? []
  }

  const rowMatchesClause = (row: StoredRow, field: string, operator: string, rawValue: string) => {
    const rowValue = row[field]
    if (rawValue.startsWith("'")) {
      const expectedValue = rawValue.slice(1, -1)
      if (operator === '=') return rowValue === expectedValue
      if (operator === '!=') return rowValue !== expectedValue
      return false
    }

    const numericRowValue = Number(rowValue)
    const expectedValue = Number(rawValue)
    if (!Number.isFinite(numericRowValue) || !Number.isFinite(expectedValue)) {
      return false
    }

    if (operator === '<=') return numericRowValue <= expectedValue
    if (operator === '>=') return numericRowValue >= expectedValue
    if (operator === '<') return numericRowValue < expectedValue
    if (operator === '>') return numericRowValue > expectedValue
    if (operator === '!=') return numericRowValue !== expectedValue
    return numericRowValue === expectedValue
  }

  const rowMatchesPredicate = (row: StoredRow, predicate: string) => {
    const tokens = tokenizePredicate(predicate)
    let index = 0

    const parseExpression = (): boolean => {
      let value = parseTerm()
      while (tokens[index] === 'OR') {
        index += 1
        value = value || parseTerm()
      }
      return value
    }

    const parseTerm = (): boolean => {
      let value = parseFactor()
      while (tokens[index] === 'AND') {
        index += 1
        value = value && parseFactor()
      }
      return value
    }

    const parseFactor = (): boolean => {
      if (tokens[index] === '(') {
        index += 1
        const value = parseExpression()
        index += 1
        return value
      }

      const field = tokens[index]
      const operator = tokens[index + 1]
      const rawValue = tokens[index + 2]
      index += 3
      return rowMatchesClause(row, field!, operator!, rawValue!)
    }

    return parseExpression()
  }

  const tables = new Map<string, MockTable>()
  const createIndexGate = createDeferred<void>()
  let blockNextPendingTextIndex = false
  let pendingTextIndexStarted = false

  const createTableInstance = (name: string, initialRows: StoredRow[]) => {
    const table: MockTable = {
      rows: [...initialRows],
      createIndex: async (column: string) => {
        if (blockNextPendingTextIndex && column === 'text' && name.includes('retrieval_docs_')) {
          blockNextPendingTextIndex = false
          pendingTextIndexStarted = true
          await createIndexGate.promise
        }
      },
      waitForIndex: async () => undefined,
      add: async (nextRows: StoredRow[]) => {
        table.rows.push(...nextRows)
      },
      delete: async (predicate: string) => {
        table.rows = table.rows.filter((row) => !rowMatchesPredicate(row, predicate))
      },
      query: () => ({
        where: (predicate: string) => {
          void predicate
          const filteredRows = table.rows.slice()
          return {
            fullTextSearch: (_query: string) => ({
              withRowId: () => ({
                limit: (value: number) => ({
                  toArray: async () => filteredRows.slice(0, value).map((row, index) => ({ ...row, _score: value - index })),
                }),
              }),
            }),
            nearestTo: (_vector: unknown) => ({
              nprobes: (_value: number) => ({
                column: (_column: string) => ({
                  withRowId: () => ({
                    limit: (value: number) => ({
                      toArray: async () => filteredRows.slice(0, value).map((row) => ({ ...row, _distance: 0.1 })),
                    }),
                  }),
                }),
              }),
            }),
          }
        },
        limit: (value: number) => ({
          toArray: async () => table.rows.slice(0, value),
        }),
      }),
    }
    return table
  }

  const database = {
    tableNames: async () => Array.from(tables.keys()),
    createTable: async (name: string, rows: StoredRow[]) => {
      const table = createTableInstance(name, rows)
      tables.set(name, table)
      return table
    },
    openTable: async (name: string) => tables.get(name) ?? null,
    dropTable: async (name: string) => {
      tables.delete(name)
    },
  }

  return {
    database,
    tables,
    createIndexGate,
    get pendingTextIndexStarted() {
      return pendingTextIndexStarted
    },
    blockNextPendingTextIndex() {
      blockNextPendingTextIndex = true
      pendingTextIndexStarted = false
    },
  }
}

async function createNovelDatabases(prefix: string) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  cleanupDirectories.push(tempRoot)
  process.env.RETALE_DATA_DIR = path.join(tempRoot, 'data')
  vi.resetModules()

  const resolverModule = await import('@/lib/server/db-resolver')
  const accessModule = await import('@/lib/server/database-access')
  const gateModule = await import('@/lib/server/per-novel-write-gate')

  const alphaRawDb = resolverModule.getNovelDb('novel-alpha')
  const betaRawDb = resolverModule.getNovelDb('novel-beta')
  seedNovel(alphaRawDb, 'novel-alpha', 'Alpha')
  seedNovel(betaRawDb, 'novel-beta', 'Beta')

  return {
    alphaRawDb,
    betaRawDb,
    alphaDbFilePath: getDatabaseFilePath(alphaRawDb),
    betaDbFilePath: getDatabaseFilePath(betaRawDb),
    createDatabaseAccess: accessModule.createDatabaseAccess,
    createNovelDatabaseAccess: accessModule.createNovelDatabaseAccess,
    getNovelDb: resolverModule.getNovelDb,
    withPerNovelWriteTransaction: accessModule.withPerNovelWriteTransaction,
    runWithPerNovelWriteGate: gateModule.runWithPerNovelWriteGate,
  }
}

afterEach(async () => {
  restoreEnvVar('RETALE_DATA_DIR', originalDataDir)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.unmock('@/lib/server/ai-settings')
  vi.unmock('@/lib/server/hanlp-bootstrap')
  vi.unmock('@/lib/server/hanlp-bootstrap-initializer')
  vi.unmock('@/lib/server/knowledge-extraction')
  vi.unmock('@/lib/server/db-resolver')
  vi.unmock('@/lib/server/retrieval-index')
  vi.unmock('@/lib/server/retrieval-runtime')
  vi.unmock('@/lib/server/ollama-local')
  vi.unmock('@/lib/server/openai-compatible')
  vi.unmock('@lancedb/lancedb')
  vi.doUnmock('@/lib/server/db-resolver')
  try {
    const resolverModule = await import('@/lib/server/db-resolver')
    resolverModule.resetResolvedDatabasesForTests()
  } catch (_resolverResetError) {
    void _resolverResetError
    // Ignore resolver reset import failures during test cleanup fallback.
  }
  try {
    const gateModule = await import('@/lib/server/per-novel-write-gate')
    gateModule.resetPerNovelWriteGatesForTests()
  } catch (_gateResetError) {
    void _gateResetError
    // Ignore gate reset import failures during test cleanup fallback.
  }
  vi.restoreAllMocks()
  delete globalForSqlite.sqlite
  vi.resetModules()

  while (cleanupDatabases.length > 0) {
    const database = cleanupDatabases.pop()
    if (database) {
      try {
        ;(database as DatabaseSync & { close?: () => void }).close?.()
      } catch (_closeError) {
        void _closeError
        // Ignore secondary sqlite close failures so temp cleanup can continue.
      }
    }
  }

  while (cleanupDirectories.length > 0) {
    const directory = cleanupDirectories.pop()
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe('per-novel database concurrency matrix', () => {
  it('keeps the active graph queryable and preserves chapter saves while rebuild compute is running', async () => {
    const { getNovelDb } = await createNovelDatabases('retale-per-novel-compute-overlap')
    const computeRawDb = getNovelDb('novel-compute-overlap')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(computeRawDb, 'novel-compute-overlap', 1)
    const aiSettings = createMockAISettings()
    const extractionGate = createDeferred<void>()
    let extractionStarted = false

    computeRawDb.prepare(
      `INSERT INTO KnowledgeEntity (id, novelId, branchId, canonicalName, entityType, firstSeenChapter, lastSeenChapter, importanceTier, userConfirmed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('entity-main-overlap', novelId, branchId, '主角', 'character', 1, 1, 'protagonist', 0)
    computeRawDb.prepare(
      `INSERT INTO EntityState (
        id, novelId, branchId, entityId, stateType, stateValue, description,
        sourceChapter, validFromChapter, validUntilChapter, confidence, status, includeByDefault
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('state-main-overlap', novelId, branchId, 'entity-main-overlap', 'location', '城门', '旧图谱状态', 1, 1, 999999, 0.9, 'ai_generated', 1)

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
        extractionStarted = true
        await extractionGate.promise
        return {
          extraction: {
            chapterNo: 1,
            summary: 'summary-1',
            characters: [],
            knownCharacterUpdates: [],
            unknownCharacterObservations: [],
            aliasDiscoveries: [],
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
    vi.doMock('@/lib/server/retrieval-index', async () => {
      const actual = await vi.importActual<typeof import('@/lib/server/retrieval-index')>('@/lib/server/retrieval-index')
      return {
        ...actual,
        rebuildBranchRetrievalIndex: vi.fn(async () => ({ rowCount: 0, embeddingBatchCount: 0 })),
      }
    })

    const { startKnowledgeRebuildForNovel, runStartedKnowledgeRebuildForNovel } = await import('@/lib/server/knowledge-rebuild')
    const started = await startKnowledgeRebuildForNovel({ novelId, branchId })
    const runPromise = runStartedKnowledgeRebuildForNovel({ novelId, branchId, jobId: started.jobId })

    await waitForCondition(() => extractionStarted, 'knowledge rebuild compute start')
    expect(computeRawDb.prepare(
      `SELECT COUNT(*) AS count
       FROM EntityState
       WHERE novelId = ? AND branchId = ? AND status NOT IN ('rejected', 'outdated', 'potentially_stale')`
    ).get(novelId, branchId)).toMatchObject({ count: 1 })

    const updatedRawText = '重建期间保存的新章节正文。'
    computeRawDb.prepare(
      `UPDATE KnowledgeChapter
       SET rawText = ?, sourceHash = ?, revision = revision + 1, isDirty = 1, dirtyReason = 'Saved during rebuild', updatedAt = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(updatedRawText, 'hash-saved-during-rebuild', 'chapter-1')

    extractionGate.resolve()
    await expect(runPromise).resolves.toBeUndefined()
    expect(computeRawDb.prepare('SELECT rawText, knowledgeStatus FROM KnowledgeChapter WHERE id = ?').get('chapter-1')).toMatchObject({
      rawText: updatedRawText,
      knowledgeStatus: 'stale',
    })
    expect(computeRawDb.prepare(
      `SELECT COUNT(*) AS count
       FROM EntityState
       WHERE novelId = ? AND branchId = ? AND status NOT IN ('rejected', 'outdated', 'potentially_stale')`
    ).get(novelId, branchId)).toMatchObject({ count: 1 })
    expect(computeRawDb.prepare('SELECT status FROM KnowledgeJob WHERE id = ?').get(started.jobId)).toMatchObject({ status: 'succeeded' })
  })

  it('queues chapter saves behind the same-novel publish transaction and preserves both changes', async () => {
    const { createNovelDatabaseAccess, getNovelDb, withPerNovelWriteTransaction } = await createNovelDatabases('retale-per-novel-publish-vs-save')
    const publishRawDb = getNovelDb('novel-publish-save')
    seedKnowledgeRebuildFixture(publishRawDb, 'novel-publish-save', 1)
    const alphaDb = createNovelDatabaseAccess('novel-publish-save')
    const publishRelease = createDeferred<void>()
    const publishEntered = createDeferred<void>()
    let saveEntered = false

    const publishPromise = withPerNovelWriteTransaction({
      novelId: 'novel-publish-save',
      execute: alphaDb.execute,
      callback: async () => {
        alphaDb.execute(
          `UPDATE KnowledgeChapter
           SET summary = ?, knowledgeStatus = ?, updatedAt = CURRENT_TIMESTAMP
           WHERE id = ?`,
          '发布事务写入的章节摘要',
          'ready',
          'chapter-1',
        )
        publishEntered.resolve()
        await publishRelease.promise
      },
    })

    await publishEntered.promise

    const savePromise = alphaDb.withTransaction(async () => {
      saveEntered = true
      alphaDb.execute(
        `UPDATE KnowledgeChapter
         SET rawText = ?, sourceHash = ?, revision = revision + 1, updatedAt = CURRENT_TIMESTAMP
         WHERE id = ?`,
        '发布期间保存的章节正文',
        'hash-publish-save',
        'chapter-1',
      )
    })

    await Promise.resolve()
    expect(saveEntered).toBe(false)
    expect(publishRawDb.prepare('SELECT rawText FROM KnowledgeChapter WHERE id = ?').get('chapter-1')).toMatchObject({ rawText: '第1章原文内容。' })

    publishRelease.resolve()
    await expect(publishPromise).resolves.toBeUndefined()
    await expect(savePromise).resolves.toBeUndefined()
    expect(saveEntered).toBe(true)
    expect(publishRawDb.prepare('SELECT summary, knowledgeStatus FROM KnowledgeChapter WHERE id = ?').get('chapter-1')).toMatchObject({
      summary: '发布事务写入的章节摘要',
      knowledgeStatus: 'ready',
    })
    expect(publishRawDb.prepare('SELECT rawText FROM KnowledgeChapter WHERE id = ?').get('chapter-1')).toMatchObject({ rawText: '发布期间保存的章节正文' })
  })

  it('serializes continue-block writes with chapter saves and preserves both datasets', async () => {
    const { alphaRawDb, createNovelDatabaseAccess } = await createNovelDatabases('retale-per-novel-continue-vs-save')
    const alphaDb = createNovelDatabaseAccess('novel-alpha')
    const saveRelease = createDeferred<void>()
    const saveEntered = createDeferred<void>()

    const pausedSaveDb = {
      ...alphaDb,
      withTransaction: async <T>(callback: () => T | Promise<T>) => alphaDb.withTransaction(async () => {
        saveEntered.resolve()
        await saveRelease.promise
        return callback()
      }),
    }

    const savePromise = persistRuntimePayload(buildWorkspaceRuntimePayload('novel-alpha', '续写并发保存正文'), pausedSaveDb)
    await saveEntered.promise

    const { createContinueBlockFromRewrite } = await import('@/lib/server/continue-block-service')
    const continuePromise = createContinueBlockFromRewrite({
      novelId: 'novel-alpha',
      branchId: 'novel-alpha:main',
      parentTimelineNodeId: null,
      sourceChapterNo: 1,
      titleHint: '分支标题',
      subtitleHint: '分支副标题',
      userInstruction: '让冲突升级',
      selectedText: '原文片段',
      originalText: '原文片段',
      generatedText: '续写后的文本',
      inputTokens: 12,
      outputTokens: 34,
    })

    await Promise.resolve()
    expect(alphaRawDb.prepare('SELECT COUNT(*) AS count FROM continue_blocks').get()).toMatchObject({ count: 0 })
    expect(alphaRawDb.prepare('SELECT COUNT(*) AS count FROM story_timeline_nodes').get()).toMatchObject({ count: 0 })

    saveRelease.resolve()
    await expect(savePromise).resolves.toMatchObject({ updatedAt: expect.any(String) })
    await expect(continuePromise).resolves.toMatchObject({
      continueBlockId: expect.any(String),
      timelineNodeId: expect.any(String),
    })

    expect(alphaRawDb.prepare('SELECT COUNT(*) AS count FROM continue_blocks').get()).toMatchObject({ count: 1 })
    expect(alphaRawDb.prepare('SELECT COUNT(*) AS count FROM continue_block_revisions').get()).toMatchObject({ count: 1 })
    expect(alphaRawDb.prepare('SELECT COUNT(*) AS count FROM story_timeline_nodes').get()).toMatchObject({ count: 1 })
    expect(alphaRawDb.prepare('SELECT contentHtml FROM WorkspaceRuntimeChapter WHERE workspaceStateId = ? AND id = ?').get('singleton', 'novel-alpha-chapter-1')).toMatchObject({
      contentHtml: '<p>续写并发保存正文</p>',
    })
  })

  it('serializes rewrite checkpoints with knowledge job updates without clobbering unrelated payloads', async () => {
    const { alphaRawDb, createNovelDatabaseAccess, runWithPerNovelWriteGate } = await createNovelDatabases('retale-per-novel-rewrite-vs-job-update')
    const alphaDb = createNovelDatabaseAccess('novel-alpha')
    insertRecoverableRewriteJob(alphaRawDb, 'novel-alpha', 'novel-alpha:main')
    insertKnowledgeJob(alphaRawDb, 'novel-alpha', 'novel-alpha:main')

    const rewriteRelease = createDeferred<void>()
    const rewriteEntered = createDeferred<void>()
    let knowledgeUpdateEntered = false
    const { updateRecoverableRewriteJob } = await import('@/lib/server/recoverable-rewrite-jobs')

    const rewriteCheckpointPromise = runWithPerNovelWriteGate('novel-alpha', async () => {
      rewriteEntered.resolve()
      await rewriteRelease.promise
      updateRecoverableRewriteJob('job-rewrite', {
        status: 'running',
        progress: 0.65,
        currentStep: 'rewrite checkpoint',
        payload: {
          request: { mode: 'rewrite' },
          panel: {
            novelId: 'novel-alpha',
            branchId: 'novel-alpha:main',
            chapterId: 'chapter-1',
            selectedText: '旧内容',
            sourceText: '旧内容',
            sourceTextOverride: null,
            userInstruction: '增强张力',
            rewriteLaunchSource: 'chapter',
            branchContextNodeId: null,
            branchContextInclusion: null,
            continueBlockId: null,
            createdAt: new Date().toISOString(),
          },
          result: {
            provider: 'openai-compatible',
            title: '新结果',
            summary: '新摘要',
            content: '新的可恢复改写结果',
            inputTokens: 101,
            outputTokens: 202,
            metadata: null,
            presetCompat: null,
          },
        },
        db: alphaDb,
      })
    })

    await rewriteEntered.promise

    const knowledgeUpdatePromise = runWithPerNovelWriteGate('novel-alpha', async () => {
      knowledgeUpdateEntered = true
      alphaDb.execute(
        'UPDATE KnowledgeJob SET currentStep = ?, payloadJson = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
        'knowledge write step',
        JSON.stringify({ branchId: 'novel-alpha:main', phase: 'write', preserved: true }),
        'job-knowledge',
      )
    })

    await Promise.resolve()
    expect(knowledgeUpdateEntered).toBe(false)
    expect(alphaRawDb.prepare('SELECT currentStep FROM KnowledgeJob WHERE id = ?').get('job-knowledge')).toMatchObject({ currentStep: 'extracting' })
    expect(alphaRawDb.prepare('SELECT currentStep FROM KnowledgeJob WHERE id = ?').get('job-rewrite')).toMatchObject({ currentStep: 'streaming' })

    rewriteRelease.resolve()
    await expect(rewriteCheckpointPromise).resolves.toBeUndefined()
    await expect(knowledgeUpdatePromise).resolves.toBeUndefined()
    expect(knowledgeUpdateEntered).toBe(true)

    const rewriteRow = alphaRawDb.prepare('SELECT currentStep, payloadJson FROM KnowledgeJob WHERE id = ?').get('job-rewrite') as { currentStep: string; payloadJson: string }
    const rewritePayload = JSON.parse(rewriteRow.payloadJson) as { result?: { content?: string } }
    const knowledgeRow = alphaRawDb.prepare('SELECT currentStep, payloadJson FROM KnowledgeJob WHERE id = ?').get('job-knowledge') as { currentStep: string; payloadJson: string }
    const knowledgePayload = JSON.parse(knowledgeRow.payloadJson) as { phase?: string; preserved?: boolean }

    expect(rewriteRow.currentStep).toBe('rewrite checkpoint')
    expect(rewritePayload.result?.content).toBe('新的可恢复改写结果')
    expect(knowledgeRow.currentStep).toBe('knowledge write step')
    expect(knowledgePayload).toMatchObject({ phase: 'write', preserved: true })
  })

  it('serves the active retrieval index while rebuild writes a pending table and promotes atomically', async () => {
    await createNovelDatabases('retale-per-novel-retrieval-overlap')
    const novelId = 'novel-alpha'
    const branchId = 'novel-alpha:main'
    const activeTableBaseName = getBranchRetrievalTableBaseName(branchId)
    const activeTableName = `${activeTableBaseName}_active`
    const pendingTableName = `${activeTableBaseName}_pending`
    const mockRetrievalDb = createMockRetrievalDatabase()
    const connectLanceDb = vi.fn(async () => mockRetrievalDb.database)
    const promoteRelease = createDeferred<void>()
    const pendingTableReady = createDeferred<void>()

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => createMockAISettings(),
    }))
    vi.doMock('@/lib/server/ollama-local', () => ({
      embedTextsWithOllama: vi.fn(async (input: string | string[]) => {
        const values = Array.isArray(input) ? input : [input]
        return {
          enabled: true,
          embeddings: values.map((value) => [value.length, value.length / 10, 1]),
          model: 'per-novel-concurrency-embedding-model',
        }
      }),
    }))
    vi.doMock('@/lib/server/openai-compatible', () => ({
      embedTextsWithOpenAICompatible: vi.fn(async (input: string | string[]) => {
        const values = Array.isArray(input) ? input : [input]
        return {
          enabled: true,
          embeddings: values.map((value) => [value.length, value.length / 10, 1]),
          model: 'per-novel-concurrency-openai-embedding-model',
        }
      }),
    }))
    vi.doMock('@lancedb/lancedb', () => ({
      connect: connectLanceDb,
      Index: {
        fts: () => ({ kind: 'fts' }),
        ivfFlat: (config: unknown) => ({ kind: 'ivfFlat', config }),
      },
    }))

    vi.doUnmock('@/lib/server/retrieval-index')
    vi.resetModules()
    const retrievalIndex = await import('@/lib/server/retrieval-index')
    const resolverModule = await import('@/lib/server/db-resolver')
    const retrievalRawDb = resolverModule.getNovelDb(novelId)
    globalForSqlite.sqlite = retrievalRawDb
    seedNovel(retrievalRawDb, novelId, 'Fixture Novel')
    retrievalRawDb.prepare(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, summary,
        revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('chapter-1', novelId, branchId, 1, '第1章', '第1章原文', '第1章摘要', 1, 0, null, 'hash-1', 'ready')
    const insertTextSpan = retrievalRawDb.prepare(
      `INSERT INTO TextSpan (
        id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd,
        charStart, charEnd, text, spanType, tokenEstimate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    insertTextSpan.run('span-1', novelId, branchId, 'chapter-1', 1, 1, 1, 0, 9, '第一段原文内容。', 'paragraph', 8)
    insertTextSpan.run('span-2', novelId, branchId, 'chapter-1', 1, 2, 2, 10, 19, '第二段原文内容。', 'paragraph', 8)
    insertTextSpan.run('span-3', novelId, branchId, 'chapter-1', 1, 3, 4, 20, 39, '场景证据原文内容。', 'scene', 12)

    await mockRetrievalDb.database.createTable(activeTableName, [
      {
        id: 'span-1',
        branchId,
        sourceType: 'text_span',
        sourceId: 'span-1',
        chapterId: 'chapter-1',
        chapterNo: 1,
        validFromChapter: 1,
        validUntilChapter: 999999,
        lineStart: 1,
        lineEnd: 1,
        spanType: 'paragraph',
        title: '第1章',
        sourceLabel: '当前激活检索表',
        relatedEntityNames: '',
        relatedEventNames: '',
        relatedTerms: '',
        text: '第一段原文内容。',
        status: 'ready',
        includeByDefault: 1,
        tokenEstimate: 8,
        contentHash: 'active-hash-1',
        vector: [1, 0.1, 1],
        embeddingProvider: 'ollama',
        embeddingModel: 'embedding-model',
        embeddingDimension: 3,
      },
    ])
    retrievalRawDb.prepare(
      `INSERT INTO ActiveRetrievalIndex (
        branchId, scopeKey, tableName, scopeStartChapter, scopeEndChapter, updatedAt
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(branchId, 'full', activeTableName, null, null)

    const initialActiveRow = retrievalRawDb.prepare(
      'SELECT tableName FROM ActiveRetrievalIndex WHERE branchId = ? AND scopeKey = ?'
    ).get(branchId, 'full') as { tableName: string }
    expect(initialActiveRow.tableName).toBeTruthy()
    expect(initialActiveRow.tableName).toBe(activeTableName)

    retrievalRawDb.prepare('UPDATE TextSpan SET text = ? WHERE id = ?').run('新的检索正文内容。', 'span-1')

    const rebuildPromise = (async () => {
      await mockRetrievalDb.database.createTable(pendingTableName, [
        {
          id: 'span-1',
          branchId,
          sourceType: 'text_span',
          sourceId: 'span-1',
          chapterId: 'chapter-1',
          chapterNo: 1,
          validFromChapter: 1,
          validUntilChapter: 999999,
          lineStart: 1,
          lineEnd: 1,
          spanType: 'paragraph',
          title: '第1章',
          sourceLabel: '新检索表',
          relatedEntityNames: '',
          relatedEventNames: '',
          relatedTerms: '',
          text: '新的检索正文内容。',
          status: 'ready',
          includeByDefault: 1,
          tokenEstimate: 8,
          contentHash: 'pending-hash-1',
          vector: [2, 0.2, 1],
          embeddingProvider: 'ollama',
          embeddingModel: 'embedding-model',
          embeddingDimension: 3,
        },
      ])
      retrievalRawDb.prepare(
        `INSERT INTO PendingRetrievalIndex (
          branchId, scopeKey, tableName, phase, rowCount, textIndexCompleted, vectorIndexCompleted, rebuildFingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(branchId, 'full', pendingTableName, 'building_text_index', 1, 0, 0, 'pending-fingerprint')
      pendingTableReady.resolve()
      await promoteRelease.promise
      retrievalRawDb.prepare(
        `UPDATE ActiveRetrievalIndex
         SET tableName = ?, updatedAt = CURRENT_TIMESTAMP
         WHERE branchId = ? AND scopeKey = ?`
      ).run(pendingTableName, branchId, 'full')
      retrievalRawDb.prepare('DELETE FROM PendingRetrievalIndex WHERE branchId = ? AND scopeKey = ?').run(branchId, 'full')
    })()
    await pendingTableReady.promise

    const pendingRow = retrievalRawDb.prepare(
      'SELECT tableName, phase FROM PendingRetrievalIndex WHERE branchId = ? AND scopeKey = ?'
    ).get(branchId, 'full') as { tableName: string; phase: string }
    const stillActiveRow = retrievalRawDb.prepare(
      'SELECT tableName FROM ActiveRetrievalIndex WHERE branchId = ? AND scopeKey = ?'
    ).get(branchId, 'full') as { tableName: string }

    expect(pendingRow.tableName).toBeTruthy()
    expect(pendingRow.phase).toBe('building_text_index')
    expect(stillActiveRow.tableName).toBe(initialActiveRow.tableName)
    expect(pendingRow.tableName).not.toBe(initialActiveRow.tableName)

    const runningSearch = await retrievalIndex.searchLanceEvidence({
      novelId,
      branchId,
      maxChapterNo: 1,
      query: '第一段原文内容',
      queryTerms: ['第一段原文内容'],
      graphTerms: [],
      limit: 5,
    })
    expect(runningSearch.warning).toBeUndefined()
    expect(runningSearch.matches.some((match) => match.text === '第一段原文内容。')).toBe(true)
    expect(runningSearch.matches.some((match) => match.text === '新的检索正文内容。')).toBe(false)

    promoteRelease.resolve()
    await expect(rebuildPromise).resolves.toBeUndefined()

    const promotedActiveRow = retrievalRawDb.prepare(
      'SELECT tableName FROM ActiveRetrievalIndex WHERE branchId = ? AND scopeKey = ?'
    ).get(branchId, 'full') as { tableName: string }
    expect(promotedActiveRow.tableName).not.toBe(initialActiveRow.tableName)
    expect(retrievalRawDb.prepare('SELECT COUNT(*) AS count FROM PendingRetrievalIndex WHERE branchId = ?').get(branchId)).toMatchObject({ count: 0 })

    const promotedSearch = await retrievalIndex.searchLanceEvidence({
      novelId,
      branchId,
      maxChapterNo: 1,
      query: '新的检索正文',
      queryTerms: ['新的检索正文'],
      graphTerms: [],
      limit: 5,
    })
    expect(promotedSearch.warning).toBeUndefined()
    expect(promotedSearch.matches.some((match) => match.text === '新的检索正文内容。')).toBe(true)
  })

  it('keeps beta writes working while alpha sqlite is locked by another writer', async () => {
    const { alphaDbFilePath, betaRawDb, createNovelDatabaseAccess } = await createNovelDatabases('retale-per-novel-sqlite-lock-isolation')
    const alphaWriter = openSecondaryDatabase(alphaDbFilePath)
    const alphaContender = openSecondaryDatabase(alphaDbFilePath)
    alphaContender.exec('PRAGMA busy_timeout = 0')
    const betaDb = createNovelDatabaseAccess('novel-beta')

    alphaWriter.exec('BEGIN IMMEDIATE')

    expect(() => {
      alphaContender.prepare('INSERT INTO WorkspaceState (id, payload) VALUES (?, ?)').run('alpha-locked-write', '{"alpha":1}')
    }).toThrow(/locked/i)

    await expect(betaDb.withTransaction(async () => {
      betaDb.execute('INSERT INTO WorkspaceState (id, payload) VALUES (?, ?)', 'beta-lock-isolated-write', '{"beta":2}')
    })).resolves.toBeUndefined()

    expect(betaRawDb.prepare('SELECT payload FROM WorkspaceState WHERE id = ?').get('beta-lock-isolated-write')).toMatchObject({
      payload: '{"beta":2}',
    })

    alphaWriter.exec('ROLLBACK')
  })

  it('serializes same-novel writes while leaving cross-novel writes independent', async () => {
    const { createNovelDatabaseAccess, runWithPerNovelWriteGate } = await createNovelDatabases('retale-per-novel-write-gate')
    const alphaDb = createNovelDatabaseAccess('novel-alpha')
    const betaDb = createNovelDatabaseAccess('novel-beta')
    const alphaPublishRelease = createDeferred<void>()
    const alphaPublishEntered = createDeferred<void>()
    let queuedAlphaWriteStarted = false

    const alphaPublishPromise = runWithPerNovelWriteGate('novel-alpha', async () => {
      alphaPublishEntered.resolve()
      await alphaPublishRelease.promise
    })

    await alphaPublishEntered.promise

    const queuedAlphaWritePromise = alphaDb.withTransaction(async () => {
      queuedAlphaWriteStarted = true
      alphaDb.execute('INSERT INTO WorkspaceState (id, payload) VALUES (?, ?)', 'alpha-write-queued', '{"alpha":2}')
    })

    const betaPromise = betaDb.withTransaction(async () => {
      betaDb.execute('INSERT INTO WorkspaceState (id, payload) VALUES (?, ?)', 'beta-write-1', '{"beta":1}')
    })

    await expect(betaPromise).resolves.toBeUndefined()
    expect(queuedAlphaWriteStarted).toBe(false)
    expect(betaDb.queryOne<{ payload: string }>('SELECT payload FROM WorkspaceState WHERE id = ?', 'beta-write-1')?.payload).toBe('{"beta":1}')
    expect(alphaDb.queryOne<{ payload: string }>('SELECT payload FROM WorkspaceState WHERE id = ?', 'alpha-write-queued')).toBeNull()

    alphaPublishRelease.resolve()
    await expect(alphaPublishPromise).resolves.toBeUndefined()
    await expect(queuedAlphaWritePromise).resolves.toBeUndefined()
    expect(queuedAlphaWriteStarted).toBe(true)
    expect(alphaDb.queryOne<{ payload: string }>('SELECT payload FROM WorkspaceState WHERE id = ?', 'alpha-write-queued')?.payload).toBe('{"alpha":2}')
  })
})
