// @vitest-environment jsdom

import { useLayoutEffect, useState } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mergeKnowledgeStatusOverview,
  resolveReferenceResourcesVisible,
  resolveSelectedKnowledgeProjectionChapterOrder,
  useSelectionNovelStudioCore,
} from '@/components/workspace/use-selection-novel-studio-core'
import type { KnowledgeRebuildStatus, KnowledgeStatusOverview, RecoverableRewriteJob } from '@/components/workspace/selection-novel-studio-helpers'
import type { StoryTimelineResponse } from '@/lib/story-branch-types'
import type { Chapter } from '@/lib/types'
import { readChapterDraft, writeChapterDraft } from '@/lib/chapter-draft-cache'
import type { KnowledgeProjectionResult, WorkspaceSaveFeedback } from '@/store/novel-store-types'
import { buildTenThousandCharacterEditBurst } from '@/tests/helpers/autosave-performance-fixtures'

const pushMock = vi.fn()
type MockTipTapEditor = {
  getHTML: () => string
  getText: () => string
  setEditable: (editable: boolean, emitUpdate: boolean) => void
  commands: { setContent: (content: string, options: { emitUpdate: false }) => void }
  view: { dom: HTMLDivElement }
}

type MockTipTapOptions = {
  onUpdate?: (event: { editor: MockTipTapEditor }) => void
  onBlur?: () => void
}

const tiptapMock = vi.hoisted(() => ({
  editor: null as MockTipTapEditor | null,
  options: null as MockTipTapOptions | null,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}))

vi.mock('@tiptap/react', () => ({
  useEditor: (options: NonNullable<typeof tiptapMock.options>) => {
    tiptapMock.options = options
    return tiptapMock.editor
  },
}))

vi.mock('@tiptap/starter-kit', () => ({
  default: {},
}))

vi.mock('@/lib/i18n/provider', () => {
  const translate = (key: string) => key

  return {
    useI18n: () => ({
      locale: 'en',
      t: translate,
    }),
  }
})

function buildChapter(overrides: Partial<Chapter>): Chapter {
  return {
    id: 'chapter-1',
    novelId: 'novel-1',
    title: 'Chapter 1',
    order: 1,
    content: '<p>Alpha</p>',
    status: 'draft',
    wordCount: 100,
    updatedAt: '2026-06-10',
    ...overrides,
  }
}

