import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }
const MAX_TXT_FILE_SIZE_BYTES = 10 * 1024 * 1024
const MAX_IMPORT_BODY_SIZE_BYTES = MAX_TXT_FILE_SIZE_BYTES + 256 * 1024
const originalDataDir = process.env.RETALE_DATA_DIR

async function createTestDataRoot(prefix: string, activeNovelId?: string) {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  cleanups.push(() => fs.rmSync(tempDirectory, { recursive: true, force: true }))
  process.env.RETALE_DATA_DIR = path.join(tempDirectory, 'data')
  vi.resetModules()
  const { getControlDb, getNovelDb } = await import('@/lib/server/db-resolver')
  const controlDb = getControlDb()
  if (activeNovelId) {
    const paths = path.join(process.env.RETALE_DATA_DIR, 'novels', activeNovelId)
    controlDb.prepare(
      `INSERT INTO NovelRegistry (novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus)
       VALUES (?, ?, ?, ?, ?, '1', 'ready')`,
    ).run(activeNovelId, activeNovelId, activeNovelId, path.join(paths, 'novel.db'), path.join(paths, 'lancedb'))
    controlDb.prepare('INSERT INTO AppSetting (id, key, value) VALUES (?, ?, ?)').run(
      `active-${activeNovelId}`,
      'WORKSPACE_ACTIVE_NOVEL_ID',
      activeNovelId,
    )
    getNovelDb(activeNovelId)
  }
  return { controlDb, getNovelDb }
}

async function importRouteWithAfterCallbacks() {
  const afterCallbacks: Array<() => Promise<void>> = []
  vi.stubEnv('NODE_ENV', 'development')
  vi.doMock('next/server', async (importOriginal) => {
    const actual = await importOriginal<typeof import('next/server')>()
    return {
      ...actual,
      after: vi.fn((callback: () => Promise<void>) => afterCallbacks.push(callback)),
    }
  })
  const route = await import('@/app/api/import-txt/route')
  return { ...route, afterCallbacks }
}

function createTestDatabase(prefix: string) {
  const tempDatabase = createTempDatabaseCopy(prefix)
  cleanups.push(tempDatabase.cleanup)
  const database = initializeDatabase(new DatabaseSync(tempDatabase.dbPath))
  globalForSqlite.sqlite = database
  return database
}

function resetWorkspaceState(database: DatabaseSync) {
  database.prepare('DELETE FROM WorkspaceRuntimeChapter').run()
  database.prepare('DELETE FROM WorkspaceRuntimeVolume').run()
  database.prepare('DELETE FROM WorkspaceRuntimeNovel').run()
  database.prepare('DELETE FROM WorkspaceRuntimeState').run()
  database.prepare('DELETE FROM WorkspaceState').run()
  database.prepare('INSERT INTO WorkspaceState (id, payload) VALUES (?, ?)').run('singleton', '{}')
}

function readWorkspaceRuntimeCounts(database: DatabaseSync) {
  return {
    novels: (database.prepare('SELECT COUNT(*) AS count FROM WorkspaceRuntimeNovel WHERE workspaceStateId = ?').get('singleton') as { count: number }).count,
    chapters: (database.prepare('SELECT COUNT(*) AS count FROM WorkspaceRuntimeChapter WHERE workspaceStateId = ?').get('singleton') as { count: number }).count,
  }
}

function createImportRequest(headers: Record<string, string> = {}, url = 'http://localhost/api/import-txt') {
  const formData = new FormData()
  formData.set(
    'file',
    new File(
      [[
        '合成测试故事\n',
        '内容简介：命运从未固定。\n\n',
        '第1章 初遇\n',
        '林澄开始记录这次练习。\n\n',
        '第2章 决断\n',
        '他决定改变既定命运。\n',
      ].join('')],
      'workspace-import-smoke.txt',
      { type: 'text/plain' }
    )
  )

  return new Request(url, {
    method: 'POST',
    body: formData,
    headers,
  })
}

function createGb18030ImportRequest() {
  const gb18030Bytes = new Uint8Array([
    177, 190, 202, 233, 211, 201, 161, 190, 202, 190, 192, 253, 215, 233, 161, 191, 213, 251, 192, 237, 10, 10, 181, 218, 49, 213, 194, 32, 179, 245, 211, 246, 10, 193, 214, 179, 206, 191, 170, 202, 188, 188, 199, 194, 188, 213, 226, 180, 206, 193, 183, 207, 176, 161, 163, 10,
  ])
  const formData = new FormData()
  formData.set('file', new File([gb18030Bytes], 'gb18030-novel.txt', { type: 'text/plain' }))

  return new Request('http://localhost/api/import-txt', {
    method: 'POST',
    body: formData,
  })
}

