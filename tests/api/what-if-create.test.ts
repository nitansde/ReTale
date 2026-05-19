import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'
import type { AISettings } from '@/lib/types'

const EVIDENCE_DIR = path.join(process.cwd(), '.sisyphus/evidence/task-7-what-if')
const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }

function seedWhatIfFixture(database: DatabaseSync) {
  database.prepare(
    `INSERT INTO NovelRecord (id, title, author, sourceType)
     VALUES (?, ?, ?, ?)`
  ).run('novel-001', 'Fixture Novel', 'Fixture Author', 'txt')

  database.prepare(
    `INSERT INTO StoryBranch (id, novelId, name, baseBranchId)
     VALUES (?, ?, ?, ?)`
  ).run('novel-001:main', 'novel-001', 'main', null)

  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-10', 'novel-001', 'novel-001:main', 10, '第10章', '第10章内容', '第10章摘要', 1, 0, null, 'hash-10', 'ready')

  database.prepare('INSERT INTO ChapterLine (id, chapterId, lineNo, text) VALUES (?, ?, ?, ?)').run('line-10-1', 'chapter-10', 1, '男主和女主暂时结盟，准备一起行动。')
  database.prepare('INSERT INTO ChapterLine (id, chapterId, lineNo, text) VALUES (?, ?, ?, ?)').run('line-10-2', 'chapter-10', 2, '他们都还相信对方。')

  database.prepare(
    `INSERT INTO what_if_sessions (
      id, novel_id, base_branch_id, source_chapter_no, title, premise,
      selected_text, original_text, generated_text, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('what-if-session-001', 'novel-001', 'novel-001:main', 10, 'IF-01 决裂线', '旧前提', '旧选区', '旧正文', '旧生成', 'active')

  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, what_if_session_id,
      future_jump_run_id, lane_index, color_token, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('timeline-node-001', 'novel-001', 'novel-001:main', 'what_if', 1, 10, 'IF-01 决裂线', '旧摘要', null, 10, null, null, 'what-if-session-001', null, 0, 'violet', 'active')
}

function snapshotAuthoritativeState(database: DatabaseSync) {
  const countTables = ['KnowledgeFact', 'KnowledgeEvent', 'KnowledgeWorld', 'EntityState', 'EntityLink'] as const
  return {
    counts: Object.fromEntries(countTables.map((table) => {
      const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
      return [table, row.count]
    })),
    chapter: database.prepare('SELECT rawText, summary FROM KnowledgeChapter WHERE id = ?').get('chapter-10') as { rawText: string; summary: string },
    lines: database.prepare('SELECT lineNo, text FROM ChapterLine WHERE chapterId = ? ORDER BY lineNo ASC').all('chapter-10') as Array<{ lineNo: number; text: string }>,
  }
}

afterEach(() => {
  if (globalForSqlite.sqlite) {
    try {
      ;(globalForSqlite.sqlite as DatabaseSync & { close?: () => void }).close?.()
    } catch {
    }
    delete globalForSqlite.sqlite
  }

  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('what-if create API', () => {
  it('persists speculative session, deltas, and timeline node without mutating authoritative storage', async () => {
    const tempDatabase = createTempDatabaseCopy('chatbook-what-if-create')
    cleanups.push(tempDatabase.cleanup)

    const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
    globalForSqlite.sqlite = database
    seedWhatIfFixture(database)

    const before = snapshotAuthoritativeState(database)

    vi.resetModules()
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => ({
        rewrite: {
          provider: 'openai-compatible',
          openAICompatible: {
            baseUrl: '',
            apiKey: '',
            model: '',
            configured: false,
          },
          ollama: {
            baseUrl: '',
            model: '',
            configured: false,
          },
        },
        knowledgeExtraction: {
          provider: 'openai-compatible',
          openAICompatible: {
            baseUrl: '',
            apiKey: '',
            model: '',
            configured: false,
            parallelism: 1,
          },
          ollama: {
            baseUrl: '',
            model: '',
            configured: false,
            parallelism: 1,
          },
        },
        embeddings: {
          provider: 'openai-compatible',
          openAICompatible: {
            baseUrl: '',
            apiKey: '',
            model: '',
            configured: false,
          },
          ollama: {
            baseUrl: '',
            model: '',
            configured: false,
          },
          embeddingBatchSize: 16,
        },
      } satisfies AISettings),
    }))

    const { POST } = await import('@/app/api/what-if/sessions/route')
    const response = await POST(new Request('http://localhost/api/what-if/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        sourceChapterNo: 10,
        selectedText: '男主和女主暂时结盟，准备一起行动。',
        originalText: '第10章内容',
        generatedText: '男主当场撕毁盟约，女主也不再相信他。',
        inputTokens: 77,
        outputTokens: 88,
        userInstruction: '让两人在这里彻底决裂，后面进入互不信任的状态。',
        titleHint: '决裂线',
      }),
    }))

    expect(response.status).toBe(200)
    const payload = await response.json() as {
      sessionId: string
      timelineNodeId: string
      generatedText: string
      title: string
      subtitle: string | null
      deltas: Array<{
        id: string
        sessionId: string
        deltaType: string
        key: string
        validFromChapter: number | null
        description: string
      }>
    }

    expect(payload.sessionId).toBeTruthy()
    expect(payload.timelineNodeId).toBeTruthy()
    expect(payload.generatedText).toBe('男主当场撕毁盟约，女主也不再相信他。')
    expect(payload.title).toBe('IF-02 决裂线')
    expect(payload.deltas.length).toBeGreaterThan(0)
    expect(payload.deltas[0]?.sessionId).toBe(payload.sessionId)
    expect(payload.deltas[0]?.validFromChapter).toBe(10)

    const persistedSession = database.prepare('SELECT * FROM what_if_sessions WHERE id = ?').get(payload.sessionId) as {
      title: string
      premise: string
      generated_text: string
      input_tokens: number | null
      output_tokens: number | null
    }
    expect(persistedSession.title).toBe('IF-02 决裂线')
    expect(persistedSession.premise).toBe('让两人在这里彻底决裂，后面进入互不信任的状态。')
    expect(persistedSession.generated_text).toBe('男主当场撕毁盟约，女主也不再相信他。')
    expect(persistedSession.input_tokens).toBe(77)
    expect(persistedSession.output_tokens).toBe(88)

    const persistedDeltas = database.prepare('SELECT * FROM what_if_deltas WHERE session_id = ? ORDER BY created_at ASC, id ASC').all(payload.sessionId) as Array<{
      session_id: string
      valid_from_chapter: number | null
      description: string
    }>
    expect(persistedDeltas.length).toBeGreaterThan(0)
    expect(persistedDeltas[0]?.session_id).toBe(payload.sessionId)
    expect(persistedDeltas[0]?.valid_from_chapter).toBe(10)

    const timelineNode = database.prepare('SELECT * FROM story_timeline_nodes WHERE id = ?').get(payload.timelineNodeId) as {
      node_type: string
      label_index: number
      title: string
      subtitle: string | null
      what_if_session_id: string
      source_chapter_no: number | null
    }
    expect(timelineNode.node_type).toBe('what_if')
    expect(timelineNode.label_index).toBe(2)
    expect(timelineNode.title).toBe('IF-02 决裂线')
    expect(timelineNode.subtitle).toBeTruthy()
    expect(timelineNode.what_if_session_id).toBe(payload.sessionId)
    expect(timelineNode.source_chapter_no).toBe(10)

    const after = snapshotAuthoritativeState(database)
    expect(after.counts).toEqual(before.counts)
    expect(after.chapter).toEqual(before.chapter)
    expect(after.lines).toEqual(before.lines)

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'what-if-create.json'), JSON.stringify(payload, null, 2))
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'non-pollution.txt'),
      [
        `KnowledgeFact count: ${before.counts.KnowledgeFact} -> ${after.counts.KnowledgeFact}`,
        `KnowledgeEvent count: ${before.counts.KnowledgeEvent} -> ${after.counts.KnowledgeEvent}`,
        `KnowledgeWorld count: ${before.counts.KnowledgeWorld} -> ${after.counts.KnowledgeWorld}`,
        `EntityState count: ${before.counts.EntityState} -> ${after.counts.EntityState}`,
        `EntityLink count: ${before.counts.EntityLink} -> ${after.counts.EntityLink}`,
        `KnowledgeChapter rawText unchanged: ${String(after.chapter.rawText === before.chapter.rawText)}`,
      ].join('\n')
    )
  }, 15000)
})
