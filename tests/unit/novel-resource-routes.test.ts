import { beforeEach, describe, expect, it, vi } from 'vitest'

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
