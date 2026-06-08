import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }
const originalDatabaseUrl = process.env.DATABASE_URL
let fixtureSequence = 0

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function createMockAISettings(parallelism = 2) {
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
  }
}

function seedKnowledgeRebuildFixture(database: DatabaseSync, novelKey: string, chapterCount: number) {
  fixtureSequence += 1
  const novelId = `${novelKey}_${String(fixtureSequence).padStart(3, '0')}`
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
  vi.unstubAllGlobals()
  vi.resetModules()
  vi.unmock('@/lib/server/ai-settings')
  vi.unmock('@/lib/server/hanlp-bootstrap')
  vi.unmock('@/lib/server/hanlp-bootstrap-initializer')
  vi.unmock('@/lib/server/knowledge-extraction')
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

describe('knowledge rebuild alias sync', () => {
  it('migrates EntityAlias timestamps used by alias resync updates', async () => {
    const { database } = await createTestDatabase('retale-knowledge-rebuild-alias-timestamps')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_alias_timestamp_migration', 1)
    const columns = database.prepare('PRAGMA table_info(EntityAlias)').all() as Array<{ name: string }>
    const columnNames = columns.map((column) => column.name)

    expect(columnNames).toContain('createdAt')
    expect(columnNames).toContain('updatedAt')

    database.prepare(
      `INSERT INTO KnowledgeEntity (id, novelId, branchId, entityType, canonicalName, firstSeenChapter, lastSeenChapter, importanceTier, status, userConfirmed)
       VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, 1)`
    ).run('entity-timestamp-a', novelId, branchId, 'A', 1, 1, 'important', 'user_confirmed')
    database.prepare('INSERT INTO EntityAlias (id, entityId, alias, sourceChapter) VALUES (?, ?, ?, ?)')
      .run('alias-timestamp-a', 'entity-timestamp-a', 'B', 1)
    database.prepare('UPDATE EntityAlias SET sourceChapter = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?')
      .run(2, 'alias-timestamp-a')

    const alias = database.prepare('SELECT sourceChapter, updatedAt FROM EntityAlias WHERE id = ?').get('alias-timestamp-a') as { sourceChapter: number; updatedAt: string | null }
    expect(alias).toMatchObject({ sourceChapter: 2 })
    expect(alias.updatedAt).toEqual(expect.any(String))
  })

  it('keeps first alias ownership in chapter order and logs later conflicts', async () => {
    const { database, queryOne } = await createTestDatabase('retale-knowledge-rebuild-alias-first-wins')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_alias_first_wins', 2)
    const aiSettings = createMockAISettings(2)
    const gates = new Map([
      [1, createDeferred<void>()],
      [2, createDeferred<void>()],
    ])

    database.prepare(
      `INSERT INTO KnowledgeEntity (id, novelId, branchId, entityType, canonicalName, firstSeenChapter, lastSeenChapter, importanceTier, status, userConfirmed)
       VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, 1)`
    ).run('entity-liqing', novelId, branchId, '李青', 1, 1, 'important', 'user_confirmed')
    database.prepare(
      `INSERT INTO KnowledgeEntity (id, novelId, branchId, entityType, canonicalName, firstSeenChapter, lastSeenChapter, importanceTier, status, userConfirmed)
       VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, 1)`
    ).run('entity-zhaoqi', novelId, branchId, '赵七', 1, 1, 'important', 'user_confirmed')

    vi.doMock('@/lib/server/ai-settings', () => ({ loadStoredAISettings: () => aiSettings }))
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
      extractChapterKnowledgeOffline: vi.fn(async (params: { chapterNo: number }) => {
        await gates.get(params.chapterNo)?.promise
        return {
          provider: 'openai-compatible' as const,
          model: aiSettings.knowledgeExtraction.openAICompatible.model,
          extraction: {
            chapterNo: params.chapterNo,
            summary: `summary-${params.chapterNo}`,
            characters: [],
            knownCharacterUpdates: [],
            unknownCharacterObservations: [],
            aliasDiscoveries: params.chapterNo === 1
              ? [{ alias: '阿离', target: '李青' }]
              : [{ alias: '阿离', target: '赵七' }],
            relations: [],
            events: [],
            worldbuilding: [],
            openThreads: [{
              name: `thread-${params.chapterNo}`,
              description: 'proof',
              evidence: [{ quote: `第${params.chapterNo}章原文内容。`, lineStart: 1, lineEnd: 1 }],
            }],
          },
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
    const rebuildPromise = rebuildKnowledgeForNovel({ novelId })

    await waitForCondition(() => true, 'rebuild start')
    gates.get(2)?.resolve()
    gates.get(1)?.resolve()

    await expect(rebuildPromise).resolves.toMatchObject({ outcome: 'completed' })

    const mapping = queryOne<{ alias: string; canonicalName: string }>(
      `SELECT m.alias AS alias, e.canonicalName AS canonicalName
       FROM EntityAliasMapping m
       JOIN KnowledgeEntity e ON e.id = m.entityId
       WHERE m.branchId = ? AND m.alias = ?`,
      branchId,
      '阿离',
    )
    const conflict = queryOne<{ count: number; attemptedCanonicalName: string | null }>(
      `SELECT COUNT(*) AS count, MAX(attemptedCanonicalName) AS attemptedCanonicalName
       FROM EntityAliasConflictLog
       WHERE branchId = ? AND alias = ?`,
      branchId,
      '阿离',
    )
    const entityCount = queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM KnowledgeEntity
       WHERE branchId = ? AND canonicalName IN ('李青', '赵七')`,
      branchId,
    )

    expect(mapping).toMatchObject({ alias: '阿离', canonicalName: '李青' })
    expect(conflict).toMatchObject({ count: 1, attemptedCanonicalName: '赵七' })
    expect(entityCount?.count).toBe(2)
  })

  it('merges one-way canonical alias variants for formal characters', async () => {
    const { database } = await createTestDatabase('retale-knowledge-rebuild-one-way-canonical-alias-merge')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_one_way_canonical_alias_merge', 1)
    const aiSettings = createMockAISettings(1)

    database.prepare(
      `INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, description,
        firstSeenChapter, lastSeenChapter, importanceTier, status, userConfirmed
      ) VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, ?, ?)`
    ).run('entity-subaru-short', novelId, branchId, '昴', '短名记录', 4, 73, 'protagonist', 'known_character_update', 1)
    database.prepare(
      `INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, description,
        firstSeenChapter, lastSeenChapter, importanceTier, status, userConfirmed
      ) VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, ?, ?)`
    ).run('entity-subaru-full', novelId, branchId, '菜月昴', '全名记录', 1, 9, 'important', 'candidate_promoted', 1)

    database.prepare('INSERT INTO EntityAlias (id, entityId, alias, sourceChapter) VALUES (?, ?, ?, ?)')
      .run('alias-short-full', 'entity-subaru-short', '菜月昴', 18)
    database.prepare(
      `INSERT INTO EntityAliasMapping (id, novelId, branchId, alias, entityId, sourceAliasId, sourceChapter)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('alias-map-short-full', novelId, branchId, '菜月昴', 'entity-subaru-short', 'alias-short-full', 18)

    vi.doMock('@/lib/server/ai-settings', () => ({ loadStoredAISettings: () => aiSettings }))
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
        provider: 'openai-compatible' as const,
        model: aiSettings.knowledgeExtraction.openAICompatible.model,
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

    const mergedEntities = database.prepare(
      `SELECT id, canonicalName, firstSeenChapter, lastSeenChapter, importanceTier
       FROM KnowledgeEntity
       WHERE branchId = ? AND canonicalName IN ('昴', '菜月昴')`
    ).all(branchId) as Array<{
      id: string
      canonicalName: string
      firstSeenChapter: number | null
      lastSeenChapter: number | null
      importanceTier: string | null
    }>
    const aliasMappings = database.prepare(
      `SELECT alias, entityId
       FROM EntityAliasMapping
       WHERE branchId = ? AND alias IN ('昴', '菜月昴')
       ORDER BY alias ASC`
    ).all(branchId) as Array<{ alias: string; entityId: string }>
    expect(mergedEntities).toEqual([
      {
        id: 'entity-subaru-short',
        canonicalName: '昴',
        firstSeenChapter: 1,
        lastSeenChapter: 4,
        importanceTier: 'protagonist',
      },
    ])
    expect(aliasMappings).toEqual([
      { alias: '菜月昴', entityId: 'entity-subaru-short' },
    ])
  })

  it('merges safe canonical character variants and repoints mentions, aliases, and event participants to one entity', async () => {
    const { database, queryOne } = await createTestDatabase('retale-knowledge-rebuild-safe-canonical-merge')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_safe_canonical_merge', 1)
    const aiSettings = createMockAISettings(1)

    database.prepare(
      `INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, description,
        firstSeenChapter, lastSeenChapter, importanceTier, status, userConfirmed
      ) VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, ?, ?)`
    ).run('entity-subaru-space', novelId, branchId, '菜月 昴', '旧描述一', 1, 1, 'important', 'hanlp_bootstrap', 1)
    database.prepare(
      `INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, description,
        firstSeenChapter, lastSeenChapter, importanceTier, status, userConfirmed
      ) VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, ?, ?)`
    ).run('entity-subaru-dot', novelId, branchId, '菜月·昴', '更长的旧描述二', 1, 1, 'arc', 'known_character_update', 1)
    database.prepare(
      `INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, description,
        firstSeenChapter, lastSeenChapter, importanceTier, status, userConfirmed
      ) VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, ?, ?)`
    ).run('entity-subaru-plain', novelId, branchId, '菜月昴', '旧描述', 1, 1, 'important', 'candidate_promoted', 1)

    database.prepare('INSERT INTO EntityAlias (id, entityId, alias, sourceChapter) VALUES (?, ?, ?, ?)')
      .run('alias-subaru-486', 'entity-subaru-space', '486', 1)
    database.prepare('INSERT INTO EntityAlias (id, entityId, alias, sourceChapter) VALUES (?, ?, ?, ?)')
      .run('alias-subaru-kun', 'entity-subaru-dot', '昴君', 1)
    database.prepare(
      `INSERT INTO EntityAliasMapping (id, novelId, branchId, alias, entityId, sourceAliasId, sourceChapter)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('alias-map-subaru-486', novelId, branchId, '486', 'entity-subaru-space', 'alias-subaru-486', 1)
    database.prepare(
      `INSERT INTO EntityAliasMapping (id, novelId, branchId, alias, entityId, sourceAliasId, sourceChapter)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('alias-map-subaru-kun', novelId, branchId, '昴君', 'entity-subaru-dot', 'alias-subaru-kun', 1)
    database.prepare(
      `INSERT INTO what_if_sessions (
        id, novel_id, base_branch_id, source_chapter_no, title, premise,
        selected_text, original_text, generated_text, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('what-if-subaru', novelId, branchId, 1, '昴的分歧', '如果昴提前行动', '片段', '原文', '生成文', 'active')
    database.prepare(
      `INSERT INTO what_if_deltas (
        id, session_id, delta_type, subject_name, target_name, subject_entity_id, target_entity_id,
        key, old_value, new_value, valid_from_chapter, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'what-if-delta-subaru',
      'what-if-subaru',
      'relationship',
      '菜月 昴',
      '菜月·昴',
      'entity-subaru-space',
      'entity-subaru-dot',
      'self-link',
      null,
      'merged',
      1,
      '同一角色的分歧记录',
    )
    database.prepare(
      `INSERT INTO EntityAliasConflictLog (
        id, novelId, branchId, alias, existingEntityId, attemptedEntityId,
        existingCanonicalName, attemptedCanonicalName, sourceChapter, detailsJson
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'alias-conflict-subaru',
      novelId,
      branchId,
      '昴',
      'entity-subaru-space',
      'entity-subaru-dot',
      '菜月 昴',
      '菜月·昴',
      1,
      JSON.stringify({ reason: 'preexisting_conflict_log' }),
    )

    vi.doMock('@/lib/server/ai-settings', () => ({ loadStoredAISettings: () => aiSettings }))
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
        provider: 'openai-compatible' as const,
        model: aiSettings.knowledgeExtraction.openAICompatible.model,
        extraction: {
          chapterNo: 1,
          summary: 'summary-1',
          characters: [
            {
              name: '菜月 昴',
              aliases: ['486'],
              descriptionDelta: '穿着运动服',
              profile: {},
              status: 'hanlp_bootstrap',
              evidence: [{ quote: '菜月 昴现身。', lineStart: 1, lineEnd: 1 }],
            },
            {
              name: '菜月·昴',
              aliases: ['昴君'],
              descriptionDelta: '手里提着袋子',
              profile: {},
              status: 'known_character_update',
              evidence: [{ quote: '菜月·昴走近。', lineStart: 1, lineEnd: 1 }],
            },
            {
              name: '菜月昴',
              aliases: [],
              descriptionDelta: '神情镇定',
              profile: {},
              status: 'candidate_promoted',
              evidence: [{ quote: '菜月昴停下脚步。', lineStart: 1, lineEnd: 1 }],
            },
          ],
          knownCharacterUpdates: [],
          unknownCharacterObservations: [],
          aliasDiscoveries: [],
          relations: [],
          events: [{
            name: '雪夜会面',
            summary: '不同写法指向同一人',
            eventType: 'scene',
            importance: 3,
            consequences: '同名异写合并',
            participants: [
              { name: '菜月 昴', role: '主角' },
              { name: '菜月·昴', role: '主角' },
              { name: '菜月昴', role: '主角' },
            ],
            evidence: [{ quote: '三种写法同时出现。', lineStart: 1, lineEnd: 1 }],
          }],
          worldbuilding: [],
          openThreads: [{
            name: 'thread-1',
            description: 'proof',
            evidence: [{ quote: '第1章原文内容。', lineStart: 1, lineEnd: 1 }],
          }],
        },
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

    const mergedEntities = database.prepare(
      `SELECT id, canonicalName, status, description
       FROM KnowledgeEntity
       WHERE branchId = ? AND canonicalName IN ('菜月 昴', '菜月·昴', '菜月昴')
       ORDER BY canonicalName ASC`
    ).all(branchId) as Array<{ id: string; canonicalName: string; status: string | null; description: string | null }>
    const mentionRows = database.prepare(
      `SELECT mentionText, entityId
       FROM EntityMention
       WHERE branchId = ? AND mentionText IN ('菜月 昴', '菜月·昴', '菜月昴')
       ORDER BY mentionText ASC`
    ).all(branchId) as Array<{ mentionText: string; entityId: string | null }>
    const aliasRows = database.prepare(
      `SELECT alias, entityId
       FROM EntityAlias
       WHERE alias IN ('486', '昴君')
       ORDER BY alias ASC`
    ).all() as Array<{ alias: string; entityId: string }>
    const aliasMappings = database.prepare(
      `SELECT alias, entityId
       FROM EntityAliasMapping
       WHERE branchId = ? AND alias IN ('486', '昴君')
       ORDER BY alias ASC`
    ).all(branchId) as Array<{ alias: string; entityId: string }>
    const eventParticipants = database.prepare(
      `SELECT entityId, role
       FROM EventParticipant ep
       JOIN KnowledgeEvent ke ON ke.id = ep.eventId
       WHERE ke.branchId = ? AND ke.name = ?`
    ).all(branchId, '雪夜会面') as Array<{ entityId: string; role: string | null }>
    const factEntityIds = database.prepare(
      `SELECT DISTINCT subjectEntityId
       FROM KnowledgeFact
       WHERE branchId = ? AND factType IN ('character_status', 'character_profile') AND subjectEntityId IS NOT NULL`
    ).all(branchId) as Array<{ subjectEntityId: string }>
    const whatIfDelta = queryOne<{ subjectEntityId: string | null; targetEntityId: string | null }>(
      `SELECT subject_entity_id AS subjectEntityId, target_entity_id AS targetEntityId
       FROM what_if_deltas
       WHERE id = ?`,
      'what-if-delta-subaru',
    )
    const aliasConflict = queryOne<{ existingEntityId: string | null; attemptedEntityId: string | null }>(
      `SELECT existingEntityId, attemptedEntityId
       FROM EntityAliasConflictLog
       WHERE id = ?`,
      'alias-conflict-subaru',
    )

    expect(mergedEntities).toHaveLength(1)
    expect(mergedEntities[0]).toMatchObject({ canonicalName: '菜月昴', status: 'candidate_promoted' })
    expect(mentionRows).toHaveLength(3)
    expect(new Set(mentionRows.map((row) => row.entityId))).toEqual(new Set([mergedEntities[0]?.id]))
    expect(aliasRows).toEqual([
      { alias: '486', entityId: mergedEntities[0]!.id },
      { alias: '昴君', entityId: mergedEntities[0]!.id },
    ])
    expect(aliasMappings).toEqual([
      { alias: '486', entityId: mergedEntities[0]!.id },
      { alias: '昴君', entityId: mergedEntities[0]!.id },
    ])
    expect(eventParticipants).toEqual([
      { entityId: mergedEntities[0]!.id, role: '主角' },
    ])
    expect(factEntityIds).toEqual([
      { subjectEntityId: mergedEntities[0]!.id },
    ])
    expect(whatIfDelta).toMatchObject({
      subjectEntityId: mergedEntities[0]!.id,
      targetEntityId: mergedEntities[0]!.id,
    })
    expect(aliasConflict).toMatchObject({
      existingEntityId: mergedEntities[0]!.id,
      attemptedEntityId: mergedEntities[0]!.id,
    })
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM KnowledgeEntity WHERE id IN (?, ?)', 'entity-subaru-space', 'entity-subaru-dot')?.count).toBe(0)
  })

  it('applies later same-batch aliases before ordered writes so earlier unknown observations do not create candidates', async () => {
    const { database, queryOne } = await createTestDatabase('retale-knowledge-rebuild-alias-hit-no-candidate')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_alias_hit_no_candidate', 7)
    const aiSettings = createMockAISettings(7)

    database.prepare(
      `INSERT INTO KnowledgeEntity (id, novelId, branchId, entityType, canonicalName, firstSeenChapter, lastSeenChapter, importanceTier, status, userConfirmed)
       VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, 1)`
    ).run('entity-a', novelId, branchId, 'A', 1, 1, 'important', 'user_confirmed')

    vi.doMock('@/lib/server/ai-settings', () => ({ loadStoredAISettings: () => aiSettings }))
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
      extractChapterKnowledgeOffline: vi.fn(async (params: { chapterNo: number }) => ({
        provider: 'openai-compatible' as const,
        model: aiSettings.knowledgeExtraction.openAICompatible.model,
        extraction: {
          chapterNo: params.chapterNo,
          summary: `summary-${params.chapterNo}`,
          characters: [],
          knownCharacterUpdates: [],
          unknownCharacterObservations: params.chapterNo === 6
            ? [{
                surfaceText: 'B',
                observation: '身法很快',
                profile: {},
                evidence: [{ quote: '第6章原文内容。', lineStart: 1, lineEnd: 1 }],
              }]
            : [],
          aliasDiscoveries: params.chapterNo === 7
            ? [{ alias: 'B', target: 'A' }]
            : [],
          relations: [],
          events: [],
          worldbuilding: [],
          openThreads: [{
            name: `thread-${params.chapterNo}`,
            description: 'proof',
            evidence: [{ quote: `第${params.chapterNo}章原文内容。`, lineStart: 1, lineEnd: 1 }],
          }],
        },
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

    const candidateCount = queryOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM character_candidates WHERE branch_id = ? AND surface_text = ?',
      branchId,
      'B',
    )
    const mention = queryOne<{ mentionText: string; canonicalName: string }>(
      `SELECT em.mentionText AS mentionText, ke.canonicalName AS canonicalName
       FROM EntityMention em
       JOIN KnowledgeEntity ke ON ke.id = em.entityId
       WHERE em.branchId = ? AND em.mentionText = ?`,
      branchId,
      'B',
    )
    const aliasMapping = queryOne<{ alias: string; canonicalName: string }>(
      `SELECT m.alias AS alias, e.canonicalName AS canonicalName
       FROM EntityAliasMapping m
       JOIN KnowledgeEntity e ON e.id = m.entityId
       WHERE m.branchId = ? AND m.alias = ?`,
      branchId,
      'B',
    )
    const createdEntityB = queryOne<{ id: string }>(
      'SELECT id FROM KnowledgeEntity WHERE branchId = ? AND canonicalName = ?',
      branchId,
      'B',
    )

    expect(candidateCount?.count).toBe(0)
    expect(createdEntityB).toBeNull()
    expect(aliasMapping).toMatchObject({ alias: 'B', canonicalName: 'A' })
    expect(mention).toMatchObject({ mentionText: 'B', canonicalName: 'A' })
  })

  it('skips unresolved alias targets without creating formal entities', async () => {
    const { database, queryOne } = await createTestDatabase('retale-knowledge-rebuild-alias-skip-unresolved-target')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_alias_skip_unresolved_target', 1)
    const aiSettings = createMockAISettings(1)

    vi.doMock('@/lib/server/ai-settings', () => ({ loadStoredAISettings: () => aiSettings }))
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
        provider: 'openai-compatible' as const,
        model: aiSettings.knowledgeExtraction.openAICompatible.model,
        extraction: {
          chapterNo: 1,
          summary: 'summary-1',
          characters: [],
          knownCharacterUpdates: [],
          unknownCharacterObservations: [],
          aliasDiscoveries: [{ alias: 'B', target: 'A' }],
          relations: [],
          events: [],
          worldbuilding: [],
          openThreads: [{
            name: 'thread-1',
            description: 'proof',
            evidence: [{ quote: '第1章原文内容。', lineStart: 1, lineEnd: 1 }],
          }],
        },
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

    const aliasMapping = queryOne<{ alias: string }>(
      'SELECT alias FROM EntityAliasMapping WHERE branchId = ? AND alias = ?',
      branchId,
      'B',
    )
    const createdEntityA = queryOne<{ id: string }>(
      'SELECT id FROM KnowledgeEntity WHERE branchId = ? AND canonicalName = ?',
      branchId,
      'A',
    )
    const skipLog = queryOne<{ attemptedCanonicalName: string | null; detailsJson: string | null }>(
      'SELECT attemptedCanonicalName, detailsJson FROM EntityAliasConflictLog WHERE branchId = ? AND alias = ?',
      branchId,
      'B',
    )

    expect(aliasMapping).toBeNull()
    expect(createdEntityA).toBeNull()
    expect(skipLog?.attemptedCanonicalName).toBe('A')
    expect(skipLog?.detailsJson).toContain('alias_target_unresolved')
  })

  it('persists known updates on the canonical entity, preserves alias surface text, and keeps 没有变化 as a no-op', async () => {
    const { database, queryOne } = await createTestDatabase('retale-knowledge-rebuild-known-update-canonical-profile')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_known_update_alias_profile', 1)
    const aiSettings = createMockAISettings(1)

    database.prepare(
      `INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, description, firstSeenChapter, lastSeenChapter, importanceTier, status, userConfirmed
      ) VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, ?, ?)`
    ).run('entity-a', novelId, branchId, 'A', '旧描述', 1, 1, 'important', 'user_confirmed', 1)
    database.prepare('INSERT INTO EntityAlias (id, entityId, alias, sourceChapter) VALUES (?, ?, ?, ?)')
      .run('alias-a', 'entity-a', 'B', 1)
    database.prepare(
      `INSERT INTO EntityAliasMapping (id, novelId, branchId, alias, entityId, sourceChapter)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('alias-map-a', novelId, branchId, 'B', 'entity-a', 1)
    database.prepare(
      `INSERT INTO KnowledgeFact (
        id, novelId, branchId, factType, subjectEntityId, predicate, valueJson,
        sourceChapter, validFromChapter, validUntilChapter, status
      ) VALUES (?, ?, ?, 'character_profile', ?, 'role_card', ?, ?, ?, ?, ?)`
    ).run(
      'existing-profile',
      novelId,
      branchId,
      'entity-a',
      JSON.stringify({
        profile: {
          appearance: { summary: '旧外形' },
          body: { summary: '旧体态' },
          clothing: { summary: '旧衣着' },
        },
        descriptionDelta: '旧外形｜旧体态｜旧衣着',
      }),
      0,
      0,
      999999999,
      'user_confirmed',
    )

    vi.doMock('@/lib/server/ai-settings', () => ({ loadStoredAISettings: () => aiSettings }))
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
        provider: 'openai-compatible' as const,
        model: aiSettings.knowledgeExtraction.openAICompatible.model,
        extraction: {
          chapterNo: 1,
          summary: 'summary-1',
          characters: [],
          knownCharacterUpdates: [{
            name: 'B',
            descriptionDelta: '剑势更稳',
            profile: {
              capability: { content: '剑势更稳' },
              appearance: { content: '没有变化' },
              body: { content: '没有变化' },
              clothing: { content: '没有变化' },
            },
            evidence: [{ quote: 'B 剑势更稳。', lineStart: 1, lineEnd: 1 }],
          }],
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

    const mention = queryOne<{ entityId: string; mentionText: string }>(
      'SELECT entityId, mentionText FROM EntityMention WHERE branchId = ? ORDER BY createdAt DESC LIMIT 1',
      branchId,
    )
    const profileFact = queryOne<{ subjectEntityId: string | null; valueJson: string | null }>(
      `SELECT subjectEntityId, valueJson
       FROM KnowledgeFact
       WHERE branchId = ? AND factType = 'character_profile' AND sourceChapter = 1
       ORDER BY createdAt DESC
       LIMIT 1`,
      branchId,
    )
    const entity = queryOne<{ canonicalName: string; description: string | null }>(
      'SELECT canonicalName, description FROM KnowledgeEntity WHERE id = ? LIMIT 1',
      'entity-a',
    )

    const { buildKnowledgeProjection } = await import('@/lib/server/knowledge-view')
    const projection = await buildKnowledgeProjection([novelId], 1)
    const projectedCharacter = projection.localCharacters.find((character) => character.id === 'entity-a')
    const parsedValue = profileFact?.valueJson ? JSON.parse(profileFact.valueJson) as Record<string, unknown> : null

    expect(mention).toMatchObject({ entityId: 'entity-a', mentionText: 'B' })
    expect(profileFact?.subjectEntityId).toBe('entity-a')
    expect(parsedValue).toMatchObject({
      originalSurfaceText: 'B',
      canonicalName: 'A',
      importanceTier: 'important',
    })
    expect(entity).toMatchObject({ canonicalName: 'A', description: '旧描述' })
    expect(projectedCharacter?.profile).toMatchObject({
      capability: { content: '剑势更稳' },
      appearance: { content: '旧外形' },
      body: { content: '旧体态' },
      clothing: { content: '旧衣着' },
    })
  })
})