function mockImportSideEffects() {
  const backfillWorkspaceRuntimeFromArtifactIfMissing = vi.fn(async () => {})
  const loadWorkspacePayloadFromRuntimeOrRecovery = vi.fn(async () => ({}))
  const createWorkspaceNovelFromSnapshot = vi.fn(async (params: { novelId: string }) => ({
    ok: true as const,
    operation: 'full-snapshot' as const,
    novelId: params.novelId,
    revision: 1,
    updatedAt: 'now',
    replayed: false,
    shouldScheduleKnowledgeSync: true,
  }))

  vi.doMock('@/lib/server/workspace-resilience', () => ({
    backfillWorkspaceRuntimeFromArtifactIfMissing,
    loadWorkspacePayloadFromRuntimeOrRecovery,
  }))
  vi.doMock('@/lib/server/workspace-mutation', () => ({ createWorkspaceNovelFromSnapshot }))

  return {
    backfillWorkspaceRuntimeFromArtifactIfMissing,
    loadWorkspacePayloadFromRuntimeOrRecovery,
    createWorkspaceNovelFromSnapshot,
  }
}

function expectNoImportSideEffects(sideEffects: ReturnType<typeof mockImportSideEffects>) {
  expect(sideEffects.backfillWorkspaceRuntimeFromArtifactIfMissing).not.toHaveBeenCalled()
  expect(sideEffects.loadWorkspacePayloadFromRuntimeOrRecovery).not.toHaveBeenCalled()
  expect(sideEffects.createWorkspaceNovelFromSnapshot).not.toHaveBeenCalled()
}

