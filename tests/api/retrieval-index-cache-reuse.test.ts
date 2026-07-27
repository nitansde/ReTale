import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetResolvedDatabasesForTests } from '@/lib/server/db-resolver'
import { initializeDatabase } from '@/lib/server/sqlite'
import { registerLegacyNovelDatabase } from '@/tests/helpers/novel-db'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const databases: DatabaseSync[] = []
const originalDataDir = process.env.RETALE_DATA_DIR
let disposeNovelDatabaseOverride: (() => void) | undefined

function restoreEnvVar(name: 'RETALE_DATA_DIR', originalValue: string | undefined) {
  if (originalValue === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = originalValue
}

function seedRetrievalFixture(database: DatabaseSync) {
  database.prepare(
    `INSERT INTO NovelRecord (id, title, author, sourceType)
     VALUES (?, ?, ?, ?)`
  ).run('novel-001', 'Fixture Novel', 'Fixture Author', 'txt')

  database.prepare(
    `INSERT INTO StoryBranch (id, novelId, name, baseBranchId)
     VALUES (?, ?, ?, ?)`
  ).run('novel-001:main', 'novel-001', 'main', null)

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-1', 'novel-001', 'novel-001:main', 1, '第1章', '第1章原文', '第1章摘要', 1, 0, null, 'hash-1', 'ready')

  const insertTextSpan = database.prepare(
    `INSERT INTO TextSpan (
      id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd,
      charStart, charEnd, text, spanType, tokenEstimate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  insertTextSpan.run('span-1', 'novel-001', 'novel-001:main', 'chapter-1', 1, 1, 1, 0, 9, '第一段原文内容。', 'paragraph', 8)
  insertTextSpan.run('span-2', 'novel-001', 'novel-001:main', 'chapter-1', 1, 2, 2, 10, 19, '第二段原文内容。', 'paragraph', 8)
  insertTextSpan.run('span-3', 'novel-001', 'novel-001:main', 'chapter-1', 1, 3, 4, 20, 39, '场景证据原文内容。', 'scene', 12)
}

function seedLongWorldFallbackFixture(database: DatabaseSync, suffix: string) {
  const id = `world-ollama-fallback-${suffix}`
  const term = `超长回退设定-${suffix}`
  const definition = `${term}-开头-${'中文😀'.repeat(900)}-${term}-结尾-😀`
  database.prepare(
    `INSERT INTO KnowledgeWorld (
      id, novelId, branchId, term, category, definition, firstSeenChapter,
      validFromChapter, validUntilChapter, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, 'novel-001', 'novel-001:main', term, '设定', definition, 1, 1, 999999999, 'ready')
  return {
    docId: `worldbuilding:${id}`,
    term,
  }
}

function registerSeededDatabase(database: DatabaseSync) {
  databases.push(database)
  disposeNovelDatabaseOverride?.()
  disposeNovelDatabaseOverride = undefined
  resetResolvedDatabasesForTests()
  disposeNovelDatabaseOverride = registerLegacyNovelDatabase(database, ['novel-001'])
}

function createMockAISettings() {
  return {
    embeddings: {
      provider: 'ollama',
      embeddingBatchSize: 16,
      openAICompatible: {
        model: 'unused-openai-model',
      },
      ollama: {
        model: 'unit-test-embedding-model',
      },
    },
  }
}

function createMockLanceDb() {
  type StoredRow = Record<string, unknown>
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
        const nextValue = parseTerm()
        value = value || nextValue
      }
      return value
    }

    const parseTerm = (): boolean => {
      let value = parseFactor()
      while (tokens[index] === 'AND') {
        index += 1
        const nextValue = parseFactor()
        value = value && nextValue
      }
      return value
    }

    const parseFactor = (): boolean => {
      if (tokens[index] === '(') {
        index += 1
        const value = parseExpression()
        if (tokens[index] !== ')') {
          throw new Error(`Unbalanced predicate: ${predicate}`)
        }
        index += 1
        return value
      }

      const field = tokens[index]
      const operator = tokens[index + 1]
      const rawValue = tokens[index + 2]
      if (!field || !operator || !rawValue) {
        throw new Error(`Incomplete predicate clause: ${predicate}`)
      }
      index += 3
      return rowMatchesClause(row, field, operator, rawValue)
    }

    const matched = parseExpression()
    if (index !== tokens.length) {
      throw new Error(`Unsupported trailing predicate tokens: ${predicate}`)
    }
    return matched
  }

  type MockTable = {
    rows: StoredRow[]
    add: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    createIndex: ReturnType<typeof vi.fn>
    waitForIndex: ReturnType<typeof vi.fn>
    query: () => {
      limit: () => {
        toArray: () => Promise<StoredRow[]>
      }
    }
  }

  const tables = new Map<string, MockTable>()

  const createTableInstance = (initialRows: StoredRow[]) => {
    const table: MockTable = {
      rows: [...initialRows],
      add: vi.fn(async (nextRows: StoredRow[]) => {
        for (const row of nextRows) {
          table.rows.push(row)
        }
      }),
      delete: vi.fn(async (predicate: string) => {
        table.rows = table.rows.filter((row) => !rowMatchesPredicate(row, predicate))
      }),
      createIndex: vi.fn(async () => undefined),
      waitForIndex: vi.fn(async () => undefined),
      query: () => ({
        limit: () => ({
          toArray: async () => table.rows.slice(0, 1),
        }),
      }),
    }
    return table
  }

  const database = {
    tableNames: vi.fn(async () => Array.from(tables.keys())),
    createTable: vi.fn(async (name: string, rows: StoredRow[]) => {
      const table = createTableInstance(rows)
      tables.set(name, table)
      return table
    }),
    openTable: vi.fn(async (name: string) => tables.get(name) ?? null),
    dropTable: vi.fn(async (name: string) => {
      tables.delete(name)
    }),
  }

  return {
    connect: vi.fn(async () => database),
    database,
    tables,
  }
}

function getLatestMockTable(mockLanceDb: ReturnType<typeof createMockLanceDb>) {
  return Array.from(mockLanceDb.tables.values()).at(-1)
}

function getActiveMockTableName(database: DatabaseSync, scopeKey = 'full') {
  const activeRow = database
    .prepare('SELECT tableName FROM ActiveRetrievalIndex WHERE branchId = ? AND scopeKey = ?')
    .get('novel-001:main', scopeKey) as { tableName: string } | undefined
  expect(activeRow?.tableName).toBeTruthy()
  return activeRow!.tableName
}

function getActiveMockTable(database: DatabaseSync, mockLanceDb: ReturnType<typeof createMockLanceDb>, scopeKey = 'full') {
  return mockLanceDb.tables.get(getActiveMockTableName(database, scopeKey))
}

function getScopedMockTableName(database: DatabaseSync, startChapter: number, endChapter: number | 'open' = startChapter) {
  return getActiveMockTableName(database, `chapter-range:${startChapter}:${endChapter}`)
}

function getScopedMockTable(database: DatabaseSync, mockLanceDb: ReturnType<typeof createMockLanceDb>, startChapter: number, endChapter: number | 'open' = startChapter) {
  return mockLanceDb.tables.get(getScopedMockTableName(database, startChapter, endChapter))
}

function getActiveRetrievalIndexRows(database: DatabaseSync) {
  return database
    .prepare('SELECT scopeKey, tableName, scopeStartChapter, scopeEndChapter FROM ActiveRetrievalIndex WHERE branchId = ? ORDER BY scopeKey ASC')
    .all('novel-001:main') as Array<{
      scopeKey: string
      tableName: string
      scopeStartChapter: number | null
      scopeEndChapter: number | null
     }>
}

function getPendingRetrievalIndexRows(database: DatabaseSync) {
  return database
    .prepare([
      'SELECT scopeKey, tableName, phase, rowCount, textIndexCompleted, vectorIndexCompleted, rebuildFingerprint',
      'FROM PendingRetrievalIndex WHERE branchId = ? ORDER BY scopeKey ASC',
    ].join(' '))
    .all('novel-001:main') as Array<{
      scopeKey: string
      tableName: string
      phase: string
      rowCount: number
      textIndexCompleted: number
      vectorIndexCompleted: number
      rebuildFingerprint: string | null
    }>
}

async function createRetrievalIndexHarness(testName: string) {
  const tempDatabase = createTempDatabaseCopy(testName)
  cleanups.push(tempDatabase.cleanup)
  process.env.RETALE_DATA_DIR = path.join(tempDatabase.directory, 'data')

  const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
  seedRetrievalFixture(database)
  registerSeededDatabase(database)

  const aiSettings = createMockAISettings()
  const mockLanceDb = createMockLanceDb()
  const ivfFlat = vi.fn((config: Record<string, unknown>) => ({ kind: 'ivfFlat', config, callIndex: ivfFlat.mock.calls.length }))
  const embedTextsWithOllama = vi.fn(async (input: string | string[]) => {
    const values = Array.isArray(input) ? input : [input]
    return {
      enabled: true,
      embeddings: values.map((text) => {
        if (text.includes('章节摘要')) return [4, 4, 4]
        if (text.includes('场景证据原文内容')) return [3, 3, 3]
        return [2, 2, 2]
      }),
      model: aiSettings.embeddings.ollama.model,
    }
  })

  vi.resetModules()
  vi.doMock('@/lib/server/ai-settings', () => ({
    loadStoredAISettings: () => aiSettings,
  }))
  vi.doMock('@/lib/server/ollama-local', () => ({
    embedTextsWithOllama,
  }))
  vi.doMock('@lancedb/lancedb', () => ({
    connect: mockLanceDb.connect,
    Index: {
      fts: () => ({}),
      ivfFlat,
    },
  }))

  const retrievalIndex = await import('@/lib/server/retrieval-index')
  const retrievalCache = await import('@/lib/server/retrieval-embedding-cache')
  const { runWithNovelDatabaseAccess } = await import('@/lib/server/database-access')

  return {
    aiSettings,
    database,
    embedTextsWithOllama,
    ivfFlat,
    mockLanceDb,
    retrievalIndex,
    retrievalCache,
    tempDataDir: process.env.RETALE_DATA_DIR,
    withNovelDatabase: <T>(callback: () => T | Promise<T>) => runWithNovelDatabaseAccess('novel-001', callback),
  }
}

type RetrievalIndexHarness = Awaited<ReturnType<typeof createRetrievalIndexHarness>>

