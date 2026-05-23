import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }
const API_TEST_TIMEOUT_MS = 30_000

vi.setConfig({ testTimeout: API_TEST_TIMEOUT_MS, hookTimeout: API_TEST_TIMEOUT_MS })

function createTestDatabase(prefix: string) {
  const tempDatabase = createTempDatabaseCopy(prefix)
  cleanups.push(tempDatabase.cleanup)
  const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
  globalForSqlite.sqlite = database
  return database
}

function createWorkspaceRequest(payload: Record<string, unknown>) {
  return new Request('http://localhost/api/workspace', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
    },
  })
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
  it('returns success without waiting for workspace knowledge sync', async () => {
    createTestDatabase('chatbook-workspace-route-non-blocking-sync')

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
    const response = await POST(createWorkspaceRequest({ localNovels: [], localChapters: [] }))

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
    createTestDatabase('chatbook-workspace-route-sync-error')

    const syncError = new Error('sync failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore: vi.fn(async () => {
        throw syncError
      }),
    }))

    const { POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await POST(createWorkspaceRequest({ localNovels: [], localChapters: [] }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true })
    expect(afterCallbacks).toHaveLength(1)

    await afterCallbacks[0]()
    expect(consoleError).toHaveBeenCalledWith('Workspace knowledge sync failed after save:', syncError)
  })

  it('coalesces queued workspace knowledge syncs to the latest saved payload', async () => {
    createTestDatabase('chatbook-workspace-route-coalesced-sync')

    const syncWorkspacePayloadToKnowledgeStore = vi.fn(async () => {})

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore,
    }))

    const { POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const firstPayload = { localNovels: [{ id: 'novel-1', title: 'First' }], localChapters: [] }
    const secondPayload = { localNovels: [{ id: 'novel-1', title: 'Second' }], localChapters: [] }
    const thirdPayload = { localNovels: [{ id: 'novel-1', title: 'Third' }], localChapters: [] }

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
    createTestDatabase('chatbook-workspace-route-running-coalesced-sync')

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
    const firstPayload = { localNovels: [{ id: 'novel-1', title: 'First' }], localChapters: [] }
    const secondPayload = { localNovels: [{ id: 'novel-1', title: 'Second' }], localChapters: [] }
    const thirdPayload = { localNovels: [{ id: 'novel-1', title: 'Third' }], localChapters: [] }

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
})
