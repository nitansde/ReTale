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
  seedNovelRegistryRow(controlDb, activeNovelId, activeNovelId)
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

function createWorkspacePatchRequest(payload: Record<string, unknown>, headers: Record<string, string> = {}) {
  const revisionHeaders: Record<string, string> = typeof payload.novelId === 'string'
    && 'Idempotency-Key' in headers
    && 'X-Retale-Base-Revision' in headers
    && !('X-Retale-Revision-Novel-Id' in headers)
    ? { 'X-Retale-Revision-Novel-Id': payload.novelId }
    : {}
  return new Request('http://localhost/api/workspace', {
    method: 'PATCH',
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      ...headers,
      ...revisionHeaders,
    },
  })
}

function createChapterPatchPayload(novelId = 'novel-patch', overrides: Record<string, unknown> = {}) {
  return {
    novelId,
    chapterId: `${novelId}-chapter-1`,
    content: '<p>修订后的正文</p>',
    wordCount: 7,
    updatedAtLabel: '刚刚更新',
    ...overrides,
  }
}

function createOversizedStreamingRequest(params: {
  method: 'POST' | 'PATCH'
  maxBytes: number
  headers?: Record<string, string>
}) {
  let cancellationReason: unknown
  let pulls = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1
      controller.enqueue(new Uint8Array(pulls === 1 ? params.maxBytes : 1))
    },
    cancel(reason) {
      cancellationReason = reason
    },
  })
  const init: RequestInit & { duplex: 'half' } = {
    method: params.method,
    headers: { 'Content-Type': 'application/json', 'Content-Length': '1', ...params.headers },
    body,
    duplex: 'half',
  }
  return {
    request: new Request('http://localhost/api/workspace', init),
    getCancellationReason: () => cancellationReason,
  }
}

function createWorkspaceDeleteRequest(novelId?: string, nextNovelId?: string, headers?: Record<string, string>) {
  const url = new URL('http://localhost/api/workspace')
  if (novelId !== undefined) url.searchParams.set('novelId', novelId)
  if (nextNovelId !== undefined) url.searchParams.set('nextNovelId', nextNovelId)
  return new Request(url, { method: 'DELETE', headers })
}

function createWorkspaceDeletionStatusRequest(novelId?: string) {
  const url = new URL('http://localhost/api/workspace')
  url.searchParams.set('deletionStatus', '1')
  if (novelId !== undefined) url.searchParams.set('novelId', novelId)
  return new Request(url)
}

