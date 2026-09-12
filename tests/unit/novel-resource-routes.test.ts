import { beforeEach, describe, expect, it, vi } from 'vitest'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'

const resourceHandlers = vi.hoisted(() => ({
  getCollection: vi.fn(),
  getNovel: vi.fn(),
  saveNovel: vi.fn(),
  patchChapter: vi.fn(),
  deleteNovel: vi.fn(),
}))

vi.mock('@/lib/server/novel-resource-handlers', () => ({
  getNovelCollection: resourceHandlers.getCollection,
  getNovelResource: resourceHandlers.getNovel,
  saveNovelResource: resourceHandlers.saveNovel,
  patchChapterResource: resourceHandlers.patchChapter,
  deleteNovelResource: resourceHandlers.deleteNovel,
}))

import { GET as getNovels } from '@/app/api/novels/route'
import {
  DELETE as deleteNovel,
  GET as getNovel,
  POST as saveNovel,
} from '@/app/api/novels/[novelId]/route'
import { PATCH as patchChapter } from '@/app/api/chapters/[chapterId]/route'

describe('novel resource routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exposes the novel collection directly', async () => {
    resourceHandlers.getCollection.mockResolvedValue(Response.json({
      ok: true,
      novels: [{ id: 'novel-a' }],
    }, { headers: { 'Cache-Control': 'no-store' } }))

    const response = await getNovels()

    await expect(response.json()).resolves.toEqual({ ok: true, novels: [{ id: 'novel-a' }] })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('loads a novel resource without browser session fields', async () => {
    resourceHandlers.getNovel.mockResolvedValue(Response.json({
      currentNovelId: 'server-selection',
      currentChapterId: 'server-chapter',
      currentTab: 'outline',
      helperTab: 'stats',
      focusMode: true,
      selectionText: 'server selection',
      selectedParagraphIndex: 4,
      presetCompatSessionState: { stale: true },
      aiSettings: { provider: 'legacy' },
      localNovels: [{ id: 'novel-a' }],
      localChapters: [],
      workspaceRevision: 3,
      revisionNovelId: 'novel-a',
    }))

    const response = await getNovel(
      new Request('http://localhost/api/novels/novel-a'),
      { params: Promise.resolve({ novelId: 'novel-a' }) },
    )
    expect(resourceHandlers.getNovel.mock.calls[0]?.[1]).toBe('novel-a')
    await expect(response.json()).resolves.toEqual({
      localNovels: [{ id: 'novel-a' }],
      localChapters: [],
      workspaceRevision: 3,
      revisionNovelId: 'novel-a',
    })
  })

  it('deduplicates identical original chapter content on the wire', async () => {
    resourceHandlers.getNovel.mockResolvedValue(Response.json({
      localNovels: [{ id: 'novel-a' }],
      localChapters: [{
        id: 'chapter-a',
        novelId: 'novel-a',
        title: 'Chapter A',
        order: 1,
        content: '<p>Same body</p>',
        originalContent: '<p>Same body</p>',
        status: 'draft',
        wordCount: 2,
        updatedAt: 'now',
      }],
      workspaceRevision: 3,
      revisionNovelId: 'novel-a',
    }))

    const response = await getNovel(
      new Request('http://localhost/api/novels/novel-a'),
      { params: Promise.resolve({ novelId: 'novel-a' }) },
    )

    const payload = await response.json() as Record<string, unknown>
    expect(payload).toMatchObject({
      chapterContentEncoding: 'original-content-equals-content-v1',
      localChapters: [{
        id: 'chapter-a',
        content: '<p>Same body</p>',
      }],
    })
    const chapters = payload.localChapters as Array<Record<string, unknown>>
    expect(chapters[0]?.originalContent).toBeUndefined()
  })

  it('opens with chapter metadata and only the requested chapter text', async () => {
    resourceHandlers.getNovel.mockImplementation(() => Response.json({
      localNovels: [{ id: 'novel-a' }],
      localChapters: [
        { id: 'first', order: 1, content: 'First body', originalContent: 'First original' },
        { id: 'second', order: 2, content: 'Second body', originalContent: 'Second original' },
      ],
      workspaceRevision: 9, revisionNovelId: 'novel-a',
    }))
    const context = { params: Promise.resolve({ novelId: 'novel-a' }) }
    for (const [query, selected] of [['view=workspace', 'first'], ['view=workspace&chapterId=second', 'second']]) {
      const response = await getNovel(new Request(`http://localhost/api/novels/novel-a?${query}`), context)
      const payload = await response.json()
      expect(payload.localChapters).toHaveLength(2)
      expect(payload.localChapters.find((chapter: { id: string }) => chapter.id === selected)).not.toHaveProperty('contentLoaded')
      const unloaded = payload.localChapters.find((chapter: { id: string }) => chapter.id !== selected)
      expect(unloaded).toMatchObject({ content: '', contentLoaded: false })
      expect(unloaded).not.toHaveProperty('originalContent')
    }
    const single = await getNovel(new Request('http://localhost/api/novels/novel-a?view=chapter&chapterId=second'), context)
    expect(await single.json()).toEqual({
      chapter: { id: 'second', order: 2, content: 'Second body', originalContent: 'Second original' },
      workspaceRevision: 9, revisionNovelId: 'novel-a',
    })
  })

  it.each([
    ['gzip, br', 'br'],
    ['gzip;q=1, br;q=0.5', 'gzip'],
    ['gzip;q=0, br;q=0', null],
    ['br;q=0, *;q=0.5', 'gzip'],
    ['identity;q=1, gzip;q=0.5', null],
  ] as const)('negotiates %s without changing chapter data or revision authority', async (acceptEncoding, encoding) => {
    const content = '<p>Chapter text with repeated story context.</p>'.repeat(200)
    resourceHandlers.getNovel.mockResolvedValue(Response.json({
      localNovels: [{ id: 'novel-a' }],
      localChapters: [{ id: 'chapter-a', content, originalContent: content }],
      workspaceRevision: 9,
      revisionNovelId: 'novel-a',
    }, { headers: {
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'X-Retale-Workspace-Revision': '9',
      'X-Retale-Revision-Novel-Id': 'novel-a',
    } }))
    const response = await getNovel(new Request('http://localhost/api/novels/novel-a', {
      headers: { 'Accept-Encoding': acceptEncoding },
    }), { params: Promise.resolve({ novelId: 'novel-a' }) })
    const bytes = Buffer.from(await response.arrayBuffer())
    const decoded = encoding === 'br' ? brotliDecompressSync(bytes) : encoding === 'gzip' ? gunzipSync(bytes) : bytes
    expect(JSON.parse(decoded.toString())).toEqual({
      localNovels: [{ id: 'novel-a' }],
      localChapters: [{ id: 'chapter-a', content }],
      workspaceRevision: 9,
      revisionNovelId: 'novel-a',
      chapterContentEncoding: 'original-content-equals-content-v1',
    })
    expect(response.headers.get('Content-Encoding')).toBe(encoding)
    expect(response.headers.get('Content-Length')).toBe(String(bytes.byteLength))
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache, max-age=0, must-revalidate')
    expect(response.headers.get('Vary')).toBe('Origin, Accept-Encoding')
    expect(response.headers.get('X-Retale-Workspace-Revision')).toBe('9')
    expect(response.headers.get('X-Retale-Revision-Novel-Id')).toBe('novel-a')
    if (encoding) expect(bytes.byteLength).toBeLessThan(decoded.byteLength / 2)
  })

  it('revalidates unchanged novels without retransmitting or compressing their body', async () => {
    const content = '<p>Cached chapter.</p>'.repeat(200)
    resourceHandlers.getNovel.mockImplementation(() => Response.json({
      localNovels: [{ id: 'novel-a' }],
      localChapters: [{ id: 'chapter-a', content, originalContent: content }],
      workspaceRevision: 9,
      revisionNovelId: 'novel-a',
    }, { headers: {
      'Cache-Control': 'no-store',
      'X-Retale-Workspace-Revision': '9',
      'X-Retale-Revision-Novel-Id': 'novel-a',
    } }))
    const context = { params: Promise.resolve({ novelId: 'novel-a' }) }
    const first = await getNovel(new Request('http://localhost/api/novels/novel-a'), context)
    const etag = first.headers.get('ETag')!
    expect(first.status).toBe(200)
    expect(etag).toMatch(/^W\/".+"$/u)

    const reopened = await getNovel(new Request('http://localhost/api/novels/novel-a', {
      headers: { 'If-None-Match': `"older", ${etag}`, 'Accept-Encoding': 'br, gzip' },
    }), context)
    expect(reopened.status).toBe(304)
    expect(await reopened.text()).toBe('')
    expect(reopened.headers.get('ETag')).toBe(etag)
    expect(reopened.headers.get('Cache-Control')).toBe(first.headers.get('Cache-Control'))
    expect(reopened.headers.get('Vary')).toContain('Accept-Encoding')
    expect(reopened.headers.get('Content-Encoding')).toBeNull()
    expect(reopened.headers.get('Content-Length')).toBeNull()
    expect(reopened.headers.get('X-Retale-Workspace-Revision')).toBe('9')
    expect(reopened.headers.get('X-Retale-Revision-Novel-Id')).toBe('novel-a')
  })

  it.each([
    ['chapter content at the same revision', { localChapters: [{ id: 'chapter-a', content: 'Changed' }] }],
    ['knowledge data at the same revision', { localCharacters: [{ id: 'character-a', name: 'Changed' }] }],
    ['revision', { workspaceRevision: 10 }],
    ['revision owner', { revisionNovelId: 'novel-b' }],
  ])('refreshes cached novels when %s changes', async (_name, change) => {
    const payload = {
      localNovels: [{ id: 'novel-a' }],
      localChapters: [{ id: 'chapter-a', content: 'Original' }],
      localCharacters: [],
      workspaceRevision: 9,
      revisionNovelId: 'novel-a',
    }
    resourceHandlers.getNovel.mockImplementation(() => Response.json(payload))
    const context = { params: Promise.resolve({ novelId: 'novel-a' }) }
    const first = await getNovel(new Request('http://localhost/api/novels/novel-a'), context)
    const etag = first.headers.get('ETag')!
    resourceHandlers.getNovel.mockImplementation(() => Response.json({ ...payload, ...change }))

    const refreshed = await getNovel(new Request('http://localhost/api/novels/novel-a', {
      headers: { 'If-None-Match': etag },
    }), context)
    expect(refreshed.status).toBe(200)
    expect(refreshed.headers.get('ETag')).not.toBe(etag)
    expect(await refreshed.json()).toMatchObject(change)
  })

  it.each([404, 500])('does not cache or return 304 for a %s error', async (status) => {
    const error = { ok: false, error: 'Novel unavailable' }
    resourceHandlers.getNovel.mockResolvedValue(Response.json(error, {
      status, headers: { 'Cache-Control': 'no-store' },
    }))
    const response = await getNovel(new Request('http://localhost/api/novels/novel-a', {
      headers: { 'If-None-Match': '*' },
    }), { params: Promise.resolve({ novelId: 'novel-a' }) })
    expect(response.status).toBe(status)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('ETag')).toBeNull()
    expect(await response.json()).toEqual(error)
  })

  it('keeps deletion status uncached even with a conditional request', async () => {
    const status = { ok: true, novelId: 'novel-a', deletionState: 'deleted' }
    resourceHandlers.getNovel.mockResolvedValue(Response.json(status, {
      headers: { 'Cache-Control': 'no-store' },
    }))
    const response = await getNovel(new Request('http://localhost/api/novels/novel-a?deletionStatus=1', {
      headers: { 'If-None-Match': '*' },
    }), { params: Promise.resolve({ novelId: 'novel-a' }) })
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('ETag')).toBeNull()
    expect(await response.json()).toEqual(status)
  })

  it('binds novel saves, deletion, and chapter patches to their resource path identifiers', async () => {
    resourceHandlers.saveNovel.mockImplementation(async (_request: Request, novelId: string) => Response.json({
      novelId,
    }))
    resourceHandlers.patchChapter.mockImplementation(async (_request: Request, chapterId: string) => Response.json({
      chapterId,
    }))
    resourceHandlers.deleteNovel.mockResolvedValue(Response.json({
      ok: true,
      deletedNovelId: 'novel-a',
      nextNovelId: 'novel-b',
      deletionState: 'deleted',
      cleanupPending: false,
    }))

    const saveResponse = await saveNovel(
      new Request('http://localhost/api/novels/novel-a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentNovelId: 'novel-a' }),
      }),
      { params: Promise.resolve({ novelId: 'novel-a' }) },
    )
    await expect(saveResponse.json()).resolves.toEqual({ novelId: 'novel-a' })

    const patchResponse = await patchChapter(
      new Request('http://localhost/api/chapters/chapter-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterId: 'chapter-a' }),
      }),
      { params: Promise.resolve({ chapterId: 'chapter-a' }) },
    )
    await expect(patchResponse.json()).resolves.toEqual({ chapterId: 'chapter-a' })

    const deleteResponse = await deleteNovel(
      new Request('http://localhost/api/novels/novel-a?nextNovelId=novel-b', { method: 'DELETE' }),
      { params: Promise.resolve({ novelId: 'novel-a' }) },
    )
    await expect(deleteResponse.json()).resolves.toEqual({
      ok: true,
      deletedNovelId: 'novel-a',
      nextNovelId: 'novel-b',
      deletionState: 'deleted',
      cleanupPending: false,
    })
    expect(resourceHandlers.deleteNovel.mock.calls[0]?.[1]).toBe('novel-a')
  })
})
