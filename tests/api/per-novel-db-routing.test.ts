import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'
import { SQLITE_BUSY_TIMEOUT_MS } from '@/lib/server/sqlite'
import { hashFile } from '@/tests/helpers/temp-db'

const repoRoot = process.cwd()
const originalDataDir = process.env.RETALE_DATA_DIR
const globalForSqlite = globalThis as { sqlite?: DatabaseSync; fetch?: typeof fetch }

const cleanupDirectories: string[] = []

const RAW_SQLITE_IMPORT_ALLOWED_FILES = new Set([
  'lib/server/database-access.ts',
  'lib/server/db-resolver.ts',
])

function listTypeScriptFiles(rootPath: string): string[] {
  const entries = fs.readdirSync(rootPath, { withFileTypes: true })
  const results: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue
    }

    const entryPath = path.join(rootPath, entry.name)
    if (entry.isDirectory()) {
      results.push(...listTypeScriptFiles(entryPath))
      continue
    }

    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      results.push(entryPath)
    }
  }

  return results
}

function listRawSqliteImportFiles() {
  const serverFiles = listTypeScriptFiles(path.join(repoRoot, 'lib', 'server'))
  const apiFiles = listTypeScriptFiles(path.join(repoRoot, 'app', 'api'))
  const importPattern = /from ['"]@\/lib\/server\/sqlite['"]/u

  return [...serverFiles, ...apiFiles]
    .filter((filePath) => importPattern.test(fs.readFileSync(filePath, 'utf8')))
    .map((filePath) => path.relative(repoRoot, filePath).split(path.sep).join('/'))
    .sort((left, right) => left.localeCompare(right, 'en-US'))
}

function createTempDataRoot() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'retale-per-novel-db-'))
  cleanupDirectories.push(directory)
  return path.join(directory, 'data')
}

function getDatabaseFile(database: DatabaseSync) {
  const row = database.prepare('PRAGMA database_list').get() as { file: string }
  return row.file
}

function canonicalizePath(targetPath: string) {
  if (!fs.existsSync(targetPath)) {
    return path.resolve(targetPath)
  }

  return fs.realpathSync.native(targetPath)
}

function getBusyTimeout(database: DatabaseSync) {
  const row = database.prepare('PRAGMA busy_timeout').get() as { timeout: number }
  return row.timeout
}

function getForeignKeys(database: DatabaseSync) {
  const row = database.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }
  return row.foreign_keys
}

function getJournalMode(database: DatabaseSync) {
  const row = database.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
  return row.journal_mode.toLowerCase()
}

function listTables(database: DatabaseSync) {
  return new Set(
    (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name)
  )
}

function listTableColumns(database: DatabaseSync, tableName: string) {
  return database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
}

async function loadResolverModule(dataRootPath: string) {
  process.env.RETALE_DATA_DIR = dataRootPath
  vi.resetModules()
  return import('@/lib/server/db-resolver')
}

function setActiveWorkspaceNovelId(database: DatabaseSync, novelId: string) {
  database.prepare(
    `INSERT INTO AppSetting (id, key, value)
     VALUES (lower(hex(randomblob(16))), ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updatedAt = CURRENT_TIMESTAMP`
  ).run('WORKSPACE_ACTIVE_NOVEL_ID', novelId)
}

