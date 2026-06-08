import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }
const originalDatabaseUrl = process.env.DATABASE_URL

async function createTestDatabase(prefix: string) {
  const tempDatabase = createTempDatabaseCopy(prefix)
  cleanups.push(tempDatabase.cleanup)

  process.env.DATABASE_URL = tempDatabase.dbPath
  vi.resetModules()

  const sqliteModule = await import('@/lib/server/sqlite')
  const cacheModule = await import('@/lib/server/retrieval-embedding-cache')
  globalForSqlite.sqlite = sqliteModule.sqlite

  return {
    database: sqliteModule.sqlite,
    queryAll: sqliteModule.queryAll,
    queryOne: sqliteModule.queryOne,
    ...cacheModule,
  }
}

function seedBranch(database: DatabaseSync, novelId: string, branchName: string) {
  database.prepare('INSERT OR IGNORE INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run(novelId, `${novelId} title`, 'txt')
  database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run(`${novelId}:${branchName}`, novelId, branchName)
}

type EmbeddingInputParts = {
  sourceLabel: string
  title: string
  relatedTerms?: string
  text: string
}

async function runDirectRawTextCachePass(params: {
  scope: {
    novelId: string
    branchId: string
    provider: string
    model: string
  }
  docs: EmbeddingInputParts[]
  buildCanonicalRetrievalEmbeddingInput: (parts: {
    sourceLabel?: string | null
    title?: string | null
    relatedTerms?: string | null
    text: string
  }) => string
  buildEmbeddingInputHash: (embeddingInput: string) => string
  lookupRawTextEmbeddingCacheEntries: (params: {
    scope: {
      novelId: string
      branchId: string
      provider: string
      model: string
    }
    embeddingInputHashes: string[]
    touchOnHit?: boolean
  }) => Promise<Array<{ embeddingInputHash: string; vector: number[] }>>
  upsertRawTextEmbeddingCacheEntries: (params: {
    scope: {
      novelId: string
      branchId: string
      provider: string
      model: string
    }
    entries: Array<{ embeddingInput: string; vector: number[] }>
  }) => Promise<number>
  embedLive: (embeddingInputs: string[]) => Promise<number[][]>
}) {
  const embeddingInputs = params.docs.map((doc) => params.buildCanonicalRetrievalEmbeddingInput(doc))
  const hashes = embeddingInputs.map((input) => params.buildEmbeddingInputHash(input))
  const cached = await params.lookupRawTextEmbeddingCacheEntries({
    scope: params.scope,
    embeddingInputHashes: hashes,
    touchOnHit: true,
  })

  const cacheByHash = new Map(cached.map((entry) => [entry.embeddingInputHash, entry.vector]))
  const misses = embeddingInputs
    .map((input, index) => ({ input, hash: hashes[index] }))
    .filter((entry) => !cacheByHash.has(entry.hash))

  if (misses.length) {
    const liveVectors = await params.embedLive(misses.map((entry) => entry.input))
    await params.upsertRawTextEmbeddingCacheEntries({
      scope: params.scope,
      entries: misses.map((entry, index) => ({
        embeddingInput: entry.input,
        vector: liveVectors[index],
      })),
    })
  }

  return {
    misses,
    hashes,
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

  process.env.DATABASE_URL = originalDatabaseUrl
  vi.resetModules()

  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('raw-text embedding cache repository', () => {
  it('handles huge raw-text cache hash lists without overflowing the call stack', async () => {
    const {
      database,
      deleteRawTextEmbeddingCacheEntries,
      garbageCollectRawTextEmbeddingCacheEntries,
      lookupRawTextEmbeddingCacheEntries,
    } = await createTestDatabase('retale-raw-text-embedding-cache-large-hash-list')
    seedBranch(database, 'novel_large_cache', 'main')
    const scope = {
      novelId: 'novel_large_cache',
      branchId: 'main',
      provider: 'ollama',
      model: 'qwen3-embedding:4b',
    }
    const hashes = Array.from({ length: 150000 }, (_, index) => `hash-${index}`)

    await expect(lookupRawTextEmbeddingCacheEntries({
      scope,
      embeddingInputHashes: hashes,
      touchOnHit: true,
    })).resolves.toEqual([])
    await expect(deleteRawTextEmbeddingCacheEntries({
      scope,
      embeddingInputHashes: hashes,
    })).resolves.toBe(0)
    await expect(garbageCollectRawTextEmbeddingCacheEntries({
      scope,
      reachableEmbeddingInputHashes: hashes,
    })).resolves.toBe(0)
  })

  it('cache repository round-trip succeeds', async () => {
    const {
      database,
      queryAll,
      queryOne,
      buildCanonicalRetrievalEmbeddingInput,
      buildEmbeddingInputHash,
      garbageCollectRawTextEmbeddingCacheEntries,
      lookupRawTextEmbeddingCacheEntries,
      upsertRawTextEmbeddingCacheEntries,
    } = await createTestDatabase('retale-raw-text-embedding-cache-round-trip')
    seedBranch(database, 'novel_cache', 'main')
    seedBranch(database, 'novel_cache', 'draft')

    const mainScope = {
      novelId: 'novel_cache',
      branchId: 'main',
      provider: 'openai-compatible',
      model: 'text-embedding-3-small',
    }
    const alternateProviderScope = {
      ...mainScope,
      provider: 'ollama',
      model: 'nomic-embed-text',
    }
    const alternateBranchScope = {
      ...mainScope,
      branchId: 'draft',
    }

    const firstInput = buildCanonicalRetrievalEmbeddingInput({
      sourceLabel: '原文段落',
      title: 'paragraph',
      relatedTerms: 'paragraph',
      text: 'A cached raw text embedding.',
    })
    const secondInput = buildCanonicalRetrievalEmbeddingInput({
      sourceLabel: '章节摘录',
      title: 'summary',
      relatedEntityNames: 'Hero\nGuide',
      relatedTerms: 'summary',
      text: 'A second cached embedding input.',
    })
    const thirdInput = buildCanonicalRetrievalEmbeddingInput({
      sourceLabel: '原文证据',
      title: 'evidence',
      relatedEventNames: 'Arrival',
      text: 'A scoped sibling entry.',
    })

    const firstHash = buildEmbeddingInputHash(firstInput)
    const secondHash = buildEmbeddingInputHash(secondInput)
    const thirdHash = buildEmbeddingInputHash(thirdInput)

    expect(await upsertRawTextEmbeddingCacheEntries({
      scope: mainScope,
      entries: [
        { embeddingInput: firstInput, vector: [0.1, 0.2, 0.3] },
        { embeddingInput: secondInput, vector: [0.4, 0.5, 0.6] },
      ],
    })).toBe(2)

    expect(await upsertRawTextEmbeddingCacheEntries({
      scope: alternateProviderScope,
      entries: [{ embeddingInput: firstInput, vector: [9, 8, 7] }],
    })).toBe(1)

    expect(await upsertRawTextEmbeddingCacheEntries({
      scope: alternateBranchScope,
      entries: [{ embeddingInput: thirdInput, vector: [1.5, 1.6, 1.7] }],
    })).toBe(1)

    const mainHits = await lookupRawTextEmbeddingCacheEntries({
      scope: mainScope,
      embeddingInputHashes: [secondHash, firstHash, 'missing-hash'],
      touchOnHit: true,
    })

    expect(mainHits).toEqual([
      expect.objectContaining({
        branchId: 'novel_cache:main',
        provider: 'openai-compatible',
        model: 'text-embedding-3-small',
        embeddingInputHash: secondHash,
        vector: [0.4, 0.5, 0.6],
        vectorDimension: 3,
      }),
      expect.objectContaining({
        branchId: 'novel_cache:main',
        provider: 'openai-compatible',
        model: 'text-embedding-3-small',
        embeddingInputHash: firstHash,
        vector: [0.1, 0.2, 0.3],
        vectorDimension: 3,
      }),
    ])

    expect(mainHits.every((entry) => entry.lastSeenAt.length > 0)).toBe(true)

    expect(await garbageCollectRawTextEmbeddingCacheEntries({
      scope: mainScope,
      reachableEmbeddingInputHashes: [firstHash],
    })).toBe(1)

    expect(await lookupRawTextEmbeddingCacheEntries({
      scope: mainScope,
      embeddingInputHashes: [firstHash, secondHash],
    })).toEqual([
      expect.objectContaining({
        embeddingInputHash: firstHash,
        vector: [0.1, 0.2, 0.3],
      }),
    ])

    expect(await lookupRawTextEmbeddingCacheEntries({
      scope: alternateProviderScope,
      embeddingInputHashes: [firstHash],
    })).toEqual([
      expect.objectContaining({
        branchId: 'novel_cache:main',
        provider: 'ollama',
        model: 'nomic-embed-text',
        embeddingInputHash: firstHash,
        vector: [9, 8, 7],
      }),
    ])

    expect(await lookupRawTextEmbeddingCacheEntries({
      scope: alternateBranchScope,
      embeddingInputHashes: [thirdHash],
    })).toEqual([
      expect.objectContaining({
        branchId: 'novel_cache:draft',
        embeddingInputHash: thirdHash,
        vector: [1.5, 1.6, 1.7],
      }),
    ])

    expect(queryOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ? AND provider = ? AND model = ?',
      'novel_cache:main',
      'openai-compatible',
      'text-embedding-3-small',
    )).toMatchObject({ count: 1 })

    expect(queryAll<{ embeddingInputHash: string }>(
      `SELECT embeddingInputHash
       FROM RawTextEmbeddingCache
       WHERE branchId IN (?, ?)
       ORDER BY branchId, provider, model, embeddingInputHash`,
      'novel_cache:draft',
      'novel_cache:main',
    )).toEqual([
      { embeddingInputHash: thirdHash },
      { embeddingInputHash: firstHash },
      { embeddingInputHash: firstHash },
    ])
  })

  it('rejects invalid vector payloads', async () => {
    const {
      database,
      queryOne,
      buildCanonicalRetrievalEmbeddingInput,
      buildEmbeddingInputHash,
      lookupRawTextEmbeddingCacheEntries,
      upsertRawTextEmbeddingCacheEntries,
    } = await createTestDatabase('retale-raw-text-embedding-cache-invalid-vectors')
    seedBranch(database, 'novel_invalid', 'main')

    const scope = {
      novelId: 'novel_invalid',
      branchId: 'main',
      provider: 'openai-compatible',
      model: 'text-embedding-3-small',
    }
    const validInput = buildCanonicalRetrievalEmbeddingInput({
      sourceLabel: '原文证据',
      title: 'evidence',
      text: 'A valid retrieval embedding input.',
    })
    const corruptInput = buildCanonicalRetrievalEmbeddingInput({
      sourceLabel: '原文证据',
      title: 'evidence',
      text: 'A corrupt retrieval embedding input.',
    })
    const corruptHash = buildEmbeddingInputHash(corruptInput)

    await expect(upsertRawTextEmbeddingCacheEntries({
      scope,
      entries: [{ embeddingInput: validInput, vector: [1, Number.NaN, 3] }],
    })).rejects.toThrow(/non-finite value/)

    await expect(upsertRawTextEmbeddingCacheEntries({
      scope,
      entries: [
        { embeddingInput: validInput, vector: [0.1, 0.2, 0.3] },
        { embeddingInput: `${validInput}\nvariant`, vector: [0.4, 0.5] },
      ],
    })).rejects.toThrow(/share one dimension/)

    database.prepare(
      `
        INSERT INTO RawTextEmbeddingCache (
          branchId,
          provider,
          model,
          embeddingInputHash,
          vectorJson,
          vectorDimension,
          lastSeenAt,
          createdAt,
          updatedAt
        )
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
    ).run(
      'novel_invalid:main',
      'openai-compatible',
      'text-embedding-3-small',
      corruptHash,
      JSON.stringify([1, null, 3]),
      3,
    )

    expect(await lookupRawTextEmbeddingCacheEntries({
      scope,
      embeddingInputHashes: [corruptHash],
    })).toEqual([])

    expect(queryOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ? AND provider = ? AND model = ? AND embeddingInputHash = ?',
      'novel_invalid:main',
      'openai-compatible',
      'text-embedding-3-small',
      corruptHash,
    )).toMatchObject({ count: 0 })
  })

  it('covers raw-text cache hit miss matrix', async () => {
    const {
      database,
      buildCanonicalRetrievalEmbeddingInput,
      buildEmbeddingInputHash,
      lookupRawTextEmbeddingCacheEntries,
      upsertRawTextEmbeddingCacheEntries,
    } = await createTestDatabase('retale-raw-text-embedding-cache-hit-miss-matrix')
    seedBranch(database, 'novel_matrix', 'main')

    const scope = {
      novelId: 'novel_matrix',
      branchId: 'main',
      provider: 'openai-compatible',
      model: 'text-embedding-3-small',
    }
    const providerModelChangedScope = {
      ...scope,
      provider: 'ollama',
      model: 'nomic-embed-text',
    }
    const coldDocs: EmbeddingInputParts[] = [
      {
        sourceLabel: '原文段落',
        title: 'paragraph',
        relatedTerms: 'cache matrix',
        text: 'The first raw text input.',
      },
      {
        sourceLabel: '原文证据',
        title: 'evidence',
        relatedTerms: 'cache matrix',
        text: 'The second raw text input.',
      },
    ]
    const changedDocs: EmbeddingInputParts[] = [
      coldDocs[0],
      {
        ...coldDocs[1],
        text: 'The second raw text input has changed.',
      },
    ]

    const embedLive = vi.fn(async (embeddingInputs: string[]) => embeddingInputs.map((input, index) => {
      const hash = buildEmbeddingInputHash(input)
      return [hash.length, index + 0.25, hash.charCodeAt(0)]
    }))

    const coldRun = await runDirectRawTextCachePass({
      scope,
      docs: coldDocs,
      buildCanonicalRetrievalEmbeddingInput,
      buildEmbeddingInputHash,
      lookupRawTextEmbeddingCacheEntries,
      upsertRawTextEmbeddingCacheEntries,
      embedLive,
    })
    expect(coldRun.misses).toHaveLength(2)
    expect(embedLive).toHaveBeenCalledTimes(1)
    expect(embedLive.mock.calls[0]?.[0]).toHaveLength(2)

    const warmRun = await runDirectRawTextCachePass({
      scope,
      docs: coldDocs,
      buildCanonicalRetrievalEmbeddingInput,
      buildEmbeddingInputHash,
      lookupRawTextEmbeddingCacheEntries,
      upsertRawTextEmbeddingCacheEntries,
      embedLive,
    })
    expect(warmRun.misses).toHaveLength(0)
    expect(embedLive).toHaveBeenCalledTimes(1)

    const changedRun = await runDirectRawTextCachePass({
      scope,
      docs: changedDocs,
      buildCanonicalRetrievalEmbeddingInput,
      buildEmbeddingInputHash,
      lookupRawTextEmbeddingCacheEntries,
      upsertRawTextEmbeddingCacheEntries,
      embedLive,
    })
    expect(changedRun.misses).toHaveLength(1)
    expect(embedLive).toHaveBeenCalledTimes(2)
    expect(embedLive.mock.calls[1]?.[0]).toEqual([
      buildCanonicalRetrievalEmbeddingInput(changedDocs[1]),
    ])

    const providerModelChangedRun = await runDirectRawTextCachePass({
      scope: providerModelChangedScope,
      docs: coldDocs,
      buildCanonicalRetrievalEmbeddingInput,
      buildEmbeddingInputHash,
      lookupRawTextEmbeddingCacheEntries,
      upsertRawTextEmbeddingCacheEntries,
      embedLive,
    })
    expect(providerModelChangedRun.misses).toHaveLength(2)
    expect(embedLive).toHaveBeenCalledTimes(3)
    expect(embedLive.mock.calls[2]?.[0]).toHaveLength(2)
  })

  it('garbage collects removed inputs and reuses moved identical text', async () => {
    const {
      database,
      queryOne,
      buildCanonicalRetrievalEmbeddingInput,
      buildEmbeddingInputHash,
      garbageCollectRawTextEmbeddingCacheEntries,
      lookupRawTextEmbeddingCacheEntries,
      upsertRawTextEmbeddingCacheEntries,
    } = await createTestDatabase('retale-raw-text-embedding-cache-gc-and-move')
    seedBranch(database, 'novel_gc_move', 'main')

    const scope = {
      novelId: 'novel_gc_move',
      branchId: 'main',
      provider: 'openai-compatible',
      model: 'text-embedding-3-small',
    }

    const retained = buildCanonicalRetrievalEmbeddingInput({
      sourceLabel: '原文段落',
      title: 'paragraph',
      relatedTerms: 'retain',
      text: 'This text remains after garbage collection.',
    })
    const removed = buildCanonicalRetrievalEmbeddingInput({
      sourceLabel: '原文证据',
      title: 'evidence',
      relatedTerms: 'remove',
      text: 'This text is removed from the source set.',
    })

    await upsertRawTextEmbeddingCacheEntries({
      scope,
      entries: [
        { embeddingInput: retained, vector: [0.1, 0.2, 0.3] },
        { embeddingInput: removed, vector: [0.4, 0.5, 0.6] },
      ],
    })

    const retainedHash = buildEmbeddingInputHash(retained)
    const removedHash = buildEmbeddingInputHash(removed)
    expect(await garbageCollectRawTextEmbeddingCacheEntries({
      scope,
      reachableEmbeddingInputHashes: [retainedHash],
    })).toBe(1)

    expect(await lookupRawTextEmbeddingCacheEntries({
      scope,
      embeddingInputHashes: [retainedHash, removedHash],
    })).toEqual([
      expect.objectContaining({ embeddingInputHash: retainedHash, vector: [0.1, 0.2, 0.3] }),
    ])

    const movedOriginal = {
      spanId: 'span-evidence-old',
      lineStart: 12,
      lineEnd: 12,
      sourceLabel: '原文证据',
      title: 'evidence',
      relatedTerms: 'movement',
      text: 'Identical raw text should reuse cache after span regeneration.',
    }
    const movedRegenerated = {
      spanId: 'span-evidence-new',
      lineStart: 55,
      lineEnd: 55,
      sourceLabel: '原文证据',
      title: 'evidence',
      relatedTerms: 'movement',
      text: movedOriginal.text,
    }

    const originalInput = buildCanonicalRetrievalEmbeddingInput(movedOriginal)
    const movedInput = buildCanonicalRetrievalEmbeddingInput(movedRegenerated)
    const movedHash = buildEmbeddingInputHash(movedInput)
    expect(movedInput).toBe(originalInput)
    expect(movedHash).toBe(buildEmbeddingInputHash(originalInput))

    await upsertRawTextEmbeddingCacheEntries({
      scope,
      entries: [{ embeddingInput: originalInput, vector: [9, 9.1, 9.2] }],
    })

    const embedLive = vi.fn(async (embeddingInputs: string[]) => embeddingInputs.map(() => [99, 99, 99]))
    const movedRun = await runDirectRawTextCachePass({
      scope,
      docs: [movedRegenerated],
      buildCanonicalRetrievalEmbeddingInput,
      buildEmbeddingInputHash,
      lookupRawTextEmbeddingCacheEntries,
      upsertRawTextEmbeddingCacheEntries,
      embedLive,
    })

    expect(movedRun.hashes).toEqual([movedHash])
    expect(movedRun.misses).toHaveLength(0)
    expect(embedLive).not.toHaveBeenCalled()
    expect(queryOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ? AND provider = ? AND model = ? AND embeddingInputHash = ?',
      'novel_gc_move:main',
      'openai-compatible',
      'text-embedding-3-small',
      movedHash,
    )).toMatchObject({ count: 1 })
  })
})
