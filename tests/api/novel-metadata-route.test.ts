import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeWorkspaceState } from '@/lib/workspace-state'

const cleanupDirectories: string[] = []
const originalDataDir = process.env.RETALE_DATA_DIR

async function createFixture(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  cleanupDirectories.push(root)
  process.env.RETALE_DATA_DIR = path.join(root, 'data')
  vi.resetModules()

  const resolver = await import('@/lib/server/db-resolver')
  const novelId = 'novel-metadata'
  const storage = resolver.getNovelStoragePaths(novelId)
  const controlDb = resolver.getControlDb()
  controlDb.prepare(
    `INSERT INTO NovelRegistry (
       novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus
     ) VALUES (?, ?, ?, ?, ?, '1', 'ready')`,
  ).run(novelId, novelId, 'Old title', storage.databasePath, storage.lanceDbPath)

  const database = resolver.getNovelDb(novelId)
  const { createNovelDatabaseAccess } = await import('@/lib/server/database-access')
  const { persistWorkspaceRuntimeState } = await import('@/lib/server/workspace-resilience')
  const payload = normalizeWorkspaceState({
    currentNovelId: novelId,
    currentChapterId: 'chapter-1',
    localNovels: [{ id: novelId, title: 'Old title', summary: 'Summary', tags: ['test'] }],
    localChapters: [{
      id: 'chapter-1',
      novelId,
      title: 'Chapter 1',
      order: 1,
      content: '<p>Body</p>',
      originalContent: '<p>Body</p>',
      status: 'draft',
      wordCount: 1,
      updatedAt: 'now',
    }],
  })
  await persistWorkspaceRuntimeState(payload, 'singleton', createNovelDatabaseAccess(novelId))
  database.prepare('INSERT INTO NovelRecord (id, title, author, sourceType) VALUES (?, ?, ?, ?)')
    .run(novelId, 'Old title', 'Old author', 'workspace')

  vi.doMock('@/lib/server/workspace-background', () => ({
    schedulePendingWorkspaceNovelCleanupScan: vi.fn(),
    scheduleWorkspaceKnowledgeSync: vi.fn(),
    scheduleWorkspaceKnowledgeSyncRecovery: vi.fn(),
    scheduleWorkspaceNovelCleanup: vi.fn(),
  }))

  const novelRoute = await import('@/app/api/novels/[novelId]/route')
  const coverRoute = await import('@/app/api/novels/[novelId]/cover/route')
  return { novelId, controlDb, database, novelRoute, coverRoute, resolver }
}

function metadataRequest(novelId: string, input: {
  title: string
  author: string
  removeCover?: boolean
  cover?: File
}) {
  const formData = new FormData()
  formData.set('title', input.title)
  formData.set('author', input.author)
  formData.set('removeCover', input.removeCover ? '1' : '0')
  if (input.cover) formData.set('cover', input.cover)
  return new Request(`http://localhost/api/novels/${novelId}`, {
    method: 'PATCH',
    body: formData,
  })
}

afterEach(async () => {
  vi.restoreAllMocks()
  if (originalDataDir === undefined) delete process.env.RETALE_DATA_DIR
  else process.env.RETALE_DATA_DIR = originalDataDir
  try {
    const resolver = await import('@/lib/server/db-resolver')
    resolver.resetResolvedDatabasesForTests()
    const gate = await import('@/lib/server/per-novel-write-gate')
    gate.resetPerNovelWriteGatesForTests()
  } catch (error) {
    void error
  }
  vi.resetModules()
  while (cleanupDirectories.length) {
    const directory = cleanupDirectories.pop()
    if (directory) fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('novel library metadata route', () => {
  it('updates title and author while keeping the cover out of workspace payloads', async () => {
    const fixture = await createFixture('retale-novel-metadata')
    const jpeg = new File([
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]),
    ], 'cover.jpg', { type: 'image/jpeg' })

    const response = await fixture.novelRoute.PATCH(
      metadataRequest(fixture.novelId, { title: 'New title', author: 'New author', cover: jpeg }),
      { params: Promise.resolve({ novelId: fixture.novelId }) },
    )
    const result = await response.json() as {
      ok: boolean
      novel: { title: string; author: string; coverImage: string }
    }

    expect(response.status).toBe(200)
    expect(result).toMatchObject({
      ok: true,
      novel: { title: 'New title', author: 'New author' },
    })
    expect(result.novel.coverImage).toMatch(/^\/api\/novels\/novel-metadata\/cover\?v=\d+$/u)
    expect(fixture.controlDb.prepare('SELECT title, author FROM NovelRegistry WHERE novelId = ?').get(fixture.novelId)).toEqual({
      title: 'New title',
      author: 'New author',
    })
    expect(fixture.database.prepare('SELECT title FROM WorkspaceRuntimeNovel WHERE id = ?').get(fixture.novelId)).toEqual({ title: 'New title' })
    expect(fixture.database.prepare('SELECT title, author FROM NovelRecord WHERE id = ?').get(fixture.novelId)).toEqual({
      title: 'New title',
      author: 'New author',
    })

    const workspaceResponse = await fixture.novelRoute.GET(
      new Request(`http://localhost/api/novels/${fixture.novelId}`),
      { params: Promise.resolve({ novelId: fixture.novelId }) },
    )
    const workspace = await workspaceResponse.json() as { localNovels: Array<Record<string, unknown>> }
    expect(workspace.localNovels[0]).toMatchObject({ id: fixture.novelId, title: 'New title' })
    expect(workspace.localNovels[0]).not.toHaveProperty('author')
    expect(workspace.localNovels[0]).not.toHaveProperty('coverImage')

    const coverResponse = await fixture.coverRoute.GET(
      new Request(`http://localhost${result.novel.coverImage}`),
      { params: Promise.resolve({ novelId: fixture.novelId }) },
    )
    expect(coverResponse.status).toBe(200)
    expect(coverResponse.headers.get('content-type')).toBe('image/jpeg')
    expect(new Uint8Array(await coverResponse.arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([0xff, 0xd8, 0xff]))
  })

  it('removes a prior cover and rejects invalid image uploads', async () => {
    const fixture = await createFixture('retale-novel-metadata-remove')
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9])], 'cover.jpg', { type: 'image/jpeg' })
    const created = await fixture.novelRoute.PATCH(
      metadataRequest(fixture.novelId, { title: 'Old title', author: '', cover: jpeg }),
      { params: Promise.resolve({ novelId: fixture.novelId }) },
    )
    const createdPayload = await created.json() as { novel: { coverImage: string } }

    const invalid = await fixture.novelRoute.PATCH(
      metadataRequest(fixture.novelId, {
        title: 'Old title',
        author: '',
        cover: new File(['not an image'], 'cover.png', { type: 'image/png' }),
      }),
      { params: Promise.resolve({ novelId: fixture.novelId }) },
    )
    expect(invalid.status).toBe(422)

    const removed = await fixture.novelRoute.PATCH(
      metadataRequest(fixture.novelId, { title: 'Old title', author: '', removeCover: true }),
      { params: Promise.resolve({ novelId: fixture.novelId }) },
    )
    const removedPayload = await removed.json() as { novel: { coverImage: string } }
    expect(removed.status).toBe(200)
    expect(removedPayload.novel.coverImage).toBe('')

    const oldCover = await fixture.coverRoute.GET(
      new Request(`http://localhost${createdPayload.novel.coverImage}`),
      { params: Promise.resolve({ novelId: fixture.novelId }) },
    )
    expect(oldCover.status).toBe(404)
  })
})
