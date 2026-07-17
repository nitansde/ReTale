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

function restoreEnvVar(name: 'RETALE_DATA_DIR', originalValue: string | undefined) {
  if (originalValue === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = originalValue
}

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

function writeAppSetting(database: DatabaseSync, key: string, value: string) {
  database.prepare(
    `INSERT INTO AppSetting (id, key, value)
     VALUES (lower(hex(randomblob(16))), ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updatedAt = CURRENT_TIMESTAMP`
  ).run(key, value)
}

function setActiveWorkspaceNovelId(database: DatabaseSync, novelId: string) {
  writeAppSetting(database, 'WORKSPACE_ACTIVE_NOVEL_ID', novelId)
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

function seedCollidingNovelRouteFixture(database: DatabaseSync, novelId: string, marker: string) {
  const branchId = `${novelId}:main`
  database.prepare('INSERT INTO NovelRecord (id, title, author, sourceType) VALUES (?, ?, ?, ?)').run(novelId, `${marker} novel`, `${marker} author`, 'txt')
  database.prepare('INSERT INTO StoryBranch (id, novelId, name, baseBranchId) VALUES (?, ?, ?, ?)').run(branchId, novelId, 'main', null)
  database.prepare(
    `INSERT INTO KnowledgeChapter (
      id, novelId, branchId, chapterNo, title, rawText, summary,
      revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('shared-chapter', novelId, branchId, 1, `${marker} chapter`, `${marker} chapter body`, `${marker} chapter summary`, 1, 0, null, `${marker}-hash`, 'ready')
  database.prepare('INSERT INTO ChapterLine (id, chapterId, lineNo, text, charStart, charEnd) VALUES (?, ?, ?, ?, ?, ?)')
    .run('shared-line', 'shared-chapter', 1, `${marker} chapter body`, 0, `${marker} chapter body`.length)

  database.prepare(
    `INSERT INTO KnowledgeEntity (
      id, novelId, branchId, entityType, canonicalName, description,
      firstSeenChapter, lastSeenChapter, importanceTier, status, importance, userConfirmed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('shared-hero', novelId, branchId, 'character', `${marker} Hero`, `${marker} hero`, 1, 1, 'protagonist', 'user_confirmed', 5, 1)
  database.prepare(
    `INSERT INTO KnowledgeEntity (
      id, novelId, branchId, entityType, canonicalName, description,
      firstSeenChapter, lastSeenChapter, importanceTier, status, importance, userConfirmed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('shared-rival', novelId, branchId, 'character', `${marker} Rival`, `${marker} rival`, 1, 1, 'important', 'user_confirmed', 4, 1)
  database.prepare('INSERT INTO EntityAppearance (id, entityId, chapterId, chapterNo, lineStart, lineEnd) VALUES (?, ?, ?, ?, ?, ?)')
    .run('shared-appearance', 'shared-hero', 'shared-chapter', 1, 1, 1)
  database.prepare(
    `INSERT INTO EntityLink (
      id, novelId, branchId, sourceEntityId, targetEntityId, linkType, label, description,
      polarity, strength, sourceChapter, validFromChapter, validUntilChapter, confidence, status, includeByDefault
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('shared-edge', novelId, branchId, 'shared-hero', 'shared-rival', `${marker}-alliance`, `${marker} edge`, `${marker} description`, 'positive', 4, 1, 1, 999999, 0.9, 'ai_generated', 1)
  database.prepare(
    `INSERT INTO KnowledgeRelation (
      id, novelId, branchId, sourceEntityId, targetEntityId, relationType, polarity,
      strength, sourceChapter, validFromChapter, validUntilChapter, confidence, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('shared-relation', novelId, branchId, 'shared-hero', 'shared-rival', `${marker}-alliance`, 'positive', 4, 1, 1, 999999, 0.9, 'ai_generated')

  database.prepare(
    `INSERT INTO roleplay_sessions (
      id, novel_id, branch_id, title, source_chapter_id, source_chapter_no,
      source_selected_text, source_text_snapshot, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('shared-roleplay', novelId, branchId, `${marker} roleplay`, 'shared-chapter', 1, `${marker} selected`, `${marker} snapshot`, 'active')

  database.prepare(
    `INSERT INTO what_if_sessions (
      id, novel_id, base_branch_id, source_chapter_no, title, premise,
      selected_text, original_text, generated_text, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('shared-what-if', novelId, branchId, 1, `${marker} what-if`, `${marker} premise`, `${marker} selected`, `${marker} original`, `${marker} generated`, 'active')

  database.prepare(
    `INSERT INTO continue_blocks (
      id, novel_id, branch_id, source_chapter_no, title, user_instruction,
      selected_text, original_text, latest_text, latest_revision_no, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('shared-continue', novelId, branchId, 1, `${marker} continue`, `${marker} instruction`, `${marker} selected`, `${marker} original`, `${marker} latest`, 1, 'active')
  database.prepare(
    `INSERT INTO continue_block_revisions (
      id, continue_block_id, revision_no, revision_kind, user_instruction,
      selected_text, original_text, generated_text, title
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('shared-continue-revision', 'shared-continue', 1, 'initial', `${marker} instruction`, `${marker} selected`, `${marker} original`, `${marker} latest`, `${marker} continue`)
  database.prepare(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title,
      source_chapter_no, continue_block_id, readable_label, readable_lineage_label, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('shared-continue-node', novelId, branchId, 'rewrite', 1, 1, `${marker} continue`, 1, 'shared-continue', 'RE-01', 'RE-01', 'active')
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
  restoreEnvVar('RETALE_DATA_DIR', originalDataDir)
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

  it('fences non-ready registry rows from live storage resolution and ordinary upserts', async () => {
    const dataRootPath = createTempDataRoot()
    const resolver = await loadResolverModule(dataRootPath)
    const controlDb = resolver.getControlDb()
    const alphaDb = resolver.getNovelDb('novel-alpha')
    const alphaDbPath = getDatabaseFile(alphaDb)
    controlDb.prepare(
      `INSERT INTO NovelRegistry (
         novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus
       ) VALUES (?, ?, ?, ?, ?, '1', 'ready')`,
    ).run('novel-alpha', 'novel-alpha', 'Original', alphaDbPath, path.join(path.dirname(alphaDbPath), 'lancedb'))
    controlDb.prepare('UPDATE NovelRegistry SET migrationStatus = ? WHERE novelId = ?').run('deleting', 'novel-alpha')

    expect(() => resolver.getNovelDb('novel-alpha')).toThrow(/not available/)
    expect(() => resolver.getNovelLanceDbPath('novel-alpha')).toThrow(/not available/)

    const { upsertWorkspaceNovelRegistry, upsertWorkspaceState } = await import('@/lib/server/persistence')
    upsertWorkspaceNovelRegistry({ novelId: 'novel-alpha', title: 'Must Not Revive' })
    expect(controlDb.prepare('SELECT title, migrationStatus FROM NovelRegistry WHERE novelId = ?').get('novel-alpha')).toEqual({
      title: 'Original',
      migrationStatus: 'deleting',
    })

    setActiveWorkspaceNovelId(controlDb, 'novel-safe')
    expect(() => upsertWorkspaceState('singleton', JSON.stringify(createNovelWorkspacePayload('novel-alpha')), {
      novelId: 'novel-alpha',
    })).toThrow('Novel deletion is already in progress or complete')
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')).toEqual({
      value: 'novel-safe',
    })

    const { normalizeWorkspaceState } = await import('@/lib/workspace-state')
    const { persistWorkspaceRuntimeState } = await import('@/lib/server/workspace-resilience')
    await expect(persistWorkspaceRuntimeState(normalizeWorkspaceState(createNovelWorkspacePayload('novel-alpha'))))
      .rejects.toThrow('Novel deletion is already in progress or complete')
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')).toEqual({
      value: 'novel-safe',
    })

    upsertWorkspaceNovelRegistry({ novelId: 'novel-new', title: 'New Novel' })
    expect(controlDb.prepare('SELECT title, migrationStatus FROM NovelRegistry WHERE novelId = ?').get('novel-new')).toEqual({
      title: 'New Novel',
      migrationStatus: 'ready',
    })
    expect(() => resolver.getNovelDb('novel-new')).not.toThrow()
  })

  it('keeps raw singleton sqlite imports limited to resolver and documented control modules', () => {
    expect(listRawSqliteImportFiles()).toEqual([...RAW_SQLITE_IMPORT_ALLOWED_FILES].sort((left, right) => left.localeCompare(right, 'en-US')))
  })

  it('keeps app-setting reads and writes in control.db inside novel scope', async () => {
    const dataRootPath = createTempDataRoot()
    const resolver = await loadResolverModule(dataRootPath)
    const controlDb = resolver.getControlDb()
    const novelDb = resolver.getNovelDb('novel-alpha')
    writeAppSetting(controlDb, 'AI_SETTINGS_V2', 'control-value')
    writeAppSetting(novelDb, 'AI_SETTINGS_V2', 'novel-decoy')

    const { runWithNovelDatabaseAccess } = await import('@/lib/server/database-access')
    const { findAppSettings, upsertAppSettings } = await import('@/lib/server/persistence')
    const scopedRead = runWithNovelDatabaseAccess('novel-alpha', () => findAppSettings(['AI_SETTINGS_V2']))
    await runWithNovelDatabaseAccess('novel-alpha', () => upsertAppSettings([['AI_SETTINGS_V2', 'control-updated']]))

    expect(scopedRead).toMatchObject([{ key: 'AI_SETTINGS_V2', value: 'control-value' }])
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('AI_SETTINGS_V2')).toEqual({ value: 'control-updated' })
    expect(novelDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('AI_SETTINGS_V2')).toEqual({ value: 'novel-decoy' })
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

  it('evicts and removes only the deleted novel storage while leaving sibling routing usable', async () => {
    const dataRootPath = createTempDataRoot()
    const resolver = await loadResolverModule(dataRootPath)
    const controlDb = resolver.getControlDb()
    const alphaDb = resolver.getNovelDb('novel-alpha')
    const betaDb = resolver.getNovelDb('novel-beta')
    const alphaDirectory = path.dirname(getDatabaseFile(alphaDb))
    const betaDirectory = path.dirname(getDatabaseFile(betaDb))
    setActiveWorkspaceNovelId(controlDb, 'novel-alpha')

    for (const novelId of ['novel-alpha', 'novel-beta']) {
      const novelDirectory = path.join(dataRootPath, 'novels', novelId)
      controlDb.prepare(
        `INSERT INTO NovelRegistry (
           novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus
         ) VALUES (?, ?, ?, ?, ?, '1', 'ready')`
      ).run(
        novelId,
        novelId,
        novelId,
        path.join(novelDirectory, 'novel.db'),
        path.join(novelDirectory, 'lancedb'),
      )
    }
    fs.mkdirSync(resolver.getNovelLanceDbPath('novel-alpha'), { recursive: true })
    fs.writeFileSync(path.join(resolver.getNovelLanceDbPath('novel-alpha'), 'index.lance'), 'alpha-index')

    const { DELETE } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await DELETE(new Request('http://localhost/api/workspace?novelId=novel-alpha&nextNovelId=novel-beta', {
      method: 'DELETE',
    }))

    expect(response.status).toBe(200)
    expect(fs.existsSync(alphaDirectory)).toBe(false)
    expect(fs.existsSync(betaDirectory)).toBe(true)
    expect((alphaDb as DatabaseSync & { isOpen: boolean }).isOpen).toBe(false)
    expect(betaDb.prepare('SELECT 1 AS value').get()).toEqual({ value: 1 })
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

  it('routes colliding rewrite, RAG, graph, roleplay, what-if, and continue resources only through the requested novel DB', async () => {
    const dataRootPath = createTempDataRoot()
    const resolver = await loadResolverModule(dataRootPath)
    const alphaDb = resolver.getNovelDb('novel-alpha')
    const betaDb = resolver.getNovelDb('novel-beta')
    seedCollidingNovelRouteFixture(alphaDb, 'novel-alpha', 'Alpha')
    seedCollidingNovelRouteFixture(betaDb, 'novel-beta', 'Beta')

    const generatedPrompts: string[] = []
    vi.doMock('@/lib/server/ai-settings', () => ({
      loadStoredAISettings: () => ({
        rewrite: {
          provider: 'openai-compatible',
          openAICompatible: { baseUrl: 'https://example.test/v1', apiKey: 'test-key', model: 'test-model' },
          ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'ignored' },
        },
      }),
    }))
    vi.doMock('@/lib/server/openai-compatible', () => ({
      generateRewriteWithOpenAICompatible: vi.fn(async (input: { userPrompt: string }) => {
        generatedPrompts.push(input.userPrompt)
        return { enabled: true, content: ['Alpha rewrite result'], usage: { inputTokens: 1, outputTokens: 2 } }
      }),
      streamRewriteWithOpenAICompatible: vi.fn(),
    }))
    vi.doMock('@/lib/server/retrieval-index', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/server/retrieval-index')>()
      return {
        ...actual,
        searchLanceEvidence: vi.fn(async () => ({ matches: [] })),
        deleteBranchRetrievalIndexFromChapter: vi.fn(async () => {}),
      }
    })

    vi.resetModules()
    const [rewriteRoute, contextPreviewRoute, generationContextRoute, graphContextRoute, subgraphRoute, graphEditRoute, graphConfirmRoute, graphRejectRoute, roleplayMessageRoute, whatIfRoute, continueRoute] = await Promise.all([
      import('@/app/api/rewrite/route'),
      import('@/app/api/context-preview/route'),
      import('@/app/api/rag/build-generation-context/route'),
      import('@/app/api/rag/graph-context/route'),
      import('@/app/api/graph/subgraph/route'),
      import('@/app/api/graph/edge/[edgeId]/route'),
      import('@/app/api/graph/edge/[edgeId]/confirm/route'),
      import('@/app/api/graph/edge/[edgeId]/reject/route'),
      import('@/app/api/roleplay/sessions/[sessionId]/messages/route'),
      import('@/app/api/what-if/sessions/[sessionId]/route'),
      import('@/app/api/continue-blocks/route'),
    ])

    const contextBody = {
      novelId: 'novel-alpha',
      branchId: 'novel-alpha:main',
      chapterId: 'shared-chapter',
      selectedText: 'Alpha Hero',
      userInstruction: 'Use only alpha context',
      operationType: 'rewrite',
    }
    const createJsonRequest = (url: string, body: Record<string, unknown>, method = 'POST') => new Request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const previewResponse = await contextPreviewRoute.POST(createJsonRequest('http://localhost/api/context-preview', contextBody))
    expect(previewResponse.status).toBe(200)
    const preview = await previewResponse.json() as { preview: { assembledContext: string } }
    expect(preview.preview.assembledContext).toContain('Alpha')
    expect(preview.preview.assembledContext).not.toContain('Beta')

    const generationResponse = await generationContextRoute.POST(createJsonRequest('http://localhost/api/rag/build-generation-context', contextBody))
    expect(generationResponse.status).toBe(200)
    const generation = await generationResponse.json() as { assembledContext: string }
    expect(generation.assembledContext).toContain('Alpha')
    expect(generation.assembledContext).not.toContain('Beta')

    const rewriteResponse = await rewriteRoute.POST(createJsonRequest('http://localhost/api/rewrite', {
      ...contextBody,
      sourceText: 'Alpha source',
      prompt: 'Rewrite alpha',
      stream: false,
    }))
    expect(rewriteResponse.status).toBe(200)
    expect(generatedPrompts).toHaveLength(1)
    expect(generatedPrompts[0]).toContain('Alpha')
    expect(generatedPrompts[0]).not.toContain('Beta')

    const graphResponse = await graphContextRoute.POST(createJsonRequest('http://localhost/api/rag/graph-context', {
      novelId: 'novel-alpha',
      branchId: 'novel-alpha:main',
      chapterNo: 1,
      selectedText: 'Alpha Hero',
      nearbyText: '',
      operationType: 'rewrite',
      includeLowConfidence: true,
    }))
    expect(graphResponse.status).toBe(200)
    const graph = await graphResponse.json() as { contextText: string }
    expect(graph.contextText).toContain('Alpha')
    expect(graph.contextText).not.toContain('Beta')

    const subgraphResponse = await subgraphRoute.GET(new Request('http://localhost/api/graph/subgraph?novelId=novel-alpha&branchId=novel-alpha%3Amain&chapterNo=1&includeLowConfidence=true&entityId=shared-hero'))
    expect(subgraphResponse.status).toBe(200)
    const subgraph = await subgraphResponse.json() as { nodes: Array<{ label: string }> }
    expect(subgraph.nodes.map((node) => node.label)).toContain('Alpha Hero')
    expect(subgraph.nodes.map((node) => node.label)).not.toContain('Beta Hero')

    const editResponse = await graphEditRoute.PATCH(
      createJsonRequest('http://localhost/api/graph/edge/shared-edge', { novelId: 'novel-alpha', linkType: 'Alpha-edited' }, 'PATCH'),
      { params: Promise.resolve({ edgeId: 'shared-edge' }) },
    )
    expect(editResponse.status).toBe(200)
    expect(alphaDb.prepare('SELECT linkType FROM EntityLink WHERE id = ?').get('shared-edge')).toMatchObject({ linkType: 'Alpha-edited' })
    expect(betaDb.prepare('SELECT linkType FROM EntityLink WHERE id = ?').get('shared-edge')).toMatchObject({ linkType: 'Beta-alliance' })

    const rejectResponse = await graphRejectRoute.POST(
      createJsonRequest('http://localhost/api/graph/edge/shared-edge/reject', { novelId: 'novel-alpha' }),
      { params: Promise.resolve({ edgeId: 'shared-edge' }) },
    )
    expect(rejectResponse.status).toBe(200)
    expect(alphaDb.prepare('SELECT status FROM EntityLink WHERE id = ?').get('shared-edge')).toMatchObject({ status: 'rejected' })
    expect(betaDb.prepare('SELECT status FROM EntityLink WHERE id = ?').get('shared-edge')).toMatchObject({ status: 'ai_generated' })

    const confirmResponse = await graphConfirmRoute.POST(
      createJsonRequest('http://localhost/api/graph/edge/shared-edge/confirm', { novelId: 'novel-alpha' }),
      { params: Promise.resolve({ edgeId: 'shared-edge' }) },
    )
    expect(confirmResponse.status).toBe(200)
    expect(alphaDb.prepare('SELECT status FROM EntityLink WHERE id = ?').get('shared-edge')).toMatchObject({ status: 'user_confirmed' })
    expect(betaDb.prepare('SELECT status FROM EntityLink WHERE id = ?').get('shared-edge')).toMatchObject({ status: 'ai_generated' })

    const messageResponse = await roleplayMessageRoute.POST(
      createJsonRequest('http://localhost/api/roleplay/sessions/shared-roleplay/messages', {
        novelId: 'novel-alpha',
        branchId: 'novel-alpha:main',
        id: 'alpha-message',
        role: 'user',
        content: 'Alpha only message',
      }),
      { params: Promise.resolve({ sessionId: 'shared-roleplay' }) },
    )
    expect(messageResponse.status).toBe(201)
    expect(alphaDb.prepare('SELECT content FROM roleplay_messages WHERE id = ?').get('alpha-message')).toMatchObject({ content: 'Alpha only message' })
    expect(betaDb.prepare('SELECT content FROM roleplay_messages WHERE id = ?').get('alpha-message')).toBeUndefined()

    const whatIfGetResponse = await whatIfRoute.GET(
      new Request('http://localhost/api/what-if/sessions/shared-what-if?novelId=novel-alpha&branchId=novel-alpha%3Amain'),
      { params: Promise.resolve({ sessionId: 'shared-what-if' }) },
    )
    expect(whatIfGetResponse.status).toBe(200)
    await expect(whatIfGetResponse.json()).resolves.toMatchObject({ generatedText: 'Alpha generated' })

    const continueResponse = await continueRoute.PUT(createJsonRequest('http://localhost/api/continue-blocks', {
      novelId: 'novel-alpha',
      branchId: 'novel-alpha:main',
      continueBlockId: 'shared-continue',
      generatedText: 'Alpha regenerated',
      userInstruction: 'Regenerate alpha only',
      selectedText: 'Alpha selected',
      originalText: 'Alpha original',
    }, 'PUT'))
    expect(continueResponse.status).toBe(200)
    expect(alphaDb.prepare('SELECT latest_text, latest_revision_no FROM continue_blocks WHERE id = ?').get('shared-continue')).toMatchObject({ latest_text: 'Alpha regenerated', latest_revision_no: 2 })
    expect(betaDb.prepare('SELECT latest_text, latest_revision_no FROM continue_blocks WHERE id = ?').get('shared-continue')).toMatchObject({ latest_text: 'Beta latest', latest_revision_no: 1 })

    const whatIfDeleteResponse = await whatIfRoute.DELETE(
      new Request('http://localhost/api/what-if/sessions/shared-what-if?novelId=novel-alpha&branchId=novel-alpha%3Amain', { method: 'DELETE' }),
      { params: Promise.resolve({ sessionId: 'shared-what-if' }) },
    )
    expect(whatIfDeleteResponse.status).toBe(200)
    expect(alphaDb.prepare('SELECT id FROM what_if_sessions WHERE id = ?').get('shared-what-if')).toBeUndefined()
    expect(betaDb.prepare('SELECT id FROM what_if_sessions WHERE id = ?').get('shared-what-if')).toMatchObject({ id: 'shared-what-if' })

    const missingNovelResponses = await Promise.all([
      contextPreviewRoute.POST(createJsonRequest('http://localhost/api/context-preview', { ...contextBody, novelId: '' })),
      rewriteRoute.POST(createJsonRequest('http://localhost/api/rewrite', { ...contextBody, novelId: '', sourceText: 'x', prompt: 'x' })),
      graphConfirmRoute.POST(createJsonRequest('http://localhost/api/graph/edge/shared-edge/confirm', {}), { params: Promise.resolve({ edgeId: 'shared-edge' }) }),
      roleplayMessageRoute.POST(createJsonRequest('http://localhost/api/roleplay/sessions/shared-roleplay/messages', { branchId: 'novel-alpha:main', role: 'user', content: 'missing novel' }), { params: Promise.resolve({ sessionId: 'shared-roleplay' }) }),
      whatIfRoute.GET(new Request('http://localhost/api/what-if/sessions/shared-what-if?branchId=novel-alpha%3Amain'), { params: Promise.resolve({ sessionId: 'shared-what-if' }) }),
      continueRoute.PUT(createJsonRequest('http://localhost/api/continue-blocks', { branchId: 'novel-alpha:main', continueBlockId: 'shared-continue', generatedText: 'x', userInstruction: 'x', selectedText: '', originalText: '' }, 'PUT')),
    ])
    expect(missingNovelResponses.map((response) => response.status)).toEqual([400, 400, 400, 400, 400, 400])

    const malformedNovelResponse = await subgraphRoute.GET(new Request('http://localhost/api/graph/subgraph?novelId=..%2Fescape&branchId=novel-alpha%3Amain&chapterNo=1&entityId=shared-hero'))
    expect(malformedNovelResponse.status).toBe(400)

    const wrongOwnerResponse = await roleplayMessageRoute.POST(
      createJsonRequest('http://localhost/api/roleplay/sessions/shared-roleplay/messages', { novelId: 'novel-alpha', branchId: 'novel-alpha:other', role: 'user', content: 'wrong branch' }),
      { params: Promise.resolve({ sessionId: 'shared-roleplay' }) },
    )
    expect(wrongOwnerResponse.status).toBe(404)
  })
})
