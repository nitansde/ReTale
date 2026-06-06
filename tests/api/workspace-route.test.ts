import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }
const API_TEST_TIMEOUT_MS = 30_000

vi.setConfig({ testTimeout: API_TEST_TIMEOUT_MS, hookTimeout: API_TEST_TIMEOUT_MS })

function createTestDatabase(prefix: string) {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  cleanups.push(() => fs.rmSync(tempDirectory, { recursive: true, force: true }))
  const database = initializeDatabase(new DatabaseSync(path.join(tempDirectory, 'test.db')))
  globalForSqlite.sqlite = database
  vi.resetModules()
  return database
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
  persistWorkspaceRuntimeState(normalizeWorkspaceState(payload))
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
  vi.resetModules()

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

describe('workspace route', () => {
  it('repairs a missing workspace from recoverable knowledge data', async () => {
    const database = createTestDatabase('chatbook-workspace-route-recover-missing')
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
    const database = createTestDatabase('chatbook-workspace-route-recover-corrupt')
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
    const database = createTestDatabase('chatbook-workspace-route-recover-empty')
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
    const database = createTestDatabase('chatbook-workspace-route-runtime-with-empty-artifact')
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
    const database = createTestDatabase('chatbook-workspace-route-side-data-survives-blanked-blob')
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
    const database = createTestDatabase('chatbook-workspace-route-side-data-survives-null-artifact')
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
    const database = createTestDatabase('chatbook-workspace-route-runtime-wins-over-artifact')
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
    const database = createTestDatabase('chatbook-workspace-route-corrupt-unrecoverable')
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
    const database = createTestDatabase('chatbook-workspace-route-block-empty-current')
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
    const database = createTestDatabase('chatbook-workspace-route-block-empty-knowledge')
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
    const database = createTestDatabase('chatbook-workspace-route-explicit-reset')
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
      { 'x-chatbook-workspace-reset': 'true' }
    ))

    expect(response.status).toBe(200)
    expect(readWorkspaceRuntimeChapterCount(database)).toBe(0)
    expect(readWorkspaceStatePayload(database)).toMatchObject({ localNovels: [], localChapters: [] })
    expect(readWorkspaceBackups(database)).toMatchObject([
      { reason: 'explicit-reset' },
    ])
    expect(afterCallbacks).toHaveLength(1)

    await afterCallbacks[0]()
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledWith(expect.objectContaining({ localNovels: [], localChapters: [] }))
    expect(readWorkspaceKnowledgeSyncState(database)).toMatchObject({
      startedSourceUpdatedAt: null,
      lastError: null,
    })
  })

  it('returns success without waiting for workspace knowledge sync', async () => {
    const database = createTestDatabase('chatbook-workspace-route-non-blocking-sync')
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
    const database = createTestDatabase('chatbook-workspace-route-sync-error')
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
    const database = createTestDatabase('chatbook-workspace-route-coalesced-sync')
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
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledWith(expect.objectContaining(thirdPayload))
    expect(readWorkspaceKnowledgeSyncState(database)).toMatchObject({
      startedSourceUpdatedAt: null,
      syncedSourceUpdatedAt: expect.any(String),
      lastError: null,
    })
  })

  it('runs the latest persisted workspace knowledge sync after an active sync finishes', async () => {
    const database = createTestDatabase('chatbook-workspace-route-running-coalesced-sync')
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
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledWith(expect.objectContaining(firstPayload))

    await expect(POST(createWorkspaceRequest(secondPayload))).resolves.toMatchObject({ status: 200 })
    await expect(POST(createWorkspaceRequest(thirdPayload))).resolves.toMatchObject({ status: 200 })
    expect(afterCallbacks).toHaveLength(3)
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(1)

    firstSyncControl.resolve?.()
    await backgroundSync
    await runAfterCallbacks(afterCallbacks.slice(1))

    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(2)
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenLastCalledWith(expect.objectContaining(thirdPayload))
  })

  it('rejects malformed workspace JSON with a stable 400 response', async () => {
    const database = createTestDatabase('chatbook-workspace-route-invalid-json')

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
    const database = createTestDatabase('chatbook-workspace-route-backup-retention')
    clearWorkspaceRecoveryData(database)
    seedWorkspaceState(database, createWorkspacePayload('novel-0', 'Initial'))
    const syncWorkspacePayloadToKnowledgeStore = vi.fn(async () => {})

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore,
    }))

    const { POST } = await importWorkspaceRouteWithAfterCallbacks()
    for (let index = 1; index <= 25; index += 1) {
      const response = await POST(createWorkspaceRequest(createWorkspacePayload(`novel-${index}`, `Novel ${index}`)))
      expect(response.status).toBe(200)
    }

    const backups = readWorkspaceBackups(database)
    expect(backups).toHaveLength(20)
    expect(backups.every((backup) => backup.reason === 'workspace-save')).toBe(true)
    expect(JSON.parse(backups[0].payload)).toMatchObject(createWorkspacePayload('novel-24', 'Novel 24'))
    expect(JSON.parse(backups.at(-1)?.payload ?? '{}')).toMatchObject(createWorkspacePayload('novel-5', 'Novel 5'))
  })
})
