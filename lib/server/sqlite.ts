import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { INF_CHAPTER } from '@/lib/server/chapter-interval'
import { SCHEMA_SQL } from '@/lib/server/schema'

type SqlParam = string | number | bigint | Uint8Array | null
type TableColumnInfo = { name: string; notnull: number }

type CanonicalTableRebuild = {
  tableName: 'EntityLink' | 'EntityState' | 'KnowledgeFact' | 'KnowledgeRelation' | 'KnowledgeWorld'
  tempTableName: string
  createSql: string
  insertSql: string
}

const globalForSqlite = globalThis as {
  sqlite?: DatabaseSync
}

function resolveDatabasePath(databaseUrl: string) {
  if (databaseUrl === ':memory:') return databaseUrl

  if (databaseUrl === 'file:./dev.db' || databaseUrl === './dev.db' || databaseUrl === 'dev.db') {
    return path.join(process.cwd(), 'dev.db')
  }

  if (databaseUrl.startsWith('file:')) {
    const rawPath = databaseUrl.slice('file:'.length)
    if (!rawPath || rawPath === ':memory:') {
      return ':memory:'
    }

    if (path.isAbsolute(rawPath)) {
      return rawPath
    }

    throw new Error(`Unsupported relative SQLite DATABASE_URL: ${databaseUrl}`)
  }

  if (path.isAbsolute(databaseUrl)) {
    return databaseUrl
  }

  throw new Error(`Unsupported SQLite DATABASE_URL: ${databaseUrl}`)
}

function createDatabase() {
  const filename = resolveDatabasePath(process.env.DATABASE_URL ?? 'file:./dev.db')
  const database = new DatabaseSync(filename)
  return initializeDatabase(database)
}

export function initializeDatabase(database: DatabaseSync) {
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA busy_timeout = 5000')
  database.exec(SCHEMA_SQL)
  runBootMigrations(database)
  return database
}

function tableExists(database: DatabaseSync, tableName: string) {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(tableName)
  )
}

function getTableColumns(database: DatabaseSync, tableName: string) {
  if (!tableExists(database, tableName)) {
    return [] as TableColumnInfo[]
  }

  return database.prepare(`PRAGMA table_info(${tableName})`).all() as TableColumnInfo[]
}

function columnExists(database: DatabaseSync, tableName: string, columnName: string) {
  return getTableColumns(database, tableName).some((column) => column.name === columnName)
}

function needsCanonicalIntervalRebuild(database: DatabaseSync, tableName: CanonicalTableRebuild['tableName']) {
  const columns = getTableColumns(database, tableName)
  if (!columns.length) return false

  const validToColumn = columns.find((column) => column.name === 'validToChapter')
  const validUntilColumn = columns.find((column) => column.name === 'validUntilChapter')

  return Boolean(validToColumn) || !validUntilColumn || validUntilColumn.notnull !== 1
}

