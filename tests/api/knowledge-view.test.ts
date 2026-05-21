import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }
const originalDatabaseUrl = process.env.DATABASE_URL
const WORKSPACE_IMPORT_SMOKE_PATH = path.join(process.cwd(), 'scripts/fixtures/workspace-import-smoke.txt')

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
}) {
  database.prepare(
    `INSERT INTO chapter_extraction_candidates (
      id, novel_id, branch_id, chapter_id, chapter_no, chapter_revision,
      chapter_source_hash, extraction_json, status, provider, model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${params.idPrefix}-candidate`,
    params.novelId,
    params.branchId,
    params.chapterId,
    params.chapterNo,
    1,
    `candidate-source-hash-${params.idPrefix}`,
    JSON.stringify({ chapterNo: params.chapterNo, summary: `summary-${params.idPrefix}` }),
    'extracted',
    'openai-compatible',
    'knowledge-model',
  )
}

afterEach(() => {
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

describe('/api/knowledge-view', () => {
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
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM hanlp_bootstrap_cache WHERE branch_id = ?', altBranchId)?.count).toBe(1)
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM hanlp_bootstrap_cache WHERE branch_id = ?', otherMainBranchId)?.count).toBe(1)
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
    insertExtractionCacheFixture(database, { idPrefix: 'target-main', novelId, branchId: mainBranchId, chapterId: 'chapter-main', chapterNo: 1 })
    insertExtractionCacheFixture(database, { idPrefix: 'target-alt', novelId, branchId: altBranchId, chapterId: 'chapter-alt', chapterNo: 2 })
    insertExtractionCacheFixture(database, { idPrefix: 'other-main', novelId: otherNovelId, branchId: otherMainBranchId, chapterId: 'chapter-other', chapterNo: 1 })
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

  it('queues a fresh imported novel rebuild without blocking the POST response', async () => {
    const { queryOne } = await createTestDatabase('chatbook-knowledge-view-fresh-import-rebuild')
    const { syncWorkspacePayloadToKnowledgeStore } = await import('@/lib/server/knowledge-rebuild')
    const { importNovelIntoWorkspace } = await import('@/lib/server/import-txt')
    const { createEmptyWorkspaceState } = await import('@/lib/workspace-state')
    const fixtureText = fs.readFileSync(WORKSPACE_IMPORT_SMOKE_PATH, 'utf8')
    const importedState = importNovelIntoWorkspace(createEmptyWorkspaceState(), {
      title: 'workspace-import-smoke.txt',
      text: fixtureText,
      summary: 'workspace import smoke',
    })

    await syncWorkspacePayloadToKnowledgeStore(importedState)

    const novelId = importedState.currentNovelId
    expect(novelId).toBeTruthy()
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
  }, 15000)
})
