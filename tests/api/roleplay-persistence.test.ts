import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'

const ROOT = process.cwd()
const EVIDENCE_DIR = path.join(ROOT, '.sisyphus/evidence')
const createdDirectories: string[] = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }

const FIXTURE_IDS = {
  novelId: 'novel-roleplay-001',
  branchId: 'novel-roleplay-001:main',
  chapterId: 'chapter-roleplay-12',
  continueBlockId: 'continue-roleplay-12',
  rewriteTimelineNodeId: 'timeline-rewrite-roleplay-12',
  whatIfSessionId: 'what-if-roleplay-12',
  outlineNodeId: 'outline-roleplay-100',
  outlineChapterId: 'outline-roleplay-100-primary',
  futureJumpRunId: 'jump-roleplay-100',
} as const

function makeTempDatabasePath(prefix: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  createdDirectories.push(directory)
  return path.join(directory, 'roleplay-persistence.db')
}

function listTableNames(database: DatabaseSync) {
  return database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC").all() as Array<{ name: string }>
}

function listIndexNames(database: DatabaseSync) {
  return database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name ASC").all() as Array<{ name: string }>
}

function listColumnNames(database: DatabaseSync, tableName: string) {
  return (database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map((column) => column.name)
}

function seedPersistenceFixture(database: DatabaseSync) {
  database.prepare('INSERT INTO NovelRecord (id, title, author, sourceType) VALUES (?, ?, ?, ?)').run(
    FIXTURE_IDS.novelId,
    'Roleplay Fixture Novel',
    'Fixture Author',
    'txt'
  )
  database.prepare('INSERT INTO StoryBranch (id, novelId, name, baseBranchId) VALUES (?, ?, ?, ?)').run(
    FIXTURE_IDS.branchId,
    FIXTURE_IDS.novelId,
    'main',
    null
  )
  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    FIXTURE_IDS.chapterId,
    FIXTURE_IDS.novelId,
    FIXTURE_IDS.branchId,
    12,
    '第12章 夜谈',
    '原始正文：他在窗边停住，迟迟没有开口。',
    '夜谈摘要',
    1,
    0,
    null,
    'chapter-roleplay-12-hash',
    'ready'
  )
  database.prepare(
    `INSERT INTO continue_blocks (
      id, novel_id, branch_id, parent_timeline_node_id, source_chapter_no, title, subtitle,
      user_instruction, selected_text, original_text, latest_text, latest_revision_no, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    FIXTURE_IDS.continueBlockId,
    FIXTURE_IDS.novelId,
    FIXTURE_IDS.branchId,
    null,
    12,
    'RE-01 夜谈延伸',
    null,
    '让对话更压抑。',
    '他在窗边停住，迟迟没有开口。',
    '原始正文：他在窗边停住，迟迟没有开口。',
    'rewrite 正文：风吹动了窗纸，他还是没有转身。',
    1,
    'active'
  )
  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, continue_block_id,
      what_if_session_id, future_jump_run_id, roleplay_session_id, readable_label,
      readable_lineage_label, lane_index, color_token, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    FIXTURE_IDS.rewriteTimelineNodeId,
    FIXTURE_IDS.novelId,
    FIXTURE_IDS.branchId,
    'rewrite',
    1,
    12,
    'RE-01 夜谈延伸',
    null,
    null,
    12,
    null,
    FIXTURE_IDS.chapterId,
    FIXTURE_IDS.continueBlockId,
    null,
    null,
    null,
    'RE-01',
    'RE-01',
    0,
    'sky',
    'active'
  )
  database.prepare(
    `INSERT INTO what_if_sessions (
      id, novel_id, base_branch_id, source_chapter_no, title, premise,
      selected_text, original_text, generated_text, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    FIXTURE_IDS.whatIfSessionId,
    FIXTURE_IDS.novelId,
    FIXTURE_IDS.branchId,
    12,
    'IF-01 先开口',
    '如果她先一步摊牌。',
    '他在窗边停住，迟迟没有开口。',
    '原始正文：他在窗边停住，迟迟没有开口。',
    'what-if 正文：她抢先打破了沉默。',
    'active'
  )
  database.prepare(
    `INSERT INTO outline_nodes (
      id, novel_id, branch_id, chapter_no, title, summary, original_outcome,
      track_key, phase_label, source_type, confidence, involved_entities_json, key_events_json, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    FIXTURE_IDS.outlineNodeId,
    FIXTURE_IDS.novelId,
    FIXTURE_IDS.branchId,
    100,
    '第100章 迟到的真相',
    '真相在更晚的章节才揭开。',
    '原线中双方继续试探。',
    'phase-4',
    '第四阶段',
    'authored',
    1,
    '["他","她"]',
    '["真相揭晓"]',
    100
  )
  database.prepare(
    `INSERT INTO outline_node_chapters (
      id, outline_node_id, chapter_no, chapter_id, chapter_title, is_primary, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    FIXTURE_IDS.outlineChapterId,
    FIXTURE_IDS.outlineNodeId,
    100,
    null,
    '第100章 迟到的真相',
    1,
    0
  )
  database.prepare(
    `INSERT INTO future_jump_runs (
      id, session_id, base_branch_id, parent_timeline_node_id, target_outline_node_id,
      target_outline_chapter_id, source_chapter_no, target_chapter_no, user_direction,
      bridge_summary, generated_target_text, latest_revision_no, error_message, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    FIXTURE_IDS.futureJumpRunId,
    FIXTURE_IDS.whatIfSessionId,
    FIXTURE_IDS.branchId,
    FIXTURE_IDS.rewriteTimelineNodeId,
    FIXTURE_IDS.outlineNodeId,
    FIXTURE_IDS.outlineChapterId,
    12,
    100,
    '让真相在未来章节才爆发。',
    '未来桥接摘要',
    'future-jump 正文：他把真相拖到了更晚的时候。',
    2,
    null,
    'generated'
  )
  database.prepare(
    `INSERT INTO future_jump_revisions (
      id, run_id, revision_no, revision_kind, user_feedback, bridge_summary, generated_target_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'future-jump-revision-001',
    FIXTURE_IDS.futureJumpRunId,
    1,
    'initial',
    null,
    '未来桥接摘要',
    'future-jump 正文：他把真相拖到了更晚的时候。'
  )
  database.prepare(
    `INSERT INTO future_jump_revisions (
      id, run_id, revision_no, revision_kind, user_feedback, bridge_summary, generated_target_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'future-jump-revision-002',
    FIXTURE_IDS.futureJumpRunId,
    2,
    'revise',
    '让悬念更久一点。',
    '新的未来桥接摘要',
    'future-jump 正文：他把真相压得更久。'
  )
}

function snapshotNonRoleplayState(database: DatabaseSync) {
  return {
    chapterText: (database.prepare('SELECT rawText FROM KnowledgeChapter WHERE id = ?').get(FIXTURE_IDS.chapterId) as { rawText: string }).rawText,
    continueBlocks: database.prepare(
      'SELECT id, latest_text, latest_revision_no, status FROM continue_blocks ORDER BY id ASC'
    ).all() as Array<{ id: string; latest_text: string; latest_revision_no: number; status: string }>,
    whatIfSessions: database.prepare(
      'SELECT id, generated_text, status FROM what_if_sessions ORDER BY id ASC'
    ).all() as Array<{ id: string; generated_text: string; status: string }>,
    futureJumpRuns: database.prepare(
      'SELECT id, generated_target_text, latest_revision_no, status FROM future_jump_runs ORDER BY id ASC'
    ).all() as Array<{ id: string; generated_target_text: string; latest_revision_no: number; status: string }>,
    futureJumpRevisions: database.prepare(
      'SELECT run_id, revision_no, revision_kind, bridge_summary, generated_target_text FROM future_jump_revisions ORDER BY run_id ASC, revision_no ASC'
    ).all() as Array<{
      run_id: string
      revision_no: number
      revision_kind: string
      bridge_summary: string
      generated_target_text: string
    }>,
  }
}

function createLegacyDatabaseWithoutRoleplay(databasePath: string) {
  const database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE story_timeline_nodes (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      node_type TEXT NOT NULL,
      label_index INTEGER NOT NULL,
      anchor_chapter_no INTEGER NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      parent_node_id TEXT,
      source_chapter_no INTEGER,
      target_chapter_no INTEGER,
      chapter_id TEXT,
      continue_block_id TEXT,
      what_if_session_id TEXT,
      future_jump_run_id TEXT,
      readable_label TEXT,
      readable_lineage_label TEXT,
      lane_index INTEGER DEFAULT 0,
      color_token TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (novel_id, branch_id, node_type, label_index),
      UNIQUE (continue_block_id),
      UNIQUE (what_if_session_id),
      UNIQUE (future_jump_run_id)
    );
    CREATE TABLE continue_blocks (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      parent_timeline_node_id TEXT,
      source_chapter_no INTEGER NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      user_instruction TEXT NOT NULL,
      selected_text TEXT NOT NULL,
      original_text TEXT NOT NULL,
      latest_text TEXT NOT NULL,
      latest_revision_no INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      latest_input_tokens INTEGER,
      latest_output_tokens INTEGER
    );
    CREATE TABLE what_if_sessions (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      base_branch_id TEXT NOT NULL,
      source_chapter_no INTEGER NOT NULL,
      title TEXT NOT NULL,
      premise TEXT NOT NULL,
      selected_text TEXT NOT NULL,
      original_text TEXT NOT NULL,
      generated_text TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE future_jump_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      base_branch_id TEXT NOT NULL,
      parent_timeline_node_id TEXT,
      source_timeline_node_id TEXT,
      source_timeline_node_type TEXT,
      source_chapter_id TEXT,
      source_what_if_session_id TEXT,
      target_outline_node_id TEXT NOT NULL,
      target_outline_chapter_id TEXT NOT NULL,
      source_chapter_no INTEGER NOT NULL,
      target_chapter_no INTEGER NOT NULL,
      user_direction TEXT NOT NULL DEFAULT '',
      bridge_summary TEXT NOT NULL,
      generated_target_text TEXT NOT NULL,
      latest_input_tokens INTEGER,
      latest_output_tokens INTEGER,
      latest_revision_no INTEGER NOT NULL DEFAULT 1,
      error_message TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE future_jump_revisions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      revision_no INTEGER NOT NULL,
      revision_kind TEXT NOT NULL,
      user_feedback TEXT,
      bridge_summary TEXT NOT NULL,
      generated_target_text TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (run_id, revision_no)
    );
    CREATE INDEX idx_continue_blocks_branch_source ON continue_blocks(branch_id, source_chapter_no);
    CREATE INDEX idx_continue_blocks_parent_node ON continue_blocks(parent_timeline_node_id);
    CREATE INDEX idx_what_if_sessions_branch_source ON what_if_sessions(base_branch_id, source_chapter_no);
    CREATE INDEX idx_future_jump_runs_session ON future_jump_runs(session_id);
    CREATE INDEX idx_future_jump_runs_parent_node ON future_jump_runs(parent_timeline_node_id);
    CREATE INDEX idx_future_jump_runs_source_node ON future_jump_runs(source_timeline_node_id);
    CREATE INDEX idx_future_jump_runs_source_chapter ON future_jump_runs(source_chapter_id);
    CREATE INDEX idx_future_jump_runs_target_outline ON future_jump_runs(target_outline_node_id);
    CREATE INDEX idx_future_jump_runs_target_outline_chapter ON future_jump_runs(target_outline_chapter_id);
    CREATE INDEX idx_future_jump_runs_branch_target_chapter ON future_jump_runs(base_branch_id, target_chapter_no);
    CREATE INDEX idx_future_jump_revisions_run ON future_jump_revisions(run_id);
  `)
  ;(database as DatabaseSync & { close?: () => void }).close?.()
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()

  if (globalForSqlite.sqlite) {
    try {
      ;(globalForSqlite.sqlite as DatabaseSync & { close?: () => void }).close?.()
    } catch {
    }
    delete globalForSqlite.sqlite
  }

  while (createdDirectories.length) {
    const directory = createdDirectories.pop()
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe('roleplay persistence schema', () => {
  it('creates dedicated roleplay tables and preserves ordered fork and variant invariants without mutating non-roleplay state', async () => {
    const databasePath = makeTempDatabasePath('chatbook-roleplay-persistence-contract')
    const database = initializeDatabase(new DatabaseSync(databasePath))
    globalForSqlite.sqlite = database
    seedPersistenceFixture(database)
    vi.resetModules()

    const { createRoleplayLatestTurnVariant, createRoleplaySession, appendRoleplayMessage, findRoleplaySessionById } = await import('@/lib/server/roleplay-store')

    const beforeIsolation = snapshotNonRoleplayState(database)

    const { session, timelineNodeId } = await createRoleplaySession({
      id: 'roleplay-session-001',
      novelId: FIXTURE_IDS.novelId,
      branchId: FIXTURE_IDS.branchId,
      title: 'RP-入口 夜谈分支',
      subtitle: '从 rewrite 节点进入对话',
      sourceChapterId: FIXTURE_IDS.chapterId,
      sourceChapterNo: 12,
      sourceChapterTitle: '第12章 夜谈',
      sourceTimelineNodeId: FIXTURE_IDS.rewriteTimelineNodeId,
      sourceTimelineNodeType: 'rewrite',
      sourceSelectedText: '他在窗边停住，迟迟没有开口。',
      sourceTextSnapshot: 'rewrite 正文：风吹动了窗纸，他还是没有转身。',
      sourceSelectedLineStart: 8,
      sourceSelectedLineEnd: 8,
      status: 'active',
    })

    const firstMessage = await appendRoleplayMessage({
      id: 'roleplay-message-001',
      sessionId: session.id,
      role: 'user',
      content: '如果她先开口，会不会把真相说出来？',
      parentMessageId: null,
      forkedFromMessageId: null,
      variantGroupId: null,
      status: 'active',
    })
    const secondMessage = await appendRoleplayMessage({
      id: 'roleplay-message-002',
      sessionId: session.id,
      role: 'assistant',
      content: '她会先试探，再把最关键的一句压回去。',
      parentMessageId: firstMessage.id,
      forkedFromMessageId: null,
      variantGroupId: null,
      status: 'active',
    })
    const variantMessage = await createRoleplayLatestTurnVariant({
      sessionId: session.id,
      role: 'assistant',
      content: '她先把视线移开，只把真相说到一半，像是在给自己留退路。',
    })
    const forkedUserMessage = await appendRoleplayMessage({
      id: 'roleplay-message-004',
      sessionId: session.id,
      role: 'user',
      content: '那他会不会听懂她没说出口的部分？',
      parentMessageId: variantMessage.id,
      forkedFromMessageId: secondMessage.id,
      variantGroupId: null,
      status: 'active',
    })

    const persistedSession = findRoleplaySessionById(session.id)
    expect(persistedSession).not.toBeNull()
    expect(persistedSession?.timelineNodeId).toBe(timelineNodeId)
    expect(persistedSession?.messages.map((message) => ({
      id: message.id,
      messageIndex: message.messageIndex,
      turnIndex: message.turnIndex,
      variantIndex: message.variantIndex,
      role: message.role,
      parentMessageId: message.parentMessageId,
      forkedFromMessageId: message.forkedFromMessageId,
      variantGroupId: message.variantGroupId,
    }))).toEqual([
      {
        id: firstMessage.id,
        messageIndex: 1,
        turnIndex: 1,
        variantIndex: 1,
        role: 'user',
        parentMessageId: null,
        forkedFromMessageId: null,
        variantGroupId: null,
      },
      {
        id: secondMessage.id,
        messageIndex: 2,
        turnIndex: 2,
        variantIndex: 1,
        role: 'assistant',
        parentMessageId: firstMessage.id,
        forkedFromMessageId: null,
        variantGroupId: variantMessage.variantGroupId,
      },
      {
        id: variantMessage.id,
        messageIndex: 3,
        turnIndex: 2,
        variantIndex: 2,
        role: 'assistant',
        parentMessageId: firstMessage.id,
        forkedFromMessageId: secondMessage.id,
        variantGroupId: variantMessage.variantGroupId,
      },
      {
        id: forkedUserMessage.id,
        messageIndex: 4,
        turnIndex: 3,
        variantIndex: 1,
        role: 'user',
        parentMessageId: variantMessage.id,
        forkedFromMessageId: secondMessage.id,
        variantGroupId: null,
      },
    ])

    const roleplayTimelineRows = database.prepare(
      `SELECT id, parent_node_id, roleplay_session_id, continue_block_id, what_if_session_id, future_jump_run_id
       FROM story_timeline_nodes
       WHERE roleplay_session_id IS NOT NULL
       ORDER BY id ASC`
    ).all() as Array<{
      id: string
      parent_node_id: string | null
      roleplay_session_id: string
      continue_block_id: string | null
      what_if_session_id: string | null
      future_jump_run_id: string | null
    }>
    expect(roleplayTimelineRows).toEqual([
      {
        id: timelineNodeId,
        parent_node_id: FIXTURE_IDS.rewriteTimelineNodeId,
        roleplay_session_id: session.id,
        continue_block_id: null,
        what_if_session_id: null,
        future_jump_run_id: null,
      },
    ])

    const afterIsolation = snapshotNonRoleplayState(database)
    expect(afterIsolation).toEqual(beforeIsolation)

    ;(database as DatabaseSync & { close?: () => void }).close?.()
  })

  it('creates dedicated roleplay tables and timeline support on a fresh database', () => {
    const databasePath = makeTempDatabasePath('chatbook-roleplay-schema')
    const database = initializeDatabase(new DatabaseSync(databasePath))

    const tables = new Set(listTableNames(database).map((entry) => entry.name))
    const indexes = new Set(listIndexNames(database).map((entry) => entry.name))
    const timelineColumns = listColumnNames(database, 'story_timeline_nodes')

    expect([...tables]).toEqual(expect.arrayContaining([
      'story_timeline_nodes',
      'continue_blocks',
      'what_if_sessions',
      'future_jump_runs',
      'roleplay_sessions',
      'roleplay_messages',
    ]))
    expect(timelineColumns).toContain('roleplay_session_id')
    expect([...indexes]).toEqual(expect.arrayContaining([
      'idx_story_timeline_nodes_roleplay_session',
      'idx_roleplay_sessions_branch_source',
      'idx_roleplay_sessions_source_node',
      'idx_roleplay_messages_session_order',
      'idx_roleplay_messages_parent',
      'idx_roleplay_messages_fork',
      'idx_roleplay_messages_variant_group',
    ]))

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'task-1-roleplay-schema.txt'),
      JSON.stringify({
        databasePath,
        timelineColumns,
        tables: [...tables].filter((name) => name.includes('roleplay') || name.includes('continue') || name.includes('what_if') || name.includes('future_jump') || name.includes('story_timeline')),
        indexes: [...indexes].filter((name) => name.includes('roleplay') || name.includes('story_timeline')),
      }, null, 2)
    )

    ;(database as DatabaseSync & { close?: () => void }).close?.()
  })

  it('forward-migrates legacy branch tables without changing branch-table definitions or writing roleplay rows into them', () => {
    const databasePath = makeTempDatabasePath('chatbook-roleplay-branch-guard')
    createLegacyDatabaseWithoutRoleplay(databasePath)

    const beforeDatabase = new DatabaseSync(databasePath)
    const branchTables = ['continue_blocks', 'what_if_sessions', 'future_jump_runs', 'future_jump_revisions'] as const
    const beforeMetadata = Object.fromEntries(branchTables.map((tableName) => {
      const row = beforeDatabase.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) as { sql: string | null }
      return [tableName, row.sql]
    }))
    const beforeTimelineColumns = listColumnNames(beforeDatabase, 'story_timeline_nodes')
    ;(beforeDatabase as DatabaseSync & { close?: () => void }).close?.()

    const migratedDatabase = initializeDatabase(new DatabaseSync(databasePath))
    const afterMetadata = Object.fromEntries(branchTables.map((tableName) => {
      const row = migratedDatabase.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) as { sql: string | null }
      return [tableName, row.sql]
    }))
    const afterTimelineColumns = listColumnNames(migratedDatabase, 'story_timeline_nodes')
    const branchTableCounts = Object.fromEntries(branchTables.map((tableName) => {
      const row = migratedDatabase.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number }
      return [tableName, row.count]
    }))
    const roleplayCounts = {
      roleplay_sessions: (migratedDatabase.prepare('SELECT COUNT(*) AS count FROM roleplay_sessions').get() as { count: number }).count,
      roleplay_messages: (migratedDatabase.prepare('SELECT COUNT(*) AS count FROM roleplay_messages').get() as { count: number }).count,
    }

    expect(beforeTimelineColumns).not.toContain('roleplay_session_id')
    expect(afterTimelineColumns).toContain('roleplay_session_id')
    expect(afterMetadata).toEqual(beforeMetadata)
    expect(branchTableCounts).toEqual({
      continue_blocks: 0,
      what_if_sessions: 0,
      future_jump_runs: 0,
      future_jump_revisions: 0,
    })
    expect(roleplayCounts).toEqual({ roleplay_sessions: 0, roleplay_messages: 0 })

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'task-1-branch-table-guard.txt'),
      JSON.stringify({
        databasePath,
        beforeMetadata,
        afterMetadata,
        beforeTimelineColumns,
        afterTimelineColumns,
        branchTableCounts,
        roleplayCounts,
      }, null, 2)
    )

    ;(migratedDatabase as DatabaseSync & { close?: () => void }).close?.()
  })
})