const CANONICAL_INTERVAL_TABLE_REBUILDS: CanonicalTableRebuild[] = [
  {
    tableName: 'EntityLink',
    tempTableName: '__EntityLink_canonical',
    createSql: `
      CREATE TABLE __EntityLink_canonical (
        id TEXT PRIMARY KEY,
        novelId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        sourceEntityId TEXT NOT NULL,
        targetEntityId TEXT NOT NULL,
        linkType TEXT NOT NULL,
        label TEXT,
        description TEXT,
        polarity TEXT,
        strength INTEGER NOT NULL DEFAULT 3,
        weight REAL NOT NULL DEFAULT 1,
        sourceChapter INTEGER NOT NULL,
        validFromChapter INTEGER NOT NULL,
        validUntilChapter INTEGER NOT NULL,
        evidenceSpanId TEXT,
        evidenceQuote TEXT,
        confidence REAL NOT NULL DEFAULT 0.7,
        status TEXT NOT NULL DEFAULT 'ai_generated',
        includeByDefault INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
        FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
        FOREIGN KEY (sourceEntityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
        FOREIGN KEY (targetEntityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
        FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL
      )
    `,
    insertSql: `
      INSERT INTO __EntityLink_canonical (
        id, novelId, branchId, sourceEntityId, targetEntityId, linkType, label, description,
        polarity, strength, weight, sourceChapter, validFromChapter, validUntilChapter,
        evidenceSpanId, evidenceQuote, confidence, status, includeByDefault, createdAt, updatedAt
      )
      SELECT
        id, novelId, branchId, sourceEntityId, targetEntityId, linkType, label, description,
        polarity, strength, weight, sourceChapter, validFromChapter,
        CASE
          WHEN validUntilChapter IS NOT NULL THEN validUntilChapter
          WHEN validToChapter IS NOT NULL THEN validToChapter + 1
          ELSE ${INF_CHAPTER}
        END,
        evidenceSpanId, evidenceQuote, confidence, status, includeByDefault, createdAt, updatedAt
      FROM EntityLink
    `,
  },
  {
    tableName: 'EntityState',
    tempTableName: '__EntityState_canonical',
    createSql: `
      CREATE TABLE __EntityState_canonical (
        id TEXT PRIMARY KEY,
        novelId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        entityId TEXT NOT NULL,
        stateType TEXT NOT NULL,
        stateValue TEXT NOT NULL,
        description TEXT,
        sourceChapter INTEGER NOT NULL,
        validFromChapter INTEGER NOT NULL,
        validUntilChapter INTEGER NOT NULL,
        evidenceSpanId TEXT,
        evidenceQuote TEXT,
        confidence REAL NOT NULL DEFAULT 0.7,
        status TEXT NOT NULL DEFAULT 'ai_generated',
        includeByDefault INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
        FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
        FOREIGN KEY (entityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
        FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL
      )
    `,
    insertSql: `
      INSERT INTO __EntityState_canonical (
        id, novelId, branchId, entityId, stateType, stateValue, description,
        sourceChapter, validFromChapter, validUntilChapter,
        evidenceSpanId, evidenceQuote, confidence, status, includeByDefault, createdAt, updatedAt
      )
      SELECT
        id, novelId, branchId, entityId, stateType, stateValue, description,
        sourceChapter, validFromChapter,
        CASE
          WHEN validUntilChapter IS NOT NULL THEN validUntilChapter
          WHEN validToChapter IS NOT NULL THEN validToChapter + 1
          ELSE ${INF_CHAPTER}
        END,
        evidenceSpanId, evidenceQuote, confidence, status, includeByDefault, createdAt, updatedAt
      FROM EntityState
    `,
  },
  {
    tableName: 'KnowledgeFact',
    tempTableName: '__KnowledgeFact_canonical',
    createSql: `
      CREATE TABLE __KnowledgeFact_canonical (
        id TEXT PRIMARY KEY,
        novelId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        factType TEXT NOT NULL,
        subjectEntityId TEXT,
        predicate TEXT NOT NULL,
        objectEntityId TEXT,
        valueJson TEXT,
        sourceChapter INTEGER NOT NULL,
        validFromChapter INTEGER NOT NULL,
        validUntilChapter INTEGER NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.7,
        status TEXT NOT NULL DEFAULT 'ai_generated',
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
        FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
        FOREIGN KEY (subjectEntityId) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL,
        FOREIGN KEY (objectEntityId) REFERENCES KnowledgeEntity(id) ON DELETE SET NULL
      )
    `,
    insertSql: `
      INSERT INTO __KnowledgeFact_canonical (
        id, novelId, branchId, factType, subjectEntityId, predicate, objectEntityId, valueJson,
        sourceChapter, validFromChapter, validUntilChapter,
        confidence, status, createdAt, updatedAt
      )
      SELECT
        id, novelId, branchId, factType, subjectEntityId, predicate, objectEntityId, valueJson,
        sourceChapter, validFromChapter,
        CASE
          WHEN validUntilChapter IS NOT NULL THEN validUntilChapter
          WHEN validToChapter IS NOT NULL THEN validToChapter + 1
          ELSE ${INF_CHAPTER}
        END,
        confidence, status, createdAt, updatedAt
      FROM KnowledgeFact
    `,
  },
  {
    tableName: 'KnowledgeRelation',
    tempTableName: '__KnowledgeRelation_canonical',
    createSql: `
      CREATE TABLE __KnowledgeRelation_canonical (
        id TEXT PRIMARY KEY,
        novelId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        sourceEntityId TEXT NOT NULL,
        targetEntityId TEXT NOT NULL,
        relationType TEXT NOT NULL,
        polarity TEXT,
        strength INTEGER NOT NULL DEFAULT 3,
        sourceChapter INTEGER NOT NULL,
        validFromChapter INTEGER NOT NULL,
        validUntilChapter INTEGER NOT NULL,
        evidenceSpanId TEXT,
        confidence REAL NOT NULL DEFAULT 0.7,
        status TEXT NOT NULL DEFAULT 'ai_generated',
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
        FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
        FOREIGN KEY (sourceEntityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
        FOREIGN KEY (targetEntityId) REFERENCES KnowledgeEntity(id) ON DELETE CASCADE,
        FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL
      )
    `,
    insertSql: `
      INSERT INTO __KnowledgeRelation_canonical (
        id, novelId, branchId, sourceEntityId, targetEntityId, relationType, polarity, strength,
        sourceChapter, validFromChapter, validUntilChapter,
        evidenceSpanId, confidence, status, createdAt, updatedAt
      )
      SELECT
        id, novelId, branchId, sourceEntityId, targetEntityId, relationType, polarity, strength,
        sourceChapter, validFromChapter,
        CASE
          WHEN validUntilChapter IS NOT NULL THEN validUntilChapter
          WHEN validToChapter IS NOT NULL THEN validToChapter + 1
          ELSE ${INF_CHAPTER}
        END,
        evidenceSpanId, confidence, status, createdAt, updatedAt
      FROM KnowledgeRelation
    `,
  },
  {
    tableName: 'KnowledgeWorld',
    tempTableName: '__KnowledgeWorld_canonical',
    createSql: `
      CREATE TABLE __KnowledgeWorld_canonical (
        id TEXT PRIMARY KEY,
        novelId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        term TEXT NOT NULL,
        category TEXT,
        definition TEXT NOT NULL,
        firstSeenChapter INTEGER,
        validFromChapter INTEGER,
        validUntilChapter INTEGER NOT NULL,
        evidenceSpanId TEXT,
        status TEXT NOT NULL DEFAULT 'ai_generated',
        confidence REAL NOT NULL DEFAULT 0.7,
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (novelId) REFERENCES NovelRecord(id) ON DELETE CASCADE,
        FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE,
        FOREIGN KEY (evidenceSpanId) REFERENCES TextSpan(id) ON DELETE SET NULL,
        UNIQUE (branchId, term, category)
      )
    `,
    insertSql: `
      INSERT INTO __KnowledgeWorld_canonical (
        id, novelId, branchId, term, category, definition, firstSeenChapter,
        validFromChapter, validUntilChapter, evidenceSpanId,
        status, confidence, createdAt, updatedAt
      )
      SELECT
        id, novelId, branchId, term, category, definition, firstSeenChapter,
        validFromChapter,
        CASE
          WHEN validUntilChapter IS NOT NULL THEN validUntilChapter
          WHEN validToChapter IS NOT NULL THEN validToChapter + 1
          ELSE ${INF_CHAPTER}
        END,
        evidenceSpanId, status, confidence, createdAt, updatedAt
      FROM KnowledgeWorld
    `,
  },
]

