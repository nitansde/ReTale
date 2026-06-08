import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }
const originalDatabaseUrl = process.env.DATABASE_URL
const originalTaskStaleTimeoutMs = process.env.CHATBOOK_TASK_STALE_TIMEOUT_MS
const originalTaskMaxRetries = process.env.CHATBOOK_TASK_MAX_RETRIES
const API_TEST_TIMEOUT_MS = 120_000

vi.setConfig({ testTimeout: API_TEST_TIMEOUT_MS, hookTimeout: API_TEST_TIMEOUT_MS })

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

async function loadKnowledgeViewRoute() {
  return import('@/app/api/knowledge-view/route')
}

function createJsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function seedNovel(database: DatabaseSync, novelId: string) {
  const mainBranchId = `${novelId}:main`
  const altBranchId = `${novelId}:alt`
  database.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run(novelId, `Novel ${novelId}`, 'workspace')
  database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run(mainBranchId, novelId, 'main')
  database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run(altBranchId, novelId, 'alt')
  return { mainBranchId, altBranchId }
}

function seedKnowledgeChapter(database: DatabaseSync, params: {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
}) {
  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, revision, isDirty, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.chapterId,
    params.novelId,
    params.branchId,
    params.chapterNo,
    `第${params.chapterNo}章`,
    `第${params.chapterNo}章原文内容。`,
    1,
    0,
    `source-hash-${params.chapterId}`,
    'queued',
  )
}

function insertFormalKnowledgeFixtures(database: DatabaseSync, params: {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  idPrefix: string
}) {
  database.prepare(
    `INSERT INTO KnowledgeEntity (
      id, novelId, branchId, entityType, canonicalName, importanceTier, importance, firstSeenChapter, lastSeenChapter, status
    ) VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, ?)`
  ).run(
    `${params.idPrefix}-entity`,
    params.novelId,
    params.branchId,
    `${params.idPrefix}角色`,
    'important',
    4,
    params.chapterNo,
    params.chapterNo,
    'ready',
  )

  database.prepare(
    `INSERT INTO KnowledgeWorld (
      id, novelId, branchId, term, category, definition,
      firstSeenChapter, validFromChapter, validUntilChapter, status, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${params.idPrefix}-world`,
    params.novelId,
    params.branchId,
    `${params.idPrefix}地点`,
    'location',
    '已有正式知识。',
    params.chapterNo,
    params.chapterNo,
    999999,
    'ready',
    1,
  )

  database.prepare(
    `INSERT INTO KnowledgeEvent (
      id, novelId, branchId, name, summary, chapterNo, importance, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${params.idPrefix}-event`,
    params.novelId,
    params.branchId,
    `${params.idPrefix}事件`,
    '已有时间线事件。',
    params.chapterNo,
    1,
    'ready',
  )

  database.prepare(
    `INSERT INTO KnowledgeFact (
      id, novelId, branchId, factType, predicate, valueJson, sourceChapter, validFromChapter, validUntilChapter, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${params.idPrefix}-fact`,
    params.novelId,
    params.branchId,
    'open_thread',
    `${params.idPrefix}伏笔`,
    JSON.stringify({ description: '已有大纲伏笔。' }),
    params.chapterNo,
    params.chapterNo,
    999999,
    'ready',
  )
}

