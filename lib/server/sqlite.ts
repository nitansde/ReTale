import { assertDatabaseTransactionAccess, beginSqliteTransaction, getDatabaseTransactionKey, observeOutwardNestedTransaction, runSerializedDatabaseTransaction } from '@/lib/server/database-transactions'
import { isSqliteLockError, runWithSqliteBusyRetry } from '@/lib/server/sqlite-busy'
export { isSqliteLockError, runWithSqliteBusyRetry } from '@/lib/server/sqlite-busy'
import fs from 'node:fs'
import path from 'node:path'
import type * as NodeSqlite from 'node:sqlite'
import { INF_CHAPTER } from '@/lib/server/chapter-interval'
import { SCHEMA_SQL } from '@/lib/server/schema'
import { assertOwnedTestPath } from '../../scripts/test-path-safety.mjs'

type DatabaseSync = NodeSqlite.DatabaseSync
type SqlParam = string | number | bigint | Uint8Array | null
type TableColumnInfo = { name: string; notnull: number; pk: number }
type DatabaseListRow = { name: string; file: string }

type CanonicalTableRebuild = {
  tableName: 'EntityLink' | 'EntityState' | 'KnowledgeFact' | 'KnowledgeRelation' | 'KnowledgeWorld'
  tempTableName: string
  createSql: string
  insertSql: string
}

type BootMigrationPlan = {
  intervalTablesNeedingRebuild: CanonicalTableRebuild[]
  shouldRebuildActiveRetrievalIndex: boolean
  hasSnapshotTable: boolean
  hasGraphContextCacheTable: boolean
  shouldRebuildWorkspaceStateArtifactTables: boolean
  shouldRebuildWorkspaceKnowledgeSyncState: boolean
  shouldRebuildWorkspaceChapterPatchJournal: boolean
}

const globalForSqlite = globalThis as {
  sqlite?: DatabaseSync
}

type InitializeDatabaseMode = 'full' | 'control'

type InitializeDatabaseOptions = {
  schemaSql?: string
  mode?: InitializeDatabaseMode
}

const processWithBuiltins = process as typeof process & {
  getBuiltinModule?: (moduleName: 'node:sqlite') => typeof NodeSqlite
}

function loadNodeSqlite() {
  const sqliteModule = processWithBuiltins.getBuiltinModule?.('node:sqlite')
  if (!sqliteModule) {
    throw new Error('node:sqlite is required but is not available in this Node.js runtime')
  }

  return sqliteModule
}

const { DatabaseSync } = loadNodeSqlite()

export const SQLITE_BUSY_TIMEOUT_MS = 15_000
const SQLITE_WAL_ATTEMPT_BUSY_TIMEOUT_MS = 250

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

    return path.join(/* turbopackIgnore: true */ process.cwd(), rawPath.replace(/^\.\//, ''))
  }

  if (path.isAbsolute(databaseUrl)) {
    return databaseUrl
  }

  throw new Error(`Unsupported SQLite DATABASE_URL: ${databaseUrl}`)
}

function createDatabase() {
  const database = openSqliteDatabase(process.env.DATABASE_URL ?? 'file:./dev.db')
  return initializeDatabase(database)
}

export function openSqliteDatabase(filename: string) {
  const resolvedFilename = resolveDatabasePath(filename)
  if (process.env.VITEST === 'true' && resolvedFilename !== ':memory:') {
    const testRoot = process.env.RETALE_TEST_ROOT
    if (!testRoot) {
      throw new Error('Vitest SQLite access requires RETALE_TEST_ROOT')
    }
    assertOwnedTestPath(testRoot, resolvedFilename, {
      repoRoot: process.cwd(),
      label: 'Vitest SQLite database',
    })
  }
  if (resolvedFilename !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedFilename), { recursive: true })
  }

  return new DatabaseSync(resolvedFilename)
}

export function initializeDatabase(database: DatabaseSync, options: InitializeDatabaseOptions = {}) {
  const mode = options.mode ?? 'full'
  const schemaSql = options.schemaSql ?? SCHEMA_SQL

  applyConnectionPragmas(database)

  if (mode === 'control') {
    execWithBusyRetry(database, schemaSql)
    runControlMigrations(database)
    return database
  }

  if (tableExists(database, 'RawTextEmbeddingCache') && (
    tableHasColumns(database, 'RawTextEmbeddingCache', ['vectorJson'])
    || !tableHasColumns(database, 'RawTextEmbeddingCache', ['vectorBlob'])
  )) {
    throw new Error('Embedding cache requires offline migration. Stop the server, back up the database, then run storage:migrate-vectors with --apply --retire-json until complete and --apply --finalize before restarting.')
  }

  const migrationPlan = getBootMigrationPlan(database)
  if (!bootMigrationPlanNeedsWork(migrationPlan) && bootSchemaIsCurrent(database)) {
    return database
  }

  execWithBusyRetry(database, schemaSql)
  runBootMigrations(database, migrationPlan)
  return database
}

function runControlMigrations(database: DatabaseSync) {
  addColumnIfMissing(database, 'NovelRegistry', 'author', 'author TEXT')
  addColumnIfMissing(database, 'NovelRegistry', 'lifecycleToken', 'lifecycleToken TEXT')
  addColumnIfMissing(database, 'NovelRegistry', 'leaseExpiresAt', 'leaseExpiresAt TEXT')
  addColumnIfMissing(database, 'NovelRegistry', 'claimedAt', 'claimedAt TEXT')
  createIndexIfMissing(
    database,
    'idx_novel_registry_lifecycle',
    'CREATE INDEX idx_novel_registry_lifecycle ON NovelRegistry(migrationStatus, leaseExpiresAt, updatedAt, novelId)',
  )
}

function execWithBusyRetry(database: DatabaseSync, sql: string) {
  runWithSqliteBusyRetry(() => database.exec(sql))
}

function databaseIsFileBacked(database: DatabaseSync) {
  const rows = database.prepare('PRAGMA database_list').all() as DatabaseListRow[]
  const mainDatabase = rows.find((row) => row.name === 'main')
  return Boolean(mainDatabase?.file)
}

function tryEnableWal(database: DatabaseSync) {
  if (!databaseIsFileBacked(database)) {
    return
  }

  try {
    database.exec('PRAGMA journal_mode = WAL')
  } catch (error) {
    if (isSqliteLockError(error)) {
      console.warn('Skipping SQLite WAL enable because the database is currently locked.', error)
      return
    }
    throw error
  }
}