function rebuildTableToCanonicalSchema(database: DatabaseSync, config: CanonicalTableRebuild) {
  database.exec(`DROP TABLE IF EXISTS ${config.tempTableName}`)
  database.exec(config.createSql)
  database.exec(config.insertSql)
  database.exec(`DROP TABLE ${config.tableName}`)
  database.exec(`ALTER TABLE ${config.tempTableName} RENAME TO ${config.tableName}`)
}

function runBootMigrations(database: DatabaseSync) {
  const intervalTablesNeedingRebuild = CANONICAL_INTERVAL_TABLE_REBUILDS.filter((config) => needsCanonicalIntervalRebuild(database, config.tableName))
  const hasSnapshotTable = tableExists(database, 'ChapterSnapshot')
  const hasGraphContextCacheTable = tableExists(database, 'GraphContextCache')

  if (intervalTablesNeedingRebuild.length || hasSnapshotTable || hasGraphContextCacheTable) {
    database.exec('PRAGMA foreign_keys = OFF')
    database.exec('BEGIN IMMEDIATE')
    try {
      if (hasSnapshotTable) {
        database.exec('DROP TABLE ChapterSnapshot')
      }
      if (hasGraphContextCacheTable) {
        database.exec('DROP TABLE GraphContextCache')
      }
      for (const config of intervalTablesNeedingRebuild) {
        rebuildTableToCanonicalSchema(database, config)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    } finally {
      database.exec('PRAGMA foreign_keys = ON')
    }
  }

  database.exec('CREATE INDEX IF NOT EXISTS idx_entity_link_source_valid_until ON EntityLink(branchId, sourceEntityId, validFromChapter, validUntilChapter)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_entity_link_target_valid_until ON EntityLink(branchId, targetEntityId, validFromChapter, validUntilChapter)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_entity_link_chapter ON EntityLink(branchId, sourceChapter)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_entity_link_status ON EntityLink(branchId, status)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_entity_state_entity_valid_until ON EntityState(branchId, entityId, validFromChapter, validUntilChapter)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_entity_state_status ON EntityState(branchId, status)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_fact_branch_source ON KnowledgeFact(branchId, sourceChapter)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_relation_branch_valid_until ON KnowledgeRelation(branchId, validFromChapter, validUntilChapter)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_world_branch_valid_until ON KnowledgeWorld(branchId, validFromChapter, validUntilChapter)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_label_scope ON story_timeline_nodes(novel_id, branch_id, node_type, label_index)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_anchor_chapter ON story_timeline_nodes(novel_id, branch_id, anchor_chapter_no)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_parent ON story_timeline_nodes(parent_node_id)')
  if (!columnExists(database, 'story_timeline_nodes', 'continue_block_id')) {
    database.exec('ALTER TABLE story_timeline_nodes ADD COLUMN continue_block_id TEXT')
  }
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_story_timeline_nodes_continue_block ON story_timeline_nodes(continue_block_id) WHERE continue_block_id IS NOT NULL')
  database.exec('CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_continue_block ON story_timeline_nodes(continue_block_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_session ON story_timeline_nodes(what_if_session_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_run ON story_timeline_nodes(future_jump_run_id)')
  database.exec('CREATE TABLE IF NOT EXISTS continue_blocks (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, branch_id TEXT NOT NULL, parent_timeline_node_id TEXT, source_chapter_no INTEGER NOT NULL, title TEXT NOT NULL, subtitle TEXT, user_instruction TEXT NOT NULL, selected_text TEXT NOT NULL, original_text TEXT NOT NULL, latest_text TEXT NOT NULL, latest_revision_no INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT \"active\", created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE, FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE, FOREIGN KEY (parent_timeline_node_id) REFERENCES story_timeline_nodes(id) ON DELETE SET NULL)')
  database.exec('CREATE TABLE IF NOT EXISTS continue_block_revisions (id TEXT PRIMARY KEY, continue_block_id TEXT NOT NULL, revision_no INTEGER NOT NULL, revision_kind TEXT NOT NULL, user_instruction TEXT NOT NULL, selected_text TEXT NOT NULL, original_text TEXT NOT NULL, generated_text TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (continue_block_id) REFERENCES continue_blocks(id) ON DELETE CASCADE, UNIQUE (continue_block_id, revision_no))')
  database.exec('CREATE INDEX IF NOT EXISTS idx_continue_blocks_branch_source ON continue_blocks(branch_id, source_chapter_no)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_continue_blocks_parent_node ON continue_blocks(parent_timeline_node_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_continue_block_revisions_block ON continue_block_revisions(continue_block_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_what_if_sessions_branch_source ON what_if_sessions(base_branch_id, source_chapter_no)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_what_if_deltas_session ON what_if_deltas(session_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_outline_nodes_branch_track_sort ON outline_nodes(novel_id, branch_id, track_key, sort_order)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_outline_nodes_branch_chapter ON outline_nodes(novel_id, branch_id, chapter_no)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_outline_nodes_source_type ON outline_nodes(branch_id, source_type)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_outline_node_chapters_outline_primary_sort ON outline_node_chapters(outline_node_id, is_primary, sort_order)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_outline_node_chapters_chapter_anchor ON outline_node_chapters(chapter_no, chapter_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_future_jump_runs_session ON future_jump_runs(session_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_future_jump_runs_parent_node ON future_jump_runs(parent_timeline_node_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_future_jump_runs_target_outline ON future_jump_runs(target_outline_node_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_future_jump_runs_target_outline_chapter ON future_jump_runs(target_outline_chapter_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_future_jump_runs_branch_target_chapter ON future_jump_runs(base_branch_id, target_chapter_no)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_future_jump_revisions_run ON future_jump_revisions(run_id)')
}

export const sqlite = globalForSqlite.sqlite ?? createDatabase()

if (process.env.NODE_ENV !== 'production') {
  globalForSqlite.sqlite = sqlite
}

export function execute(sql: string, ...params: SqlParam[]) {
  return sqlite.prepare(sql).run(...params)
}

export function queryOne<T>(sql: string, ...params: SqlParam[]) {
  const row = sqlite.prepare(sql).get(...params)
  return (row ?? null) as T | null
}

export function queryAll<T>(sql: string, ...params: SqlParam[]) {
  return sqlite.prepare(sql).all(...params) as T[]
}

export async function withTransaction<T>(callback: () => T | Promise<T>) {
  execute('BEGIN IMMEDIATE')
  try {
    const result = await callback()
    execute('COMMIT')
    return result
  } catch (error) {
    try {
      execute('ROLLBACK')
    } catch {
    }
    throw error
  }
}

export type { SqlParam }
