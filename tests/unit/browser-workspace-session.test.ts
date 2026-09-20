// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_SESSION_STORAGE_KEY,
  readBrowserWorkspaceSession,
  writeBrowserWorkspaceSession,
} from '@/lib/browser-preferences'
import { resetClientRequestBrokerForTests } from '@/lib/client-request-broker'
import type { PersistedNovelState } from '@/lib/types'
import { createEmptyWorkspaceState } from '@/lib/workspace-state'
import { useNovelStore } from '@/store/novel-store'

function createWorkspace(): PersistedNovelState {
  return {
    ...createEmptyWorkspaceState(),
    currentNovelId: 'novel-a',
    currentChapterId: 'chapter-a-1',
    localNovels: [
      { id: 'novel-a', title: 'Novel A', summary: '', tags: [] },
      { id: 'novel-b', title: 'Novel B', summary: '', tags: [] },
    ],
    localChapters: [
      { id: 'chapter-a-1', novelId: 'novel-a', title: 'A1', order: 1, content: '<p>A1</p>', status: 'draft', wordCount: 1, updatedAt: 'now' },
      { id: 'chapter-a-2', novelId: 'novel-a', title: 'A2', order: 2, content: '<p>A2</p>', status: 'draft', wordCount: 1, updatedAt: 'now' },
      { id: 'chapter-b-1', novelId: 'novel-b', title: 'B1', order: 1, content: '<p>B1</p>', status: 'draft', wordCount: 1, updatedAt: 'now' },
      { id: 'chapter-b-2', novelId: 'novel-b', title: 'B2', order: 2, content: '<p>B2</p>', status: 'draft', wordCount: 1, updatedAt: 'now' },
    ],
  }
}

function resetStore() {
  useNovelStore.getState().restorePersistedState(createEmptyWorkspaceState())
  useNovelStore.setState({
    persistRevision: 0,
    workspaceRevision: null,
    revisionNovelId: '',
    lastAcknowledgedPersistedWorkspace: null,
    workspaceSaveConflict: null,
    workspaceSaveFeedback: null,
    isHydrated: false,
    isSaving: false,
    backendLoaded: false,
    backendLoadError: '',
    librarySummaries: [],
    librarySummariesLoaded: false,
    librarySummariesError: '',
  })
}

