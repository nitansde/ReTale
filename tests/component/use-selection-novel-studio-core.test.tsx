// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveSelectedKnowledgeProjectionChapterOrder,
  useSelectionNovelStudioCore,
} from '@/components/workspace/use-selection-novel-studio-core'
import type { StoryTimelineResponse } from '@/lib/story-branch-types'
import type { Chapter } from '@/lib/types'

const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}))

vi.mock('@tiptap/react', () => ({
  useEditor: () => null,
}))

vi.mock('@tiptap/starter-kit', () => ({
  default: {},
}))

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    locale: 'en',
    t: (key: string) => key,
  }),
}))

function buildChapter(overrides: Partial<Chapter>): Chapter {
  return {
    id: 'chapter-1',
    novelId: 'novel-1',
    volumeId: 'volume-1',
    title: 'Chapter 1',
    order: 1,
    content: '<p>Alpha</p>',
    status: 'draft',
    wordCount: 100,
    updatedAt: '2026-06-10',
    ...overrides,
  }
}

function buildStoryTimeline(): StoryTimelineResponse {
  return {
    novelId: 'novel-1',
    branchId: 'novel-1:main',
    chapters: [
      { type: 'chapter', chapterId: 'chapter-1', chapterNo: 1, title: 'Chapter 1', wordCount: 100 },
      { type: 'chapter', chapterId: 'chapter-2', chapterNo: 2, title: 'Chapter 2', wordCount: 120 },
    ],
    branchNodes: [
      {
        type: 'branch_node',
        id: 'continue-node-2',
        nodeType: 'continue_block',
        readableLabel: 'CONT-01',
        readableLineageLabel: 'RE-01, CONT-01',
        anchorChapterNo: 99,
        parentNodeId: 'rewrite-node-1',
        title: 'Continue block',
        subtitle: 'Continue from chapter 2',
        laneIndex: 1,
        colorToken: 'fuchsia',
        sourceChapterNo: 2,
        targetChapterNo: null,
        continueBlockId: 'continue-block-2',
        whatIfSessionId: null,
        futureJumpRunId: null,
        status: 'active',
      },
      {
        type: 'branch_node',
        id: 'roleplay-node-1',
        nodeType: 'roleplay_session',
        readableLabel: 'RP-01',
        readableLineageLabel: 'RP-01',
        anchorChapterNo: 3,
        parentNodeId: null,
        title: 'Roleplay session',
        subtitle: 'Fallback to anchor chapter',
        laneIndex: 0,
        colorToken: 'emerald',
        sourceChapterNo: null,
        targetChapterNo: null,
        continueBlockId: null,
        whatIfSessionId: null,
        futureJumpRunId: null,
        roleplaySessionId: 'roleplay-session-1',
        status: 'active',
      },
    ],
    edges: [],
  }
}

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  })
}

type CoreParams = Parameters<typeof useSelectionNovelStudioCore>[0]

type Deferred = {
  promise: Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

function createDeferred(): Deferred {
  let resolvePromise: Deferred['resolve'] = () => undefined
  let rejectPromise: Deferred['reject'] = () => undefined
  const promise = new Promise<unknown>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

function buildCoreParams(overrides: Partial<CoreParams> = {}): CoreParams {
  return {
    loadFromBackend: vi.fn().mockResolvedValue(undefined),
    saveToBackend: vi.fn().mockResolvedValue(undefined),
    backendLoaded: true,
    currentNovelId: '',
    localNovels: [],
    localVolumes: [],
    localChapters: [buildChapter({})],
    currentChapterId: 'chapter-1',
    setCurrentChapterId: vi.fn(),
    updateChapterContent: vi.fn(),
    aiSettings: undefined,
    setAISettings: vi.fn(),
    refreshKnowledgeProjection: vi.fn().mockResolvedValue(undefined),
    clearPresetCompatSessionStateForSelection: vi.fn(),
    resetPresetCompatSessionStateForSelection: vi.fn(),
    presetCompatSessionState: {},
    localCharacters: [],
    localWorldEntries: [],
    localTimelineEvents: [],
    localOutlines: [],
    autosaveSignature: 'sig-0',
    ...overrides,
  }
}

function renderAutosaveHook(saveToBackend: CoreParams['saveToBackend']) {
  const baseParams = buildCoreParams({ saveToBackend })
  return renderHook(
    ({ signature }) => useSelectionNovelStudioCore({ ...baseParams, autosaveSignature: signature }),
    { initialProps: { signature: 'sig-0' } },
  )
}

async function advanceTimers(milliseconds: number) {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds)
    await Promise.resolve()
  })
}

