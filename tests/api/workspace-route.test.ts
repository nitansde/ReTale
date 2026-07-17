import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'

const cleanups: Array<() => void> = []
const API_TEST_TIMEOUT_MS = 30_000
const originalDataDir = process.env.RETALE_DATA_DIR

function restoreEnvVar(name: 'RETALE_DATA_DIR', originalValue: string | undefined) {
  if (originalValue === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = originalValue
}

vi.setConfig({ testTimeout: API_TEST_TIMEOUT_MS, hookTimeout: API_TEST_TIMEOUT_MS })

async function createTestDatabase(prefix: string, activeNovelId = 'workspace-test') {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  cleanups.push(() => fs.rmSync(tempDirectory, { recursive: true, force: true }))
  process.env.RETALE_DATA_DIR = path.join(tempDirectory, 'data')
  vi.resetModules()

  const { getControlDb, getNovelDb } = await import('@/lib/server/db-resolver')
  const controlDb = getControlDb()
  controlDb.prepare(
    `INSERT INTO AppSetting (id, key, value)
     VALUES (lower(hex(randomblob(16))), ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updatedAt = CURRENT_TIMESTAMP`
  ).run('WORKSPACE_ACTIVE_NOVEL_ID', activeNovelId)

  const database = getNovelDb(activeNovelId)
  return database
}

async function createTestDataRoot(prefix: string, activeNovelId?: string | null) {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  cleanups.push(() => fs.rmSync(tempDirectory, { recursive: true, force: true }))
  process.env.RETALE_DATA_DIR = path.join(tempDirectory, 'data')
  vi.resetModules()

  const { getControlDb, getNovelDb } = await import('@/lib/server/db-resolver')
  const controlDb = getControlDb()
  if (activeNovelId) {
    controlDb.prepare(
      `INSERT INTO AppSetting (id, key, value)
       VALUES (lower(hex(randomblob(16))), ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updatedAt = CURRENT_TIMESTAMP`
    ).run('WORKSPACE_ACTIVE_NOVEL_ID', activeNovelId)
  }

  return { controlDb, getNovelDb }
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

function createWorkspaceDeleteRequest(novelId?: string, nextNovelId?: string) {
  const url = new URL('http://localhost/api/workspace')
  if (novelId !== undefined) url.searchParams.set('novelId', novelId)
  if (nextNovelId !== undefined) url.searchParams.set('nextNovelId', nextNovelId)
  return new Request(url, { method: 'DELETE' })
}

function createWorkspaceDeletionStatusRequest(novelId?: string) {
  const url = new URL('http://localhost/api/workspace')
  url.searchParams.set('deletionStatus', '1')
  if (novelId !== undefined) url.searchParams.set('novelId', novelId)
  return new Request(url)
}

function createWorkspacePayload(novelId = 'novel-1', title = 'First') {
  return {
    localNovels: [{ id: novelId, title, summary: '', tags: ['测试'] }],
    localChapters: [],
  }
}

function createWorkspacePayloadWithSideData(novelId = 'novel-side', title = 'Side Data Novel') {
  return {
    currentNovelId: novelId,
    currentChapterId: `${novelId}-chapter-1`,
    expandedVolumeIds: [`${novelId}-volume-1`],
    localNovels: [{ id: novelId, title, summary: '保留参考面板数据', tags: ['测试', '侧写'] }],
    localVolumes: [{ id: `${novelId}-volume-1`, novelId, title: '第一卷', order: 1 }],
    localChapters: [{
      id: `${novelId}-chapter-1`,
      novelId,
      volumeId: `${novelId}-volume-1`,
      title: '第一章',
      order: 1,
      content: '<p>正文</p>',
      originalContent: '<p>正文</p>',
      status: 'draft',
      wordCount: 2,
      updatedAt: '刚刚',
    }],
    localOutlines: [{
      id: `${novelId}-outline-1`,
      novelId,
      title: '主线大纲',
      type: 'main',
      summary: '保留大纲',
      relatedChapterIds: [`${novelId}-chapter-1`],
    }],
    localCharacters: [{
      id: `${novelId}-character-1`,
      novelId,
      name: '沈砚',
      role: '主角',
      goal: '查明真相',
      trait: '冷静',
      note: '不能丢失',
    }],
    localCharacterRelations: [{
      id: `${novelId}-relation-1`,
      novelId,
      fromCharacterId: `${novelId}-character-1`,
      toCharacterId: `${novelId}-character-1`,
      label: '自我怀疑',
      strength: 'medium',
      status: 'active',
      note: '关系备注',
      chapterIds: [`${novelId}-chapter-1`],
    }],
    localWorldEntries: [{
      id: `${novelId}-world-1`,
      novelId,
      title: '北城档案馆',
      type: 'location',
      content: '世界设定',
    }],
    localTimelineEvents: [{
      id: `${novelId}-timeline-1`,
      novelId,
      title: '暴雨夜',
      phase: '开端',
      worldline: '主线',
      summary: '时间线事件',
      order: 1,
      chapterIds: [`${novelId}-chapter-1`],
    }],
  }
}

function clearWorkspaceRecoveryData(database: DatabaseSync) {
  database.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM WorkspaceKnowledgeSyncState;
    DELETE FROM WorkspaceRuntimeChapter;
    DELETE FROM WorkspaceRuntimeVolume;
    DELETE FROM WorkspaceRuntimeNovel;
    DELETE FROM WorkspaceRuntimeState;
    DELETE FROM WorkspaceStateBackup;
    DELETE FROM WorkspaceState;
    DELETE FROM KnowledgeChapter;
    DELETE FROM StoryBranch;
    DELETE FROM NovelRecord;
    PRAGMA foreign_keys = ON;
  `)
}

async function seedWorkspaceRuntime(payload: Record<string, unknown>) {
  const { normalizeWorkspaceState } = await import('@/lib/workspace-state')
  const { persistWorkspaceRuntimeState } = await import('@/lib/server/workspace-resilience')
  await persistWorkspaceRuntimeState(normalizeWorkspaceState(payload))
}

async function seedWorkspaceRuntimeForNovel(novelId: string, payload: Record<string, unknown>) {
  const { normalizeWorkspaceState } = await import('@/lib/workspace-state')
  const { createNovelDatabaseAccess } = await import('@/lib/server/database-access')
  const { persistWorkspaceRuntimeState } = await import('@/lib/server/workspace-resilience')
  await persistWorkspaceRuntimeState(normalizeWorkspaceState(payload), 'singleton', createNovelDatabaseAccess(novelId))
}

function seedNovelRegistryRow(database: DatabaseSync, novelId: string, title: string) {
  const novelRoot = path.join(process.env.RETALE_DATA_DIR ?? 'data', 'novels', novelId)
  database.prepare(
    `INSERT INTO NovelRegistry (
       novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus
     ) VALUES (?, ?, ?, ?, ?, '1', 'ready')`
  ).run(
    novelId,
    novelId,
    title,
    path.join(novelRoot, 'novel.db'),
    path.join(novelRoot, 'lancedb'),
  )
}

function seedWorkspaceState(database: DatabaseSync, payload: Record<string, unknown> | string | null) {
  const serialized = payload === null ? null : typeof payload === 'string' ? payload : JSON.stringify(payload)
  database.prepare('DELETE FROM WorkspaceState WHERE id = ?').run('singleton')
  database.prepare('INSERT INTO WorkspaceState (id, payload) VALUES (?, ?)').run('singleton', serialized)
}

function seedRecoverableKnowledge(database: DatabaseSync) {
  database.prepare('INSERT INTO NovelRecord (id, title) VALUES (?, ?)').run('novel-recover', 'Recovered Novel')
  database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run('novel-recover:main', 'novel-recover', 'main')
  database.prepare(
    `INSERT INTO KnowledgeChapter (id, novelId, branchId, chapterNo, title, rawText, sourceHash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-recover-1', 'novel-recover', 'novel-recover:main', 1, '第一章', '第一章正文', 'hash-1')
  database.prepare(
    `INSERT INTO KnowledgeChapter (id, novelId, branchId, chapterNo, title, rawText, sourceHash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('chapter-recover-2', 'novel-recover', 'novel-recover:main', 2, '第二章', '第二章正文', 'hash-2')
}

function readWorkspaceStatePayload(database: DatabaseSync) {
  const row = database.prepare('SELECT payload FROM WorkspaceState WHERE id = ?').get('singleton') as { payload: string } | undefined
  return row ? JSON.parse(row.payload) as Record<string, unknown> : null
}

function readWorkspaceStateRawPayload(database: DatabaseSync) {
  const row = database.prepare('SELECT payload FROM WorkspaceState WHERE id = ?').get('singleton') as { payload: string | null } | undefined
  return row?.payload ?? null
}

function loadPayloadSafe(payload: string | null) {
  if (!payload) return null
  return JSON.parse(payload) as Record<string, unknown>
}

function readWorkspaceRuntimeChapterCount(database: DatabaseSync) {
  return (database.prepare('SELECT COUNT(*) AS count FROM WorkspaceRuntimeChapter WHERE workspaceStateId = ?').get('singleton') as { count: number }).count
}

function readWorkspaceBackups(database: DatabaseSync) {
  return database.prepare(
    `SELECT payload, reason FROM WorkspaceStateBackup WHERE workspaceStateId = ? ORDER BY createdAt DESC, rowid DESC`
  ).all('singleton') as Array<{ payload: string; reason: string }>
}

function readWorkspaceKnowledgeSyncState(database: DatabaseSync) {
  return database.prepare(
    `SELECT requestedSourceUpdatedAt, startedSourceUpdatedAt, syncedSourceUpdatedAt, lastError
     FROM WorkspaceKnowledgeSyncState
     WHERE workspaceStateId = ?`
  ).get('singleton') as {
    requestedSourceUpdatedAt: string | null
    startedSourceUpdatedAt: string | null
    syncedSourceUpdatedAt: string | null
    lastError: string | null
  } | undefined
}

async function runAfterCallbacks(afterCallbacks: Array<() => Promise<void>>) {
  for (const callback of afterCallbacks) {
    await callback()
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

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.doUnmock('next/server')
  restoreEnvVar('RETALE_DATA_DIR', originalDataDir)

  return import('@/lib/server/db-resolver').then((resolverModule) => {
    resolverModule.resetResolvedDatabasesForTests()
    vi.resetModules()

    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })
})

describe('workspace route', () => {
  it('permanently deletes the active novel and switches to the supplied survivor without touching control settings', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-delete-active', 'novel-alpha')
    getNovelDb('novel-alpha')
    getNovelDb('novel-beta')
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha')
    seedNovelRegistryRow(controlDb, 'novel-beta', 'Beta')
    controlDb.prepare('INSERT INTO AppSetting (id, key, value) VALUES (?, ?, ?)').run('ai-setting', 'AI_SETTINGS_V2', '{"provider":"test"}')
    controlDb.prepare('INSERT INTO AppSetting (id, key, value) VALUES (?, ?, ?)').run('preset-setting', 'PRESET_COMPAT_LIBRARY_V1', '{"presets":[]}')
    const alphaDirectory = path.join(process.env.RETALE_DATA_DIR ?? 'data', 'novels', 'novel-alpha')
    const betaDirectory = path.join(process.env.RETALE_DATA_DIR ?? 'data', 'novels', 'novel-beta')
    fs.mkdirSync(path.join(alphaDirectory, 'lancedb'), { recursive: true })
    fs.writeFileSync(path.join(alphaDirectory, 'lancedb', 'artifact.lance'), 'alpha')

    const { DELETE } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await DELETE(createWorkspaceDeleteRequest('novel-alpha', 'novel-beta'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      deletedNovelId: 'novel-alpha',
      activeNovelId: 'novel-beta',
      deletionState: 'deleted',
      cleanupPending: false,
    })
    expect(fs.existsSync(alphaDirectory)).toBe(false)
    expect(fs.existsSync(betaDirectory)).toBe(true)
    expect(controlDb.prepare('SELECT novelId, migrationStatus FROM NovelRegistry ORDER BY novelId').all()).toEqual([
      { novelId: 'novel-alpha', migrationStatus: 'deleted' },
      { novelId: 'novel-beta', migrationStatus: 'ready' },
    ])
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')).toEqual({ value: 'novel-beta' })
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('AI_SETTINGS_V2')).toEqual({ value: '{"provider":"test"}' })
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('PRESET_COMPAT_LIBRARY_V1')).toEqual({ value: '{"presets":[]}' })
  })

  it('uses the deterministic first ready survivor when deleting the active novel without an explicit successor', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-delete-fallback', 'novel-target')
    for (const novelId of ['novel-target', 'novel-beta', 'novel-alpha']) {
      getNovelDb(novelId)
      seedNovelRegistryRow(controlDb, novelId, novelId)
    }

    const { DELETE } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await DELETE(createWorkspaceDeleteRequest('novel-target'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, activeNovelId: 'novel-alpha' })
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')).toEqual({ value: 'novel-alpha' })
  })

  it('clears the active setting when permanently deleting the last registered novel', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-delete-last', 'novel-only')
    getNovelDb('novel-only')
    seedNovelRegistryRow(controlDb, 'novel-only', 'Only Novel')

    const { DELETE } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await DELETE(createWorkspaceDeleteRequest('novel-only'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      deletedNovelId: 'novel-only',
      activeNovelId: null,
      deletionState: 'deleted',
      cleanupPending: false,
    })
    expect(controlDb.prepare('SELECT novelId, migrationStatus FROM NovelRegistry').all()).toEqual([
      { novelId: 'novel-only', migrationStatus: 'deleted' },
    ])
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')).toBeUndefined()
  })

  it('keeps the active novel unchanged when deleting a non-active novel', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-delete-inactive', 'novel-alpha')
    for (const novelId of ['novel-alpha', 'novel-beta', 'novel-gamma']) {
      getNovelDb(novelId)
      seedNovelRegistryRow(controlDb, novelId, novelId)
    }

    const { DELETE } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await DELETE(createWorkspaceDeleteRequest('novel-beta', 'novel-gamma'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, activeNovelId: 'novel-alpha' })
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')).toEqual({ value: 'novel-alpha' })
  })

  it('returns typed validation and lookup statuses without creating storage for missing novels', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-delete-statuses', 'novel-alpha')
    getNovelDb('novel-alpha')
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha')
    const novelsDirectory = path.join(process.env.RETALE_DATA_DIR ?? 'data', 'novels')

    const { DELETE } = await importWorkspaceRouteWithAfterCallbacks()
    const missingIdResponse = await DELETE(createWorkspaceDeleteRequest())
    const invalidIdResponse = await DELETE(createWorkspaceDeleteRequest('../escape'))
    const unknownTargetResponse = await DELETE(createWorkspaceDeleteRequest('novel-unknown'))
    const invalidSurvivorResponse = await DELETE(createWorkspaceDeleteRequest('novel-alpha', 'novel-missing'))

    expect(missingIdResponse.status).toBe(400)
    expect(invalidIdResponse.status).toBe(400)
    expect(unknownTargetResponse.status).toBe(404)
    expect(invalidSurvivorResponse.status).toBe(409)
    expect(fs.existsSync(path.join(novelsDirectory, 'novel-unknown'))).toBe(false)
    expect(controlDb.prepare('SELECT novelId FROM NovelRegistry').all()).toEqual([{ novelId: 'novel-alpha' }])
  })

  it('returns exact ready, deleting, and deleted deletion-status payloads before scheduling cleanup', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-deletion-status-contract', 'novel-alpha')
    getNovelDb('novel-alpha')
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha')
    const alphaDirectory = path.join(process.env.RETALE_DATA_DIR ?? 'data', 'novels', 'novel-alpha')

    const { GET, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()

    const readyResponse = await GET(createWorkspaceDeletionStatusRequest('novel-alpha'))
    expect(readyResponse.status).toBe(200)
    await expect(readyResponse.json()).resolves.toEqual({
      ok: true,
      novelId: 'novel-alpha',
      deletionState: 'ready',
    })
    expect(afterCallbacks).toHaveLength(0)

    controlDb.prepare('UPDATE NovelRegistry SET migrationStatus = ? WHERE novelId = ?').run('deleting', 'novel-alpha')
    const deletingResponse = await GET(createWorkspaceDeletionStatusRequest('novel-alpha'))
    expect(deletingResponse.status).toBe(200)
    await expect(deletingResponse.json()).resolves.toEqual({
      ok: true,
      novelId: 'novel-alpha',
      deletionState: 'deleting',
    })
    expect(afterCallbacks).toHaveLength(0)

    controlDb.prepare('UPDATE NovelRegistry SET migrationStatus = ? WHERE novelId = ?').run('deleted', 'novel-alpha')
    const resolverModule = await import('@/lib/server/db-resolver')
    resolverModule.evictNovelStorageCache('novel-alpha')
    fs.rmSync(alphaDirectory, { recursive: true, force: true })

    const deletedResponse = await GET(createWorkspaceDeletionStatusRequest('novel-alpha'))
    expect(deletedResponse.status).toBe(200)
    await expect(deletedResponse.json()).resolves.toEqual({
      ok: true,
      novelId: 'novel-alpha',
      deletionState: 'deleted',
    })
    expect(afterCallbacks).toHaveLength(0)
    expect(fs.existsSync(alphaDirectory)).toBe(false)
  })

  it('returns strict deletion-status errors without coercing unknown registry states', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-deletion-status-errors', 'novel-alpha')
    getNovelDb('novel-alpha')
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha')
    controlDb.prepare('UPDATE NovelRegistry SET migrationStatus = ? WHERE novelId = ?').run('pending', 'novel-alpha')
    const novelsDirectory = path.join(process.env.RETALE_DATA_DIR ?? 'data', 'novels')

    const { GET, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const missingIdResponse = await GET(createWorkspaceDeletionStatusRequest())
    const invalidIdResponse = await GET(createWorkspaceDeletionStatusRequest('../escape'))
    const unknownNovelResponse = await GET(createWorkspaceDeletionStatusRequest('novel-unknown'))
    const unknownStateResponse = await GET(createWorkspaceDeletionStatusRequest('novel-alpha'))

    expect(missingIdResponse.status).toBe(400)
    await expect(missingIdResponse.json()).resolves.toEqual({ ok: false, error: expect.any(String) })
    expect(invalidIdResponse.status).toBe(400)
    await expect(invalidIdResponse.json()).resolves.toEqual({ ok: false, error: expect.any(String) })
    expect(unknownNovelResponse.status).toBe(404)
    await expect(unknownNovelResponse.json()).resolves.toEqual({ ok: false, error: expect.any(String) })
    expect(unknownStateResponse.status).toBe(409)
    await expect(unknownStateResponse.json()).resolves.toEqual({ ok: false, error: expect.any(String) })
    expect(afterCallbacks).toHaveLength(0)
    expect(fs.existsSync(path.join(novelsDirectory, 'novel-unknown'))).toBe(false)
    expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get('novel-alpha')).toEqual({ migrationStatus: 'pending' })
  })

  it('returns 404 for a non-ready target without touching its registry row or storage', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-delete-non-ready', 'novel-pending')
    getNovelDb('novel-pending')
    getNovelDb('novel-ready')
    seedNovelRegistryRow(controlDb, 'novel-pending', 'Pending')
    seedNovelRegistryRow(controlDb, 'novel-ready', 'Ready')
    controlDb.prepare('UPDATE NovelRegistry SET migrationStatus = ? WHERE novelId = ?').run('pending', 'novel-pending')
    const pendingDirectory = path.join(process.env.RETALE_DATA_DIR ?? 'data', 'novels', 'novel-pending')

    const { DELETE } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await DELETE(createWorkspaceDeleteRequest('novel-pending', 'novel-ready'))

    expect(response.status).toBe(404)
    expect(fs.existsSync(pendingDirectory)).toBe(true)
    expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get('novel-pending')).toEqual({ migrationStatus: 'pending' })
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')).toEqual({ value: 'novel-pending' })
  })

  it('replaces an unknown active pointer with the validated requested survivor', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-delete-stale-active-requested', 'novel-stale')
    for (const novelId of ['novel-target', 'novel-alpha', 'novel-gamma']) {
      getNovelDb(novelId)
      seedNovelRegistryRow(controlDb, novelId, novelId)
    }

    const { DELETE } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await DELETE(createWorkspaceDeleteRequest('novel-target', 'novel-gamma'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, activeNovelId: 'novel-gamma' })
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')).toEqual({ value: 'novel-gamma' })
  })

  it('replaces a non-ready active pointer with the deterministic first ready survivor', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-delete-non-ready-active-fallback', 'novel-pending')
    for (const novelId of ['novel-target', 'novel-beta', 'novel-alpha', 'novel-pending']) {
      getNovelDb(novelId)
      seedNovelRegistryRow(controlDb, novelId, novelId)
    }
    controlDb.prepare('UPDATE NovelRegistry SET migrationStatus = ? WHERE novelId = ?').run('pending', 'novel-pending')

    const { DELETE } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await DELETE(createWorkspaceDeleteRequest('novel-target'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, activeNovelId: 'novel-alpha' })
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')).toEqual({ value: 'novel-alpha' })
    expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get('novel-pending')).toEqual({ migrationStatus: 'pending' })
  })

  it('returns 202 and autonomously retries a failed quarantine purge after the response', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-delete-cleanup-failure', 'novel-alpha')
    getNovelDb('novel-alpha')
    getNovelDb('novel-beta')
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha')
    seedNovelRegistryRow(controlDb, 'novel-beta', 'Beta')
    const alphaDirectory = path.join(process.env.RETALE_DATA_DIR ?? 'data', 'novels', 'novel-alpha')
    const quarantineDirectory = path.join(process.env.RETALE_DATA_DIR ?? 'data', '.novel-quarantine', 'novel-alpha')
    const cleanupError = new Error('simulated quarantine purge failure')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementationOnce(() => {
      throw cleanupError
    })

    const { DELETE, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await DELETE(createWorkspaceDeleteRequest('novel-alpha', 'novel-beta'))
    expect(rmSpy).toHaveBeenCalledWith(quarantineDirectory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    })
    rmSpy.mockRestore()

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({ ok: true, cleanupPending: true, deletionState: 'deleted' })
    expect(fs.existsSync(alphaDirectory)).toBe(false)
    expect(fs.existsSync(quarantineDirectory)).toBe(true)
    expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get('novel-alpha')).toEqual({ migrationStatus: 'deleted' })
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')).toEqual({ value: 'novel-beta' })
    expect(consoleError).toHaveBeenCalledWith('Failed to purge quarantined novel storage:', cleanupError)
    expect(afterCallbacks).toHaveLength(1)

    await afterCallbacks[0]()
    expect(fs.existsSync(quarantineDirectory)).toBe(false)
  })

  it('resumes persisted quarantine cleanup from GET after modules restart', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-delete-restart-recovery', 'novel-alpha')
    getNovelDb('novel-alpha')
    getNovelDb('novel-beta')
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha')
    seedNovelRegistryRow(controlDb, 'novel-beta', 'Beta')
    const quarantineDirectory = path.join(process.env.RETALE_DATA_DIR ?? 'data', '.novel-quarantine', 'novel-alpha')
    const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementationOnce(() => {
      throw new Error('simulated process-ending purge failure')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { DELETE } = await importWorkspaceRouteWithAfterCallbacks()
    const deleteResponse = await DELETE(createWorkspaceDeleteRequest('novel-alpha', 'novel-beta'))
    expect(deleteResponse.status).toBe(202)
    expect(fs.existsSync(quarantineDirectory)).toBe(true)
    rmSpy.mockRestore()

    const resolverBeforeRestart = await import('@/lib/server/db-resolver')
    resolverBeforeRestart.resetResolvedDatabasesForTests()
    vi.resetModules()

    const { GET, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const getResponse = await GET()
    expect(getResponse.status).toBe(200)
    expect(fs.existsSync(quarantineDirectory)).toBe(true)
    expect(afterCallbacks).toHaveLength(1)

    await afterCallbacks[0]()
    const { getControlDb } = await import('@/lib/server/db-resolver')
    expect(fs.existsSync(quarantineDirectory)).toBe(false)
    expect(getControlDb().prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get('novel-alpha')).toEqual({ migrationStatus: 'deleted' })
  })

  it('advances bounded GET cleanup scans past completed tombstones', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-bounded-cleanup-progress', null)
    for (let index = 0; index < 25; index += 1) {
      const novelId = `novel-clean-${String(index).padStart(2, '0')}`
      seedNovelRegistryRow(controlDb, novelId, novelId)
      controlDb.prepare('UPDATE NovelRegistry SET migrationStatus = ? WHERE novelId = ?').run('deleted', novelId)
    }

    getNovelDb('novel-pending')
    seedNovelRegistryRow(controlDb, 'novel-pending', 'Pending')
    const pendingDirectory = path.join(process.env.RETALE_DATA_DIR ?? 'data', 'novels', 'novel-pending')
    const quarantineRoot = path.join(process.env.RETALE_DATA_DIR ?? 'data', '.novel-quarantine')
    const quarantineDirectory = path.join(quarantineRoot, 'novel-pending')
    const resolverModule = await import('@/lib/server/db-resolver')
    resolverModule.evictNovelStorageCache('novel-pending')
    fs.mkdirSync(quarantineRoot, { recursive: true })
    fs.renameSync(pendingDirectory, quarantineDirectory)
    controlDb.prepare('UPDATE NovelRegistry SET migrationStatus = ? WHERE novelId = ?').run('deleted', 'novel-pending')

    const { GET, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    expect((await GET()).status).toBe(200)
    expect(afterCallbacks).toHaveLength(1)
    await afterCallbacks[0]()
    expect(fs.existsSync(quarantineDirectory)).toBe(true)

    expect((await GET()).status).toBe(200)
    expect(afterCallbacks).toHaveLength(2)
    await afterCallbacks[1]()
    expect(fs.existsSync(quarantineDirectory)).toBe(false)
  })

  it('keeps tombstones permanent and makes repeated deletion idempotent', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-delete-idempotent', 'novel-alpha')
    getNovelDb('novel-alpha')
    getNovelDb('novel-beta')
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha')
    seedNovelRegistryRow(controlDb, 'novel-beta', 'Beta')
    const alphaDirectory = path.join(process.env.RETALE_DATA_DIR ?? 'data', 'novels', 'novel-alpha')

    const { DELETE } = await importWorkspaceRouteWithAfterCallbacks()
    const firstResponse = await DELETE(createWorkspaceDeleteRequest('novel-alpha', 'novel-beta'))
    const secondResponse = await DELETE(createWorkspaceDeleteRequest('novel-alpha', 'novel-beta'))

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    await expect(secondResponse.json()).resolves.toMatchObject({
      ok: true,
      activeNovelId: 'novel-beta',
      deletionState: 'deleted',
      cleanupPending: false,
    })
    expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get('novel-alpha')).toEqual({ migrationStatus: 'deleted' })
    expect(fs.existsSync(alphaDirectory)).toBe(false)
  })

  it('rejects stale workspace saves without reviving tombstones or recreating storage', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-stale-save', 'novel-alpha')
    getNovelDb('novel-alpha')
    getNovelDb('novel-beta')
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha')
    seedNovelRegistryRow(controlDb, 'novel-beta', 'Beta')
    const alphaDirectory = path.join(process.env.RETALE_DATA_DIR ?? 'data', 'novels', 'novel-alpha')

    const { DELETE, POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    await DELETE(createWorkspaceDeleteRequest('novel-alpha', 'novel-beta'))
    const staleSave = await POST(createWorkspaceRequest(createWorkspacePayload('novel-alpha', 'Stale Alpha')))

    expect(staleSave.status).toBe(409)
    await expect(staleSave.json()).resolves.toMatchObject({ ok: false })
    expect(controlDb.prepare('SELECT title, migrationStatus FROM NovelRegistry WHERE novelId = ?').get('novel-alpha')).toEqual({
      title: 'Alpha',
      migrationStatus: 'deleted',
    })
    expect(fs.existsSync(alphaDirectory)).toBe(false)
    expect(afterCallbacks).toHaveLength(0)
  })

  it('fences a stale save that was queued before deletion publication', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-stale-save-race', 'novel-alpha')
    getNovelDb('novel-alpha')
    getNovelDb('novel-beta')
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha')
    seedNovelRegistryRow(controlDb, 'novel-beta', 'Beta')
    const alphaDirectory = path.join(process.env.RETALE_DATA_DIR ?? 'data', 'novels', 'novel-alpha')
    const quarantineRoot = path.join(process.env.RETALE_DATA_DIR ?? 'data', '.novel-quarantine')
    const quarantineDirectory = path.join(quarantineRoot, 'novel-alpha')
    const gateEntered = Promise.withResolvers<void>()
    const gateRelease = Promise.withResolvers<void>()
    const gateModule = await import('@/lib/server/per-novel-write-gate')
    const resolverModule = await import('@/lib/server/db-resolver')
    const deletionPublication = gateModule.runWithPerNovelWriteGate('novel-alpha', async () => {
      gateEntered.resolve()
      await gateRelease.promise
      controlDb.prepare('UPDATE NovelRegistry SET migrationStatus = ? WHERE novelId = ?').run('deleted', 'novel-alpha')
      controlDb.prepare('UPDATE AppSetting SET value = ? WHERE key = ?').run('novel-beta', 'WORKSPACE_ACTIVE_NOVEL_ID')
      resolverModule.evictNovelStorageCache('novel-alpha')
      fs.mkdirSync(quarantineRoot, { recursive: true })
      fs.renameSync(alphaDirectory, quarantineDirectory)
    })
    await gateEntered.promise

    const { POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const staleSavePromise = POST(createWorkspaceRequest(createWorkspacePayload('novel-alpha', 'Queued Stale Alpha')))
    await Promise.resolve()
    gateRelease.resolve()
    await deletionPublication
    const staleSave = await staleSavePromise

    expect(staleSave.status).toBe(409)
    expect(controlDb.prepare('SELECT title, migrationStatus FROM NovelRegistry WHERE novelId = ?').get('novel-alpha')).toEqual({
      title: 'Alpha',
      migrationStatus: 'deleted',
    })
    expect(fs.existsSync(alphaDirectory)).toBe(false)
    expect(fs.existsSync(quarantineDirectory)).toBe(true)
    expect(afterCallbacks).toHaveLength(0)
  })

  it('returns 409 for queued, running, and paused knowledge jobs without changing metadata or storage', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-active-jobs', 'novel-alpha')
    const alphaDb = getNovelDb('novel-alpha')
    getNovelDb('novel-beta')
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha')
    seedNovelRegistryRow(controlDb, 'novel-beta', 'Beta')
    alphaDb.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run('novel-alpha', 'Alpha', 'workspace')
    alphaDb.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run('novel-alpha:main', 'novel-alpha', 'main')
    alphaDb.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('job-active', 'novel-alpha', 'novel-alpha:main', 'extract_chapter_knowledge', 'queued')
    const alphaDirectory = path.join(process.env.RETALE_DATA_DIR ?? 'data', 'novels', 'novel-alpha')
    const activeSettingBefore = controlDb.prepare('SELECT * FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')

    const { DELETE } = await importWorkspaceRouteWithAfterCallbacks()
    for (const status of ['queued', 'running', 'paused']) {
      alphaDb.prepare('UPDATE KnowledgeJob SET status = ? WHERE id = ?').run(status, 'job-active')
      const response = await DELETE(createWorkspaceDeleteRequest('novel-alpha', 'novel-beta'))
      expect(response.status).toBe(409)
      expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get('novel-alpha')).toEqual({ migrationStatus: 'ready' })
      expect(controlDb.prepare('SELECT * FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')).toEqual(activeSettingBefore)
      expect(fs.existsSync(alphaDirectory)).toBe(true)
    }
  })

  it('returns 409 for pending and started workspace synchronization without changing deletion state', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-active-sync', 'novel-alpha')
    const alphaDb = getNovelDb('novel-alpha')
    getNovelDb('novel-beta')
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha')
    seedNovelRegistryRow(controlDb, 'novel-beta', 'Beta')
    alphaDb.prepare('INSERT INTO WorkspaceState (id, payload) VALUES (?, ?)').run('singleton', '{}')
    alphaDb.prepare(
      `INSERT INTO WorkspaceKnowledgeSyncState (workspaceStateId, requestedRevision, syncedRevision)
       VALUES (?, ?, ?)`,
    ).run('singleton', 2, 1)

    const { DELETE } = await importWorkspaceRouteWithAfterCallbacks()
    const pendingResponse = await DELETE(createWorkspaceDeleteRequest('novel-alpha', 'novel-beta'))
    expect(pendingResponse.status).toBe(409)

    alphaDb.prepare(
      `UPDATE WorkspaceKnowledgeSyncState
       SET syncedRevision = requestedRevision, startedRevision = requestedRevision
       WHERE workspaceStateId = ?`,
    ).run('singleton')
    const startedResponse = await DELETE(createWorkspaceDeleteRequest('novel-alpha', 'novel-beta'))
    expect(startedResponse.status).toBe(409)
    expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get('novel-alpha')).toEqual({ migrationStatus: 'ready' })
  })

  it('compensates exact ready and active metadata when atomic rename fails', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-rename-failure', 'novel-alpha')
    getNovelDb('novel-alpha')
    getNovelDb('novel-beta')
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha')
    seedNovelRegistryRow(controlDb, 'novel-beta', 'Beta')
    const registryBefore = controlDb.prepare('SELECT * FROM NovelRegistry WHERE novelId = ?').get('novel-alpha')
    const activeBefore = controlDb.prepare('SELECT * FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')
    const renameError = new Error('simulated rename failure')
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw renameError
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { DELETE } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await DELETE(createWorkspaceDeleteRequest('novel-alpha', 'novel-beta'))
    renameSpy.mockRestore()

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Failed to permanently delete novel workspace' })
    expect(controlDb.prepare('SELECT * FROM NovelRegistry WHERE novelId = ?').get('novel-alpha')).toEqual(registryBefore)
    expect(controlDb.prepare('SELECT * FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')).toEqual(activeBefore)
    expect(consoleError).toHaveBeenCalledWith('Failed to permanently delete novel workspace:', renameError)
  })

  it('rotates the active-setting token and preserves a newer competing selection during rename compensation', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-rename-compensation-race', 'novel-alpha')
    for (const novelId of ['novel-alpha', 'novel-beta', 'novel-gamma']) {
      getNovelDb(novelId)
      seedNovelRegistryRow(controlDb, novelId, novelId)
    }
    const activeBefore = controlDb.prepare(
      'SELECT id, value FROM AppSetting WHERE key = ?',
    ).get('WORKSPACE_ACTIVE_NOVEL_ID') as { id: string; value: string }
    const observedTargetStates: string[] = []
    let publishedActiveSetting: { id: string; value: string } | undefined
    const renameError = new Error('simulated rename failure after competing active selection')
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      publishedActiveSetting = controlDb.prepare(
        'SELECT id, value FROM AppSetting WHERE key = ?',
      ).get('WORKSPACE_ACTIVE_NOVEL_ID') as { id: string; value: string }
      const target = controlDb.prepare(
        'SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?',
      ).get('novel-alpha') as { migrationStatus: string }
      observedTargetStates.push(target.migrationStatus)
      controlDb.prepare(
        'UPDATE AppSetting SET id = ?, value = ?, updatedAt = CURRENT_TIMESTAMP WHERE key = ?',
      ).run('competing-gamma-selection', 'novel-gamma', 'WORKSPACE_ACTIVE_NOVEL_ID')
      throw renameError
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { DELETE } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await DELETE(createWorkspaceDeleteRequest('novel-alpha', 'novel-beta'))
    renameSpy.mockRestore()

    const targetAfter = controlDb.prepare(
      'SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?',
    ).get('novel-alpha') as { migrationStatus: string }
    observedTargetStates.push(targetAfter.migrationStatus)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Failed to permanently delete novel workspace' })
    expect(publishedActiveSetting?.id).not.toBe(activeBefore.id)
    expect(publishedActiveSetting?.value).toBe('novel-beta')
    expect(observedTargetStates).toEqual(['deleting', 'ready'])
    expect(controlDb.prepare(
      'SELECT id, value FROM AppSetting WHERE key = ?',
    ).get('WORKSPACE_ACTIVE_NOVEL_ID')).toEqual({
      id: 'competing-gamma-selection',
      value: 'novel-gamma',
    })
  })

  it('finalizes a persisted deleting tombstone from the normal GET cleanup scan', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-finalize-failure', 'novel-alpha')
    getNovelDb('novel-alpha')
    getNovelDb('novel-beta')
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha')
    seedNovelRegistryRow(controlDb, 'novel-beta', 'Beta')
    controlDb.exec(
      `CREATE TRIGGER fail_novel_delete_finalize
       BEFORE UPDATE OF migrationStatus ON NovelRegistry
       WHEN NEW.migrationStatus = 'deleted'
       BEGIN
         SELECT RAISE(ABORT, 'simulated finalize failure');
       END;`,
    )
    const alphaDirectory = path.join(process.env.RETALE_DATA_DIR ?? 'data', 'novels', 'novel-alpha')
    const quarantineDirectory = path.join(process.env.RETALE_DATA_DIR ?? 'data', '.novel-quarantine', 'novel-alpha')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { DELETE } = await importWorkspaceRouteWithAfterCallbacks()
    const failedResponse = await DELETE(createWorkspaceDeleteRequest('novel-alpha', 'novel-beta'))
    expect(failedResponse.status).toBe(500)
    expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get('novel-alpha')).toEqual({ migrationStatus: 'deleting' })
    expect(fs.existsSync(alphaDirectory)).toBe(false)
    expect(fs.existsSync(quarantineDirectory)).toBe(true)

    controlDb.exec('DROP TRIGGER fail_novel_delete_finalize')
    vi.resetModules()
    const { GET, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const getResponse = await GET()
    expect(getResponse.status).toBe(200)
    expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get('novel-alpha')).toEqual({ migrationStatus: 'deleting' })
    expect(afterCallbacks).toHaveLength(1)

    await afterCallbacks[0]()
    expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get('novel-alpha')).toEqual({ migrationStatus: 'deleted' })
    expect(fs.existsSync(quarantineDirectory)).toBe(false)
  })

  it('does not let a stale cleanup candidate delete a novel compensated to ready before gate acquisition', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-stale-cleanup-candidate', 'novel-beta')
    getNovelDb('novel-alpha')
    getNovelDb('novel-beta')
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha')
    seedNovelRegistryRow(controlDb, 'novel-beta', 'Beta')
    const alphaDirectory = path.join(process.env.RETALE_DATA_DIR ?? 'data', 'novels', 'novel-alpha')
    const quarantineRoot = path.join(process.env.RETALE_DATA_DIR ?? 'data', '.novel-quarantine')
    const quarantineDirectory = path.join(quarantineRoot, 'novel-alpha')
    const resolverModule = await import('@/lib/server/db-resolver')
    resolverModule.evictNovelStorageCache('novel-alpha')
    fs.mkdirSync(quarantineRoot, { recursive: true })
    fs.renameSync(alphaDirectory, quarantineDirectory)
    controlDb.prepare('UPDATE NovelRegistry SET migrationStatus = ? WHERE novelId = ?').run('deleted', 'novel-alpha')

    const gateEntered = Promise.withResolvers<void>()
    const gateRelease = Promise.withResolvers<void>()
    const gateModule = await import('@/lib/server/per-novel-write-gate')
    const gateBlocker = gateModule.runWithPerNovelWriteGate('novel-alpha', async () => {
      gateEntered.resolve()
      await gateRelease.promise
    })
    await gateEntered.promise

    const { GET, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await GET()
    expect(response.status).toBe(200)
    expect(afterCallbacks).toHaveLength(1)
    const cleanupScan = afterCallbacks[0]()
    await Promise.resolve()

    controlDb.prepare('UPDATE NovelRegistry SET migrationStatus = ? WHERE novelId = ?').run('ready', 'novel-alpha')
    fs.renameSync(quarantineDirectory, alphaDirectory)
    gateRelease.resolve()
    await gateBlocker
    await cleanupScan

    expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get('novel-alpha')).toEqual({ migrationStatus: 'ready' })
    expect(fs.existsSync(alphaDirectory)).toBe(true)
    expect(fs.existsSync(quarantineDirectory)).toBe(false)
  })

  it('rejects symlinked novels roots, target paths, and quarantine roots without touching outside sentinels', async () => {
    for (const scenario of ['novels-root', 'target', 'quarantine-root'] as const) {
      const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `retale-workspace-route-symlink-${scenario}-`))
      cleanups.push(() => fs.rmSync(tempDirectory, { recursive: true, force: true }))
      const dataRoot = path.join(tempDirectory, 'data')
      const outsideRoot = path.join(tempDirectory, 'outside')
      fs.mkdirSync(dataRoot, { recursive: true })
      fs.mkdirSync(outsideRoot, { recursive: true })
      const sentinelPath = path.join(outsideRoot, 'sentinel.txt')
      fs.writeFileSync(sentinelPath, scenario)
      process.env.RETALE_DATA_DIR = dataRoot
      vi.resetModules()
      const { getControlDb, getNovelDb } = await import('@/lib/server/db-resolver')
      const controlDb = getControlDb()

      if (scenario === 'novels-root') {
        fs.symlinkSync(outsideRoot, path.join(dataRoot, 'novels'), 'dir')
      } else if (scenario === 'target') {
        fs.mkdirSync(path.join(dataRoot, 'novels'), { recursive: true })
        fs.symlinkSync(outsideRoot, path.join(dataRoot, 'novels', 'novel-alpha'), 'dir')
      } else {
        getNovelDb('novel-alpha')
        fs.symlinkSync(outsideRoot, path.join(dataRoot, '.novel-quarantine'), 'dir')
      }
      seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha')
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { DELETE } = await importWorkspaceRouteWithAfterCallbacks()
      const response = await DELETE(createWorkspaceDeleteRequest('novel-alpha'))

      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({ ok: false, error: 'Failed to permanently delete novel workspace' })
      expect(fs.readFileSync(sentinelPath, 'utf8')).toBe(scenario)
      expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get('novel-alpha')).toEqual({ migrationStatus: 'ready' })
      expect(consoleError).toHaveBeenCalled()
      const resolver = await import('@/lib/server/db-resolver')
      resolver.resetResolvedDatabasesForTests()
      vi.restoreAllMocks()
    }
  })

  it('rejects a symlinked configured data directory without exposing filesystem details', async () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'retale-workspace-route-symlink-data-root-'))
    cleanups.push(() => fs.rmSync(tempDirectory, { recursive: true, force: true }))
    const realDataRoot = path.join(tempDirectory, 'real-data')
    const linkedDataRoot = path.join(tempDirectory, 'linked-data')
    fs.mkdirSync(realDataRoot, { recursive: true })
    fs.symlinkSync(realDataRoot, linkedDataRoot, 'dir')
    const sentinelPath = path.join(realDataRoot, 'sentinel.txt')
    fs.writeFileSync(sentinelPath, 'preserve-data-root')
    process.env.RETALE_DATA_DIR = linkedDataRoot
    vi.resetModules()
    const { getControlDb } = await import('@/lib/server/db-resolver')
    const controlDb = getControlDb()
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { DELETE } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await DELETE(createWorkspaceDeleteRequest('novel-alpha'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Failed to permanently delete novel workspace' })
    expect(fs.readFileSync(sentinelPath, 'utf8')).toBe('preserve-data-root')
    expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get('novel-alpha')).toEqual({ migrationStatus: 'ready' })
    expect(consoleError).toHaveBeenCalled()
  })

  it('restores registered per-novel runtime libraries when no active novel setting exists', async () => {
    const { controlDb } = await createTestDataRoot('retale-workspace-route-registry-fallback', null)

    await seedWorkspaceRuntimeForNovel('novel-alpha', createWorkspacePayloadWithSideData('novel-alpha', 'Alpha Library'))
    await seedWorkspaceRuntimeForNovel('novel-beta', createWorkspacePayloadWithSideData('novel-beta', 'Beta Library'))
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha Library')
    seedNovelRegistryRow(controlDb, 'novel-beta', 'Beta Library')

    const { GET } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.localNovels).toMatchObject([
      { id: 'novel-alpha', title: 'Alpha Library' },
      { id: 'novel-beta', title: 'Beta Library' },
    ])
    expect(payload.localVolumes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'novel-alpha-volume-1', novelId: 'novel-alpha' }),
      expect.objectContaining({ id: 'novel-beta-volume-1', novelId: 'novel-beta' }),
    ]))
    expect(payload.localChapters).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'novel-alpha-chapter-1', novelId: 'novel-alpha' }),
      expect.objectContaining({ id: 'novel-beta-chapter-1', novelId: 'novel-beta' }),
    ]))
    expect(payload.currentNovelId).toBe('novel-alpha')
    expect(payload.currentChapterId).toBe('novel-alpha-chapter-1')
  })

  it('restores all registered per-novel runtime libraries even when an active novel setting exists', async () => {
    const { controlDb } = await createTestDataRoot('retale-workspace-route-registry-with-active', 'novel-beta')

    await seedWorkspaceRuntimeForNovel('novel-alpha', createWorkspacePayloadWithSideData('novel-alpha', 'Alpha Library'))
    await seedWorkspaceRuntimeForNovel('novel-beta', createWorkspacePayloadWithSideData('novel-beta', 'Beta Library'))
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha Library')
    seedNovelRegistryRow(controlDb, 'novel-beta', 'Beta Library')

    const { GET } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.localNovels).toMatchObject([
      { id: 'novel-beta', title: 'Beta Library' },
      { id: 'novel-alpha', title: 'Alpha Library' },
    ])
    expect(payload.localVolumes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'novel-alpha-volume-1', novelId: 'novel-alpha' }),
      expect.objectContaining({ id: 'novel-beta-volume-1', novelId: 'novel-beta' }),
    ]))
    expect(payload.localChapters).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'novel-alpha-chapter-1', novelId: 'novel-alpha' }),
      expect.objectContaining({ id: 'novel-beta-chapter-1', novelId: 'novel-beta' }),
    ]))
    expect(payload.currentNovelId).toBe('novel-beta')
    expect(payload.currentChapterId).toBe('novel-beta-chapter-1')
  })

  it('repairs a missing workspace from recoverable knowledge data', async () => {
    const database = await createTestDatabase('retale-workspace-route-recover-missing', 'novel-recover')
    clearWorkspaceRecoveryData(database)
    seedRecoverableKnowledge(database)

    const { GET } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.localNovels).toHaveLength(1)
    expect(payload.localChapters).toHaveLength(2)
    expect(payload.localNovels[0]).toMatchObject({ id: 'novel-recover', title: 'Recovered Novel' })
    expect(readWorkspaceRuntimeChapterCount(database)).toBe(2)
    expect(readWorkspaceStateRawPayload(database)).toBeNull()
    expect(readWorkspaceBackups(database)).toHaveLength(0)
  })

  it('repairs a corrupt workspace by rebuilding normalized runtime state from recoverable knowledge data', async () => {
    const database = await createTestDatabase('retale-workspace-route-recover-corrupt', 'novel-recover')
    clearWorkspaceRecoveryData(database)
    seedWorkspaceState(database, '{not-json')
    seedRecoverableKnowledge(database)

    const { GET } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.localNovels).toHaveLength(1)
    expect(payload.localChapters).toHaveLength(2)
    expect(readWorkspaceRuntimeChapterCount(database)).toBe(2)
    expect(readWorkspaceStateRawPayload(database)).toBe('{not-json')
    expect(readWorkspaceBackups(database)).toHaveLength(0)
  })

  it('repairs an empty workspace when knowledge data is still recoverable', async () => {
    const database = await createTestDatabase('retale-workspace-route-recover-empty', 'novel-recover')
    clearWorkspaceRecoveryData(database)
    seedWorkspaceState(database, { localNovels: [], localChapters: [] })
    seedRecoverableKnowledge(database)

    const { GET } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.localNovels).toHaveLength(1)
    expect(payload.localChapters).toHaveLength(2)
    expect(readWorkspaceRuntimeChapterCount(database)).toBe(2)
    expect(readWorkspaceBackups(database)).toHaveLength(0)
  })

  it('serves normalized runtime state even when the workspace artifact payload is empty', async () => {
    const database = await createTestDatabase('retale-workspace-route-runtime-with-empty-artifact', 'novel-runtime')
    clearWorkspaceRecoveryData(database)
    await seedWorkspaceRuntime(createWorkspacePayload('novel-runtime', 'Runtime Truth'))
    seedWorkspaceState(database, '')

    const { GET } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.localNovels).toMatchObject([{ id: 'novel-runtime', title: 'Runtime Truth' }])
    expect(readWorkspaceRuntimeChapterCount(database)).toBe(0)
    expect(readWorkspaceStateRawPayload(database)).toBe('')
  })

  it('preserves outlines, characters, relations, world entries, and timeline events after the artifact payload is blanked', async () => {
    const database = await createTestDatabase('retale-workspace-route-side-data-survives-blanked-blob', 'novel-side')
    clearWorkspaceRecoveryData(database)
    const payloadWithSideData = createWorkspacePayloadWithSideData()
    await seedWorkspaceRuntime(payloadWithSideData)
    seedWorkspaceState(database, '')

    const { GET } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.localOutlines).toMatchObject([{ title: '主线大纲' }])
    expect(payload.localCharacters).toMatchObject([{ name: '沈砚' }])
    expect(payload.localCharacterRelations).toMatchObject([{ label: '自我怀疑' }])
    expect(payload.localWorldEntries).toMatchObject([{ title: '北城档案馆' }])
    expect(payload.localTimelineEvents).toMatchObject([{ title: '暴雨夜' }])
    expect(payload.localChapters).toMatchObject([{ title: '第一章' }])
  })

  it('preserves normalized runtime side/reference data when a real workspace artifact row exists with payload = NULL', async () => {
    const database = await createTestDatabase('retale-workspace-route-side-data-survives-null-artifact', 'novel-null-artifact')
    clearWorkspaceRecoveryData(database)
    const payloadWithSideData = createWorkspacePayloadWithSideData('novel-null-artifact', 'Null Artifact Runtime Truth')
    await seedWorkspaceRuntime(payloadWithSideData)
    seedWorkspaceState(database, null)

    const { GET } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.localNovels).toMatchObject([{ id: 'novel-null-artifact', title: 'Null Artifact Runtime Truth' }])
    expect(payload.localOutlines).toMatchObject([{ title: '主线大纲' }])
    expect(payload.localCharacters).toMatchObject([{ name: '沈砚' }])
    expect(payload.localCharacterRelations).toMatchObject([{ label: '自我怀疑' }])
    expect(payload.localWorldEntries).toMatchObject([{ title: '北城档案馆' }])
    expect(payload.localTimelineEvents).toMatchObject([{ title: '暴雨夜' }])
    expect(readWorkspaceStateRawPayload(database)).toBeNull()
  })

  it('prefers normalized runtime state over a stale or invalid workspace artifact during normal GET', async () => {
    const database = await createTestDatabase('retale-workspace-route-runtime-wins-over-artifact', 'novel-runtime')
    clearWorkspaceRecoveryData(database)
    await seedWorkspaceRuntime(createWorkspacePayloadWithSideData('novel-runtime', 'Runtime Winner'))
    seedWorkspaceState(database, '{not-json')

    const { GET } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.localNovels).toMatchObject([{ id: 'novel-runtime', title: 'Runtime Winner' }])
    expect(payload.localOutlines).toMatchObject([{ title: '主线大纲' }])
    expect(readWorkspaceStateRawPayload(database)).toBe('{not-json')
  })

  it('ignores a corrupt workspace artifact during normal GET when no normalized runtime or recovery source exists', async () => {
    const database = await createTestDatabase('retale-workspace-route-corrupt-unrecoverable', 'novel-corrupt')
    clearWorkspaceRecoveryData(database)
    seedWorkspaceState(database, '{not-json')

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { GET } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.localNovels).toEqual([])
    expect(payload.localChapters).toEqual([])
    expect(consoleError).not.toHaveBeenCalled()
    expect(readWorkspaceBackups(database)).toHaveLength(0)
  })

  it('rejects accidental empty overwrites when the saved workspace has content', async () => {
    const database = await createTestDatabase('retale-workspace-route-block-empty-current', 'novel-existing')
    clearWorkspaceRecoveryData(database)
    const currentPayload = createWorkspacePayload('novel-existing', 'Existing')
    await seedWorkspaceRuntime(currentPayload)
    const syncWorkspacePayloadToKnowledgeStore = vi.fn(async () => {})

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore,
    }))

    const { POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await POST(createWorkspaceRequest({ localNovels: [], localChapters: [] }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ ok: false })
    expect(readWorkspaceStateRawPayload(database)).toBeNull()
    expect(readWorkspaceRuntimeChapterCount(database)).toBe(0)
    expect(readWorkspaceBackups(database)).toHaveLength(0)
    expect(readWorkspaceKnowledgeSyncState(database)).toBeUndefined()
    expect(afterCallbacks).toHaveLength(0)
    expect(syncWorkspacePayloadToKnowledgeStore).not.toHaveBeenCalled()
  })

  it('rejects accidental empty overwrites when only knowledge data is recoverable', async () => {
    const database = await createTestDatabase('retale-workspace-route-block-empty-knowledge', 'novel-recover')
    clearWorkspaceRecoveryData(database)
    seedRecoverableKnowledge(database)
    const syncWorkspacePayloadToKnowledgeStore = vi.fn(async () => {})

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore,
    }))

    const { POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await POST(createWorkspaceRequest({ localNovels: [], localChapters: [] }))

    expect(response.status).toBe(409)
    expect(readWorkspaceStatePayload(database)).toBeNull()
    expect(readWorkspaceBackups(database)).toHaveLength(0)
    expect(afterCallbacks).toHaveLength(0)
    expect(syncWorkspacePayloadToKnowledgeStore).not.toHaveBeenCalled()
  })

  it('allows explicit empty reset requests and backs up the previous workspace', async () => {
    const database = await createTestDatabase('retale-workspace-route-explicit-reset', 'novel-existing')
    clearWorkspaceRecoveryData(database)
    const currentPayload = createWorkspacePayload('novel-existing', 'Existing')
    await seedWorkspaceRuntime(currentPayload)
    seedWorkspaceState(database, currentPayload)
    const syncWorkspacePayloadToKnowledgeStore = vi.fn(async () => {})

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore,
    }))

    const { POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await POST(createWorkspaceRequest(
      { localNovels: [], localChapters: [] },
      { 'x-retale-workspace-reset': 'true' }
    ))

    expect(response.status).toBe(200)
    expect(readWorkspaceRuntimeChapterCount(database)).toBe(0)
    expect(readWorkspaceStatePayload(database)).toMatchObject({ localNovels: [], localChapters: [] })
    expect(readWorkspaceBackups(database)).toMatchObject([
      { reason: 'explicit-reset' },
    ])
    expect(afterCallbacks).toHaveLength(1)

    await afterCallbacks[0]()
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledWith(
      expect.objectContaining({
        localNovels: [],
        localChapters: [],
        syncScope: 'target-novel',
      }),
      expect.objectContaining({
        db: expect.any(Object),
      }),
    )
    expect(readWorkspaceKnowledgeSyncState(database)).toMatchObject({
      startedSourceUpdatedAt: null,
      lastError: null,
    })
  })

  it('returns success without waiting for workspace knowledge sync', async () => {
    const database = await createTestDatabase('retale-workspace-route-non-blocking-sync', 'novel-1')
    clearWorkspaceRecoveryData(database)

    const syncControl: { resolve: null | (() => void) } = { resolve: null }
    const syncWorkspacePayloadToKnowledgeStore = vi.fn(
      () => new Promise<void>((resolve) => {
        syncControl.resolve = () => resolve()
      })
    )

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore,
    }))

    const { POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await POST(createWorkspaceRequest(createWorkspacePayload()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true })
    expect(readWorkspaceRuntimeChapterCount(database)).toBe(0)
    expect(syncWorkspacePayloadToKnowledgeStore).not.toHaveBeenCalled()
    expect(afterCallbacks).toHaveLength(1)

    const backgroundSync = afterCallbacks[0]()
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(1)

    syncControl.resolve?.()
    await backgroundSync
    expect(readWorkspaceKnowledgeSyncState(database)).toMatchObject({
      startedSourceUpdatedAt: null,
      lastError: null,
    })
  })

  it('logs workspace knowledge sync failures without failing the save response', async () => {
    const database = await createTestDatabase('retale-workspace-route-sync-error', 'novel-1')
    clearWorkspaceRecoveryData(database)

    const syncError = new Error('sync failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore: vi.fn(async () => {
        throw syncError
      }),
    }))

    const { POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await POST(createWorkspaceRequest(createWorkspacePayload()))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true })
    expect(readWorkspaceRuntimeChapterCount(database)).toBe(0)
    expect(afterCallbacks).toHaveLength(1)

    await afterCallbacks[0]()
    expect(consoleError).toHaveBeenCalledWith('Workspace knowledge sync failed after save:', syncError)
    expect(readWorkspaceKnowledgeSyncState(database)).toMatchObject({
      startedSourceUpdatedAt: null,
      syncedSourceUpdatedAt: null,
      lastError: 'sync failed',
    })
  })

  it('coalesces persisted workspace knowledge syncs to the latest saved payload', async () => {
    const database = await createTestDatabase('retale-workspace-route-coalesced-sync', 'novel-1')
    clearWorkspaceRecoveryData(database)

    const syncWorkspacePayloadToKnowledgeStore = vi.fn(async () => {})

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore,
    }))

    const { POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const firstPayload = createWorkspacePayload('novel-1', 'First')
    const secondPayload = createWorkspacePayload('novel-1', 'Second')
    const thirdPayload = createWorkspacePayload('novel-1', 'Third')

    await expect(POST(createWorkspaceRequest(firstPayload))).resolves.toMatchObject({ status: 200 })
    await expect(POST(createWorkspaceRequest(secondPayload))).resolves.toMatchObject({ status: 200 })
    await expect(POST(createWorkspaceRequest(thirdPayload))).resolves.toMatchObject({ status: 200 })

    expect(loadPayloadSafe(readWorkspaceStateRawPayload(database))).toMatchObject(thirdPayload)
    expect(syncWorkspacePayloadToKnowledgeStore).not.toHaveBeenCalled()
    expect(afterCallbacks).toHaveLength(3)

    await runAfterCallbacks(afterCallbacks)
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(1)
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledWith(
      expect.objectContaining({
        ...thirdPayload,
        syncScope: 'target-novel',
      }),
      expect.objectContaining({
        db: expect.any(Object),
      }),
    )
    expect(readWorkspaceKnowledgeSyncState(database)).toMatchObject({
      startedSourceUpdatedAt: null,
      syncedSourceUpdatedAt: expect.any(String),
      lastError: null,
    })
  })

  it('runs the latest persisted workspace knowledge sync after an active sync finishes', async () => {
    const database = await createTestDatabase('retale-workspace-route-running-coalesced-sync', 'novel-1')
    clearWorkspaceRecoveryData(database)

    const firstSyncControl: { resolve: null | (() => void) } = { resolve: null }
    const syncWorkspacePayloadToKnowledgeStore = vi.fn(
      () => syncWorkspacePayloadToKnowledgeStore.mock.calls.length === 1
        ? new Promise<void>((resolve) => {
          firstSyncControl.resolve = () => resolve()
        })
        : Promise.resolve()
    )

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore,
    }))

    const { POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const firstPayload = createWorkspacePayload('novel-1', 'First')
    const secondPayload = createWorkspacePayload('novel-1', 'Second')
    const thirdPayload = createWorkspacePayload('novel-1', 'Third')

    await expect(POST(createWorkspaceRequest(firstPayload))).resolves.toMatchObject({ status: 200 })
    expect(afterCallbacks).toHaveLength(1)

    const backgroundSync = afterCallbacks[0]()
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(1)
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledWith(
      expect.objectContaining({
        ...firstPayload,
        syncScope: 'target-novel',
      }),
      expect.objectContaining({
        db: expect.any(Object),
      }),
    )

    await expect(POST(createWorkspaceRequest(secondPayload))).resolves.toMatchObject({ status: 200 })
    await expect(POST(createWorkspaceRequest(thirdPayload))).resolves.toMatchObject({ status: 200 })
    expect(afterCallbacks).toHaveLength(3)
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(1)

    firstSyncControl.resolve?.()
    await backgroundSync
    await runAfterCallbacks(afterCallbacks.slice(1))

    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(2)
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ...thirdPayload,
        syncScope: 'target-novel',
      }),
      expect.objectContaining({
        db: expect.any(Object),
      }),
    )
  })

  it('rejects malformed workspace JSON with a stable 400 response', async () => {
    const database = await createTestDatabase('retale-workspace-route-invalid-json', 'novel-1')

    const { POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await POST(new Request('http://localhost/api/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ ok: false, error: '工作区 JSON 无效，请刷新页面后重试。' })
    expect(readWorkspaceRuntimeChapterCount(database)).toBe(0)
    expect(afterCallbacks).toHaveLength(0)
  })

  it('backs up normal workspace overwrites and retains only recent snapshots', async () => {
    const database = await createTestDatabase('retale-workspace-route-backup-retention', 'novel-1')
    clearWorkspaceRecoveryData(database)
    seedWorkspaceState(database, createWorkspacePayload('novel-1', 'Initial'))
    const syncWorkspacePayloadToKnowledgeStore = vi.fn(async () => {})

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore,
    }))

    const { POST } = await importWorkspaceRouteWithAfterCallbacks()
    for (let index = 1; index <= 25; index += 1) {
      const response = await POST(createWorkspaceRequest(createWorkspacePayload('novel-1', `Novel ${index}`)))
      expect(response.status).toBe(200)
    }

    const backups = readWorkspaceBackups(database)
    expect(backups).toHaveLength(20)
    expect(backups.every((backup) => backup.reason === 'workspace-save')).toBe(true)
    expect(JSON.parse(backups[0].payload)).toMatchObject(createWorkspacePayload('novel-1', 'Novel 24'))
    expect(JSON.parse(backups.at(-1)?.payload ?? '{}')).toMatchObject(createWorkspacePayload('novel-1', 'Novel 5'))
  })
})