export function applyConnectionPragmas(database: DatabaseSync) {
  database.exec('PRAGMA foreign_keys = ON')
  database.exec(`PRAGMA busy_timeout = ${SQLITE_WAL_ATTEMPT_BUSY_TIMEOUT_MS}`)
  tryEnableWal(database)
  database.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`)
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

function tableHasColumns(database: DatabaseSync, tableName: string, columnNames: readonly string[]) {
  const existingColumnNames = new Set(getTableColumns(database, tableName).map((column) => column.name))
  return columnNames.every((columnName) => existingColumnNames.has(columnName))
}

function indexExists(database: DatabaseSync, indexName: string) {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1").get(indexName)
  )
}

function triggerExists(database: DatabaseSync, triggerName: string) {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ? LIMIT 1").get(triggerName)
  )
}

const BOOT_SCHEMA_INDEX_NAMES = [
  'idx_knowledge_chapter_branch_no',
  'idx_chapter_extraction_candidates_order',
  'idx_chapter_extraction_candidates_chapter',
  'idx_workspace_state_backup_state_created',
  'idx_workspace_knowledge_sync_requested',
  'idx_workspace_runtime_novel_state_order',
  'idx_workspace_runtime_chapter_state_novel_order',
  'idx_workspace_mutation_replay_created',
  'idx_workspace_patch_journal_revision',
  'idx_hanlp_bootstrap_cache_lookup',
  'idx_hanlp_bootstrap_cache_last_seen',
  'idx_chapter_extraction_candidates_processing_batch',
  'idx_chapter_extraction_processing_batches_branch',
  'uq_chapter_extraction_processing_batches_identity',
  'idx_hanlp_bootstrap_results_lookup',
  'idx_hanlp_bootstrap_results_job',
  'uq_character_candidates_surface_text',
  'uq_character_candidate_chapters_chapter_no',
  'idx_hanlp_bootstrap_entities_branch_type',
  'idx_hanlp_bootstrap_entities_result_lookup',
  'idx_hanlp_bootstrap_coverage_novel',
  'idx_character_candidates_branch_status',
  'idx_character_candidates_promotion_lookup',
  'idx_character_candidate_chapters_candidate_count',
  'idx_character_candidate_chapters_branch_chapter',
  'idx_text_span_branch_chapter',
  'idx_text_span_chapter_type',
  'idx_knowledge_entity_branch_name',
  'idx_knowledge_entity_branch_tier',
  'idx_entity_alias_mapping_branch_alias',
  'idx_entity_alias_mapping_branch_entity',
  'idx_entity_alias_conflict_branch_alias',
  'idx_entity_mention_branch_chapter',
  'idx_entity_mention_entity_chapter',
  'idx_entity_link_source_valid_until',
  'idx_entity_link_target_valid_until',
  'idx_entity_link_chapter',
  'idx_entity_link_status',
  'idx_entity_state_entity_valid_until',
  'idx_entity_state_status',
  'idx_knowledge_fact_branch_source',
  'idx_knowledge_relation_branch_valid_until',
  'idx_knowledge_event_branch_chapter',
  'idx_event_link_source_valid',
  'idx_event_link_target_valid',
  'idx_event_link_status',
  'idx_knowledge_world_branch_valid_until',
  'idx_job_novel_status',
  'idx_job_branch_status',
  'idx_generation_context_snapshot_scope',
  'idx_story_timeline_nodes_label_scope',
  'idx_story_timeline_nodes_anchor_chapter',
  'idx_story_timeline_nodes_parent',
  'idx_story_timeline_nodes_session',
  'idx_story_timeline_nodes_run',
  'uq_story_timeline_nodes_continue_block',
  'idx_story_timeline_nodes_continue_block',
  'uq_story_timeline_nodes_roleplay_session',
  'idx_story_timeline_nodes_roleplay_session',
  'idx_continue_blocks_branch_source',
  'idx_continue_blocks_parent_node',
  'idx_continue_block_revisions_block',
  'idx_what_if_sessions_branch_source',
  'idx_what_if_deltas_session',
  'idx_roleplay_sessions_branch_source',
  'idx_roleplay_sessions_source_node',
  'idx_roleplay_messages_session_order',
  'idx_roleplay_messages_parent',
  'idx_roleplay_messages_fork',
  'idx_roleplay_messages_variant_group',
  'idx_outline_nodes_branch_track_sort',
  'idx_outline_nodes_branch_chapter',
  'idx_outline_nodes_source_type',
  'idx_outline_node_chapters_outline_primary_sort',
  'idx_outline_node_chapters_chapter_anchor',
  'idx_future_jump_runs_session',
  'idx_future_jump_runs_parent_node',
  'idx_future_jump_runs_source_node',
  'idx_future_jump_runs_source_chapter',
  'idx_future_jump_runs_target_outline',
  'idx_future_jump_runs_target_outline_chapter',
  'idx_future_jump_runs_branch_target_chapter',
  'idx_future_jump_revisions_run',
] as const

function bootSchemaIndexesAreCurrent(database: DatabaseSync) {
  return BOOT_SCHEMA_INDEX_NAMES.every((indexName) => indexExists(database, indexName))
}

function addColumnIfMissing(database: DatabaseSync, tableName: string, columnName: string, columnSql: string) {
  if (columnExists(database, tableName, columnName)) {
    return
  }

  try {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`)
  } catch (error) {
    if (error instanceof Error && error.message.includes('duplicate column name')) {
      return
    }
    throw error
  }
}

function runStatementIfRowsExist(database: DatabaseSync, countSql: string, statementSql: string) {
  const row = database.prepare(countSql).get() as { count?: number } | undefined
  if ((row?.count ?? 0) > 0) {
    database.exec(statementSql)
  }
}

function createIndexIfMissing(database: DatabaseSync, indexName: string, createSql: string) {
  if (!indexExists(database, indexName)) {
    database.exec(createSql)
  }
}

function createTriggerIfMissing(database: DatabaseSync, triggerName: string, createSql: string) {
  if (!triggerExists(database, triggerName)) {
    database.exec(createSql)
  }
}

function needsCanonicalIntervalRebuild(database: DatabaseSync, tableName: CanonicalTableRebuild['tableName']) {
  const columns = getTableColumns(database, tableName)
  if (!columns.length) return false

  const validToColumn = columns.find((column) => column.name === 'validToChapter')
  const validUntilColumn = columns.find((column) => column.name === 'validUntilChapter')

  return Boolean(validToColumn) || !validUntilColumn || validUntilColumn.notnull !== 1
}

function needsActiveRetrievalIndexRebuild(database: DatabaseSync) {
  const columns = getTableColumns(database, 'ActiveRetrievalIndex')
  if (!columns.length) return false

  const columnNames = new Set(columns.map((column) => column.name))
  const branchColumn = columns.find((column) => column.name === 'branchId')
  const scopeColumn = columns.find((column) => column.name === 'scopeKey')

  return !columnNames.has('scopeKey')
    || !columnNames.has('scopeStartChapter')
    || !columnNames.has('scopeEndChapter')
    || branchColumn?.pk !== 1
    || scopeColumn?.pk !== 2
}

function columnIsNotNull(database: DatabaseSync, tableName: string, columnName: string) {
  const column = getTableColumns(database, tableName).find((entry) => entry.name === columnName)
  return column?.notnull === 1
}

function needsWorkspaceStateArtifactTableRebuild(database: DatabaseSync) {
  return columnIsNotNull(database, 'WorkspaceState', 'payload')
    || columnIsNotNull(database, 'WorkspaceStateBackup', 'payload')
}

