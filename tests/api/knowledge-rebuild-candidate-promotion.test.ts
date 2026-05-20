import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }
const originalDatabaseUrl = process.env.DATABASE_URL
let fixtureSequence = 0

function createMockAISettings() {
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
        parallelism: 2,
      },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'unused-ollama-model',
        configured: true,
        parallelism: 2,
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
    const rawText = `第${chapterNo}章：灰袍老人再次出现。`
    insertChapter.run(chapterId, novelId, branchId, chapterNo, `第${chapterNo}章`, rawText, null, 1, 1, 'Needs rebuild', `chapter-hash-${chapterNo}`, 'stale')
    insertLine.run(`line-${chapterNo}`, chapterId, 1, rawText, 0, rawText.length)
    insertSpan.run(`span-${chapterNo}`, novelId, branchId, chapterId, chapterNo, 1, 1, 0, rawText.length, rawText, 'evidence', rawText.length)
  }

  return { novelId, branchId }
}

function createUnknownObservation(surfaceText: string, observation: string) {
  return {
    surfaceText,
    observation,
    profile: {},
    evidence: [{ quote: observation, lineStart: 1, lineEnd: 1 }],
  }
}

function mockKnowledgeRebuildDependencies(params: {
  aiSettings: ReturnType<typeof createMockAISettings>
  summarySpy: ReturnType<typeof vi.fn>
  unknownObservationsByChapter: Record<number, Array<ReturnType<typeof createUnknownObservation>>>
}) {
  vi.doMock('@/lib/server/ai-settings', () => ({ loadStoredAISettings: () => params.aiSettings }))
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
  vi.doMock('@/lib/server/candidate-promotion-summary', () => ({
    generateCandidatePromotionSummary: params.summarySpy,
  }))
  vi.doMock('@/lib/server/knowledge-extraction', () => ({
    extractChapterKnowledgeOffline: vi.fn(async (chapterParams: { chapterNo: number }) => ({
      provider: 'openai-compatible' as const,
      model: params.aiSettings.knowledgeExtraction.openAICompatible.model,
      extraction: {
        chapterNo: chapterParams.chapterNo,
        summary: `summary-${chapterParams.chapterNo}`,
        characters: [],
        knownCharacterUpdates: [],
        unknownCharacterObservations: params.unknownObservationsByChapter[chapterParams.chapterNo] ?? [],
        aliasDiscoveries: [],
        relations: [],
        events: [],
        worldbuilding: [],
        openThreads: [{
          name: `thread-${chapterParams.chapterNo}`,
          description: 'proof',
          evidence: [{ quote: `第${chapterParams.chapterNo}章：灰袍老人再次出现。`, lineStart: 1, lineEnd: 1 }],
        }],
      },
    })),
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  vi.unmock('@/lib/server/ai-settings')
  vi.unmock('@/lib/server/hanlp-bootstrap')
  vi.unmock('@/lib/server/hanlp-bootstrap-initializer')
  vi.unmock('@/lib/server/knowledge-extraction')
  vi.unmock('@/lib/server/retrieval-index')
  vi.unmock('@/lib/server/candidate-promotion-summary')

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

describe('knowledge rebuild candidate promotion', () => {
  it('does not promote when a candidate appears in only 9 distinct chapters', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-candidate-promotion-nine-chapters')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_candidate_nine_chapters', 9)
    const aiSettings = createMockAISettings()
    const summarySpy = vi.fn(async () => ({
      summary: 'should not run',
      descriptionDelta: 'should not run',
      status: '活跃',
      profile: {},
    }))

    mockKnowledgeRebuildDependencies({
      aiSettings,
      summarySpy,
      unknownObservationsByChapter: Object.fromEntries(
        Array.from({ length: 9 }, (_, index) => {
          const chapterNo = index + 1
          return [chapterNo, [createUnknownObservation('灰袍老人', `灰袍老人第${chapterNo}章再次现身。`)]]
        })
      ),
    })

    const { rebuildKnowledgeForNovel } = await import('@/lib/server/knowledge-rebuild')

    await expect(rebuildKnowledgeForNovel({ novelId })).resolves.toMatchObject({ outcome: 'completed' })

    const candidate = queryOne<{
      chapterCount: number
      mentionCount: number
      status: string
      promotedEntityId: string | null
      promotionSummaryStatus: string
    }>(
      `
        SELECT chapter_count AS chapterCount,
               mention_count AS mentionCount,
               status,
               promoted_entity_id AS promotedEntityId,
               promotion_summary_status AS promotionSummaryStatus
        FROM character_candidates
        WHERE branch_id = ? AND surface_text = ?
        LIMIT 1
      `,
      branchId,
      '灰袍老人',
    )
    const promotedEntityCount = queryOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM KnowledgeEntity WHERE branchId = ?',
      branchId,
    )

    expect(candidate).toMatchObject({
      chapterCount: 9,
      mentionCount: 9,
      status: 'collecting',
      promotedEntityId: null,
      promotionSummaryStatus: 'not_requested',
    })
    expect(promotedEntityCount?.count).toBe(0)
    expect(summarySpy).not.toHaveBeenCalled()
  })

  it('does not promote when 20 mentions happen in the same chapter only', async () => {
    const { database, queryOne, queryAll } = await createTestDatabase('chatbook-candidate-promotion-single-chapter')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_candidate_single_chapter', 1)
    const aiSettings = createMockAISettings()
    const summarySpy = vi.fn(async () => ({
      summary: 'should not run',
      descriptionDelta: 'should not run',
      status: '活跃',
      profile: {},
    }))

    mockKnowledgeRebuildDependencies({
      aiSettings,
      summarySpy,
      unknownObservationsByChapter: {
        1: Array.from({ length: 20 }, (_, index) => createUnknownObservation('灰袍老人', `灰袍老人第1章第${index + 1}次出现。`)),
      },
    })

    const { rebuildKnowledgeForNovel } = await import('@/lib/server/knowledge-rebuild')

    await expect(rebuildKnowledgeForNovel({ novelId })).resolves.toMatchObject({ outcome: 'completed' })

    const candidate = queryOne<{
      chapterCount: number
      mentionCount: number
      status: string
      promotedEntityId: string | null
      promotionSummaryStatus: string
    }>(
      `
        SELECT chapter_count AS chapterCount,
               mention_count AS mentionCount,
               status,
               promoted_entity_id AS promotedEntityId,
               promotion_summary_status AS promotionSummaryStatus
        FROM character_candidates
        WHERE branch_id = ? AND surface_text = ?
        LIMIT 1
      `,
      branchId,
      '灰袍老人',
    )
    const chapterRows = queryAll<{ chapterNo: number; mentionCount: number }>(
      `
        SELECT chapter_no AS chapterNo, mention_count AS mentionCount
        FROM character_candidate_chapters
        WHERE branch_id = ?
        ORDER BY chapter_no ASC
      `,
      branchId,
    )
    const promotedEntityCount = queryOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM KnowledgeEntity WHERE branchId = ?',
      branchId,
    )

    expect(candidate).toMatchObject({
      chapterCount: 1,
      mentionCount: 20,
      status: 'collecting',
      promotedEntityId: null,
      promotionSummaryStatus: 'not_requested',
    })
    expect(chapterRows).toEqual([{ chapterNo: 1, mentionCount: 20 }])
    expect(promotedEntityCount?.count).toBe(0)
    expect(summarySpy).not.toHaveBeenCalled()
  })

  it('promotes once at 10 distinct chapters, preserves per-chapter mention counts, and skips summary reruns', async () => {
    const { database, queryOne, queryAll } = await createTestDatabase('chatbook-candidate-promotion')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_candidate_promotion', 10)
    const aiSettings = createMockAISettings()
    const summarySpy = vi.fn(async () => ({
      summary: '灰袍老人多次出现，拄杖而行，嗓音沙哑。',
      descriptionDelta: '灰袍老人｜拄杖而行｜嗓音沙哑',
      status: '活跃',
      profile: {
        appearance: { summary: '灰袍老人' },
        speakingStyle: { summary: '嗓音沙哑' },
      },
    }))

    mockKnowledgeRebuildDependencies({
      aiSettings,
      summarySpy,
      unknownObservationsByChapter: {
        1: [
          createUnknownObservation('灰袍老人', '灰袍老人拄杖而来。'),
          createUnknownObservation('灰袍老人', '灰袍老人嗓音沙哑。'),
        ],
        2: [createUnknownObservation('灰袍老人', '灰袍老人第2章再次现身。')],
        3: [createUnknownObservation('灰袍老人', '灰袍老人第3章再次现身。')],
        4: [createUnknownObservation('灰袍老人', '灰袍老人第4章再次现身。')],
        5: [createUnknownObservation('灰袍老人', '灰袍老人第5章再次现身。')],
        6: [createUnknownObservation('灰袍老人', '灰袍老人第6章再次现身。')],
        7: [createUnknownObservation('灰袍老人', '灰袍老人第7章再次现身。')],
        8: [createUnknownObservation('灰袍老人', '灰袍老人第8章再次现身。')],
        9: [createUnknownObservation('灰袍老人', '灰袍老人第9章再次现身。')],
        10: [createUnknownObservation('灰袍老人', '灰袍老人第10章再次现身。')],
      },
    })

    const { rebuildKnowledgeForNovel } = await import('@/lib/server/knowledge-rebuild')

    await expect(rebuildKnowledgeForNovel({ novelId })).resolves.toMatchObject({ outcome: 'completed' })

    const candidate = queryOne<{
      id: string
      chapterCount: number
      mentionCount: number
      status: string
      promotedEntityId: string | null
      promotionSummaryStatus: string
    }>(
      `
        SELECT id,
               chapter_count AS chapterCount,
               mention_count AS mentionCount,
               status,
               promoted_entity_id AS promotedEntityId,
               promotion_summary_status AS promotionSummaryStatus
        FROM character_candidates
        WHERE branch_id = ? AND surface_text = ?
        LIMIT 1
      `,
      branchId,
      '灰袍老人',
    )
    const chapterRows = queryAll<{ chapterNo: number; mentionCount: number }>(
      `
        SELECT chapter_no AS chapterNo, mention_count AS mentionCount
        FROM character_candidate_chapters
        WHERE branch_id = ?
        ORDER BY chapter_no ASC
      `,
      branchId,
    )
    const promotedEntity = queryOne<{ canonicalName: string; importanceTier: string | null; status: string | null }>(
      'SELECT canonicalName, importanceTier, status FROM KnowledgeEntity WHERE id = ? LIMIT 1',
      candidate?.promotedEntityId,
    )
    const state = queryOne<{ status: string; stateValue: string; description: string | null }>(
      `
        SELECT status, stateValue, description
        FROM EntityState
        WHERE entityId = ? AND status = 'candidate_promoted_summary'
        LIMIT 1
      `,
      candidate?.promotedEntityId,
    )
    const facts = queryAll<{ factType: string; predicate: string; status: string }>(
      `
        SELECT factType, predicate, status
        FROM KnowledgeFact
        WHERE subjectEntityId = ? AND status = 'candidate_promoted_summary'
        ORDER BY factType ASC, predicate ASC
      `,
      candidate?.promotedEntityId,
    )

    expect(candidate).toMatchObject({
      chapterCount: 10,
      mentionCount: 11,
      status: 'promoted',
      promotionSummaryStatus: 'completed',
    })
    expect(candidate?.promotedEntityId).toBeTruthy()
    expect(chapterRows).toHaveLength(10)
    expect(chapterRows[0]).toMatchObject({ chapterNo: 1, mentionCount: 2 })
    expect(promotedEntity).toMatchObject({ canonicalName: '灰袍老人', importanceTier: 'arc', status: 'candidate_promoted' })
    expect(state).toMatchObject({ status: 'candidate_promoted_summary', stateValue: '活跃' })
    expect(facts).toEqual([
      { factType: 'character_profile', predicate: 'role_card', status: 'candidate_promoted_summary' },
      { factType: 'character_status', predicate: 'status', status: 'candidate_promoted_summary' },
    ])
    expect(summarySpy).toHaveBeenCalledTimes(1)

    await expect(rebuildKnowledgeForNovel({ novelId })).resolves.toMatchObject({ outcome: 'completed' })

    const rerunCandidate = queryOne<{ chapterCount: number; mentionCount: number; promotionSummaryStatus: string }>(
      `
        SELECT chapter_count AS chapterCount,
               mention_count AS mentionCount,
               promotion_summary_status AS promotionSummaryStatus
        FROM character_candidates
        WHERE branch_id = ? AND surface_text = ?
        LIMIT 1
      `,
      branchId,
      '灰袍老人',
    )
    const rerunChapterRows = queryAll<{ chapterNo: number; mentionCount: number }>(
      `
        SELECT chapter_no AS chapterNo, mention_count AS mentionCount
        FROM character_candidate_chapters
        WHERE branch_id = ?
        ORDER BY chapter_no ASC
      `,
      branchId,
    )

    expect(rerunCandidate).toMatchObject({ chapterCount: 10, mentionCount: 11, promotionSummaryStatus: 'completed' })
    expect(rerunChapterRows[0]).toMatchObject({ chapterNo: 1, mentionCount: 2 })
    expect(summarySpy).toHaveBeenCalledTimes(1)
  })

  it('recovers a promoted pending summary on rerun after the first summary attempt fails', async () => {
    const { database, queryOne, queryAll } = await createTestDatabase('chatbook-candidate-promotion-recovery')
    const { novelId, branchId } = seedKnowledgeRebuildFixture(database, 'novel_candidate_promotion_recovery', 10)
    const aiSettings = createMockAISettings()
    const summarySpy = vi.fn()
      .mockRejectedValueOnce(new Error('summary service unavailable'))
      .mockResolvedValueOnce({
        summary: '灰袍老人多次现身，拄杖而行，疑似与黑塔有关。',
        descriptionDelta: '灰袍老人｜拄杖而行｜与黑塔有关',
        status: '活跃',
        profile: {
          appearance: { summary: '灰袍老人' },
          identity: { summary: '疑似与黑塔有关' },
        },
      })

    mockKnowledgeRebuildDependencies({
      aiSettings,
      summarySpy,
      unknownObservationsByChapter: Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => {
          const chapterNo = index + 1
          return [chapterNo, [createUnknownObservation('灰袍老人', `灰袍老人第${chapterNo}章再次现身。`)]]
        }),
      ),
    })

    const { rebuildKnowledgeForNovel } = await import('@/lib/server/knowledge-rebuild')

    await expect(rebuildKnowledgeForNovel({ novelId })).resolves.toMatchObject({ outcome: 'completed' })

    const firstRunCandidate = queryOne<{
      status: string
      promotedEntityId: string | null
      promotionSummaryStatus: string
      promotionSummaryGeneratedAt: string | null
    }>(
      `
        SELECT status,
               promoted_entity_id AS promotedEntityId,
               promotion_summary_status AS promotionSummaryStatus,
               promotion_summary_generated_at AS promotionSummaryGeneratedAt
        FROM character_candidates
        WHERE branch_id = ? AND surface_text = ?
        LIMIT 1
      `,
      branchId,
      '灰袍老人',
    )
    const firstRunFacts = queryAll<{ factType: string }>(
      `
        SELECT factType
        FROM KnowledgeFact
        WHERE branchId = ? AND subjectEntityId = ? AND status = 'candidate_promoted_summary'
      `,
      branchId,
      firstRunCandidate?.promotedEntityId,
    )

    expect(firstRunCandidate).toMatchObject({
      status: 'promoted_pending_summary',
      promotionSummaryStatus: 'pending',
      promotionSummaryGeneratedAt: null,
    })
    expect(firstRunCandidate?.promotedEntityId).toBeTruthy()
    expect(firstRunFacts).toEqual([])

    await expect(rebuildKnowledgeForNovel({ novelId })).resolves.toMatchObject({ outcome: 'completed' })

    const rerunCandidate = queryOne<{
      status: string
      promotedEntityId: string | null
      promotionSummaryStatus: string
      promotionSummaryGeneratedAt: string | null
    }>(
      `
        SELECT status,
               promoted_entity_id AS promotedEntityId,
               promotion_summary_status AS promotionSummaryStatus,
               promotion_summary_generated_at AS promotionSummaryGeneratedAt
        FROM character_candidates
        WHERE branch_id = ? AND surface_text = ?
        LIMIT 1
      `,
      branchId,
      '灰袍老人',
    )
    const rerunFacts = queryAll<{ factType: string; predicate: string; status: string }>(
      `
        SELECT factType, predicate, status
        FROM KnowledgeFact
        WHERE branchId = ? AND subjectEntityId = ? AND status = 'candidate_promoted_summary'
        ORDER BY factType ASC, predicate ASC
      `,
      branchId,
      rerunCandidate?.promotedEntityId,
    )

    expect(rerunCandidate).toMatchObject({
      status: 'promoted',
      promotionSummaryStatus: 'completed',
    })
    expect(rerunCandidate?.promotionSummaryGeneratedAt).toEqual(expect.any(String))
    expect(rerunFacts).toEqual([
      { factType: 'character_profile', predicate: 'role_card', status: 'candidate_promoted_summary' },
      { factType: 'character_status', predicate: 'status', status: 'candidate_promoted_summary' },
    ])
    expect(summarySpy).toHaveBeenCalledTimes(2)
  })
})