function buildKnowledgeRebuildStatus(status: 'running' | 'paused'): KnowledgeRebuildStatus {
  return {
    jobId: 'knowledge-job-1',
    novelId: 'novel-1',
    jobType: 'extract_chapter_knowledge',
    status,
    progress: 0.5,
    currentStep: 'extract',
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:01.000Z',
    etaMinutes: 1,
    steps: [],
  }
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function buildKnowledgeStatusOverview(overrides: Partial<KnowledgeStatusOverview> = {}): KnowledgeStatusOverview {
  return {
    knowledgeGraph: { status: 'full', coveredChapterCount: 64, totalChapterCount: 64, validThroughChapterNo: 64 },
    extractionCache: { status: 'full', coveredChapterCount: 64, totalChapterCount: 64, validThroughChapterNo: 64 },
    embeddingCache: {
      status: 'full',
      coveredChapterCount: 64,
      totalChapterCount: 64,
      validThroughChapterNo: 64,
      provider: 'ollama',
      model: 'qwen3-embedding:4b',
    },
    retrievalIndex: { status: 'full', indexedScopeCount: 64, task: null },
    ...overrides,
  }
}

function buildKnowledgeProjectionResult(overrides: Partial<KnowledgeProjectionResult> = {}): KnowledgeProjectionResult {
  return {
    localOutlines: [],
    localCharacters: [],
    localCharacterRelations: [],
    localWorldEntries: [],
    localTimelineEvents: [],
    knowledgeRebuildStatus: null,
    hanlpCacheSnapshot: null,
    knowledgeStatusOverview: null,
    jobOutcome: null,
    actionError: null,
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

function buildFailedRecoverableRewriteJob(errorMessage: string): RecoverableRewriteJob {
  return {
    jobId: 'rewrite-job-failed',
    status: 'failed',
    progress: 0.5,
    currentStep: null,
    errorMessage,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:01.000Z',
    panel: {
      novelId: 'novel-1',
      branchId: 'novel-1:main',
      chapterId: 'chapter-1',
      selectedText: 'Selected text',
      sourceText: 'Source text',
      sourceTextOverride: null,
      userInstruction: 'Rewrite',
      rewriteLaunchSource: 'chapter',
      branchContextNodeId: null,
      branchContextInclusion: null,
      continueBlockId: null,
      createdAt: '2026-07-27T00:00:00.000Z',
    },
    result: null,
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
    isNovelDeletionPending: false,
    backendLoaded: true,
    currentNovelId: '',
    localNovels: [],
    localChapters: [buildChapter({})],
    currentChapterId: 'chapter-1',
    setCurrentChapterId: vi.fn(),
    updateChapterContent: vi.fn(),
    aiSettings: undefined,
    setAISettings: vi.fn(),
    refreshKnowledgeProjection: vi.fn().mockResolvedValue(buildKnowledgeProjectionResult()),
    clearPresetCompatSessionStateForSelection: vi.fn(),
    resetPresetCompatSessionStateForSelection: vi.fn(),
    presetCompatSessionState: {},
    localCharacters: [],
    localWorldEntries: [],
    localTimelineEvents: [],
    localOutlines: [],
    autosaveTarget: 'sig-0',
    workspaceSaveFeedback: null,
    ...overrides,
  }
}

function renderAutosaveHook(saveToBackend: CoreParams['saveToBackend']) {
  const baseParams = buildCoreParams({ saveToBackend })
  type AutosaveProps = { revision: number; novelId?: string; deletionPending?: boolean }
  return renderHook(
    ({ revision, novelId = 'novel-1', deletionPending = false }: AutosaveProps) => useSelectionNovelStudioCore({
      ...baseParams,
      currentNovelId: novelId,
      autosaveTarget: `${novelId}\u0000${revision}`,
      isNovelDeletionPending: deletionPending,
    }),
    { initialProps: { revision: 0 } as AutosaveProps },
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

beforeEach(() => {
  window.localStorage.clear()
})

describe('useSelectionNovelStudioCore selection events', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/workspace')
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => jsonResponse(
      String(input).startsWith('/api/story-timeline?') ? buildStoryTimeline() : { ok: true },
    )))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function selectionFixture() {
    const root = document.createElement('div')
    root.textContent = 'Selected chapter text'
    const selection = {
      rangeCount: 1,
      toString: () => root.textContent,
      getRangeAt: () => ({
        commonAncestorContainer: root.firstChild,
        getBoundingClientRect: () => ({ top: 1, left: 1, width: 20 }),
      }),
    } as unknown as Selection
    const readSelection = vi.spyOn(window, 'getSelection').mockReturnValue(selection)
    const params = buildCoreParams({ currentNovelId: 'novel-1' })
    return { root, readSelection, params }
  }

  it('settles when toolbar layout emits scroll events, including at the viewport edge', async () => {
    const { root, params } = selectionFixture()
    let emitLayoutScroll = false
    let commits = 0
    const { result, unmount } = renderHook(() => {
      const core = useSelectionNovelStudioCore(params)
      useLayoutEffect(() => {
        // Model scroll events emitted while the browser restores focus/layout.
        // Bound the old feedback loop so its failure is an assertion, not a crash.
        if (emitLayoutScroll && ++commits < 20) window.dispatchEvent(new Event('scroll'))
      })
      return core
    })
    await advanceTimers(100)
    result.current.editorRef.current = root
    result.current.toolbarRef.current = document.createElement('div')
    emitLayoutScroll = true
    act(() => document.dispatchEvent(new Event('selectionchange')))
    for (let frame = 0; frame < 5; frame++) await advanceTimers(20)

    expect(result.current.selectionText).toBe('Selected chapter text')
    expect(commits).toBeLessThan(5)
    const position = result.current.toolbarPos
    act(() => {
      for (let event = 0; event < 50; event++) {
        window.dispatchEvent(new Event('scroll'))
        window.dispatchEvent(new Event('resize'))
        document.dispatchEvent(new Event('selectionchange'))
      }
    })
    await advanceTimers(100)
    expect(result.current.toolbarPos).toBe(position)
    unmount()
  })

  it('cancels pending chapter selection work and ignores RP input and scroll events', async () => {
    const { root, readSelection, params } = selectionFixture()
    const { result, unmount } = renderHook(() => useSelectionNovelStudioCore(params))
    await advanceTimers(100)
    result.current.editorRef.current = root
    act(() => document.dispatchEvent(new Event('selectionchange')))
    act(() => result.current.handleTimelineSelection({
      kind: 'roleplay_session', nodeId: 'roleplay-node-1',
      roleplaySessionId: 'roleplay-session-1', anchorChapterNo: 3,
    }))
    readSelection.mockClear()
    act(() => {
      document.dispatchEvent(new Event('selectionchange'))
      window.dispatchEvent(new Event('scroll'))
      window.dispatchEvent(new Event('resize'))
    })
    await advanceTimers(100)
    expect(readSelection).not.toHaveBeenCalled()
    expect(result.current.selectionText).toBe('')
    expect(result.current.toolbarPos).toBeNull()
    unmount()
  })
})

describe('knowledge cache overview derivations', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps fuller same-model embedding coverage while accepting exact lightweight extraction and retrieval updates', () => {
    const current = buildKnowledgeStatusOverview()
    const incoming = buildKnowledgeStatusOverview({
      extractionCache: { status: 'missing', coveredChapterCount: 0, totalChapterCount: 64, validThroughChapterNo: null },
      embeddingCache: {
        status: 'partial',
        coveredChapterCount: 12,
        totalChapterCount: 64,
        validThroughChapterNo: 12,
        provider: 'ollama',
        model: 'qwen3-embedding:4b',
      },
      retrievalIndex: { status: 'missing', indexedScopeCount: 0, task: null },
    })

    expect(mergeKnowledgeStatusOverview(current, incoming)).toEqual({
      ...incoming,
      embeddingCache: current.embeddingCache,
    })
  })

  it('does not promote exact same-generation embedding coverage from a larger lightweight estimate', () => {
    const current = buildKnowledgeStatusOverview({
      embeddingCache: {
        status: 'partial',
        coveredChapterCount: 12,
        totalChapterCount: 64,
        validThroughChapterNo: 12,
        provider: 'ollama',
        model: 'qwen3-embedding:4b',
      },
    })
    const incoming = buildKnowledgeStatusOverview()

    expect(mergeKnowledgeStatusOverview(current, incoming)?.embeddingCache).toEqual(current.embeddingCache)
  })

  it('accepts same-model embedding coverage from a new chapter-count generation', () => {
    const current = buildKnowledgeStatusOverview()
    const expanded = buildKnowledgeStatusOverview({
      embeddingCache: {
        status: 'partial',
        coveredChapterCount: 1,
        totalChapterCount: 65,
        validThroughChapterNo: 1,
        provider: 'ollama',
        model: 'qwen3-embedding:4b',
      },
    })
    const shrunk = buildKnowledgeStatusOverview({
      embeddingCache: {
        status: 'partial',
        coveredChapterCount: 1,
        totalChapterCount: 63,
        validThroughChapterNo: 1,
        provider: 'ollama',
        model: 'qwen3-embedding:4b',
      },
    })

    expect(mergeKnowledgeStatusOverview(current, expanded)?.embeddingCache).toEqual(expanded.embeddingCache)
    expect(mergeKnowledgeStatusOverview(current, shrunk)?.embeddingCache).toEqual(shrunk.embeddingCache)
  })

  it('accepts zero coverage and provider changes from lightweight embedding updates', () => {
    const current = buildKnowledgeStatusOverview()
    const missing = buildKnowledgeStatusOverview({
      embeddingCache: {
        status: 'missing',
        coveredChapterCount: 0,
        totalChapterCount: 64,
        validThroughChapterNo: null,
        provider: null,
        model: null,
      },
    })
    const changedProvider = buildKnowledgeStatusOverview({
      embeddingCache: {
        status: 'partial',
        coveredChapterCount: 3,
        totalChapterCount: 64,
        validThroughChapterNo: 3,
        provider: 'openai-compatible',
        model: 'text-embedding-3-small',
      },
    })

    expect(mergeKnowledgeStatusOverview(current, missing)?.embeddingCache).toEqual(missing.embeddingCache)
    expect(mergeKnowledgeStatusOverview(current, changedProvider)?.embeddingCache).toEqual(changedProvider.embeddingCache)
  })

  it('uses durable idle coverage without exposing an idle embedding percent or historical telemetry', () => {
    const { result, unmount } = renderHook(() => useSelectionNovelStudioCore(buildCoreParams()))

    act(() => {
      result.current.setKnowledgeStatusOverview(buildKnowledgeStatusOverview())
      result.current.setKnowledgeRebuildStatus({
        ...buildKnowledgeRebuildStatus('running'),
        status: 'completed',
        rawTextEmbeddingProgress: 1,
        rawTextEmbeddingCacheHitRate: 1,
        stageTimingsMs: { raw_text_precompute: 12_000 },
        embeddingSettingsSnapshot: { provider: 'ollama', model: 'qwen3-embedding:4b', embeddingBatchSize: 32 },
      })
    })

    expect(result.current.mainKnowledgeRebuildStatus).toBeNull()
    expect(result.current.rawTextEmbeddingActive).toBe(false)
    expect('rawTextEmbeddingPercent' in result.current).toBe(false)
    expect('knowledgeRebuildOverallPercent' in result.current).toBe(false)
    expect('retrievalTaskPercent' in result.current).toBe(false)
    expect(result.current.rawTextEmbeddingCacheHitRatePercent).toBeNull()
    expect(result.current.rawTextEmbeddingTimingLabel).toBeNull()
    expect(result.current.rawTextEmbeddingSettingsLine).toBe('Ollama · qwen3-embedding:4b')
    unmount()
  })

  it('lets active retrieval telemetry override durable embedding coverage', () => {
    const { result, unmount } = renderHook(() => useSelectionNovelStudioCore(buildCoreParams()))

    act(() => {
      result.current.setKnowledgeStatusOverview(buildKnowledgeStatusOverview())
      result.current.setKnowledgeRebuildStatus({
        ...buildKnowledgeRebuildStatus('running'),
        jobType: 'rebuild_retrieval_index',
        rawTextEmbeddingProgress: 0.35,
        rawTextEmbeddingCacheHitRate: 0.2,
        stageTimingsMs: { raw_text_precompute: 12_000 },
        embeddingSettingsSnapshot: { provider: 'ollama', model: 'qwen3-embedding:4b', embeddingBatchSize: 32 },
        steps: [{ key: 'raw-embedding', label: 'Raw embedding', status: 'running', progress: 0.35, etaMinutes: null, detail: null }],
      })
    })

    expect(result.current.rawTextEmbeddingActive).toBe(true)
    expect(result.current.rawTextEmbeddingCacheHitRatePercent).toBe(20)
    expect(result.current.rawTextEmbeddingTimingLabel).not.toBeNull()
    expect(result.current.rawTextEmbeddingSettingsLine).toBe('Ollama · qwen3-embedding:4b · batch 32')
    unmount()
  })

  it('does not expose a succeeded retrieval job as active task telemetry', () => {
    const succeededTask: KnowledgeRebuildStatus = {
      ...buildKnowledgeRebuildStatus('running'),
      jobType: 'rebuild_retrieval_index',
      status: 'succeeded',
      progress: 1,
    }
    const { result, unmount } = renderHook(() => useSelectionNovelStudioCore(buildCoreParams()))

    act(() => {
      result.current.setKnowledgeRebuildStatus(succeededTask)
      result.current.setKnowledgeStatusOverview(buildKnowledgeStatusOverview({
        retrievalIndex: { status: 'full', indexedScopeCount: 64, task: succeededTask },
      }))
    })

    expect(result.current.currentKnowledgeJobBusy).toBe(false)
    expect(result.current.rawTextEmbeddingActive).toBe(false)
    expect(result.current.retrievalTaskStatus).toBeNull()
    unmount()
  })
})

describe('useSelectionNovelStudioCore user-facing errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sanitizes raw story timeline diagnostics', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/story-timeline?')) {
        return new Response(JSON.stringify({ error: 'SENTINEL story timeline SQL path' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.startsWith('/api/knowledge-view?')) {
        return jsonResponse({ ok: true, knowledgeRebuildStatus: null, hanlpCacheSnapshot: null, knowledgeStatusOverview: null })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
    })
    const { result } = renderHook(() => useSelectionNovelStudioCore(params))

    await waitFor(() => expect(result.current.storyTimelineError).toBe('Failed to load story timeline'))
    expect(result.current.storyTimelineError).not.toContain('SENTINEL')
  })

  it('sanitizes persisted recoverable rewrite job diagnostics', () => {
    const params = buildCoreParams()
    const { result } = renderHook(() => useSelectionNovelStudioCore(params))

    act(() => {
      result.current.syncRewriteJobFromRecoverableJob(buildFailedRecoverableRewriteJob('SENTINEL persisted provider stack'))
    })

    expect(result.current.rewriteFlow.error).toBe('Rewrite failed.')
    expect(result.current.rewriteState.error).not.toContain('SENTINEL')
  })
})