async function resolveDeferred(deferred: Deferred) {
  await act(async () => {
    deferred.resolve(undefined)
    await deferred.promise
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function rejectDeferred(deferred: Deferred) {
  await act(async () => {
    deferred.reject(new Error('save failed'))
    await deferred.promise.catch(() => undefined)
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useSelectionNovelStudioCore autosave drain', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps draining edits made during every in-flight save', async () => {
    const pendingSaves: Deferred[] = []
    const saveToBackend = vi.fn(() => {
      const deferred = createDeferred()
      pendingSaves.push(deferred)
      return deferred.promise
    })
    const { rerender } = renderAutosaveHook(saveToBackend)

    rerender({ signature: 'sig-1' })
    await advanceTimers(1200)
    expect(saveToBackend).toHaveBeenCalledTimes(1)

    rerender({ signature: 'sig-2' })
    await resolveDeferred(pendingSaves[0])
    await advanceTimers(400)
    expect(saveToBackend).toHaveBeenCalledTimes(2)

    rerender({ signature: 'sig-3' })
    await resolveDeferred(pendingSaves[1])
    await advanceTimers(400)
    expect(saveToBackend).toHaveBeenCalledTimes(3)

    await resolveDeferred(pendingSaves[2])
    await advanceTimers(1000)
    expect(saveToBackend).toHaveBeenCalledTimes(3)
  })

  it('coalesces intermediate signatures while keeping saves single-flight', async () => {
    const pendingSaves: Deferred[] = []
    let activeSaves = 0
    let maximumActiveSaves = 0
    const saveToBackend = vi.fn(() => {
      const deferred = createDeferred()
      pendingSaves.push(deferred)
      activeSaves += 1
      maximumActiveSaves = Math.max(maximumActiveSaves, activeSaves)
      return deferred.promise.finally(() => {
        activeSaves -= 1
      })
    })
    const { rerender } = renderAutosaveHook(saveToBackend)

    rerender({ signature: 'sig-1' })
    await advanceTimers(1200)
    rerender({ signature: 'sig-2' })
    rerender({ signature: 'sig-3' })
    await advanceTimers(1200)

    expect(saveToBackend).toHaveBeenCalledTimes(1)
    expect(maximumActiveSaves).toBe(1)

    await resolveDeferred(pendingSaves[0])
    await advanceTimers(399)
    expect(saveToBackend).toHaveBeenCalledTimes(1)
    await advanceTimers(1)
    expect(saveToBackend).toHaveBeenCalledTimes(2)
    expect(maximumActiveSaves).toBe(1)

    await resolveDeferred(pendingSaves[1])
    await advanceTimers(1000)
    expect(saveToBackend).toHaveBeenCalledTimes(2)
  })

  it('does not retry an unchanged failed target and saves a later edit', async () => {
    const pendingSaves: Deferred[] = []
    const saveToBackend = vi.fn(() => {
      const deferred = createDeferred()
      pendingSaves.push(deferred)
      return deferred.promise
    })
    const { rerender } = renderAutosaveHook(saveToBackend)

    rerender({ signature: 'sig-1' })
    await advanceTimers(1200)
    await rejectDeferred(pendingSaves[0])
    await advanceTimers(10_000)
    expect(saveToBackend).toHaveBeenCalledTimes(1)

    rerender({ signature: 'sig-2' })
    await advanceTimers(1200)
    expect(saveToBackend).toHaveBeenCalledTimes(2)

    await resolveDeferred(pendingSaves[1])
    await advanceTimers(1000)
    expect(saveToBackend).toHaveBeenCalledTimes(2)
  })

  it('saves a failed signature again after changing away and returning', async () => {
    const pendingSaves: Deferred[] = []
    const saveToBackend = vi.fn(() => {
      const deferred = createDeferred()
      pendingSaves.push(deferred)
      return deferred.promise
    })
    const { rerender } = renderAutosaveHook(saveToBackend)

    rerender({ signature: 'sig-1' })
    await advanceTimers(1200)
    await rejectDeferred(pendingSaves[0])

    rerender({ signature: 'sig-2' })
    await advanceTimers(1200)
    expect(saveToBackend).toHaveBeenCalledTimes(2)
    await resolveDeferred(pendingSaves[1])

    rerender({ signature: 'sig-1' })
    await advanceTimers(1200)
    expect(saveToBackend).toHaveBeenCalledTimes(3)
    await resolveDeferred(pendingSaves[2])
  })

  it('does not schedule a drain after unmounting during a save', async () => {
    const pendingSave = createDeferred()
    const saveToBackend = vi.fn(() => pendingSave.promise)
    const { rerender, unmount } = renderAutosaveHook(saveToBackend)

    rerender({ signature: 'sig-1' })
    await advanceTimers(1200)
    rerender({ signature: 'sig-2' })
    unmount()

    await resolveDeferred(pendingSave)
    await advanceTimers(10_000)
    expect(saveToBackend).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('useSelectionNovelStudioCore knowledge projection selection', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('resolves the selected chapter order from chapter, source chapter, and anchor fallback', () => {
    const localChapters = [
      buildChapter({ id: 'chapter-1', order: 1 }),
      buildChapter({ id: 'chapter-2', order: 2 }),
    ]
    const timelineNodeById = new Map(buildStoryTimeline().branchNodes.map((node) => [node.id, node] as const))

    expect(resolveSelectedKnowledgeProjectionChapterOrder({
      currentChapterId: 'chapter-1',
      localChapters,
      workspaceSelection: { kind: 'chapter', chapterId: 'chapter-2', chapterNo: 2 },
      timelineNodeById,
    })).toBe(2)

    expect(resolveSelectedKnowledgeProjectionChapterOrder({
      currentChapterId: 'chapter-1',
      localChapters,
      workspaceSelection: {
        kind: 'continue_block',
        nodeId: 'continue-node-2',
        continueBlockId: 'continue-block-2',
        anchorChapterNo: 99,
      },
      timelineNodeById,
    })).toBe(2)

    expect(resolveSelectedKnowledgeProjectionChapterOrder({
      currentChapterId: 'chapter-1',
      localChapters,
      workspaceSelection: {
        kind: 'roleplay_session',
        nodeId: 'roleplay-node-1',
        roleplaySessionId: 'roleplay-session-1',
        anchorChapterNo: 3,
      },
      timelineNodeById,
    })).toBe(3)
  })

  it('refreshes knowledge projection with a selected non-chapter block source chapter immediately after direct selection', async () => {
    const storyTimeline = buildStoryTimeline()
    const refreshKnowledgeProjection = vi.fn<(novelId: string, asOfChapter?: number) => Promise<unknown>>().mockResolvedValue(undefined)
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/story-timeline?')) {
        return new Response(JSON.stringify(storyTimeline), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.startsWith('/api/knowledge-view?')) {
        return new Response(JSON.stringify({ ok: true, knowledgeRebuildStatus: null, hanlpCacheSnapshot: null, knowledgeStatusOverview: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const localChapters = [
      buildChapter({ id: 'chapter-1', order: 1, title: 'Chapter 1' }),
      buildChapter({ id: 'chapter-2', order: 2, title: 'Chapter 2' }),
    ]

    const { result } = renderHook(() => useSelectionNovelStudioCore({
      loadFromBackend: vi.fn().mockResolvedValue(undefined),
      saveToBackend: vi.fn().mockResolvedValue(undefined),
      backendLoaded: true,
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
      localVolumes: [],
      localChapters,
      currentChapterId: 'chapter-1',
      setCurrentChapterId: vi.fn(),
      updateChapterContent: vi.fn(),
      aiSettings: undefined,
      setAISettings: vi.fn(),
      refreshKnowledgeProjection,
      clearPresetCompatSessionStateForSelection: vi.fn(),
      resetPresetCompatSessionStateForSelection: vi.fn(),
      presetCompatSessionState: {},
      localCharacters: [],
      localWorldEntries: [],
      localTimelineEvents: [],
      localOutlines: [],
      autosaveSignature: 'sig-1',
    }))

    await waitFor(() => {
      expect(result.current.timelineNodeById.get('continue-node-2')).toBeDefined()
    })

    await flushEffects()

    expect(refreshKnowledgeProjection).toHaveBeenCalledWith('novel-1', 1)

    act(() => {
      result.current.handleTimelineSelection({
        kind: 'continue_block',
        nodeId: 'continue-node-2',
        continueBlockId: 'continue-block-2',
        anchorChapterNo: 99,
      })
    })

    await flushEffects()

    await waitFor(() => {
      expect(refreshKnowledgeProjection).toHaveBeenLastCalledWith('novel-1', 2)
    })
  })
})
