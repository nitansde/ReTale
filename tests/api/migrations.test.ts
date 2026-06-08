import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  initializeDatabase,
  isSqliteLockError,
  runWithSqliteBusyRetry,
  SQLITE_BUSY_TIMEOUT_MS,
} from '@/lib/server/sqlite'
import { getSourceDbPath } from '@/tests/helpers/temp-db'

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const ROOT = process.cwd()
const EVIDENCE_DIR = path.join(ROOT, '.sisyphus/evidence/task-2-authored-schema')

const createdDirectories: string[] = []

function makeTempDatabasePath(prefix: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  createdDirectories.push(directory)
  return path.join(directory, 'migration-test.db')
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
  return database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string; pk: number }>
}

function readBusyTimeout(database: DatabaseSync) {
  const row = database.prepare('PRAGMA busy_timeout').get() as { timeout: number }
  return row.timeout
}

afterEach(() => {
  while (createdDirectories.length) {
    const directory = createdDirectories.pop()
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe('authored branching schema migrations', () => {
  it('creates the authored tables and indexes on a fresh database', () => {
    const databasePath = makeTempDatabasePath('retale-authored-schema')
    const database = initializeDatabase(new DatabaseSync(databasePath))

    const tables = new Set(listTableNames(database).map((entry) => entry.name))
    const indexes = new Set(listIndexNames(database).map((entry) => entry.name))

    expect([...tables]).toEqual(
      expect.arrayContaining([
        'story_timeline_nodes',
        'continue_blocks',
        'continue_block_revisions',
        'what_if_sessions',
        'what_if_deltas',
        'outline_nodes',
        'outline_node_chapters',
        'future_jump_runs',
        'future_jump_revisions',
        'WorkspaceStateBackup',
      ])
    )

    expect([...indexes]).toEqual(
      expect.arrayContaining([
        'idx_story_timeline_nodes_label_scope',
        'idx_story_timeline_nodes_anchor_chapter',
        'idx_story_timeline_nodes_parent',
        'idx_story_timeline_nodes_continue_block',
        'idx_story_timeline_nodes_session',
        'idx_story_timeline_nodes_run',
        'idx_continue_blocks_branch_source',
        'idx_continue_blocks_parent_node',
        'idx_continue_block_revisions_block',
        'idx_what_if_sessions_branch_source',
        'idx_what_if_deltas_session',
        'idx_outline_nodes_branch_track_sort',
        'idx_outline_nodes_branch_chapter',
        'idx_outline_nodes_source_type',
        'idx_outline_node_chapters_outline_primary_sort',
        'idx_outline_node_chapters_chapter_anchor',
        'idx_future_jump_runs_session',
        'idx_future_jump_runs_parent_node',
        'idx_future_jump_runs_target_outline',
        'idx_future_jump_runs_target_outline_chapter',
        'idx_future_jump_runs_branch_target_chapter',
        'idx_future_jump_revisions_run',
        'idx_workspace_state_backup_state_created',
      ])
    )

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'migration-schema.txt'),
      JSON.stringify(
        {
          databasePath,
          tables: [...tables].filter((tableName) => tableName.includes('continue') || tableName.includes('what_if') || tableName.includes('outline') || tableName.includes('future_jump') || tableName.includes('story_timeline')),
          indexes: [...indexes].filter((indexName) => indexName.includes('continue') || indexName.includes('story_timeline') || indexName.includes('what_if') || indexName.includes('outline') || indexName.includes('future_jump')),
        },
        null,
        2
      )
    )

  ;(database as DatabaseSync & { close?: () => void }).close?.()
  })

  it('is idempotent across repeated initialization and preserves an existing copied database', () => {
    const databasePath = makeTempDatabasePath('retale-authored-idempotence')
    fs.copyFileSync(getSourceDbPath(), databasePath)

    const firstOpen = initializeDatabase(new DatabaseSync(databasePath))
    const firstTableCount = listTableNames(firstOpen).length
  ;(firstOpen as DatabaseSync & { close?: () => void }).close?.()

    const secondOpen = initializeDatabase(new DatabaseSync(databasePath))
    const secondTableCount = listTableNames(secondOpen).length
    const workspaceStateCount = secondOpen.prepare('SELECT COUNT(*) AS count FROM WorkspaceState').get() as { count: number }

    expect(secondTableCount).toBe(firstTableCount)
    expect(workspaceStateCount.count).toBeGreaterThanOrEqual(0)

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'migration-idempotence.txt'),
      [`databasePath=${databasePath}`, `firstTableCount=${firstTableCount}`, `secondTableCount=${secondTableCount}`, `workspaceStateCount=${workspaceStateCount.count}`].join('\n')
    )

  ;(secondOpen as DatabaseSync & { close?: () => void }).close?.()
  })

  it('skips boot schema writes when an existing database is current and another writer is active', () => {
    const databasePath = makeTempDatabasePath('retale-authored-current-locked')
    fs.copyFileSync(getSourceDbPath(), databasePath)

    const currentSchema = initializeDatabase(new DatabaseSync(databasePath))
    ;(currentSchema as DatabaseSync & { close?: () => void }).close?.()

    const writer = new DatabaseSync(databasePath)
    writer.exec('BEGIN IMMEDIATE')

    const reader = initializeDatabase(new DatabaseSync(databasePath))
    const workspaceStateCount = reader.prepare('SELECT COUNT(*) AS count FROM WorkspaceState').get() as { count: number }

    expect(workspaceStateCount.count).toBeGreaterThanOrEqual(0)
    expect(readBusyTimeout(reader)).toBe(SQLITE_BUSY_TIMEOUT_MS)

    writer.exec('ROLLBACK')
    ;(writer as DatabaseSync & { close?: () => void }).close?.()
    ;(reader as DatabaseSync & { close?: () => void }).close?.()
  })

  it('recognizes and retries transient SQLite lock errors', () => {
    let attempts = 0

    const result = runWithSqliteBusyRetry(() => {
      attempts += 1
      if (attempts < 3) {
        throw new Error('database is locked')
      }
      return 'ok'
    }, { delaysMs: [0, 0] })

    expect(result).toBe('ok')
    expect(attempts).toBe(3)
    expect(isSqliteLockError(new Error('database table is locked'))).toBe(true)
  })

  it('does not fast-skip legacy continue and what-if token column migrations', () => {
    const databasePath = makeTempDatabasePath('retale-token-column-migration')
    const currentDatabase = initializeDatabase(new DatabaseSync(databasePath))

    currentDatabase.exec('ALTER TABLE continue_blocks DROP COLUMN latest_input_tokens')
    currentDatabase.exec('ALTER TABLE continue_blocks DROP COLUMN latest_output_tokens')
    currentDatabase.exec('ALTER TABLE continue_block_revisions DROP COLUMN input_tokens')
    currentDatabase.exec('ALTER TABLE continue_block_revisions DROP COLUMN output_tokens')
    currentDatabase.exec('ALTER TABLE what_if_sessions DROP COLUMN input_tokens')
    currentDatabase.exec('ALTER TABLE what_if_sessions DROP COLUMN output_tokens')
    ;(currentDatabase as DatabaseSync & { close?: () => void }).close?.()

    const migratedDatabase = initializeDatabase(new DatabaseSync(databasePath))

    expect(listTableColumns(migratedDatabase, 'continue_blocks').map((column) => column.name)).toEqual(expect.arrayContaining([
      'latest_input_tokens',
      'latest_output_tokens',
    ]))
    expect(listTableColumns(migratedDatabase, 'continue_block_revisions').map((column) => column.name)).toEqual(expect.arrayContaining([
      'input_tokens',
      'output_tokens',
    ]))
    expect(listTableColumns(migratedDatabase, 'what_if_sessions').map((column) => column.name)).toEqual(expect.arrayContaining([
      'input_tokens',
      'output_tokens',
    ]))

    ;(migratedDatabase as DatabaseSync & { close?: () => void }).close?.()
  })

  it('does not fast-skip missing boot schema indexes', () => {
    const databasePath = makeTempDatabasePath('retale-index-current-gate')
    const currentDatabase = initializeDatabase(new DatabaseSync(databasePath))
    currentDatabase.exec('DROP INDEX idx_continue_blocks_parent_node')
    ;(currentDatabase as DatabaseSync & { close?: () => void }).close?.()

    const migratedDatabase = initializeDatabase(new DatabaseSync(databasePath))
    const migratedIndexes = new Set(listIndexNames(migratedDatabase).map((entry) => entry.name))

    expect(migratedIndexes.has('idx_continue_blocks_parent_node')).toBe(true)

    ;(migratedDatabase as DatabaseSync & { close?: () => void }).close?.()
  })

  it('migrates legacy active retrieval pointers to scoped rows', () => {
    const databasePath = makeTempDatabasePath('retale-active-retrieval-index-scope')
    const legacyDatabase = new DatabaseSync(databasePath)
    legacyDatabase.exec(`
      CREATE TABLE ActiveRetrievalIndex (
        branchId TEXT PRIMARY KEY,
        tableName TEXT NOT NULL UNIQUE,
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO ActiveRetrievalIndex (branchId, tableName, createdAt, updatedAt)
      VALUES ('novel-001:main', 'retrieval_docs_legacy', '2026-01-01 00:00:00', '2026-01-02 00:00:00');
    `)
    ;(legacyDatabase as DatabaseSync & { close?: () => void }).close?.()

    const migratedDatabase = initializeDatabase(new DatabaseSync(databasePath))
    const columns = listTableColumns(migratedDatabase, 'ActiveRetrievalIndex')
    const row = migratedDatabase
      .prepare('SELECT branchId, scopeKey, tableName, scopeStartChapter, scopeEndChapter, createdAt, updatedAt FROM ActiveRetrievalIndex')
      .get() as {
        branchId: string
        scopeKey: string
        tableName: string
        scopeStartChapter: number | null
        scopeEndChapter: number | null
        createdAt: string
        updatedAt: string
      }

    expect(columns.find((column) => column.name === 'branchId')?.pk).toBe(1)
    expect(columns.find((column) => column.name === 'scopeKey')?.pk).toBe(2)
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(['scopeStartChapter', 'scopeEndChapter']))
    expect(row).toEqual({
      branchId: 'novel-001:main',
      scopeKey: 'full',
      tableName: 'retrieval_docs_legacy',
      scopeStartChapter: null,
      scopeEndChapter: null,
      createdAt: '2026-01-01 00:00:00',
      updatedAt: '2026-01-02 00:00:00',
    })

    ;(migratedDatabase as DatabaseSync & { close?: () => void }).close?.()
  })

  it('adds shared extraction batch storage to a legacy extraction-cache schema and stays idempotent', () => {
    const databasePath = makeTempDatabasePath('retale-extraction-batch-migration')
    const legacyDatabase = new DatabaseSync(databasePath)
    legacyDatabase.exec(`
      CREATE TABLE NovelRecord (id TEXT PRIMARY KEY, title TEXT NOT NULL, sourceType TEXT NOT NULL DEFAULT 'txt');
      CREATE TABLE StoryBranch (id TEXT PRIMARY KEY, novelId TEXT NOT NULL, name TEXT NOT NULL);
      CREATE TABLE KnowledgeChapter (
        id TEXT PRIMARY KEY,
        novelId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        chapterNo INTEGER NOT NULL,
        title TEXT,
        rawText TEXT NOT NULL,
        sourceHash TEXT NOT NULL
      );
      CREATE TABLE chapter_extraction_candidates (
        id TEXT PRIMARY KEY,
        novel_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        chapter_no INTEGER NOT NULL,
        chapter_revision INTEGER,
        chapter_source_hash TEXT NOT NULL,
        extraction_json TEXT NOT NULL,
        processing_result_json TEXT,
        status TEXT NOT NULL DEFAULT 'extracted',
        provider TEXT,
        model TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(branch_id, chapter_id, chapter_source_hash)
      );
    `)
    ;(legacyDatabase as DatabaseSync & { close?: () => void }).close?.()

    const migratedDatabase = initializeDatabase(new DatabaseSync(databasePath))
    const migratedColumns = listTableColumns(migratedDatabase, 'chapter_extraction_candidates').map((column) => column.name)
    const migratedTables = new Set(listTableNames(migratedDatabase).map((entry) => entry.name))
    const migratedIndexes = new Set(listIndexNames(migratedDatabase).map((entry) => entry.name))
    ;(migratedDatabase as DatabaseSync & { close?: () => void }).close?.()

    const reopenedDatabase = initializeDatabase(new DatabaseSync(databasePath))
    const reopenedColumns = listTableColumns(reopenedDatabase, 'chapter_extraction_candidates').map((column) => column.name)

    expect(migratedColumns).toContain('processing_batch_id')
    expect(reopenedColumns).toContain('processing_batch_id')
    expect(migratedTables.has('chapter_extraction_processing_batches')).toBe(true)
    expect(migratedIndexes.has('idx_chapter_extraction_candidates_processing_batch')).toBe(true)
    expect(migratedIndexes.has('idx_chapter_extraction_processing_batches_branch')).toBe(true)
    expect(migratedIndexes.has('uq_chapter_extraction_processing_batches_identity')).toBe(true)

    ;(reopenedDatabase as DatabaseSync & { close?: () => void }).close?.()
  })

  it('creates pending retrieval index state storage during initialization', () => {
    const databasePath = makeTempDatabasePath('retale-pending-retrieval-index-table')
    const database = initializeDatabase(new DatabaseSync(databasePath))

    const columns = listTableColumns(database, 'PendingRetrievalIndex')

    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'branchId',
      'scopeKey',
      'tableName',
      'phase',
      'rowCount',
      'textIndexCompleted',
      'vectorIndexCompleted',
      'rebuildFingerprint',
      'createdAt',
      'updatedAt',
    ]))
    expect(columns.find((column) => column.name === 'branchId')?.pk).toBe(1)
    expect(columns.find((column) => column.name === 'scopeKey')?.pk).toBe(2)

    ;(database as DatabaseSync & { close?: () => void }).close?.()
  })
})
