import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }

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

async function createRetrievalIndexHarness(testName: string) {
  const tempDatabase = createTempDatabaseCopy(testName)
  cleanups.push(tempDatabase.cleanup)

  const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
  globalForSqlite.sqlite = database
  seedRetrievalFixture(database)

  const aiSettings = createMockAISettings()
  const mockLanceDb = createMockLanceDb()
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
      fts: () => ({}) ,
    },
  }))

  const retrievalIndex = await import('@/lib/server/retrieval-index')
  const retrievalCache = await import('@/lib/server/retrieval-embedding-cache')

  return {
    aiSettings,
    database,
    embedTextsWithOllama,
    mockLanceDb,
    retrievalIndex,
    retrievalCache,
  }
}

afterEach(() => {
  if (globalForSqlite.sqlite) {
    try {
      ;(globalForSqlite.sqlite as DatabaseSync & { close?: () => void }).close?.()
    } catch {
    }
    delete globalForSqlite.sqlite
  }

  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('retrieval-index cache reuse helpers', () => {
  it('includes tier labels and merged aliases in entity retrieval docs without duplicate character docs', async () => {
    const tempDatabase = createTempDatabaseCopy('chatbook-retrieval-index-character-doc-tier-aliases')
    cleanups.push(tempDatabase.cleanup)

    const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
    globalForSqlite.sqlite = database
    seedRetrievalFixture(database)

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
    const tempDatabase = createTempDatabaseCopy('chatbook-retrieval-index-cache-reuse-partition')
    cleanups.push(tempDatabase.cleanup)

    const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
    globalForSqlite.sqlite = database
    seedRetrievalFixture(database)

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
    const tempDatabase = createTempDatabaseCopy('chatbook-retrieval-index-cache-reuse-range-docs')
    cleanups.push(tempDatabase.cleanup)

    const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
    globalForSqlite.sqlite = database
    seedRetrievalFixture(database)

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

  it('reuses embeddingInputHash when packed text is unchanged', async () => {
    const tempDatabase = createTempDatabaseCopy('chatbook-retrieval-index-cache-reuse-hash')
    cleanups.push(tempDatabase.cleanup)

    const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
    globalForSqlite.sqlite = database
    seedRetrievalFixture(database)

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
    } = await createRetrievalIndexHarness('chatbook-retrieval-index-cache-reuse-final-rebuild-hit')

    const rawTextDocs = retrievalIndex.loadRawTextRetrievalDocs('novel-001', 'novel-001:main')
    const mergedDocs = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    const packedDoc = rawTextDocs.find((row) => row.id.startsWith('packed-span:'))
    expect(packedDoc).toBeTruthy()

    const cachedEmbeddingInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(packedDoc!).text
    const cachedVector = [9, 9, 9]
    await retrievalCache.upsertRawTextEmbeddingCacheEntries({
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
    })

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
    } = await createRetrievalIndexHarness('chatbook-retrieval-index-cache-reuse-broader-final-rebuild')

    const rawTextDocs = retrievalIndex.loadRawTextRetrievalDocs('novel-001', 'novel-001:main')
    const mergedDocs = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    const packedDoc = rawTextDocs.find((row) => row.id.startsWith('packed-span:'))
    const sceneDoc = rawTextDocs.find((row) => row.id === 'span-3')
    expect(packedDoc).toBeTruthy()
    expect(sceneDoc).toBeTruthy()

    const packedInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(packedDoc!).text
    const sceneInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(sceneDoc!).text
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
      count: rawTextDocs.length,
    })

    await retrievalCache.upsertRawTextEmbeddingCacheEntries({
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
      ],
    })

    embedTextsWithOllama.mockClear()
    mockLanceDb.database.createTable.mockClear()
    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: mergedDocs.length,
    })

    expect(embedTextsWithOllama).toHaveBeenCalledTimes(1)
    expect(embedTextsWithOllama.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([
      expect.stringContaining('章节摘要'),
    ]))
    expect(embedTextsWithOllama.mock.calls[0]?.[0]).not.toContain(packedInput)
    expect(embedTextsWithOllama.mock.calls[0]?.[0]).not.toContain(sceneInput)

    const warmStoredRows = mockLanceDb.database.createTable.mock.calls[0]?.[1] as Array<{ id: string; vector: number[] }>
    expect(warmStoredRows.map((row) => row.id)).toEqual(mergedDocs.map((row) => row.id))
    expect(warmStoredRows.find((row) => row.id === packedDoc!.id)?.vector).toEqual([9, 9, 9])
    expect(warmStoredRows.find((row) => row.id === sceneDoc!.id)?.vector).toEqual([8, 8, 8])

    database.prepare('DELETE FROM RawTextEmbeddingCache WHERE embeddingInputHash = ?').run(packedHash)
    database.prepare('UPDATE RawTextEmbeddingCache SET vectorJson = ?, vectorDimension = ? WHERE embeddingInputHash = ?')
      .run(JSON.stringify([1, 1]), 2, sceneHash)

    embedTextsWithOllama.mockClear()
    mockLanceDb.database.createTable.mockClear()
    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: mergedDocs.length,
    })

    expect(embedTextsWithOllama).toHaveBeenCalledTimes(2)
    expect(embedTextsWithOllama.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([
      packedInput,
      expect.stringContaining('章节摘要'),
    ]))
    expect(embedTextsWithOllama.mock.calls[0]?.[0]).not.toContain(sceneInput)
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
    const emptyHarness = await createRetrievalIndexHarness('chatbook-retrieval-index-cache-reuse-empty-cache')
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
    expect(emptyCacheRows).toHaveLength(emptyRawTextDocs.length)
    expect(emptyCacheRows.every((row) => row.vectorDimension === 3)).toBe(true)

    const degradedHarness = await createRetrievalIndexHarness('chatbook-retrieval-index-cache-reuse-partial-cache')
    const degradedRawTextDocs = degradedHarness.retrievalIndex.loadRawTextRetrievalDocs('novel-001', 'novel-001:main')
    const packedDoc = degradedRawTextDocs.find((row) => row.id.startsWith('packed-span:'))
    const sceneDoc = degradedRawTextDocs.find((row) => row.id === 'span-3')
    expect(packedDoc).toBeTruthy()
    expect(sceneDoc).toBeTruthy()

    const packedInput = degradedHarness.retrievalIndex.buildRawTextRetrievalEmbeddingInput(packedDoc!).text
    const sceneInput = degradedHarness.retrievalIndex.buildRawTextRetrievalEmbeddingInput(sceneDoc!).text
    await degradedHarness.retrievalCache.upsertRawTextEmbeddingCacheEntries({
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
    })
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
    const { database, retrievalCache, retrievalIndex } = await createRetrievalIndexHarness('chatbook-retrieval-index-cache-reuse-precompute-gc')

    const rawTextDocs = retrievalIndex.loadRawTextRetrievalDocs('novel-001', 'novel-001:main')
    const packedDoc = rawTextDocs.find((row) => row.id.startsWith('packed-span:'))
    expect(packedDoc).toBeTruthy()

    const retainedInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(packedDoc!).text
    const staleInput = `${retainedInput}\n[stale-cache-entry]`
    const retainedHash = retrievalCache.buildEmbeddingInputHash(retainedInput)
    const staleHash = retrievalCache.buildEmbeddingInputHash(staleInput)

    await retrievalCache.upsertRawTextEmbeddingCacheEntries({
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
    })

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

  it('does not garbage collect out-of-range raw-text cache rows during ranged precompute', async () => {
    const { database, retrievalCache, retrievalIndex } = await createRetrievalIndexHarness('chatbook-retrieval-index-cache-reuse-precompute-range-gc')

    const rawTextDocs = retrievalIndex.loadRawTextRetrievalDocs('novel-001', 'novel-001:main')
    const retainedDoc = rawTextDocs.find((row) => row.id.startsWith('packed-span:'))
    expect(retainedDoc).toBeTruthy()

    const retainedInput = retrievalIndex.buildRawTextRetrievalEmbeddingInput(retainedDoc!).text
    const staleInput = `${retainedInput}\n[range-outside-cache-entry]`
    const retainedHash = retrievalCache.buildEmbeddingInputHash(retainedInput)
    const staleHash = retrievalCache.buildEmbeddingInputHash(staleInput)

    await retrievalCache.upsertRawTextEmbeddingCacheEntries({
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
    })

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
    const { database, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('chatbook-retrieval-index-scoped-preserve-outside-range')

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
    const { database, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('chatbook-retrieval-index-scoped-validity-overlap')

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
    const { database, embedTextsWithOllama, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('chatbook-retrieval-index-scoped-missing-table-materialize')

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
    await expect(retrievalIndex.hasBranchRetrievalIndex('novel-001:main')).resolves.toBe(false)
    expect(getActiveRetrievalIndexRows(database)).toEqual([
      expect.objectContaining({ scopeKey: 'chapter-range:2:2', scopeStartChapter: 2, scopeEndChapter: 2 }),
    ])
  }, 120000)

  it('creates scoped retrieval table rows with the current embedding model without replacing the full table', async () => {
    const { aiSettings, database, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('chatbook-retrieval-index-scoped-model-replacement')

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
    const { database, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('chatbook-retrieval-index-scoped-legacy-metadata-materialize')

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
    const { database, embedTextsWithOllama, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('chatbook-retrieval-index-full-rebuild-failure-preserves-table')

    await retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')

    const originalTable = getActiveMockTable(database, mockLanceDb)
    expect(originalTable).toBeTruthy()

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
    await expect(retrievalIndex.hasBranchRetrievalIndex('novel-001:main')).resolves.toBe(true)

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).resolves.toMatchObject({
      rowCount: retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main').length,
    })
    await expect(retrievalIndex.hasBranchRetrievalIndex('novel-001:main')).resolves.toBe(true)
  }, 120000)

  it('retries a transient final rebuild embedding failure and still writes cache and table rows', async () => {
    const { database, embedTextsWithOllama, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('chatbook-retrieval-index-transient-final-rebuild-embedding-retry')

    const mergedDocs = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    const rawTextDocs = retrievalIndex.loadRawTextRetrievalDocs('novel-001', 'novel-001:main')

    embedTextsWithOllama.mockImplementationOnce(async () => {
      throw new Error('fetch failed')
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
      count: rawTextDocs.length,
    })
  })

  it('splits long Ollama final embedding batches by input size', async () => {
    const { aiSettings, database, embedTextsWithOllama, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('chatbook-retrieval-index-long-ollama-embedding-batches')
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
    const { embedTextsWithOllama, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('chatbook-retrieval-index-final-rebuild-retry-context')

    const mergedDocs = retrievalIndex.loadBranchRetrievalDocs('novel-001', 'novel-001:main')
    embedTextsWithOllama.mockRejectedValue(new Error(
      'Ollama embedding fetch failed (endpoint=http://127.0.0.1:11434/api/embed, baseUrl=http://127.0.0.1:11434, model=unit-test-embedding-model, inputCount=3, timeoutMs=600000, causeName=SocketError, causeCode=ECONNRESET, causeMessage=socket hang up): fetch failed'
    ))

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main')).rejects.toThrow(
      /Failed to generate retrieval embeddings for batchSize=3, preview=id=.*source=.*chapter=.*fetch failed/
    )

    expect(embedTextsWithOllama).toHaveBeenCalledTimes(3)
    expect(mockLanceDb.database.createTable).not.toHaveBeenCalled()
    expect(mergedDocs).toHaveLength(3)
  })

  it('preserves the existing retrieval table when scoped materialization fails during embedding', async () => {
    const { aiSettings, database, embedTextsWithOllama, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('chatbook-retrieval-index-scoped-materialization-failure-preserves-table')

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
    await expect(retrievalIndex.hasBranchRetrievalIndex('novel-001:main')).resolves.toBe(true)

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
    await expect(retrievalIndex.hasBranchRetrievalIndex('novel-001:main')).resolves.toBe(true)
  }, 120000)

  it('preserves the existing retrieval table when final table replacement fails', async () => {
    const { aiSettings, database, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('chatbook-retrieval-index-final-replacement-failure-preserves-table')

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
    await expect(retrievalIndex.hasBranchRetrievalIndex('novel-001:main')).resolves.toBe(true)
  }, 120000)

  it('keeps the previous table active when a new versioned table write fails after creation', async () => {
    const { aiSettings, database, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('chatbook-retrieval-index-partial-write-failure-preserves-active-table')

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
    await expect(retrievalIndex.hasBranchRetrievalIndex('novel-001:main')).resolves.toBe(true)
  }, 120000)

  it('keeps the previous table active when index creation fails', async () => {
    const { aiSettings, database, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('chatbook-retrieval-index-index-failure-preserves-active-table')

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
    mockLanceDb.database.createTable.mockClear()
    mockLanceDb.database.dropTable.mockClear()
    originalTable?.delete.mockClear()
    originalTable?.add.mockClear()

    mockLanceDb.database.createTable.mockImplementationOnce(async (name: string, rows: Array<Record<string, unknown>>) => {
      const table = {
        rows: [...rows],
        add: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
        createIndex: vi.fn(async () => {
          throw new Error('Lance index failed')
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

    await expect(retrievalIndex.rebuildBranchRetrievalIndex('novel-001', 'novel-001:main', {
      chapterRange: { startChapter: 2, endChapter: 2 },
    })).rejects.toThrow('Failed to create LanceDB FTS index: Lance index failed')

    expect(mockLanceDb.database.createTable).toHaveBeenCalledTimes(1)
    expect(mockLanceDb.database.dropTable).toHaveBeenCalledTimes(1)
    expect(Array.from(mockLanceDb.tables.values())).toHaveLength(1)
    expect(getActiveMockTableName(database)).toBe(originalTableName)
    expect(getActiveMockTable(database, mockLanceDb)).toBe(originalTable)
    expect(originalTable?.delete).not.toHaveBeenCalled()
    expect(originalTable?.add).not.toHaveBeenCalled()
    await expect(retrievalIndex.hasBranchRetrievalIndex('novel-001:main')).resolves.toBe(true)
  }, 120000)


  it('writes materialized rows in one final table replacement without append batches', async () => {
    const { aiSettings, database, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('chatbook-retrieval-index-single-final-write')
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
    const { database, mockLanceDb, retrievalIndex } = await createRetrievalIndexHarness('chatbook-retrieval-index-delete-from-chapter-safe-scope')

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
    await retrievalIndex.deleteBranchRetrievalIndexFromChapter('novel-001:main', 2)

    expect(mockLanceDb.database.dropTable).toHaveBeenCalledTimes(1)
    expect(Array.from(mockLanceDb.tables.values())).toHaveLength(0)
    await expect(retrievalIndex.hasBranchRetrievalIndex('novel-001:main')).resolves.toBe(false)
  }, 120000)
})
