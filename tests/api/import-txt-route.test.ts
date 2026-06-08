import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '@/lib/server/sqlite'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }

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

afterEach(() => {
  vi.restoreAllMocks()
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

describe('import-txt route', () => {
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

    vi.doMock('@/lib/server/knowledge-rebuild', () => ({
      syncWorkspacePayloadToKnowledgeStore: vi.fn(async () => {}),
    }))

    const { POST } = await import('@/app/api/import-txt/route')
    const response = await POST(createGb18030ImportRequest())

    expect(response.status).toBe(200)
    const saved = database.prepare('SELECT payload FROM WorkspaceState WHERE id = ?').get('singleton') as { payload: string }
    const payload = JSON.parse(saved.payload) as {
      localChapters: Array<{ title: string; content: string }>
    }

    expect(payload.localChapters[0]?.content).toContain('本书由【示例组】整理')
    expect(payload.localChapters[1]?.title).toBe('第1章 初遇')
    expect(payload.localChapters[1]?.content).toContain('林澄开始记录这次练习。')
    expect(saved.payload).not.toContain('����')
    expect(readWorkspaceRuntimeCounts(database)).toEqual({ novels: 1, chapters: 2 })
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
