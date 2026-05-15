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
  database.prepare('DELETE FROM WorkspaceState').run()
  database.prepare('INSERT INTO WorkspaceState (id, payload) VALUES (?, ?)').run('singleton', '{}')
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

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()

  if (globalForSqlite.sqlite) {
    try {
      globalForSqlite.sqlite.close()
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
    const database = createTestDatabase('chatbook-import-txt-route-awaits-sync')
    resetWorkspaceState(database)

    let resolveSync: (() => void) | null = null
    const syncWorkspacePayloadToKnowledgeStore = vi.fn(
      () => new Promise<void>((resolve) => {
        resolveSync = resolve
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

    resolveSync?.()

    const response = await responsePromise
    expect(response.status).toBe(200)

    const payload = await response.json() as { ok: boolean; novelId: string; chapterCount: number }
    expect(payload.ok).toBe(true)
    expect(payload.novelId).toMatch(/^novel_/)
    expect(payload.chapterCount).toBe(3)
  })

  it('surfaces knowledge sync failures instead of reporting a broken import as success', async () => {
    const database = createTestDatabase('chatbook-import-txt-route-sync-error')
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
})
