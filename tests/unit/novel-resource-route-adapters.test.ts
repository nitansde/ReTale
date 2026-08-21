import { beforeEach, describe, expect, it, vi } from 'vitest'

const legacyRoutes = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('@/app/api/workspace/route', () => ({
  GET: legacyRoutes.get,
  POST: legacyRoutes.post,
  PATCH: legacyRoutes.patch,
  DELETE: legacyRoutes.delete,
}))

import { GET as getNovels } from '@/app/api/novels/route'
import {
  DELETE as deleteNovel,
  GET as getNovel,
  POST as saveNovel,
} from '@/app/api/novels/[novelId]/route'
import { PATCH as patchChapter } from '@/app/api/chapters/[chapterId]/route'

describe('novel resource route adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exposes a novel collection without the legacy server-side active selection', async () => {
    legacyRoutes.get.mockResolvedValue(Response.json({
      ok: true,
      activeNovelId: 'novel-a',
      novels: [{ id: 'novel-a' }],
    }, { headers: { 'Cache-Control': 'no-store' } }))

    const response = await getNovels(new Request('http://localhost/api/novels'))

    expect(new URL(String(legacyRoutes.get.mock.calls[0]?.[0].url)).searchParams.get('librarySummary')).toBe('1')
    await expect(response.json()).resolves.toEqual({ ok: true, novels: [{ id: 'novel-a' }] })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('loads a novel resource without legacy workspace session or volume fields', async () => {
    legacyRoutes.get.mockResolvedValue(Response.json({
      currentNovelId: 'server-selection',
      currentChapterId: 'server-chapter',
      currentTab: 'outline',
      helperTab: 'stats',
      focusMode: true,
      selectionText: 'server selection',
      selectedParagraphIndex: 4,
      aiSettings: { provider: 'legacy' },
      localVolumes: [{ id: 'legacy-volume' }],
      expandedVolumeIds: ['legacy-volume'],
      localNovels: [{ id: 'novel-a' }],
      localChapters: [],
      workspaceRevision: 3,
      revisionNovelId: 'novel-a',
    }))

    const response = await getNovel(
      new Request('http://localhost/api/novels/novel-a'),
      { params: Promise.resolve({ novelId: 'novel-a' }) },
    )
    const delegatedUrl = new URL(String(legacyRoutes.get.mock.calls[0]?.[0].url))
    expect(delegatedUrl.pathname).toBe('/api/workspace')
    expect(delegatedUrl.searchParams.get('novelId')).toBe('novel-a')
    await expect(response.json()).resolves.toEqual({
      localNovels: [{ id: 'novel-a' }],
      localChapters: [],
      workspaceRevision: 3,
      revisionNovelId: 'novel-a',
    })
  })

  it('deduplicates identical original chapter content on the wire', async () => {
    legacyRoutes.get.mockResolvedValue(Response.json({
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
    legacyRoutes.post.mockImplementation(async (request: Request) => Response.json({
      novelId: request.headers.get('X-Retale-Resource-Novel-Id'),
    }))
    legacyRoutes.patch.mockImplementation(async (request: Request) => Response.json({
      chapterId: request.headers.get('X-Retale-Resource-Chapter-Id'),
    }))
    legacyRoutes.delete.mockResolvedValue(Response.json({
      ok: true,
      deletedNovelId: 'novel-a',
      activeNovelId: 'novel-b',
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
    const delegatedDelete = new URL(String(legacyRoutes.delete.mock.calls[0]?.[0].url))
    expect(delegatedDelete.pathname).toBe('/api/workspace')
    expect(delegatedDelete.searchParams.get('novelId')).toBe('novel-a')
    expect(delegatedDelete.searchParams.get('nextNovelId')).toBe('novel-b')
    expect(legacyRoutes.delete.mock.calls[0]?.[0].headers.get('X-Retale-Resource-Delete')).toBe('1')
  })
})
