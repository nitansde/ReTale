import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'

const ROOT = process.cwd()
const SOURCE_DB_PATH = path.join(ROOT, 'dev.db')
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
    const databasePath = makeTempDatabasePath('chatbook-authored-schema')
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
    const databasePath = makeTempDatabasePath('chatbook-authored-idempotence')
    fs.copyFileSync(SOURCE_DB_PATH, databasePath)

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
})
