import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'

const createdDirectories: string[] = []

function makeTempDatabasePath(prefix: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  createdDirectories.push(directory)
  return path.join(directory, 'hanlp-schema.db')
}

function listTableNames(database: DatabaseSync) {
  return database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC")
    .all() as Array<{ name: string }>
}

function listIndexNames(database: DatabaseSync) {
  return database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name ASC")
    .all() as Array<{ name: string }>
}

function listTableColumns(database: DatabaseSync, tableName: string) {
  return database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string
    type: string
    notnull: number
    dflt_value: string | null
    pk: number
  }>
}

function getCreateSql(database: DatabaseSync, type: 'table' | 'index', name: string) {
  const row = database.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?').get(type, name) as { sql: string | null } | undefined
  return row?.sql ?? ''
}

afterEach(() => {
  while (createdDirectories.length) {
    const directory = createdDirectories.pop()
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe('hanlp schema bootstrap', () => {
  it('creates the HanLP foundation tables, required columns, and indexes on a fresh database', () => {
    const databasePath = makeTempDatabasePath('chatbook-hanlp-schema')
    const database = initializeDatabase(new DatabaseSync(databasePath))

    const tables = new Set(listTableNames(database).map((entry) => entry.name))
    const indexes = new Set(listIndexNames(database).map((entry) => entry.name))
    const candidateColumns = new Set(listTableColumns(database, 'character_candidates').map((column) => column.name))
    const candidateChapterColumns = new Set(listTableColumns(database, 'character_candidate_chapters').map((column) => column.name))
    const cacheColumns = new Set(listTableColumns(database, 'hanlp_bootstrap_cache').map((column) => column.name))
    const entityColumns = new Set(listTableColumns(database, 'hanlp_bootstrap_entities').map((column) => column.name))
    const candidateTableSql = getCreateSql(database, 'table', 'character_candidates')
    const candidateChapterTableSql = getCreateSql(database, 'table', 'character_candidate_chapters')

    expect([...tables]).toEqual(expect.arrayContaining([
      'hanlp_bootstrap_cache',
      'hanlp_bootstrap_results',
      'hanlp_bootstrap_entities',
      'character_candidates',
      'character_candidate_chapters',
      'EntityAliasMapping',
      'EntityAliasConflictLog',
    ]))

    expect([...indexes]).toEqual(expect.arrayContaining([
      'idx_hanlp_bootstrap_cache_lookup',
      'idx_hanlp_bootstrap_results_lookup',
      'idx_hanlp_bootstrap_entities_branch_type',
      'idx_character_candidates_promotion_lookup',
      'idx_character_candidate_chapters_candidate_count',
      'idx_entity_alias_mapping_branch_alias',
      'idx_entity_alias_conflict_branch_alias',
      'uq_character_candidates_surface_text',
      'uq_character_candidate_chapters_chapter_no',
    ]))

    expect([...candidateColumns]).toEqual(expect.arrayContaining([
      'id',
      'novel_id',
      'branch_id',
      'surface_text',
      'first_seen_chapter',
      'last_seen_chapter',
      'chapter_count',
      'mention_count',
      'observations_json',
      'status',
      'promoted_entity_id',
      'merged_entity_id',
      'created_at',
      'updated_at',
    ]))

    expect(candidateTableSql).toContain('UNIQUE (novel_id, branch_id, surface_text)')
    expect([...candidateChapterColumns]).toEqual(expect.arrayContaining([
      'id',
      'novel_id',
      'branch_id',
      'candidate_id',
      'chapter_no',
      'mention_count',
      'best_observation',
      'best_evidence',
      'created_at',
    ]))
    expect(candidateChapterTableSql).toContain('UNIQUE (novel_id, branch_id, candidate_id, chapter_no)')
    expect([...cacheColumns]).toEqual(expect.arrayContaining([
      'chapter_text_hash',
      'hanlp_script_version_hash',
      'hanlp_model_or_config_hash',
      'output_schema_version',
      'chapter_id',
      'chapter_no',
    ]))
    expect([...entityColumns]).toEqual(expect.arrayContaining([
      'novel_id',
      'branch_id',
      'chapter_id',
      'chapter_no',
      'entity_text',
      'entity_type',
      'total_count',
      'chapter_count',
      'coverage_ratio',
      'score',
      'source_cache_id',
      'source_result_id',
      'created_at',
      'updated_at',
    ]))

    ;(database as DatabaseSync & { close?: () => void }).close?.()
  })

  it('counts duplicate candidate chapter sightings once via chapter-no unique candidate rows', () => {
    const databasePath = makeTempDatabasePath('chatbook-hanlp-candidates')
    const database = initializeDatabase(new DatabaseSync(databasePath))

    database.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run('novel-1', 'Fixture', 'txt')
    database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run('novel-1:main', 'novel-1', 'main')
    database.prepare('INSERT INTO KnowledgeChapter (id, novelId, branchId, chapterNo, title, rawText, sourceHash) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'chapter-1',
      'novel-1',
      'novel-1:main',
      1,
      'Chapter 1',
      'Body',
      'hash-1'
    )

    database.prepare(`
      INSERT INTO character_candidates (
        id, novel_id, branch_id, surface_text, first_seen_chapter, last_seen_chapter,
        chapter_count, mention_count, observations_json, status, promoted_entity_id,
        merged_entity_id, display_name, normalized_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('candidate-1', 'novel-1', 'novel-1:main', 'Hero', 1, 1, 1, 1, null, 'collecting', null, null, 'Hero', 'hero')

    database.prepare(`
      INSERT INTO character_candidate_chapters (
        id, novel_id, branch_id, candidate_id, chapter_id, chapter_no, mention_count, best_observation, best_evidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(novel_id, branch_id, candidate_id, chapter_no) DO UPDATE SET
        mention_count = MAX(character_candidate_chapters.mention_count, excluded.mention_count),
        best_observation = COALESCE(excluded.best_observation, character_candidate_chapters.best_observation),
        best_evidence = COALESCE(excluded.best_evidence, character_candidate_chapters.best_evidence)
    `).run('candidate-chapter-1', 'novel-1', 'novel-1:main', 'candidate-1', 'chapter-1', 1, 1, 'first note', 'line 1')

    database.prepare(`
      INSERT INTO character_candidate_chapters (
        id, novel_id, branch_id, candidate_id, chapter_id, chapter_no, mention_count, best_observation, best_evidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(novel_id, branch_id, candidate_id, chapter_no) DO UPDATE SET
        mention_count = MAX(character_candidate_chapters.mention_count, excluded.mention_count),
        best_observation = COALESCE(excluded.best_observation, character_candidate_chapters.best_observation),
        best_evidence = COALESCE(excluded.best_evidence, character_candidate_chapters.best_evidence)
    `).run('candidate-chapter-2', 'novel-1', 'novel-1:main', 'candidate-1', 'chapter-1', 1, 3, 'better note', 'line 2')

    const uniqueChapterCount = database.prepare(
      'SELECT COUNT(*) AS count FROM character_candidate_chapters WHERE candidate_id = ?'
    ).get('candidate-1') as { count: number }
    const storedMentionCount = database.prepare(
      'SELECT mention_count AS mentionCount, best_observation AS bestObservation FROM character_candidate_chapters WHERE candidate_id = ? AND chapter_no = ?'
    ).get('candidate-1', 1) as { mentionCount: number; bestObservation: string | null }

    expect(uniqueChapterCount.count).toBe(1)
    expect(storedMentionCount.mentionCount).toBe(3)
    expect(storedMentionCount.bestObservation).toBe('better note')

    ;(database as DatabaseSync & { close?: () => void }).close?.()
  })

  it('keeps first alias mapping for the same branch alias', () => {
    const databasePath = makeTempDatabasePath('chatbook-hanlp-alias')
    const database = initializeDatabase(new DatabaseSync(databasePath))

    database.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run('novel-2', 'Fixture', 'txt')
    database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run('novel-2:main', 'novel-2', 'main')

    database.prepare(`
      INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, importanceTier
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run('entity-1', 'novel-2', 'novel-2:main', 'character', 'Hero', 'protagonist')

    database.prepare(`
      INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, importanceTier
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run('entity-2', 'novel-2', 'novel-2:main', 'character', 'Pretender', 'candidate')

    database.prepare(`
      INSERT INTO EntityAliasMapping (
        id, novelId, branchId, alias, entityId, sourceChapter
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run('mapping-1', 'novel-2', 'novel-2:main', 'A-Li', 'entity-1', 1)

    expect(() => database.prepare(`
      INSERT INTO EntityAliasMapping (
        id, novelId, branchId, alias, entityId, sourceChapter
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run('mapping-2', 'novel-2', 'novel-2:main', 'A-Li', 'entity-2', 2)).toThrow(/UNIQUE constraint failed: EntityAliasMapping\.branchId, EntityAliasMapping\.alias/)

    const stored = database.prepare(
      'SELECT entityId FROM EntityAliasMapping WHERE branchId = ? AND alias = ?'
    ).get('novel-2:main', 'A-Li') as { entityId: string }

    expect(stored.entityId).toBe('entity-1')

    ;(database as DatabaseSync & { close?: () => void }).close?.()
  })

  it('keeps non-character entities un-tiered', () => {
    const databasePath = makeTempDatabasePath('chatbook-hanlp-tier-guard')
    const database = initializeDatabase(new DatabaseSync(databasePath))

    database.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run('novel-3', 'Fixture', 'txt')
    database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run('novel-3:main', 'novel-3', 'main')

    database.prepare(`
      INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, importanceTier
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run('entity-location', 'novel-3', 'novel-3:main', 'location', 'Capital', null)

    expect(() => database.prepare(`
      INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, importanceTier
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run('entity-invalid', 'novel-3', 'novel-3:main', 'location', 'Forbidden Tier', 'important')).toThrow(/importanceTier requires a character entity and allowed tier value/)

    const stored = database.prepare(
      'SELECT importanceTier FROM KnowledgeEntity WHERE id = ?'
    ).get('entity-location') as { importanceTier: string | null }

    expect(stored.importanceTier).toBeNull()

    ;(database as DatabaseSync & { close?: () => void }).close?.()
  })
})
