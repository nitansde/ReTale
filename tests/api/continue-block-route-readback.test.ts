import { createScopedDatabaseFixture } from '@/tests/helpers/database-fixture'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const databaseFixture = createScopedDatabaseFixture()

const cleanups: Array<() => void> = []
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
  ).run('chapter-10', 'novel-001', 'novel-001:main', 10, '第10章', '第10章内容', '第10章摘要', 1, 0, null, 'hash-10', 'ready')
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

  const sqliteModule = databaseFixture.open(process.env.DATABASE_URL!)
  const resolverModule = await import('@/lib/server/db-resolver')
  const novelDatabase = resolverModule.getNovelDb('novel-001')

  return {
    singletonDatabase: sqliteModule.sqlite,
    novelDatabase,
  }
}

afterEach(databaseFixture.wrap(async () => {
  vi.restoreAllMocks()
  vi.resetModules()

  if (databaseFixture.database) {
    try {
      ;(databaseFixture.database as DatabaseSync & { close?: () => void }).close?.()
    } catch (closeError) {
      void closeError
    }
    delete databaseFixture.database
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
}))

describe('/api/continue-blocks detail readback', () => {
  it('reads an immediately saved continue block from the per-novel database instead of the singleton database', databaseFixture.wrap(async () => {
    const { singletonDatabase, novelDatabase } = await createSplitBrainDatabases('retale-continue-block-route-readback')
    seedNovel(novelDatabase)

    const { POST } = await import('@/app/api/continue-blocks/route')
    const { GET } = await import('@/app/api/continue-blocks/[continueBlockId]/route')

    const postResponse = await POST(new Request('http://localhost/api/continue-blocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        sourceChapterNo: 10,
        selectedText: '中性选区',
        originalText: '中性原文',
        generatedText: '中性续写结果',
        inputTokens: 8,
        outputTokens: 16,
        userInstruction: '保存当前版本',
        titleHint: '当前版本',
      }),
    }))

    expect(postResponse.status).toBe(200)
    const created = await postResponse.json() as {
      continueBlockId: string
      timelineNodeId: string
      nodeType: 'rewrite' | 'continue_block'
      writingSkillCardIds: string[]
      writingSkillExampleCount: number
    }

    expect(created.nodeType).toBe('rewrite')
    expect(created.writingSkillCardIds).toEqual([])
    expect(created.writingSkillExampleCount).toBe(5)
    expect(singletonDatabase.prepare('SELECT COUNT(*) AS count FROM continue_blocks').get()).toMatchObject({ count: 0 })
    expect(novelDatabase.prepare('SELECT COUNT(*) AS count FROM continue_blocks').get()).toMatchObject({ count: 1 })

    const detailResponse = await GET(
      new Request(`http://localhost/api/continue-blocks/${created.continueBlockId}?novelId=novel-001&branchId=novel-001:main`),
      { params: Promise.resolve({ continueBlockId: created.continueBlockId }) }
    )
    expect(detailResponse.headers.get('cache-control')).toBe('no-store')

    expect(detailResponse.status).toBe(200)
    const detail = await detailResponse.json() as {
      id: string
      novelId: string
      branchId: string
      timelineNodeId: string | null
      latestText: string
      latestRevisionNo: number
      writingSkillCardIds: string[]
      writingSkillExampleCount: number
    }

    expect(detail).toEqual(expect.objectContaining({
      id: created.continueBlockId,
      novelId: 'novel-001',
      branchId: 'novel-001:main',
      timelineNodeId: created.timelineNodeId,
      latestText: '中性续写结果',
      latestRevisionNo: 1,
      writingSkillCardIds: [],
      writingSkillExampleCount: 5,
    }))
  }))

  it('persists multiple writing skill cards across create, regenerate, detail, and timeline reads', databaseFixture.wrap(async () => {
    const { novelDatabase } = await createSplitBrainDatabases('retale-continue-block-writing-skills')
    seedNovel(novelDatabase)

    const [{ POST, PUT }, { GET: getDetail }, { GET: getTimeline }] = await Promise.all([
      import('@/app/api/continue-blocks/route'),
      import('@/app/api/continue-blocks/[continueBlockId]/route'),
      import('@/app/api/story-timeline/route'),
    ])

    const postResponse = await POST(new Request('http://localhost/api/continue-blocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        sourceChapterNo: 10,
        selectedText: '五官选区',
        originalText: '五官原文',
        generatedText: '第一次生成结果',
        userInstruction: '加强五官描写',
        writingSkillCardIds: ['skill-facial-features', 'skill-prose-rhythm', 'skill-facial-features'],
        writingSkillExampleCount: 8,
      }),
    }))

    expect(postResponse.status).toBe(200)
    const created = await postResponse.json() as {
      continueBlockId: string
      timelineNodeId: string
      writingSkillCardIds: string[]
      writingSkillExampleCount: number
    }
    expect(created.writingSkillCardIds).toEqual(['skill-facial-features', 'skill-prose-rhythm'])
    expect(created.writingSkillExampleCount).toBe(8)

    const createdDetailResponse = await getDetail(
      new Request(`http://localhost/api/continue-blocks/${created.continueBlockId}?novelId=novel-001&branchId=novel-001:main`),
      { params: Promise.resolve({ continueBlockId: created.continueBlockId }) }
    )
    expect(createdDetailResponse.status).toBe(200)
    await expect(createdDetailResponse.json()).resolves.toEqual(expect.objectContaining({
      writingSkillCardIds: ['skill-facial-features', 'skill-prose-rhythm'],
      writingSkillExampleCount: 8,
    }))

    const putResponse = await PUT(new Request('http://localhost/api/continue-blocks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-001',
        branchId: 'novel-001:main',
        continueBlockId: created.continueBlockId,
        selectedText: '五官选区',
        originalText: '五官原文',
        generatedText: '第二次生成结果',
        userInstruction: '重新生成五官描写',
        writingSkillCardIds: ['skill-closeup', 'skill-body-language', 'skill-closeup'],
        writingSkillExampleCount: 3,
      }),
    }))

    expect(putResponse.status).toBe(200)
    const regenerated = await putResponse.json() as {
      latestRevisionNo: number
      writingSkillCardIds: string[]
      writingSkillExampleCount: number
    }
    expect(regenerated).toEqual(expect.objectContaining({
      latestRevisionNo: 2,
      writingSkillCardIds: ['skill-closeup', 'skill-body-language'],
      writingSkillExampleCount: 3,
    }))

    const updatedDetailResponse = await getDetail(
      new Request(`http://localhost/api/continue-blocks/${created.continueBlockId}?novelId=novel-001&branchId=novel-001:main`),
      { params: Promise.resolve({ continueBlockId: created.continueBlockId }) }
    )
    expect(updatedDetailResponse.status).toBe(200)
    await expect(updatedDetailResponse.json()).resolves.toEqual(expect.objectContaining({
      latestText: '第二次生成结果',
      latestRevisionNo: 2,
      writingSkillCardIds: ['skill-closeup', 'skill-body-language'],
      writingSkillExampleCount: 3,
    }))

    const timelineResponse = await getTimeline(
      new Request('http://localhost/api/story-timeline?novelId=novel-001&branchId=novel-001:main')
    )
    expect(timelineResponse.status).toBe(200)
    const timeline = await timelineResponse.json() as {
      branchNodes: Array<{
        id: string
        writingSkillCardIds?: string[]
        writingSkillExampleCount?: number | null
      }>
    }
    expect(timeline.branchNodes.find((node) => node.id === created.timelineNodeId)).toEqual(expect.objectContaining({
      writingSkillCardIds: ['skill-closeup', 'skill-body-language'],
      writingSkillExampleCount: 3,
    }))

    const persistedRow = novelDatabase.prepare(
      'SELECT writing_skill_card_ids_json, writing_skill_example_count FROM continue_blocks WHERE id = ?'
    ).get(created.continueBlockId)
    expect(persistedRow).toEqual({
      writing_skill_card_ids_json: '["skill-closeup","skill-body-language"]',
      writing_skill_example_count: 3,
    })
    expect(listTableColumnsForTest(novelDatabase, 'continue_blocks')).not.toContain('writing_skill_seed')
  }))
})

function listTableColumnsForTest(database: DatabaseSync, tableName: string) {
  return (database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map((column) => column.name)
}