function needsWorkspaceKnowledgeSyncStateRebuild(database: DatabaseSync) {
  if (!tableExists(database, 'WorkspaceKnowledgeSyncState')) return false
  const foreignKeys = database.prepare('PRAGMA foreign_key_list(WorkspaceKnowledgeSyncState)').all() as Array<{
    table: string
    from: string
    to: string
  }>
  return foreignKeys.length > 0
}

function rebuildWorkspaceKnowledgeSyncState(database: DatabaseSync) {
  const requestedSourceUpdatedAt = columnExists(database, 'WorkspaceKnowledgeSyncState', 'requestedSourceUpdatedAt')
    ? 'requestedSourceUpdatedAt'
    : 'NULL'
  const startedSourceUpdatedAt = columnExists(database, 'WorkspaceKnowledgeSyncState', 'startedSourceUpdatedAt')
    ? 'startedSourceUpdatedAt'
    : 'NULL'
  const syncedSourceUpdatedAt = columnExists(database, 'WorkspaceKnowledgeSyncState', 'syncedSourceUpdatedAt')
    ? 'syncedSourceUpdatedAt'
    : 'NULL'
  const requestedRevision = columnExists(database, 'WorkspaceKnowledgeSyncState', 'requestedRevision')
    ? 'requestedRevision'
    : `CASE WHEN ${requestedSourceUpdatedAt} IS NULL THEN 0 ELSE 1 END`
  const startedRevision = columnExists(database, 'WorkspaceKnowledgeSyncState', 'startedRevision')
    ? 'startedRevision'
    : `CASE WHEN ${startedSourceUpdatedAt} IS NULL THEN NULL ELSE ${requestedRevision} END`
  const syncedRevision = columnExists(database, 'WorkspaceKnowledgeSyncState', 'syncedRevision')
    ? 'syncedRevision'
    : `CASE WHEN ${syncedSourceUpdatedAt} IS NULL THEN 0 ELSE ${requestedRevision} END`
  const startedAt = columnExists(database, 'WorkspaceKnowledgeSyncState', 'startedAt') ? 'startedAt' : 'NULL'
  const claimToken = columnExists(database, 'WorkspaceKnowledgeSyncState', 'claimToken') ? 'claimToken' : 'NULL'
  const lastError = columnExists(database, 'WorkspaceKnowledgeSyncState', 'lastError') ? 'lastError' : 'NULL'
  const createdAt = columnExists(database, 'WorkspaceKnowledgeSyncState', 'createdAt') ? 'createdAt' : 'CURRENT_TIMESTAMP'
  const updatedAt = columnExists(database, 'WorkspaceKnowledgeSyncState', 'updatedAt') ? 'updatedAt' : 'CURRENT_TIMESTAMP'

  database.exec('DROP TABLE IF EXISTS __WorkspaceKnowledgeSyncState_without_fk')
  database.exec(`
    CREATE TABLE __WorkspaceKnowledgeSyncState_without_fk (
      workspaceStateId TEXT PRIMARY KEY,
      requestedRevision INTEGER NOT NULL DEFAULT 0,
      startedRevision INTEGER,
      syncedRevision INTEGER NOT NULL DEFAULT 0,
      requestedSourceUpdatedAt TEXT,
      startedSourceUpdatedAt TEXT,
      startedAt TEXT,
      claimToken TEXT,
      syncedSourceUpdatedAt TEXT,
      lastError TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  database.exec(`
    INSERT INTO __WorkspaceKnowledgeSyncState_without_fk (
      workspaceStateId, requestedRevision, startedRevision, syncedRevision,
      requestedSourceUpdatedAt, startedSourceUpdatedAt, startedAt, claimToken,
      syncedSourceUpdatedAt, lastError, createdAt, updatedAt
    )
    SELECT workspaceStateId, ${requestedRevision}, ${startedRevision}, ${syncedRevision},
           ${requestedSourceUpdatedAt}, ${startedSourceUpdatedAt}, ${startedAt}, ${claimToken},
           ${syncedSourceUpdatedAt}, ${lastError}, ${createdAt}, ${updatedAt}
    FROM WorkspaceKnowledgeSyncState
  `)
  database.exec('DROP TABLE WorkspaceKnowledgeSyncState')
  database.exec('ALTER TABLE __WorkspaceKnowledgeSyncState_without_fk RENAME TO WorkspaceKnowledgeSyncState')
}

function needsWorkspaceChapterPatchJournalRebuild(database: DatabaseSync) {
  if (!tableExists(database, 'WorkspaceChapterPatchJournal')) return false
  const foreignKeys = database.prepare('PRAGMA foreign_key_list(WorkspaceChapterPatchJournal)').all() as Array<{
    table: string
    from: string
    to: string
  }>
  return foreignKeys.some((foreignKey) => (
    foreignKey.table === 'WorkspaceRuntimeState'
    && foreignKey.from === 'workspaceStateId'
    && foreignKey.to === 'id'
  ))
}

function rebuildWorkspaceChapterPatchJournal(database: DatabaseSync) {
  database.exec('DROP TABLE IF EXISTS __WorkspaceChapterPatchJournal_without_runtime_fk')
  database.exec(`
    CREATE TABLE __WorkspaceChapterPatchJournal_without_runtime_fk (
      workspaceStateId TEXT NOT NULL,
      committedRevision INTEGER NOT NULL CHECK(committedRevision > 0),
      chapterId TEXT NOT NULL,
      novelId TEXT NOT NULL,
      contentHtml TEXT NOT NULL,
      wordCount INTEGER NOT NULL CHECK(wordCount >= 0),
      updatedAtLabel TEXT NOT NULL,
      committedAt TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(workspaceStateId, committedRevision)
    ) STRICT
  `)
  database.exec(`
    INSERT INTO __WorkspaceChapterPatchJournal_without_runtime_fk (
      workspaceStateId, committedRevision, chapterId, novelId,
      contentHtml, wordCount, updatedAtLabel, committedAt, createdAt
    )
    SELECT workspaceStateId, committedRevision, chapterId, novelId,
           contentHtml, wordCount, updatedAtLabel, committedAt, createdAt
    FROM WorkspaceChapterPatchJournal
  `)
  database.exec('DROP TABLE WorkspaceChapterPatchJournal')
  database.exec('ALTER TABLE __WorkspaceChapterPatchJournal_without_runtime_fk RENAME TO WorkspaceChapterPatchJournal')
}

function rebuildWorkspaceStateArtifactTables(database: DatabaseSync) {
  if (tableExists(database, 'WorkspaceState')) {
    database.exec('DROP TABLE IF EXISTS __WorkspaceState_nullable_payload')
    database.exec(`
      CREATE TABLE __WorkspaceState_nullable_payload (
        id TEXT PRIMARY KEY DEFAULT 'singleton',
        payload TEXT,
        revision INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    const workspaceStateHasRevision = columnExists(database, 'WorkspaceState', 'revision')
    database.exec(`
      INSERT INTO __WorkspaceState_nullable_payload (id, payload, revision, createdAt, updatedAt)
      SELECT id, payload, ${workspaceStateHasRevision ? 'revision' : '0'}, createdAt, updatedAt
      FROM WorkspaceState
    `)
    database.exec('DROP TABLE WorkspaceState')
    database.exec('ALTER TABLE __WorkspaceState_nullable_payload RENAME TO WorkspaceState')
  }

  if (tableExists(database, 'WorkspaceStateBackup')) {
    database.exec('DROP TABLE IF EXISTS __WorkspaceStateBackup_nullable_payload')
    database.exec(`
      CREATE TABLE __WorkspaceStateBackup_nullable_payload (
        id TEXT PRIMARY KEY,
        workspaceStateId TEXT NOT NULL,
        payload TEXT,
        revision INTEGER NOT NULL DEFAULT 0,
        reason TEXT NOT NULL DEFAULT 'overwrite',
        sourceUpdatedAt TEXT,
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
        FOREIGN KEY (workspaceStateId) REFERENCES WorkspaceState(id) ON DELETE CASCADE
      )
    `)
    const workspaceStateBackupHasRevision = columnExists(database, 'WorkspaceStateBackup', 'revision')
    database.exec(`
      INSERT INTO __WorkspaceStateBackup_nullable_payload (
        id, workspaceStateId, payload, revision, reason, sourceUpdatedAt, createdAt
      )
      SELECT id, workspaceStateId, payload, ${workspaceStateBackupHasRevision ? 'revision' : '0'},
             reason, sourceUpdatedAt, createdAt
      FROM WorkspaceStateBackup
    `)
    database.exec('DROP TABLE WorkspaceStateBackup')
    database.exec('ALTER TABLE __WorkspaceStateBackup_nullable_payload RENAME TO WorkspaceStateBackup')
  }
}

function rebuildActiveRetrievalIndexToScopedSchema(database: DatabaseSync) {
  const columns = getTableColumns(database, 'ActiveRetrievalIndex')
  const columnNames = new Set(columns.map((column) => column.name))
  const scopeKeyExpression = columnNames.has('scopeKey') ? "COALESCE(NULLIF(scopeKey, ''), 'full')" : "'full'"
  const scopeStartExpression = columnNames.has('scopeStartChapter') ? 'scopeStartChapter' : 'NULL'
  const scopeEndExpression = columnNames.has('scopeEndChapter') ? 'scopeEndChapter' : 'NULL'

  database.exec('DROP TABLE IF EXISTS __ActiveRetrievalIndex_scoped')
  database.exec(`
    CREATE TABLE __ActiveRetrievalIndex_scoped (
      branchId TEXT NOT NULL,
      scopeKey TEXT NOT NULL DEFAULT 'full',
      tableName TEXT NOT NULL UNIQUE,
      scopeStartChapter INTEGER,
      scopeEndChapter INTEGER,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (branchId, scopeKey),
      FOREIGN KEY (branchId) REFERENCES StoryBranch(id) ON DELETE CASCADE
    )
  `)
  database.exec(`
    INSERT INTO __ActiveRetrievalIndex_scoped (
      branchId, scopeKey, tableName, scopeStartChapter, scopeEndChapter, createdAt, updatedAt
    )
    SELECT branchId, ${scopeKeyExpression}, tableName, ${scopeStartExpression}, ${scopeEndExpression}, createdAt, updatedAt
    FROM ActiveRetrievalIndex
  `)
  database.exec('DROP TABLE ActiveRetrievalIndex')
  database.exec('ALTER TABLE __ActiveRetrievalIndex_scoped RENAME TO ActiveRetrievalIndex')
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

function getBootMigrationPlan(database: DatabaseSync): BootMigrationPlan {
  return {
    intervalTablesNeedingRebuild: CANONICAL_INTERVAL_TABLE_REBUILDS.filter((config) => needsCanonicalIntervalRebuild(database, config.tableName)),
    shouldRebuildActiveRetrievalIndex: needsActiveRetrievalIndexRebuild(database),
    hasSnapshotTable: tableExists(database, 'ChapterSnapshot'),
    hasGraphContextCacheTable: tableExists(database, 'GraphContextCache'),
    shouldRebuildWorkspaceStateArtifactTables: needsWorkspaceStateArtifactTableRebuild(database),
    shouldRebuildWorkspaceKnowledgeSyncState: needsWorkspaceKnowledgeSyncStateRebuild(database),
    shouldRebuildWorkspaceChapterPatchJournal: needsWorkspaceChapterPatchJournalRebuild(database),
  }
}

function bootMigrationPlanNeedsWork(plan: BootMigrationPlan) {
  return Boolean(
    plan.intervalTablesNeedingRebuild.length
      || plan.shouldRebuildActiveRetrievalIndex
      || plan.hasSnapshotTable
      || plan.hasGraphContextCacheTable
      || plan.shouldRebuildWorkspaceStateArtifactTables
      || plan.shouldRebuildWorkspaceKnowledgeSyncState
      || plan.shouldRebuildWorkspaceChapterPatchJournal
  )
}

function bootSchemaIsCurrent(database: DatabaseSync) {
  return tableHasColumns(database, 'hanlp_bootstrap_cache', [
    'chapter_id',
    'chapter_no',
    'chapter_text_hash',
    'hanlp_script_version_hash',
    'hanlp_model_or_config_hash',
    'output_schema_version',
  ])
    && tableHasColumns(database, 'PendingRetrievalIndex', ['rebuildFingerprint'])
    && tableHasColumns(database, 'RawTextEmbeddingCache', ['vectorBlob'])
    && tableHasColumns(database, 'chapter_extraction_candidates', ['processing_batch_id', 'processing_result_json'])
    && tableExists(database, 'chapter_extraction_processing_batches')
    && tableHasColumns(database, 'character_candidates', [
      'surface_text',
      'chapter_count',
      'observations_json',
      'status',
      'promotion_summary_status',
      'promotion_summary_generated_at',
      'merged_entity_id',
    ])
    && tableHasColumns(database, 'character_candidate_chapters', ['best_observation', 'best_evidence', 'chapter_id'])
    && tableExists(database, 'hanlp_bootstrap_entities')
    && tableExists(database, 'hanlp_bootstrap_coverage')
    && tableHasColumns(database, 'KnowledgeEntity', ['importanceTier'])
    && triggerExists(database, 'trg_knowledge_entity_character_tier_insert')
    && triggerExists(database, 'trg_knowledge_entity_character_tier_update')
    && bootSchemaIndexesAreCurrent(database)
    && tableHasColumns(database, 'WorkspaceKnowledgeSyncState', ['requestedRevision', 'startedRevision', 'syncedRevision', 'claimToken'])
    && !needsWorkspaceKnowledgeSyncStateRebuild(database)
    && tableHasColumns(database, 'WorkspaceRuntimeState', [
      'revision',
      'localOutlinesJson',
      'localCharactersJson',
      'localCharacterRelationsJson',
      'localWorldEntriesJson',
      'localTimelineEventsJson',
    ])
    && !columnIsNotNull(database, 'WorkspaceState', 'payload')
    && !columnIsNotNull(database, 'WorkspaceStateBackup', 'payload')
    && tableHasColumns(database, 'WorkspaceState', ['revision'])
    && tableHasColumns(database, 'WorkspaceStateBackup', ['revision'])
    && tableExists(database, 'WorkspaceRuntimeNovel')
    && tableExists(database, 'WorkspaceRuntimeChapter')
    && tableHasColumns(database, 'WorkspaceMutationReplay', [
      'workspaceStateId',
      'idempotencyKey',
      'operation',
      'requestHash',
      'committedRevision',
      'responseStatus',
      'responseJson',
      'createdAt',
    ])
    && tableHasColumns(database, 'WorkspaceChapterPatchJournal', [
      'workspaceStateId',
      'committedRevision',
      'chapterId',
      'novelId',
      'contentHtml',
      'wordCount',
      'updatedAtLabel',
      'committedAt',
    ])
    && !needsWorkspaceChapterPatchJournalRebuild(database)
    && tableHasColumns(database, 'EntityAlias', ['createdAt', 'updatedAt'])
    && tableHasColumns(database, 'GenerationContextSnapshot', [
      'novelId',
      'branchId',
      'chapterId',
      'requestFingerprint',
      'knowledgeFingerprint',
      'contextJson',
      'expiresAt',
    ])
    && tableHasColumns(database, 'story_timeline_nodes', [
      'continue_block_id',
      'readable_label',
      'readable_lineage_label',
      'roleplay_session_id',
    ])
    && tableHasColumns(database, 'continue_blocks', [
      'latest_input_tokens',
      'latest_output_tokens',
      'writing_skill_card_ids_json',
      'writing_skill_example_count',
    ])
    && tableHasColumns(database, 'continue_block_revisions', ['input_tokens', 'output_tokens'])
    && tableHasColumns(database, 'what_if_sessions', ['input_tokens', 'output_tokens'])
    && tableExists(database, 'roleplay_sessions')
    && tableExists(database, 'roleplay_messages')
    && tableHasColumns(database, 'future_jump_runs', [
      'source_timeline_node_id',
      'source_timeline_node_type',
      'source_chapter_id',
      'source_what_if_session_id',
      'latest_input_tokens',
      'latest_output_tokens',
    ])
    && tableHasColumns(database, 'future_jump_revisions', ['input_tokens', 'output_tokens'])
}

function runBootMigrations(database: DatabaseSync, migrationPlan = getBootMigrationPlan(database)) {
  const {
    intervalTablesNeedingRebuild,
    shouldRebuildActiveRetrievalIndex,
    hasSnapshotTable,
    hasGraphContextCacheTable,
    shouldRebuildWorkspaceStateArtifactTables,
    shouldRebuildWorkspaceKnowledgeSyncState,
    shouldRebuildWorkspaceChapterPatchJournal,
  } = migrationPlan

  if (!bootMigrationPlanNeedsWork(migrationPlan) && bootSchemaIsCurrent(database)) {
    return
  }

  if (
    intervalTablesNeedingRebuild.length
    || shouldRebuildActiveRetrievalIndex
    || hasSnapshotTable
    || hasGraphContextCacheTable
    || shouldRebuildWorkspaceStateArtifactTables
    || shouldRebuildWorkspaceKnowledgeSyncState
    || shouldRebuildWorkspaceChapterPatchJournal
  ) {
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
      if (shouldRebuildActiveRetrievalIndex) {
        rebuildActiveRetrievalIndexToScopedSchema(database)
      }
      if (shouldRebuildWorkspaceStateArtifactTables) {
        rebuildWorkspaceStateArtifactTables(database)
      }
      if (shouldRebuildWorkspaceKnowledgeSyncState) {
        rebuildWorkspaceKnowledgeSyncState(database)
      }
      if (shouldRebuildWorkspaceChapterPatchJournal) {
        rebuildWorkspaceChapterPatchJournal(database)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    } finally {
      database.exec('PRAGMA foreign_keys = ON')
    }
  }

  addColumnIfMissing(database, 'hanlp_bootstrap_cache', 'chapter_id', 'chapter_id TEXT')
  addColumnIfMissing(database, 'hanlp_bootstrap_cache', 'chapter_no', 'chapter_no INTEGER')
  addColumnIfMissing(database, 'hanlp_bootstrap_cache', 'chapter_text_hash', 'chapter_text_hash TEXT')
  addColumnIfMissing(database, 'hanlp_bootstrap_cache', 'hanlp_script_version_hash', 'hanlp_script_version_hash TEXT')
  addColumnIfMissing(database, 'hanlp_bootstrap_cache', 'hanlp_model_or_config_hash', 'hanlp_model_or_config_hash TEXT')
  addColumnIfMissing(database, 'hanlp_bootstrap_cache', 'output_schema_version', "output_schema_version TEXT DEFAULT 'v1'")
  addColumnIfMissing(database, 'PendingRetrievalIndex', 'rebuildFingerprint', 'rebuildFingerprint TEXT')
  addColumnIfMissing(database, 'chapter_extraction_candidates', 'processing_batch_id', 'processing_batch_id TEXT')
  addColumnIfMissing(database, 'chapter_extraction_candidates', 'processing_result_json', 'processing_result_json TEXT')
  database.exec(`
    CREATE TABLE IF NOT EXISTS chapter_extraction_processing_batches (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      batch_identity_hash TEXT NOT NULL,
      batch_context_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
      UNIQUE (branch_id, batch_identity_hash)
    )
  `)
  addColumnIfMissing(database, 'character_candidates', 'surface_text', 'surface_text TEXT')
  addColumnIfMissing(database, 'character_candidates', 'chapter_count', 'chapter_count INTEGER DEFAULT 1')
  addColumnIfMissing(database, 'character_candidates', 'observations_json', 'observations_json TEXT')
  addColumnIfMissing(database, 'character_candidates', 'status', "status TEXT DEFAULT 'collecting'")
  addColumnIfMissing(database, 'character_candidates', 'promotion_summary_status', "promotion_summary_status TEXT DEFAULT 'not_requested'")
  addColumnIfMissing(database, 'character_candidates', 'promotion_summary_generated_at', 'promotion_summary_generated_at TEXT')
  addColumnIfMissing(database, 'character_candidates', 'merged_entity_id', 'merged_entity_id TEXT')
  addColumnIfMissing(database, 'character_candidate_chapters', 'best_observation', 'best_observation TEXT')
  addColumnIfMissing(database, 'character_candidate_chapters', 'best_evidence', 'best_evidence TEXT')
  addColumnIfMissing(database, 'character_candidate_chapters', 'chapter_id', 'chapter_id TEXT')
  database.exec(`
    UPDATE character_candidates
    SET surface_text = COALESCE(NULLIF(surface_text, ''), display_name, normalized_name)
    WHERE surface_text IS NULL OR surface_text = ''
  `)
  database.exec(`
    UPDATE character_candidates
    SET first_seen_chapter = COALESCE(first_seen_chapter, 1),
        last_seen_chapter = COALESCE(last_seen_chapter, COALESCE(first_seen_chapter, 1)),
        chapter_count = COALESCE(chapter_count, 1),
        mention_count = CASE WHEN mention_count IS NULL OR mention_count < 1 THEN 1 ELSE mention_count END,
        status = COALESCE(status, 'collecting'),
        promotion_summary_status = COALESCE(promotion_summary_status, 'not_requested')
  `)
  database.exec(`
    UPDATE character_candidate_chapters
    SET mention_count = CASE WHEN mention_count IS NULL OR mention_count < 1 THEN 1 ELSE mention_count END
  `)
  database.exec(`
    CREATE TABLE IF NOT EXISTS hanlp_bootstrap_entities (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      chapter_id TEXT,
      chapter_no INTEGER,
      entity_text TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      total_count INTEGER NOT NULL DEFAULT 1,
      chapter_count INTEGER NOT NULL DEFAULT 1,
      coverage_ratio REAL NOT NULL DEFAULT 0,
      score REAL NOT NULL DEFAULT 0,
      source_cache_id TEXT,
      source_result_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE,
      FOREIGN KEY (chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL,
      FOREIGN KEY (source_cache_id) REFERENCES hanlp_bootstrap_cache(id) ON DELETE SET NULL,
      FOREIGN KEY (source_result_id) REFERENCES hanlp_bootstrap_results(id) ON DELETE SET NULL,
      UNIQUE (branch_id, chapter_id, entity_text, entity_type, source_result_id)
    )
  `)
  database.exec(`
    CREATE TABLE IF NOT EXISTS hanlp_bootstrap_coverage (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL UNIQUE,
      valid_through_chapter_no INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE
    )
  `)
  addColumnIfMissing(database, 'KnowledgeEntity', 'importanceTier', 'importanceTier TEXT')
  database.exec('DROP TRIGGER IF EXISTS trg_knowledge_entity_character_tier_insert')
  database.exec('DROP TRIGGER IF EXISTS trg_knowledge_entity_character_tier_update')
  database.exec(`
    UPDATE KnowledgeEntity
    SET status = 'rejected', updatedAt = CURRENT_TIMESTAMP
    WHERE entityType = 'character'
      AND COALESCE(userConfirmed, 0) = 0
      AND (importanceTier IS NULL OR importanceTier NOT IN ('protagonist', 'important', 'arc'))
  `)
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_knowledge_entity_character_tier_insert
    BEFORE INSERT ON KnowledgeEntity
    FOR EACH ROW
    WHEN (NEW.entityType = 'character' AND (NEW.importanceTier IS NULL OR NEW.importanceTier NOT IN ('protagonist', 'important', 'arc')))
      OR (NEW.entityType <> 'character' AND NEW.importanceTier IS NOT NULL)
    BEGIN
      SELECT RAISE(ABORT, 'character entities require Tier 0, Tier 1, or Tier 2 importanceTier');
    END
  `)
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_knowledge_entity_character_tier_update
    BEFORE UPDATE OF entityType, importanceTier ON KnowledgeEntity
    FOR EACH ROW
    WHEN (NEW.entityType = 'character' AND (NEW.importanceTier IS NULL OR NEW.importanceTier NOT IN ('protagonist', 'important', 'arc')))
      OR (NEW.entityType <> 'character' AND NEW.importanceTier IS NOT NULL)
    BEGIN
      SELECT RAISE(ABORT, 'character entities require Tier 0, Tier 1, or Tier 2 importanceTier');
    END
  `)
  database.exec('CREATE INDEX IF NOT EXISTS idx_hanlp_bootstrap_cache_lookup ON hanlp_bootstrap_cache(branch_id, chapter_no, chapter_text_hash, hanlp_script_version_hash, hanlp_model_or_config_hash, output_schema_version)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_workspace_state_backup_state_created ON WorkspaceStateBackup(workspaceStateId, createdAt)')
  database.exec('CREATE TABLE IF NOT EXISTS WorkspaceKnowledgeSyncState (workspaceStateId TEXT PRIMARY KEY, requestedRevision INTEGER NOT NULL DEFAULT 0, startedRevision INTEGER, syncedRevision INTEGER NOT NULL DEFAULT 0, requestedSourceUpdatedAt TEXT, startedSourceUpdatedAt TEXT, startedAt TEXT, claimToken TEXT, syncedSourceUpdatedAt TEXT, lastError TEXT, createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
  addColumnIfMissing(database, 'WorkspaceKnowledgeSyncState', 'requestedRevision', 'requestedRevision INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(database, 'WorkspaceKnowledgeSyncState', 'startedRevision', 'startedRevision INTEGER')
  addColumnIfMissing(database, 'WorkspaceKnowledgeSyncState', 'syncedRevision', 'syncedRevision INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(database, 'WorkspaceKnowledgeSyncState', 'claimToken', 'claimToken TEXT')
  addColumnIfMissing(database, 'WorkspaceRuntimeState', 'localOutlinesJson', "localOutlinesJson TEXT NOT NULL DEFAULT '[]'")
  addColumnIfMissing(database, 'WorkspaceRuntimeState', 'localCharactersJson', "localCharactersJson TEXT NOT NULL DEFAULT '[]'")
  addColumnIfMissing(database, 'WorkspaceRuntimeState', 'localCharacterRelationsJson', "localCharacterRelationsJson TEXT NOT NULL DEFAULT '[]'")
  addColumnIfMissing(database, 'WorkspaceRuntimeState', 'localWorldEntriesJson', "localWorldEntriesJson TEXT NOT NULL DEFAULT '[]'")
  addColumnIfMissing(database, 'WorkspaceRuntimeState', 'localTimelineEventsJson', "localTimelineEventsJson TEXT NOT NULL DEFAULT '[]'")
  addColumnIfMissing(database, 'WorkspaceRuntimeState', 'revision', 'revision INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(database, 'WorkspaceState', 'revision', 'revision INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(database, 'WorkspaceStateBackup', 'revision', 'revision INTEGER NOT NULL DEFAULT 0')
  database.exec(`
    CREATE TABLE IF NOT EXISTS WorkspaceMutationReplay (
      workspaceStateId TEXT NOT NULL,
      idempotencyKey TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('chapter-patch','full-snapshot')),
      requestHash TEXT NOT NULL,
      committedRevision INTEGER NOT NULL CHECK(committedRevision >= 0),
      responseStatus INTEGER NOT NULL,
      responseJson TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(workspaceStateId,idempotencyKey),
      FOREIGN KEY(workspaceStateId) REFERENCES WorkspaceRuntimeState(id) ON DELETE CASCADE
    ) STRICT
  `)
  database.exec('CREATE INDEX IF NOT EXISTS idx_workspace_mutation_replay_created ON WorkspaceMutationReplay(workspaceStateId, createdAt)')
  database.exec(`
    CREATE TABLE IF NOT EXISTS WorkspaceChapterPatchJournal (
      workspaceStateId TEXT NOT NULL,
      committedRevision INTEGER NOT NULL CHECK(committedRevision > 0),
      chapterId TEXT NOT NULL,
      novelId TEXT NOT NULL,
      contentHtml TEXT NOT NULL,
      wordCount INTEGER NOT NULL CHECK(wordCount >= 0),
      updatedAtLabel TEXT NOT NULL,
      committedAt TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(workspaceStateId, committedRevision)
    ) STRICT
  `)
  database.exec('CREATE INDEX IF NOT EXISTS idx_workspace_patch_journal_revision ON WorkspaceChapterPatchJournal(workspaceStateId, committedRevision)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_workspace_knowledge_sync_requested ON WorkspaceKnowledgeSyncState(requestedSourceUpdatedAt, syncedSourceUpdatedAt)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_hanlp_bootstrap_cache_last_seen ON hanlp_bootstrap_cache(branch_id, last_seen_at)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_chapter_extraction_candidates_processing_batch ON chapter_extraction_candidates(branch_id, processing_batch_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_chapter_extraction_processing_batches_branch ON chapter_extraction_processing_batches(branch_id, updated_at)')
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_chapter_extraction_processing_batches_identity ON chapter_extraction_processing_batches(branch_id, batch_identity_hash)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_hanlp_bootstrap_results_lookup ON hanlp_bootstrap_results(branch_id, chapter_id, chapter_source_hash, result_kind)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_hanlp_bootstrap_results_job ON hanlp_bootstrap_results(knowledge_job_id, status)')
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_character_candidates_surface_text ON character_candidates(novel_id, branch_id, surface_text)')
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_character_candidate_chapters_chapter_no ON character_candidate_chapters(novel_id, branch_id, candidate_id, chapter_no)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_hanlp_bootstrap_entities_branch_type ON hanlp_bootstrap_entities(branch_id, entity_type, score)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_hanlp_bootstrap_entities_result_lookup ON hanlp_bootstrap_entities(source_result_id, branch_id, chapter_no)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_hanlp_bootstrap_coverage_novel ON hanlp_bootstrap_coverage(novel_id, valid_through_chapter_no)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_character_candidates_branch_status ON character_candidates(branch_id, status, last_seen_chapter)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_character_candidates_promotion_lookup ON character_candidates(branch_id, promoted_entity_id, promotion_summary_status, merged_entity_id, status, last_seen_chapter)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_character_candidate_chapters_candidate_count ON character_candidate_chapters(candidate_id, chapter_no)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_character_candidate_chapters_branch_chapter ON character_candidate_chapters(branch_id, chapter_no, candidate_id)')
  addColumnIfMissing(database, 'EntityAlias', 'createdAt', 'createdAt TEXT')
  addColumnIfMissing(database, 'EntityAlias', 'updatedAt', 'updatedAt TEXT')
  database.exec('UPDATE EntityAlias SET createdAt = CURRENT_TIMESTAMP WHERE createdAt IS NULL')
  database.exec('UPDATE EntityAlias SET updatedAt = CURRENT_TIMESTAMP WHERE updatedAt IS NULL')
  database.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_entity_branch_tier ON KnowledgeEntity(branchId, importanceTier) WHERE importanceTier IS NOT NULL')
  database.exec('CREATE INDEX IF NOT EXISTS idx_entity_alias_mapping_branch_alias ON EntityAliasMapping(branchId, alias)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_entity_alias_mapping_branch_entity ON EntityAliasMapping(branchId, entityId)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_entity_alias_conflict_branch_alias ON EntityAliasConflictLog(branchId, alias, createdAt)')
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
  addColumnIfMissing(database, 'story_timeline_nodes', 'continue_block_id', 'continue_block_id TEXT')
  addColumnIfMissing(database, 'story_timeline_nodes', 'readable_label', 'readable_label TEXT')
  addColumnIfMissing(database, 'story_timeline_nodes', 'readable_lineage_label', 'readable_lineage_label TEXT')
  addColumnIfMissing(database, 'story_timeline_nodes', 'roleplay_session_id', 'roleplay_session_id TEXT')
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_story_timeline_nodes_continue_block ON story_timeline_nodes(continue_block_id) WHERE continue_block_id IS NOT NULL')
  database.exec('CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_continue_block ON story_timeline_nodes(continue_block_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_session ON story_timeline_nodes(what_if_session_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_run ON story_timeline_nodes(future_jump_run_id)')
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_story_timeline_nodes_roleplay_session ON story_timeline_nodes(roleplay_session_id) WHERE roleplay_session_id IS NOT NULL')
  database.exec('CREATE INDEX IF NOT EXISTS idx_story_timeline_nodes_roleplay_session ON story_timeline_nodes(roleplay_session_id)')
  database.exec('CREATE TABLE IF NOT EXISTS continue_blocks (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, branch_id TEXT NOT NULL, parent_timeline_node_id TEXT, source_chapter_no INTEGER NOT NULL, title TEXT NOT NULL, subtitle TEXT, user_instruction TEXT NOT NULL, selected_text TEXT NOT NULL, original_text TEXT NOT NULL, latest_text TEXT NOT NULL, writing_skill_card_ids_json TEXT NOT NULL DEFAULT \'[]\', writing_skill_example_count INTEGER NOT NULL DEFAULT 5, latest_revision_no INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT \"active\", created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE, FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE, FOREIGN KEY (parent_timeline_node_id) REFERENCES story_timeline_nodes(id) ON DELETE SET NULL)')
  database.exec('CREATE TABLE IF NOT EXISTS continue_block_revisions (id TEXT PRIMARY KEY, continue_block_id TEXT NOT NULL, revision_no INTEGER NOT NULL, revision_kind TEXT NOT NULL, user_instruction TEXT NOT NULL, selected_text TEXT NOT NULL, original_text TEXT NOT NULL, generated_text TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (continue_block_id) REFERENCES continue_blocks(id) ON DELETE CASCADE, UNIQUE (continue_block_id, revision_no))')
  addColumnIfMissing(database, 'continue_blocks', 'latest_input_tokens', 'latest_input_tokens INTEGER')
  addColumnIfMissing(database, 'continue_blocks', 'latest_output_tokens', 'latest_output_tokens INTEGER')
  addColumnIfMissing(database, 'continue_blocks', 'writing_skill_card_ids_json', "writing_skill_card_ids_json TEXT NOT NULL DEFAULT '[]'")
  addColumnIfMissing(database, 'continue_blocks', 'writing_skill_example_count', 'writing_skill_example_count INTEGER NOT NULL DEFAULT 5')
  addColumnIfMissing(database, 'continue_block_revisions', 'input_tokens', 'input_tokens INTEGER')
  addColumnIfMissing(database, 'continue_block_revisions', 'output_tokens', 'output_tokens INTEGER')
  addColumnIfMissing(database, 'what_if_sessions', 'input_tokens', 'input_tokens INTEGER')
  addColumnIfMissing(database, 'what_if_sessions', 'output_tokens', 'output_tokens INTEGER')
  database.exec('CREATE INDEX IF NOT EXISTS idx_continue_blocks_branch_source ON continue_blocks(branch_id, source_chapter_no)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_continue_blocks_parent_node ON continue_blocks(parent_timeline_node_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_continue_block_revisions_block ON continue_block_revisions(continue_block_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_what_if_sessions_branch_source ON what_if_sessions(base_branch_id, source_chapter_no)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_what_if_deltas_session ON what_if_deltas(session_id)')
  database.exec('CREATE TABLE IF NOT EXISTS roleplay_sessions (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, branch_id TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, source_chapter_id TEXT, source_chapter_no INTEGER NOT NULL, source_chapter_title TEXT, source_timeline_node_id TEXT, source_timeline_node_type TEXT, source_selected_text TEXT NOT NULL, source_text_snapshot TEXT NOT NULL, source_selected_line_start INTEGER, source_selected_line_end INTEGER, status TEXT NOT NULL DEFAULT "active", created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (novel_id) REFERENCES NovelRecord(id) ON DELETE CASCADE, FOREIGN KEY (branch_id) REFERENCES StoryBranch(id) ON DELETE CASCADE, FOREIGN KEY (source_chapter_id) REFERENCES KnowledgeChapter(id) ON DELETE SET NULL, FOREIGN KEY (source_timeline_node_id) REFERENCES story_timeline_nodes(id) ON DELETE SET NULL)')
  database.exec('CREATE TABLE IF NOT EXISTS roleplay_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_index INTEGER NOT NULL, turn_index INTEGER NOT NULL, variant_index INTEGER NOT NULL DEFAULT 1, role TEXT NOT NULL, content TEXT NOT NULL, parent_message_id TEXT, forked_from_message_id TEXT, variant_group_id TEXT, status TEXT NOT NULL DEFAULT "active", created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (session_id) REFERENCES roleplay_sessions(id) ON DELETE CASCADE, FOREIGN KEY (parent_message_id) REFERENCES roleplay_messages(id) ON DELETE SET NULL, FOREIGN KEY (forked_from_message_id) REFERENCES roleplay_messages(id) ON DELETE SET NULL, UNIQUE (session_id, message_index), UNIQUE (session_id, turn_index, variant_index))')
  database.exec('CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_branch_source ON roleplay_sessions(branch_id, source_chapter_no)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_roleplay_sessions_source_node ON roleplay_sessions(source_timeline_node_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_roleplay_messages_session_order ON roleplay_messages(session_id, message_index)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_roleplay_messages_parent ON roleplay_messages(parent_message_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_roleplay_messages_fork ON roleplay_messages(forked_from_message_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_roleplay_messages_variant_group ON roleplay_messages(session_id, variant_group_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_outline_nodes_branch_track_sort ON outline_nodes(novel_id, branch_id, track_key, sort_order)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_outline_nodes_branch_chapter ON outline_nodes(novel_id, branch_id, chapter_no)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_outline_nodes_source_type ON outline_nodes(branch_id, source_type)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_outline_node_chapters_outline_primary_sort ON outline_node_chapters(outline_node_id, is_primary, sort_order)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_outline_node_chapters_chapter_anchor ON outline_node_chapters(chapter_no, chapter_id)')
  addColumnIfMissing(database, 'future_jump_runs', 'source_timeline_node_id', 'source_timeline_node_id TEXT')
  addColumnIfMissing(database, 'future_jump_runs', 'source_timeline_node_type', 'source_timeline_node_type TEXT')
  addColumnIfMissing(database, 'future_jump_runs', 'source_chapter_id', 'source_chapter_id TEXT')
  addColumnIfMissing(database, 'future_jump_runs', 'source_what_if_session_id', 'source_what_if_session_id TEXT')
  addColumnIfMissing(database, 'future_jump_runs', 'latest_input_tokens', 'latest_input_tokens INTEGER')
  addColumnIfMissing(database, 'future_jump_runs', 'latest_output_tokens', 'latest_output_tokens INTEGER')
  addColumnIfMissing(database, 'future_jump_revisions', 'input_tokens', 'input_tokens INTEGER')
  addColumnIfMissing(database, 'future_jump_revisions', 'output_tokens', 'output_tokens INTEGER')
  database.exec('CREATE INDEX IF NOT EXISTS idx_future_jump_runs_session ON future_jump_runs(session_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_future_jump_runs_parent_node ON future_jump_runs(parent_timeline_node_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_future_jump_runs_source_node ON future_jump_runs(source_timeline_node_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_future_jump_runs_source_chapter ON future_jump_runs(source_chapter_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_future_jump_runs_target_outline ON future_jump_runs(target_outline_node_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_future_jump_runs_target_outline_chapter ON future_jump_runs(target_outline_chapter_id)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_future_jump_runs_branch_target_chapter ON future_jump_runs(base_branch_id, target_chapter_no)')
  database.exec('CREATE INDEX IF NOT EXISTS idx_future_jump_revisions_run ON future_jump_revisions(run_id)')
}

let sqliteSingleton: DatabaseSync | undefined

function getSingletonDatabase(): DatabaseSync {
  if (globalForSqlite.sqlite && globalForSqlite.sqlite !== sqlite) {
    sqliteSingleton = globalForSqlite.sqlite
    return globalForSqlite.sqlite
  }

  if (!sqliteSingleton) {
    sqliteSingleton = createDatabase()
    if (process.env.NODE_ENV !== 'production') {
      globalForSqlite.sqlite = sqliteSingleton
    }
  }

  return sqliteSingleton
}

function createLazyDatabaseProxy(): DatabaseSync {
  return new Proxy({} as DatabaseSync, {
    get(_target, property, receiver) {
      const database = getSingletonDatabase()
      const value = Reflect.get(database as object, property, receiver)
      return typeof value === 'function' ? value.bind(database) : value
    },
    set(_target, property, value, receiver) {
      const database = getSingletonDatabase()
      return Reflect.set(database as object, property, value, receiver)
    },
    has(_target, property) {
      return property in getSingletonDatabase()
    },
    ownKeys() {
      return Reflect.ownKeys(getSingletonDatabase() as object)
    },
    getOwnPropertyDescriptor(_target, property) {
      return Object.getOwnPropertyDescriptor(getSingletonDatabase() as object, property)
    },
  })
}

export const sqlite = createLazyDatabaseProxy()

export function execute(sql: string, ...params: SqlParam[]) {
  assertDatabaseTransactionAccess(getSingletonDatabase())
  return runWithSqliteBusyRetry(() => sqlite.prepare(sql).run(...params))
}

export function queryOne<T>(sql: string, ...params: SqlParam[]) {
  assertDatabaseTransactionAccess(getSingletonDatabase())
  const row = runWithSqliteBusyRetry(() => sqlite.prepare(sql).get(...params))
  return (row ?? null) as T | null
}

export function queryAll<T>(sql: string, ...params: SqlParam[]) {
  assertDatabaseTransactionAccess(getSingletonDatabase())
  return runWithSqliteBusyRetry(() => sqlite.prepare(sql).all(...params)) as T[]
}

export function withTransaction<T>(callback: () => T | Promise<T>) {
  const database = getSingletonDatabase()
  const transactionKey = getDatabaseTransactionKey(database)
  return observeOutwardNestedTransaction(transactionKey, runSerializedDatabaseTransaction(
    transactionKey,
    (sql) => database.prepare(sql).run(),
    callback,
    () => beginSqliteTransaction(database),
  ))
}

export type { SqlParam }
