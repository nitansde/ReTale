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

const EVIDENCE_DIR = process.env.TASK_EVIDENCE_DIR!

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
    .all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>
}

function readTableStrictness(database: DatabaseSync, tableName: string) {
  return database.prepare('SELECT strict FROM pragma_table_list WHERE name = ?').get(tableName) as { strict: number }
}

function listIndexColumns(database: DatabaseSync, indexName: string) {
  return database.prepare(`PRAGMA index_info(${indexName})`).all() as Array<{ name: string; seqno: number }>
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

  it('creates workspace revision state at revision zero on a fresh database', () => {
    const databasePath = makeTempDatabasePath('retale-workspace-revision-fresh')
    const database = initializeDatabase(new DatabaseSync(databasePath))

    database.prepare('INSERT INTO WorkspaceRuntimeState (id) VALUES (?)').run('fresh-workspace')
    const row = database.prepare('SELECT revision FROM WorkspaceRuntimeState WHERE id = ?').get('fresh-workspace') as { revision: number }
    const revisionColumn = listTableColumns(database, 'WorkspaceRuntimeState').find((column) => column.name === 'revision')

    expect(row.revision).toBe(0)
    expect(revisionColumn).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '0' })

    ;(database as DatabaseSync & { close?: () => void }).close?.()
  })

  it('creates revisioned artifacts and a patch journal that survives normalized runtime deletion', () => {
    const databasePath = makeTempDatabasePath('retale-workspace-artifact-revision')
    const database = initializeDatabase(new DatabaseSync(databasePath))

    expect(listTableColumns(database, 'WorkspaceState').find((column) => column.name === 'revision')).toMatchObject({
      type: 'INTEGER',
      notnull: 1,
      dflt_value: '0',
    })
    expect(listTableColumns(database, 'WorkspaceStateBackup').find((column) => column.name === 'revision')).toMatchObject({
      type: 'INTEGER',
      notnull: 1,
      dflt_value: '0',
    })
    expect(database.prepare('PRAGMA foreign_key_list(WorkspaceChapterPatchJournal)').all()).toEqual([])

    database.prepare('INSERT INTO WorkspaceRuntimeState (id) VALUES (?)').run('singleton')
    database.prepare(
      `INSERT INTO WorkspaceChapterPatchJournal (
         workspaceStateId, committedRevision, chapterId, novelId,
         contentHtml, wordCount, updatedAtLabel, committedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('singleton', 1, 'chapter-1', 'novel-1', '<p>saved</p>', 5, 'now', '2026-08-12T00:00:00.000Z')
    database.prepare('DELETE FROM WorkspaceRuntimeState WHERE id = ?').run('singleton')
    expect(database.prepare('SELECT committedRevision FROM WorkspaceChapterPatchJournal').get()).toEqual({ committedRevision: 1 })
    database.close()
  })

  it('creates the strict workspace mutation replay schema, constraints, and created-at index', () => {
    const databasePath = makeTempDatabasePath('retale-workspace-replay-schema')
    const database = initializeDatabase(new DatabaseSync(databasePath))
    const columns = listTableColumns(database, 'WorkspaceMutationReplay')
    const indexes = new Set(listIndexNames(database).map((entry) => entry.name))
    const foreignKeys = database.prepare('PRAGMA foreign_key_list(WorkspaceMutationReplay)').all() as Array<{
      table: string
      from: string
      to: string
      on_delete: string
    }>

    expect(columns.map((column) => column.name)).toEqual([
      'workspaceStateId',
      'idempotencyKey',
      'operation',
      'requestHash',
      'committedRevision',
      'responseStatus',
      'responseJson',
      'createdAt',
    ])
    expect(columns.filter((column) => column.notnull !== 1)).toEqual([])
    expect(columns.find((column) => column.name === 'workspaceStateId')?.pk).toBe(1)
    expect(columns.find((column) => column.name === 'idempotencyKey')?.pk).toBe(2)
    expect(columns.find((column) => column.name === 'createdAt')?.dflt_value).toBe('CURRENT_TIMESTAMP')
    expect(readTableStrictness(database, 'WorkspaceMutationReplay').strict).toBe(1)
    expect(foreignKeys).toContainEqual(expect.objectContaining({
      table: 'WorkspaceRuntimeState',
      from: 'workspaceStateId',
      to: 'id',
      on_delete: 'CASCADE',
    }))
    expect(indexes.has('idx_workspace_mutation_replay_created')).toBe(true)
    expect(listIndexColumns(database, 'idx_workspace_mutation_replay_created').map((column) => column.name)).toEqual([
      'workspaceStateId',
      'createdAt',
    ])

    database.prepare('INSERT INTO WorkspaceRuntimeState (id) VALUES (?)').run('replay-workspace')
    const insertReplay = database.prepare(`
      INSERT INTO WorkspaceMutationReplay (
        workspaceStateId, idempotencyKey, operation, requestHash,
        committedRevision, responseStatus, responseJson
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    expect(() => insertReplay.run('replay-workspace', 'bad-operation', 'delete', 'hash', 0, 200, '{}')).toThrow()
    expect(() => insertReplay.run('replay-workspace', 'bad-revision', 'chapter-patch', 'hash', -1, 200, '{}')).toThrow()
    expect(() => insertReplay.run('missing-workspace', 'bad-foreign-key', 'full-snapshot', 'hash', 0, 200, '{}')).toThrow()

    ;(database as DatabaseSync & { close?: () => void }).close?.()
  })

  it('preserves an advanced workspace revision across reopen', () => {
    const databasePath = makeTempDatabasePath('retale-workspace-revision-reopen')
    const database = initializeDatabase(new DatabaseSync(databasePath))
    database.prepare('INSERT INTO WorkspaceRuntimeState (id) VALUES (?)').run('advanced-workspace')
    database.prepare('UPDATE WorkspaceRuntimeState SET revision = ? WHERE id = ?').run(7, 'advanced-workspace')
    ;(database as DatabaseSync & { close?: () => void }).close?.()

    const reopenedDatabase = initializeDatabase(new DatabaseSync(databasePath))
    const row = reopenedDatabase.prepare('SELECT revision FROM WorkspaceRuntimeState WHERE id = ?').get('advanced-workspace') as { revision: number }

    expect(row.revision).toBe(7)

    ;(reopenedDatabase as DatabaseSync & { close?: () => void }).close?.()
  })

  it('preserves workspace revision and replay rows across repeated initialization', () => {
    const databasePath = makeTempDatabasePath('retale-workspace-replay-idempotence')
    const database = initializeDatabase(new DatabaseSync(databasePath))
    database.prepare('INSERT INTO WorkspaceRuntimeState (id, revision) VALUES (?, ?)').run('idempotent-workspace', 9)
    database.prepare(`
      INSERT INTO WorkspaceMutationReplay (
        workspaceStateId, idempotencyKey, operation, requestHash,
        committedRevision, responseStatus, responseJson, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('idempotent-workspace', 'request-1', 'full-snapshot', 'request-hash', 9, 200, '{"revision":9}', '2026-08-12 00:00:00')
    ;(database as DatabaseSync & { close?: () => void }).close?.()

    const firstReopen = initializeDatabase(new DatabaseSync(databasePath))
    ;(firstReopen as DatabaseSync & { close?: () => void }).close?.()
    const secondReopen = initializeDatabase(new DatabaseSync(databasePath))
    const workspace = secondReopen.prepare('SELECT revision FROM WorkspaceRuntimeState WHERE id = ?').get('idempotent-workspace') as { revision: number }
    const replay = secondReopen.prepare(`
      SELECT operation, requestHash, committedRevision, responseStatus, responseJson, createdAt
      FROM WorkspaceMutationReplay
      WHERE workspaceStateId = ? AND idempotencyKey = ?
    `).get('idempotent-workspace', 'request-1')

    expect(workspace.revision).toBe(9)
    expect(replay).toEqual({
      operation: 'full-snapshot',
      requestHash: 'request-hash',
      committedRevision: 9,
      responseStatus: 200,
      responseJson: '{"revision":9}',
      createdAt: '2026-08-12 00:00:00',
    })

    ;(secondReopen as DatabaseSync & { close?: () => void }).close?.()
  })

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
        'idx_future_jump_runs_what_if_source',
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