describe('useSelectionNovelStudioCore autosave drain', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    pushMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each([
    { backendLoaded: false, currentNovelId: 'novel-1' },
    { backendLoaded: true, currentNovelId: '' },
  ])('does not save an unready resource target on unmount: %o', async (overrides) => {
    const saveToBackend = vi.fn().mockResolvedValue(undefined)
    const { unmount } = renderHook(() => useSelectionNovelStudioCore(buildCoreParams({
      ...overrides,
      saveToBackend,
      autosaveTarget: 'unready\u00001',
    })))

    unmount()
    await advanceTimers(10_000)
    expect(saveToBackend).not.toHaveBeenCalled()
  })

  it('keeps draining edits made during every in-flight save', async () => {
    const pendingSaves: Deferred[] = []
    const saveToBackend = vi.fn(() => {
      const deferred = createDeferred()
      pendingSaves.push(deferred)
      return deferred.promise
    })
    const { rerender } = renderAutosaveHook(saveToBackend)

    rerender({ revision: 1 })
    await advanceTimers(1200)
    expect(saveToBackend).toHaveBeenCalledTimes(1)

    rerender({ revision: 2 })
    await resolveDeferred(pendingSaves[0])
    await advanceTimers(400)
    expect(saveToBackend).toHaveBeenCalledTimes(2)

    rerender({ revision: 3 })
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

    rerender({ revision: 1 })
    await advanceTimers(1200)
    rerender({ revision: 2 })
    rerender({ revision: 3 })
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

  it('orders a 10,000-character burst before the latest in-flight edit without extra saves', async () => {
    const editBurst = buildTenThousandCharacterEditBurst()
    const pendingSaves: Deferred[] = []
    const observedContent: string[] = []
    let latestContent = ''
    const saveToBackend = vi.fn(() => {
      observedContent.push(latestContent)
      const deferred = createDeferred()
      pendingSaves.push(deferred)
      return deferred.promise
    })
    const { rerender } = renderAutosaveHook(saveToBackend)

    for (let length = 1_000; length <= editBurst.length; length += 1_000) {
      latestContent = editBurst.slice(0, length)
      rerender({ revision: length })
    }
    await advanceTimers(1200)

    expect(saveToBackend).toHaveBeenCalledTimes(1)
    expect(observedContent).toEqual([editBurst])

    latestContent = `${editBurst}!`
    rerender({ revision: 10_001 })
    await resolveDeferred(pendingSaves[0])
    await advanceTimers(399)
    expect(saveToBackend).toHaveBeenCalledTimes(1)
    await advanceTimers(1)

    expect(saveToBackend).toHaveBeenCalledTimes(2)
    expect(observedContent).toEqual([editBurst, `${editBurst}!`])
    await resolveDeferred(pendingSaves[1])
    await advanceTimers(10_000)
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

    rerender({ revision: 1 })
    await advanceTimers(1200)
    await rejectDeferred(pendingSaves[0])
    await advanceTimers(10_000)
    expect(saveToBackend).toHaveBeenCalledTimes(1)

    rerender({ revision: 2 })
    await advanceTimers(1200)
    expect(saveToBackend).toHaveBeenCalledTimes(2)

    await resolveDeferred(pendingSaves[1])
    await advanceTimers(1000)
    expect(saveToBackend).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['save-failed', 'workspace.persistence.saveFailed', 'error'],
    ['chapter-conflict', 'workspace.persistence.chapterConflict', 'warning'],
    ['structural-conflict', 'workspace.persistence.structuralConflict', 'error'],
  ] as const)('shows sanitized workspace feedback for %s', (kind, message, variant) => {
    const params = buildCoreParams({ workspaceSaveFeedback: { kind } })
    const { result } = renderHook(() => useSelectionNovelStudioCore(params))

    expect(result.current.toast).toBe(message)
    expect(result.current.toastVariant).toBe(variant)
    expect(result.current.toast).not.toContain('stale_revision')
  })

  it('prioritizes workspace feedback during render and restores transient toast output when feedback clears', () => {
    const params = buildCoreParams()
    const { result, rerender } = renderHook(
      ({ workspaceSaveFeedback }) => useSelectionNovelStudioCore({ ...params, workspaceSaveFeedback }),
      { initialProps: { workspaceSaveFeedback: null as WorkspaceSaveFeedback | null } },
    )

    act(() => {
      result.current.setToast('knowledge.updated', 'info')
    })
    expect(result.current.toast).toBe('knowledge.updated')
    expect(result.current.toastVariant).toBe('info')

    rerender({ workspaceSaveFeedback: { kind: 'chapter-conflict' } })
    expect(result.current.toast).toBe('workspace.persistence.chapterConflict')
    expect(result.current.toastVariant).toBe('warning')

    rerender({ workspaceSaveFeedback: null })
    expect(result.current.toast).toBe('knowledge.updated')
    expect(result.current.toastVariant).toBe('info')

    act(() => {
      result.current.setToast('')
    })
    expect(result.current.toast).toBe('')
  })

  it('saves a failed signature again after changing away and returning', async () => {
    const pendingSaves: Deferred[] = []
    const saveToBackend = vi.fn(() => {
      const deferred = createDeferred()
      pendingSaves.push(deferred)
      return deferred.promise
    })
    const { rerender } = renderAutosaveHook(saveToBackend)

    rerender({ revision: 1 })
    await advanceTimers(1200)
    await rejectDeferred(pendingSaves[0])

    rerender({ revision: 2 })
    await advanceTimers(1200)
    expect(saveToBackend).toHaveBeenCalledTimes(2)
    await resolveDeferred(pendingSaves[1])

    rerender({ revision: 1 })
    await advanceTimers(1200)
    expect(saveToBackend).toHaveBeenCalledTimes(3)
    await resolveDeferred(pendingSaves[2])
  })

  it('persists the latest revision after unmounting during an older save without scheduling a timer', async () => {
    const pendingSave = createDeferred()
    const saveToBackend = vi.fn(() => pendingSave.promise)
    const { rerender, unmount } = renderAutosaveHook(saveToBackend)

    rerender({ revision: 1 })
    await advanceTimers(1200)
    rerender({ revision: 2 })
    unmount()

    await resolveDeferred(pendingSave)
    await advanceTimers(10_000)
    expect(saveToBackend).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('contains a rejected best-effort unmount save', async () => {
    const saveToBackend = vi.fn().mockRejectedValue(new Error('offline'))
    const { rerender, unmount } = renderAutosaveHook(saveToBackend)

    rerender({ revision: 1 })
    unmount()

    await advanceTimers(10_000)
    expect(saveToBackend).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('suppresses deletion signatures and reevaluates the latest state when pending clears', async () => {
    const saveToBackend = vi.fn().mockResolvedValue(undefined)
    const { rerender } = renderAutosaveHook(saveToBackend)

    rerender({ revision: 1, deletionPending: true })
    await advanceTimers(10_000)
    expect(saveToBackend).not.toHaveBeenCalled()

    rerender({ revision: 0, deletionPending: false })
    await advanceTimers(10_000)
    expect(saveToBackend).not.toHaveBeenCalled()

    rerender({ revision: 2, novelId: 'authoritative', deletionPending: true })
    await advanceTimers(10_000)
    expect(saveToBackend).not.toHaveBeenCalled()

    rerender({ revision: 2, novelId: 'authoritative', deletionPending: false })
    await advanceTimers(1199)
    expect(saveToBackend).not.toHaveBeenCalled()
    await advanceTimers(1)
    expect(saveToBackend).toHaveBeenCalledTimes(1)
  })

  it('does not redirect an optimistic empty workspace until deletion pending clears', () => {
    const params = buildCoreParams({ localChapters: [], isNovelDeletionPending: true })
    const { rerender } = renderHook(
      ({ deletionPending }) => useSelectionNovelStudioCore({ ...params, isNovelDeletionPending: deletionPending }),
      { initialProps: { deletionPending: true } },
    )

    expect(pushMock).not.toHaveBeenCalled()

    rerender({ deletionPending: false })

    expect(pushMock).toHaveBeenCalledWith('/library')
  })
})

describe('useSelectionNovelStudioCore editor buffering', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    tiptapMock.options = null
    tiptapMock.editor = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/knowledge-view?')) {
        return jsonResponse({ ok: true, knowledgeRebuildStatus: null, hanlpCacheSnapshot: null, knowledgeStatusOverview: null })
      }
      if (url.startsWith('/api/story-timeline?')) {
        return jsonResponse({ novelId: 'novel-1', branchId: 'novel-1:main', chapters: [], branchNodes: [], edges: [] })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    tiptapMock.options = null
    tiptapMock.editor = null
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function installEditor(initialHtml = '<p>Alpha</p>', initialText = 'Alpha') {
    let html = initialHtml
    let text = initialText
    const setContent = vi.fn((content: string) => {
      html = content
      text = content.replace(/<[^>]+>/g, '')
    })
    tiptapMock.editor = {
      getHTML: () => html,
      getText: () => text,
      setEditable: vi.fn(),
      commands: { setContent },
      view: { dom: document.createElement('div') },
    }
    return {
      setValue(nextHtml: string, nextText: string) {
        html = nextHtml
        text = nextText
      },
      setContent,
    }
  }

  it('coalesces TipTap updates and flushes on blur without eager store writes', async () => {
    const editor = installEditor()
    const updateChapterContent = vi.fn()
    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
      updateChapterContent,
    })
    renderHook(() => useSelectionNovelStudioCore(params))

    editor.setValue('<p>Draft 1</p>', 'Draft 1')
    tiptapMock.options?.onUpdate?.({ editor: tiptapMock.editor! })
    editor.setValue('<p>Draft 2</p>', 'Draft 2')
    tiptapMock.options?.onUpdate?.({ editor: tiptapMock.editor! })
    expect(updateChapterContent).not.toHaveBeenCalled()

    tiptapMock.options?.onBlur?.()
    expect(updateChapterContent).toHaveBeenCalledTimes(1)
    expect(updateChapterContent).toHaveBeenCalledWith('chapter-1', '<p>Draft 2</p>', 6)
    await advanceTimers(10_000)
    expect(updateChapterContent).toHaveBeenCalledTimes(1)
  })

  it('journals editor changes and safely restores a cached draft against the same server baseline', async () => {
    const editor = installEditor()
    const updateChapterContent = vi.fn()
    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
      updateChapterContent,
    })
    const hook = renderHook(() => useSelectionNovelStudioCore(params))

    editor.setValue('<p>Journaled</p>', 'Journaled')
    tiptapMock.options?.onUpdate?.({ editor: tiptapMock.editor! })
    await advanceTimers(179)
    expect(readChapterDraft('novel-1', 'chapter-1')).toBeNull()
    await advanceTimers(1)
    expect(readChapterDraft('novel-1', 'chapter-1')?.content).toBe('<p>Journaled</p>')
    hook.unmount()

    window.localStorage.clear()
    writeChapterDraft({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      baseContent: '<p>Alpha</p>',
      content: '<p>Recovered</p>',
      wordCount: 9,
    })
    const recoveryUpdate = vi.fn()
    const recovered = renderHook(() => useSelectionNovelStudioCore({ ...params, updateChapterContent: recoveryUpdate }))

    await advanceTimers(0)
    expect(recoveryUpdate).toHaveBeenCalledWith('chapter-1', '<p>Recovered</p>', 9)
    expect(recovered.result.current.toast).toBe('workspace.persistence.localDraftRecovered')
    expect(recovered.result.current.toastVariant).toBe('warning')
    recovered.unmount()
  })

  it('does not overwrite changed server content without confirmation', async () => {
    writeChapterDraft({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      baseContent: '<p>Older server</p>',
      content: '<p>Local draft</p>',
      wordCount: 8,
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const updateChapterContent = vi.fn()
    renderHook(() => useSelectionNovelStudioCore(buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
      updateChapterContent,
    })))

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(updateChapterContent).not.toHaveBeenCalled()
    expect(readChapterDraft('novel-1', 'chapter-1')).toBeNull()
  })

  it('flushes on debounce, pagehide, hidden visibility, and unmount', async () => {
    const editor = installEditor()
    const updateChapterContent = vi.fn()
    const saveToBackend = vi.fn().mockResolvedValue(undefined)
    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
      updateChapterContent,
      saveToBackend,
    })
    const hook = renderHook(() => useSelectionNovelStudioCore(params))

    editor.setValue('<p>Debounced</p>', 'Debounced')
    tiptapMock.options?.onUpdate?.({ editor: tiptapMock.editor! })
    await advanceTimers(300)
    expect(updateChapterContent).toHaveBeenLastCalledWith('chapter-1', '<p>Debounced</p>', 9)

    editor.setValue('<p>Page hide</p>', 'Page hide')
    tiptapMock.options?.onUpdate?.({ editor: tiptapMock.editor! })
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    expect(updateChapterContent).toHaveBeenLastCalledWith('chapter-1', '<p>Page hide</p>', 8)
    await vi.waitFor(() => expect(saveToBackend).toHaveBeenCalledWith({ lifecycle: true }))

    editor.setValue('<p>Hidden</p>', 'Hidden')
    tiptapMock.options?.onUpdate?.({ editor: tiptapMock.editor! })
    const visibilityState = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(updateChapterContent).toHaveBeenLastCalledWith('chapter-1', '<p>Hidden</p>', 6)
    await vi.waitFor(() => expect(saveToBackend).toHaveBeenCalledWith({ lifecycle: true }))
    visibilityState.mockRestore()

    editor.setValue('<p>Unmounted</p>', 'Unmounted')
    tiptapMock.options?.onUpdate?.({ editor: tiptapMock.editor! })
    hook.unmount()
    expect(updateChapterContent).toHaveBeenLastCalledWith('chapter-1', '<p>Unmounted</p>', 9)
  })

  it('flushes and saves immediately before the autosave delay when navigating away', async () => {
    const editor = installEditor()
    const updateChapterContent = vi.fn()
    const saveToBackend = vi.fn().mockResolvedValue(undefined)
    let revision = 0
    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
      updateChapterContent: (...args) => {
        updateChapterContent(...args)
        revision += 1
      },
      saveToBackend,
      readAutosaveTarget: () => `novel-1\u0000${revision}`,
    })
    const { result, rerender } = renderHook(
      ({ autosaveTarget }) => useSelectionNovelStudioCore({ ...params, autosaveTarget }),
      { initialProps: { autosaveTarget: 'novel-1\u00000' } },
    )

    editor.setValue('<p>Navigate now</p>', 'Navigate now')
    tiptapMock.options?.onUpdate?.({ editor: tiptapMock.editor! })

    let saved = false
    await act(async () => {
      saved = await result.current.saveWorkspaceBeforeNavigation()
    })

    expect(saved).toBe(true)
    expect(updateChapterContent).toHaveBeenCalledWith('chapter-1', '<p>Navigate now</p>', 11)
    expect(saveToBackend).toHaveBeenCalledTimes(1)
    rerender({ autosaveTarget: 'novel-1\u00001' })
    await advanceTimers(1_200)
    expect(saveToBackend).toHaveBeenCalledTimes(1)
  })

  it('waits for an older in-flight save and then persists the newly flushed edit', async () => {
    const editor = installEditor()
    const firstSave = createDeferred()
    const saveToBackend = vi.fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValueOnce(undefined)
    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
      updateChapterContent: vi.fn(),
      saveToBackend,
    })
    const { result, rerender } = renderHook(
      ({ revision }) => useSelectionNovelStudioCore({ ...params, autosaveTarget: `novel-1\u0000${revision}` }),
      { initialProps: { revision: 0 } },
    )

    rerender({ revision: 1 })
    await advanceTimers(1_200)
    expect(saveToBackend).toHaveBeenCalledTimes(1)

    editor.setValue('<p>Newer edit</p>', 'Newer edit')
    tiptapMock.options?.onUpdate?.({ editor: tiptapMock.editor! })
    const navigationSave = result.current.saveWorkspaceBeforeNavigation()
    expect(saveToBackend).toHaveBeenCalledTimes(1)

    await resolveDeferred(firstSave)
    await expect(navigationSave).resolves.toBe(true)
    expect(saveToBackend).toHaveBeenCalledTimes(2)
  })

  it('drains edits entered while navigation is waiting for an older save', async () => {
    const editor = installEditor()
    const firstSave = createDeferred()
    const secondSave = createDeferred()
    const saveToBackend = vi.fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise)
      .mockResolvedValueOnce(undefined)
    let revision = 1
    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
      updateChapterContent: vi.fn(() => { revision += 1 }),
      saveToBackend,
      readAutosaveTarget: () => `novel-1\u0000${revision}`,
    })
    const { result, rerender } = renderHook(
      ({ autosaveTarget }) => useSelectionNovelStudioCore({ ...params, autosaveTarget }),
      { initialProps: { autosaveTarget: 'novel-1\u00000' } },
    )

    rerender({ autosaveTarget: 'novel-1\u00001' })
    await advanceTimers(1_200)
    editor.setValue('<p>First navigation edit</p>', 'First navigation edit')
    tiptapMock.options?.onUpdate?.({ editor: tiptapMock.editor! })
    const navigationSave = result.current.saveWorkspaceBeforeNavigation()

    await resolveDeferred(firstSave)
    await vi.waitFor(() => expect(saveToBackend).toHaveBeenCalledTimes(2))
    editor.setValue('<p>Typed while saving</p>', 'Typed while saving')
    tiptapMock.options?.onUpdate?.({ editor: tiptapMock.editor! })
    await resolveDeferred(secondSave)

    await expect(navigationSave).resolves.toBe(true)
    expect(saveToBackend).toHaveBeenCalledTimes(3)
    expect(params.updateChapterContent).toHaveBeenCalledTimes(2)
  })

  it('blocks explicit navigation when the drained save fails', async () => {
    const editor = installEditor()
    const saveToBackend = vi.fn().mockRejectedValue(new Error('save failed'))
    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
      updateChapterContent: vi.fn(),
      saveToBackend,
    })
    const { result } = renderHook(() => useSelectionNovelStudioCore(params))

    editor.setValue('<p>Unsaved</p>', 'Unsaved')
    tiptapMock.options?.onUpdate?.({ editor: tiptapMock.editor! })

    await act(async () => {
      await expect(result.current.saveWorkspaceBeforeNavigation()).resolves.toBe(false)
    })
    expect(result.current.toast).toBe('workspace.persistence.saveFailed')
    expect(result.current.toastVariant).toBe('error')
  })

  it('flushes chapter A before switching to B and prevents stale timer writes', async () => {
    const editor = installEditor()
    const chapterA = buildChapter({ id: 'chapter-a', content: '<p>A</p>', order: 1 })
    const chapterB = buildChapter({ id: 'chapter-b', content: '<p>B</p>', order: 2 })
    const updateChapterContent = vi.fn()
    const setCurrentChapterId = vi.fn()
    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
      localChapters: [chapterA, chapterB],
      currentChapterId: chapterA.id,
      setCurrentChapterId,
      updateChapterContent,
    })
    const { result } = renderHook(() => useSelectionNovelStudioCore(params))

    editor.setValue('<p>A latest</p>', 'A latest')
    tiptapMock.options?.onUpdate?.({ editor: tiptapMock.editor! })
    act(() => result.current.selectChapter(chapterB))

    expect(updateChapterContent).toHaveBeenCalledWith('chapter-a', '<p>A latest</p>', 7)
    expect(updateChapterContent.mock.invocationCallOrder[0]).toBeLessThan(setCurrentChapterId.mock.invocationCallOrder[0])
    await advanceTimers(10_000)
    expect(updateChapterContent).toHaveBeenCalledTimes(1)
  })

  it('keeps external setContent with emitUpdate false non-dirty', async () => {
    const editor = installEditor('<p>Stale</p>', 'Stale')
    const updateChapterContent = vi.fn()
    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
      updateChapterContent,
    })
    renderHook(() => useSelectionNovelStudioCore(params))

    expect(editor.setContent).toHaveBeenCalledWith('<p>Alpha</p>', { emitUpdate: false })
    await advanceTimers(10_000)
    expect(updateChapterContent).not.toHaveBeenCalled()
  })
})

