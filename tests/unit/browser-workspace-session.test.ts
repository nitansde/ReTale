// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_SESSION_STORAGE_KEY,
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
    patchCapability: 'unknown',
    workspaceSaveConflict: null,
    workspaceSaveFeedback: null,
    isHydrated: false,
    isSaving: false,
    backendLoaded: false,
    backendLoadError: '',
  })
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
    })).toBe(true)

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/novels/novel-b') {
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
})
