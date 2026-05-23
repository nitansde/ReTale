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

function clearWorkspaceRecoveryData(database: DatabaseSync) {
  database.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM WorkspaceStateBackup;
    DELETE FROM WorkspaceState;
    DELETE FROM KnowledgeChapter;
    DELETE FROM StoryBranch;
    DELETE FROM NovelRecord;
    PRAGMA foreign_keys = ON;
  `)
}

function seedWorkspaceState(database: DatabaseSync, payload: Record<string, unknown> | string) {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload)
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

function readWorkspaceBackups(database: DatabaseSync) {
  return database.prepare(
    `SELECT payload, reason FROM WorkspaceStateBackup WHERE workspaceStateId = ? ORDER BY createdAt DESC, rowid DESC`
  ).all('singleton') as Array<{ payload: string; reason: string }>
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
    expect(readWorkspaceStatePayload(database)?.localChapters).toHaveLength(2)
    expect(readWorkspaceBackups(database)).toHaveLength(0)
  })

  it('repairs a corrupt workspace and snapshots the corrupt payload', async () => {
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
    expect(readWorkspaceStatePayload(database)?.localNovels).toHaveLength(1)
    expect(readWorkspaceBackups(database)).toMatchObject([
      { payload: '{not-json', reason: 'recover-corrupt' },
    ])
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
    expect(readWorkspaceBackups(database)).toMatchObject([
      { reason: 'recover-empty' },
    ])
  })

  it('returns an error for corrupt workspace payloads when no recovery source exists', async () => {
    const database = createTestDatabase('chatbook-workspace-route-corrupt-unrecoverable')
    clearWorkspaceRecoveryData(database)
    seedWorkspaceState(database, '{not-json')

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { GET } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await GET()

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Failed to restore saved workspace payload' })
    expect(consoleError).toHaveBeenCalled()
    expect(readWorkspaceBackups(database)).toHaveLength(0)
  })

  it('rejects accidental empty overwrites when the saved workspace has content', async () => {
    const database = createTestDatabase('chatbook-workspace-route-block-empty-current')
    clearWorkspaceRecoveryData(database)
    const currentPayload = createWorkspacePayload('novel-existing', 'Existing')
    seedWorkspaceState(database, currentPayload)
    const syncWorkspacePayloadToKnowledgeStore = vi.fn(async () => {})

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore,
    }))

    const { POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await POST(createWorkspaceRequest({ localNovels: [], localChapters: [] }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ ok: false })
    expect(readWorkspaceStatePayload(database)).toMatchObject(currentPayload)
    expect(readWorkspaceBackups(database)).toHaveLength(0)
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
    expect(readWorkspaceStatePayload(database)).toMatchObject({ localNovels: [], localChapters: [] })
    expect(readWorkspaceBackups(database)).toMatchObject([
      { reason: 'explicit-reset' },
    ])
    expect(afterCallbacks).toHaveLength(1)

    await afterCallbacks[0]()
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledWith({ localNovels: [], localChapters: [] })
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
    expect(syncWorkspacePayloadToKnowledgeStore).not.toHaveBeenCalled()
    expect(afterCallbacks).toHaveLength(1)

    const backgroundSync = afterCallbacks[0]()
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(1)

    syncControl.resolve?.()
    await backgroundSync
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
    expect(afterCallbacks).toHaveLength(1)

    await afterCallbacks[0]()
    expect(consoleError).toHaveBeenCalledWith('Workspace knowledge sync failed after save:', syncError)
  })

  it('coalesces queued workspace knowledge syncs to the latest saved payload', async () => {
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

    expect(syncWorkspacePayloadToKnowledgeStore).not.toHaveBeenCalled()
    expect(afterCallbacks).toHaveLength(1)

    await afterCallbacks[0]()
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(1)
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledWith(thirdPayload)
  })

  it('runs the latest queued workspace knowledge sync after an active sync finishes', async () => {
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
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledWith(firstPayload)

    await expect(POST(createWorkspaceRequest(secondPayload))).resolves.toMatchObject({ status: 200 })
    await expect(POST(createWorkspaceRequest(thirdPayload))).resolves.toMatchObject({ status: 200 })
    expect(afterCallbacks).toHaveLength(1)
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(1)

    firstSyncControl.resolve?.()
    await backgroundSync

    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(2)
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenLastCalledWith(thirdPayload)
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