function seedWorldWithExactEmbeddingInputCodePoints(
  database: DatabaseSync,
  retrievalIndex: RetrievalIndexHarness['retrievalIndex'],
  suffix: string,
  targetCodePoints: number,
) {
  const id = `world-ollama-boundary-${suffix}`
  const term = `边界回退设定-${suffix}`
  database.prepare(
    `INSERT INTO KnowledgeWorld (
      id, novelId, branchId, term, category, definition, firstSeenChapter,
      validFromChapter, validUntilChapter, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, 'novel-001', 'novel-001:main', term, '设定', '', 1, 1, 999999999, 'ready')

  const docId = `worldbuilding:${id}`
  const initialDoc = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    .find((row) => row.id === docId)
  if (!initialDoc) {
    throw new Error(`Missing seeded retrieval doc ${docId}`)
  }
  const initialInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(initialDoc).text
  const paddingCodePoints = targetCodePoints - Array.from(initialInput).length
  if (paddingCodePoints < 0) {
    throw new Error(`Target input length ${targetCodePoints} is shorter than fixture metadata`)
  }

  database.prepare('UPDATE KnowledgeWorld SET definition = ? WHERE id = ?').run('界'.repeat(paddingCodePoints), id)
  const doc = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    .find((row) => row.id === docId)
  if (!doc) {
    throw new Error(`Missing resized retrieval doc ${docId}`)
  }
  const input = retrievalIndex.buildRawTextRetrievalEmbeddingInput(doc).text
  if (Array.from(input).length !== targetCodePoints) {
    throw new Error(`Expected ${targetCodePoints} code points but built ${Array.from(input).length}`)
  }

  return { docId, input }
}

async function cacheRetrievalDocsExcept(harness: RetrievalIndexHarness, excludedDocId: string) {
  const docs = harness.retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
  await harness.withNovelDatabase(() => harness.retrievalCache.upsertRawTextEmbeddingCacheEntries({
    scope: {
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      provider: 'ollama',
      model: harness.aiSettings.embeddings.ollama.model,
    },
    entries: docs
      .filter((row) => row.id !== excludedDocId)
      .map((row) => ({
        embeddingInput: harness.retrievalIndex.buildRawTextRetrievalEmbeddingInput(row).text,
        vector: [9, 9, 9],
      })),
  }))
}

afterEach(() => {
  disposeNovelDatabaseOverride?.()
  disposeNovelDatabaseOverride = undefined
  resetResolvedDatabasesForTests()

  while (databases.length) {
    try {
      databases.pop()?.close()
    } catch (_closeError) {
      void _closeError
      // Ignore secondary SQLite close failures so teardown can continue.
    }
  }

  restoreEnvVar('RETALE_DATA_DIR', originalDataDir)

  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('retrieval-index cache reuse helpers', () => {
  it('routes LanceDB writes into the per-novel data directory instead of the global .lancedb root', async () => {
    const { mockLanceDb, retrievalIndex, tempDataDir } = await createRetrievalIndexHarness('retale-retrieval-index-per-novel-lancedb-path')

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: expect.any(Number),
    })

    expect(mockLanceDb.connect).toHaveBeenCalledWith(path.join(tempDataDir!, 'novels', 'novel-001', 'lancedb'))
    expect(mockLanceDb.connect).not.toHaveBeenCalledWith(path.join(process.cwd(), '.lancedb'))
  })

  it('includes tier labels and merged aliases in entity retrieval docs without duplicate character docs', async () => {
    const tempDatabase = createTempDatabaseCopy('retale-retrieval-index-character-doc-tier-aliases')
    cleanups.push(tempDatabase.cleanup)

    const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
    seedRetrievalFixture(database)
    registerSeededDatabase(database)

    database.prepare(
      `INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, description, importanceTier, firstSeenChapter, lastSeenChapter, status
      ) VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, ?)`
    ).run('entity-hero', 'novel-001', 'novel-001:main', '林砚', '主角描述', 'protagonist', 1, 1, 'ready')
    database.prepare('INSERT INTO EntityAlias (id, entityId, alias, sourceChapter) VALUES (?, ?, ?, ?)')
      .run('alias-hero-1', 'entity-hero', '阿砚', 1)
    database.prepare(
      `INSERT INTO EntityAliasMapping (id, novelId, branchId, alias, entityId, sourceChapter)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('alias-map-hero-1', 'novel-001', 'novel-001:main', '林公子', 'entity-hero', 1)
    database.prepare(
      `INSERT INTO KnowledgeFact (
        id, novelId, branchId, factType, subjectEntityId, predicate, valueJson,
        sourceChapter, validFromChapter, validUntilChapter, status
      ) VALUES (?, ?, ?, 'character_profile', ?, 'role_card', ?, ?, ?, ?, ?)`
    ).run(
      'fact-hero-profile',
      'novel-001',
      'novel-001:main',
      'entity-hero',
      JSON.stringify({
        profile: {
          identity: { summary: '剑修主角' },
          appearance: { summary: '眉目清峻' },
        },
        descriptionDelta: '剑修主角｜眉目清峻',
      }),
      1,
      1,
      999999999,
      'ready',
    )

    vi.resetModules()
    const { loadKnowledgeDerivedRetrievalDocs } = await import('@/lib/server/retrieval-index')
    const docs = loadKnowledgeDerivedRetrievalDocs('novel-001', 'novel-001:main')
    const entityDocs = docs.filter((row) => row.sourceType === 'entity_profile' && row.title === '林砚')

    expect(entityDocs).toHaveLength(1)
    expect(entityDocs[0]).toMatchObject({
      relatedEntityNames: expect.stringContaining('林砚'),
      relatedTerms: expect.stringContaining('tier0'),
      text: expect.stringContaining('分级：Tier 0'),
    })
    expect(entityDocs[0]?.text).toContain('别名：')
    expect(entityDocs[0]?.text).toContain('阿砚')
    expect(entityDocs[0]?.text).toContain('林公子')
    expect(entityDocs[0]?.relatedEntityNames).toContain('阿砚')
    expect(entityDocs[0]?.relatedEntityNames).toContain('林公子')
  })

  it('merges large retrieval doc groups without spreading into the call stack', async () => {
    vi.resetModules()
    const retrievalIndex = await import('@/lib/server/retrieval-index')
    type RetrievalDoc = ReturnType<typeof retrievalIndex.loadBranchRetrievalDocs>[number]
    const makeDoc = (index: number): RetrievalDoc => ({
      id: `doc-${index}`,
      branchId: 'novel-001:main',
      sourceType: 'text_span',
      sourceId: `span-${index}`,
      chapterId: `chapter-${Math.floor(index / 1000) + 1}`,
      chapterNo: Math.floor(index / 1000) + 1,
      validFromChapter: Math.floor(index / 1000) + 1,
      validUntilChapter: 999999999,
      lineStart: index + 1,
      lineEnd: index + 1,
      spanType: 'scene',
      title: 'scene',
      sourceLabel: '原文证据',
      relatedEntityNames: '',
      relatedEventNames: '',
      relatedTerms: 'scene',
      text: `正文片段 ${index}`,
      status: 'ready',
      includeByDefault: 1,
      tokenEstimate: 4,
      contentHash: `hash-${index}`,
    })
    const rawDocs = Array.from({ length: 150000 }, (_, index) => makeDoc(index))
    const derivedDocs = [makeDoc(150000)]

    const mergedDocs = retrievalIndex.mergeRetrievalDocGroups(rawDocs, derivedDocs)

    expect(mergedDocs).toHaveLength(150001)
    expect(mergedDocs[0]?.id).toBe('doc-0')
    expect(mergedDocs.at(-1)?.id).toBe('doc-150000')
  })

  it('partitions raw-text and knowledge-derived retrieval docs', async () => {
    const tempDatabase = createTempDatabaseCopy('retale-retrieval-index-cache-reuse-partition')
    cleanups.push(tempDatabase.cleanup)

    const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
    seedRetrievalFixture(database)
    registerSeededDatabase(database)

    vi.resetModules()
    const {
      loadBranchRetrievalDocs,
      loadKnowledgeDerivedRetrievalDocs,
      loadRawTextRetrievalDocs,
    } = await import('@/lib/server/retrieval-index')

    const rawTextDocs = loadRawTextRetrievalDocs('novel-001', 'novel-001:main')
    const knowledgeDerivedDocs = loadKnowledgeDerivedRetrievalDocs('novel-001', 'novel-001:main')
    const mergedDocs = loadBranchRetrievalDocs('novel-001', 'novel-001:main')

    expect(rawTextDocs.length).toBeGreaterThan(0)
    expect(rawTextDocs.every((row) => row.sourceType === 'text_span')).toBe(true)

    expect(knowledgeDerivedDocs.length).toBeGreaterThan(0)
    expect(knowledgeDerivedDocs.some((row) => row.sourceType === 'chapter_summary')).toBe(true)
    expect(knowledgeDerivedDocs.some((row) => row.sourceType === 'text_span')).toBe(false)

    expect(mergedDocs).toEqual([...rawTextDocs, ...knowledgeDerivedDocs])
  })

  it('can scope raw-text retrieval docs to a rebuild chapter range', async () => {
    const tempDatabase = createTempDatabaseCopy('retale-retrieval-index-cache-reuse-range-docs')
    cleanups.push(tempDatabase.cleanup)

    const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
    seedRetrievalFixture(database)
    registerSeededDatabase(database)

    database.prepare(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, summary,
        revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('chapter-2', 'novel-001', 'novel-001:main', 2, '第2章', '第2章原文', '第2章摘要', 1, 0, null, 'hash-2', 'ready')
    database.prepare(
      `INSERT INTO TextSpan (
        id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd,
        charStart, charEnd, text, spanType, tokenEstimate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('span-4', 'novel-001', 'novel-001:main', 'chapter-2', 2, 1, 1, 0, 9, '第二章原文内容。', 'paragraph', 8)

    vi.resetModules()
    const { loadRawTextRetrievalDocs } = await import('@/lib/server/retrieval-index')

    const allDocs = loadRawTextRetrievalDocs('novel-001', 'novel-001:main')
    const rangedDocs = loadRawTextRetrievalDocs('novel-001', 'novel-001:main', { startChapter: 2, endChapter: 2 })

    expect(allDocs.some((row) => row.chapterNo === 1)).toBe(true)
    expect(allDocs.some((row) => row.chapterNo === 2)).toBe(true)
    expect(rangedDocs.length).toBeGreaterThan(0)
    expect(rangedDocs.every((row) => row.chapterNo === 2)).toBe(true)
  })

  it('treats a default full-equivalent chapter range as the full retrieval scope', async () => {
    const { database, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-full-equivalent-range-scope')

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main', {
      chapterRange: { startChapter: 1 },
    })).resolves.toMatchObject({
      rowCount: retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length,
    })

    expect(getActiveRetrievalIndexRows(database)).toEqual([
      expect.objectContaining({
        scopeKey: 'full',
        scopeStartChapter: null,
        scopeEndChapter: null,
      }),
    ])
    expect(database.prepare('SELECT COUNT(*) AS count FROM ActiveRetrievalIndex WHERE branchId = ? AND scopeKey = ?')
      .get('novel-001:main', 'chapter-range:1:open')).toMatchObject({ count: 0 })
    expect(getActiveMockTable(database, mockLanceDb)).toBeTruthy()
  })

  it('reuses embeddingInputHash when packed text is unchanged', async () => {
    const tempDatabase = createTempDatabaseCopy('retale-retrieval-index-cache-reuse-hash')
    cleanups.push(tempDatabase.cleanup)

    const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
    seedRetrievalFixture(database)
    registerSeededDatabase(database)

    vi.resetModules()
    const {
      buildRawTextRetrievalEmbeddingInput,
      loadRawTextRetrievalDocs,
    } = await import('@/lib/server/retrieval-index')

    const rawTextDocs = loadRawTextRetrievalDocs('novel-001', 'novel-001:main')
    const packedDoc = rawTextDocs.find((row) => row.id.startsWith('packed-span:'))
    expect(packedDoc).toBeTruthy()

    const packedDocRegeneratedId = {
      ...packedDoc!,
      id: `${packedDoc!.id}:regenerated`,
      sourceId: `${packedDoc!.sourceId}:regenerated`,
      contentHash: `${packedDoc!.contentHash}:regenerated`,
    }

    const originalEmbeddingInput = buildRawTextRetrievalEmbeddingInput(packedDoc!)
    const regeneratedEmbeddingInput = buildRawTextRetrievalEmbeddingInput(packedDocRegeneratedId)

    expect(regeneratedEmbeddingInput.text).toBe(originalEmbeddingInput.text)
    expect(regeneratedEmbeddingInput.embeddingInputHash).toBe(originalEmbeddingInput.embeddingInputHash)
  })

  it('reuses cached text-span vectors during final rebuild', async () => {
    const {
      embedTextsWithOllama,
      mockLanceDb,
      retrievalCache,
      retrievalIndex,
      withNovelDatabase,
    } = await createRetrievalIndexHarness('retale-retrieval-index-cache-reuse-final-rebuild-hit')

    const rawTextDocs = retrievalIndex.loadRawTextRetrievalDocs('novel-001', 'novel-001:main')
    const mergedDocs = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    const packedDoc = rawTextDocs.find((row) => row.id.startsWith('packed-span:'))
    expect(packedDoc).toBeTruthy()

    const cachedEmbeddingInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(packedDoc!).text
    const cachedVector = [9, 9, 9]
    await withNovelDatabase(() => retrievalCache.upsertRawTextEmbeddingCacheEntries({
      scope: {
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        provider: 'ollama',
        model: 'unit-test-embedding-model',
      },
      entries: [{
        embeddingInput: cachedEmbeddingInput,
        vector: cachedVector,
      }],
    }))

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: mergedDocs.length,
    })

    expect(embedTextsWithOllama).toHaveBeenCalledTimes(1)
    expect(embedTextsWithOllama.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([
      expect.stringContaining('章节摘要'),
      expect.stringContaining('场景证据原文内容'),
    ]))
    expect(embedTextsWithOllama.mock.calls[0]?.[0]).not.toContain(cachedEmbeddingInput)

    const storedRows = mockLanceDb.database.createTable.mock.calls[0]?.[1] as Array<{ id: string; vector: number[] }>
    expect(storedRows.map((row) => row.id)).toEqual(mergedDocs.map((row) => row.id))
    expect(storedRows.find((row) => row.id === packedDoc!.id)?.vector).toEqual(cachedVector)
  })

  it('preserves overlap and final rebuild correctness', async () => {
    const {
      database,
      embedTextsWithOllama,
      mockLanceDb,
      retrievalCache,
      retrievalIndex,
      withNovelDatabase,
    } = await createRetrievalIndexHarness('retale-retrieval-index-cache-reuse-broader-final-rebuild')

    const rawTextDocs = retrievalIndex.loadRawTextRetrievalDocs('novel-001', 'novel-001:main')
    const mergedDocs = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    const packedDoc = rawTextDocs.find((row) => row.id.startsWith('packed-span:'))
    const sceneDoc = rawTextDocs.find((row) => row.id === 'span-3')
    expect(packedDoc).toBeTruthy()
    expect(sceneDoc).toBeTruthy()

    const packedInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(packedDoc!).text
    const sceneInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(sceneDoc!).text
    const chapterSummaryDoc = mergedDocs.find((row) => row.id === 'chapter-summary:chapter-1')
    expect(chapterSummaryDoc).toBeTruthy()
    const chapterSummaryInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(chapterSummaryDoc!).text
    const packedHash = retrievalCache.buildEmbeddingInputHash(packedInput)
    const sceneHash = retrievalCache.buildEmbeddingInputHash(sceneInput)

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: mergedDocs.length,
    })

    expect(embedTextsWithOllama).toHaveBeenCalledTimes(1)
    expect(
      (mockLanceDb.database.createTable.mock.calls[0]?.[1] as Array<{ id: string }> | undefined)?.map((row) => row.id)
    ).toEqual(mergedDocs.map((row) => row.id))
    expect(database.prepare('SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ?').get('novel-001:main')).toMatchObject({
      count: mergedDocs.length,
    })

    await withNovelDatabase(() => retrievalCache.upsertRawTextEmbeddingCacheEntries({
      scope: {
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        provider: 'ollama',
        model: 'unit-test-embedding-model',
      },
      entries: [
        {
          embeddingInput: packedInput,
          vector: [9, 9, 9],
        },
        {
          embeddingInput: sceneInput,
          vector: [8, 8, 8],
        },
        {
          embeddingInput: chapterSummaryInput,
          vector: [7, 7, 7],
        },
      ],
    }))

    embedTextsWithOllama.mockClear()
    mockLanceDb.database.createTable.mockClear()
    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: mergedDocs.length,
    })

    expect(embedTextsWithOllama).not.toHaveBeenCalled()

    const warmStoredRows = mockLanceDb.database.createTable.mock.calls[0]?.[1] as Array<{ id: string; vector: number[] }>
    expect(warmStoredRows.map((row) => row.id)).toEqual(mergedDocs.map((row) => row.id))
    expect(warmStoredRows.find((row) => row.id === packedDoc!.id)?.vector).toEqual([9, 9, 9])
    expect(warmStoredRows.find((row) => row.id === sceneDoc!.id)?.vector).toEqual([8, 8, 8])
    expect(warmStoredRows.find((row) => row.id === chapterSummaryDoc!.id)?.vector).toEqual([7, 7, 7])

    database.prepare('DELETE FROM RawTextEmbeddingCache WHERE embeddingInputHash = ?').run(packedHash)
    database.prepare('UPDATE RawTextEmbeddingCache SET vectorJson = ?, vectorDimension = ? WHERE embeddingInputHash = ?')
      .run(JSON.stringify([1, 1]), 2, sceneHash)

    embedTextsWithOllama.mockClear()
    mockLanceDb.database.createTable.mockClear()
    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: mergedDocs.length,
    })

    expect(embedTextsWithOllama).toHaveBeenCalledTimes(2)
    expect(embedTextsWithOllama.mock.calls[0]?.[0]).toEqual([packedInput])
    expect(embedTextsWithOllama.mock.calls[0]?.[0]).not.toContain(sceneInput)
    expect(embedTextsWithOllama.mock.calls[0]?.[0]).not.toContain(chapterSummaryInput)
    expect(embedTextsWithOllama.mock.calls[1]?.[0]).toEqual([sceneInput])

    const repairedSceneRow = database.prepare(
      'SELECT vectorJson, vectorDimension FROM RawTextEmbeddingCache WHERE embeddingInputHash = ?'
    ).get(sceneHash) as { vectorJson: string; vectorDimension: number } | undefined
    expect(repairedSceneRow).toBeTruthy()
    expect(repairedSceneRow?.vectorDimension).toBe(3)
    expect(JSON.parse(repairedSceneRow!.vectorJson)).toEqual([3, 3, 3])

    const repairedPackedRow = database.prepare(
      'SELECT vectorJson, vectorDimension FROM RawTextEmbeddingCache WHERE embeddingInputHash = ?'
    ).get(packedHash) as { vectorJson: string; vectorDimension: number } | undefined
    expect(repairedPackedRow).toBeTruthy()
    expect(repairedPackedRow?.vectorDimension).toBe(3)

    const degradedStoredRows = mockLanceDb.database.createTable.mock.calls[0]?.[1] as Array<{ id: string; vector: number[] }>
    expect(degradedStoredRows.map((row) => row.id)).toEqual(mergedDocs.map((row) => row.id))
  })

  it('rebuilds correctly with empty or partial raw-text cache', async () => {
    const emptyHarness = await createRetrievalIndexHarness('retale-retrieval-index-cache-reuse-empty-cache')
    const emptyRawTextDocs = emptyHarness.retrievalIndex.loadRawTextRetrievalDocs('novel-001', 'novel-001:main')

    await expect(emptyHarness.retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: emptyHarness.retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length,
    })

    expect(emptyHarness.embedTextsWithOllama).toHaveBeenCalledTimes(1)
    const emptyCacheRows = emptyHarness.database.prepare(
      `SELECT embeddingInputHash, vectorJson, vectorDimension
       FROM RawTextEmbeddingCache
       WHERE branchId = ? AND provider = ? AND model = ?
       ORDER BY embeddingInputHash ASC`
    ).all('novel-001:main', 'ollama', 'unit-test-embedding-model') as Array<{
      embeddingInputHash: string
      vectorJson: string
      vectorDimension: number
    }>
    expect(emptyCacheRows).toHaveLength(emptyHarness.retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length)
    expect(emptyCacheRows.every((row) => row.vectorDimension === 3)).toBe(true)

    const degradedHarness = await createRetrievalIndexHarness('retale-retrieval-index-cache-reuse-partial-cache')
    const degradedRawTextDocs = degradedHarness.retrievalIndex.loadRawTextRetrievalDocs('novel-001', 'novel-001:main')
    const packedDoc = degradedRawTextDocs.find((row) => row.id.startsWith('packed-span:'))
    const sceneDoc = degradedRawTextDocs.find((row) => row.id === 'span-3')
    expect(packedDoc).toBeTruthy()
    expect(sceneDoc).toBeTruthy()

    const packedInput = degradedHarness.retrievalIndex.buildRawTextRetrievalEmbeddingInput(packedDoc!).text
    const sceneInput = degradedHarness.retrievalIndex.buildRawTextRetrievalEmbeddingInput(sceneDoc!).text
    await degradedHarness.withNovelDatabase(() => degradedHarness.retrievalCache.upsertRawTextEmbeddingCacheEntries({
      scope: {
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        provider: 'ollama',
        model: 'unit-test-embedding-model',
      },
      entries: [{
        embeddingInput: packedInput,
        vector: [8, 8, 8],
      }],
    }))
    const sceneHash = degradedHarness.retrievalCache.buildEmbeddingInputHash(sceneInput)
    degradedHarness.database.prepare(
      `INSERT INTO RawTextEmbeddingCache (
        branchId, provider, model, embeddingInputHash, vectorJson, vectorDimension, lastSeenAt, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run('novel-001:main', 'ollama', 'unit-test-embedding-model', sceneHash, JSON.stringify([1, 1]), 2)

    await expect(degradedHarness.retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: degradedHarness.retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length,
    })

    expect(degradedHarness.embedTextsWithOllama).toHaveBeenCalledTimes(2)
    expect(degradedHarness.embedTextsWithOllama.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([
      expect.stringContaining('章节摘要'),
    ]))
    expect(degradedHarness.embedTextsWithOllama.mock.calls[0]?.[0]).not.toContain(packedInput)
    expect(degradedHarness.embedTextsWithOllama.mock.calls[0]?.[0]).not.toContain(sceneInput)
    expect(degradedHarness.embedTextsWithOllama.mock.calls[1]?.[0]).toEqual([sceneInput])

    const repairedSceneRow = degradedHarness.database.prepare(
      'SELECT vectorJson, vectorDimension FROM RawTextEmbeddingCache WHERE embeddingInputHash = ?'
    ).get(sceneHash) as { vectorJson: string; vectorDimension: number } | undefined
    expect(repairedSceneRow).toBeTruthy()
    expect(repairedSceneRow?.vectorDimension).toBe(3)
    expect(JSON.parse(repairedSceneRow!.vectorJson)).toEqual([3, 3, 3])
  })

  it('garbage collects unreachable raw-text cache rows during precompute', async () => {
    const { database, retrievalCache, retrievalIndex, withNovelDatabase } = await createRetrievalIndexHarness('retale-retrieval-index-cache-reuse-precompute-gc')

    const rawTextDocs = retrievalIndex.loadRawTextRetrievalDocs('novel-001', 'novel-001:main')
    const packedDoc = rawTextDocs.find((row) => row.id.startsWith('packed-span:'))
    expect(packedDoc).toBeTruthy()

    const retainedInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(packedDoc!).text
    const staleInput = `${retainedInput}\n[stale-cache-entry]`
    const retainedHash = retrievalCache.buildEmbeddingInputHash(retainedInput)
    const staleHash = retrievalCache.buildEmbeddingInputHash(staleInput)

    await withNovelDatabase(() => retrievalCache.upsertRawTextEmbeddingCacheEntries({
      scope: {
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        provider: 'ollama',
        model: 'unit-test-embedding-model',
      },
      entries: [
        { embeddingInput: retainedInput, vector: [9, 9, 9] },
        { embeddingInput: staleInput, vector: [7, 7, 7] },
      ],
    }))

    await expect(retrievalIndex.precomputeRawTextEmbeddingCache({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      settingsSnapshot: {
        provider: 'ollama',
        model: 'unit-test-embedding-model',
        embeddingBatchSize: 16,
      },
    })).resolves.toMatchObject({
      totalDocs: rawTextDocs.length,
      cacheHits: 1,
      cacheMisses: rawTextDocs.length - 1,
      completedDocs: rawTextDocs.length,
    })

    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ? AND embeddingInputHash = ?'
    ).get('novel-001:main', retainedHash)).toMatchObject({ count: 1 })
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ? AND embeddingInputHash = ?'
    ).get('novel-001:main', staleHash)).toMatchObject({ count: 0 })
  })

  it('repairs missing raw-text line and span artifacts before precompute', async () => {
    const { database, embedTextsWithOllama, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-cache-reuse-precompute-artifact-repair')

    database.prepare('DELETE FROM TextSpan WHERE chapterId = ?').run('chapter-1')
    database.prepare('DELETE FROM ChapterLine WHERE chapterId = ?').run('chapter-1')

    expect(retrievalIndex.loadRawTextRetrievalDocs('novel-001', 'novel-001:main')).toHaveLength(0)

    const result = await retrievalIndex.precomputeRawTextEmbeddingCache({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      settingsSnapshot: {
        provider: 'ollama',
        model: 'unit-test-embedding-model',
        embeddingBatchSize: 16,
      },
    })

    expect(result.totalDocs).toBeGreaterThan(0)
    expect(result.completedDocs).toBe(result.totalDocs)
    expect(embedTextsWithOllama).toHaveBeenCalled()
    expect(database.prepare('SELECT COUNT(*) AS count FROM ChapterLine WHERE chapterId = ?').get('chapter-1')).toMatchObject({ count: 1 })
    expect((database.prepare('SELECT COUNT(*) AS count FROM TextSpan WHERE chapterId = ?').get('chapter-1') as { count: number }).count).toBeGreaterThan(0)
  })

  it('does not garbage collect out-of-range raw-text cache rows during ranged precompute', async () => {
    const { database, retrievalCache, retrievalIndex, withNovelDatabase } = await createRetrievalIndexHarness('retale-retrieval-index-cache-reuse-precompute-range-gc')

    const rawTextDocs = retrievalIndex.loadRawTextRetrievalDocs('novel-001', 'novel-001:main')
    const retainedDoc = rawTextDocs.find((row) => row.id.startsWith('packed-span:'))
    expect(retainedDoc).toBeTruthy()

    const retainedInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(retainedDoc!).text
    const staleInput = `${retainedInput}\n[range-outside-cache-entry]`
    const retainedHash = retrievalCache.buildEmbeddingInputHash(retainedInput)
    const staleHash = retrievalCache.buildEmbeddingInputHash(staleInput)

    await withNovelDatabase(() => retrievalCache.upsertRawTextEmbeddingCacheEntries({
      scope: {
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        provider: 'ollama',
        model: 'unit-test-embedding-model',
      },
      entries: [
        { embeddingInput: retainedInput, vector: [9, 9, 9] },
        { embeddingInput: staleInput, vector: [7, 7, 7] },
      ],
    }))

    await expect(retrievalIndex.precomputeRawTextEmbeddingCache({
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      settingsSnapshot: {
        provider: 'ollama',
        model: 'unit-test-embedding-model',
        embeddingBatchSize: 16,
      },
      chapterRange: { startChapter: 1, endChapter: 1 },
    })).resolves.toMatchObject({
      totalDocs: rawTextDocs.length,
      completedDocs: rawTextDocs.length,
    })

    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ? AND embeddingInputHash = ?'
    ).get('novel-001:main', retainedHash)).toMatchObject({ count: 1 })
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ? AND embeddingInputHash = ?'
    ).get('novel-001:main', staleHash)).toMatchObject({ count: 1 })
  })

  it('scoped rebuild materializes rows for the requested chapter range', async () => {
    const { database, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-scoped-preserve-outside-range')

    database.prepare(
      `INSERT INTO KnowledgeWorld (
        id, novelId, branchId, term, category, definition, firstSeenChapter,
        validFromChapter, validUntilChapter, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('world-outside-range', 'novel-001', 'novel-001:main', '旧地图', '设定', '只在第一章有效', 1, 1, 2, 'ready')
    database.prepare(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, summary,
        revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('chapter-2', 'novel-001', 'novel-001:main', 2, '第2章', '第2章原文', '第2章旧摘要', 1, 0, null, 'hash-2', 'ready')
    database.prepare(
      `INSERT INTO TextSpan (
        id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd,
        charStart, charEnd, text, spanType, tokenEstimate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('span-4', 'novel-001', 'novel-001:main', 'chapter-2', 2, 1, 1, 0, 9, '第二章旧原文内容。', 'paragraph', 8)

    await retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')
    const originalTable = getActiveMockTable(database, mockLanceDb)
    mockLanceDb.database.createTable.mockClear()

    database.prepare('UPDATE KnowledgeChapter SET summary = ? WHERE id = ?').run('第2章新摘要', 'chapter-2')
    database.prepare('UPDATE TextSpan SET text = ? WHERE id = ?').run('第二章新原文内容。', 'span-4')

    const scopedDocs = retrievalIndex.loadRawTextRetrievalDocs('novel-001', 'novel-001:main', { startChapter: 2, endChapter: 2 })
    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main', {
      chapterRange: { startChapter: 2, endChapter: 2 },
    })).resolves.toMatchObject({
      rowCount: scopedDocs.length + 2,
    })

    expect(originalTable?.delete).not.toHaveBeenCalled()
    expect(mockLanceDb.database.createTable).toHaveBeenCalledTimes(1)
    expect(getActiveMockTable(database, mockLanceDb)).toBe(originalTable)
    const table = getScopedMockTable(database, mockLanceDb, 2)
    expect(table).toBeTruthy()
    expect(table?.rows.find((row) => row.sourceType === 'text_span' && row.chapterNo === 1)).toBeUndefined()
    expect(table?.rows.find((row) => row.id === 'worldbuilding:world-outside-range')).toBeUndefined()
    expect(table?.rows.find((row) => row.id === 'span-4')).toMatchObject({
      text: '第二章新原文内容。',
    })
    expect(table?.rows.find((row) => row.id === 'chapter-summary:chapter-1')).toMatchObject({
      text: '第1章摘要',
    })
    expect(table?.rows.find((row) => row.id === 'chapter-summary:chapter-2')).toMatchObject({
      text: '第2章新摘要',
    })
    expect(getActiveRetrievalIndexRows(database)).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeKey: 'full', scopeStartChapter: null, scopeEndChapter: null }),
      expect.objectContaining({ scopeKey: 'chapter-range:2:2', scopeStartChapter: 2, scopeEndChapter: 2 }),
    ]))
  }, 120000)

  it('scoped rebuild materializes validity-overlapping rows even when chapterNo is below the range start', async () => {
    const { database, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-scoped-validity-overlap')

    database.prepare(
      `INSERT INTO KnowledgeWorld (
        id, novelId, branchId, term, category, definition, firstSeenChapter,
        validFromChapter, validUntilChapter, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('world-1', 'novel-001', 'novel-001:main', '青铜钥', '道具', '旧定义', 1, 1, 999999999, 'ready')

    await retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')

    database.prepare('UPDATE KnowledgeWorld SET definition = ? WHERE id = ?').run('新定义', 'world-1')

    await retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main', {
      chapterRange: { startChapter: 2, endChapter: 2 },
    })

    const table = getScopedMockTable(database, mockLanceDb, 2)
    const worldRows = table?.rows.filter((row) => row.id === 'worldbuilding:world-1') ?? []
    expect(worldRows).toHaveLength(1)
    expect(worldRows[0]).toMatchObject({
      chapterNo: 1,
      validFromChapter: 1,
      validUntilChapter: 999999999,
      text: expect.stringContaining('定义：新定义'),
    })
  }, 120000)

  it('creates a scoped retrieval table when ranged rebuild has no existing branch table', async () => {
    const { database, embedTextsWithOllama, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-scoped-missing-table-materialize')

    database.prepare(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, summary,
        revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('chapter-2', 'novel-001', 'novel-001:main', 2, '第2章', '第2章原文', '第2章摘要', 1, 0, null, 'hash-2', 'ready')
    database.prepare(
      `INSERT INTO TextSpan (
        id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd,
        charStart, charEnd, text, spanType, tokenEstimate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('span-4', 'novel-001', 'novel-001:main', 'chapter-2', 2, 1, 1, 0, 9, '第二章原文内容。', 'paragraph', 8)

    const fullDocs = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    const scopedDocs = retrievalIndex.loadRawTextRetrievalDocs('novel-001', 'novel-001:main', { startChapter: 2, endChapter: 2 })
    const progressEvents: Array<{ totalRows: number }> = []

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main', {
      chapterRange: { startChapter: 2, endChapter: 2 },
      onProgress: (progress) => {
        progressEvents.push(progress)
      },
    })).resolves.toMatchObject({
      rowCount: scopedDocs.length + 2,
    })

    expect(progressEvents).toContainEqual(expect.objectContaining({
      totalRows: scopedDocs.length + 2,
    }))
    expect(progressEvents.find((progress) => progress.totalRows === fullDocs.length)).toBeUndefined()
    expect(mockLanceDb.database.createTable).toHaveBeenCalledTimes(1)
    expect(embedTextsWithOllama).toHaveBeenCalledTimes(1)
    const createdRows = mockLanceDb.database.createTable.mock.calls[0]?.[1] as Array<{ id: string }> | undefined
    expect(createdRows?.map((row) => row.id)).toEqual([
      ...scopedDocs.map((row) => row.id),
      'chapter-summary:chapter-1',
      'chapter-summary:chapter-2',
    ])
    const table = getScopedMockTable(database, mockLanceDb, 2)
    expect(table?.delete).not.toHaveBeenCalled()
    await expect(retrievalIndex.hasBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toBe(false)
    expect(getActiveRetrievalIndexRows(database)).toEqual([
      expect.objectContaining({ scopeKey: 'chapter-range:2:2', scopeStartChapter: 2, scopeEndChapter: 2 }),
    ])
  }, 120000)

  it('creates scoped retrieval table rows with the current embedding model without replacing the full table', async () => {
    const { aiSettings, database, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-scoped-model-replacement')

    database.prepare(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, summary,
        revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('chapter-2', 'novel-001', 'novel-001:main', 2, '第2章', '第2章原文', '第2章摘要', 1, 0, null, 'hash-2', 'ready')
    database.prepare(
      `INSERT INTO TextSpan (
        id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd,
        charStart, charEnd, text, spanType, tokenEstimate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('span-4', 'novel-001', 'novel-001:main', 'chapter-2', 2, 1, 1, 0, 9, '第二章原文内容。', 'paragraph', 8)

    await retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')
    const fullTable = getActiveMockTable(database, mockLanceDb)
    const fullTableName = getActiveMockTableName(database)

    aiSettings.embeddings.ollama.model = 'unit-test-embedding-model-v2'
    const fullDocs = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    const scopedDocs = retrievalIndex.loadRawTextRetrievalDocs('novel-001', 'novel-001:main', { startChapter: 2, endChapter: 2 })
    const progressEvents: Array<{ totalRows: number }> = []

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main', {
      chapterRange: { startChapter: 2, endChapter: 2 },
      onProgress: (progress) => {
        progressEvents.push(progress)
      },
    })).resolves.toMatchObject({
      rowCount: scopedDocs.length + 2,
    })

    expect(progressEvents).toContainEqual(expect.objectContaining({
      totalRows: scopedDocs.length + 2,
    }))
    expect(progressEvents.find((progress) => progress.totalRows === fullDocs.length)).toBeUndefined()
    expect(mockLanceDb.database.createTable).toHaveBeenCalledTimes(2)
    expect(mockLanceDb.database.dropTable).not.toHaveBeenCalledWith(fullTableName)
    expect(Array.from(mockLanceDb.tables.values())).toContain(fullTable)
    expect(getActiveMockTable(database, mockLanceDb)).toBe(fullTable)
    expect(fullTable?.delete).not.toHaveBeenCalled()

    const secondCreatedRows = mockLanceDb.database.createTable.mock.calls[1]?.[1] as Array<{ id: string; embeddingProvider: string; embeddingModel: string; embeddingDimension: number }> | undefined
    expect(secondCreatedRows?.map((row) => row.id)).toEqual([
      ...scopedDocs.map((row) => row.id),
      'chapter-summary:chapter-1',
      'chapter-summary:chapter-2',
    ])
    expect(secondCreatedRows?.every((row) => row.embeddingProvider === 'ollama' && row.embeddingModel === 'unit-test-embedding-model-v2' && row.embeddingDimension === 3)).toBe(true)
    const currentTable = getScopedMockTable(database, mockLanceDb, 2)
    expect(currentTable?.delete).not.toHaveBeenCalled()
  }, 120000)

  it('ignores legacy Lance metadata while materializing scoped rows from source truth', async () => {
    const { database, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-scoped-legacy-metadata-materialize')

    database.prepare(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, summary,
        revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('chapter-2', 'novel-001', 'novel-001:main', 2, '第2章', '第2章原文', '第2章摘要', 1, 0, null, 'hash-2', 'ready')
    database.prepare(
      `INSERT INTO TextSpan (
        id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd,
        charStart, charEnd, text, spanType, tokenEstimate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('span-4', 'novel-001', 'novel-001:main', 'chapter-2', 2, 1, 1, 0, 9, '第二章原文内容。', 'paragraph', 8)

    await retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')
    const fullTable = getActiveMockTable(database, mockLanceDb)
    const fullTableName = getActiveMockTableName(database)
    for (const row of fullTable?.rows ?? []) {
      delete row.embeddingProvider
      delete row.embeddingModel
      delete row.embeddingDimension
    }

    const fullDocs = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    const scopedDocs = retrievalIndex.loadRawTextRetrievalDocs('novel-001', 'novel-001:main', { startChapter: 2, endChapter: 2 })
    const progressEvents: Array<{ totalRows: number }> = []

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main', {
      chapterRange: { startChapter: 2, endChapter: 2 },
      onProgress: (progress) => {
        progressEvents.push(progress)
      },
    })).resolves.toMatchObject({
      rowCount: scopedDocs.length + 2,
    })

    expect(progressEvents).toContainEqual(expect.objectContaining({
      totalRows: scopedDocs.length + 2,
    }))
    expect(progressEvents.find((progress) => progress.totalRows === fullDocs.length)).toBeUndefined()
    expect(mockLanceDb.database.createTable).toHaveBeenCalledTimes(2)
    expect(mockLanceDb.database.dropTable).not.toHaveBeenCalledWith(fullTableName)
    expect(Array.from(mockLanceDb.tables.values())).toContain(fullTable)
    expect(getActiveMockTable(database, mockLanceDb)).toBe(fullTable)
    const secondCreatedRows = mockLanceDb.database.createTable.mock.calls[1]?.[1] as Array<{ id: string }> | undefined
    expect(secondCreatedRows?.map((row) => row.id)).toEqual([
      ...scopedDocs.map((row) => row.id),
      'chapter-summary:chapter-1',
      'chapter-summary:chapter-2',
    ])
    expect(fullTable?.delete).not.toHaveBeenCalled()
  }, 120000)

  it('preserves the existing full retrieval table when a replacement rebuild fails during embedding', async () => {
    const { aiSettings, database, embedTextsWithOllama, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-full-rebuild-failure-preserves-table')

    await retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')

    const originalTable = getActiveMockTable(database, mockLanceDb)
    expect(originalTable).toBeTruthy()

    aiSettings.embeddings.ollama.model = 'unit-test-embedding-model-v2'
    embedTextsWithOllama.mockClear()
    mockLanceDb.database.createTable.mockClear()
    mockLanceDb.database.dropTable.mockClear()
    embedTextsWithOllama.mockImplementationOnce(async () => {
      throw new Error('embedding failed before table replacement')
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).rejects.toThrow('embedding failed before table replacement')

    expect(embedTextsWithOllama).toHaveBeenCalledTimes(1)
    expect(mockLanceDb.database.createTable).not.toHaveBeenCalled()
    expect(mockLanceDb.database.dropTable).not.toHaveBeenCalled()
    expect(Array.from(mockLanceDb.tables.values())).toHaveLength(1)
    expect(Array.from(mockLanceDb.tables.values())[0]).toBe(originalTable)
    await expect(retrievalIndex.hasBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toBe(true)

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length,
    })
    await expect(retrievalIndex.hasBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toBe(true)
  }, 120000)

  it('retries a real-style disabled Ollama runner EOF result and still writes cache and table rows', async () => {
    const { database, embedTextsWithOllama, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-ollama-runner-eof-retry')

    const mergedDocs = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    const runnerEofError = String.raw`Ollama embedding HTTP 400: {"error":"do embedding request: Post \"http://127.0.0.1:58591/v1/embeddings\": EOF"}`

    embedTextsWithOllama.mockResolvedValueOnce({
      enabled: false,
      embeddings: [],
      model: 'unit-test-embedding-model',
      error: runnerEofError,
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: mergedDocs.length,
    })

    expect(embedTextsWithOllama).toHaveBeenCalledTimes(2)
    expect(Array.isArray(embedTextsWithOllama.mock.calls[0]?.[0]) ? embedTextsWithOllama.mock.calls[0][0] : []).toHaveLength(mergedDocs.length)
    expect(mockLanceDb.database.createTable).toHaveBeenCalledTimes(1)
    expect(
      (mockLanceDb.database.createTable.mock.calls[0]?.[1] as Array<{ id: string }> | undefined)?.map((row) => row.id)
    ).toEqual(mergedDocs.map((row) => row.id))
    expect(getActiveMockTable(database, mockLanceDb)?.rows).toHaveLength(mergedDocs.length)
    expect(database.prepare('SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ?').get('novel-001:main')).toMatchObject({
      count: mergedDocs.length,
    })
  })

  it('splits an exhausted two-row Ollama EOF batch into ordered singleton leaves', async () => {
    const {
      database,
      embedTextsWithOllama,
      mockLanceDb,
      retrievalCache,
      retrievalIndex,
      withNovelDatabase,
    } = await createRetrievalIndexHarness('retale-retrieval-index-ollama-two-row-eof-split')
    const mergedDocs = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    const cachedInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(mergedDocs[0]).text
    await withNovelDatabase(() => retrievalCache.upsertRawTextEmbeddingCacheEntries({
      scope: {
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        provider: 'ollama',
        model: 'unit-test-embedding-model',
      },
      entries: [{ embeddingInput: cachedInput, vector: [9, 9, 9] }],
    }))
    const runnerEofError = String.raw`Ollama embedding HTTP 400: {"error":"do embedding request: Post \"http://127.0.0.1:58591/v1/embeddings\": EOF"}`
    const callSizes: number[] = []
    const progressEvents: Array<{ embeddedRows: number; completedBatches: number }> = []

    embedTextsWithOllama.mockImplementation(async (input) => {
      const values = Array.isArray(input) ? input : [input]
      callSizes.push(values.length)
      if (values.length > 1) {
        return {
          enabled: false,
          embeddings: [],
          model: 'unit-test-embedding-model',
          error: runnerEofError,
        }
      }
      return {
        enabled: true,
        embeddings: values.map(() => [2, 2, 2]),
        model: 'unit-test-embedding-model',
      }
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main', {
      onProgress: (progress) => {
        if (progress.phase === 'embedding') {
          progressEvents.push(progress)
        }
      },
    })).resolves.toMatchObject({ rowCount: mergedDocs.length })

    expect(callSizes).toEqual([2, 2, 2, 1, 1])
    expect(progressEvents.map(({ embeddedRows, completedBatches }) => ({ embeddedRows, completedBatches }))).toEqual([
      { embeddedRows: 0, completedBatches: 0 },
      { embeddedRows: 0, completedBatches: 0 },
      { embeddedRows: 1, completedBatches: 0 },
      { embeddedRows: 2, completedBatches: 0 },
      { embeddedRows: 2, completedBatches: 1 },
    ])
    expect(progressEvents.filter((progress) => progress.completedBatches === 1)).toHaveLength(1)
    expect(
      (mockLanceDb.database.createTable.mock.calls[0]?.[1] as Array<{ id: string }> | undefined)?.map((row) => row.id)
    ).toEqual(mergedDocs.map((row) => row.id))
  })

  it('keeps recovery heartbeats nondecreasing when an initially cached row requires deferred re-embedding', async () => {
    const {
      embedTextsWithOllama,
      retrievalCache,
      retrievalIndex,
      withNovelDatabase,
    } = await createRetrievalIndexHarness('retale-retrieval-index-ollama-recovery-heartbeat-deferred-cache')
    const mergedDocs = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    const cachedInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(mergedDocs[0]).text
    await withNovelDatabase(() => retrievalCache.upsertRawTextEmbeddingCacheEntries({
      scope: {
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        provider: 'ollama',
        model: 'unit-test-embedding-model',
      },
      entries: [{ embeddingInput: cachedInput, vector: [9, 9] }],
    }))
    const runnerEofError = String.raw`Ollama embedding HTTP 400: {"error":"do embedding request: Post \"http://127.0.0.1:58591/v1/embeddings\": EOF"}`
    const callSizes: number[] = []
    const progressEvents: Array<{ embeddedRows: number; completedBatches: number }> = []

    embedTextsWithOllama.mockImplementation(async (input) => {
      const values = Array.isArray(input) ? input : [input]
      callSizes.push(values.length)
      if (values.length > 1) {
        return {
          enabled: false,
          embeddings: [],
          model: 'unit-test-embedding-model',
          error: runnerEofError,
        }
      }
      return {
        enabled: true,
        embeddings: [[3, 3, 3]],
        model: 'unit-test-embedding-model',
      }
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main', {
      onProgress: (progress) => {
        if (progress.phase === 'embedding') {
          progressEvents.push(progress)
        }
      },
    })).resolves.toMatchObject({ rowCount: mergedDocs.length })

    expect(callSizes).toEqual([2, 2, 2, 1, 1, 1])
    expect(progressEvents.map((progress) => progress.embeddedRows)).toEqual([0, 0, 1, 2, 2, 3])
    expect(progressEvents.map((progress) => progress.completedBatches)).toEqual([0, 0, 0, 0, 1, 2])
    expect(progressEvents.map((progress) => progress.embeddedRows).every((count, index, counts) => (
      count <= mergedDocs.length && (index === 0 || count >= counts[index - 1])
    ))).toBe(true)
    expect(progressEvents.slice(0, -1).every((progress) => progress.embeddedRows < mergedDocs.length)).toBe(true)
    expect(progressEvents.at(-1)?.embeddedRows).toBe(mergedDocs.length)
  })

  it('recursively splits exhausted Ollama EOF batches into contiguous ordered leaves with bounded calls', async () => {
    const { database, embedTextsWithOllama, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-ollama-recursive-eof-split')
    database.prepare(
      `INSERT INTO KnowledgeWorld (
        id, novelId, branchId, term, category, definition, firstSeenChapter,
        validFromChapter, validUntilChapter, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('world-recursive-split', 'novel-001', 'novel-001:main', '递归分割设定', '设定', '递归分割测试定义', 1, 1, 999999999, 'ready')
    const mergedDocs = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    const canonicalInputs = mergedDocs.map((row) => retrievalIndex.buildRawTextRetrievalEmbeddingInput(row).text)
    expect(mergedDocs).toHaveLength(4)
    const runnerEofError = String.raw`Ollama embedding HTTP 400: {"error":"do embedding request: Post \"http://127.0.0.1:58591/v1/embeddings\": EOF"}`
    const calls: string[][] = []

    embedTextsWithOllama.mockImplementation(async (input) => {
      const values = Array.isArray(input) ? input : [input]
      calls.push([...values])
      if (values.length > 1) {
        return {
          enabled: false,
          embeddings: [],
          model: 'unit-test-embedding-model',
          error: runnerEofError,
        }
      }
      const inputIndex = canonicalInputs.indexOf(values[0])
      return {
        enabled: true,
        embeddings: [[inputIndex + 1, inputIndex + 1, inputIndex + 1]],
        model: 'unit-test-embedding-model',
      }
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: mergedDocs.length,
    })

    expect(calls.map((call) => call.length)).toEqual([4, 4, 4, 2, 2, 2, 1, 1, 2, 2, 2, 1, 1])
    expect(calls.slice(0, 3)).toEqual([canonicalInputs, canonicalInputs, canonicalInputs])
    expect(calls.slice(3, 6)).toEqual([
      canonicalInputs.slice(0, 2),
      canonicalInputs.slice(0, 2),
      canonicalInputs.slice(0, 2),
    ])
    expect(calls[6]).toEqual([canonicalInputs[0]])
    expect(calls[7]).toEqual([canonicalInputs[1]])
    expect(calls.slice(8, 11)).toEqual([
      canonicalInputs.slice(2),
      canonicalInputs.slice(2),
      canonicalInputs.slice(2),
    ])
    expect(calls[11]).toEqual([canonicalInputs[2]])
    expect(calls[12]).toEqual([canonicalInputs[3]])
    const storedRows = mockLanceDb.database.createTable.mock.calls[0]?.[1] as Array<{ id: string; vector: number[] }>
    expect(storedRows.map((row) => row.id)).toEqual(mergedDocs.map((row) => row.id))
    expect(storedRows.map((row) => row.vector[0])).toEqual([1, 2, 3, 4])
  }, 120000)

  it('repairs a split singleton fallback under the canonical hash on the next healthy rebuild', async () => {
    const {
      aiSettings,
      database,
      embedTextsWithOllama,
      retrievalCache,
      retrievalIndex,
      withNovelDatabase,
    } = await createRetrievalIndexHarness('retale-retrieval-index-ollama-split-singleton-fallback-cache')
    aiSettings.embeddings.embeddingBatchSize = 16
    const fixture = seedLongWorldFallbackFixture(database, 'split-leaf')
    const mergedDocs = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    const longDoc = mergedDocs.find((row) => row.id === fixture.docId)
    expect(longDoc).toBeTruthy()
    const liveDocs = [mergedDocs[0], longDoc!]
    const cachedDocs = mergedDocs.filter((row) => !liveDocs.includes(row))
    await withNovelDatabase(() => retrievalCache.upsertRawTextEmbeddingCacheEntries({
      scope: {
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        provider: 'ollama',
        model: 'unit-test-embedding-model',
      },
      entries: cachedDocs.map((row) => ({
        embeddingInput: retrievalIndex.buildRawTextRetrievalEmbeddingInput(row).text,
        vector: [9, 9, 9],
      })),
    }))
    const longInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(longDoc!).text
    const longInputHash = retrievalCache.buildEmbeddingInputHash(longInput)
    const runnerEofError = String.raw`Ollama embedding HTTP 400: {"error":"do embedding request: Post \"http://127.0.0.1:58591/v1/embeddings\": EOF"}`
    const callSizes: number[] = []
    const longAttempts: string[] = []

    embedTextsWithOllama.mockImplementation(async (input) => {
      const values = Array.isArray(input) ? input : [input]
      callSizes.push(values.length)
      if (values.length > 1) {
        return {
          enabled: false,
          embeddings: [],
          model: aiSettings.embeddings.ollama.model,
          error: runnerEofError,
        }
      }
      if (values[0]?.includes(fixture.term)) {
        longAttempts.push(values[0])
        if (longAttempts.length === 1) {
          return {
            enabled: false,
            embeddings: [],
            model: aiSettings.embeddings.ollama.model,
            error: runnerEofError,
          }
        }
      }
      return {
        enabled: true,
        embeddings: values.map(() => [5, 5, 5]),
        model: aiSettings.embeddings.ollama.model,
      }
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: mergedDocs.length,
    })

    expect(callSizes).toEqual([2, 2, 2, 1, 1, 1])
    expect(longAttempts[0]).toBe(longInput)
    expect(Array.from(longAttempts[1]).length).toBeLessThanOrEqual(1800)
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ? AND embeddingInputHash = ?'
    ).get('novel-001:main', longInputHash)).toMatchObject({ count: 0 })

    embedTextsWithOllama.mockClear()
    embedTextsWithOllama.mockResolvedValue({
      enabled: true,
      embeddings: [[6, 6, 6]],
      model: aiSettings.embeddings.ollama.model,
    })
    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: mergedDocs.length,
    })
    expect(embedTextsWithOllama).toHaveBeenCalledTimes(1)
    expect(embedTextsWithOllama).toHaveBeenCalledWith([longInput], expect.any(Object))
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ? AND embeddingInputHash = ?'
    ).get('novel-001:main', longInputHash)).toMatchObject({ count: 1 })

    embedTextsWithOllama.mockClear()
    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: mergedDocs.length,
    })
    expect(embedTextsWithOllama).not.toHaveBeenCalled()
  }, 120000)

  it('durably reuses successful split leaves after a later leaf fails without publishing a table', async () => {
    const {
      database,
      embedTextsWithOllama,
      mockLanceDb,
      retrievalCache,
      retrievalIndex,
      withNovelDatabase,
    } = await createRetrievalIndexHarness('retale-retrieval-index-ollama-partial-split-cache-reuse')
    const mergedDocs = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    const cachedDoc = mergedDocs[0]
    const liveDocs = mergedDocs.slice(1)
    const leftInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(liveDocs[0]).text
    const rightInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(liveDocs[1]).text
    const leftHash = retrievalCache.buildEmbeddingInputHash(leftInput)
    const rightHash = retrievalCache.buildEmbeddingInputHash(rightInput)
    await withNovelDatabase(() => retrievalCache.upsertRawTextEmbeddingCacheEntries({
      scope: {
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        provider: 'ollama',
        model: 'unit-test-embedding-model',
      },
      entries: [{
        embeddingInput: retrievalIndex.buildRawTextRetrievalEmbeddingInput(cachedDoc).text,
        vector: [9, 9, 9],
      }],
    }))
    const runnerEofError = String.raw`Ollama embedding HTTP 400: {"error":"do embedding request: Post \"http://127.0.0.1:58591/v1/embeddings\": EOF"}`
    const callSizes: number[] = []

    embedTextsWithOllama.mockImplementation(async (input) => {
      const values = Array.isArray(input) ? input : [input]
      callSizes.push(values.length)
      if (values.length > 1 || values[0] === rightInput) {
        return {
          enabled: false,
          embeddings: [],
          model: 'unit-test-embedding-model',
          error: runnerEofError,
        }
      }
      return {
        enabled: true,
        embeddings: [[7, 7, 7]],
        model: 'unit-test-embedding-model',
      }
    })

    const failedRebuild = retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')
    await expect(failedRebuild).rejects.toThrow(
      new RegExp(`batchSize=1, preview=id=${liveDocs[1].id}.*EOF`)
    )
    await expect(failedRebuild).rejects.toMatchObject({
      cause: expect.objectContaining({ message: runnerEofError }),
    })

    expect(callSizes).toEqual([2, 2, 2, 1, 1])
    expect(mockLanceDb.database.createTable).not.toHaveBeenCalled()
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ? AND embeddingInputHash = ?'
    ).get('novel-001:main', leftHash)).toMatchObject({ count: 1 })
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ? AND embeddingInputHash = ?'
    ).get('novel-001:main', rightHash)).toMatchObject({ count: 0 })

    embedTextsWithOllama.mockClear()
    embedTextsWithOllama.mockResolvedValue({
      enabled: true,
      embeddings: [[8, 8, 8]],
      model: 'unit-test-embedding-model',
    })
    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: mergedDocs.length,
    })
    expect(embedTextsWithOllama).toHaveBeenCalledTimes(1)
    expect(embedTextsWithOllama).toHaveBeenCalledWith([rightInput], expect.any(Object))
    expect(mockLanceDb.database.createTable).toHaveBeenCalledTimes(1)
  }, 120000)

  it('repairs a direct singleton fallback under the canonical hash on the next healthy rebuild', async () => {
    const { aiSettings, database, embedTextsWithOllama, retrievalCache, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-ollama-singleton-1800-fallback')
    aiSettings.embeddings.embeddingBatchSize = 1
    const fixture = seedLongWorldFallbackFixture(database, '1800')
    const longDoc = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
      .find((row) => row.id === fixture.docId)
    expect(longDoc).toBeTruthy()
    const fullInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(longDoc!).text
    const fullInputHash = retrievalCache.buildEmbeddingInputHash(fullInput)
    const runnerEofError = String.raw`Ollama embedding HTTP 400: {"error":"do embedding request: Post \"http://127.0.0.1:58591/v1/embeddings\": EOF"}`
    const longAttempts: string[] = []

    embedTextsWithOllama.mockImplementation(async (input) => {
      const values = Array.isArray(input) ? input : [input]
      if (values[0]?.includes(fixture.term)) {
        longAttempts.push(values[0])
        if (longAttempts.length === 1) {
          return {
            enabled: false,
            embeddings: [],
            model: aiSettings.embeddings.ollama.model,
            error: runnerEofError,
          }
        }
      }
      return {
        enabled: true,
        embeddings: values.map(() => [2, 2, 2]),
        model: aiSettings.embeddings.ollama.model,
      }
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length,
    })

    expect(longAttempts).toHaveLength(2)
    expect(longAttempts[0]).toBe(fullInput)
    expect(Array.from(fullInput).length).toBeGreaterThan(1800)
    expect(Array.from(longAttempts[1]).length).toBeLessThanOrEqual(1800)
    expect(longAttempts[1].startsWith(Array.from(fullInput).slice(0, 64).join(''))).toBe(true)
    expect(longAttempts[1].endsWith(Array.from(fullInput).slice(-64).join(''))).toBe(true)
    expect(longAttempts[1]).toContain('😀')
    expect(Buffer.from(longAttempts[1], 'utf8').toString('utf8')).toBe(longAttempts[1])
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ? AND embeddingInputHash = ?'
    ).get('novel-001:main', fullInputHash)).toMatchObject({ count: 0 })

    embedTextsWithOllama.mockClear()
    embedTextsWithOllama.mockResolvedValue({
      enabled: true,
      embeddings: [[4, 4, 4]],
      model: aiSettings.embeddings.ollama.model,
    })
    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length,
    })
    expect(embedTextsWithOllama).toHaveBeenCalledTimes(1)
    expect(embedTextsWithOllama).toHaveBeenCalledWith([fullInput], expect.any(Object))
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ? AND embeddingInputHash = ?'
    ).get('novel-001:main', fullInputHash)).toMatchObject({ count: 1 })

    embedTextsWithOllama.mockClear()
    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length,
    })
    expect(embedTextsWithOllama).not.toHaveBeenCalled()
  })

  it('reduces a long Ollama singleton to 1200 code points after two runner EOF responses', async () => {
    const { aiSettings, database, embedTextsWithOllama, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-ollama-singleton-1200-fallback')
    aiSettings.embeddings.embeddingBatchSize = 1
    const fixture = seedLongWorldFallbackFixture(database, '1200')
    const longDoc = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
      .find((row) => row.id === fixture.docId)
    expect(longDoc).toBeTruthy()
    const fullInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(longDoc!).text
    const runnerEofError = String.raw`Ollama embedding HTTP 400: {"error":"do embedding request: Post \"http://127.0.0.1:58591/v1/embeddings\": EOF"}`
    const longAttempts: string[] = []

    embedTextsWithOllama.mockImplementation(async (input) => {
      const values = Array.isArray(input) ? input : [input]
      if (values[0]?.includes(fixture.term)) {
        longAttempts.push(values[0])
        if (longAttempts.length <= 2) {
          return {
            enabled: false,
            embeddings: [],
            model: aiSettings.embeddings.ollama.model,
            error: runnerEofError,
          }
        }
      }
      return {
        enabled: true,
        embeddings: values.map(() => [3, 3, 3]),
        model: aiSettings.embeddings.ollama.model,
      }
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length,
    })

    expect(longAttempts).toHaveLength(3)
    expect(longAttempts[0]).toBe(fullInput)
    expect(Array.from(longAttempts[1]).length).toBeLessThanOrEqual(1800)
    expect(Array.from(longAttempts[2]).length).toBeLessThanOrEqual(1200)
    expect(longAttempts[2].startsWith(Array.from(fullInput).slice(0, 64).join(''))).toBe(true)
    expect(longAttempts[2].endsWith(Array.from(fullInput).slice(-64).join(''))).toBe(true)
    expect(longAttempts[2]).toContain('😀')
    expect(Buffer.from(longAttempts[2], 'utf8').toString('utf8')).toBe(longAttempts[2])
  })

  it('skips the no-op 1800 cap for an exact 1800-code-point singleton and retries at 1200', async () => {
    const harness = await createRetrievalIndexHarness('retale-retrieval-index-ollama-singleton-exact-1800')
    harness.aiSettings.embeddings.embeddingBatchSize = 1
    const fixture = seedWorldWithExactEmbeddingInputCodePoints(harness.database, harness.retrievalIndex, 'exact-1800', 1800)
    await cacheRetrievalDocsExcept(harness, fixture.docId)
    const runnerEofError = String.raw`Ollama embedding HTTP 400: {"error":"do embedding request: Post \"http://127.0.0.1:58591/v1/embeddings\": EOF"}`
    const attempts: string[] = []

    harness.embedTextsWithOllama.mockImplementation(async (input) => {
      const values = Array.isArray(input) ? input : [input]
      attempts.push(values[0])
      if (attempts.length === 1) {
        return {
          enabled: false,
          embeddings: [],
          model: harness.aiSettings.embeddings.ollama.model,
          error: runnerEofError,
        }
      }
      return {
        enabled: true,
        embeddings: [[3, 3, 3]],
        model: harness.aiSettings.embeddings.ollama.model,
      }
    })

    await expect(harness.retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: harness.retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length,
    })

    expect(attempts).toHaveLength(2)
    expect(attempts[0]).toBe(fixture.input)
    expect(attempts.map((input) => Array.from(input).length)).toEqual([1800, 1200])
    expect(attempts[1]).not.toBe(attempts[0])
  })

  it('surfaces an exact EOF immediately for an exact 1200-code-point singleton', async () => {
    const harness = await createRetrievalIndexHarness('retale-retrieval-index-ollama-singleton-exact-1200')
    harness.aiSettings.embeddings.embeddingBatchSize = 1
    const fixture = seedWorldWithExactEmbeddingInputCodePoints(harness.database, harness.retrievalIndex, 'exact-1200', 1200)
    await cacheRetrievalDocsExcept(harness, fixture.docId)
    const runnerEofError = String.raw`Ollama embedding HTTP 400: {"error":"do embedding request: Post \"http://127.0.0.1:58591/v1/embeddings\": EOF"}`
    const attempts: string[] = []

    harness.embedTextsWithOllama.mockImplementation(async (input) => {
      const values = Array.isArray(input) ? input : [input]
      attempts.push(values[0])
      return {
        enabled: false,
        embeddings: [],
        model: harness.aiSettings.embeddings.ollama.model,
        error: runnerEofError,
      }
    })

    const rebuild = harness.retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')
    await expect(rebuild).rejects.toThrow(new RegExp(`batchSize=1, preview=id=${fixture.docId}.*EOF`))
    await expect(rebuild).rejects.toMatchObject({
      cause: expect.objectContaining({ message: runnerEofError }),
    })

    expect(attempts).toEqual([fixture.input])
    expect(Array.from(attempts[0]).length).toBe(1200)
  })

  it('surfaces an exact EOF immediately for a singleton below 1200 code points', async () => {
    const harness = await createRetrievalIndexHarness('retale-retrieval-index-ollama-singleton-below-1200')
    harness.aiSettings.embeddings.embeddingBatchSize = 1
    const fixture = seedWorldWithExactEmbeddingInputCodePoints(harness.database, harness.retrievalIndex, 'below-1200', 1199)
    await cacheRetrievalDocsExcept(harness, fixture.docId)
    const runnerEofError = String.raw`Ollama embedding HTTP 400: {"error":"do embedding request: Post \"http://127.0.0.1:58591/v1/embeddings\": EOF"}`
    const attempts: string[] = []

    harness.embedTextsWithOllama.mockImplementation(async (input) => {
      const values = Array.isArray(input) ? input : [input]
      attempts.push(values[0])
      return {
        enabled: false,
        embeddings: [],
        model: harness.aiSettings.embeddings.ollama.model,
        error: runnerEofError,
      }
    })

    const rebuild = harness.retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')
    await expect(rebuild).rejects.toThrow(new RegExp(`batchSize=1, preview=id=${fixture.docId}.*EOF`))
    await expect(rebuild).rejects.toMatchObject({
      cause: expect.objectContaining({ message: runnerEofError }),
    })

    expect(attempts).toEqual([fixture.input])
    expect(Array.from(attempts[0]).length).toBe(1199)
  })

  it('retries a generic long singleton failure without changing the attempted input', async () => {
    const { aiSettings, database, embedTextsWithOllama, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-generic-singleton-retry-input')
    aiSettings.embeddings.embeddingBatchSize = 1
    const fixture = seedLongWorldFallbackFixture(database, 'generic')
    const longDoc = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
      .find((row) => row.id === fixture.docId)
    expect(longDoc).toBeTruthy()
    const fullInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(longDoc!).text
    const longAttempts: string[] = []

    embedTextsWithOllama.mockImplementation(async (input) => {
      const values = Array.isArray(input) ? input : [input]
      if (values[0]?.includes(fixture.term)) {
        longAttempts.push(values[0])
        throw new Error('fetch failed')
      }
      return {
        enabled: true,
        embeddings: values.map(() => [4, 4, 4]),
        model: aiSettings.embeddings.ollama.model,
      }
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).rejects.toThrow('fetch failed')

    expect(longAttempts).toEqual([fullInput, fullInput, fullInput])
    expect(mockLanceDb.database.createTable).not.toHaveBeenCalled()
  })

  it('does not retry an ordinary disabled Ollama HTTP 400 result', async () => {
    const { database, embedTextsWithOllama, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-ollama-permanent-http-400')

    embedTextsWithOllama.mockResolvedValueOnce({
      enabled: false,
      embeddings: [],
      model: 'unit-test-embedding-model',
      error: 'Ollama embedding HTTP 400: {"error":"model not found"}',
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).rejects.toThrow(
      'Ollama embedding HTTP 400: {"error":"model not found"}'
    )

    expect(embedTextsWithOllama).toHaveBeenCalledTimes(1)
    expect(embedTextsWithOllama.mock.calls[0]?.[0]).toHaveLength(3)
    expect(mockLanceDb.database.createTable).not.toHaveBeenCalled()
    expect(database.prepare('SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ?').get('novel-001:main')).toMatchObject({
      count: 0,
    })
  })

  it('reuses successful singleton embeddings after the last Ollama runner EOF batch exhausts retries', async () => {
    const { aiSettings, database, embedTextsWithOllama, mockLanceDb, retrievalCache, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-singleton-late-runner-eof-cache-reuse')
    aiSettings.embeddings.embeddingBatchSize = 1
    const fixture = seedLongWorldFallbackFixture(database, 'exhausted')

    const mergedDocs = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    const failedDoc = mergedDocs.find((row) => row.id === fixture.docId)
    expect(failedDoc).toBeTruthy()
    const failedInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(failedDoc!).text
    const failedInputHash = retrievalCache.buildEmbeddingInputHash(failedInput)
    const runnerEofError = String.raw`Ollama embedding HTTP 400: {"error":"do embedding request: Post \"http://127.0.0.1:58591/v1/embeddings\": EOF"}`
    const failedAttempts: string[] = []

    embedTextsWithOllama.mockImplementation(async (input) => {
      const values = Array.isArray(input) ? input : [input]
      if (values[0]?.includes(fixture.term)) {
        failedAttempts.push(values[0])
        return {
          enabled: false,
          embeddings: [],
          model: aiSettings.embeddings.ollama.model,
          error: runnerEofError,
        }
      }
      return {
        enabled: true,
        embeddings: values.map(() => [2, 2, 2]),
        model: aiSettings.embeddings.ollama.model,
      }
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).rejects.toThrow(runnerEofError)

    expect(embedTextsWithOllama).toHaveBeenCalledTimes(mergedDocs.length + 2)
    expect(failedAttempts).toHaveLength(3)
    expect(failedAttempts[0]).toBe(failedInput)
    expect(Array.from(failedAttempts[1]).length).toBeLessThanOrEqual(1800)
    expect(Array.from(failedAttempts[2]).length).toBeLessThanOrEqual(1200)
    expect(mockLanceDb.database.createTable).not.toHaveBeenCalled()
    expect(database.prepare('SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ?').get('novel-001:main')).toMatchObject({
      count: mergedDocs.length - 1,
    })
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ? AND embeddingInputHash = ?'
    ).get('novel-001:main', failedInputHash)).toMatchObject({ count: 0 })

    embedTextsWithOllama.mockClear()
    embedTextsWithOllama.mockImplementation(async (input) => {
      const values = Array.isArray(input) ? input : [input]
      return {
        enabled: true,
        embeddings: values.map(() => [6, 6, 6]),
        model: aiSettings.embeddings.ollama.model,
      }
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: mergedDocs.length,
    })

    expect(embedTextsWithOllama).toHaveBeenCalledTimes(1)
    expect(embedTextsWithOllama).toHaveBeenCalledWith([failedInput], aiSettings.embeddings.ollama)
    expect(mockLanceDb.database.createTable).toHaveBeenCalledTimes(1)
    expect(database.prepare('SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ?').get('novel-001:main')).toMatchObject({
      count: mergedDocs.length,
    })
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ? AND embeddingInputHash = ?'
    ).get('novel-001:main', failedInputHash)).toMatchObject({ count: 1 })
  })

  it('splits long Ollama final embedding batches by input size', async () => {
    const { aiSettings, database, embedTextsWithOllama, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-long-ollama-embedding-batches')
    aiSettings.embeddings.embeddingBatchSize = 32

    const insertWorld = database.prepare(
      `INSERT INTO KnowledgeWorld (
        id, novelId, branchId, term, category, definition, firstSeenChapter,
        validFromChapter, validUntilChapter, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (let index = 0; index < 6; index += 1) {
      insertWorld.run(
        `world-long-${index}`,
        'novel-001',
        'novel-001:main',
        `超长设定${index}`,
        '设定',
        `超长设定${index}${'甲'.repeat(3500)}`,
        1,
        1,
        999999999,
        'ready',
      )
    }

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length,
    })

    const embeddingCalls = embedTextsWithOllama.mock.calls
      .map((call) => call[0])
      .map((input) => (Array.isArray(input) ? input : [input]))
    const longWorldCalls = embeddingCalls.filter((input) => input.some((text) => text.includes('超长设定')))
    expect(longWorldCalls.length).toBeGreaterThan(1)
    expect(longWorldCalls.every((input) => input.length < 6)).toBe(true)
    for (const input of embeddingCalls) {
      const totalChars = input.reduce((sum, text) => sum + text.length, 0)
      if (input.length > 1) {
        expect(totalChars).toBeLessThanOrEqual(6000)
      }
    }
    expect(mockLanceDb.database.createTable).toHaveBeenCalledTimes(1)
  })

  it('surfaces batch context after retryable retrieval embedding failures exhaust retries', async () => {
    const { embedTextsWithOllama, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-final-rebuild-retry-context')

    const mergedDocs = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    embedTextsWithOllama.mockRejectedValue(new Error(
      'Ollama embedding fetch failed (endpoint=http://127.0.0.1:11434/api/embed, baseUrl=http://127.0.0.1:11434, model=unit-test-embedding-model, inputCount=3, timeoutMs=600000, causeName=SocketError, causeCode=ECONNRESET, causeMessage=socket hang up): fetch failed'
    ))

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).rejects.toThrow(
      /Failed to generate retrieval embeddings for batchSize=3, preview=id=.*source=.*chapter=.*fetch failed/
    )

    expect(embedTextsWithOllama).toHaveBeenCalledTimes(3)
    expect(embedTextsWithOllama.mock.calls.map((call) => call[0])).toEqual([
      expect.arrayContaining(mergedDocs.map((row) => retrievalIndex.buildRawTextRetrievalEmbeddingInput(row).text)),
      expect.arrayContaining(mergedDocs.map((row) => retrievalIndex.buildRawTextRetrievalEmbeddingInput(row).text)),
      expect.arrayContaining(mergedDocs.map((row) => retrievalIndex.buildRawTextRetrievalEmbeddingInput(row).text)),
    ])
    expect(mockLanceDb.database.createTable).not.toHaveBeenCalled()
    expect(mergedDocs).toHaveLength(3)
  })

  it('preserves the existing retrieval table when scoped materialization fails during embedding', async () => {
    const { aiSettings, database, embedTextsWithOllama, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-scoped-materialization-failure-preserves-table')

    database.prepare(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, summary,
        revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('chapter-2', 'novel-001', 'novel-001:main', 2, '第2章', '第2章原文', '第2章摘要', 1, 0, null, 'hash-2', 'ready')
    database.prepare(
      `INSERT INTO TextSpan (
        id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd,
        charStart, charEnd, text, spanType, tokenEstimate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('span-4', 'novel-001', 'novel-001:main', 'chapter-2', 2, 1, 1, 0, 9, '第二章原文内容。', 'paragraph', 8)

    await retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')

    const originalTable = getActiveMockTable(database, mockLanceDb)
    expect(originalTable).toBeTruthy()

    aiSettings.embeddings.ollama.model = 'unit-test-embedding-model-v2'
    embedTextsWithOllama.mockClear()
    mockLanceDb.database.createTable.mockClear()
    mockLanceDb.database.dropTable.mockClear()
    embedTextsWithOllama.mockImplementationOnce(async () => {
      throw new Error('scoped embedding failed before table replacement')
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main', {
      chapterRange: { startChapter: 2, endChapter: 2 },
    })).rejects.toThrow('scoped embedding failed before table replacement')

    expect(embedTextsWithOllama).toHaveBeenCalledTimes(1)
    expect(mockLanceDb.database.createTable).not.toHaveBeenCalled()
    expect(mockLanceDb.database.dropTable).not.toHaveBeenCalled()
    expect(Array.from(mockLanceDb.tables.values())).toHaveLength(1)
    expect(Array.from(mockLanceDb.tables.values())[0]).toBe(originalTable)
    expect(originalTable?.delete).not.toHaveBeenCalled()
    await expect(retrievalIndex.hasBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toBe(true)

    const scopedDocs = retrievalIndex.loadRawTextRetrievalDocs('novel-001', 'novel-001:main', { startChapter: 2, endChapter: 2 })
    const progressEvents: Array<{ totalRows: number }> = []
    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main', {
      chapterRange: { startChapter: 2, endChapter: 2 },
      onProgress: (progress) => {
        progressEvents.push(progress)
      },
    })).resolves.toMatchObject({
      rowCount: scopedDocs.length + 2,
    })
    expect(progressEvents).toContainEqual(expect.objectContaining({
      totalRows: scopedDocs.length + 2,
    }))
    await expect(retrievalIndex.hasBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toBe(true)
  }, 120000)

  it('preserves the existing retrieval table when final table replacement fails', async () => {
    const { aiSettings, database, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-final-replacement-failure-preserves-table')

    database.prepare(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, summary,
        revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('chapter-2', 'novel-001', 'novel-001:main', 2, '第2章', '第2章原文', '第2章摘要', 1, 0, null, 'hash-2', 'ready')
    database.prepare(
      `INSERT INTO TextSpan (
        id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd,
        charStart, charEnd, text, spanType, tokenEstimate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('span-4', 'novel-001', 'novel-001:main', 'chapter-2', 2, 1, 1, 0, 9, '第二章原文内容。', 'paragraph', 8)

    await retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')
    const originalTable = getActiveMockTable(database, mockLanceDb)
    expect(originalTable).toBeTruthy()

    aiSettings.embeddings.ollama.model = 'unit-test-embedding-model-v2'
    mockLanceDb.database.createTable.mockClear()
    mockLanceDb.database.dropTable.mockClear()
    mockLanceDb.database.createTable.mockImplementationOnce(async () => {
      throw new Error('final table replacement failed')
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main', {
      chapterRange: { startChapter: 2, endChapter: 2 },
    })).rejects.toThrow('final table replacement failed')

    expect(mockLanceDb.database.createTable).toHaveBeenCalledTimes(1)
    expect(mockLanceDb.database.dropTable).not.toHaveBeenCalled()
    expect(Array.from(mockLanceDb.tables.values())).toHaveLength(1)
    expect(Array.from(mockLanceDb.tables.values())[0]).toBe(originalTable)
    expect(getActiveMockTable(database, mockLanceDb)).toBe(originalTable)
    expect(originalTable?.delete).not.toHaveBeenCalled()
    await expect(retrievalIndex.hasBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toBe(true)
  }, 120000)

  it('keeps the previous table active when a new versioned table write fails after creation', async () => {
    const { aiSettings, database, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-partial-write-failure-preserves-active-table')

    database.prepare(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, summary,
        revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('chapter-2', 'novel-001', 'novel-001:main', 2, '第2章', '第2章原文', '第2章摘要', 1, 0, null, 'hash-2', 'ready')
    database.prepare(
      `INSERT INTO TextSpan (
        id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd,
        charStart, charEnd, text, spanType, tokenEstimate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('span-4', 'novel-001', 'novel-001:main', 'chapter-2', 2, 1, 1, 0, 9, '第二章原文内容。', 'paragraph', 8)

    await retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')
    const originalTable = getActiveMockTable(database, mockLanceDb)
    expect(originalTable).toBeTruthy()

    aiSettings.embeddings.ollama.model = 'unit-test-embedding-model-v2'
    mockLanceDb.database.createTable.mockClear()
    mockLanceDb.database.dropTable.mockClear()
    originalTable?.delete.mockClear()
    originalTable?.add.mockClear()

    mockLanceDb.database.createTable.mockImplementationOnce(async (name: string, rows: Array<Record<string, unknown>>) => {
      const table = {
        rows: [...rows],
        add: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
        createIndex: vi.fn(async () => undefined),
        waitForIndex: vi.fn(async () => undefined),
        query: () => ({
          limit: () => ({
            toArray: async () => table.rows.slice(0, 1),
          }),
        }),
      }
      mockLanceDb.tables.set(name, table)
      throw new Error('versioned Lance write failed after creating table')
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main', {
      chapterRange: { startChapter: 2, endChapter: 2 },
    })).rejects.toThrow('versioned Lance write failed after creating table')

    expect(mockLanceDb.database.createTable).toHaveBeenCalledTimes(1)
    expect(mockLanceDb.database.dropTable).toHaveBeenCalledTimes(1)
    expect(Array.from(mockLanceDb.tables.values())).toHaveLength(1)
    expect(getActiveMockTable(database, mockLanceDb)).toBe(originalTable)
    expect(getLatestMockTable(mockLanceDb)).toBe(originalTable)
    expect(originalTable?.delete).not.toHaveBeenCalled()
    expect(originalTable?.add).not.toHaveBeenCalled()
    await expect(retrievalIndex.hasBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toBe(true)
  }, 120000)

  it('preserves a pending replacement table under the current embedding policy and resumes it on the next rebuild', async () => {
    const { aiSettings, database, embedTextsWithOllama, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-index-failure-preserves-active-table')

    database.prepare(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, summary,
        revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('chapter-2', 'novel-001', 'novel-001:main', 2, '第2章', '第2章原文', '第2章摘要', 1, 0, null, 'hash-2', 'ready')
    database.prepare(
      `INSERT INTO TextSpan (
        id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd,
        charStart, charEnd, text, spanType, tokenEstimate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('span-4', 'novel-001', 'novel-001:main', 'chapter-2', 2, 1, 1, 0, 9, '第二章原文内容。', 'paragraph', 8)

    await retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')
    const originalTable = getActiveMockTable(database, mockLanceDb)
    const originalTableName = getActiveMockTableName(database)
    expect(originalTable).toBeTruthy()

    aiSettings.embeddings.ollama.model = 'unit-test-embedding-model-v2'
    embedTextsWithOllama.mockClear()
    mockLanceDb.database.createTable.mockClear()
    mockLanceDb.database.dropTable.mockClear()
    originalTable?.delete.mockClear()
    originalTable?.add.mockClear()
    let textIndexAttempts = 0

    mockLanceDb.database.createTable.mockImplementationOnce(async (name: string, rows: Array<Record<string, unknown>>) => {
      const table = {
        rows: [...rows],
        add: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
        createIndex: vi.fn(async (column: string) => {
          if (column === 'text' && textIndexAttempts === 0) {
            textIndexAttempts += 1
            throw new Error('Lance index failed')
          }
        }),
        waitForIndex: vi.fn(async () => undefined),
        query: () => ({
          limit: () => ({
            toArray: async () => table.rows.slice(0, 1),
          }),
        }),
      }
      mockLanceDb.tables.set(name, table)
      return table
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).rejects.toThrow('Failed to create LanceDB FTS index: Lance index failed')

    expect(mockLanceDb.database.createTable).toHaveBeenCalledTimes(1)
    expect(embedTextsWithOllama).toHaveBeenCalledTimes(1)
    expect(mockLanceDb.database.dropTable).not.toHaveBeenCalled()
    expect(Array.from(mockLanceDb.tables.values())).toHaveLength(2)
    expect(getActiveMockTableName(database)).toBe(originalTableName)
    expect(getActiveMockTable(database, mockLanceDb)).toBe(originalTable)
    expect(originalTable?.delete).not.toHaveBeenCalled()
    expect(originalTable?.add).not.toHaveBeenCalled()
    const pendingRows = getPendingRetrievalIndexRows(database)
    expect(retrievalIndex.RETRIEVAL_EMBEDDING_POLICY_VERSION).toBe('ollama-eof-fallback-v2')
    expect(pendingRows).toEqual([
      expect.objectContaining({
        scopeKey: 'full',
        phase: 'building_text_index',
        rowCount: retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length,
        textIndexCompleted: 0,
        vectorIndexCompleted: 0,
        rebuildFingerprint: expect.any(String),
      }),
    ])
    await expect(retrievalIndex.hasBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toBe(true)

    const pendingTableName = pendingRows[0]!.tableName
    const pendingTable = mockLanceDb.tables.get(pendingTableName)
    expect(pendingTable).toBeTruthy()

    embedTextsWithOllama.mockClear()
    mockLanceDb.database.createTable.mockClear()
    mockLanceDb.database.dropTable.mockClear()

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length,
    })

    expect(embedTextsWithOllama).not.toHaveBeenCalled()
    expect(mockLanceDb.database.createTable).not.toHaveBeenCalled()
    expect(mockLanceDb.database.dropTable).toHaveBeenCalledTimes(1)
    expect(mockLanceDb.database.dropTable).toHaveBeenCalledWith(originalTableName)
    expect(getPendingRetrievalIndexRows(database)).toEqual([])
    expect(getActiveMockTableName(database)).toBe(pendingTableName)
    expect(getActiveMockTable(database, mockLanceDb)).toBe(pendingTable)
  }, 120000)

  it('invalidates a pending table from the v1 embedding policy without invalidating canonical raw cache entries', async () => {
    const { aiSettings, database, embedTextsWithOllama, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-stale-pending-embedding-policy')

    await retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')
    const originalTableName = getActiveMockTableName(database)

    aiSettings.embeddings.ollama.model = 'unit-test-embedding-model-v2'
    embedTextsWithOllama.mockClear()
    mockLanceDb.database.createTable.mockClear()
    mockLanceDb.database.dropTable.mockClear()

    mockLanceDb.database.createTable.mockImplementationOnce(async (name: string, rows: Array<Record<string, unknown>>) => {
      const table = {
        rows: [...rows],
        add: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
        createIndex: vi.fn(async (column: string) => {
          if (column === 'text') {
            throw new Error('Lance index failed under current embedding policy')
          }
        }),
        waitForIndex: vi.fn(async () => undefined),
        query: () => ({
          limit: () => ({
            toArray: async () => table.rows.slice(0, 1),
          }),
        }),
      }
      mockLanceDb.tables.set(name, table)
      return table
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).rejects.toThrow(
      'Failed to create LanceDB FTS index: Lance index failed under current embedding policy'
    )

    const pendingTableName = getPendingRetrievalIndexRows(database)[0]?.tableName
    expect(pendingTableName).toBeTruthy()
    const cachedRowsBeforeResume = database.prepare(
      'SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ? AND provider = ? AND model = ?'
    ).get('novel-001:main', 'ollama', 'unit-test-embedding-model-v2') as { count: number }
    expect(cachedRowsBeforeResume.count).toBe(retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length)

    database.prepare(
      'UPDATE PendingRetrievalIndex SET rebuildFingerprint = ? WHERE branchId = ? AND scopeKey = ?'
    ).run('pending-fingerprint-from-ollama-eof-fallback-v1', 'novel-001:main', 'full')
    embedTextsWithOllama.mockClear()
    mockLanceDb.database.createTable.mockClear()
    mockLanceDb.database.dropTable.mockClear()

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length,
    })

    expect(embedTextsWithOllama).not.toHaveBeenCalled()
    expect(mockLanceDb.database.createTable).toHaveBeenCalledTimes(1)
    expect(mockLanceDb.database.dropTable).toHaveBeenCalledWith(pendingTableName)
    expect(mockLanceDb.database.dropTable).toHaveBeenCalledWith(originalTableName)
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ? AND provider = ? AND model = ?'
    ).get('novel-001:main', 'ollama', 'unit-test-embedding-model-v2')).toEqual(cachedRowsBeforeResume)
    expect(getPendingRetrievalIndexRows(database)).toEqual([])
    expect(getActiveMockTableName(database)).not.toBe(pendingTableName)
  }, 120000)

  it('discards a stale pending table when the embedding model changes after an index failure', async () => {
    const { aiSettings, database, embedTextsWithOllama, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-stale-pending-model-change')

    await retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')
    const originalTable = getActiveMockTable(database, mockLanceDb)
    const originalTableName = getActiveMockTableName(database)
    expect(originalTable).toBeTruthy()

    aiSettings.embeddings.ollama.model = 'unit-test-embedding-model-v2'
    embedTextsWithOllama.mockClear()
    mockLanceDb.database.createTable.mockClear()
    mockLanceDb.database.dropTable.mockClear()
    let textIndexAttempts = 0

    mockLanceDb.database.createTable.mockImplementationOnce(async (name: string, rows: Array<Record<string, unknown>>) => {
      const table = {
        rows: [...rows],
        add: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
        createIndex: vi.fn(async (column: string) => {
          if (column === 'text' && textIndexAttempts === 0) {
            textIndexAttempts += 1
            throw new Error('Lance index failed')
          }
        }),
        waitForIndex: vi.fn(async () => undefined),
        query: () => ({
          limit: () => ({
            toArray: async () => table.rows.slice(0, 1),
          }),
        }),
      }
      mockLanceDb.tables.set(name, table)
      return table
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).rejects.toThrow('Failed to create LanceDB FTS index: Lance index failed')

    const pendingTableName = getPendingRetrievalIndexRows(database)[0]?.tableName
    expect(pendingTableName).toBeTruthy()

    aiSettings.embeddings.ollama.model = 'unit-test-embedding-model-v3'
    embedTextsWithOllama.mockClear()
    mockLanceDb.database.createTable.mockClear()
    mockLanceDb.database.dropTable.mockClear()

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length,
    })

    expect(embedTextsWithOllama).toHaveBeenCalledTimes(1)
    expect(mockLanceDb.database.createTable).toHaveBeenCalledTimes(1)
    expect(mockLanceDb.database.dropTable).toHaveBeenCalledTimes(2)
    expect(mockLanceDb.database.dropTable).toHaveBeenCalledWith(pendingTableName)
    expect(mockLanceDb.database.dropTable).toHaveBeenCalledWith(originalTableName)
    expect(getPendingRetrievalIndexRows(database)).toEqual([])
    expect(getActiveMockTable(database, mockLanceDb)).not.toBe(originalTable)
  }, 120000)

  it('discards a stale pending table when source docs change after an index failure', async () => {
    const { database, embedTextsWithOllama, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-stale-pending-doc-change')

    await retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')
    const originalTable = getActiveMockTable(database, mockLanceDb)
    const originalTableName = getActiveMockTableName(database)
    expect(originalTable).toBeTruthy()

    embedTextsWithOllama.mockClear()
    mockLanceDb.database.createTable.mockClear()
    mockLanceDb.database.dropTable.mockClear()
    let textIndexAttempts = 0

    mockLanceDb.database.createTable.mockImplementationOnce(async (name: string, rows: Array<Record<string, unknown>>) => {
      const table = {
        rows: [...rows],
        add: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
        createIndex: vi.fn(async (column: string) => {
          if (column === 'text' && textIndexAttempts === 0) {
            textIndexAttempts += 1
            throw new Error('Lance index failed')
          }
        }),
        waitForIndex: vi.fn(async () => undefined),
        query: () => ({
          limit: () => ({
            toArray: async () => table.rows.slice(0, 1),
          }),
        }),
      }
      mockLanceDb.tables.set(name, table)
      return table
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).rejects.toThrow('Failed to create LanceDB FTS index: Lance index failed')

    const pendingTableName = getPendingRetrievalIndexRows(database)[0]?.tableName
    expect(pendingTableName).toBeTruthy()

    database.prepare('UPDATE KnowledgeChapter SET summary = ? WHERE id = ?').run('第1章摘要已变化', 'chapter-1')
    embedTextsWithOllama.mockClear()
    mockLanceDb.database.createTable.mockClear()
    mockLanceDb.database.dropTable.mockClear()

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length,
    })

    expect(embedTextsWithOllama).toHaveBeenCalledTimes(1)
    expect(mockLanceDb.database.createTable).toHaveBeenCalledTimes(1)
    expect(mockLanceDb.database.dropTable).toHaveBeenCalledTimes(2)
    expect(mockLanceDb.database.dropTable).toHaveBeenCalledWith(pendingTableName)
    expect(mockLanceDb.database.dropTable).toHaveBeenCalledWith(originalTableName)
    expect(getPendingRetrievalIndexRows(database)).toEqual([])
    expect(getActiveMockTable(database, mockLanceDb)).not.toBe(originalTable)
  }, 120000)

  it('resumes from building_vector_index without recreating the pending table', async () => {
    const { aiSettings, database, embedTextsWithOllama, ivfFlat, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-resume-vector-stage')

    await retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')
    const originalTable = getActiveMockTable(database, mockLanceDb)
    const originalTableName = getActiveMockTableName(database)
    expect(originalTable).toBeTruthy()

    aiSettings.embeddings.ollama.model = 'unit-test-embedding-model-v2'
    embedTextsWithOllama.mockClear()
    ivfFlat.mockClear()
    mockLanceDb.database.createTable.mockClear()
    mockLanceDb.database.dropTable.mockClear()
    let vectorIndexAttempts = 0

    mockLanceDb.database.createTable.mockImplementationOnce(async (name: string, rows: Array<Record<string, unknown>>) => {
      const table = {
        rows: [...rows],
        add: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
        createIndex: vi.fn(async (column: string) => {
          if (column === 'vector' && vectorIndexAttempts === 0) {
            vectorIndexAttempts += 1
            throw new Error('Vector index failed')
          }
        }),
        waitForIndex: vi.fn(async () => undefined),
        query: () => ({
          limit: () => ({
            toArray: async () => table.rows.slice(0, 1),
          }),
        }),
      }
      mockLanceDb.tables.set(name, table)
      return table
    })

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).rejects.toThrow('Failed to create LanceDB vector index: Vector index failed')

    const pendingRows = getPendingRetrievalIndexRows(database)
    expect(pendingRows).toEqual([
      expect.objectContaining({
        scopeKey: 'full',
        phase: 'building_vector_index',
        rowCount: retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length,
        textIndexCompleted: 1,
        vectorIndexCompleted: 0,
        rebuildFingerprint: expect.any(String),
      }),
    ])
    const pendingTableName = pendingRows[0]?.tableName
    const pendingTable = pendingTableName ? mockLanceDb.tables.get(pendingTableName) : null
    expect(pendingTable).toBeTruthy()

    embedTextsWithOllama.mockClear()
    mockLanceDb.database.createTable.mockClear()
    mockLanceDb.database.dropTable.mockClear()

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length,
    })

    const vectorIndexCalls = pendingTable?.createIndex.mock.calls.filter(([column]) => column === 'vector') ?? []

    expect(embedTextsWithOllama).not.toHaveBeenCalled()
    expect(ivfFlat).toHaveBeenCalledTimes(2)
    expect(ivfFlat.mock.calls).toEqual([
      [{ distanceType: 'l2', numPartitions: 128, maxIterations: 20, sampleRate: 64 }],
      [{ distanceType: 'l2', numPartitions: 128, maxIterations: 20, sampleRate: 64 }],
    ])
    expect(vectorIndexCalls).toHaveLength(2)
    expect(vectorIndexCalls[0]?.[1]).toMatchObject({
      config: ivfFlat.mock.results[0]?.value,
    })
    expect(vectorIndexCalls[1]?.[1]).toMatchObject({
      config: ivfFlat.mock.results[1]?.value,
    })
    expect(ivfFlat.mock.results[0]?.value).not.toBe(ivfFlat.mock.results[1]?.value)
    expect(mockLanceDb.database.createTable).not.toHaveBeenCalled()
    expect(mockLanceDb.database.dropTable).toHaveBeenCalledTimes(1)
    expect(mockLanceDb.database.dropTable).toHaveBeenCalledWith(originalTableName)
    expect(getPendingRetrievalIndexRows(database)).toEqual([])
    expect(getActiveMockTableName(database)).toBe(pendingTableName)
    expect(getActiveMockTable(database, mockLanceDb)).toBe(pendingTable)
  }, 120000)


  it('writes materialized rows in one final table replacement without append batches', async () => {
    const { aiSettings, database, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-single-final-write')
    aiSettings.embeddings.embeddingBatchSize = 2000

    const insertWorld = database.prepare(
      `INSERT INTO KnowledgeWorld (
        id, novelId, branchId, term, category, definition, firstSeenChapter,
        validFromChapter, validUntilChapter, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (let index = 0; index < 1005; index += 1) {
      insertWorld.run(
        `world-${index}`,
        'novel-001',
        'novel-001:main',
        `术语${index}`,
        '设定',
        `定义${index}`,
        1,
        1,
        999999999,
        'ready',
      )
    }

    const docs = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    expect(docs.length).toBeGreaterThan(1000)

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: docs.length,
    })

    expect(mockLanceDb.database.createTable).toHaveBeenCalledTimes(1)
    const table = getActiveMockTable(database, mockLanceDb)
    expect(table?.rows).toHaveLength(docs.length)
    expect(table?.add).not.toHaveBeenCalled()
  }, 120000)

  it('deleteBranchRetrievalIndexFromChapter drops the disposable Lance table', async () => {
    const { database, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('retale-retrieval-index-delete-from-chapter-safe-scope')

    database.prepare(
      `INSERT INTO KnowledgeWorld (
        id, novelId, branchId, term, category, definition, firstSeenChapter,
        validFromChapter, validUntilChapter, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('world-1', 'novel-001', 'novel-001:main', '青铜钥', '道具', '旧定义', 1, 1, 999999999, 'ready')
    database.prepare(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, summary,
        revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('chapter-2', 'novel-001', 'novel-001:main', 2, '第2章', '第2章原文', '第2章摘要', 1, 0, null, 'hash-2', 'ready')
    database.prepare(
      `INSERT INTO TextSpan (
        id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd,
        charStart, charEnd, text, spanType, tokenEstimate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('span-4', 'novel-001', 'novel-001:main', 'chapter-2', 2, 1, 1, 0, 9, '第二章原文内容。', 'paragraph', 8)

    await retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')
    await retrievalIndex.deleteBranchRetrievalIndexFromChapter('novel-001', 'novel-001:main', 2)

    expect(mockLanceDb.database.dropTable).toHaveBeenCalledTimes(1)
    expect(Array.from(mockLanceDb.tables.values())).toHaveLength(0)
    await expect(retrievalIndex.hasBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toBe(false)
  }, 120000)
})