function mockLibraryAndNovelResources() {
  const workspace = createWorkspace()
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/novels') {
      return new Response(JSON.stringify({ ok: true, novels: workspace.localNovels.map((novel) => ({
        ...novel, updatedAt: 'now', wordCount: 2, chapterCount: 2, firstChapterId: `chapter-${novel.id.slice(-1)}-1`,
      })) }), { status: 200 })
    }
    const novel = workspace.localNovels.find((item) => url.pathname === `/api/novels/${item.id}`)
    if (novel) {
      return new Response(JSON.stringify({
        ...createEmptyWorkspaceState(),
        localNovels: [novel],
        localChapters: workspace.localChapters.filter((chapter) => chapter.novelId === novel.id),
        workspaceRevision: 7, revisionNovelId: novel.id,
      }), { status: 200 })
    }
    if (url.pathname === '/api/settings/ai') return new Response(JSON.stringify({}), { status: 200 })
    throw new Error(`Unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('browser workspace session', () => {
  beforeEach(() => {
    resetClientRequestBrokerForTests()
    resetStore()
    window.localStorage.clear()
  })

  afterEach(() => {
    resetClientRequestBrokerForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    resetStore()
    window.localStorage.clear()
  })

  it('remembers the last chapter independently for each novel without dirtying persisted content', () => {
    useNovelStore.getState().restorePersistedState(createWorkspace())
    useNovelStore.setState({ persistRevision: 0 })

    useNovelStore.getState().setCurrentChapterId('chapter-a-2')
    useNovelStore.getState().setCurrentNovelId('novel-b')
    useNovelStore.getState().setCurrentChapterId('chapter-b-2')
    useNovelStore.getState().setCurrentNovelId('novel-a')

    expect(useNovelStore.getState()).toMatchObject({
      currentNovelId: 'novel-a',
      currentChapterId: 'chapter-a-2',
      persistRevision: 0,
    })

    useNovelStore.getState().setCurrentNovelId('novel-b')
    expect(useNovelStore.getState()).toMatchObject({
      currentNovelId: 'novel-b',
      currentChapterId: 'chapter-b-2',
      persistRevision: 0,
    })
    expect(JSON.parse(window.localStorage.getItem(WORKSPACE_SESSION_STORAGE_KEY) ?? '{}')).toMatchObject({
      currentChapterIds: {
        'novel-a': 'chapter-a-2',
        'novel-b': 'chapter-b-2',
      },
    })
  })

  it('uses the browser session instead of stale server-side workspace selection during hydration', async () => {
    const serverWorkspace = createWorkspace()
    expect(writeBrowserWorkspaceSession({
      currentNovelId: 'novel-b',
      currentChapterIds: { 'novel-b': 'chapter-b-2' },
      currentTab: 'rewrite',
      helperTab: 'stats',
      focusMode: true,
      presetCompatSessionStates: {},
    })).toBe(true)

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (new URL(url, 'http://localhost').pathname === '/api/novels/novel-b') {
        return new Response(JSON.stringify({
          ...serverWorkspace,
          workspaceRevision: 7,
          revisionNovelId: 'novel-b',
        }), { status: 200 })
      }
      if (url === '/api/settings/ai') return new Response(JSON.stringify({}), { status: 200 })
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await useNovelStore.getState().loadFromBackend()

    expect(useNovelStore.getState()).toMatchObject({
      currentNovelId: 'novel-b',
      currentChapterId: 'chapter-b-2',
      currentTab: 'rewrite',
      helperTab: 'stats',
      focusMode: true,
      persistRevision: 0,
    })
  })

  it('preserves saved chapters and preferences while a fresh homepage only loads the library', async () => {
    mockLibraryAndNovelResources()
    writeBrowserWorkspaceSession({
      currentNovelId: 'novel-a',
      currentChapterIds: { 'novel-a': 'chapter-a-2', 'novel-b': 'chapter-b-2' },
      currentTab: 'rewrite', helperTab: 'stats', focusMode: true,
      presetCompatSessionStates: { 'novel-a': {
        'chapter:chapter-a-2::rewrite': { surfaceId: 'rewrite', phase: 'continue', resetPending: false },
      } },
    })
    const session = readBrowserWorkspaceSession()

    await useNovelStore.getState().loadLibrarySummaries()
    expect(useNovelStore.getState().localChapters).toEqual([])
    expect(readBrowserWorkspaceSession()).toEqual(session)
    await useNovelStore.getState().loadFromBackend('novel-a')
    expect(useNovelStore.getState()).toMatchObject({ currentChapterId: 'chapter-a-2', currentTab: 'rewrite', persistRevision: 0 })
  })

  it('remembers unloaded novels when loading one novel at a time', async () => {
    const fetch = mockLibraryAndNovelResources()
    await useNovelStore.getState().loadFromBackend('novel-a')
    useNovelStore.getState().setCurrentChapterId('chapter-a-2')
    await useNovelStore.getState().loadFromBackend('novel-b')
    useNovelStore.getState().setCurrentChapterId('chapter-b-2')
    await useNovelStore.getState().loadFromBackend('novel-a')
    expect(useNovelStore.getState()).toMatchObject({ currentChapterId: 'chapter-a-2', persistRevision: 0 })
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/novel-a?view=workspace&chapterId=chapter-a-2'), expect.anything())
    await useNovelStore.getState().loadFromBackend('novel-b')
    expect(useNovelStore.getState().currentChapterId).toBe('chapter-b-2')
    expect(readBrowserWorkspaceSession().currentChapterIds).toEqual({ 'novel-a': 'chapter-a-2', 'novel-b': 'chapter-b-2' })
  })

  it('does not associate an old chapter or preset state with a novel that has not loaded', async () => {
    mockLibraryAndNovelResources()
    await useNovelStore.getState().loadFromBackend('novel-a')
    useNovelStore.getState().setCurrentChapterId('chapter-a-2')
    const session = readBrowserWorkspaceSession()
    writeBrowserWorkspaceSession({ ...session, currentChapterIds: { ...session.currentChapterIds, 'novel-b': 'chapter-b-2' } })

    useNovelStore.setState({ currentNovelId: 'novel-b' })
    expect(readBrowserWorkspaceSession().currentChapterIds['novel-b']).toBe('chapter-b-2')
    expect(readBrowserWorkspaceSession().presetCompatSessionStates['novel-b']).toBeUndefined()
  })

  it('falls back from a deleted bookmark and honors an explicit chapter when opening', async () => {
    mockLibraryAndNovelResources()
    writeBrowserWorkspaceSession({
      currentNovelId: 'novel-a', currentChapterIds: { 'novel-a': 'chapter-deleted' },
      currentTab: 'editor', helperTab: 'ai', focusMode: false, presetCompatSessionStates: {},
    })
    await useNovelStore.getState().loadFromBackend('novel-a')
    expect(useNovelStore.getState().currentChapterId).toBe('chapter-a-1')
    expect(readBrowserWorkspaceSession().currentChapterIds['novel-a']).toBe('chapter-a-1')
    useNovelStore.getState().setCurrentChapterId('chapter-a-2')
    await useNovelStore.getState().loadFromBackend('novel-a', 'chapter-a-1')
    expect(useNovelStore.getState().currentChapterId).toBe('chapter-a-1')
  })

  it('preserves bookmarks through an optimistic deletion rollback and only clears the deleted novel', async () => {
    mockLibraryAndNovelResources()
    await useNovelStore.getState().loadFromBackend('novel-b')
    useNovelStore.getState().setCurrentChapterId('chapter-b-2')
    await useNovelStore.getState().loadFromBackend('novel-a')
    useNovelStore.getState().setCurrentChapterId('chapter-a-2')

    const transaction = useNovelStore.getState().beginNovelDeletion('novel-a')
    expect(transaction).not.toBeNull()
    expect(readBrowserWorkspaceSession().currentChapterIds).toEqual({ 'novel-a': 'chapter-a-2', 'novel-b': 'chapter-b-2' })
    useNovelStore.getState().rollbackNovelDeletion(transaction!)
    expect(useNovelStore.getState().currentChapterId).toBe('chapter-a-2')

    useNovelStore.getState().deleteNovel('novel-a')
    expect(readBrowserWorkspaceSession().currentChapterIds).toEqual({ 'novel-b': 'chapter-b-2' })
    expect(readBrowserWorkspaceSession().presetCompatSessionStates['novel-a']).toBeUndefined()
  })

  it('rejects a chapter belonging to another novel when writing its bookmark', () => {
    useNovelStore.getState().restorePersistedState(createWorkspace())
    useNovelStore.getState().setCurrentChapterId('chapter-a-2')
    useNovelStore.getState().setCurrentChapterId('chapter-b-1')
    expect(readBrowserWorkspaceSession().currentChapterIds['novel-a']).toBe('chapter-a-2')
  })

  it('keeps preset compatibility session metadata in the browser per novel', async () => {
    const serverWorkspace = createWorkspace()
    const browserPresetState = {
      'chapter:chapter-a-2::rewrite': {
        surfaceId: 'rewrite' as const,
        phase: 'continue' as const,
        resetPending: false,
      },
    }
    expect(writeBrowserWorkspaceSession({
      currentNovelId: 'novel-a',
      currentChapterIds: { 'novel-a': 'chapter-a-2' },
      currentTab: 'editor',
      helperTab: 'ai',
      focusMode: false,
      presetCompatSessionStates: { 'novel-a': browserPresetState },
    })).toBe(true)

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (new URL(url, 'http://localhost').pathname === '/api/novels/novel-a') {
        return new Response(JSON.stringify({
          ...serverWorkspace,
          presetCompatSessionState: {
            'chapter:chapter-a-1::rewrite': {
              surfaceId: 'rewrite',
              phase: 'new_chat',
              resetPending: true,
            },
          },
          workspaceRevision: 7,
          revisionNovelId: 'novel-a',
        }), { status: 200 })
      }
      if (url === '/api/settings/ai') return new Response(JSON.stringify({}), { status: 200 })
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await useNovelStore.getState().loadFromBackend('novel-a')
    expect(useNovelStore.getState().presetCompatSessionState).toEqual(browserPresetState)

    useNovelStore.getState().resetPresetCompatSessionStateForSelection(
      { kind: 'chapter', chapterId: 'chapter-a-2' },
      ['rewrite'],
    )

    expect(useNovelStore.getState().persistRevision).toBe(0)
    expect(JSON.parse(window.localStorage.getItem(WORKSPACE_SESSION_STORAGE_KEY) ?? '{}'))
      .toMatchObject({
        presetCompatSessionStates: {
          'novel-a': {
            'chapter:chapter-a-2::rewrite': {
              surfaceId: 'rewrite',
              phase: 'new_chat',
              resetPending: true,
            },
          },
        },
      })
  })
})