function insertTextSpanFixture(database: DatabaseSync, params: {
  id: string
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  text: string
}) {
  database.prepare(
    `INSERT INTO TextSpan (
      id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd, charStart, charEnd, text, spanType, tokenEstimate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.id,
    params.novelId,
    params.branchId,
    params.chapterId,
    params.chapterNo,
    1,
    1,
    0,
    params.text.length,
    params.text,
    'paragraph',
    params.text.length,
  )
}

function insertHanlpCacheFixture(database: DatabaseSync, params: {
  idPrefix: string
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
}) {
  const cacheId = `${params.idPrefix}-cache`
  const resultId = `${params.idPrefix}-result`
  const entityId = `${params.idPrefix}-entity`

  database.prepare(
    `INSERT INTO hanlp_bootstrap_cache (
      id, novel_id, branch_id, chapter_id, chapter_no, chapter_text_hash,
      hanlp_script_version_hash, hanlp_model_or_config_hash, output_schema_version,
      cache_key, input_hash, pipeline_version, source_chapter_id, source_chapter_no,
      request_json, result_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    cacheId,
    params.novelId,
    params.branchId,
    params.chapterId,
    params.chapterNo,
    `chapter-text-hash-${params.idPrefix}`,
    `script-hash-${params.idPrefix}`,
    `model-hash-${params.idPrefix}`,
    'v1',
    `cache-key-${params.idPrefix}`,
    `input-hash-${params.idPrefix}`,
    'hanlp-bootstrap:v1',
    params.chapterId,
    params.chapterNo,
    JSON.stringify({ chapterNo: params.chapterNo }),
    JSON.stringify({ people: [] }),
    'ready',
  )

  database.prepare(
    `INSERT INTO hanlp_bootstrap_results (
      id, novel_id, branch_id, chapter_id, chapter_no, chapter_source_hash,
      result_kind, provider, model, result_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    resultId,
    params.novelId,
    params.branchId,
    params.chapterId,
    params.chapterNo,
    `chapter-source-hash-${params.idPrefix}`,
    'bootstrap',
    'local',
    'hanlp',
    JSON.stringify({ people: [] }),
    'ready',
  )

  database.prepare(
    `INSERT INTO hanlp_bootstrap_entities (
      id, novel_id, branch_id, chapter_id, chapter_no, entity_text, entity_type,
      total_count, chapter_count, coverage_ratio, score, source_cache_id, source_result_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entityId,
    params.novelId,
    params.branchId,
    params.chapterId,
    params.chapterNo,
    `角色-${params.idPrefix}`,
    'person',
    1,
    1,
    1,
    0.9,
    cacheId,
    resultId,
  )
}

function insertExtractionCacheFixture(database: DatabaseSync, params: {
  idPrefix: string
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  batchChapterNos?: number[]
}) {
  const processingBatchId = params.batchChapterNos?.length ? `${params.idPrefix}-batch` : null
  if (processingBatchId) {
    database.prepare(
      `INSERT INTO chapter_extraction_processing_batches (
        id, novel_id, branch_id, batch_identity_hash, batch_context_json
      ) VALUES (?, ?, ?, ?, ?)`
    ).run(
      processingBatchId,
      params.novelId,
      params.branchId,
      `${params.idPrefix}-batch-hash`,
      JSON.stringify({
        schemaVersion: 'knowledge-extraction-processing-batch:v1',
        batch: {
          chapterIds: [params.chapterId],
          chapterNos: params.batchChapterNos,
          aliasDiscoveries: [],
        },
      }),
    )
  }

  database.prepare(
    `INSERT INTO chapter_extraction_candidates (
      id, novel_id, branch_id, chapter_id, chapter_no, chapter_revision,
      chapter_source_hash, extraction_json, processing_batch_id, status, provider, model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${params.idPrefix}-candidate`,
    params.novelId,
    params.branchId,
    params.chapterId,
    params.chapterNo,
    1,
    `candidate-source-hash-${params.idPrefix}`,
    JSON.stringify({ chapterNo: params.chapterNo, summary: `summary-${params.idPrefix}` }),
    processingBatchId,
    'extracted',
    'openai-compatible',
    'knowledge-model',
  )
}

afterEach(() => {
  vi.unmock('@/lib/server/retrieval-index')
  vi.unmock('@/lib/server/knowledge-worker-scheduler')
  vi.doUnmock('@/lib/server/retrieval-index')
  vi.doUnmock('@/lib/server/knowledge-worker-scheduler')
  vi.resetModules()

  if (globalForSqlite.sqlite) {
    try {
      ;(globalForSqlite.sqlite as DatabaseSync & { close?: () => void }).close?.()
    } catch {
    }
    delete globalForSqlite.sqlite
  }

  process.env.DATABASE_URL = originalDatabaseUrl
  process.env.CHATBOOK_TASK_STALE_TIMEOUT_MS = originalTaskStaleTimeoutMs
  process.env.CHATBOOK_TASK_MAX_RETRIES = originalTaskMaxRetries

  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('/api/knowledge-view', () => {
  it('reconciles stale active jobs during GET and reschedules the queued retry', async () => {
    process.env.CHATBOOK_TASK_STALE_TIMEOUT_MS = '1000'
    process.env.CHATBOOK_TASK_MAX_RETRIES = '1'

    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-view-watchdog-route-get')
    const novelId = `novel_knowledge_view_watchdog_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)
    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-watchdog-1', chapterNo: 1 })

    database.prepare(
      `INSERT INTO KnowledgeJob (
        id, novelId, branchId, jobType, status, progress, currentStep, payloadJson, createdAt, updatedAt
      ) VALUES (?, ?, ?, 'extract_chapter_knowledge', 'running', ?, ?, ?, datetime('now', '-10 seconds'), datetime('now', '-10 seconds'))`
    ).run(
      'job_knowledge_view_watchdog_get',
      novelId,
      mainBranchId,
      0.42,
      '抽取中',
      JSON.stringify({ branchId: mainBranchId, steps: [] }),
    )

    const scheduleSpy = vi.fn().mockReturnValue(true)
    vi.doMock('@/lib/server/knowledge-worker-scheduler', () => ({
      scheduleKnowledgeWorkerProcess: scheduleSpy,
    }))

    const { GET } = await loadKnowledgeViewRoute()
    const response = await GET(new Request(`http://localhost/api/knowledge-view?novelId=${novelId}&statusOnly=1`))
    const data = await response.json() as {
      ok: boolean
      knowledgeRebuildStatus: { jobId: string; status: string; errorMessage: string | null } | null
    }

    const row = queryOne<{ status: string; errorMessage: string | null; payloadJson: string | null }>(
      'SELECT status, errorMessage, payloadJson FROM KnowledgeJob WHERE id = ?',
      'job_knowledge_view_watchdog_get',
    )
    const payload = JSON.parse(row?.payloadJson ?? '{}') as { taskWatchdog?: { attemptCount?: number; attemptId?: string; lastAction?: string } }

    expect(response.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.knowledgeRebuildStatus).toMatchObject({
      jobId: 'job_knowledge_view_watchdog_get',
      status: 'queued',
      errorMessage: expect.stringContaining('无进度更新'),
    })
    expect(row).toMatchObject({
      status: 'queued',
      errorMessage: expect.stringContaining('无进度更新'),
    })
    expect(payload.taskWatchdog).toMatchObject({
      attemptCount: 1,
      lastAction: 'retried',
    })
    expect(payload.taskWatchdog?.attemptId).toEqual(expect.any(String))
    expect(scheduleSpy).toHaveBeenCalledWith({
      novelId,
      branchId: mainBranchId,
      jobId: 'job_knowledge_view_watchdog_get',
      jobType: 'extract_chapter_knowledge',
    })
  })

  it('projects formal character classifications and aliases while excluding candidates from formal characters', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-view-character-classification')
    const novelId = `novel_knowledge_view_classification_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)
    const protagonistEntityId = `${novelId}-entity-protagonist`
    const importantEntityId = `${novelId}-entity-important`
    const arcEntityId = `${novelId}-entity-arc`
    const rejectedArcEntityId = `${novelId}-entity-rejected-arc`

    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-classification-1', chapterNo: 1 })

    database.prepare(
      `INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, importanceTier, importance, firstSeenChapter, lastSeenChapter, status
      ) VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, ?)`
    ).run(protagonistEntityId, novelId, mainBranchId, '林砚', 'protagonist', 5, 1, 1, 'ready')
    database.prepare(
      `INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, importanceTier, importance, firstSeenChapter, lastSeenChapter, status
      ) VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, ?)`
    ).run(importantEntityId, novelId, mainBranchId, '苏九', 'important', 4, 1, 1, 'ready')
    database.prepare(
      `INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, importanceTier, importance, firstSeenChapter, lastSeenChapter, status
      ) VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, ?)`
    ).run(arcEntityId, novelId, mainBranchId, '灰袍老人', 'arc', 3, 1, 1, 'candidate_promoted')
    database.prepare(
      `INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, importanceTier, importance, firstSeenChapter, lastSeenChapter, status
      ) VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, ?)`
    ).run(rejectedArcEntityId, novelId, mainBranchId, '被拒绝的临时角色', 'arc', 1, 1, 1, 'rejected')

    database.prepare('INSERT INTO EntityAlias (id, entityId, alias, sourceChapter) VALUES (?, ?, ?, ?)')
      .run(`${novelId}-alias-1`, importantEntityId, '阿九', 1)
    database.prepare(
       `INSERT INTO EntityAliasMapping (id, novelId, branchId, alias, entityId, sourceChapter)
        VALUES (?, ?, ?, ?, ?, ?)`
    ).run(`${novelId}-alias-map-1`, novelId, mainBranchId, '九姑娘', importantEntityId, 1)

    database.prepare(
      `INSERT INTO character_candidates (
        id, novel_id, branch_id, surface_text, first_seen_chapter, last_seen_chapter,
        chapter_count, mention_count, observations_json, status, promoted_entity_id, merged_entity_id,
        display_name, normalized_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(`${novelId}-candidate-1`, novelId, mainBranchId, '路人甲', 1, 1, 3, 3, '[]', 'collecting', null, null, '路人甲', '路人甲')

    const { GET } = await loadKnowledgeViewRoute()
    const response = await GET(new Request(`http://localhost/api/knowledge-view?novelId=${novelId}`))
    const payload = await response.json() as {
      ok: boolean
      localCharacters: Array<Record<string, unknown>>
    }

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.localCharacters).toHaveLength(3)
    expect(payload.localCharacters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: '林砚',
        importanceTier: 'protagonist',
        classificationKey: 'tier0',
        classificationLabel: 'Tier 0',
      }),
      expect.objectContaining({
        name: '苏九',
        importanceTier: 'important',
        classificationKey: 'tier1',
        classificationLabel: 'Tier 1',
        aliases: expect.arrayContaining(['阿九', '九姑娘']),
      }),
      expect.objectContaining({
        name: '灰袍老人',
        importanceTier: 'arc',
        classificationKey: 'tier2',
        classificationLabel: 'Tier 2',
      }),
    ]))
    expect(payload.localCharacters.some((character) => character.name === '路人甲')).toBe(false)
    expect(payload.localCharacters.some((character) => character.name === '被拒绝的临时角色')).toBe(false)
  })

  it('projects literal HanLP world categories into workspace world entry types', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-view-hanlp-world-categories')
    const novelId = `novel_knowledge_view_world_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)

    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-world-1', chapterNo: 1 })

    const insertWorld = database.prepare(
      `INSERT INTO KnowledgeWorld (
        id, novelId, branchId, term, category, definition,
        firstSeenChapter, validFromChapter, validUntilChapter, status, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    insertWorld.run('world-hanlp-location', novelId, mainBranchId, '北京', 'location', '主角抵达的地点。', 1, 1, 999999, 'ai_generated', 0.7)
    insertWorld.run('world-hanlp-organization', novelId, mainBranchId, '黑塔', 'organization', '训练学徒的组织。', 1, 1, 999999, 'ai_generated', 0.7)
    insertWorld.run('world-hanlp-setting', novelId, mainBranchId, '夜雨', 'setting', '本章出现的场景氛围。', 1, 1, 999999, 'ai_generated', 0.7)

    const { GET } = await loadKnowledgeViewRoute()
    const response = await GET(new Request(`http://localhost/api/knowledge-view?novelId=${novelId}`))
    const payload = await response.json() as {
      ok: boolean
      localWorldEntries: Array<{ title: string; type: string }>
    }

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.localWorldEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '北京', type: 'location' }),
      expect.objectContaining({ title: '黑塔', type: 'organization' }),
      expect.objectContaining({ title: '夜雨', type: 'scene' }),
    ]))
  })

  it('surfaces HanLP telemetry on the knowledge rebuild status payload', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-view-hanlp-telemetry')
    const novelId = `novel_knowledge_view_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)

    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-telemetry-1', chapterNo: 1 })
    insertHanlpCacheFixture(database, {
      idPrefix: 'telemetry-main',
      novelId,
      branchId: mainBranchId,
      chapterId: 'chapter-telemetry-1',
      chapterNo: 1,
    })

    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, progress, payloadJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'job_knowledge_view_hanlp',
      novelId,
      mainBranchId,
      'extract_chapter_knowledge',
      'running',
      'hanlp-bootstrap',
      0.18,
      JSON.stringify({
        steps: [
          {
            key: 'hanlp-bootstrap',
            label: 'HanLP 引导扫描',
            status: 'running',
            progress: 0.5,
            etaMinutes: 3,
            detail: null,
          },
        ],
        rawTextEmbeddingProgress: 0.25,
        rawTextEmbeddingCacheHitRate: 0.5,
        hanlpBootstrap: {
          completedChapterIds: ['chapter-1', 'chapter-2'],
          totalChapterCount: 4,
          completedChapterCount: 2,
          cacheHitCount: 1,
          cacheMissCount: 1,
          initializedCharacterEntities: true,
        },
        stageTimingsMs: {
          'hanlp-bootstrap': 120,
        },
      })
    )

    const { GET } = await loadKnowledgeViewRoute()
    const response = await GET(new Request(`http://localhost/api/knowledge-view?novelId=${novelId}`))
    const payload = await response.json() as {
      ok: boolean
      knowledgeRebuildStatus: Record<string, unknown> | null
      hanlpCacheSnapshot: Record<string, unknown> | null
    }

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.knowledgeRebuildStatus).toMatchObject({
      jobId: 'job_knowledge_view_hanlp',
      novelId,
      status: 'running',
      rawTextEmbeddingProgress: 0.25,
      rawTextEmbeddingCacheHitRate: 0.5,
      hanlpCacheStatus: 'running',
      hanlpCacheHitRate: 0.5,
      hanlpBootstrapProgress: 0.5,
      hanlpBootstrapCompletedChapterCount: 2,
      hanlpBootstrapTotalChapterCount: 4,
      hanlpBootstrapCacheHitCount: 1,
      hanlpBootstrapCacheMissCount: 1,
      hanlpBootstrapInitializedCharacterEntities: true,
      hanlpSettingsSnapshot: {
        hanlpScriptVersionHash: 'script-hash-telemetry-main',
        hanlpModelOrConfigHash: 'model-hash-telemetry-main',
        outputSchemaVersion: 'v1',
        pipelineVersion: 'hanlp-bootstrap:v1',
      },
      stageTimingsMs: {
        'hanlp-bootstrap': 120,
      },
    })
    expect(payload.hanlpCacheSnapshot).toMatchObject({
      status: 'running',
      settingsSnapshot: {
        hanlpScriptVersionHash: 'script-hash-telemetry-main',
        hanlpModelOrConfigHash: 'model-hash-telemetry-main',
        outputSchemaVersion: 'v1',
        pipelineVersion: 'hanlp-bootstrap:v1',
      },
    })
  })

  it('surfaces retrieval task status in the overview payload while preserving main rebuild status priority', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-view-retrieval-overview-task')
    const novelId = `novel_retrieval_overview_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)

    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-retrieval-overview-1', chapterNo: 1 })

    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, progress, payloadJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-2 minutes'), datetime('now', '-2 minutes'))`
    ).run(
      'job_main_priority',
      novelId,
      mainBranchId,
      'extract_chapter_knowledge',
      'running',
      '抽取章节知识',
      0.32,
      JSON.stringify({
        phase: 'extract',
        steps: [{
          key: 'extract',
          label: '抽取章节知识',
          status: 'running',
          progress: 0.32,
          etaMinutes: 4,
          detail: '主知识重建进行中',
        }],
      })
    )

    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, progress, payloadJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-1 minute'), datetime('now', '-1 minute'))`
    ).run(
      'job_retrieval_live_task',
      novelId,
      mainBranchId,
      'rebuild_retrieval_index',
      'running',
      '生成检索向量',
      0.97,
      JSON.stringify({
        phase: 'raw-embedding',
        rawTextEmbeddingProgress: 0.6,
        rawTextEmbeddingCacheHitRate: 0.25,
        steps: [{
          key: 'raw-embedding',
          label: '原文 Embedding 预计算',
          status: 'running',
          progress: 0.6,
          etaMinutes: 2,
          detail: '原文向量缓存 60%',
        }],
      })
    )

    const { GET } = await loadKnowledgeViewRoute()
    const response = await GET(new Request(`http://localhost/api/knowledge-view?novelId=${novelId}`))
    const payload = await response.json() as {
      ok: boolean
      knowledgeRebuildStatus: { jobId?: string; jobType?: string; status?: string } | null
      knowledgeStatusOverview: {
        retrievalIndex: {
          status: string
          indexedScopeCount: number
          task: { jobId?: string; jobType?: string; status?: string; rawTextEmbeddingProgress?: number; steps?: Array<{ key?: string; status?: string }> } | null
        }
      } | null
    }

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.knowledgeRebuildStatus).toMatchObject({
      jobId: 'job_main_priority',
      jobType: 'extract_chapter_knowledge',
      status: 'running',
    })
    expect(payload.knowledgeStatusOverview?.retrievalIndex).toMatchObject({
      status: 'missing',
      indexedScopeCount: 0,
      task: {
        jobId: 'job_retrieval_live_task',
        jobType: 'rebuild_retrieval_index',
        status: 'running',
        rawTextEmbeddingProgress: 0.6,
        steps: [
          expect.objectContaining({
            key: 'raw-embedding',
            status: 'running',
          }),
        ],
      },
    })
  })

  it('reports retrieval jobs through knowledgeRebuildStatus with an explicit retrieval jobType', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-view-retrieval-jobtype')
    const novelId = `novel_retrieval_jobtype_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)

    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-retrieval-jobtype-1', chapterNo: 1 })
    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, progress, payloadJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'job_retrieval_jobtype',
      novelId,
      mainBranchId,
      'rebuild_retrieval_index',
      'paused',
      '已暂停',
      0.98,
      JSON.stringify({
        phase: 'index',
        steps: [{
          key: 'index',
          label: '构建 Lance 检索索引',
          status: 'paused',
          progress: 0.5,
          etaMinutes: null,
          detail: '已暂停',
        }],
      })
    )

    const { GET } = await loadKnowledgeViewRoute()
    const response = await GET(new Request(`http://localhost/api/knowledge-view?novelId=${novelId}`))
    const payload = await response.json() as {
      ok: boolean
      knowledgeRebuildStatus: { jobId?: string; jobType?: string; status?: string } | null
    }

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.knowledgeRebuildStatus).toMatchObject({
      jobId: 'job_retrieval_jobtype',
      jobType: 'rebuild_retrieval_index',
      status: 'paused',
    })
  })

  it('returns the latest failed rebuild status with errorMessage for the selected novel main branch', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-view-failed-status')
    const novelId = `novel_knowledge_view_failed_${Math.random().toString(36).slice(2, 8)}`
    const otherNovelId = `novel_knowledge_view_failed_other_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId, altBranchId } = seedNovel(database, novelId)
    const { mainBranchId: otherMainBranchId } = seedNovel(database, otherNovelId)

    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-failed-main', chapterNo: 1 })
    seedKnowledgeChapter(database, { novelId, branchId: altBranchId, chapterId: 'chapter-failed-alt', chapterNo: 1 })
    seedKnowledgeChapter(database, { novelId: otherNovelId, branchId: otherMainBranchId, chapterId: 'chapter-failed-other', chapterNo: 1 })

    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, errorMessage, currentStep, progress, payloadJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-5 minutes'), datetime('now', '-5 minutes'))`
    ).run(
      'job_failed_hidden_alt_branch',
      novelId,
      altBranchId,
      'extract_chapter_knowledge',
      'failed',
      'alt branch failure should stay hidden',
      'extract',
      0.4,
      JSON.stringify({
        steps: [{
          key: 'extract',
          label: '抽取章节知识',
          status: 'running',
          progress: 0.4,
          etaMinutes: null,
          detail: null,
        }],
      })
    )

    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, errorMessage, currentStep, progress, payloadJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-4 minutes'), datetime('now', '-4 minutes'))`
    ).run(
      'job_failed_hidden_other_novel',
      otherNovelId,
      otherMainBranchId,
      'extract_chapter_knowledge',
      'failed',
      'other novel failure should stay hidden',
      'extract',
      0.2,
      JSON.stringify({ steps: [] })
    )

    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, errorMessage, currentStep, progress, payloadJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-3 minutes'), datetime('now', '-3 minutes'))`
    ).run(
      'job_succeeded_older_main',
      novelId,
      mainBranchId,
      'extract_chapter_knowledge',
      'succeeded',
      null,
      'write',
      1,
      JSON.stringify({ steps: [] })
    )

    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, errorMessage, currentStep, progress, payloadJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-1 minutes'), datetime('now', '-1 minutes'))`
    ).run(
      'job_failed_visible_main',
      novelId,
      mainBranchId,
      'extract_chapter_knowledge',
      'failed',
      'HanLP bootstrap crashed on chapter 1',
      'hanlp-bootstrap',
      0.35,
      JSON.stringify({
        steps: [{
          key: 'hanlp-bootstrap',
          label: 'HanLP 引导扫描',
          status: 'running',
          progress: 0.35,
          etaMinutes: null,
          detail: '正在处理第 1 章',
        }],
      })
    )

    const { GET } = await loadKnowledgeViewRoute()
    const response = await GET(new Request(`http://localhost/api/knowledge-view?novelId=${novelId}`))
    const payload = await response.json() as {
      ok: boolean
      knowledgeRebuildStatus: Record<string, unknown> | null
    }

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.knowledgeRebuildStatus).toMatchObject({
      jobId: 'job_failed_visible_main',
      novelId,
      status: 'failed',
      errorMessage: 'HanLP bootstrap crashed on chapter 1',
      currentStep: 'hanlp-bootstrap',
      progress: 0.35,
    })
  })

  it('hides an older failed rebuild when a newer main-branch rebuild succeeded', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-view-hide-old-failed-after-success')
    const novelId = `novel_knowledge_view_hide_failed_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)

    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-hide-old-failed', chapterNo: 1 })
    insertHanlpCacheFixture(database, {
      idPrefix: 'hide-old-failed-main',
      novelId,
      branchId: mainBranchId,
      chapterId: 'chapter-hide-old-failed',
      chapterNo: 1,
    })

    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, errorMessage, currentStep, progress, payloadJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-4 minutes'), datetime('now', '-4 minutes'))`
    ).run(
      'job_failed_older_main',
      novelId,
      mainBranchId,
      'extract_chapter_knowledge',
      'failed',
      'older failed rebuild should remain hidden after a newer success',
      'extract',
      0.5,
      JSON.stringify({ steps: [] })
    )

    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, errorMessage, currentStep, progress, payloadJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-1 minutes'), datetime('now', '-1 minutes'))`
    ).run(
      'job_succeeded_newer_main',
      novelId,
      mainBranchId,
      'extract_chapter_knowledge',
      'succeeded',
      null,
      '完成',
      1,
      JSON.stringify({ steps: [] })
    )

    const { GET } = await loadKnowledgeViewRoute()
    const response = await GET(new Request(`http://localhost/api/knowledge-view?novelId=${novelId}`))
    const payload = await response.json() as {
      ok: boolean
      knowledgeRebuildStatus: Record<string, unknown> | null
      hanlpCacheSnapshot: Record<string, unknown> | null
    }

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.knowledgeRebuildStatus).toBeNull()
    expect(payload.hanlpCacheSnapshot).toMatchObject({
      status: 'ready',
      settingsSnapshot: {
        hanlpScriptVersionHash: 'script-hash-hide-old-failed-main',
        hanlpModelOrConfigHash: 'model-hash-hide-old-failed-main',
        outputSchemaVersion: 'v1',
        pipelineVersion: 'hanlp-bootstrap:v1',
      },
    })
  })

  it('prefers an older active rebuild over a newer terminal rebuild row for the main branch', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-view-prefer-active-over-terminal')
    const novelId = `novel_knowledge_view_prefer_active_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)

    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-prefer-active-main', chapterNo: 1 })

    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, progress, payloadJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-5 minutes'), datetime('now', '-5 minutes'))`
    ).run(
      'job_rebuild_running_should_win',
      novelId,
      mainBranchId,
      'extract_chapter_knowledge',
      'running',
      'extract',
      0.42,
      JSON.stringify({
        steps: [{
          key: 'extract',
          label: '抽取章节知识',
          status: 'running',
          progress: 0.42,
          etaMinutes: 4,
          detail: '正在处理第 1 章',
        }],
      })
    )

    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, progress, payloadJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-1 minutes'), datetime('now', '-1 minutes'))`
    ).run(
      'job_rebuild_aborted_newer_should_not_mask',
      novelId,
      mainBranchId,
      'extract_chapter_knowledge',
      'aborted',
      '已中止',
      1,
      JSON.stringify({ steps: [] })
    )

    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, errorMessage, currentStep, progress, payloadJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-30 seconds'), datetime('now', '-30 seconds'))`
    ).run(
      'job_rebuild_failed_newer_should_not_mask',
      novelId,
      mainBranchId,
      'extract_chapter_knowledge',
      'failed',
      'newer failed row should not mask an active job',
      'failed',
      0.12,
      JSON.stringify({ steps: [] })
    )

    const { GET } = await loadKnowledgeViewRoute()
    const response = await GET(new Request(`http://localhost/api/knowledge-view?novelId=${novelId}`))
    const payload = await response.json() as {
      ok: boolean
      knowledgeRebuildStatus: Record<string, unknown> | null
    }

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.knowledgeRebuildStatus).toMatchObject({
      jobId: 'job_rebuild_running_should_win',
      status: 'running',
      currentStep: 'extract',
      progress: 0.42,
    })
  })

  it('surfaces the latest retrieval rebuild status through the existing knowledge rebuild payload', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-view-retrieval-status-surface')
    const novelId = `novel_knowledge_view_retrieval_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)

    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-retrieval-main', chapterNo: 1 })

    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, progress, payloadJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-2 minutes'), datetime('now', '-2 minutes'))`
    ).run(
      'job_extract_succeeded_before_retrieval',
      novelId,
      mainBranchId,
      'extract_chapter_knowledge',
      'succeeded',
      '完成',
      1,
      JSON.stringify({
        phase: 'write',
        steps: [],
      })
    )

    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, progress, payloadJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-1 minutes'), datetime('now', '-1 minutes'))`
    ).run(
      'job_retrieval_running_visible',
      novelId,
      mainBranchId,
      'rebuild_retrieval_index',
      'running',
      '等待原文 Embedding 预计算完成',
      0.95,
      JSON.stringify({
        phase: 'raw-embedding',
        rawTextEmbeddingProgress: 0.4,
        steps: [
          { key: 'hanlp-bootstrap', label: 'HanLP 引导扫描', status: 'completed', progress: 1, etaMinutes: null, detail: null },
          { key: 'extract', label: '抽取章节知识', status: 'completed', progress: 1, etaMinutes: null, detail: null },
          { key: 'batch-sync', label: '整理批次结果', status: 'completed', progress: 1, etaMinutes: null, detail: null },
          { key: 'cleanup', label: '清理旧知识', status: 'completed', progress: 1, etaMinutes: null, detail: null },
          { key: 'write', label: '写入结构化知识', status: 'completed', progress: 1, etaMinutes: null, detail: null },
          { key: 'raw-embedding', label: '原文 Embedding 预计算', status: 'running', progress: 0.4, etaMinutes: 2, detail: '等待原文 Embedding 预计算完成' },
          { key: 'index', label: '构建 Lance 检索索引', status: 'pending', progress: 0, etaMinutes: null, detail: null },
        ],
      })
    )

    const { GET } = await loadKnowledgeViewRoute()
    const response = await GET(new Request(`http://localhost/api/knowledge-view?novelId=${novelId}`))
    const payload = await response.json() as {
      ok: boolean
      knowledgeRebuildStatus: Record<string, unknown> | null
    }

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.knowledgeRebuildStatus).toMatchObject({
      jobId: 'job_retrieval_running_visible',
      novelId,
      status: 'running',
      currentStep: '等待原文 Embedding 预计算完成',
      progress: 0.95,
      rawTextEmbeddingProgress: 0.4,
    })
  })

  it('surfaces populated HanLP cache readiness without an active rebuild', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-view-idle-hanlp-cache')
    const novelId = `novel_knowledge_view_idle_hanlp_${Math.random().toString(36).slice(2, 8)}`
    const otherNovelId = `novel_knowledge_view_idle_hanlp_other_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId, altBranchId } = seedNovel(database, novelId)
    const { mainBranchId: otherMainBranchId } = seedNovel(database, otherNovelId)

    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-idle-hanlp-cache', chapterNo: 1 })
    seedKnowledgeChapter(database, { novelId, branchId: altBranchId, chapterId: 'chapter-idle-hanlp-cache-alt', chapterNo: 2 })
    seedKnowledgeChapter(database, { novelId: otherNovelId, branchId: otherMainBranchId, chapterId: 'chapter-idle-hanlp-cache-other', chapterNo: 1 })
    insertHanlpCacheFixture(database, {
      idPrefix: 'idle-hanlp-main',
      novelId,
      branchId: mainBranchId,
      chapterId: 'chapter-idle-hanlp-cache',
      chapterNo: 1,
    })
    insertHanlpCacheFixture(database, {
      idPrefix: 'idle-hanlp-alt',
      novelId,
      branchId: altBranchId,
      chapterId: 'chapter-idle-hanlp-cache-alt',
      chapterNo: 2,
    })
    insertHanlpCacheFixture(database, {
      idPrefix: 'idle-hanlp-other',
      novelId: otherNovelId,
      branchId: otherMainBranchId,
      chapterId: 'chapter-idle-hanlp-cache-other',
      chapterNo: 1,
    })

    const { GET } = await loadKnowledgeViewRoute()
    const response = await GET(new Request(`http://localhost/api/knowledge-view?novelId=${novelId}`))
    const payload = await response.json() as {
      ok: boolean
      knowledgeRebuildStatus: Record<string, unknown> | null
      hanlpCacheSnapshot: Record<string, unknown> | null
    }

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.knowledgeRebuildStatus).toBeNull()
    expect(payload.hanlpCacheSnapshot).toMatchObject({
      status: 'ready',
      settingsSnapshot: {
        hanlpScriptVersionHash: 'script-hash-idle-hanlp-main',
        hanlpModelOrConfigHash: 'model-hash-idle-hanlp-main',
        outputSchemaVersion: 'v1',
        pipelineVersion: 'hanlp-bootstrap:v1',
      },
    })
  })

  it('returns persistent knowledge, embedding, and LanceDB coverage overview for the selected novel', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-view-status-overview')
    const novelId = `novel_knowledge_overview_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId, altBranchId } = seedNovel(database, novelId)

    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-overview-1', chapterNo: 1 })
    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-overview-2', chapterNo: 2 })
    seedKnowledgeChapter(database, { novelId, branchId: altBranchId, chapterId: 'chapter-overview-alt', chapterNo: 1 })
    database.prepare("UPDATE KnowledgeChapter SET knowledgeStatus = 'ready', isDirty = 0 WHERE id = ?").run('chapter-overview-1')

    insertTextSpanFixture(database, {
      id: 'span-overview-1',
      novelId,
      branchId: mainBranchId,
      chapterId: 'chapter-overview-1',
      chapterNo: 1,
      text: '第1章原文内容。',
    })
    insertTextSpanFixture(database, {
      id: 'span-overview-2',
      novelId,
      branchId: mainBranchId,
      chapterId: 'chapter-overview-2',
      chapterNo: 2,
      text: '第2章原文内容。',
    })
    insertTextSpanFixture(database, {
      id: 'span-overview-alt',
      novelId,
      branchId: altBranchId,
      chapterId: 'chapter-overview-alt',
      chapterNo: 1,
      text: 'Alt branch text.',
    })

    const { loadStoredAISettings } = await import('@/lib/server/ai-settings')
    const { buildRawTextRetrievalEmbeddingInput, loadRawTextRetrievalDocs } = await import('@/lib/server/retrieval-index')
    const embeddingSettings = loadStoredAISettings().embeddings
    const embeddingProvider = embeddingSettings.provider
    const embeddingModel = embeddingProvider === 'openai-compatible'
      ? embeddingSettings.openAICompatible.model
      : embeddingSettings.ollama.model
    const chapterOneDoc = loadRawTextRetrievalDocs(novelId, mainBranchId).find((row) => row.chapterNo === 1)
    expect(chapterOneDoc).toBeTruthy()
    const chapterOneHash = buildRawTextRetrievalEmbeddingInput(chapterOneDoc!).embeddingInputHash

    database.prepare(
      `INSERT INTO RawTextEmbeddingCache (
        branchId, provider, model, embeddingInputHash, vectorJson, vectorDimension
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(mainBranchId, embeddingProvider, embeddingModel, chapterOneHash, '[0.1,0.2]', 2)
    database.prepare(
      `INSERT INTO ActiveRetrievalIndex (
        branchId, scopeKey, tableName, scopeStartChapter, scopeEndChapter
      ) VALUES (?, ?, ?, ?, ?)`
    ).run(mainBranchId, 'chapter-range:1:1', 'retrieval_docs_partial_fixture', 1, 1)

    const { GET } = await loadKnowledgeViewRoute()
    const response = await GET(new Request(`http://localhost/api/knowledge-view?novelId=${novelId}`))
    const payload = await response.json() as {
      ok: boolean
      knowledgeStatusOverview: {
        knowledgeGraph?: Record<string, unknown>
        embeddingCache?: Record<string, unknown>
        retrievalIndex?: Record<string, unknown>
      } | null
    }

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.knowledgeStatusOverview).toMatchObject({
      knowledgeGraph: {
        status: 'partial',
        coveredChapterCount: 1,
        totalChapterCount: 2,
        validThroughChapterNo: 1,
      },
      embeddingCache: {
        status: 'partial',
        coveredChapterCount: 1,
        totalChapterCount: 2,
        validThroughChapterNo: 1,
        provider: embeddingProvider,
        model: embeddingModel,
      },
      retrievalIndex: {
        status: 'partial',
        indexedScopeCount: 1,
        chapterRange: {
          startChapter: 1,
          endChapter: 1,
        },
      },
    })
  })

  it('returns lightweight status-only payloads without loading retrieval docs', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-view-status-only-lightweight')
    const novelId = `novel_status_only_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)

    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-status-only-1', chapterNo: 1 })
    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-status-only-2', chapterNo: 2 })
    database.prepare("UPDATE KnowledgeChapter SET knowledgeStatus = 'ready', isDirty = 0 WHERE id = ?").run('chapter-status-only-1')
    database.prepare(
      `INSERT INTO ActiveRetrievalIndex (
        branchId, scopeKey, tableName, scopeStartChapter, scopeEndChapter
      ) VALUES (?, ?, ?, ?, ?)`
    ).run(mainBranchId, 'chapter-range:1:1', 'retrieval_docs_partial_fixture', 1, 1)

    vi.doMock('@/lib/server/retrieval-index', async () => {
      const actual = await vi.importActual<typeof import('@/lib/server/retrieval-index')>('@/lib/server/retrieval-index')
      return {
        ...actual,
        loadRawTextRetrievalDocs: vi.fn(() => {
          throw new Error('loadRawTextRetrievalDocs should not run during statusOnly GET response')
        }),
      }
    })

    const { GET } = await loadKnowledgeViewRoute()
    const response = await GET(new Request(`http://localhost/api/knowledge-view?novelId=${novelId}&statusOnly=1`))
    const payload = await response.json() as {
      ok: boolean
      localCharacters: unknown[]
      localCharacterRelations: unknown[]
      localWorldEntries: unknown[]
      localTimelineEvents: unknown[]
      localOutlines: unknown[]
      knowledgeStatusOverview: {
        knowledgeGraph: { status: string; coveredChapterCount: number; totalChapterCount: number; validThroughChapterNo: number | null }
        embeddingCache: { status: string; provider: string | null; model: string | null }
        retrievalIndex: { status: string; indexedScopeCount: number; chapterRange?: { startChapter?: number; endChapter?: number } }
      } | null
    }

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      ok: true,
      localCharacters: [],
      localCharacterRelations: [],
      localWorldEntries: [],
      localTimelineEvents: [],
      localOutlines: [],
      knowledgeStatusOverview: {
        knowledgeGraph: {
          status: 'partial',
          coveredChapterCount: 1,
          totalChapterCount: 2,
          validThroughChapterNo: 1,
        },
        retrievalIndex: {
          status: 'partial',
          indexedScopeCount: 1,
          chapterRange: {
            startChapter: 1,
            endChapter: 1,
          },
        },
      },
    })
    expect(payload.knowledgeStatusOverview?.embeddingCache.provider).toEqual(expect.any(String))
    expect(payload.knowledgeStatusOverview?.embeddingCache.model).toEqual(expect.any(String))
  })

  it('deletes only the target main-branch HanLP cache rows and preserves raw embedding cache', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-view-delete-hanlp-cache')
    const novelId = `novel_delete_hanlp_${Math.random().toString(36).slice(2, 8)}`
    const otherNovelId = `novel_delete_other_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId, altBranchId } = seedNovel(database, novelId)
    const { mainBranchId: otherMainBranchId } = seedNovel(database, otherNovelId)

    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-main', chapterNo: 1 })
    seedKnowledgeChapter(database, { novelId, branchId: altBranchId, chapterId: 'chapter-alt', chapterNo: 2 })
    seedKnowledgeChapter(database, { novelId: otherNovelId, branchId: otherMainBranchId, chapterId: 'chapter-other', chapterNo: 1 })

    insertHanlpCacheFixture(database, {
      idPrefix: 'target-main',
      novelId,
      branchId: mainBranchId,
      chapterId: 'chapter-main',
      chapterNo: 1,
    })
    insertHanlpCacheFixture(database, {
      idPrefix: 'target-alt',
      novelId,
      branchId: altBranchId,
      chapterId: 'chapter-alt',
      chapterNo: 2,
    })
    insertHanlpCacheFixture(database, {
      idPrefix: 'other-main',
      novelId: otherNovelId,
      branchId: otherMainBranchId,
      chapterId: 'chapter-other',
      chapterNo: 1,
    })
    database.prepare('INSERT INTO hanlp_bootstrap_coverage (id, novel_id, valid_through_chapter_no) VALUES (?, ?, ?)')
      .run('target-coverage', novelId, 1)
    database.prepare('INSERT INTO hanlp_bootstrap_coverage (id, novel_id, valid_through_chapter_no) VALUES (?, ?, ?)')
      .run('other-coverage', otherNovelId, 1)

    database.prepare(
      `INSERT INTO RawTextEmbeddingCache (
        branchId, provider, model, embeddingInputHash, vectorJson, vectorDimension
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(mainBranchId, 'ollama', 'embed-model', 'raw-cache-target', '[0.1,0.2]', 2)

    const { POST } = await loadKnowledgeViewRoute()
    const response = await POST(createJsonRequest('http://localhost/api/knowledge-view', {
      novelId,
      action: 'delete-hanlp-cache',
    }))
    const payload = await response.json() as {
      ok: boolean
      jobOutcome: string
      actionError: unknown
    }

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      ok: true,
      jobOutcome: 'deleted',
      actionError: null,
    })
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM hanlp_bootstrap_cache WHERE branch_id = ?', mainBranchId)?.count).toBe(0)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM hanlp_bootstrap_results WHERE branch_id = ?', mainBranchId)?.count).toBe(0)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM hanlp_bootstrap_entities WHERE branch_id = ?', mainBranchId)?.count).toBe(0)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM hanlp_bootstrap_coverage WHERE novel_id = ?', novelId)?.count).toBe(0)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM hanlp_bootstrap_cache WHERE branch_id = ?', altBranchId)?.count).toBe(1)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM hanlp_bootstrap_cache WHERE branch_id = ?', otherMainBranchId)?.count).toBe(1)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM hanlp_bootstrap_coverage WHERE novel_id = ?', otherNovelId)?.count).toBe(1)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ?', mainBranchId)?.count).toBe(1)
  })

  it('blocks HanLP cache deletion with a clear payload when a rebuild is active', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-view-delete-hanlp-cache-blocked')
    const novelId = `novel_block_hanlp_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)

    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-blocked', chapterNo: 1 })

    insertHanlpCacheFixture(database, {
      idPrefix: 'blocked-main',
      novelId,
      branchId: mainBranchId,
      chapterId: 'chapter-blocked',
      chapterNo: 1,
    })
    database.prepare('INSERT INTO hanlp_bootstrap_coverage (id, novel_id, valid_through_chapter_no) VALUES (?, ?, ?)')
      .run('blocked-coverage', novelId, 1)
    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, progress, payloadJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'job_block_hanlp_delete',
      novelId,
      mainBranchId,
      'extract_chapter_knowledge',
      'paused',
      '已暂停',
      0.4,
      JSON.stringify({
        steps: [
          {
            key: 'extract',
            label: '抽取章节知识',
            status: 'paused',
            progress: 0.4,
            etaMinutes: null,
            detail: null,
          },
        ],
      })
    )

    const { POST } = await loadKnowledgeViewRoute()
    const response = await POST(createJsonRequest('http://localhost/api/knowledge-view', {
      novelId,
      action: 'delete-hanlp-cache',
    }))
    const payload = await response.json() as {
      ok: boolean
      jobOutcome: string
      actionError: { code: string; message: string } | null
      knowledgeRebuildStatus: { status?: string; jobId?: string } | null
    }

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      ok: true,
      jobOutcome: 'blocked',
      actionError: {
        code: 'active-rebuild',
      },
      knowledgeRebuildStatus: {
        jobId: 'job_block_hanlp_delete',
        status: 'paused',
      },
    })
    expect(payload.actionError?.message).toContain('Cannot delete HanLP cache while a knowledge rebuild is paused')
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM hanlp_bootstrap_cache WHERE branch_id = ?', mainBranchId)?.count).toBe(1)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM hanlp_bootstrap_results WHERE branch_id = ?', mainBranchId)?.count).toBe(1)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM hanlp_bootstrap_entities WHERE branch_id = ?', mainBranchId)?.count).toBe(1)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM hanlp_bootstrap_coverage WHERE novel_id = ?', novelId)?.count).toBe(1)
  })

  it('deletes only the target main-branch LLM extraction cache rows', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-view-delete-extraction-cache')
    const novelId = `novel_delete_extraction_${Math.random().toString(36).slice(2, 8)}`
    const otherNovelId = `novel_delete_extraction_other_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId, altBranchId } = seedNovel(database, novelId)
    const { mainBranchId: otherMainBranchId } = seedNovel(database, otherNovelId)

    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-main', chapterNo: 1 })
    seedKnowledgeChapter(database, { novelId, branchId: altBranchId, chapterId: 'chapter-alt', chapterNo: 2 })
    seedKnowledgeChapter(database, { novelId: otherNovelId, branchId: otherMainBranchId, chapterId: 'chapter-other', chapterNo: 1 })
    insertExtractionCacheFixture(database, { idPrefix: 'target-main', novelId, branchId: mainBranchId, chapterId: 'chapter-main', chapterNo: 1, batchChapterNos: [1] })
    insertExtractionCacheFixture(database, { idPrefix: 'target-alt', novelId, branchId: altBranchId, chapterId: 'chapter-alt', chapterNo: 2, batchChapterNos: [2] })
    insertExtractionCacheFixture(database, { idPrefix: 'other-main', novelId: otherNovelId, branchId: otherMainBranchId, chapterId: 'chapter-other', chapterNo: 1, batchChapterNos: [1] })
    insertHanlpCacheFixture(database, { idPrefix: 'target-main', novelId, branchId: mainBranchId, chapterId: 'chapter-main', chapterNo: 1 })

    const { POST } = await loadKnowledgeViewRoute()
    const response = await POST(createJsonRequest('http://localhost/api/knowledge-view', {
      novelId,
      action: 'delete-extraction-cache',
    }))
    const payload = await response.json() as { ok: boolean; jobOutcome: string; actionError: unknown }

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ ok: true, jobOutcome: 'deleted', actionError: null })
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM chapter_extraction_candidates WHERE branch_id = ?', mainBranchId)?.count).toBe(0)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM chapter_extraction_candidates WHERE branch_id = ?', altBranchId)?.count).toBe(1)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM chapter_extraction_candidates WHERE branch_id = ?', otherMainBranchId)?.count).toBe(1)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM chapter_extraction_processing_batches WHERE branch_id = ?', mainBranchId)?.count).toBe(0)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM chapter_extraction_processing_batches WHERE branch_id = ?', altBranchId)?.count).toBe(1)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM chapter_extraction_processing_batches WHERE branch_id = ?', otherMainBranchId)?.count).toBe(1)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM hanlp_bootstrap_cache WHERE branch_id = ?', mainBranchId)?.count).toBe(1)
  })

  it('deletes only the target main-branch raw embedding cache rows', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-view-delete-embedding-cache')
    const novelId = `novel_delete_embedding_${Math.random().toString(36).slice(2, 8)}`
    const otherNovelId = `novel_delete_embedding_other_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId, altBranchId } = seedNovel(database, novelId)
    const { mainBranchId: otherMainBranchId } = seedNovel(database, otherNovelId)

    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-main', chapterNo: 1 })
    database.prepare(
      `INSERT INTO RawTextEmbeddingCache (
        branchId, provider, model, embeddingInputHash, vectorJson, vectorDimension
      ) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`
    ).run(
      mainBranchId, 'ollama', 'embed-model', 'raw-cache-target', '[0.1,0.2]', 2,
      altBranchId, 'ollama', 'embed-model', 'raw-cache-alt', '[0.2,0.3]', 2,
      otherMainBranchId, 'ollama', 'embed-model', 'raw-cache-other', '[0.3,0.4]', 2,
    )
    insertExtractionCacheFixture(database, { idPrefix: 'target-main', novelId, branchId: mainBranchId, chapterId: 'chapter-main', chapterNo: 1 })

    const { POST } = await loadKnowledgeViewRoute()
    const response = await POST(createJsonRequest('http://localhost/api/knowledge-view', {
      novelId,
      action: 'delete-embedding-cache',
    }))
    const payload = await response.json() as { ok: boolean; jobOutcome: string; actionError: unknown }

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ ok: true, jobOutcome: 'deleted', actionError: null })
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ?', mainBranchId)?.count).toBe(0)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ?', altBranchId)?.count).toBe(1)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ?', otherMainBranchId)?.count).toBe(1)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM chapter_extraction_candidates WHERE branch_id = ?', mainBranchId)?.count).toBe(1)
  })

  it('blocks LLM extraction and raw embedding cache deletion when a rebuild is active', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-view-delete-cache-blocked')
    const novelId = `novel_block_cache_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)

    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-blocked', chapterNo: 1 })
    insertExtractionCacheFixture(database, { idPrefix: 'blocked-main', novelId, branchId: mainBranchId, chapterId: 'chapter-blocked', chapterNo: 1 })
    database.prepare(
      `INSERT INTO RawTextEmbeddingCache (
        branchId, provider, model, embeddingInputHash, vectorJson, vectorDimension
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(mainBranchId, 'ollama', 'embed-model', 'raw-cache-blocked', '[0.1,0.2]', 2)
    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, progress, payloadJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('job_block_manual_cache_delete', novelId, mainBranchId, 'extract_chapter_knowledge', 'running', '重建中', 0.3, JSON.stringify({ steps: [] }))

    const { POST } = await loadKnowledgeViewRoute()
    for (const action of ['delete-extraction-cache', 'delete-embedding-cache']) {
      const response = await POST(createJsonRequest('http://localhost/api/knowledge-view', { novelId, action }))
      const payload = await response.json() as {
        ok: boolean
        jobOutcome: string
        actionError: { code: string; message: string } | null
      }

      expect(response.status).toBe(200)
      expect(payload.jobOutcome).toBe('blocked')
      expect(payload.actionError?.code).toBe('active-rebuild')
      expect(payload.actionError?.message).toContain('Cannot delete')
    }
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM chapter_extraction_candidates WHERE branch_id = ?', mainBranchId)?.count).toBe(1)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ?', mainBranchId)?.count).toBe(1)
  })

  it('blocks raw embedding cache deletion while a retrieval rebuild is active', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-view-delete-embedding-cache-retrieval-blocked')
    const novelId = `novel_block_retrieval_cache_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)

    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-retrieval-blocked', chapterNo: 1 })
    database.prepare(
      `INSERT INTO RawTextEmbeddingCache (
        branchId, provider, model, embeddingInputHash, vectorJson, vectorDimension
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(mainBranchId, 'ollama', 'embed-model', 'raw-cache-retrieval-blocked', '[0.1,0.2]', 2)
    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, progress, payloadJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'job_block_retrieval_cache_delete',
      novelId,
      mainBranchId,
      'rebuild_retrieval_index',
      'running',
      '构建 Lance 检索索引',
      0.98,
      JSON.stringify({
        phase: 'index',
        steps: [],
      })
    )

    const { POST } = await loadKnowledgeViewRoute()
    const response = await POST(createJsonRequest('http://localhost/api/knowledge-view', {
      novelId,
      action: 'delete-embedding-cache',
    }))
    const payload = await response.json() as {
      ok: boolean
      jobOutcome: string
      actionError: { code: string; message: string } | null
    }

    expect(response.status).toBe(200)
    expect(payload.jobOutcome).toBe('blocked')
    expect(payload.actionError?.code).toBe('active-rebuild')
    expect(payload.actionError?.message).toContain('Cannot delete raw embedding cache')
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM RawTextEmbeddingCache WHERE branchId = ?', mainBranchId)?.count).toBe(1)
  })

  it('queues rebuild jobs with a bounded chapter range payload', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-view-range-rebuild')
    const novelId = `novel_range_rebuild_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)

    for (let chapterNo = 1; chapterNo <= 4; chapterNo += 1) {
      seedKnowledgeChapter(database, {
        novelId,
        branchId: mainBranchId,
        chapterId: `chapter-range-${chapterNo}`,
        chapterNo,
      })
    }

    const { POST } = await loadKnowledgeViewRoute()
    const response = await POST(createJsonRequest('http://localhost/api/knowledge-view', {
      novelId,
      action: 'rebuild',
      chapterRange: { startChapter: 2, endChapter: 3 },
    }))
    const payload = await response.json() as {
      ok: boolean
      jobOutcome: string
      knowledgeRebuildStatus: { chapterRange?: { startChapter?: number; endChapter?: number } } | null
    }

    const jobPayload = JSON.parse(queryOne<{ payloadJson: string | null }>(
      'SELECT payloadJson FROM KnowledgeJob WHERE novelId = ? AND jobType = ? ORDER BY createdAt DESC LIMIT 1',
      novelId,
      'extract_chapter_knowledge',
    )?.payloadJson ?? '{}') as { chapterRange?: { startChapter?: number; endChapter?: number }; rebuildStartChapter?: number }

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ ok: true, jobOutcome: 'queued' })
    expect(payload.knowledgeRebuildStatus?.chapterRange).toEqual({ startChapter: 2, endChapter: 3 })
    expect(jobPayload).toMatchObject({
      chapterRange: { startChapter: 2, endChapter: 3 },
      rebuildStartChapter: 2,
    })
  })

  it('queues main rebuild jobs with a lightweight POST response that avoids full projections and retrieval doc loading', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-view-range-rebuild-fast-response')
    const novelId = `novel_range_rebuild_fast_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)

    for (let chapterNo = 1; chapterNo <= 3; chapterNo += 1) {
      seedKnowledgeChapter(database, {
        novelId,
        branchId: mainBranchId,
        chapterId: `chapter-range-fast-${chapterNo}`,
        chapterNo,
      })
    }
    insertFormalKnowledgeFixtures(database, {
      novelId,
      branchId: mainBranchId,
      chapterId: 'chapter-range-fast-1',
      chapterNo: 1,
      idPrefix: 'rebuild-fast',
    })

    const loadRawTextRetrievalDocs = vi.fn(() => {
      throw new Error('loadRawTextRetrievalDocs should not run during main rebuild POST response')
    })
    vi.doMock('@/lib/server/retrieval-index', async () => {
      const actual = await vi.importActual<typeof import('@/lib/server/retrieval-index')>('@/lib/server/retrieval-index')
      return {
        ...actual,
        loadRawTextRetrievalDocs,
      }
    })

    const { POST } = await loadKnowledgeViewRoute()
    const response = await POST(createJsonRequest('http://localhost/api/knowledge-view', {
      novelId,
      action: 'rebuild',
      chapterRange: { startChapter: 2, endChapter: 3 },
    }))
    const payload = await response.json() as {
      ok: boolean
      jobOutcome: string
      localCharacters: unknown[]
      localCharacterRelations: unknown[]
      localWorldEntries: unknown[]
      localTimelineEvents: unknown[]
      localOutlines: unknown[]
      knowledgeRebuildStatus: { jobId?: string; status?: string; chapterRange?: { startChapter?: number; endChapter?: number } } | null
      knowledgeStatusOverview: { knowledgeGraph?: { totalChapterCount?: number } } | null
    }

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(['queued', 'running']).toContain(payload.jobOutcome)
    expect(payload.knowledgeRebuildStatus).toMatchObject({
      status: expect.stringMatching(/^(queued|running)$/),
      chapterRange: { startChapter: 2, endChapter: 3 },
    })
    expect(payload.knowledgeRebuildStatus?.jobId).toEqual(expect.any(String))
    expect(payload.localCharacters).toEqual([])
    expect(payload.localCharacterRelations).toEqual([])
    expect(payload.localWorldEntries).toEqual([])
    expect(payload.localTimelineEvents).toEqual([])
    expect(payload.localOutlines).toEqual([])
    expect(payload.knowledgeStatusOverview?.knowledgeGraph?.totalChapterCount).toBe(3)
    expect(loadRawTextRetrievalDocs).not.toHaveBeenCalled()
  })

  it('pauses active rebuild jobs with a lightweight POST response that avoids full projections and retrieval doc loading', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-view-pause-fast-response')
    const novelId = `novel_pause_fast_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)

    seedKnowledgeChapter(database, {
      novelId,
      branchId: mainBranchId,
      chapterId: 'chapter-pause-fast-1',
      chapterNo: 1,
    })
    insertFormalKnowledgeFixtures(database, {
      novelId,
      branchId: mainBranchId,
      chapterId: 'chapter-pause-fast-1',
      chapterNo: 1,
      idPrefix: 'pause-fast',
    })
    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, progress, payloadJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'job_pause_fast',
      novelId,
      mainBranchId,
      'extract_chapter_knowledge',
      'running',
      '抽取章节知识',
      0.42,
      JSON.stringify({ phase: 'extract', steps: [] }),
    )

    const loadRawTextRetrievalDocs = vi.fn(() => {
      throw new Error('loadRawTextRetrievalDocs should not run during pause POST response')
    })
    vi.doMock('@/lib/server/retrieval-index', async () => {
      const actual = await vi.importActual<typeof import('@/lib/server/retrieval-index')>('@/lib/server/retrieval-index')
      return {
        ...actual,
        loadRawTextRetrievalDocs,
      }
    })

    const { POST } = await loadKnowledgeViewRoute()
    const response = await POST(createJsonRequest('http://localhost/api/knowledge-view', {
      novelId,
      action: 'pause',
    }))
    const payload = await response.json() as {
      ok: boolean
      jobOutcome: string
      localCharacters: unknown[]
      localCharacterRelations: unknown[]
      localWorldEntries: unknown[]
      localTimelineEvents: unknown[]
      localOutlines: unknown[]
      knowledgeRebuildStatus: { status?: string } | null
    }

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.jobOutcome).toBe('paused')
    expect(payload.knowledgeRebuildStatus?.status).toBe('paused')
    expect(payload.localCharacters).toEqual([])
    expect(payload.localCharacterRelations).toEqual([])
    expect(payload.localWorldEntries).toEqual([])
    expect(payload.localTimelineEvents).toEqual([])
    expect(payload.localOutlines).toEqual([])
    expect(loadRawTextRetrievalDocs).not.toHaveBeenCalled()
  })

  it('aborts active rebuild jobs with a lightweight POST response that avoids full projections and retrieval doc loading', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-view-abort-fast-response')
    const novelId = `novel_abort_fast_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)

    seedKnowledgeChapter(database, {
      novelId,
      branchId: mainBranchId,
      chapterId: 'chapter-abort-fast-1',
      chapterNo: 1,
    })
    insertFormalKnowledgeFixtures(database, {
      novelId,
      branchId: mainBranchId,
      chapterId: 'chapter-abort-fast-1',
      chapterNo: 1,
      idPrefix: 'abort-fast',
    })
    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, progress, payloadJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'job_abort_fast',
      novelId,
      mainBranchId,
      'extract_chapter_knowledge',
      'running',
      '抽取章节知识',
      0.42,
      JSON.stringify({ phase: 'extract', steps: [] }),
    )

    const loadRawTextRetrievalDocs = vi.fn(() => {
      throw new Error('loadRawTextRetrievalDocs should not run during abort POST response')
    })
    vi.doMock('@/lib/server/retrieval-index', async () => {
      const actual = await vi.importActual<typeof import('@/lib/server/retrieval-index')>('@/lib/server/retrieval-index')
      return {
        ...actual,
        loadRawTextRetrievalDocs,
      }
    })

    const { POST } = await loadKnowledgeViewRoute()
    const response = await POST(createJsonRequest('http://localhost/api/knowledge-view', {
      novelId,
      action: 'abort',
    }))
    const payload = await response.json() as {
      ok: boolean
      jobOutcome: string
      localCharacters: unknown[]
      localCharacterRelations: unknown[]
      localWorldEntries: unknown[]
      localTimelineEvents: unknown[]
      localOutlines: unknown[]
      knowledgeRebuildStatus: unknown
      knowledgeStatusOverview: { knowledgeGraph?: { totalChapterCount?: number } } | null
    }

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.jobOutcome).toBe('aborted')
    expect(payload.knowledgeRebuildStatus).toBeNull()
    expect(payload.localCharacters).toEqual([])
    expect(payload.localCharacterRelations).toEqual([])
    expect(payload.localWorldEntries).toEqual([])
    expect(payload.localTimelineEvents).toEqual([])
    expect(payload.localOutlines).toEqual([])
    expect(payload.knowledgeStatusOverview?.knowledgeGraph?.totalChapterCount).toBe(1)
    expect(loadRawTextRetrievalDocs).not.toHaveBeenCalled()
  })

  it('queues dedicated retrieval rebuild jobs with retrieval status payloads', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-view-retrieval-start')
    const novelId = `novel_retrieval_start_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)

    for (let chapterNo = 1; chapterNo <= 3; chapterNo += 1) {
      seedKnowledgeChapter(database, {
        novelId,
        branchId: mainBranchId,
        chapterId: `chapter-retrieval-start-${chapterNo}`,
        chapterNo,
      })
    }

    const { POST } = await loadKnowledgeViewRoute()
    const response = await POST(createJsonRequest('http://localhost/api/knowledge-view', {
      novelId,
      action: 'rebuild-retrieval-index',
      chapterRange: { startChapter: 2, endChapter: 3 },
    }))
    const payload = await response.json() as {
      ok: boolean
      jobOutcome: string
      actionError: unknown
      knowledgeRebuildStatus: { jobId?: string; novelId?: string; jobType?: string; status?: string; chapterRange?: { startChapter?: number; endChapter?: number } } | null
      knowledgeStatusOverview: { retrievalIndex: { task: { jobId?: string; jobType?: string } | null } } | null
    }

    const jobPayload = JSON.parse(queryOne<{ payloadJson: string | null }>(
      'SELECT payloadJson FROM KnowledgeJob WHERE novelId = ? AND jobType = ? ORDER BY createdAt DESC LIMIT 1',
      novelId,
      'rebuild_retrieval_index',
    )?.payloadJson ?? '{}') as { chapterRange?: { startChapter?: number; endChapter?: number }; rebuildStartChapter?: number }

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      ok: true,
      jobOutcome: 'queued',
      actionError: null,
      knowledgeRebuildStatus: {
        novelId,
        jobType: 'rebuild_retrieval_index',
        status: 'queued',
        chapterRange: { startChapter: 2, endChapter: 3 },
      },
      knowledgeStatusOverview: {
        retrievalIndex: {
          task: {
            jobType: 'rebuild_retrieval_index',
          },
        },
      },
    })
    expect(payload.knowledgeRebuildStatus?.jobId).toEqual(expect.any(String))
    expect(payload.knowledgeStatusOverview?.retrievalIndex.task?.jobId).toBe(payload.knowledgeRebuildStatus?.jobId)
    expect(jobPayload).toMatchObject({
      chapterRange: { startChapter: 2, endChapter: 3 },
      rebuildStartChapter: 2,
    })
  })

  it('blocks dedicated retrieval rebuild start while a main knowledge rebuild is active', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-view-retrieval-start-blocked')
    const novelId = `novel_retrieval_start_blocked_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)

    seedKnowledgeChapter(database, { novelId, branchId: mainBranchId, chapterId: 'chapter-retrieval-blocked-1', chapterNo: 1 })
    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, progress, payloadJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'job_active_main_rebuild',
      novelId,
      mainBranchId,
      'extract_chapter_knowledge',
      'running',
      '抽取章节知识',
      0.41,
      JSON.stringify({
        phase: 'extract',
        steps: [{
          key: 'extract',
          label: '抽取章节知识',
          status: 'running',
          progress: 0.41,
          etaMinutes: 3,
          detail: null,
        }],
      })
    )

    const { POST } = await loadKnowledgeViewRoute()
    const response = await POST(createJsonRequest('http://localhost/api/knowledge-view', {
      novelId,
      action: 'rebuild-retrieval-index',
    }))
    const payload = await response.json() as {
      ok: boolean
      jobOutcome: string
      actionError: { code: string; message: string } | null
      knowledgeRebuildStatus: { jobId?: string; jobType?: string; status?: string } | null
    }

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      ok: true,
      jobOutcome: 'blocked',
      actionError: {
        code: 'active-rebuild',
      },
      knowledgeRebuildStatus: {
        jobId: 'job_active_main_rebuild',
        jobType: 'extract_chapter_knowledge',
        status: 'running',
      },
    })
    expect(payload.actionError?.message).toContain('Cannot start retrieval index rebuild while a main knowledge rebuild is running')
    expect(queryOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM KnowledgeJob WHERE novelId = ? AND branchId = ? AND jobType = ?',
      novelId,
      mainBranchId,
      'rebuild_retrieval_index',
    )?.count).toBe(0)
  })

  it('queues a fresh imported novel rebuild without blocking the POST response', async () => {
    const { database, queryOne } = await createTestDatabase('chatbook-knowledge-view-fresh-import-rebuild')
    const novelId = `novel_fresh_import_${Math.random().toString(36).slice(2, 8)}`
    const { mainBranchId } = seedNovel(database, novelId)
    for (let chapterNo = 1; chapterNo <= 3; chapterNo += 1) {
      seedKnowledgeChapter(database, {
        novelId,
        branchId: mainBranchId,
        chapterId: `chapter-import-${chapterNo}`,
        chapterNo,
      })
    }

    expect(queryOne<{ id: string }>('SELECT id FROM StoryBranch WHERE id = ?', `${novelId}:main`)).toMatchObject({
      id: `${novelId}:main`,
    })
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM KnowledgeChapter WHERE novelId = ?', novelId)).toMatchObject({
      count: 3,
    })

    const { POST } = await loadKnowledgeViewRoute()
    const response = await POST(createJsonRequest('http://localhost/api/knowledge-view', {
      novelId,
      action: 'rebuild',
    }))
    const payload = await response.json() as {
      ok: boolean
      jobOutcome: string
      actionError: unknown
      knowledgeRebuildStatus: { jobId?: string; novelId?: string; status?: string } | null
    }

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      ok: true,
      jobOutcome: 'queued',
      actionError: null,
      knowledgeRebuildStatus: {
        novelId,
        status: 'queued',
      },
    })
    expect(payload.knowledgeRebuildStatus?.jobId).toEqual(expect.any(String))
  })

  it('rejects invalid POST actions with stable 400 JSON and no job rows', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-view-invalid-action')
    const novelId = 'novel_invalid_action'
    seedNovel(database, novelId)

    const { POST } = await loadKnowledgeViewRoute()
    const jobCountBefore = (database.prepare('SELECT COUNT(*) AS count FROM KnowledgeJob').get() as { count: number }).count

    const response = await POST(createJsonRequest('http://localhost/api/knowledge-view', {
      novelId,
      action: 'totally-invalid-action',
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'action is invalid' })

    const jobCountAfter = (database.prepare('SELECT COUNT(*) AS count FROM KnowledgeJob').get() as { count: number }).count
    expect(jobCountAfter).toBe(jobCountBefore)
  })

  it('rejects missing novel ids with stable 400 JSON and no job rows', async () => {
    const { database } = await createTestDatabase('chatbook-knowledge-view-missing-novel-id')
    const { POST } = await loadKnowledgeViewRoute()
    const jobCountBefore = (database.prepare('SELECT COUNT(*) AS count FROM KnowledgeJob').get() as { count: number }).count

    const response = await POST(createJsonRequest('http://localhost/api/knowledge-view', {
      action: 'rebuild-retrieval-index',
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'novelId is required' })

    const jobCountAfter = (database.prepare('SELECT COUNT(*) AS count FROM KnowledgeJob').get() as { count: number }).count
    expect(jobCountAfter).toBe(jobCountBefore)
  })
})