function createWorkspaceLibrarySummaryRequest(value = '1') {
  const url = new URL('http://localhost/api/workspace')
  url.searchParams.set('librarySummary', value)
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
    localNovels: [{ id: novelId, title, summary: '保留参考面板数据', tags: ['测试', '侧写'] }],
    localChapters: [{
      id: `${novelId}-chapter-1`,
      novelId,
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
    `INSERT OR REPLACE INTO NovelRegistry (
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

function seedPendingWorkspaceKnowledgeSync(database: DatabaseSync, revision = 1, sourceUpdatedAt = '2026-08-12T00:00:00.000Z') {
  database.prepare(
    `INSERT INTO WorkspaceKnowledgeSyncState (
       workspaceStateId, requestedRevision, syncedRevision, requestedSourceUpdatedAt
     ) VALUES (?, ?, 0, ?)`,
  ).run('singleton', revision, sourceUpdatedAt)
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
  it('exposes targeted canonical revision metadata and increments it after a legacy POST', async () => {
    const database = await createTestDatabase('retale-workspace-route-targeted-revision', 'novel-revision')
    clearWorkspaceRecoveryData(database)
    const payload = createWorkspacePayloadWithSideData('novel-revision', 'Revision Novel')
    const { GET, POST } = await importWorkspaceRouteWithAfterCallbacks()

    const initialGet = await GET(new Request('http://localhost/api/workspace?novelId=novel-revision'))
    const initialBody = await initialGet.json()
    expect(initialGet.headers.get('cache-control')).toBe('no-store')
    expect(initialGet.headers.get('x-retale-workspace-revision')).toBe('0')
    expect(initialGet.headers.get('x-retale-revision-novel-id')).toBe('novel-revision')
    expect(initialBody).toMatchObject({ workspaceRevision: 0, revisionNovelId: 'novel-revision' })

    const post = await POST(createWorkspaceRequest(payload))
    expect(post.status).toBe(200)
    expect(post.headers.get('x-retale-workspace-revision')).toBe('1')
    expect(post.headers.get('x-retale-revision-novel-id')).toBe('novel-revision')
    await expect(post.json()).resolves.toMatchObject({ ok: true, revision: 1, replayed: false, operation: 'full-snapshot' })

    const updatedGet = await GET(new Request('http://localhost/api/workspace?novelId=novel-revision'))
    await expect(updatedGet.json()).resolves.toMatchObject({ workspaceRevision: 1, revisionNovelId: 'novel-revision' })
    expect(updatedGet.headers.get('x-retale-workspace-revision')).toBe('1')
  })

  it('uses the active novel as registry-combined revision owner and deterministic fallback otherwise', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-registry-revision-owner', 'novel-beta')
    for (const novelId of ['novel-alpha', 'novel-beta']) {
      getNovelDb(novelId)
      seedNovelRegistryRow(controlDb, novelId, novelId)
      await seedWorkspaceRuntimeForNovel(novelId, createWorkspacePayload(novelId, novelId))
    }
    getNovelDb('novel-alpha').prepare('UPDATE WorkspaceRuntimeState SET revision = 3').run()
    getNovelDb('novel-beta').prepare('UPDATE WorkspaceRuntimeState SET revision = 7').run()

    const { GET } = await importWorkspaceRouteWithAfterCallbacks()
    const activeResponse = await GET(new Request('http://localhost/api/workspace'))
    await expect(activeResponse.json()).resolves.toMatchObject({ workspaceRevision: 7, revisionNovelId: 'novel-beta' })
    expect(activeResponse.headers.get('x-retale-revision-novel-id')).toBe('novel-beta')

    controlDb.prepare('DELETE FROM AppSetting WHERE key = ?').run('WORKSPACE_ACTIVE_NOVEL_ID')
    const fallbackResponse = await GET(new Request('http://localhost/api/workspace'))
    await expect(fallbackResponse.json()).resolves.toMatchObject({ workspaceRevision: 3, revisionNovelId: 'novel-alpha' })
    expect(fallbackResponse.headers.get('x-retale-revision-novel-id')).toBe('novel-alpha')
  })

  it('keeps special GET contracts unchanged and omits workspace revision headers', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-special-get-contract', 'novel-special')
    getNovelDb('novel-special')
    seedNovelRegistryRow(controlDb, 'novel-special', 'Special')
    const { GET } = await importWorkspaceRouteWithAfterCallbacks()

    const library = await GET(createWorkspaceLibrarySummaryRequest())
    const libraryBody = await library.json()
    expect(libraryBody).toEqual({ ok: true, activeNovelId: 'novel-special', novels: [] })
    expect(library.headers.get('cache-control')).toBe('no-store')
    expect(library.headers.get('x-retale-workspace-revision')).toBeNull()

    const deletion = await GET(createWorkspaceDeletionStatusRequest('novel-special'))
    expect(await deletion.json()).toEqual({ ok: true, novelId: 'novel-special', deletionState: 'ready' })
    expect(deletion.headers.get('cache-control')).toBe('no-store')
    expect(deletion.headers.get('x-retale-workspace-revision')).toBeNull()
  })

  it('recovers durable pending knowledge sync from a targeted GET after local scheduling is reset', async () => {
    const database = await createTestDatabase('retale-workspace-route-targeted-sync-recovery', 'novel-recovery')
    clearWorkspaceRecoveryData(database)
    const payload = createWorkspacePayloadWithSideData('novel-recovery', 'Recovery Novel')
    await seedWorkspaceRuntimeForNovel('novel-recovery', payload)
    seedWorkspaceState(database, payload)
    seedPendingWorkspaceKnowledgeSync(database)
    const syncWorkspacePayloadToKnowledgeStore = vi.fn(async () => {})
    vi.doMock('@/lib/server/knowledge-rebuild', () => ({ syncWorkspacePayloadToKnowledgeStore }))

    const { GET, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const background = await import('@/lib/server/workspace-background')
    background.scheduleWorkspaceKnowledgeSync('novel-recovery')
    expect(afterCallbacks).toHaveLength(1)
    background.resetWorkspaceBackgroundSchedulingForTests()
    afterCallbacks.length = 0

    const response = await GET(new Request('http://localhost/api/workspace?novelId=novel-recovery'))
    expect(response.status).toBe(200)
    expect(afterCallbacks).toHaveLength(2)
    await runAfterCallbacks(afterCallbacks)

    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(1)
    expect(database.prepare(
      `SELECT requestedRevision, syncedRevision, startedRevision, claimToken, lastError
       FROM WorkspaceKnowledgeSyncState WHERE workspaceStateId = ?`,
    ).get('singleton')).toEqual({
      requestedRevision: 1,
      syncedRevision: 1,
      startedRevision: null,
      claimToken: null,
      lastError: null,
    })
  })

  it('recovers pending sync from a library summary while respecting a fresh active claim', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-library-sync-recovery', 'novel-pending')
    for (const novelId of ['novel-pending', 'novel-active']) {
      const database = getNovelDb(novelId)
      seedNovelRegistryRow(controlDb, novelId, novelId)
      const payload = createWorkspacePayloadWithSideData(novelId, novelId)
      await seedWorkspaceRuntimeForNovel(novelId, payload)
      seedWorkspaceState(database, payload)
      seedPendingWorkspaceKnowledgeSync(database)
    }
    const activeDb = getNovelDb('novel-active')
    activeDb.prepare(
      `UPDATE WorkspaceKnowledgeSyncState
       SET startedRevision = requestedRevision,
           startedSourceUpdatedAt = requestedSourceUpdatedAt,
           startedAt = CURRENT_TIMESTAMP,
           claimToken = ?
       WHERE workspaceStateId = ?`,
    ).run('fresh-active-token', 'singleton')
    const syncWorkspacePayloadToKnowledgeStore = vi.fn(async () => {})
    vi.doMock('@/lib/server/knowledge-rebuild', () => ({ syncWorkspacePayloadToKnowledgeStore }))

    const { GET, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await GET(createWorkspaceLibrarySummaryRequest())
    expect(response.status).toBe(200)
    expect(afterCallbacks).toHaveLength(2)
    await runAfterCallbacks(afterCallbacks)

    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(1)
    expect(getNovelDb('novel-pending').prepare(
      `SELECT syncedRevision, startedRevision, claimToken FROM WorkspaceKnowledgeSyncState WHERE workspaceStateId = ?`,
    ).get('singleton')).toEqual({ syncedRevision: 1, startedRevision: null, claimToken: null })
    expect(activeDb.prepare(
      `SELECT syncedRevision, startedRevision, claimToken FROM WorkspaceKnowledgeSyncState WHERE workspaceStateId = ?`,
    ).get('singleton')).toEqual({ syncedRevision: 0, startedRevision: 1, claimToken: 'fresh-active-token' })
  })

  it('handles revision-aware POST replay and typed conflicts without duplicate scheduling', async () => {
    const database = await createTestDatabase('retale-workspace-route-revision-aware-post', 'novel-aware')
    clearWorkspaceRecoveryData(database)
    const payload = createWorkspacePayloadWithSideData('novel-aware', 'Aware')
    const { POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const headers = {
      'Idempotency-Key': 'aware-request',
      'X-Retale-Base-Revision': '0',
      'X-Retale-Revision-Novel-Id': 'novel-aware',
    }

    const committed = await POST(createWorkspaceRequest(payload, headers))
    expect(committed.status).toBe(200)
    await expect(committed.json()).resolves.toMatchObject({ revision: 1, replayed: false })
    expect(afterCallbacks).toHaveLength(1)
    const syncBeforeReplay = database.prepare('SELECT requestedRevision FROM WorkspaceKnowledgeSyncState').get()

    const replayed = await POST(createWorkspaceRequest(payload, headers))
    expect(replayed.status).toBe(200)
    await expect(replayed.json()).resolves.toMatchObject({ revision: 1, replayed: true })
    expect(afterCallbacks).toHaveLength(1)
    expect(database.prepare('SELECT requestedRevision FROM WorkspaceKnowledgeSyncState').get()).toEqual(syncBeforeReplay)
    expect(database.prepare('SELECT COUNT(*) AS count FROM WorkspaceMutationReplay').get()).toEqual({ count: 1 })

    const stale = await POST(createWorkspaceRequest(
      createWorkspacePayloadWithSideData('novel-aware', 'Stale'),
      {
        'Idempotency-Key': 'stale-request',
        'X-Retale-Base-Revision': '0',
        'X-Retale-Revision-Novel-Id': 'novel-aware',
      },
    ))
    expect(stale.status).toBe(409)
    await expect(stale.json()).resolves.toMatchObject({ ok: false, code: 'stale_revision', currentRevision: 1 })

    const reused = await POST(createWorkspaceRequest(
      createWorkspacePayloadWithSideData('novel-aware', 'Reused'),
      headers,
    ))
    expect(reused.status).toBe(409)
    await expect(reused.json()).resolves.toMatchObject({ ok: false, code: 'idempotency_key_reused' })
  })

  it.each([
    [{ 'Idempotency-Key': 'only-key' }, 'provided together'],
    [{ 'X-Retale-Base-Revision': '0' }, 'provided together'],
    [{ 'X-Retale-Revision-Novel-Id': 'novel-contract' }, 'provided together'],
    [{ 'Idempotency-Key': 'missing-owner', 'X-Retale-Base-Revision': '0' }, 'provided together'],
    [{ 'Idempotency-Key': 'missing-revision', 'X-Retale-Revision-Novel-Id': 'novel-contract' }, 'provided together'],
    [{ 'X-Retale-Base-Revision': '0', 'X-Retale-Revision-Novel-Id': 'novel-contract' }, 'provided together'],
    [{ 'Idempotency-Key': ' ', 'X-Retale-Base-Revision': '0', 'X-Retale-Revision-Novel-Id': 'novel-contract' }, 'non-empty'],
    [{ 'Idempotency-Key': 'blank-owner', 'X-Retale-Base-Revision': '0', 'X-Retale-Revision-Novel-Id': ' ' }, 'non-empty'],
    [{ 'Idempotency-Key': 'bad-revision', 'X-Retale-Base-Revision': '-1', 'X-Retale-Revision-Novel-Id': 'novel-contract' }, 'non-negative integer'],
    [{ 'Idempotency-Key': 'bad-revision', 'X-Retale-Base-Revision': '1.5', 'X-Retale-Revision-Novel-Id': 'novel-contract' }, 'non-negative integer'],
  ])('rejects invalid revision header contracts without mutation', async (headers, messageFragment) => {
    const database = await createTestDatabase('retale-workspace-route-invalid-revision-contract', 'novel-contract')
    clearWorkspaceRecoveryData(database)
    const { POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()

    const response = await POST(createWorkspaceRequest(createWorkspacePayload('novel-contract'), headers))
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'invalid_revision_contract', error: expect.stringContaining(messageFragment) })
    expect(database.prepare('SELECT COUNT(*) AS count FROM WorkspaceRuntimeState').get()).toEqual({ count: 0 })
    expect(afterCallbacks).toHaveLength(0)
  })

  it('rejects a novel resource path that does not match the snapshot before mutation', async () => {
    const database = await createTestDatabase('retale-workspace-route-resource-novel-mismatch', 'novel-a')
    clearWorkspaceRecoveryData(database)
    const { POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()

    const response = await POST(createWorkspaceRequest(createWorkspacePayload('novel-a'), {
      'X-Retale-Resource-Novel-Id': 'novel-b',
    }))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'invalid_revision_contract',
      error: expect.stringContaining('resource path'),
    })
    expect(database.prepare('SELECT COUNT(*) AS count FROM WorkspaceRuntimeState').get()).toEqual({ count: 0 })
    expect(afterCallbacks).toHaveLength(0)
  })

  it('rejects a chapter resource path that does not match the patch before mutation', async () => {
    const database = await createTestDatabase('retale-workspace-route-resource-chapter-mismatch', 'novel-patch')
    clearWorkspaceRecoveryData(database)
    await seedWorkspaceRuntimeForNovel('novel-patch', createWorkspacePayloadWithSideData('novel-patch'))
    const { PATCH, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()

    const response = await PATCH(createWorkspacePatchRequest(createChapterPatchPayload('novel-patch'), {
      'Idempotency-Key': 'resource-chapter-mismatch',
      'X-Retale-Base-Revision': '0',
      'X-Retale-Resource-Chapter-Id': 'different-chapter',
    }))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'invalid_revision_contract',
      error: expect.stringContaining('resource path'),
    })
    expect(database.prepare('SELECT revision FROM WorkspaceRuntimeState WHERE id = ?').get('singleton')).toEqual({ revision: 0 })
    expect(afterCallbacks).toHaveLength(0)
  })

  it('rejects equal-revision POST owner and resolved-target mismatch before side effects', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-owner-target-mismatch', 'novel-a')
    const novelADb = getNovelDb('novel-a')
    const novelBDb = getNovelDb('novel-b')
    seedNovelRegistryRow(controlDb, 'novel-a', 'Novel A')
    seedNovelRegistryRow(controlDb, 'novel-b', 'Novel B')
    await seedWorkspaceRuntimeForNovel('novel-a', createWorkspacePayloadWithSideData('novel-a', 'Novel A'))
    await seedWorkspaceRuntimeForNovel('novel-b', createWorkspacePayloadWithSideData('novel-b', 'Novel B'))
    const readMutationState = (database: DatabaseSync) => ({
      runtime: database.prepare('SELECT * FROM WorkspaceRuntimeState').all(),
      chapters: database.prepare('SELECT * FROM WorkspaceRuntimeChapter ORDER BY id').all(),
      replay: database.prepare('SELECT * FROM WorkspaceMutationReplay').all(),
      sync: database.prepare('SELECT * FROM WorkspaceKnowledgeSyncState').all(),
    })
    const beforeA = readMutationState(novelADb)
    const beforeB = readMutationState(novelBDb)
    const payloadA = createWorkspacePayloadWithSideData('novel-a', 'Novel A')
    const payloadB = createWorkspacePayloadWithSideData('novel-b', 'Novel B')
    const adversarialPayload = {
      ...payloadA,
      currentNovelId: 'novel-a',
      currentChapterId: 'novel-b-chapter-1',
      localNovels: [...payloadA.localNovels, ...payloadB.localNovels],
      localChapters: [...payloadA.localChapters, ...payloadB.localChapters],
    }
    const { POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()

    const response = await POST(createWorkspaceRequest(adversarialPayload, {
      'Idempotency-Key': 'owner-target-mismatch',
      'X-Retale-Base-Revision': '0',
      'X-Retale-Revision-Novel-Id': 'novel-a',
    }))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'invalid_revision_contract',
      error: expect.stringContaining('resolved workspace novel'),
    })
    expect(readMutationState(novelADb)).toEqual(beforeA)
    expect(readMutationState(novelBDb)).toEqual(beforeB)
    expect(afterCallbacks).toHaveLength(0)
  })

  it('increments legacy POST revisions atomically without replay rows', async () => {
    const database = await createTestDatabase('retale-workspace-route-legacy-revisions', 'novel-legacy')
    clearWorkspaceRecoveryData(database)
    const { POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()

    const first = await POST(createWorkspaceRequest(createWorkspacePayload('novel-legacy', 'First')))
    const second = await POST(createWorkspaceRequest(createWorkspacePayload('novel-legacy', 'Second')))
    await expect(first.json()).resolves.toMatchObject({ revision: 1, replayed: false })
    await expect(second.json()).resolves.toMatchObject({ revision: 2, replayed: false })
    expect(database.prepare('SELECT revision FROM WorkspaceRuntimeState').get()).toEqual({ revision: 2 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM WorkspaceMutationReplay').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM WorkspaceStateBackup').get()).toEqual({ count: 1 })
    expect(database.prepare('SELECT requestedRevision FROM WorkspaceKnowledgeSyncState').get()).toEqual({ requestedRevision: 2 })
    expect(afterCallbacks).toHaveLength(1)
  })

  it.each(['POST', 'PATCH'] as const)('accepts arbitrary cross-origin %s writes', async (method) => {
    const database = await createTestDatabase('retale-workspace-route-origin', 'novel-origin')
    clearWorkspaceRecoveryData(database)
    if (method === 'PATCH') await seedWorkspaceRuntime(createWorkspacePayloadWithSideData('novel-origin', 'Origin Novel'))
    const { POST, PATCH, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const response = method === 'POST'
      ? await POST(createWorkspaceRequest(createWorkspacePayload('novel-origin'), {
          Origin: 'https://frontend.example',
        }))
      : await PATCH(createWorkspacePatchRequest(createChapterPatchPayload('novel-origin'), {
          Origin: 'https://frontend.example',
          'Idempotency-Key': 'cross-origin-key',
          'X-Retale-Base-Revision': '0',
        }))

    expect(response.status).toBe(200)
    expect(database.prepare('SELECT revision FROM WorkspaceRuntimeState').get()).toEqual({ revision: 1 })
    expect(afterCallbacks).toHaveLength(1)
  })

  it.each(['POST', 'PATCH'] as const)('requires application/json for %s while accepting media-type parameters', async (method) => {
    const database = await createTestDatabase('retale-workspace-route-media-type', 'novel-media')
    clearWorkspaceRecoveryData(database)
    if (method === 'PATCH') await seedWorkspaceRuntime(createWorkspacePayloadWithSideData('novel-media', 'Media'))
    const { POST, PATCH } = await importWorkspaceRouteWithAfterCallbacks()
    const handler = method === 'POST' ? POST : PATCH
    const payload = method === 'POST' ? createWorkspacePayload('novel-media') : createChapterPatchPayload('novel-media')
    const baseHeaders: Record<string, string> = method === 'PATCH'
      ? { 'Idempotency-Key': 'media-key', 'X-Retale-Base-Revision': '0', 'X-Retale-Revision-Novel-Id': 'novel-media' }
      : {}
    const unsupported = new Request('http://localhost/api/workspace', {
      method,
      body: JSON.stringify(payload),
      headers: { ...baseHeaders, 'Content-Type': 'text/plain' },
    })
    expect((await handler(unsupported)).status).toBe(415)
    const accepted = new Request('http://localhost/api/workspace', {
      method,
      body: JSON.stringify(payload),
      headers: { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8' },
    })
    expect((await handler(accepted)).status).toBe(200)
  })

  it.each([
    ['POST', 16 * 1024 * 1024],
    ['PATCH', 4 * 1024 * 1024],
  ] as const)('enforces declared and streamed byte limits for %s', async (method, maxBytes) => {
    const database = await createTestDatabase('retale-workspace-route-body-limit', 'novel-limit')
    clearWorkspaceRecoveryData(database)
    const { POST, PATCH, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const handler = method === 'POST' ? POST : PATCH
    const headers: Record<string, string> = method === 'PATCH'
      ? { 'Idempotency-Key': 'limit-key', 'X-Retale-Base-Revision': '0', 'X-Retale-Revision-Novel-Id': 'novel-limit' }
      : {}
    const exactDeclared = new Request('http://localhost/api/workspace', {
      method,
      body: JSON.stringify(method === 'POST' ? createWorkspacePayload('novel-limit') : createChapterPatchPayload('novel-limit')),
      headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': String(maxBytes) },
    })
    expect((await handler(exactDeclared)).status).not.toBe(413)
    const overDeclared = new Request('http://localhost/api/workspace', {
      method,
      body: '{}',
      headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': String(maxBytes + 1) },
    })
    expect((await handler(overDeclared)).status).toBe(413)
    const streamed = createOversizedStreamingRequest({ method, maxBytes, headers })
    expect((await handler(streamed.request)).status).toBe(413)
    expect(streamed.getCancellationReason()).toBeInstanceOf(Error)
    expect(afterCallbacks).toHaveLength(method === 'POST' ? 1 : 0)
    void database
  })

  it('rejects unsafe integer revision and wordCount values without mutation', async () => {
    const database = await createTestDatabase('retale-workspace-route-safe-integers', 'novel-safe')
    clearWorkspaceRecoveryData(database)
    await seedWorkspaceRuntime(createWorkspacePayloadWithSideData('novel-safe', 'Safe'))
    const { PATCH, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const unsafeRevision = await PATCH(createWorkspacePatchRequest(
      createChapterPatchPayload('novel-safe'),
      { 'Idempotency-Key': 'unsafe-revision', 'X-Retale-Base-Revision': String(Number.MAX_SAFE_INTEGER + 1) },
    ))
    const unsafeWordCount = await PATCH(createWorkspacePatchRequest(
      createChapterPatchPayload('novel-safe', { wordCount: Number.MAX_SAFE_INTEGER + 1 }),
      { 'Idempotency-Key': 'unsafe-word-count', 'X-Retale-Base-Revision': '0' },
    ))
    expect(unsafeRevision.status).toBe(422)
    expect(unsafeWordCount.status).toBe(422)
    expect(database.prepare('SELECT revision FROM WorkspaceRuntimeState').get()).toEqual({ revision: 0 })
    expect(afterCallbacks).toHaveLength(0)
  })

  it('enforces snapshot and PATCH semantic boundaries before persistence', async () => {
    const database = await createTestDatabase('retale-workspace-route-semantic-limits', 'novel-semantic')
    clearWorkspaceRecoveryData(database)
    const { POST, PATCH, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const chapters = Array.from({ length: 2_000 }, (_, index) => ({
      id: `chapter-${index}`,
      novelId: 'novel-semantic',
      title: `Chapter ${index}`,
      order: index,
      content: '',
      status: 'draft',
      wordCount: 0,
      updatedAt: '',
    }))
    expect((await POST(createWorkspaceRequest({
      currentNovelId: 'novel-semantic',
      localNovels: [{ id: 'novel-semantic', title: 'Semantic', summary: '', tags: [] }],
      localChapters: chapters,
    }))).status).toBe(200)
    const overChapters = await POST(createWorkspaceRequest({ localNovels: [], localChapters: [...chapters, chapters[0]] }))
    expect(overChapters.status).toBe(422)
    const overContent = await POST(createWorkspaceRequest({ localNovels: [], localChapters: [{ content: 'x'.repeat(1_000_001) }] }))
    expect(overContent.status).toBe(422)
    const overAggregate = await POST(createWorkspaceRequest({
      localNovels: [],
      localChapters: Array.from({ length: 9 }, () => ({ content: 'x'.repeat(1_000_000) })),
    }))
    expect(overAggregate.status).toBe(422)
    const labelBoundary = await PATCH(createWorkspacePatchRequest(
      createChapterPatchPayload('novel-semantic', { chapterId: 'chapter-0', updatedAtLabel: 'x'.repeat(128) }),
      { 'Idempotency-Key': 'label-boundary', 'X-Retale-Base-Revision': '1' },
    ))
    expect(labelBoundary.status).toBe(200)
    const labelOver = await PATCH(createWorkspacePatchRequest(
      createChapterPatchPayload('novel-semantic', { chapterId: 'chapter-0', updatedAtLabel: 'x'.repeat(129) }),
      { 'Idempotency-Key': 'label-over', 'X-Retale-Base-Revision': '2' },
    ))
    expect(labelOver.status).toBe(422)
    expect(afterCallbacks).toHaveLength(1)
    expect(database.prepare('SELECT revision FROM WorkspaceRuntimeState').get()).toEqual({ revision: 2 })
  })

  it('rejects unsafe snapshot wordCount values before persistence', async () => {
    const database = await createTestDatabase('retale-workspace-route-snapshot-word-count', 'novel-word-count')
    clearWorkspaceRecoveryData(database)
    const { POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await POST(createWorkspaceRequest({
      currentNovelId: 'novel-word-count',
      localNovels: [{ id: 'novel-word-count', title: 'Word Count', summary: '', tags: [] }],
      localChapters: [{ content: '', wordCount: Number.MAX_SAFE_INTEGER + 1 }],
    }))

    expect(response.status).toBe(422)
    expect(database.prepare('SELECT COUNT(*) AS count FROM WorkspaceRuntimeState').get()).toEqual({ count: 0 })
    expect(afterCallbacks).toHaveLength(0)
  })

  it('sanitizes persistence_failed and unexpected workspace 500 responses', async () => {
    const database = await createTestDatabase('retale-workspace-route-sanitized-errors', 'novel-errors')
    clearWorkspaceRecoveryData(database)
    await seedWorkspaceRuntime(createWorkspacePayloadWithSideData('novel-errors', 'Errors'))
    const mutation = await import('@/lib/server/workspace-mutation')
    mutation.setWorkspaceMutationFaultInjectorForTests(() => {
      throw new Error('secret database path /private/workspace.db')
    })
    const { PATCH, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const persistenceFailure = await PATCH(createWorkspacePatchRequest(
      createChapterPatchPayload('novel-errors'),
      { 'Idempotency-Key': 'sanitized-error', 'X-Retale-Base-Revision': '0' },
    ))
    mutation.setWorkspaceMutationFaultInjectorForTests(null)

    expect(persistenceFailure.status).toBe(500)
    await expect(persistenceFailure.json()).resolves.toEqual({
      ok: false,
      code: 'persistence_failed',
      error: 'Workspace persistence failed',
    })
    expect(afterCallbacks).toHaveLength(0)
    expect(database.prepare('SELECT revision FROM WorkspaceRuntimeState').get()).toEqual({ revision: 0 })
  })

  it('patches only the targeted chapter and persists revision, replay, and sync intent without rewriting the artifact', async () => {
    const database = await createTestDatabase('retale-workspace-route-patch-success', 'novel-patch')
    clearWorkspaceRecoveryData(database)
    const initialPayload = createWorkspacePayloadWithSideData('novel-patch', 'Patch Novel')
    await seedWorkspaceRuntime(initialPayload)
    const { PATCH, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()

    const response = await PATCH(createWorkspacePatchRequest(
      createChapterPatchPayload(),
      { 'Idempotency-Key': 'patch-success', 'X-Retale-Base-Revision': '0' },
    ))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-retale-workspace-revision')).toBe('1')
    expect(response.headers.get('x-retale-revision-novel-id')).toBe('novel-patch')
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      operation: 'chapter-patch',
      novelId: 'novel-patch',
      chapterId: 'novel-patch-chapter-1',
      revision: 1,
      replayed: false,
    })
    expect(database.prepare(
      `SELECT contentHtml, wordCount, updatedAtLabel
       FROM WorkspaceRuntimeChapter WHERE id = ?`,
    ).get('novel-patch-chapter-1')).toEqual({
      contentHtml: '<p>修订后的正文</p>',
      wordCount: 7,
      updatedAtLabel: '刚刚更新',
    })
    expect(database.prepare('SELECT revision FROM WorkspaceRuntimeState').get()).toEqual({ revision: 1 })
    expect(readWorkspaceStatePayload(database)).toBeNull()
    expect(readWorkspaceBackups(database)).toHaveLength(0)
    expect(database.prepare('SELECT operation, committedRevision FROM WorkspaceMutationReplay').get()).toEqual({
      operation: 'chapter-patch',
      committedRevision: 1,
    })
    expect(database.prepare('SELECT requestedRevision FROM WorkspaceKnowledgeSyncState').get()).toEqual({ requestedRevision: 1 })
    expect(afterCallbacks).toHaveLength(1)
  })

  it('accepts a PATCH Origin independently of request URL and Host', async () => {
    const database = await createTestDatabase('retale-workspace-route-host-origin', 'novel-patch')
    clearWorkspaceRecoveryData(database)
    await seedWorkspaceRuntime(createWorkspacePayloadWithSideData('novel-patch', 'Patch Novel'))
    const { PATCH } = await importWorkspaceRouteWithAfterCallbacks()

    const response = await PATCH(new Request('http://localhost:3000/api/workspace', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Host: '127.0.0.1:3000',
        Origin: 'http://127.0.0.1:3000',
        'Idempotency-Key': 'host-origin-patch',
        'X-Retale-Base-Revision': '0',
        'X-Retale-Revision-Novel-Id': 'novel-patch',
      },
      body: JSON.stringify(createChapterPatchPayload()),
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ revision: 1, operation: 'chapter-patch' })
    expect(database.prepare(
      'SELECT contentHtml FROM WorkspaceRuntimeChapter WHERE id = ?',
    ).get('novel-patch-chapter-1')).toEqual({ contentHtml: '<p>修订后的正文</p>' })
  })

  it.each([
    [null, {}, 400],
    [[], {}, 400],
    [createChapterPatchPayload(), {}, 422],
    [createChapterPatchPayload(), { 'Idempotency-Key': 'only-key' }, 422],
    [createChapterPatchPayload(), { 'X-Retale-Base-Revision': '0' }, 422],
    [createChapterPatchPayload('', { novelId: '' }), { 'Idempotency-Key': 'bad-body', 'X-Retale-Base-Revision': '0' }, 422],
    [createChapterPatchPayload('novel-contract', { wordCount: -1 }), { 'Idempotency-Key': 'bad-body', 'X-Retale-Base-Revision': '0' }, 422],
  ])('validates PATCH JSON, required headers, and body contracts', async (payload, headers, expectedStatus) => {
    const database = await createTestDatabase('retale-workspace-route-patch-validation', 'novel-contract')
    clearWorkspaceRecoveryData(database)
    const { PATCH, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const request = payload === null
      ? new Request('http://localhost/api/workspace', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: '{not-json',
        })
      : createWorkspacePatchRequest(payload as Record<string, unknown>, headers)

    const response = await PATCH(request)
    expect(response.status).toBe(expectedStatus)
    const body = await response.json()
    expect(body.ok).toBe(false)
    if (expectedStatus === 422) expect(body.code).toBe('invalid_revision_contract')
    expect(database.prepare('SELECT COUNT(*) AS count FROM WorkspaceRuntimeState').get()).toEqual({ count: 0 })
    expect(afterCallbacks).toHaveLength(0)
  })

  it('rejects PATCH with a missing or mismatched revision owner before mutation', async () => {
    const database = await createTestDatabase('retale-workspace-route-patch-owner-contract', 'novel-contract')
    clearWorkspaceRecoveryData(database)
    await seedWorkspaceRuntime(createWorkspacePayloadWithSideData('novel-contract', 'Contract'))
    const { PATCH, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const payload = createChapterPatchPayload('novel-contract')
    const missingOwner = await PATCH(new Request('http://localhost/api/workspace', {
      method: 'PATCH',
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'missing-owner',
        'X-Retale-Base-Revision': '0',
      },
    }))
    const mismatchedOwner = await PATCH(createWorkspacePatchRequest(payload, {
      'Idempotency-Key': 'mismatched-owner',
      'X-Retale-Base-Revision': '0',
      'X-Retale-Revision-Novel-Id': 'novel-other',
    }))

    for (const response of [missingOwner, mismatchedOwner]) {
      expect(response.status).toBe(422)
      await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'invalid_revision_contract' })
    }
    expect(database.prepare('SELECT revision FROM WorkspaceRuntimeState').get()).toEqual({ revision: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM WorkspaceMutationReplay').get()).toEqual({ count: 0 })
    expect(afterCallbacks).toHaveLength(0)
  })

  it('returns stale chapter context, replays exactly once, and rejects changed-payload key reuse', async () => {
    const database = await createTestDatabase('retale-workspace-route-patch-replay-conflicts', 'novel-patch')
    clearWorkspaceRecoveryData(database)
    await seedWorkspaceRuntime(createWorkspacePayloadWithSideData('novel-patch', 'Patch Novel'))
    const { PATCH, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const headers = { 'Idempotency-Key': 'patch-replay', 'X-Retale-Base-Revision': '0' }
    const requestPayload = createChapterPatchPayload()

    const committed = await PATCH(createWorkspacePatchRequest(requestPayload, headers))
    const replayed = await PATCH(createWorkspacePatchRequest(requestPayload, headers))
    const reused = await PATCH(createWorkspacePatchRequest({ ...requestPayload, content: '<p>不同正文</p>' }, headers))
    const stale = await PATCH(createWorkspacePatchRequest(
      { ...requestPayload, content: '<p>过期正文</p>' },
      { 'Idempotency-Key': 'patch-stale', 'X-Retale-Base-Revision': '0' },
    ))

    expect(committed.status).toBe(200)
    await expect(replayed.json()).resolves.toMatchObject({ revision: 1, replayed: true })
    expect(reused.status).toBe(409)
    await expect(reused.json()).resolves.toMatchObject({ code: 'idempotency_key_reused' })
    expect(stale.status).toBe(409)
    await expect(stale.json()).resolves.toMatchObject({
      code: 'stale_revision',
      currentRevision: 1,
      chapter: expect.objectContaining({ id: 'novel-patch-chapter-1', content: '<p>修订后的正文</p>' }),
    })
    expect(database.prepare('SELECT COUNT(*) AS count FROM WorkspaceMutationReplay').get()).toEqual({ count: 1 })
    expect(afterCallbacks).toHaveLength(1)
  })

  it('allows only one concurrent PATCH from the same base revision', async () => {
    const database = await createTestDatabase('retale-workspace-route-patch-concurrent', 'novel-patch')
    clearWorkspaceRecoveryData(database)
    await seedWorkspaceRuntime(createWorkspacePayloadWithSideData('novel-patch', 'Patch Novel'))
    const { PATCH, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()

    const responses = await Promise.all([
      PATCH(createWorkspacePatchRequest(
        createChapterPatchPayload('novel-patch', { content: '<p>A</p>' }),
        { 'Idempotency-Key': 'patch-concurrent-a', 'X-Retale-Base-Revision': '0' },
      )),
      PATCH(createWorkspacePatchRequest(
        createChapterPatchPayload('novel-patch', { content: '<p>B</p>' }),
        { 'Idempotency-Key': 'patch-concurrent-b', 'X-Retale-Base-Revision': '0' },
      )),
    ])

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    expect(database.prepare('SELECT revision FROM WorkspaceRuntimeState').get()).toEqual({ revision: 1 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM WorkspaceMutationReplay').get()).toEqual({ count: 1 })
    expect(afterCallbacks).toHaveLength(1)
  })

  it('maps missing chapters and missing or non-ready novels without scheduling sync', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-patch-lookup-statuses', 'novel-ready')
    getNovelDb('novel-ready')
    getNovelDb('novel-pending')
    seedNovelRegistryRow(controlDb, 'novel-ready', 'Ready')
    seedNovelRegistryRow(controlDb, 'novel-pending', 'Pending')
    await seedWorkspaceRuntimeForNovel('novel-ready', createWorkspacePayloadWithSideData('novel-ready', 'Ready'))
    controlDb.prepare('UPDATE NovelRegistry SET migrationStatus = ? WHERE novelId = ?').run('deleting', 'novel-pending')
    const { PATCH, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const patch = (payload: Record<string, unknown>, key: string) => PATCH(createWorkspacePatchRequest(
      payload,
      { 'Idempotency-Key': key, 'X-Retale-Base-Revision': '0' },
    ))

    const chapterMissing = await patch(createChapterPatchPayload('novel-ready', { chapterId: 'missing-chapter' }), 'missing-chapter')
    const novelMissing = await patch(createChapterPatchPayload('novel-missing'), 'missing-novel')
    const novelPending = await patch(createChapterPatchPayload('novel-pending'), 'pending-novel')

    expect(chapterMissing.status).toBe(404)
    await expect(chapterMissing.json()).resolves.toMatchObject({ code: 'chapter_not_found' })
    expect(novelMissing.status).toBe(404)
    await expect(novelMissing.json()).resolves.toMatchObject({ code: 'novel_not_found' })
    expect(novelPending.status).toBe(409)
    await expect(novelPending.json()).resolves.toMatchObject({ code: 'novel_not_ready' })
    expect(afterCallbacks).toHaveLength(0)
  })

  it('fences a PATCH queued behind deletion publication', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-patch-deletion-race', 'novel-alpha')
    const alphaDb = getNovelDb('novel-alpha')
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha')
    await seedWorkspaceRuntimeForNovel('novel-alpha', createWorkspacePayloadWithSideData('novel-alpha', 'Alpha'))
    const gateEntered = Promise.withResolvers<void>()
    const gateRelease = Promise.withResolvers<void>()
    const gateModule = await import('@/lib/server/per-novel-write-gate')
    const deletionPublication = gateModule.runWithPerNovelWriteGate('novel-alpha', async () => {
      gateEntered.resolve()
      await gateRelease.promise
      controlDb.prepare('UPDATE NovelRegistry SET migrationStatus = ? WHERE novelId = ?').run('deleted', 'novel-alpha')
    })
    await gateEntered.promise
    const { PATCH, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()

    const patchPromise = PATCH(createWorkspacePatchRequest(
      createChapterPatchPayload('novel-alpha'),
      { 'Idempotency-Key': 'patch-after-delete', 'X-Retale-Base-Revision': '0' },
    ))
    await Promise.resolve()
    gateRelease.resolve()
    await deletionPublication
    const response = await patchPromise

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'novel_not_ready' })
    expect(alphaDb.prepare('SELECT revision FROM WorkspaceRuntimeState').get()).toEqual({ revision: 0 })
    expect(afterCallbacks).toHaveLength(0)
  })

  it('accepts a cross-origin permanent delete and switches to the supplied survivor without touching control settings', async () => {
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
    const response = await DELETE(createWorkspaceDeleteRequest('novel-alpha', 'novel-beta', {
      Origin: 'https://frontend.example',
    }))

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
    controlDb.prepare('UPDATE NovelRegistry SET createdAt = ? WHERE novelId IN (?, ?)').run(
      '2026-08-12 00:00:01',
      'novel-alpha',
      'novel-beta',
    )

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

  it('uses the browser-requested survivor for resource deletion instead of the legacy active pointer', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-resource-delete-survivor', 'novel-alpha')
    for (const novelId of ['novel-alpha', 'novel-beta', 'novel-gamma']) {
      getNovelDb(novelId)
      seedNovelRegistryRow(controlDb, novelId, novelId)
    }

    const { DELETE } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await DELETE(createWorkspaceDeleteRequest('novel-beta', 'novel-gamma', {
      'X-Retale-Resource-Delete': '1',
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, activeNovelId: 'novel-gamma' })
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('WORKSPACE_ACTIVE_NOVEL_ID')).toEqual({ value: 'novel-gamma' })
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
    controlDb.prepare('UPDATE NovelRegistry SET createdAt = ? WHERE novelId IN (?, ?)').run(
      '2026-08-12 00:00:01',
      'novel-alpha',
      'novel-beta',
    )
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
    const getResponse = await GET(new Request('http://localhost/api/workspace'))
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
    expect((await GET(new Request('http://localhost/api/workspace'))).status).toBe(200)
    expect(afterCallbacks).toHaveLength(1)
    await afterCallbacks[0]()
    expect(fs.existsSync(quarantineDirectory)).toBe(true)

    expect((await GET(new Request('http://localhost/api/workspace'))).status).toBe(200)
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
    alphaDb.prepare('INSERT INTO WorkspaceRuntimeState (id) VALUES (?)').run('singleton')
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
    controlDb.prepare(
      `UPDATE NovelRegistry
       SET lifecycleToken = NULL, leaseExpiresAt = ?, claimedAt = NULL
       WHERE novelId = ?`,
    ).run('2000-01-01T00:00:00.000Z', 'novel-alpha')
    vi.resetModules()
    const { GET, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const getResponse = await GET(new Request('http://localhost/api/workspace'))
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
    const response = await GET(new Request('http://localhost/api/workspace'))
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
    const response = await GET(new Request('http://localhost/api/workspace'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.localNovels).toMatchObject([
      { id: 'novel-alpha', title: 'Alpha Library' },
      { id: 'novel-beta', title: 'Beta Library' },
    ])
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
    const response = await GET(new Request('http://localhost/api/workspace'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.localNovels).toMatchObject([
      { id: 'novel-beta', title: 'Beta Library' },
      { id: 'novel-alpha', title: 'Alpha Library' },
    ])
    expect(payload.localChapters).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'novel-alpha-chapter-1', novelId: 'novel-alpha' }),
      expect.objectContaining({ id: 'novel-beta-chapter-1', novelId: 'novel-beta' }),
    ]))
    expect(payload.currentNovelId).toBe('novel-beta')
    expect(payload.currentChapterId).toBe('novel-beta-chapter-1')
  })

  it('returns compact active-first library summaries using only mainline chapter metrics', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-library-summary', 'novel-beta')

    await seedWorkspaceRuntimeForNovel('novel-alpha', createWorkspacePayloadWithSideData('novel-alpha', 'Alpha Library'))
    await seedWorkspaceRuntimeForNovel('novel-beta', createWorkspacePayloadWithSideData('novel-beta', 'Beta Library'))
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha Library')
    seedNovelRegistryRow(controlDb, 'novel-beta', 'Beta Library')

    const betaDb = getNovelDb('novel-beta')
    betaDb.prepare(
      `INSERT INTO WorkspaceRuntimeChapter (
         workspaceStateId, id, novelId, volumeId, parentChapterId, title, sortOrder,
         contentHtml, status, wordCount, updatedAtLabel
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'singleton',
      'novel-beta-branch-1',
      'novel-beta',
      'novel-beta-volume-1',
      'novel-beta-chapter-1',
      'Branch One',
      2,
      '<p>Branch text excluded from library totals.</p>',
      'draft',
      999,
      'branch update',
    )

    const { GET, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await GET(createWorkspaceLibrarySummaryRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(payload).toEqual({
      ok: true,
      activeNovelId: 'novel-beta',
      novels: [
        {
          id: 'novel-beta',
          title: 'Beta Library',
          summary: '保留参考面板数据',
          tags: ['测试', '侧写'],
          updatedAt: '刚刚',
          wordCount: 2,
          chapterCount: 1,
          firstChapterId: 'novel-beta-chapter-1',
        },
        {
          id: 'novel-alpha',
          title: 'Alpha Library',
          summary: '保留参考面板数据',
          tags: ['测试', '侧写'],
          updatedAt: '刚刚',
          wordCount: 2,
          chapterCount: 1,
          firstChapterId: 'novel-alpha-chapter-1',
        },
      ],
    })
    expect(JSON.stringify(payload)).not.toContain('正文')
    expect(JSON.stringify(payload)).not.toContain('Branch text excluded')
    expect(afterCallbacks).toHaveLength(1)
  })

  it('does not read chapter bodies or invoke recovery when normalized library runtime exists', async () => {
    const { controlDb, getNovelDb } = await createTestDataRoot('retale-workspace-route-library-summary-lightweight', 'novel-large')
    const largeContent = `<p>${'large workspace body '.repeat(50_000)}</p>`
    await seedWorkspaceRuntimeForNovel('novel-large', {
      ...createWorkspacePayloadWithSideData('novel-large', 'Large Library'),
      localChapters: [{
        ...createWorkspacePayloadWithSideData('novel-large', 'Large Library').localChapters[0],
        content: largeContent,
        originalContent: largeContent,
        wordCount: 1_000_000,
      }],
    })
    seedNovelRegistryRow(controlDb, 'novel-large', 'Large Library')
    const database = getNovelDb('novel-large')
    const sqliteConstants = (await import('node:sqlite') as unknown as {
      constants: { SQLITE_OK: number; SQLITE_READ: number }
    }).constants
    const databaseWithAuthorizer = database as DatabaseSync & {
      setAuthorizer(callback: ((
        actionCode: number,
        tableName: string | null,
        columnName: string | null,
      ) => number) | null): void
    }
    const forbiddenReads: string[] = []
    databaseWithAuthorizer.setAuthorizer((actionCode, tableName, columnName) => {
      if (
        actionCode === sqliteConstants.SQLITE_READ
        && (
          (tableName === 'WorkspaceRuntimeChapter' && ['contentHtml', 'originalContentHtml'].includes(columnName ?? ''))
          || tableName === 'KnowledgeChapter'
          || (tableName === 'WorkspaceState' && columnName === 'payload')
        )
      ) {
        forbiddenReads.push(`${tableName}.${columnName}`)
      }
      return sqliteConstants.SQLITE_OK
    })

    const { GET } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await GET(createWorkspaceLibrarySummaryRequest())
    databaseWithAuthorizer.setAuthorizer(null)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      novels: [expect.objectContaining({ id: 'novel-large', wordCount: 1_000_000 })],
    })
    expect(forbiddenReads).toEqual([])
  })

  it('rejects invalid library-summary flags without opening or creating novel storage', async () => {
    const { controlDb } = await createTestDataRoot('retale-workspace-route-library-summary-invalid', null)
    seedNovelRegistryRow(controlDb, 'novel-alpha', 'Alpha Library')
    const novelDirectory = path.join(process.env.RETALE_DATA_DIR ?? 'data', 'novels', 'novel-alpha')
    expect(fs.existsSync(novelDirectory)).toBe(false)

    const { GET, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await GET(createWorkspaceLibrarySummaryRequest('yes'))

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'librarySummary must be 1' })
    expect(fs.existsSync(novelDirectory)).toBe(false)
    expect(afterCallbacks).toHaveLength(0)
  })

  it('repairs and summarizes ready novels whose normalized runtime is missing but knowledge data is recoverable', async () => {
    const database = await createTestDatabase('retale-workspace-route-library-summary-recovery', 'novel-recover')
    clearWorkspaceRecoveryData(database)
    seedRecoverableKnowledge(database)
    const { getControlDb } = await import('@/lib/server/db-resolver')
    seedNovelRegistryRow(getControlDb(), 'novel-recover', 'Recovered Novel')

    const { GET } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await GET(createWorkspaceLibrarySummaryRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.novels).toEqual([
      expect.objectContaining({
        id: 'novel-recover',
        title: 'Recovered Novel',
        chapterCount: 2,
        firstChapterId: 'chapter-recover-1',
      }),
    ])
    expect(readWorkspaceRuntimeChapterCount(database)).toBe(2)
  })

  it('repairs a missing workspace from recoverable knowledge data', async () => {
    const database = await createTestDatabase('retale-workspace-route-recover-missing', 'novel-recover')
    clearWorkspaceRecoveryData(database)
    seedRecoverableKnowledge(database)

    const { GET } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await GET(new Request('http://localhost/api/workspace'))
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
    const response = await GET(new Request('http://localhost/api/workspace'))
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
    const response = await GET(new Request('http://localhost/api/workspace'))
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
    const response = await GET(new Request('http://localhost/api/workspace'))
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
    const response = await GET(new Request('http://localhost/api/workspace'))
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
    const response = await GET(new Request('http://localhost/api/workspace'))
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
    const response = await GET(new Request('http://localhost/api/workspace'))
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
    const response = await GET(new Request('http://localhost/api/workspace'))
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

  it('preserves a running first rebuild during an unchanged refresh-style save', async () => {
    const database = await createTestDatabase('retale-workspace-route-unchanged-active-rebuild', 'novel-refresh')
    clearWorkspaceRecoveryData(database)
    const payload = createWorkspacePayloadWithSideData('novel-refresh', 'Refresh Novel')
    const chapter = payload.localChapters[0]
    const { hashContent } = await import('@/lib/server/knowledge-store')
    const { htmlToPlainText } = await import('@/lib/utils')
    const rawText = htmlToPlainText(chapter.content)

    database.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run(
      'novel-refresh',
      'Refresh Novel',
      'workspace',
    )
    database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run(
      'novel-refresh:main',
      'novel-refresh',
      'main',
    )
    database.prepare(
      `INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      chapter.id,
      'novel-refresh',
      'novel-refresh:main',
      1,
      chapter.title,
      rawText,
      5,
      0,
      null,
      hashContent(rawText),
      'ready',
    )
    database.prepare(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, progress)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'job-refresh-running',
      'novel-refresh',
      'novel-refresh:main',
      'extract_chapter_knowledge',
      'running',
      'extracting',
      0.4,
    )

    expect(database.prepare(
      `SELECT (
        (SELECT COUNT(*) FROM KnowledgeEntity)
        + (SELECT COUNT(*) FROM KnowledgeFact)
        + (SELECT COUNT(*) FROM KnowledgeRelation)
        + (SELECT COUNT(*) FROM EntityLink)
        + (SELECT COUNT(*) FROM EntityState)
        + (SELECT COUNT(*) FROM KnowledgeEvent)
        + (SELECT COUNT(*) FROM KnowledgeWorld)
      ) AS count`,
    ).get()).toEqual({ count: 0 })
    const chapterBefore = database.prepare(
      `SELECT chapterNo, title, rawText, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
       FROM KnowledgeChapter WHERE id = ?`,
    ).get(chapter.id)
    const jobBefore = database.prepare(
      `SELECT status, currentStep, progress
       FROM KnowledgeJob WHERE id = ?`,
    ).get('job-refresh-running')

    const { POST, afterCallbacks } = await importWorkspaceRouteWithAfterCallbacks()
    const response = await POST(createWorkspaceRequest(payload))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true })
    expect(afterCallbacks).toHaveLength(1)
    await afterCallbacks[0]()

    expect(database.prepare(
      `SELECT status, currentStep, progress
       FROM KnowledgeJob WHERE id = ?`,
    ).get('job-refresh-running')).toEqual(jobBefore)
    expect(database.prepare(
      `SELECT chapterNo, title, rawText, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
       FROM KnowledgeChapter WHERE id = ?`,
    ).get(chapter.id)).toEqual(chapterBefore)
    expect(readWorkspaceKnowledgeSyncState(database)).toMatchObject({
      startedSourceUpdatedAt: null,
      syncedSourceUpdatedAt: expect.any(String),
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
    await vi.waitFor(() => {
      expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(1)
    })

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
    expect(afterCallbacks).toHaveLength(1)

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
    await vi.waitFor(() => {
      expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(1)
    })
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
    expect(afterCallbacks).toHaveLength(1)
    expect(syncWorkspacePayloadToKnowledgeStore).toHaveBeenCalledTimes(1)

    firstSyncControl.resolve?.()
    await backgroundSync
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