function createWorkspaceRequest(payload: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/workspace', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

function createNovelWorkspacePayload(novelId: string, title = novelId) {
  return {
    currentNovelId: novelId,
    currentChapterId: `${novelId}-chapter-1`,
    localNovels: [{ id: novelId, title, summary: `${title} summary`, tags: ['test'] }],
    localVolumes: [{ id: `${novelId}-volume-1`, novelId, title: 'Volume 1', order: 1 }],
    localChapters: [{
      id: `${novelId}-chapter-1`,
      novelId,
      volumeId: `${novelId}-volume-1`,
      title: 'Chapter 1',
      order: 1,
      content: `<p>${title} body</p>`,
      originalContent: `<p>${title} body</p>`,
      status: 'draft',
      wordCount: 2,
      updatedAt: 'just now',
    }],
  }
}

async function importWorkspaceRouteWithAfterCallbacks() {
  const afterCallbacks: Array<() => Promise<void>> = []

  vi.stubEnv('NODE_ENV', 'development')
  vi.doMock('next/server', async (importOriginal) => {
    const actual = await importOriginal<typeof import('next/server')>()

    return {
      ...actual,
      after: vi.fn((callback: () => Promise<void>) => {
        afterCallbacks.push(callback)
      }),
    }
  })

  const route = await import('@/app/api/workspace/route')
  return { ...route, afterCallbacks }
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.doUnmock('next/server')
  if (globalForSqlite.sqlite) {
    try {
      ;(globalForSqlite.sqlite as DatabaseSync & { close?: () => void }).close?.()
    } catch {
    }
    delete globalForSqlite.sqlite
  }
  const resolverModule = await import('@/lib/server/db-resolver')
  resolverModule.resetResolvedDatabasesForTests()
  process.env.RETALE_DATA_DIR = originalDataDir
  vi.resetModules()

  while (cleanupDirectories.length > 0) {
    const directory = cleanupDirectories.pop()
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe('per-novel database resolver', () => {
  it('routes control and novel databases to isolated file paths with per-file pragmas', async () => {
    const dataRootPath = createTempDataRoot()
    const resolver = await loadResolverModule(dataRootPath)

    const controlDb = resolver.getControlDb()
    const novelDb = resolver.getNovelDb('novel-alpha')
    const secondRead = resolver.getNovelDb('novel-alpha')
    const lanceDbPath = resolver.getNovelLanceDbPath('novel-alpha')
    const betaLanceDbPath = resolver.getNovelLanceDbPath('novel-beta')

    expect(controlDb).not.toBe(novelDb)
    expect(getDatabaseFile(secondRead)).toBe(getDatabaseFile(novelDb))
    expect(canonicalizePath(getDatabaseFile(controlDb))).toBe(canonicalizePath(path.join(dataRootPath, 'control.db')))
    expect(canonicalizePath(getDatabaseFile(novelDb))).toBe(canonicalizePath(path.join(dataRootPath, 'novels', 'novel-alpha', 'novel.db')))
    expect(canonicalizePath(lanceDbPath)).toBe(canonicalizePath(path.join(dataRootPath, 'novels', 'novel-alpha', 'lancedb')))
    expect(canonicalizePath(betaLanceDbPath)).toBe(canonicalizePath(path.join(dataRootPath, 'novels', 'novel-beta', 'lancedb')))
    expect(canonicalizePath(lanceDbPath)).not.toBe(canonicalizePath(path.join(repoRoot, '.lancedb')))
    expect(canonicalizePath(betaLanceDbPath)).not.toBe(canonicalizePath(path.join(repoRoot, '.lancedb')))
    expect(fs.existsSync(path.dirname(getDatabaseFile(novelDb)))).toBe(true)

    expect(getBusyTimeout(controlDb)).toBe(SQLITE_BUSY_TIMEOUT_MS)
    expect(getBusyTimeout(novelDb)).toBe(SQLITE_BUSY_TIMEOUT_MS)
    expect(getForeignKeys(controlDb)).toBe(1)
    expect(getForeignKeys(novelDb)).toBe(1)
    expect(getJournalMode(controlDb)).toBe('wal')
    expect(getJournalMode(novelDb)).toBe('wal')
  })

  it('keeps the control database limited to settings and registry metadata tables', async () => {
    const dataRootPath = createTempDataRoot()
    const resolver = await loadResolverModule(dataRootPath)

    const controlDb = resolver.getControlDb()
    const tables = listTables(controlDb)
    const novelRegistryColumns = new Set(listTableColumns(controlDb, 'NovelRegistry').map((column) => column.name))

    expect([...tables]).toEqual(expect.arrayContaining([
      'AppSetting',
      'NovelRegistry',
      'MigrationManifest',
      'MigrationAudit',
    ]))
    expect([...novelRegistryColumns]).toEqual(expect.arrayContaining([
      'novelId',
      'safeNovelId',
      'title',
      'dbFilePath',
      'lanceDbPath',
      'schemaVersion',
      'migrationStatus',
      'createdAt',
      'updatedAt',
    ]))
    expect(tables.has('NovelRecord')).toBe(false)
    expect(tables.has('KnowledgeChapter')).toBe(false)
    expect(tables.has('KnowledgeJob')).toBe(false)
    expect(tables.has('WorkspaceState')).toBe(false)
    expect(tables.has('continue_blocks')).toBe(false)
    expect(tables.has('what_if_sessions')).toBe(false)
  })

  it('rejects invalid novel IDs without creating escaped directories', async () => {
    const dataRootPath = createTempDataRoot()
    const tempRootPath = path.dirname(dataRootPath)
    const resolver = await loadResolverModule(dataRootPath)

    const invalidIds = ['', '   ', '.', '..', '../escape', 'novel/alpha', 'novel\\alpha', '$$$']

    for (const invalidId of invalidIds) {
      expect(() => resolver.getNovelDb(invalidId)).toThrow(/Invalid novel ID/)
      expect(() => resolver.getNovelLanceDbPath(invalidId)).toThrow(/Invalid novel ID/)
    }

    expect(fs.existsSync(path.join(tempRootPath, 'escape'))).toBe(false)
    expect(fs.existsSync(path.join(dataRootPath, 'novels', 'novel'))).toBe(false)
    expect(fs.existsSync(path.join(dataRootPath, 'novels'))).toBe(false)
  })

  it('keeps raw singleton sqlite imports limited to resolver and documented control modules', () => {
    expect(listRawSqliteImportFiles()).toEqual([...RAW_SQLITE_IMPORT_ALLOWED_FILES].sort((left, right) => left.localeCompare(right, 'en-US')))
  })

  it('saves workspace runtime and artifacts only into the targeted novel database', async () => {
    const dataRootPath = createTempDataRoot()
    const resolver = await loadResolverModule(dataRootPath)
    const controlDb = resolver.getControlDb()
    const alphaDb = resolver.getNovelDb('novel-alpha')
    const betaDb = resolver.getNovelDb('novel-beta')

    setActiveWorkspaceNovelId(controlDb, 'novel-alpha')
    alphaDb.prepare('INSERT INTO WorkspaceState (id, payload) VALUES (?, ?)').run('singleton', JSON.stringify(createNovelWorkspacePayload('novel-alpha', 'Alpha Initial')))
    betaDb.prepare('INSERT INTO WorkspaceState (id, payload) VALUES (?, ?)').run('singleton', JSON.stringify(createNovelWorkspacePayload('novel-beta', 'Beta Initial')))

    const betaDbPath = getDatabaseFile(betaDb)
    const betaHashBefore = hashFile(betaDbPath)

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore: vi.fn(async () => {}),
    }))

    const { POST } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await POST(createWorkspaceRequest(createNovelWorkspacePayload('novel-alpha', 'Alpha Updated')))

    expect(response.status).toBe(200)
    expect(hashFile(betaDbPath)).toBe(betaHashBefore)
    expect(JSON.parse((alphaDb.prepare('SELECT payload FROM WorkspaceState WHERE id = ?').get('singleton') as { payload: string }).payload)).toMatchObject({
      currentNovelId: 'novel-alpha',
      localNovels: [{ id: 'novel-alpha', title: 'Alpha Updated' }],
      localChapters: [{ id: 'novel-alpha-chapter-1', novelId: 'novel-alpha' }],
    })
    expect(JSON.parse((betaDb.prepare('SELECT payload FROM WorkspaceState WHERE id = ?').get('singleton') as { payload: string }).payload)).toMatchObject({
      currentNovelId: 'novel-beta',
      localNovels: [{ id: 'novel-beta', title: 'Beta Initial' }],
    })
  })

  it('does not let a corrupt sibling novel database block alpha save or alpha read paths', async () => {
    const dataRootPath = createTempDataRoot()
    const resolver = await loadResolverModule(dataRootPath)
    const controlDb = resolver.getControlDb()
    const alphaDb = resolver.getNovelDb('novel-alpha')
    const betaDb = resolver.getNovelDb('novel-beta')
    const betaDbPath = getDatabaseFile(betaDb)

    setActiveWorkspaceNovelId(controlDb, 'novel-alpha')
    alphaDb.prepare('INSERT INTO WorkspaceState (id, payload) VALUES (?, ?)').run('singleton', JSON.stringify(createNovelWorkspacePayload('novel-alpha', 'Alpha Initial')))
    betaDb.prepare('INSERT INTO WorkspaceState (id, payload) VALUES (?, ?)').run('singleton', JSON.stringify(createNovelWorkspacePayload('novel-beta', 'Beta Initial')))

    resolver.resetResolvedDatabasesForTests()
    fs.writeFileSync(betaDbPath, Buffer.from('not-a-sqlite-database'))

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore: vi.fn(async () => {}),
    }))

    const { GET, POST } = await importWorkspaceRouteWithAfterCallbacks()

    const saveResponse = await POST(createWorkspaceRequest(createNovelWorkspacePayload('novel-alpha', 'Alpha Saved')))
    expect(saveResponse.status).toBe(200)

    const alphaGetResponse = await GET(new Request('http://localhost/api/workspace?novelId=novel-alpha'))
    expect(alphaGetResponse.status).toBe(200)
    await expect(alphaGetResponse.json()).resolves.toMatchObject({
      currentNovelId: 'novel-alpha',
      localNovels: [{ id: 'novel-alpha', title: 'Alpha Saved' }],
    })

    const betaGetResponse = await GET(new Request('http://localhost/api/workspace?novelId=novel-beta'))
    expect(betaGetResponse.status).toBe(500)
    await expect(betaGetResponse.json()).resolves.toMatchObject({ ok: false })
  })

  it('routes future-jump create and revise through the requested novel DB instead of singleton discovery reads', async () => {
    const dataRootPath = createTempDataRoot()
    const resolver = await loadResolverModule(dataRootPath)
    const alphaDb = resolver.getNovelDb('novel-alpha')
    const betaDb = resolver.getNovelDb('novel-beta')
    const singletonDbPath = path.join(path.dirname(dataRootPath), 'singleton-monolith.db')
    const singletonDb = initializeDatabase(new DatabaseSync(singletonDbPath))
    globalForSqlite.sqlite = singletonDb

    const seedFutureJumpFixture = (database: DatabaseSync, novelId: string, labels: { outlineTitle: string; sessionTitle: string; runTitle: string }) => {
      const branchId = `${novelId}:main`
      database.prepare('INSERT INTO NovelRecord (id, title, author, sourceType) VALUES (?, ?, ?, ?)').run(novelId, `${novelId} title`, `${novelId} author`, 'txt')
      database.prepare('INSERT INTO StoryBranch (id, novelId, name, baseBranchId) VALUES (?, ?, ?, ?)').run(branchId, novelId, 'main', null)
      database.prepare(
        `INSERT INTO KnowledgeChapter (
          id, novelId, branchId, chapterNo, title, rawText, summary,
          revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(`${novelId}-chapter-10`, novelId, branchId, 10, `${novelId} 第10章`, `${novelId} 第10章正文`, `${novelId} 第10章摘要`, 1, 0, null, `${novelId}-hash-10`, 'ready')
      database.prepare(
        `INSERT INTO KnowledgeChapter (
          id, novelId, branchId, chapterNo, title, rawText, summary,
          revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(`${novelId}-chapter-100`, novelId, branchId, 100, `${novelId} 第100章`, `${novelId} 第100章正文`, `${novelId} 第100章摘要`, 1, 0, null, `${novelId}-hash-100`, 'ready')
      database.prepare(
        `INSERT INTO what_if_sessions (
          id, novel_id, base_branch_id, source_chapter_no, title, premise,
          selected_text, original_text, generated_text, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('shared-what-if-session', novelId, branchId, 10, labels.sessionTitle, `${novelId} premise`, `${novelId} selected`, `${novelId} original`, `${novelId} generated`, 'active')
      database.prepare(
        `INSERT INTO outline_nodes (
          id, novel_id, branch_id, chapter_no, title, summary, original_outcome,
          track_key, phase_label, source_type, confidence, involved_entities_json, key_events_json, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('shared-outline-node', novelId, branchId, 100, labels.outlineTitle, `${novelId} outline summary`, `${novelId} original outcome`, 'phase-3', '第三阶段', 'authored', 1, '[]', '[]', 100)
      database.prepare(
        `INSERT INTO outline_node_chapters (
          id, outline_node_id, chapter_no, chapter_id, chapter_title, is_primary, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('shared-outline-anchor', 'shared-outline-node', 100, `${novelId}-chapter-100`, `${novelId} 第100章`, 1, 0)
      database.prepare(
        `INSERT INTO future_jump_runs (
          id, session_id, base_branch_id, parent_timeline_node_id, source_timeline_node_id,
          source_timeline_node_type, source_chapter_id, source_what_if_session_id, target_outline_node_id,
          target_outline_chapter_id, source_chapter_no, target_chapter_no, user_direction,
          bridge_summary, generated_target_text, latest_revision_no, error_message, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('shared-jump-run', 'shared-what-if-session', branchId, null, null, 'chapter', `${novelId}-chapter-10`, 'shared-what-if-session', 'shared-outline-node', 'shared-outline-anchor', 10, 100, `${novelId} direction`, `${novelId} bridge`, labels.runTitle, 1, null, 'generated')
      database.prepare(
        `INSERT INTO future_jump_revisions (
          id, run_id, revision_no, revision_kind, user_feedback, bridge_summary, generated_target_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(`${novelId}-future-jump-revision-1`, 'shared-jump-run', 1, 'initial', null, `${novelId} bridge`, labels.runTitle)
      database.prepare(
        `INSERT INTO story_timeline_nodes (
          id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
          parent_node_id, source_chapter_no, target_chapter_no, chapter_id, what_if_session_id,
          future_jump_run_id, lane_index, color_token, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(`${novelId}-jump-node`, novelId, branchId, 'future_jump', 1, 100, labels.runTitle, `${novelId} subtitle`, null, 10, 100, `${novelId}-chapter-100`, null, 'shared-jump-run', 0, 'violet', 'generated')
    }

    seedFutureJumpFixture(alphaDb, 'novel-alpha', {
      outlineTitle: 'Alpha target outline',
      sessionTitle: 'Alpha session',
      runTitle: 'Alpha initial text',
    })
    seedFutureJumpFixture(betaDb, 'novel-beta', {
      outlineTitle: 'Beta target outline',
      sessionTitle: 'Beta session',
      runTitle: 'Beta initial text',
    })

    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => ({
        rewrite: {
          provider: 'openai-compatible',
          openAICompatible: {
            baseUrl: 'https://example.test/v1',
            apiKey: 'test-key',
            model: 'test-model',
          },
          ollama: {
            baseUrl: 'http://127.0.0.1:11434',
            model: 'ignored',
          },
        },
      }),
    }))

    const alphaCreateBridgeSummary = '桥'.repeat(320)
    const alphaReviseBridgeSummary = '改'.repeat(320)
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ bridgeSummary: alphaCreateBridgeSummary }) } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ generatedTargetText: 'Alpha create text', titleHint: 'Alpha Jump', subtitleHint: 'Alpha subtitle' }) } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ bridgeSummary: alphaReviseBridgeSummary }) } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ generatedTargetText: 'Alpha revised text', titleHint: 'Alpha Revised Jump' }) } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    vi.resetModules()
    const [{ POST: createRun }, { POST: reviseRun }] = await Promise.all([
      import('@/app/api/future-jump/runs/route'),
      import('@/app/api/future-jump/runs/[runId]/revise/route'),
    ])

    const createResponse = await createRun(new Request('http://localhost/api/future-jump/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-alpha',
        sourceContext: {
          nodeId: null,
          nodeType: 'chapter',
          chapterId: 'novel-alpha-chapter-10',
          chapterNo: 10,
          whatIfSessionId: 'shared-what-if-session',
        },
        targetOutlineNodeId: 'shared-outline-node',
        targetOutlineChapterId: 'shared-outline-anchor',
        userDirection: 'Only alpha should create this run.',
      }),
    }))

    expect(createResponse.status).toBe(200)
    const createPayload = await createResponse.json() as { runId: string }
    expect(alphaDb.prepare('SELECT COUNT(*) AS count FROM future_jump_runs WHERE id = ?').get(createPayload.runId)).toMatchObject({ count: 1 })
    expect(betaDb.prepare('SELECT COUNT(*) AS count FROM future_jump_runs WHERE id = ?').get(createPayload.runId)).toMatchObject({ count: 0 })

    const reviseResponse = await reviseRun(new Request('http://localhost/api/future-jump/runs/shared-jump-run/revise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-alpha',
        userFeedback: 'Revise only the alpha run.',
      }),
    }), { params: Promise.resolve({ runId: 'shared-jump-run' }) })

    expect(reviseResponse.status).toBe(200)
    expect(alphaDb.prepare('SELECT latest_revision_no, generated_target_text FROM future_jump_runs WHERE id = ?').get('shared-jump-run')).toMatchObject({
      latest_revision_no: 2,
      generated_target_text: 'Alpha revised text',
    })
    expect(betaDb.prepare('SELECT latest_revision_no, generated_target_text FROM future_jump_runs WHERE id = ?').get('shared-jump-run')).toMatchObject({
      latest_revision_no: 1,
      generated_target_text: 'Beta initial text',
    })
  })
})