afterEach(async () => {
  vi.restoreAllMocks()
  try {
    const mutation = await import('@/lib/server/workspace-mutation')
    mutation.setWorkspaceNovelCreationHeartbeatIntervalForTests(null)
  } catch (error) {
    void error
  }
  vi.resetModules()
  vi.doUnmock('@/lib/server/knowledge-rebuild')
  vi.doUnmock('@/lib/server/workspace-resilience')
  vi.doUnmock('@/lib/server/persistence')
  vi.doUnmock('@/lib/server/database-access')
  vi.doUnmock('@/lib/server/workspace-mutation')
  vi.doUnmock('@/lib/server/workspace-background')
  vi.doUnmock('@/lib/server/import-txt')
  vi.doUnmock('next/server')
  vi.unstubAllEnvs()
  if (originalDataDir === undefined) delete process.env.RETALE_DATA_DIR
  else process.env.RETALE_DATA_DIR = originalDataDir

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

describe('import-txt route', () => {
  it('accepts an arbitrary cross-origin import independently of request URL and Host', async () => {
    const database = createTestDatabase('retale-import-txt-route-host-origin')
    resetWorkspaceState(database)
    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore: vi.fn(async () => {}),
    }))
    const request = createImportRequest({
      Host: 'self-host.example',
      Origin: 'https://frontend.example',
    }, 'http://localhost:3000/api/import-txt')

    const { POST } = await import('@/app/api/import-txt/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, chapterCount: 3 })
  })

  it.each([
    [null, 415],
    ['application/json', 415],
    ['multipart/form-data', 415],
    ['multipart/form-data; boundary=', 415],
    ['multipart/form-data; boundary=""', 415],
  ])('requires multipart/form-data with a non-empty boundary: %s', async (contentType, expectedStatus) => {
    const sideEffects = mockImportSideEffects()
    const request = createImportRequest()
    if (contentType === null) request.headers.delete('content-type')
    else request.headers.set('content-type', contentType)

    const { POST } = await import('@/app/api/import-txt/route')
    const response = await POST(request)

    expect(response.status).toBe(expectedStatus)
    expectNoImportSideEffects(sideEffects)
  })

  it('rejects a declared body over 10.25 MiB before parsing or persistence', async () => {
    const sideEffects = mockImportSideEffects()
    const formDataSpy = vi.spyOn(Request.prototype, 'formData')
    const request = createImportRequest()
    request.headers.set('content-length', String(MAX_IMPORT_BODY_SIZE_BYTES + 1))

    const { POST } = await import('@/app/api/import-txt/route')
    const response = await POST(request)

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'TXT import request body exceeds 10.25 MiB',
    })
    expect(formDataSpy).not.toHaveBeenCalled()
    expectNoImportSideEffects(sideEffects)
  })

  it('allows a declared body exactly at the 10.25 MiB boundary', async () => {
    const database = createTestDatabase('retale-import-txt-route-exact-body-limit')
    resetWorkspaceState(database)

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore: vi.fn(async () => {}),
    }))

    const request = createImportRequest()
    request.headers.set('content-length', String(MAX_IMPORT_BODY_SIZE_BYTES))

    const { POST } = await import('@/app/api/import-txt/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, chapterCount: 3 })
  })

  it('accepts an absent Origin and a quoted non-empty multipart boundary', async () => {
    const sideEffects = mockImportSideEffects()
    const request = createImportRequest()
    const contentType = request.headers.get('content-type')
    const boundary = contentType?.match(/boundary=([^;]+)/u)?.[1]
    if (!boundary) throw new Error('Expected generated multipart boundary')
    request.headers.set('content-type', `multipart/form-data; boundary="${boundary}"`)

    const { POST } = await import('@/app/api/import-txt/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(sideEffects.createWorkspaceNovelFromSnapshot).toHaveBeenCalledTimes(1)
  })

  it('rejects a streamed body that exceeds 10.25 MiB despite a misleading declared length and cancels its source', async () => {
    const sideEffects = mockImportSideEffects()
    const boundary = 'retale-import-limit-boundary'
    const prefix = new TextEncoder().encode([
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="large.txt"',
      'Content-Type: text/plain',
      '',
      '',
    ].join('\r\n'))
    const allowedChunk = new Uint8Array(MAX_IMPORT_BODY_SIZE_BYTES)
    allowedChunk.fill(97)
    allowedChunk.set(prefix)

    let pullCount = 0
    let cancellationReason: unknown
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1
        if (pullCount === 1) {
          controller.enqueue(allowedChunk)
          return
        }
        controller.enqueue(new Uint8Array([97]))
      },
      cancel(reason) {
        cancellationReason = reason
      },
    })
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': '1',
      },
      body,
      duplex: 'half',
    }
    const request = new Request('http://localhost/api/import-txt', init)

    const { POST } = await import('@/app/api/import-txt/route')
    const response = await POST(request)

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'TXT import request body exceeds 10.25 MiB',
    })
    expect(pullCount).toBeGreaterThanOrEqual(2)
    if (!(cancellationReason instanceof Error)) {
      throw new Error('Expected the source stream to be cancelled with an error')
    }
    expect(cancellationReason.message).toBe('TXT import request body exceeds 10.25 MiB')
    expectNoImportSideEffects(sideEffects)
  })

  it('rejects a file over 10 MiB before reading its bytes or persisting', async () => {
    const sideEffects = mockImportSideEffects()
    const file = new File(['第1章 测试\n内容'], 'oversized.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'size', { configurable: true, value: MAX_TXT_FILE_SIZE_BYTES + 1 })
    const arrayBufferSpy = vi.spyOn(file, 'arrayBuffer')
    const formData = new FormData()
    formData.set('file', file)
    vi.spyOn(Request.prototype, 'formData').mockResolvedValue(formData)

    const { POST } = await import('@/app/api/import-txt/route')
    const response = await POST(createImportRequest())

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'TXT file exceeds 10 MiB',
    })
    expect(arrayBufferSpy).not.toHaveBeenCalled()
    expectNoImportSideEffects(sideEffects)
  })

  it('allows a file exactly at the 10 MiB boundary', async () => {
    const database = createTestDatabase('retale-import-txt-route-exact-file-limit')
    resetWorkspaceState(database)

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore: vi.fn(async () => {}),
    }))

    const file = new File(['第1章 测试\n边界内的内容。'], 'exact-limit.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'size', { configurable: true, value: MAX_TXT_FILE_SIZE_BYTES })
    const arrayBufferSpy = vi.spyOn(file, 'arrayBuffer')
    const formData = new FormData()
    formData.set('file', file)
    vi.spyOn(Request.prototype, 'formData').mockResolvedValue(formData)

    const { POST } = await import('@/app/api/import-txt/route')
    const response = await POST(createImportRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true })
    expect(arrayBufferSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects generated imports over chapter and content semantic limits before creation or scheduling', async () => {
    const sideEffects = mockImportSideEffects()
    vi.doMock('@/lib/server/import-txt', () => ({
      importNovelIntoWorkspace: vi.fn(() => ({
        currentNovelId: 'novel_semantic_import',
        currentChapterId: 'chapter-0',
        localNovels: [{ id: 'novel_semantic_import', title: 'Semantic', summary: '', tags: [] }],
        localChapters: Array.from({ length: 2_001 }, (_, index) => ({
          id: `chapter-${index}`,
          novelId: 'novel_semantic_import',
          title: `Chapter ${index}`,
          order: index,
          content: '',
          status: 'draft',
          wordCount: 0,
          updatedAt: '',
        })),
      })),
    }))

    const { POST } = await import('@/app/api/import-txt/route')
    const response = await POST(createImportRequest())

    expect(response.status).toBe(422)
    expect(sideEffects.createWorkspaceNovelFromSnapshot).not.toHaveBeenCalled()
  })

  it('returns a fixed generic 500 message for internal creation failures', async () => {
    const sideEffects = mockImportSideEffects()
    sideEffects.createWorkspaceNovelFromSnapshot.mockRejectedValue(new Error('secret database path /private/internal.db'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { POST } = await import('@/app/api/import-txt/route')
    const response = await POST(createImportRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Failed to import TXT workspace' })
  })

  it('waits for workspace knowledge sync before returning success', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-import-txt-route-waits-for-sync')
    const syncControl: { resolve: null | (() => void) } = { resolve: null }
    const syncWorkspacePayloadToKnowledgeStore = vi.fn(
      (_payload: unknown) => new Promise<void>((resolve) => {
        syncControl.resolve = () => resolve()
      })
    )

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore,
    }))

    const { POST } = await importRouteWithAfterCallbacks()
    let responseSettled = false
    const responsePromise = POST(createImportRequest()).finally(() => {
      responseSettled = true
    })

    await vi.waitFor(() => {
      expect(responseSettled || syncWorkspacePayloadToKnowledgeStore.mock.calls.length > 0).toBe(true)
    })
    expect(responseSettled).toBe(false)
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(1)

    const syncedPayload = syncWorkspacePayloadToKnowledgeStore.mock.calls[0]?.[0] as { currentNovelId?: string }
    expect(syncedPayload.currentNovelId).toMatch(/^novel_/)
    const creatingRow = controlDb.prepare(
      'SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?',
    ).get(syncedPayload.currentNovelId!)
    expect(creatingRow).toEqual({ migrationStatus: 'creating' })
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')).toBeUndefined()
    const { getCreatingNovelDb } = await import('@/lib/server/db-resolver')
    const novelDb = getCreatingNovelDb(syncedPayload.currentNovelId!)
    expect(novelDb.prepare('SELECT revision FROM WorkspaceRuntimeState').get()).toEqual({ revision: 1 })
    expect(novelDb.prepare('SELECT COUNT(*) AS count FROM WorkspaceRuntimeChapter').get()).toEqual({ count: 3 })
    expect(novelDb.prepare('SELECT payload IS NOT NULL AS hasPayload FROM WorkspaceState').get()).toEqual({ hasPayload: 1 })

    syncControl.resolve?.()
    const response = await responsePromise
    expect(response.status).toBe(200)
    expect(response.headers.get('x-retale-workspace-revision')).toBe('1')
    const payload = await response.json() as { ok: boolean; novelId: string; chapterCount: number; revision: number }
    expect(payload.ok).toBe(true)
    expect(payload.novelId).toMatch(/^novel_/)
    expect(payload.chapterCount).toBe(3)
    expect(payload.revision).toBe(1)
    expect(getNovelDb(payload.novelId).prepare(
      'SELECT requestedRevision, syncedRevision, startedRevision, lastError FROM WorkspaceKnowledgeSyncState',
    ).get()).toEqual({ requestedRevision: 1, syncedRevision: 1, startedRevision: null, lastError: null })
  })

  it('renews the creation lease while a long knowledge sync is still running', async () => {
    const { controlDb } = await createTestDataRoot('retale-import-txt-route-creation-heartbeat')
    const syncControl = Promise.withResolvers<void>()
    const syncWorkspacePayloadToKnowledgeStore = vi.fn((_payload: unknown) => syncControl.promise)
    vi.doMock('@/lib/server/knowledge-rebuild', () => ({ syncWorkspacePayloadToKnowledgeStore }))

    const mutation = await import('@/lib/server/workspace-mutation')
    mutation.setWorkspaceNovelCreationHeartbeatIntervalForTests(10)
    const { POST } = await importRouteWithAfterCallbacks()
    const responsePromise = POST(createImportRequest())

    await vi.waitFor(() => expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(1))
    const novelId = (syncWorkspacePayloadToKnowledgeStore.mock.calls[0]![0] as { currentNovelId: string }).currentNovelId
    const initialLease = (controlDb.prepare(
      'SELECT leaseExpiresAt FROM NovelRegistry WHERE novelId = ?',
    ).get(novelId) as { leaseExpiresAt: string }).leaseExpiresAt

    await vi.waitFor(() => {
      const renewedLease = (controlDb.prepare(
        'SELECT leaseExpiresAt FROM NovelRegistry WHERE novelId = ?',
      ).get(novelId) as { leaseExpiresAt: string }).leaseExpiresAt
      expect(renewedLease > initialLease).toBe(true)
      expect(controlDb.prepare(
        'SELECT migrationStatus, lifecycleToken IS NOT NULL AS owned FROM NovelRegistry WHERE novelId = ?',
      ).get(novelId)).toEqual({ migrationStatus: 'creating', owned: 1 })
    })

    syncControl.resolve()
    expect((await responsePromise).status).toBe(200)
  })

  it('scopes a later import to its generated novel before creation and scheduling', async () => {
    const sideEffects = mockImportSideEffects()
    sideEffects.loadWorkspacePayloadFromRuntimeOrRecovery.mockResolvedValue({
      currentNovelId: 'novel_deleted',
      currentChapterId: 'deleted-chapter',
      localNovels: [{ id: 'novel_deleted', title: 'Deleted', summary: '', tags: [] }],
      localChapters: [{
        id: 'deleted-chapter',
        novelId: 'novel_deleted',
        title: 'Deleted chapter',
        content: '<p>stale</p>',
        order: 1,
        status: 'draft',
        wordCount: 1,
        updatedAt: '2026-05-16T00:00:00.000Z',
      }],
    })

    const { POST } = await import('@/app/api/import-txt/route')
    const response = await POST(createImportRequest())
    const result = await response.json() as { ok: boolean; novelId: string }

    expect(response.status).toBe(200)
    expect(result.ok).toBe(true)
    expect(result.novelId).toMatch(/^novel_/)
    expect(result.novelId).not.toBe('novel_deleted')
    expect(sideEffects.createWorkspaceNovelFromSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({
        currentNovelId: result.novelId,
        localNovels: [expect.objectContaining({ id: result.novelId })],
        localChapters: expect.not.arrayContaining([expect.objectContaining({ novelId: 'novel_deleted' })]),
      }) }),
    )
    expect(sideEffects.createWorkspaceNovelFromSnapshot).toHaveBeenCalledTimes(1)
  })

  it('surfaces knowledge sync failures instead of reporting a broken import as success', async () => {
    const { controlDb } = await createTestDataRoot('retale-import-txt-route-sync-error', 'novel-prior')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const syncWorkspacePayloadToKnowledgeStore = vi.fn(async () => {
      throw new Error('sync failed')
    })

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore,
    }))

    const { POST } = await importRouteWithAfterCallbacks()
    const response = await POST(createImportRequest())
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: expect.any(String),
    })
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalled()
    const failedRow = controlDb.prepare(
      "SELECT novelId, migrationStatus FROM NovelRegistry WHERE novelId != 'novel-prior'",
    ).get() as { novelId: string; migrationStatus: string }
    expect(failedRow.migrationStatus).toBe('deleted')
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')).toEqual({ value: 'novel-prior' })
    expect(fs.existsSync(path.join(process.env.RETALE_DATA_DIR ?? '', 'novels', failedRow.novelId))).toBe(false)
  })

  it('commits runtime, artifact, and one sync request at revision 1 before publishing ready and active', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-import-txt-route-atomic-surfaces')
    const { POST, afterCallbacks } = await importRouteWithAfterCallbacks()
    const response = await POST(createImportRequest())
    const payload = await response.json() as { novelId: string; revision: number }
    const novelDb = getNovelDb(payload.novelId)

    expect(response.status).toBe(200)
    expect(payload.revision).toBe(1)
    expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get(payload.novelId)).toEqual({ migrationStatus: 'ready' })
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')).toEqual({ value: payload.novelId })
    expect(novelDb.prepare('SELECT revision FROM WorkspaceRuntimeState').get()).toEqual({ revision: 1 })
    expect(novelDb.prepare('SELECT COUNT(*) AS count FROM WorkspaceRuntimeChapter').get()).toEqual({ count: 3 })
    expect(novelDb.prepare('SELECT payload IS NOT NULL AS hasPayload FROM WorkspaceState').get()).toEqual({ hasPayload: 1 })
    expect(novelDb.prepare(
      'SELECT requestedRevision, syncedRevision, startedRevision FROM WorkspaceKnowledgeSyncState',
    ).get()).toEqual({ requestedRevision: 1, syncedRevision: 1, startedRevision: null })
    expect(novelDb.prepare('SELECT COUNT(*) AS count FROM WorkspaceMutationReplay').get()).toEqual({ count: 0 })
    expect(afterCallbacks).toHaveLength(0)
  })

  it('compensates a failure after the novel transaction without replacing the prior active novel or scheduling sync', async () => {
    const { controlDb } = await createTestDataRoot('retale-import-txt-route-compensation', 'novel-prior')
    const mutation = await import('@/lib/server/workspace-mutation')
    mutation.setWorkspaceNovelCreationFaultInjectorForTests(() => {
      expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE migrationStatus = ?').get('creating')).toEqual({ migrationStatus: 'creating' })
      expect(controlDb.prepare('SELECT COUNT(*) AS count FROM NovelRegistry WHERE migrationStatus = ?').get('ready')).toEqual({ count: 1 })
      expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')).toEqual({ value: 'novel-prior' })
      throw new Error('publication fault')
    })
    const { POST, afterCallbacks } = await importRouteWithAfterCallbacks()

    const response = await POST(createImportRequest())
    mutation.setWorkspaceNovelCreationFaultInjectorForTests(null)
    expect(response.status).toBe(500)
    const registryRows = controlDb.prepare('SELECT novelId, migrationStatus FROM NovelRegistry ORDER BY novelId').all() as Array<{ novelId: string; migrationStatus: string }>
    const failed = registryRows.find((row) => row.novelId !== 'novel-prior')
    expect(failed?.migrationStatus).toBe('deleted')
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')).toEqual({ value: 'novel-prior' })
    expect(fs.existsSync(path.join(process.env.RETALE_DATA_DIR ?? '', 'novels', failed?.novelId ?? 'missing'))).toBe(false)
    expect(afterCallbacks).toHaveLength(0)
  })

  it('recovers abandoned creating rows and does not revive collisions', async () => {
    const { controlDb } = await createTestDataRoot('retale-import-txt-route-abandoned-creating')
    const novelId = 'novel_abandoned'
    const novelDirectory = path.join(process.env.RETALE_DATA_DIR ?? '', 'novels', novelId)
    fs.mkdirSync(novelDirectory, { recursive: true })
    controlDb.prepare(
      `INSERT INTO NovelRegistry (novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus)
       VALUES (?, ?, ?, ?, ?, '1', 'creating')`,
    ).run(novelId, novelId, 'Abandoned', path.join(novelDirectory, 'novel.db'), path.join(novelDirectory, 'lancedb'))
    const persistence = await import('@/lib/server/persistence')

    await persistence.resumePendingWorkspaceNovelCleanup()
    expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get(novelId)).toEqual({ migrationStatus: 'deleted' })
    expect(fs.existsSync(novelDirectory)).toBe(false)
    await expect(mutationCreateCollision(novelId)).rejects.toMatchObject({ code: 'novel_not_ready' })

    async function mutationCreateCollision(targetNovelId: string) {
      const { createWorkspaceNovelFromSnapshot } = await import('@/lib/server/workspace-mutation')
      const { normalizeWorkspaceState } = await import('@/lib/workspace-state')
      return createWorkspaceNovelFromSnapshot({
        novelId: targetNovelId,
        payload: normalizeWorkspaceState({
          currentNovelId: targetNovelId,
          localNovels: [{ id: targetNovelId, title: 'Collision', summary: '', tags: [] }],
          localChapters: [],
        }),
      })
    }
  })

  it('does not let a pending creating-row cleanup delete a novel published ready before gate acquisition', async () => {
    const { controlDb } = await createTestDataRoot('retale-import-txt-route-creating-cleanup-race')
    const novelId = 'novel_publishing'
    const novelDirectory = path.join(process.env.RETALE_DATA_DIR ?? '', 'novels', novelId)
    fs.mkdirSync(novelDirectory, { recursive: true })
    controlDb.prepare(
      `INSERT INTO NovelRegistry (novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus)
       VALUES (?, ?, ?, ?, ?, '1', 'creating')`,
    ).run(novelId, novelId, 'Publishing', path.join(novelDirectory, 'novel.db'), path.join(novelDirectory, 'lancedb'))
    const gate = await import('@/lib/server/per-novel-write-gate')
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const blocker = gate.runWithPerNovelWriteGate(novelId, async () => {
      entered.resolve()
      await release.promise
      controlDb.prepare('UPDATE NovelRegistry SET migrationStatus = ? WHERE novelId = ?').run('ready', novelId)
    })
    await entered.promise
    const persistence = await import('@/lib/server/persistence')
    const scan = persistence.resumePendingWorkspaceNovelCleanup()
    await Promise.resolve()
    release.resolve()
    await blocker
    await scan

    expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get(novelId)).toEqual({ migrationStatus: 'ready' })
    expect(fs.existsSync(novelDirectory)).toBe(true)
  })

  it('uses fixed-clock creator leases for renewal, token fencing, publication, and claim wins', async () => {
    const { controlDb } = await createTestDataRoot('retale-import-txt-route-lifecycle-fixed-clock')
    const persistence = await import('@/lib/server/persistence')
    const novelId = 'novel_fixed_clock'
    const creatorToken = await persistence.beginWorkspaceNovelCreation({
      novelId,
      title: 'Fixed Clock',
      now: '2026-08-12T00:00:00.000Z',
    })
    expect(controlDb.prepare(
      'SELECT lifecycleToken, leaseExpiresAt, claimedAt FROM NovelRegistry WHERE novelId = ?',
    ).get(novelId)).toEqual({
      lifecycleToken: creatorToken,
      leaseExpiresAt: '2026-08-12T00:15:00.000Z',
      claimedAt: '2026-08-12T00:00:00.000Z',
    })

    await expect(persistence.renewWorkspaceNovelCreation(
      novelId,
      'wrong-token',
      '2026-08-12T00:01:00.000Z',
    )).rejects.toThrow(/no longer owned/)
    await persistence.renewWorkspaceNovelCreation(novelId, creatorToken, '2026-08-12T00:10:00.000Z')
    expect(controlDb.prepare('SELECT leaseExpiresAt FROM NovelRegistry WHERE novelId = ?').get(novelId)).toEqual({
      leaseExpiresAt: '2026-08-12T00:25:00.000Z',
    })
    await persistence.publishWorkspaceNovelCreation(novelId, creatorToken, '2026-08-12T00:20:00.000Z')
    expect(controlDb.prepare(
      'SELECT migrationStatus, lifecycleToken, leaseExpiresAt, claimedAt FROM NovelRegistry WHERE novelId = ?',
    ).get(novelId)).toEqual({ migrationStatus: 'ready', lifecycleToken: null, leaseExpiresAt: null, claimedAt: null })
    await persistence.resumePendingWorkspaceNovelCleanup('2026-08-12T01:00:00.000Z')
    expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get(novelId)).toEqual({ migrationStatus: 'ready' })

    const abandonedId = 'novel_fixed_claim'
    const abandonedToken = await persistence.beginWorkspaceNovelCreation({
      novelId: abandonedId,
      now: '2026-08-12T00:00:00.000Z',
    })
    const abandonedDirectory = path.join(process.env.RETALE_DATA_DIR ?? '', 'novels', abandonedId)
    fs.mkdirSync(abandonedDirectory, { recursive: true })
    await persistence.resumePendingWorkspaceNovelCleanup('2026-08-12T00:16:00.000Z')
    expect(controlDb.prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get(abandonedId)).toEqual({ migrationStatus: 'deleted' })
    await expect(persistence.publishWorkspaceNovelCreation(
      abandonedId,
      abandonedToken,
      '2026-08-12T00:16:00.000Z',
    )).rejects.toThrow(/no longer publishable/)
    expect(fs.existsSync(abandonedDirectory)).toBe(false)
  })

  it('drains more than 25 expired creations without sharing the deleted purge cursor', async () => {
    const { controlDb } = await createTestDataRoot('retale-import-txt-route-expired-creation-batches')
    const persistence = await import('@/lib/server/persistence')
    for (let index = 0; index < 26; index += 1) {
      const novelId = `novel_expired_${String(index).padStart(2, '0')}`
      await persistence.beginWorkspaceNovelCreation({ novelId, now: '2026-08-12T00:00:00.000Z' })
    }

    await persistence.resumePendingWorkspaceNovelCleanup('2026-08-12T00:16:00.000Z')
    expect(controlDb.prepare("SELECT COUNT(*) AS count FROM NovelRegistry WHERE migrationStatus = 'deleted'").get()).toEqual({ count: 25 })
    await persistence.resumePendingWorkspaceNovelCleanup('2026-08-12T00:16:00.000Z')
    expect(controlDb.prepare("SELECT COUNT(*) AS count FROM NovelRegistry WHERE migrationStatus = 'deleted'").get()).toEqual({ count: 26 })
  })

  it('allows an imported chapter to PATCH immediately from revision 1 to revision 2', async () => {
    const { getNovelDb } = await createTestDataRoot('retale-import-txt-route-patch-continuity')
    const { POST } = await importRouteWithAfterCallbacks()
    const imported = await POST(createImportRequest())
    const importPayload = await imported.json() as { novelId: string; chapterId: string }
    const workspaceRoute = await import('@/app/api/workspace/route')
    const patch = await workspaceRoute.PATCH(new Request('http://localhost/api/workspace', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'import-patch-continuity',
        'X-Retale-Base-Revision': '1',
        'X-Retale-Revision-Novel-Id': importPayload.novelId,
      },
      body: JSON.stringify({
        novelId: importPayload.novelId,
        chapterId: importPayload.chapterId,
        content: '<p>导入后立即修订</p>',
        wordCount: 8,
        updatedAtLabel: '导入后更新',
      }),
    }))

    expect(patch.status).toBe(200)
    await expect(patch.json()).resolves.toMatchObject({ revision: 2, operation: 'chapter-patch' })
    expect(getNovelDb(importPayload.novelId).prepare('SELECT revision FROM WorkspaceRuntimeState').get()).toEqual({ revision: 2 })
  })

  it('selects GB18030 decoding when the UTF-8 candidate is mojibake', async () => {
    const database = createTestDatabase('retale-import-txt-route-gb18030')
    resetWorkspaceState(database)

    vi.doMock('@/lib/server/workspace-resilience', async () => {
      const actual = await vi.importActual<typeof import('@/lib/server/workspace-resilience')>(
        '@/lib/server/workspace-resilience'
      )
      return {
        ...actual,
        backfillWorkspaceRuntimeFromArtifactIfMissing: vi.fn(async () => {}),
        loadWorkspacePayloadFromRuntimeOrRecovery: vi.fn(async () => ({})),
      }
    })
    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore: vi.fn(async () => {}),
    }))

    const { POST } = await import('@/app/api/import-txt/route')
    const response = await POST(createGb18030ImportRequest())

    expect(response.status).toBe(200)
    const resilience = await vi.importActual<typeof import('@/lib/server/workspace-resilience')>(
      '@/lib/server/workspace-resilience'
    )
    const payload = await resilience.loadWorkspacePayloadFromRuntimeOrRecovery('singleton')

    expect(payload.localChapters[0]?.content).toContain('本书由【示例组】整理')
    expect(payload.localChapters[1]?.title).toBe('第1章 初遇')
    expect(payload.localChapters[1]?.content).toContain('林澄开始记录这次练习。')
    expect(JSON.stringify(payload)).not.toContain('����')
  })

  it('keeps imported content available through normalized runtime state after the workspace artifact is blanked', async () => {
    const database = createTestDatabase('retale-import-txt-route-runtime-source-of-truth')
    resetWorkspaceState(database)

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore: vi.fn(async () => {}),
    }))

    const { POST: importTxt } = await import('@/app/api/import-txt/route')
    const importResponse = await importTxt(createImportRequest())
    expect(importResponse.status).toBe(200)

    database.prepare('UPDATE WorkspaceState SET payload = NULL WHERE id = ?').run('singleton')

    const { GET } = await import('@/app/api/workspace/route')
    const response = await GET(new Request('http://localhost/api/workspace'))
    const payload = await response.json() as { localNovels: Array<{ title: string }>; localChapters: Array<{ title: string; content: string }> }

    expect(response.status).toBe(200)
    expect(payload.localNovels[0]?.title).toBe('workspace-import-smoke')
    expect(payload.localChapters[1]?.title).toBe('第1章 初遇')
    expect(payload.localChapters[1]?.content).toContain('林澄开始记录这次练习。')
  })
})
