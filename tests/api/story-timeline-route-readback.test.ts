import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }
const originalDatabaseUrl = process.env.DATABASE_URL
const originalDataDir = process.env.RETALE_DATA_DIR

function restoreEnvVar(name: 'DATABASE_URL' | 'RETALE_DATA_DIR', originalValue: string | undefined) {
  if (originalValue === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = originalValue
}

function seedNovel(database: DatabaseSync) {
  database.prepare('INSERT INTO NovelRecord (id, title, author, sourceType) VALUES (?, ?, ?, ?)').run('novel-001', 'Fixture Novel', 'Fixture Author', 'txt')
  database.prepare('INSERT INTO StoryBranch (id, novelId, name, baseBranchId) VALUES (?, ?, ?, ?)').run('novel-001:main', 'novel-001', 'main', null)
  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-10', 'novel-001', 'novel-001:main', 10, '第10章', '中性章节正文', '中性章节摘要', 1, 0, null, 'hash-10', 'ready')
}

async function createSplitBrainDatabases(prefix: string) {
  const singletonDatabase = createTempDatabaseCopy(`${prefix}-singleton`)
  cleanups.push(singletonDatabase.cleanup)

  const tempDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-data-`))
  cleanups.push(() => fs.rmSync(tempDataRoot, { recursive: true, force: true }))

  const runtimeDataRoot = path.join(tempDataRoot, 'data')
  const novelDbPath = path.join(runtimeDataRoot, 'novels', 'novel-001', 'novel.db')
  fs.mkdirSync(path.dirname(novelDbPath), { recursive: true })
  fs.copyFileSync(singletonDatabase.dbPath, novelDbPath)

  process.env.DATABASE_URL = singletonDatabase.dbPath
  process.env.RETALE_DATA_DIR = runtimeDataRoot
  vi.resetModules()

  const sqliteModule = await import('@/lib/server/sqlite')
  globalForSqlite.sqlite = sqliteModule.sqlite
  const resolverModule = await import('@/lib/server/db-resolver')
  const novelDatabase = resolverModule.getNovelDb('novel-001')

  return {
    singletonDatabase: sqliteModule.sqlite,
    novelDatabase,
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules()

  if (globalForSqlite.sqlite) {
    try {
      ;(globalForSqlite.sqlite as DatabaseSync & { close?: () => void }).close?.()
    } catch (closeError) {
      void closeError
    }
    delete globalForSqlite.sqlite
  }

  restoreEnvVar('DATABASE_URL', originalDatabaseUrl)
  restoreEnvVar('RETALE_DATA_DIR', originalDataDir)

  try {
    const resolverModule = await import('@/lib/server/db-resolver')
    resolverModule.resetResolvedDatabasesForTests()
  } catch (resetError) {
    void resetError
  }

  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('/api/story-timeline per-novel readback', () => {
  it('returns a timeline node stored only in the per-novel database when the singleton database is empty', async () => {
    const { singletonDatabase, novelDatabase } = await createSplitBrainDatabases('retale-story-timeline-route-readback')
    seedNovel(novelDatabase)

    novelDatabase.prepare(
      `INSERT INTO continue_blocks (
        id, novel_id, branch_id, parent_timeline_node_id, source_chapter_no, title, subtitle,
        user_instruction, selected_text, original_text, latest_text, latest_revision_no, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'continue-block-001',
      'novel-001',
      'novel-001:main',
      null,
      10,
      'RE-01 中性改写块',
      '中性副标题',
      '保存中性版本',
      '中性选区',
      '中性原文',
      '中性改写结果',
      1,
      'active'
    )

    novelDatabase.prepare(
      `INSERT INTO story_timeline_nodes (
        id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
        parent_node_id, source_chapter_no, target_chapter_no, chapter_id, continue_block_id,
        what_if_session_id, future_jump_run_id, lane_index, color_token, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'timeline-node-001',
      'novel-001',
      'novel-001:main',
      'rewrite',
      1,
      10,
      'RE-01 中性改写块',
      '中性副标题',
      null,
      10,
      null,
      null,
      'continue-block-001',
      null,
      null,
      0,
      'fuchsia',
      'active'
    )

    expect(singletonDatabase.prepare('SELECT COUNT(*) AS count FROM story_timeline_nodes').get()).toMatchObject({ count: 0 })
    expect(novelDatabase.prepare('SELECT COUNT(*) AS count FROM story_timeline_nodes').get()).toMatchObject({ count: 1 })

    const { GET } = await import('@/app/api/story-timeline/route')
    const response = await GET(
      new Request('http://localhost/api/story-timeline?novelId=novel-001&branchId=novel-001:main')
    )

    expect(response.status).toBe(200)
    const payload = await response.json() as {
      branchId: string
      branchNodes: Array<{ id: string; continueBlockId: string | null; anchorChapterNo: number; latestText: string | null }>
    }

    expect(payload.branchId).toBe('novel-001:main')
    expect(payload.branchNodes).toEqual([
      expect.objectContaining({
        id: 'timeline-node-001',
        continueBlockId: 'continue-block-001',
        anchorChapterNo: 10,
        latestText: '中性改写结果',
      }),
    ])
  })

  it('deletes a timeline node from the per-novel database within the requested branch context', async () => {
    const { singletonDatabase, novelDatabase } = await createSplitBrainDatabases('retale-story-timeline-route-delete')
    seedNovel(novelDatabase)

    novelDatabase.prepare(
      `INSERT INTO story_timeline_nodes (
        id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
        parent_node_id, source_chapter_no, target_chapter_no, chapter_id, continue_block_id,
        what_if_session_id, future_jump_run_id, lane_index, color_token, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'timeline-node-delete-001',
      'novel-001',
      'novel-001:main',
      'rewrite',
      1,
      10,
      'RE-01 中性改写块',
      '中性副标题',
      null,
      10,
      null,
      null,
      null,
      null,
      null,
      0,
      'fuchsia',
      'active'
    )

    expect(singletonDatabase.prepare('SELECT COUNT(*) AS count FROM story_timeline_nodes').get()).toMatchObject({ count: 0 })
    expect(novelDatabase.prepare('SELECT COUNT(*) AS count FROM story_timeline_nodes').get()).toMatchObject({ count: 1 })

    const { DELETE } = await import('@/app/api/story-timeline/route')
    const response = await DELETE(
      new Request('http://localhost/api/story-timeline?novelId=novel-001&branchId=novel-001:main', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: 'timeline-node-delete-001' }),
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, nodeId: 'timeline-node-delete-001' })
    expect(novelDatabase.prepare('SELECT COUNT(*) AS count FROM story_timeline_nodes WHERE id = ?').get('timeline-node-delete-001')).toMatchObject({ count: 0 })
    expect(singletonDatabase.prepare('SELECT COUNT(*) AS count FROM story_timeline_nodes').get()).toMatchObject({ count: 0 })
  })
})
