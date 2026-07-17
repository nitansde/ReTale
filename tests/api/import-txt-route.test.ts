import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }
const MAX_TXT_FILE_SIZE_BYTES = 10 * 1024 * 1024
const MAX_IMPORT_BODY_SIZE_BYTES = MAX_TXT_FILE_SIZE_BYTES + 256 * 1024

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

function createImportRequest() {
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
      '合成测试故事-short.txt',
      { type: 'text/plain' }
    )
  )

  return new Request('http://localhost/api/import-txt', {
    method: 'POST',
    body: formData,
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
  const workspaceDb = {
    execute: vi.fn(),
    queryAll: vi.fn(() => []),
    queryOne: vi.fn(() => null),
    withTransaction: vi.fn(async (callback: () => unknown) => callback()),
  }
  const createNovelDatabaseAccess = vi.fn(() => workspaceDb)
  const backfillWorkspaceRuntimeFromArtifactIfMissing = vi.fn(async () => {})
  const loadWorkspacePayloadFromRuntimeOrRecovery = vi.fn(async () => ({}))
  const persistWorkspaceRuntimeState = vi.fn(async () => {})
  const upsertWorkspaceState = vi.fn()
  const syncWorkspacePayloadToKnowledgeStore = vi.fn(async () => {})

  vi.doMock('@/lib/server/workspace-resilience', () => ({
    backfillWorkspaceRuntimeFromArtifactIfMissing,
    loadWorkspacePayloadFromRuntimeOrRecovery,
    persistWorkspaceRuntimeState,
  }))
  vi.doMock('@/lib/server/persistence', () => ({ upsertWorkspaceState }))
  vi.doMock('@/lib/server/database-access', () => ({ createNovelDatabaseAccess }))
  vi.doMock('@/lib/server/knowledge-rebuild', () => ({ syncWorkspacePayloadToKnowledgeStore }))

  return {
    workspaceDb,
    createNovelDatabaseAccess,
    backfillWorkspaceRuntimeFromArtifactIfMissing,
    loadWorkspacePayloadFromRuntimeOrRecovery,
    persistWorkspaceRuntimeState,
    upsertWorkspaceState,
    syncWorkspacePayloadToKnowledgeStore,
  }
}

function expectNoImportSideEffects(sideEffects: ReturnType<typeof mockImportSideEffects>) {
  expect(sideEffects.backfillWorkspaceRuntimeFromArtifactIfMissing).not.toHaveBeenCalled()
  expect(sideEffects.loadWorkspacePayloadFromRuntimeOrRecovery).not.toHaveBeenCalled()
  expect(sideEffects.persistWorkspaceRuntimeState).not.toHaveBeenCalled()
  expect(sideEffects.upsertWorkspaceState).not.toHaveBeenCalled()
  expect(sideEffects.createNovelDatabaseAccess).not.toHaveBeenCalled()
  expect(sideEffects.syncWorkspacePayloadToKnowledgeStore).not.toHaveBeenCalled()
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.doUnmock('@/lib/server/knowledge-rebuild')
  vi.doUnmock('@/lib/server/workspace-resilience')
  vi.doUnmock('@/lib/server/persistence')
  vi.doUnmock('@/lib/server/database-access')

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

  it('waits for workspace knowledge sync before returning success', async () => {
    const database = createTestDatabase('retale-import-txt-route-awaits-sync')
    resetWorkspaceState(database)

    const syncControl: { resolve: null | (() => void) } = { resolve: null }
    const syncWorkspacePayloadToKnowledgeStore = vi.fn(
      () => new Promise<void>((resolve) => {
        syncControl.resolve = () => resolve()
      })
    )

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore,
    }))

    const { POST } = await import('@/app/api/import-txt/route')
    const responsePromise = POST(createImportRequest())

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(1)

    let settled = false
    void responsePromise.then(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)

    syncControl.resolve?.()

    const response = await responsePromise
    expect(response.status).toBe(200)

    const payload = await response.json() as { ok: boolean; novelId: string; chapterCount: number }
    expect(payload.ok).toBe(true)
    expect(payload.novelId).toMatch(/^novel_/)
    expect(payload.chapterCount).toBe(3)
  })

  it('scopes a later import to its generated novel and syncs through that explicit database', async () => {
    const sideEffects = mockImportSideEffects()
    sideEffects.loadWorkspacePayloadFromRuntimeOrRecovery.mockResolvedValue({
      currentNovelId: 'novel_deleted',
      currentChapterId: 'deleted-chapter',
      localNovels: [{ id: 'novel_deleted', title: 'Deleted', summary: '', tags: [] }],
      localChapters: [{
        id: 'deleted-chapter',
        novelId: 'novel_deleted',
        volumeId: 'deleted-volume',
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
    expect(sideEffects.createNovelDatabaseAccess).toHaveBeenCalledWith(result.novelId)
    expect(sideEffects.syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledWith(
      expect.objectContaining({
        currentNovelId: result.novelId,
        localNovels: [expect.objectContaining({ id: result.novelId })],
        localChapters: expect.not.arrayContaining([expect.objectContaining({ novelId: 'novel_deleted' })]),
        syncScope: 'target-novel',
      }),
      { db: sideEffects.workspaceDb },
    )
  })

  it('surfaces knowledge sync failures instead of reporting a broken import as success', async () => {
    const database = createTestDatabase('retale-import-txt-route-sync-error')
    resetWorkspaceState(database)

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore: vi.fn(async () => {
        throw new Error('sync failed')
      }),
    }))

    const { POST } = await import('@/app/api/import-txt/route')
    const response = await POST(createImportRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'sync failed' })
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
    const response = await GET()
    const payload = await response.json() as { localNovels: Array<{ title: string }>; localChapters: Array<{ title: string; content: string }> }

    expect(response.status).toBe(200)
    expect(payload.localNovels[0]?.title).toBe('合成测试故事-short')
    expect(payload.localChapters[1]?.title).toBe('第1章 初遇')
    expect(payload.localChapters[1]?.content).toContain('林澄开始记录这次练习。')
  })
})