describe('useSelectionNovelStudioCore knowledge rebuild polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    pushMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps the running-status delay when parent adapter callbacks are recreated', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/story-timeline?')) {
        return jsonResponse(buildStoryTimeline())
      }
      if (url.includes('/api/knowledge-view?') && url.includes('statusOnly=1')) {
        return jsonResponse({
          ok: true,
          knowledgeRebuildStatus: buildKnowledgeRebuildStatus('running'),
          hanlpCacheSnapshot: null,
          knowledgeStatusOverview: buildKnowledgeStatusOverview(),
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
    })
    const { unmount } = renderHook(() => useSelectionNovelStudioCore({
      ...params,
      clearPresetCompatSessionStateForSelection: (selection) => params.clearPresetCompatSessionStateForSelection(selection),
      resetPresetCompatSessionStateForSelection: (selection, surfaces) => params.resetPresetCompatSessionStateForSelection(selection, surfaces),
    }))
    const knowledgeRequests = () => fetchMock.mock.calls.filter(([input]) => (
      String(input).includes('/api/knowledge-view?') && String(input).includes('statusOnly=1')
    ))

    await advanceTimers(0)
    expect(knowledgeRequests()).toHaveLength(1)

    await advanceTimers(1_499)
    expect(knowledgeRequests()).toHaveLength(1)

    await advanceTimers(1)
    expect(knowledgeRequests()).toHaveLength(2)

    unmount()
  })

  it('selects a saturated running write step before a later pending raw embedding step', () => {
    const { result, unmount } = renderHook(() => useSelectionNovelStudioCore(buildCoreParams()))

    act(() => {
      result.current.setKnowledgeRebuildStatus({
        ...buildKnowledgeRebuildStatus('running'),
        currentStep: 'write',
        steps: [
          { key: 'write', label: 'Write', status: 'running', progress: 1, etaMinutes: null, detail: null },
          { key: 'raw-embedding', label: 'Raw embedding', status: 'pending', progress: 0, etaMinutes: null, detail: null },
        ],
      })
    })

    expect(result.current.currentKnowledgeRunningStepKey).toBe('write')
    unmount()
  })

  it('keeps fresh running and paused status objects on their delay boundaries', async () => {
    let knowledgeRequestCount = 0
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/story-timeline?')) {
        return jsonResponse(buildStoryTimeline())
      }
      if (url.startsWith('/api/knowledge-view?')) {
        knowledgeRequestCount += 1
        const status = knowledgeRequestCount <= 2 ? 'running' : 'paused'
        return jsonResponse({
          ok: true,
          knowledgeRebuildStatus: buildKnowledgeRebuildStatus(status),
          hanlpCacheSnapshot: null,
          knowledgeStatusOverview: null,
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
    })
    const { unmount } = renderHook(() => useSelectionNovelStudioCore(params))
    const knowledgeRequests = () => fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/knowledge-view?'))

    await advanceTimers(0)
    expect(knowledgeRequests()).toHaveLength(1)

    await advanceTimers(1499)
    expect(knowledgeRequests()).toHaveLength(1)
    await advanceTimers(1)
    expect(knowledgeRequests()).toHaveLength(2)

    await advanceTimers(1499)
    expect(knowledgeRequests()).toHaveLength(2)
    await advanceTimers(1)
    expect(knowledgeRequests()).toHaveLength(3)

    await advanceTimers(3499)
    expect(knowledgeRequests()).toHaveLength(3)
    await advanceTimers(1)
    expect(knowledgeRequests()).toHaveLength(4)

    unmount()
  })

  it('uses an externally updated running status when an in-flight poll rejects', async () => {
    const pendingKnowledgeResponse = createDeferred()
    let knowledgeRequestCount = 0
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/story-timeline?')) {
        return jsonResponse(buildStoryTimeline())
      }
      if (url.startsWith('/api/knowledge-view?')) {
        knowledgeRequestCount += 1
        if (knowledgeRequestCount === 1) {
          return pendingKnowledgeResponse.promise.then((response) => response as Response)
        }
        return jsonResponse({
          ok: true,
          knowledgeRebuildStatus: buildKnowledgeRebuildStatus('running'),
          hanlpCacheSnapshot: null,
          knowledgeStatusOverview: null,
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
    })
    const { result, unmount } = renderHook(() => useSelectionNovelStudioCore(params))
    const knowledgeRequests = () => fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/knowledge-view?'))

    await advanceTimers(0)
    expect(knowledgeRequests()).toHaveLength(1)

    act(() => {
      result.current.setKnowledgeRebuildStatus(buildKnowledgeRebuildStatus('running'))
    })
    expect(knowledgeRequests()).toHaveLength(1)

    await rejectDeferred(pendingKnowledgeResponse)
    await advanceTimers(1499)
    expect(knowledgeRequests()).toHaveLength(1)
    await advanceTimers(1)
    expect(knowledgeRequests()).toHaveLength(2)

    unmount()
  })

  it('retries a transient rejection using the latest paused delay', async () => {
    let knowledgeRequestCount = 0
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/story-timeline?')) {
        return jsonResponse(buildStoryTimeline())
      }
      if (url.startsWith('/api/knowledge-view?')) {
        knowledgeRequestCount += 1
        if (knowledgeRequestCount === 2) {
          throw new Error('transient knowledge status failure')
        }
        return jsonResponse({
          ok: true,
          knowledgeRebuildStatus: buildKnowledgeRebuildStatus('paused'),
          hanlpCacheSnapshot: null,
          knowledgeStatusOverview: null,
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
    })
    const { unmount } = renderHook(() => useSelectionNovelStudioCore(params))
    const knowledgeRequests = () => fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/knowledge-view?'))

    await advanceTimers(0)
    expect(knowledgeRequests()).toHaveLength(1)

    await advanceTimers(3499)
    expect(knowledgeRequests()).toHaveLength(1)
    await advanceTimers(1)
    expect(knowledgeRequests()).toHaveLength(2)

    await advanceTimers(3499)
    expect(knowledgeRequests()).toHaveLength(2)
    await advanceTimers(1)
    expect(knowledgeRequests()).toHaveLength(3)

    unmount()
  })

  it('retries an initial HTTP failure on the active polling boundary', async () => {
    let knowledgeRequestCount = 0
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/story-timeline?')) {
        return jsonResponse(buildStoryTimeline())
      }
      if (url.startsWith('/api/knowledge-view?')) {
        knowledgeRequestCount += 1
        if (knowledgeRequestCount === 1) {
          return new Response(JSON.stringify({ ok: false }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return jsonResponse({ ok: true, knowledgeRebuildStatus: null })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
    })
    const { unmount } = renderHook(() => useSelectionNovelStudioCore(params))
    const knowledgeRequests = () => fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/knowledge-view?'))

    await advanceTimers(0)
    expect(knowledgeRequests()).toHaveLength(1)
    await advanceTimers(1499)
    expect(knowledgeRequests()).toHaveLength(1)
    await advanceTimers(1)
    expect(knowledgeRequests()).toHaveLength(2)

    unmount()
  })

  it('retries an initial API failure on the active polling boundary', async () => {
    let knowledgeRequestCount = 0
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/story-timeline?')) {
        return jsonResponse(buildStoryTimeline())
      }
      if (url.startsWith('/api/knowledge-view?')) {
        knowledgeRequestCount += 1
        if (knowledgeRequestCount === 1) {
          return jsonResponse({ ok: false })
        }
        return jsonResponse({ ok: true, knowledgeRebuildStatus: null })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
    })
    const { unmount } = renderHook(() => useSelectionNovelStudioCore(params))
    const knowledgeRequests = () => fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/knowledge-view?'))

    await advanceTimers(0)
    expect(knowledgeRequests()).toHaveLength(1)
    await advanceTimers(1499)
    expect(knowledgeRequests()).toHaveLength(1)
    await advanceTimers(1)
    expect(knowledgeRequests()).toHaveLength(2)

    unmount()
  })

  it('retries an initial thrown fetch error on the active polling boundary', async () => {
    let knowledgeRequestCount = 0
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/story-timeline?')) {
        return jsonResponse(buildStoryTimeline())
      }
      if (url.startsWith('/api/knowledge-view?')) {
        knowledgeRequestCount += 1
        if (knowledgeRequestCount === 1) {
          throw new Error('initial knowledge fetch failed')
        }
        return jsonResponse({ ok: true, knowledgeRebuildStatus: null })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
    })
    const { unmount } = renderHook(() => useSelectionNovelStudioCore(params))
    const knowledgeRequests = () => fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/knowledge-view?'))

    await advanceTimers(0)
    expect(knowledgeRequests()).toHaveLength(1)
    await advanceTimers(1499)
    expect(knowledgeRequests()).toHaveLength(1)
    await advanceTimers(1)
    expect(knowledgeRequests()).toHaveLength(2)

    unmount()
  })

  it('aborts an unresolved request before the latest effect generation proceeds', async () => {
    const pendingKnowledgeResponse = createDeferred()
    let activeKnowledgeRequests = 0
    let maximumActiveKnowledgeRequests = 0
    let knowledgeRequestCount = 0
    const knowledgeSignals: AbortSignal[] = []
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.startsWith('/api/story-timeline?')) {
        return jsonResponse(buildStoryTimeline())
      }
      if (url.startsWith('/api/knowledge-view?')) {
        if (!init?.signal) throw new Error('Missing knowledge poll abort signal')
        knowledgeSignals.push(init.signal)
        knowledgeRequestCount += 1
        activeKnowledgeRequests += 1
        maximumActiveKnowledgeRequests = Math.max(maximumActiveKnowledgeRequests, activeKnowledgeRequests)
        if (knowledgeRequestCount === 1) {
          init.signal.addEventListener('abort', () => {
            pendingKnowledgeResponse.reject(new DOMException('Aborted', 'AbortError'))
          }, { once: true })
        }
        const response = knowledgeRequestCount === 1
          ? pendingKnowledgeResponse.promise.then((value) => value as Response)
          : Promise.resolve(jsonResponse({
              ok: true,
              knowledgeRebuildStatus: buildKnowledgeRebuildStatus('running'),
              hanlpCacheSnapshot: null,
              knowledgeStatusOverview: null,
            }))
        return response.finally(() => {
          activeKnowledgeRequests -= 1
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
    })
    const { result, unmount } = renderHook(() => useSelectionNovelStudioCore(params))
    const knowledgeRequests = () => fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/knowledge-view?'))

    await advanceTimers(0)
    expect(knowledgeRequests()).toHaveLength(1)

    act(() => {
      result.current.setKnowledgeActionLoading('pause')
      result.current.setKnowledgeRebuilding(true)
    })
    await act(async () => {
      await pendingKnowledgeResponse.promise.catch(() => undefined)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(knowledgeSignals[0].aborted).toBe(true)
    expect(knowledgeRequests()).toHaveLength(1)
    expect(maximumActiveKnowledgeRequests).toBe(1)

    await advanceTimers(1199)
    expect(knowledgeRequests()).toHaveLength(1)
    await advanceTimers(1)
    expect(knowledgeRequests()).toHaveLength(2)
    expect(maximumActiveKnowledgeRequests).toBe(1)

    unmount()
  })

  it('preserves visible running status and retries an HTTP 503 on the running delay', async () => {
    let knowledgeRequestCount = 0
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/story-timeline?')) {
        return jsonResponse(buildStoryTimeline())
      }
      if (url.startsWith('/api/knowledge-view?')) {
        knowledgeRequestCount += 1
        if (knowledgeRequestCount === 2) {
          return new Response(JSON.stringify({ ok: false }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return jsonResponse({
          ok: true,
          knowledgeRebuildStatus: buildKnowledgeRebuildStatus('running'),
          hanlpCacheSnapshot: null,
          knowledgeStatusOverview: null,
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
    })
    const { result, unmount } = renderHook(() => useSelectionNovelStudioCore(params))
    const knowledgeRequests = () => fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/knowledge-view?'))

    await advanceTimers(0)
    expect(result.current.knowledgeRebuildStatus?.status).toBe('running')

    await advanceTimers(1499)
    expect(knowledgeRequests()).toHaveLength(1)
    await advanceTimers(1)
    expect(knowledgeRequests()).toHaveLength(2)
    expect(result.current.knowledgeRebuildStatus?.status).toBe('running')

    await advanceTimers(1499)
    expect(knowledgeRequests()).toHaveLength(2)
    await advanceTimers(1)
    expect(knowledgeRequests()).toHaveLength(3)
    expect(result.current.knowledgeRebuildStatus?.status).toBe('running')

    unmount()
  })

  it('preserves visible paused status and retries an API failure on the paused delay', async () => {
    let knowledgeRequestCount = 0
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/story-timeline?')) {
        return jsonResponse(buildStoryTimeline())
      }
      if (url.startsWith('/api/knowledge-view?')) {
        knowledgeRequestCount += 1
        if (knowledgeRequestCount === 2) {
          return jsonResponse({ ok: false })
        }
        return jsonResponse({
          ok: true,
          knowledgeRebuildStatus: buildKnowledgeRebuildStatus('paused'),
          hanlpCacheSnapshot: null,
          knowledgeStatusOverview: null,
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
    })
    const { result, unmount } = renderHook(() => useSelectionNovelStudioCore(params))
    const knowledgeRequests = () => fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/knowledge-view?'))

    await advanceTimers(0)
    expect(result.current.knowledgeRebuildStatus?.status).toBe('paused')

    await advanceTimers(3499)
    expect(knowledgeRequests()).toHaveLength(1)
    await advanceTimers(1)
    expect(knowledgeRequests()).toHaveLength(2)
    expect(result.current.knowledgeRebuildStatus?.status).toBe('paused')

    await advanceTimers(3499)
    expect(knowledgeRequests()).toHaveLength(2)
    await advanceTimers(1)
    expect(knowledgeRequests()).toHaveLength(3)
    expect(result.current.knowledgeRebuildStatus?.status).toBe('paused')

    unmount()
  })

  it('keeps requests single-flight and stops after an in-flight unmount', async () => {
    const pendingKnowledgeResponse = createDeferred()
    const knowledgeSignals: AbortSignal[] = []
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.startsWith('/api/story-timeline?')) {
        return jsonResponse(buildStoryTimeline())
      }
      if (url.startsWith('/api/knowledge-view?')) {
        if (!init?.signal) throw new Error('Missing knowledge poll abort signal')
        knowledgeSignals.push(init.signal)
        init.signal.addEventListener('abort', () => {
          pendingKnowledgeResponse.reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
        return pendingKnowledgeResponse.promise.then((response) => response as Response)
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
    })
    const { unmount } = renderHook(() => useSelectionNovelStudioCore(params))
    const knowledgeRequests = () => fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/knowledge-view?'))

    await advanceTimers(0)
    expect(knowledgeRequests()).toHaveLength(1)
    await advanceTimers(10_000)
    expect(knowledgeRequests()).toHaveLength(1)

    unmount()
    await act(async () => {
      await pendingKnowledgeResponse.promise.catch(() => undefined)
      await Promise.resolve()
      await Promise.resolve()
    })
    await advanceTimers(10_000)

    const knowledgeSignal = knowledgeSignals[0]
    if (!knowledgeSignal) throw new Error('Knowledge poll signal was not captured')
    expect(knowledgeSignal.aborted).toBe(true)
    expect(knowledgeRequests()).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('useSelectionNovelStudioCore knowledge projection selection', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
  })

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

  it('defers mobile hidden reference resources while keeping desktop and opened surfaces visible', () => {
    expect(resolveReferenceResourcesVisible(false, true, false)).toBe(false)
    expect(resolveReferenceResourcesVisible(false, true, true)).toBe(true)
    expect(resolveReferenceResourcesVisible(true, true, false)).toBe(true)
    expect(resolveReferenceResourcesVisible(false, false, false)).toBe(true)
  })

  it('refreshes knowledge projection with a selected non-chapter block source chapter immediately after direct selection', async () => {
    const storyTimeline = buildStoryTimeline()
    const authoritativeOverview = buildKnowledgeStatusOverview()
    const refreshKnowledgeProjection = vi.fn<(novelId: string, asOfChapter?: number) => Promise<KnowledgeProjectionResult>>()
      .mockResolvedValue(buildKnowledgeProjectionResult({ knowledgeStatusOverview: authoritativeOverview }))
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
      isNovelDeletionPending: false,
      backendLoaded: true,
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
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
      autosaveTarget: 'sig-1',
      workspaceSaveFeedback: null,
    }))

    await waitFor(() => {
      expect(result.current.timelineNodeById.get('continue-node-2')).toBeDefined()
    })

    await flushEffects()

    expect(refreshKnowledgeProjection).toHaveBeenCalledWith('novel-1', 1, expect.any(AbortSignal))
    expect(result.current.knowledgeStatusOverview).toEqual(authoritativeOverview)

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
      expect(refreshKnowledgeProjection).toHaveBeenLastCalledWith('novel-1', 2, expect.any(AbortSignal))
    })
  })

  it('ignores an older full projection refresh after the selected chapter changes', async () => {
    const storyTimeline = buildStoryTimeline()
    const olderOverview = buildKnowledgeStatusOverview({
      extractionCache: { status: 'partial', coveredChapterCount: 1, totalChapterCount: 2, validThroughChapterNo: 1 },
    })
    const latestOverview = buildKnowledgeStatusOverview({
      extractionCache: { status: 'full', coveredChapterCount: 2, totalChapterCount: 2, validThroughChapterNo: 2 },
    })
    let resolveOlderRefresh: ((result: KnowledgeProjectionResult) => void) | undefined
    let resolveLatestRefresh: ((result: KnowledgeProjectionResult) => void) | undefined
    const olderRefresh = new Promise<KnowledgeProjectionResult>((resolve) => {
      resolveOlderRefresh = resolve
    })
    const latestRefresh = new Promise<KnowledgeProjectionResult>((resolve) => {
      resolveLatestRefresh = resolve
    })
    const refreshKnowledgeProjection = vi.fn<(novelId: string, asOfChapter?: number) => Promise<KnowledgeProjectionResult>>()
      .mockImplementation((_novelId, asOfChapter) => asOfChapter === 1 ? olderRefresh : latestRefresh)
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

    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
      localChapters: [
        buildChapter({ id: 'chapter-1', order: 1, title: 'Chapter 1' }),
        buildChapter({ id: 'chapter-2', order: 2, title: 'Chapter 2' }),
      ],
      refreshKnowledgeProjection,
      autosaveTarget: 'sig-1',
    })
    const { result } = renderHook(() => useSelectionNovelStudioCore(params))

    await waitFor(() => {
      expect(result.current.timelineNodeById.get('continue-node-2')).toBeDefined()
      expect(refreshKnowledgeProjection).toHaveBeenCalledWith('novel-1', 1, expect.any(AbortSignal))
    })

    act(() => {
      result.current.handleTimelineSelection({
        kind: 'continue_block',
        nodeId: 'continue-node-2',
        continueBlockId: 'continue-block-2',
        anchorChapterNo: 99,
      })
    })

    await waitFor(() => {
    expect(refreshKnowledgeProjection).toHaveBeenCalledWith('novel-1', 2, expect.any(AbortSignal))
    })

    await act(async () => {
      resolveLatestRefresh?.(buildKnowledgeProjectionResult({ knowledgeStatusOverview: latestOverview }))
      await latestRefresh
    })
    expect(result.current.knowledgeStatusOverview).toEqual(latestOverview)

    await act(async () => {
      resolveOlderRefresh?.(buildKnowledgeProjectionResult({ knowledgeStatusOverview: olderOverview }))
      await olderRefresh
    })
    expect(result.current.knowledgeStatusOverview).toEqual(latestOverview)
  })

  it('keeps an authoritative action overview when a pending selected refresh resolves late', async () => {
    const storyTimeline = buildStoryTimeline()
    const staleOverview = buildKnowledgeStatusOverview()
    const missingOverview = buildKnowledgeStatusOverview({
      embeddingCache: {
        status: 'missing',
        coveredChapterCount: 0,
        totalChapterCount: 64,
        validThroughChapterNo: null,
        provider: null,
        model: null,
      },
    })
    let resolveRefresh: ((result: KnowledgeProjectionResult) => void) | undefined
    const pendingRefresh = new Promise<KnowledgeProjectionResult>((resolve) => {
      resolveRefresh = resolve
    })
    const refreshKnowledgeProjection = vi.fn<(novelId: string, asOfChapter?: number) => Promise<KnowledgeProjectionResult>>()
      .mockReturnValue(pendingRefresh)
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/story-timeline?')) {
        return jsonResponse(storyTimeline)
      }
      if (url.startsWith('/api/knowledge-view?')) {
        return jsonResponse({ ok: true, knowledgeRebuildStatus: null, hanlpCacheSnapshot: null, knowledgeStatusOverview: null })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
      refreshKnowledgeProjection,
      autosaveTarget: 'sig-1',
    })
    const { result } = renderHook(() => useSelectionNovelStudioCore(params))

    await waitFor(() => {
      expect(refreshKnowledgeProjection).toHaveBeenCalledWith('novel-1', 1, expect.any(AbortSignal))
    })

    act(() => {
      result.current.setKnowledgeActionLoading('delete-embedding-cache')
      result.current.setKnowledgeStatusOverview(missingOverview)
    })

    await act(async () => {
      resolveRefresh?.(buildKnowledgeProjectionResult({ knowledgeStatusOverview: staleOverview }))
      await pendingRefresh
    })

    expect(result.current.knowledgeStatusOverview).toEqual(missingOverview)
  })

  it('keeps an authoritative rebuild overview when a pending selected refresh resolves late', async () => {
    const staleOverview = buildKnowledgeStatusOverview({
      extractionCache: { status: 'partial', coveredChapterCount: 1, totalChapterCount: 64, validThroughChapterNo: 1 },
    })
    const rebuiltOverview = buildKnowledgeStatusOverview()
    let resolveRefresh: ((result: KnowledgeProjectionResult) => void) | undefined
    const pendingRefresh = new Promise<KnowledgeProjectionResult>((resolve) => {
      resolveRefresh = resolve
    })
    const refreshKnowledgeProjection = vi.fn<(novelId: string, asOfChapter?: number) => Promise<KnowledgeProjectionResult>>()
      .mockReturnValue(pendingRefresh)
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/story-timeline?')) return jsonResponse(buildStoryTimeline())
      if (url.startsWith('/api/knowledge-view?')) {
        return jsonResponse({ ok: true, knowledgeRebuildStatus: null, hanlpCacheSnapshot: null, knowledgeStatusOverview: null })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const params = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
      refreshKnowledgeProjection,
      autosaveTarget: 'sig-1',
    })
    const { result } = renderHook(() => useSelectionNovelStudioCore(params))

    await waitFor(() => {
      expect(refreshKnowledgeProjection).toHaveBeenCalledWith('novel-1', 1, expect.any(AbortSignal))
    })

    act(() => {
      result.current.setKnowledgeRebuilding(true)
      result.current.setKnowledgeStatusOverview(rebuiltOverview)
    })

    await act(async () => {
      resolveRefresh?.(buildKnowledgeProjectionResult({ knowledgeStatusOverview: staleOverview }))
      await pendingRefresh
    })

    expect(result.current.knowledgeStatusOverview).toEqual(rebuiltOverview)
    expect(refreshKnowledgeProjection).toHaveBeenCalledTimes(1)
  })

  it('resets same-model knowledge coverage across novels and ignores the old novel refresh', async () => {
    const novelAOverview = buildKnowledgeStatusOverview()
    const novelBOverview = buildKnowledgeStatusOverview({
      knowledgeGraph: { status: 'partial', coveredChapterCount: 8, totalChapterCount: 64, validThroughChapterNo: 8 },
      extractionCache: { status: 'partial', coveredChapterCount: 8, totalChapterCount: 64, validThroughChapterNo: 8 },
      embeddingCache: {
        status: 'partial',
        coveredChapterCount: 8,
        totalChapterCount: 64,
        validThroughChapterNo: 8,
        provider: 'ollama',
        model: 'qwen3-embedding:4b',
      },
      retrievalIndex: { status: 'partial', indexedScopeCount: 8, task: null },
    })
    let resolveNovelARefresh: ((result: KnowledgeProjectionResult) => void) | undefined
    const novelARefresh = new Promise<KnowledgeProjectionResult>((resolve) => {
      resolveNovelARefresh = resolve
    })
    const refreshKnowledgeProjection = vi.fn<(novelId: string, asOfChapter?: number) => Promise<KnowledgeProjectionResult>>()
      .mockImplementation((novelId) => novelId === 'novel-a'
        ? novelARefresh
        : Promise.resolve(buildKnowledgeProjectionResult({ knowledgeStatusOverview: novelBOverview })))
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/story-timeline') {
        const novelId = url.searchParams.get('novelId') ?? ''
        return jsonResponse({ ...buildStoryTimeline(), novelId, branchId: `${novelId}:main` })
      }
      if (url.pathname === '/api/knowledge-view') {
        const overview = url.searchParams.get('novelId') === 'novel-a' ? novelAOverview : novelBOverview
        return jsonResponse({ ok: true, knowledgeRebuildStatus: null, hanlpCacheSnapshot: null, knowledgeStatusOverview: overview })
      }
      throw new Error(`Unexpected fetch: ${url.toString()}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const novelAParams = buildCoreParams({
      currentNovelId: 'novel-a',
      localNovels: [{ id: 'novel-a', title: 'novel-a' }],
      localChapters: [buildChapter({ id: 'novel-a-chapter-1', novelId: 'novel-a' })],
      currentChapterId: 'novel-a-chapter-1',
      refreshKnowledgeProjection,
      autosaveTarget: 'novel-a',
    })
    const novelBParams = buildCoreParams({
      backendLoaded: false,
      currentNovelId: 'novel-b',
      localNovels: [{ id: 'novel-b', title: 'novel-b' }],
      localChapters: [buildChapter({ id: 'novel-b-chapter-1', novelId: 'novel-b' })],
      currentChapterId: 'novel-b-chapter-1',
      refreshKnowledgeProjection,
      autosaveTarget: 'novel-b',
    })
    const { result, rerender } = renderHook(
      ({ novelId }) => useSelectionNovelStudioCore(novelId === 'novel-a' ? novelAParams : novelBParams),
      { initialProps: { novelId: 'novel-a' } },
    )

    await waitFor(() => {
      expect(result.current.knowledgeStatusOverview).toEqual(novelAOverview)
      expect(refreshKnowledgeProjection).toHaveBeenCalledWith('novel-a', 1, expect.any(AbortSignal))
    })

    rerender({ novelId: 'novel-b' })

    await waitFor(() => {
      expect(result.current.knowledgeStatusOverview).toEqual(novelBOverview)
    })

    await act(async () => {
      resolveNovelARefresh?.(buildKnowledgeProjectionResult({ knowledgeStatusOverview: novelAOverview }))
      await novelARefresh
    })

    expect(result.current.knowledgeStatusOverview).toEqual(novelBOverview)
  })
})

describe('useSelectionNovelStudioCore workspace selection history', () => {
  beforeEach(() => {
    window.history.replaceState({ preserved: 'history-state' }, '', '/workspace')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function stubWorkspaceFetch(storyTimeline = buildStoryTimeline()) {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/story-timeline?')) return jsonResponse(storyTimeline)
      if (url.startsWith('/api/knowledge-view?')) {
        return jsonResponse({ ok: true, knowledgeRebuildStatus: null, hanlpCacheSnapshot: null, knowledgeStatusOverview: null })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
  }

  function renderHistoryCore() {
    const localChapters = [
      buildChapter({ id: 'chapter-1', order: 1, title: 'Chapter 1' }),
      buildChapter({ id: 'chapter-2', order: 2, title: 'Chapter 2' }),
    ]
    const baseParams = buildCoreParams({
      currentNovelId: 'novel-1',
      localNovels: [{ id: 'novel-1', title: 'Novel 1' }],
      localChapters,
      autosaveTarget: 'history-test',
    })

    return renderHook(() => {
      const [currentChapterId, setCurrentChapterId] = useState('chapter-1')
      const core = useSelectionNovelStudioCore({ ...baseParams, currentChapterId, setCurrentChapterId })
      return { core, currentChapterId }
    })
  }

  it('defers branch selection hydration until timeline data is available without writing an intermediate chapter URL', async () => {
    window.history.replaceState(
      { preserved: 'history-state' },
      '',
      '/workspace?selectionKind=continue_block&selectionNodeId=continue-node-2&selectionContinueBlockId=continue-block-2&selectionAnchorChapterNo=99',
    )
    const storyTimelineResponse = createDeferred()
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/story-timeline?')) {
        return storyTimelineResponse.promise.then((value) => value as Response)
      }
      if (url.startsWith('/api/knowledge-view?')) {
        return jsonResponse({ ok: true, knowledgeRebuildStatus: null, hanlpCacheSnapshot: null, knowledgeStatusOverview: null })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const pushState = vi.spyOn(window.history, 'pushState')
    const replaceState = vi.spyOn(window.history, 'replaceState')
    const { result } = renderHistoryCore()

    await flushEffects()
    expect(result.current.core.workspaceSelection).toBeNull()
    expect(pushState).not.toHaveBeenCalled()
    expect(replaceState).not.toHaveBeenCalled()

    await act(async () => {
      storyTimelineResponse.resolve(jsonResponse(buildStoryTimeline()))
      await storyTimelineResponse.promise
    })

    await waitFor(() => {
      expect(result.current.core.workspaceSelection).toEqual({
        kind: 'continue_block',
        nodeId: 'continue-node-2',
        continueBlockId: 'continue-block-2',
        anchorChapterNo: 99,
      })
    })
    expect(pushState).not.toHaveBeenCalled()
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('pushes explicit chapter and branch selections and restores them with Back and Forward without write loops', async () => {
    stubWorkspaceFetch()
    window.history.replaceState(
      { preserved: 'history-state' },
      '',
      '/workspace?foo=bar&selectionKind=chapter&selectionChapterId=chapter-1&selectionChapterNo=1#selection-anchor',
    )
    const pushState = vi.spyOn(window.history, 'pushState')
    const replaceState = vi.spyOn(window.history, 'replaceState')
    const { result } = renderHistoryCore()

    await waitFor(() => {
      expect(result.current.core.workspaceSelection).toEqual({ kind: 'chapter', chapterId: 'chapter-1', chapterNo: 1 })
      expect(result.current.core.timelineNodeById.get('continue-node-2')).toBeDefined()
    })
    expect(pushState).not.toHaveBeenCalled()
    expect(replaceState).not.toHaveBeenCalled()

    act(() => {
      result.current.core.handleTimelineSelection({ kind: 'chapter', chapterId: 'chapter-2', chapterNo: 2 })
    })
    await waitFor(() => {
      expect(result.current.currentChapterId).toBe('chapter-2')
      expect(window.location.search).toContain('selectionChapterId=chapter-2')
    })
    expect(pushState).toHaveBeenCalledTimes(1)
    expect(pushState).toHaveBeenLastCalledWith(
      { preserved: 'history-state' },
      '',
      '/workspace?foo=bar&selectionKind=chapter&selectionChapterId=chapter-2&selectionChapterNo=2#selection-anchor',
    )

    act(() => {
      result.current.core.handleTimelineSelection({
        kind: 'continue_block',
        nodeId: 'continue-node-2',
        continueBlockId: 'continue-block-2',
        anchorChapterNo: 99,
      })
    })
    await waitFor(() => {
      expect(window.location.search).toContain('selectionNodeId=continue-node-2')
    })
    expect(pushState).toHaveBeenCalledTimes(2)
    expect(window.location.search).toContain('foo=bar')
    expect(window.location.hash).toBe('#selection-anchor')

    act(() => window.history.back())
    await waitFor(() => {
      expect(result.current.core.workspaceSelection).toEqual({ kind: 'chapter', chapterId: 'chapter-2', chapterNo: 2 })
      expect(result.current.currentChapterId).toBe('chapter-2')
    })

    act(() => window.history.forward())
    await waitFor(() => {
      expect(result.current.core.workspaceSelection).toEqual({
        kind: 'continue_block',
        nodeId: 'continue-node-2',
        continueBlockId: 'continue-block-2',
        anchorChapterNo: 99,
      })
      expect(result.current.currentChapterId).toBe('chapter-2')
    })
    expect(pushState).toHaveBeenCalledTimes(2)
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('canonicalizes initial chapter hydration with replace while preserving unrelated URL state', async () => {
    stubWorkspaceFetch()
    window.history.replaceState(
      { preserved: 'history-state' },
      '',
      '/workspace?foo=bar&selectionKind=chapter&selectionChapterId=deleted-chapter&selectionChapterNo=2#selection-anchor',
    )
    const pushState = vi.spyOn(window.history, 'pushState')
    const replaceState = vi.spyOn(window.history, 'replaceState')
    const { result } = renderHistoryCore()

    await waitFor(() => {
      expect(result.current.currentChapterId).toBe('chapter-2')
      expect(result.current.core.workspaceSelection).toEqual({ kind: 'chapter', chapterId: 'chapter-2', chapterNo: 2 })
      expect(window.location.search).toContain('selectionChapterId=chapter-2')
    })
    expect(pushState).not.toHaveBeenCalled()
    expect(replaceState).toHaveBeenCalledTimes(1)
    expect(replaceState).toHaveBeenCalledWith(
      { preserved: 'history-state' },
      '',
      '/workspace?foo=bar&selectionKind=chapter&selectionChapterId=chapter-2&selectionChapterNo=2#selection-anchor',
    )
  })

  it('replaces a deleted branch selection with its chapter fallback', async () => {
    stubWorkspaceFetch()
    window.history.replaceState(
      { preserved: 'history-state' },
      '',
      '/workspace?selectionKind=chapter&selectionChapterId=chapter-2&selectionChapterNo=2',
    )
    const pushState = vi.spyOn(window.history, 'pushState')
    const replaceState = vi.spyOn(window.history, 'replaceState')
    const { result } = renderHistoryCore()

    await waitFor(() => {
      expect(result.current.core.timelineNodeById.get('continue-node-2')).toBeDefined()
      expect(result.current.currentChapterId).toBe('chapter-2')
    })
    act(() => {
      result.current.core.handleTimelineSelection({
        kind: 'continue_block',
        nodeId: 'continue-node-2',
        continueBlockId: 'continue-block-2',
        anchorChapterNo: 99,
      })
    })
    await waitFor(() => expect(pushState).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.core.setStoryTimelineData({ ...buildStoryTimeline(), branchNodes: [] })
    })
    await waitFor(() => {
      expect(result.current.core.workspaceSelection).toEqual({ kind: 'chapter', chapterId: 'chapter-2', chapterNo: 2 })
      expect(window.location.search).toContain('selectionChapterId=chapter-2')
    })
    expect(replaceState).toHaveBeenCalledTimes(1)
  })
})
