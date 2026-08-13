// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSelectionNovelStudioActions } from '@/components/workspace/use-selection-novel-studio-actions'
import { useSelectionNovelStudioCore } from '@/components/workspace/use-selection-novel-studio-core'
import type { KnowledgeStatusOverview, RecoverableRewriteJob } from '@/components/workspace/selection-novel-studio-helpers'
import type { Chapter } from '@/lib/types'
import { useNovelStore } from '@/store/novel-store'
import type { KnowledgeProjectionResult, NovelStore } from '@/store/novel-store-types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
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

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

type PendingFetch = {
  url: string
  signal: AbortSignal
  deferred: Deferred<Response>
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: Deferred<T>['resolve']
  let rejectPromise!: Deferred<T>['reject']
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function buildRecoverableRewriteJob(status: 'queued' | 'running' | 'succeeded', overrides: Partial<RecoverableRewriteJob> = {}): RecoverableRewriteJob {
  return {
    jobId: 'rewrite-job-1',
    status,
    progress: status === 'queued' ? 0 : status === 'running' ? 0.5 : 1,
    currentStep: status === 'queued' ? 'Queued' : status === 'running' ? 'Running' : null,
    errorMessage: null,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:01.000Z',
    panel: {
      novelId: 'novel-1',
      branchId: 'novel-1:main',
      chapterId: chapter.id,
      selectedText: 'Recovered selection',
      sourceText: 'Recovered source',
      sourceTextOverride: 'Recovered source override',
      userInstruction: 'Recovered instruction',
      rewriteLaunchSource: 'chapter',
      branchContextNodeId: null,
      branchContextInclusion: null,
      continueBlockId: null,
      createdAt: '2026-07-27T00:00:00.000Z',
    },
    result: status === 'succeeded'
      ? { title: 'Recovered result', summary: 'Recovered summary', content: 'Recovered content', provider: 'test-provider' }
      : null,
    ...overrides,
  }
}

function buildRecoverableRewriteStoryTimeline() {
  return {
    novelId: 'novel-1',
    branchId: 'novel-1:main',
    chapters: [{ type: 'chapter', chapterId: chapter.id, chapterNo: chapter.order, title: chapter.title, wordCount: chapter.wordCount }],
    branchNodes: [{
      type: 'branch_node',
      id: 'continue-node-1',
      nodeType: 'continue_block',
      readableLabel: 'CONT-01',
      readableLineageLabel: 'CONT-01',
      anchorChapterNo: 1,
      parentNodeId: null,
      title: 'Continue block',
      subtitle: null,
      laneIndex: 0,
      colorToken: 'fuchsia',
      sourceChapterNo: 1,
      targetChapterNo: null,
      continueBlockId: 'continue-1',
      whatIfSessionId: null,
      futureJumpRunId: null,
      roleplaySessionId: null,
      status: 'active',
    }],
    edges: [],
  }
}

function deletedNovelResult(novelId: string, activeNovelId: string | null = null, cleanupPending = false) {
  return {
    status: 'committed' as const,
    result: { ok: true as const, deletedNovelId: novelId, activeNovelId, deletionState: 'deleted' as const, cleanupPending },
  }
}

const chapter: Chapter = {
  id: 'chapter-1',
  novelId: 'novel-1',
  volumeId: 'volume-1',
  title: 'Chapter 1',
  order: 1,
  content: '<p>Alpha</p>',
  status: 'draft',
  wordCount: 100,
  updatedAt: '2026-07-15',
}

function buildKnowledgeStatusOverview(overrides: Partial<KnowledgeStatusOverview> = {}): KnowledgeStatusOverview {
  return {
    knowledgeGraph: { status: 'full', coveredChapterCount: 1, totalChapterCount: 1, validThroughChapterNo: 1 },
    extractionCache: { status: 'full', coveredChapterCount: 1, totalChapterCount: 1, validThroughChapterNo: 1 },
    embeddingCache: {
      status: 'full',
      coveredChapterCount: 1,
      totalChapterCount: 1,
      validThroughChapterNo: 1,
      provider: 'ollama',
      model: 'qwen3-embedding:4b',
    },
    retrievalIndex: { status: 'full', indexedScopeCount: 1, task: null },
    ...overrides,
  }
}

function buildKnowledgeProjectionResult(knowledgeStatusOverview: KnowledgeStatusOverview | null): KnowledgeProjectionResult {
  return {
    localOutlines: [],
    localCharacters: [],
    localCharacterRelations: [],
    localWorldEntries: [],
    localTimelineEvents: [],
    knowledgeRebuildStatus: null,
    hanlpCacheSnapshot: null,
    knowledgeStatusOverview,
    jobOutcome: null,
    actionError: null,
  }
}

function renderActionsHook(options: {
  backendLoaded?: boolean
  currentNovelId?: string
  refreshKnowledgeProjection?: (novelId: string, asOfChapter?: number) => Promise<KnowledgeProjectionResult>
  saveAISettings?: () => Promise<unknown>
  loadFromBackend?: () => Promise<void>
  reconcileNovelDeletionFromBackend?: NovelStore['reconcileNovelDeletionFromBackend']
  deleteNovel?: (novelId: string) => void
  deleteNovelFromBackend?: NovelStore['deleteNovelFromBackend']
  isNovelDeletionPending?: boolean
  beginNovelDeletion?: NovelStore['beginNovelDeletion']
  rollbackNovelDeletion?: NovelStore['rollbackNovelDeletion']
  setNovelDeletionPending?: NovelStore['setNovelDeletionPending']
  reconcileNovelDeletion?: NovelStore['reconcileNovelDeletion']
} = {}) {
  const coreParams: Parameters<typeof useSelectionNovelStudioCore>[0] = {
    loadFromBackend: options.loadFromBackend ?? vi.fn().mockResolvedValue(undefined),
    saveToBackend: vi.fn().mockResolvedValue(undefined),
    isNovelDeletionPending: options.isNovelDeletionPending ?? false,
    backendLoaded: options.backendLoaded ?? true,
    currentNovelId: options.currentNovelId ?? '',
    localNovels: options.currentNovelId ? [{ id: options.currentNovelId, title: 'Novel 1' }] : [],
    localVolumes: [],
    localChapters: [chapter],
    currentChapterId: chapter.id,
    setCurrentChapterId: vi.fn(),
    updateChapterContent: vi.fn(),
    aiSettings: undefined,
    setAISettings: vi.fn(),
    refreshKnowledgeProjection: options.refreshKnowledgeProjection ?? vi.fn().mockResolvedValue(buildKnowledgeProjectionResult(null)),
    clearPresetCompatSessionStateForSelection: vi.fn(),
    resetPresetCompatSessionStateForSelection: vi.fn(),
    presetCompatSessionState: {},
    localCharacters: [],
    localWorldEntries: [],
    localTimelineEvents: [],
    localOutlines: [],
    autosaveTarget: 'sig-0',
    workspaceSaveFeedback: null,
  }

  return renderHook(({ currentNovelId, localChapters }: { currentNovelId: string; localChapters?: Chapter[] }) => {
    const runtimeChapters = localChapters ?? coreParams.localChapters
    const runtimeChapter = runtimeChapters[0] ?? chapter
    const runtimeCoreParams = {
      ...coreParams,
      currentNovelId,
      localNovels: currentNovelId ? [{ id: currentNovelId, title: 'Novel 1' }] : [],
      localChapters: runtimeChapters,
      currentChapterId: runtimeChapter.id,
    }
    const core = useSelectionNovelStudioCore(runtimeCoreParams)
    const actions = useSelectionNovelStudioActions({
      core,
      viewModel: {
        activeWorkspaceSelection: { kind: 'chapter', chapterId: runtimeChapter.id, chapterNo: runtimeChapter.order },
        selectedTimelineNode: null,
        selectedContinueBlockNode: null,
        selectedContinueBlockFutureMapLaunch: null,
        selectedTimelineDisplayLabel: '',
        selectedTimelineInstructionPreview: '',
      },
      loadFromBackend: coreParams.loadFromBackend,
      saveToBackend: coreParams.saveToBackend,
      deleteNovelFromBackend: options.deleteNovelFromBackend ?? vi.fn(async (novelId: string) => deletedNovelResult(novelId)),
      reconcileNovelDeletionFromBackend: options.reconcileNovelDeletionFromBackend ?? vi.fn(async () => 'deleted' as const),
      isNovelDeletionPending: options.isNovelDeletionPending ?? false,
  beginNovelDeletion: options.beginNovelDeletion ?? vi.fn((novelId: string) => ({
    novelId,
    before: useNovelStore.getState().snapshotPersistedState(),
    optimistic: useNovelStore.getState().snapshotPersistedState(),
    summary: null,
  })),
      rollbackNovelDeletion: options.rollbackNovelDeletion ?? vi.fn(),
      setNovelDeletionPending: options.setNovelDeletionPending ?? vi.fn(),
      reconcileNovelDeletion: options.reconcileNovelDeletion ?? vi.fn(),
      localChapters: runtimeChapters,
      deleteChapter: vi.fn(),
      deleteNovel: options.deleteNovel ?? vi.fn(),
      saveAISettings: options.saveAISettings ?? vi.fn().mockResolvedValue(undefined),
      savePresetCompatLibrary: vi.fn().mockResolvedValue(undefined),
      rebuildStoryKnowledge: vi.fn().mockResolvedValue(undefined),
      rebuildStoryRetrievalIndex: vi.fn().mockResolvedValue(undefined),
      pauseStoryKnowledgeRebuild: vi.fn().mockResolvedValue(undefined),
      abortStoryKnowledgeRebuild: vi.fn().mockResolvedValue(undefined),
      deleteStoryKnowledgeGraph: vi.fn().mockResolvedValue(undefined),
      deleteStoryHanlpCache: vi.fn().mockResolvedValue(undefined),
      deleteStoryExtractionCache: vi.fn().mockResolvedValue(undefined),
      deleteStoryEmbeddingCache: vi.fn().mockResolvedValue(undefined),
      setPresetCompatSessionPhase: vi.fn(),
      setCurrentChapterId: coreParams.setCurrentChapterId,
      updateChapterContent: coreParams.updateChapterContent,
    })
    return { actions, core }
  }, { initialProps: { currentNovelId: options.currentNovelId ?? '', localChapters: coreParams.localChapters } })
}

function installIdleWorkspaceFetchMock() {
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
}

function installRecoverableRewriteFetchMock(options: {
  restoreResponse: Deferred<Response>
  storyTimelineResponse?: Deferred<Response>
  createResponse?: Deferred<Response>
  createResponses?: Deferred<Response>[]
  pollResponses?: Deferred<Response>[]
  abortResponses?: Deferred<Response>[]
}) {
  let createIndex = 0
  let pollIndex = 0
  let abortIndex = 0
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.startsWith('/api/knowledge-view?') && method === 'GET') {
      return Promise.resolve(jsonResponse({ ok: true, knowledgeRebuildStatus: null, hanlpCacheSnapshot: null, knowledgeStatusOverview: null }))
    }
    if (url.startsWith('/api/story-timeline?') && method === 'GET') {
      if (options.storyTimelineResponse) return options.storyTimelineResponse.promise
      return Promise.resolve(jsonResponse({ novelId: 'novel-1', branchId: 'novel-1:main', chapters: [], branchNodes: [], edges: [] }))
    }
    if (url.startsWith('/api/rewrite?') && method === 'GET') {
      if (url.includes('jobId=')) {
        const response = options.pollResponses?.[pollIndex]
        pollIndex += 1
        if (!response) throw new Error(`Unexpected rewrite poll: ${url}`)
        return response.promise
      }
      return options.restoreResponse.promise
    }
    if (url === '/api/rewrite' && method === 'POST') {
      const response = options.createResponses?.[createIndex] ?? options.createResponse
      createIndex += 1
      if (!response) throw new Error('Unexpected rewrite create')
      return response.promise
    }
    if (url.startsWith('/api/rewrite?') && method === 'DELETE') {
      const response = options.abortResponses?.[abortIndex]
      abortIndex += 1
      if (!response) throw new Error(`Unexpected rewrite abort: ${url}`)
      return response.promise
    }
    if (url === '/api/generation-context' && method === 'POST') {
      return Promise.resolve(jsonResponse({ ok: false, error: 'Context preview omitted by test' }, 400))
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function installPendingFetchMock() {
  const requests: PendingFetch[] = []
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const deferred = createDeferred<Response>()
    if (!init?.signal) throw new Error(`Missing discovery signal for ${String(input)}`)
    requests.push({ url: String(input), signal: init.signal, deferred })
    return deferred.promise
  })
  vi.stubGlobal('fetch', fetchMock)
  return requests
}

async function resolveRequest(request: PendingFetch, response: Response) {
  await act(async () => {
    request.deferred.resolve(response)
    await request.deferred.promise
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function rejectRequest(request: PendingFetch, error: Error) {
  await act(async () => {
    request.deferred.reject(error)
    await request.deferred.promise.catch(() => undefined)
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function resolveDeferredResponse(deferred: Deferred<Response>, response: Response) {
  await act(async () => {
    deferred.resolve(response)
    await deferred.promise
    await Promise.resolve()
    await Promise.resolve()
  })
}

function captureRewritePoll() {
  const scheduledPolls: Array<{ id: ReturnType<typeof setTimeout>; handler: () => void }> = []
  const nativeSetTimeout = globalThis.setTimeout
  const nativeClearTimeout = globalThis.clearTimeout
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay, ...args) => {
    if (delay === 1500 && typeof handler === 'function') {
      const pollId = nativeSetTimeout(() => undefined, 2_147_483_647)
      nativeClearTimeout(pollId)
      scheduledPolls.push({ id: pollId, handler: () => handler(...args) })
      return pollId
    }
    return nativeSetTimeout(handler, delay, ...args)
  })
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation((timeoutId) => {
    const pollIndex = scheduledPolls.findIndex((poll) => poll.id === timeoutId)
    if (pollIndex >= 0) {
      scheduledPolls.splice(pollIndex, 1)
      return
    }
    nativeClearTimeout(timeoutId)
  })
  return {
    runNext() {
      const poll = scheduledPolls.shift()
      if (!poll) throw new Error('Rewrite poll was not scheduled')
      poll.handler()
    },
    scheduledCount() {
      return scheduledPolls.length
    },
  }
}

describe('useSelectionNovelStudioActions model discovery', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('aborts only the previous request for the same provider and scenario', () => {
    const requests = installPendingFetchMock()
    const { result } = renderActionsHook()

    act(() => {
      void result.current.actions.loadOpenAICompatibleModels('rewrite', 'https://first.example/v1')
      void result.current.actions.loadOpenAICompatibleModels('knowledgeExtraction', 'https://knowledge.example/v1')
      void result.current.actions.loadOllamaModels('rewrite', 'http://ollama-first:11434')
    })

    expect(requests).toHaveLength(3)
    expect(requests[0].signal.aborted).toBe(false)
    expect(requests[1].signal.aborted).toBe(false)
    expect(requests[2].signal.aborted).toBe(false)

    act(() => {
      void result.current.actions.loadOpenAICompatibleModels('rewrite', 'https://second.example/v1')
    })

    expect(requests[0].signal.aborted).toBe(true)
    expect(requests[1].signal.aborted).toBe(false)
    expect(requests[2].signal.aborted).toBe(false)
    expect(requests[3].signal.aborted).toBe(false)

    act(() => {
      void result.current.actions.loadOllamaModels('rewrite', 'http://ollama-second:11434')
    })

    expect(requests[2].signal.aborted).toBe(true)
    expect(requests[3].signal.aborted).toBe(false)
    expect(requests[4].signal.aborted).toBe(false)
  })

  it('ignores stale provider results, errors, and loading completions', async () => {
    const requests = installPendingFetchMock()
    const { result } = renderActionsHook()

    act(() => {
      void result.current.actions.loadOllamaModels('rewrite', 'http://ollama-stale:11434')
      void result.current.actions.loadOllamaModels('rewrite', 'http://ollama-current:11434')
    })

    await resolveRequest(requests[1], jsonResponse({ ok: true, models: [{ id: 'ollama-current', label: 'Ollama current' }] }))
    await waitFor(() => {
      expect(result.current.core.ollamaModelsByScenario.rewrite).toEqual([{ id: 'ollama-current', label: 'Ollama current' }])
      expect(result.current.core.ollamaModelsLoading.rewrite).toBe(false)
    })

    await rejectRequest(requests[0], new Error('stale Ollama failure'))
    expect(result.current.core.ollamaModelsByScenario.rewrite).toEqual([{ id: 'ollama-current', label: 'Ollama current' }])
    expect(result.current.core.ollamaModelsError.rewrite).toBe('')
    expect(result.current.core.ollamaModelsLoading.rewrite).toBe(false)

    act(() => {
      void result.current.actions.loadOpenAICompatibleModels('rewrite', 'https://openai-stale.example/v1')
      void result.current.actions.loadOpenAICompatibleModels('rewrite', 'https://openai-current.example/v1')
    })

    await resolveRequest(requests[3], jsonResponse({ ok: true, models: [{ id: 'openai-current', label: 'OpenAI current' }] }))
    await waitFor(() => {
      expect(result.current.core.openAICompatibleModelsByScenario.rewrite).toEqual([{ id: 'openai-current', label: 'OpenAI current' }])
      expect(result.current.core.openAICompatibleModelsLoading.rewrite).toBe(false)
    })

    await resolveRequest(requests[2], jsonResponse({ ok: true, models: [{ id: 'openai-stale', label: 'OpenAI stale' }] }))
    expect(result.current.core.openAICompatibleModelsByScenario.rewrite).toEqual([{ id: 'openai-current', label: 'OpenAI current' }])
    expect(result.current.core.openAICompatibleModelsLoading.rewrite).toBe(false)
  })

  it('aborts every active discovery request on unmount', () => {
    const requests = installPendingFetchMock()
    const { result, unmount } = renderActionsHook()

    act(() => {
      void result.current.actions.loadOpenAICompatibleModels('rewrite', 'https://openai.example/v1')
      void result.current.actions.loadOllamaModels('embeddings', 'http://ollama:11434')
    })

    expect(requests.every((request) => !request.signal.aborted)).toBe(true)
    unmount()
    expect(requests.every((request) => request.signal.aborted)).toBe(true)
  })

  it.each(['queued', 'running'] as const)('hydrates a clean initial %s recoverable rewrite', async (status) => {
    const restoreResponse = createDeferred<Response>()
    const fetchMock = installRecoverableRewriteFetchMock({ restoreResponse })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/rewrite\?/), expect.anything()))
    await waitFor(() => expect(result.current.core.workspaceSelection).toEqual({ kind: 'chapter', chapterId: chapter.id, chapterNo: chapter.order }))
    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob(status) }))

    await waitFor(() => {
      expect(result.current.core.activeMode).toBe('rewrite')
      expect(result.current.core.selectionText).toBe('Recovered selection')
      expect(result.current.core.lockedSelectionText).toBe('Recovered selection')
      expect(result.current.core.rewritePrompt).toBe('Recovered instruction')
      expect(result.current.core.rewriteFlow.jobId).toBe('rewrite-job-1')
      expect(result.current.core.rewriteFlow.jobStatus).toBe(status)
      expect(result.current.core.rewriteFlow.loading).toBe(true)
    })
  })

  it('hydrates a clean initial succeeded recoverable rewrite with content', async () => {
    const restoreResponse = createDeferred<Response>()
    installRecoverableRewriteFetchMock({ restoreResponse })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })

    await waitFor(() => expect(result.current.core.workspaceSelection).toEqual({ kind: 'chapter', chapterId: chapter.id, chapterNo: chapter.order }))
    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('succeeded') }))

    await waitFor(() => {
      expect(result.current.core.activeMode).toBe('rewrite')
      expect(result.current.core.rewriteFlow.jobId).toBe('rewrite-job-1')
      expect(result.current.core.rewriteFlow.jobStatus).toBe('succeeded')
      expect(result.current.core.rewriteState.result).toBe('Recovered content')
    })
  })

  it('ignores a delayed initial restore after an explicit same-current-chapter selection before URL hydration', async () => {
    const restoreResponse = createDeferred<Response>()
    installRecoverableRewriteFetchMock({ restoreResponse })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })

    expect(result.current.core.workspaceSelection).toBeNull()
    act(() => result.current.core.handleTimelineSelection({ kind: 'chapter', chapterId: chapter.id, chapterNo: chapter.order }))
    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('succeeded') }))

    expect(result.current.core.activeMode).toBeNull()
    expect(result.current.core.rewriteFlow.jobId).toBeNull()
    expect(result.current.core.ownedRecoverableRewriteJobIdRef.current).toBeNull()
  })

  it('ignores a delayed initial restore after a same-chapter timeline transition', async () => {
    const restoreResponse = createDeferred<Response>()
    installRecoverableRewriteFetchMock({ restoreResponse })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })

    act(() => result.current.core.handleTimelineSelection({ kind: 'rewrite', nodeId: 'node-1', continueBlockId: 'continue-1', anchorChapterNo: 1 }))
    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('succeeded') }))

    expect(result.current.core.activeMode).toBeNull()
    expect(result.current.core.rewriteFlow.jobId).toBeNull()
  })

  it('lets URL branch hydration invalidate delayed restore and create ownership', async () => {
    window.history.replaceState({}, '', '/?selectionKind=continue_block&selectionNodeId=continue-node-1&selectionContinueBlockId=continue-1&selectionAnchorChapterNo=1')
    const restoreResponse = createDeferred<Response>()
    const storyTimelineResponse = createDeferred<Response>()
    const createResponse = createDeferred<Response>()
    installRecoverableRewriteFetchMock({ restoreResponse, storyTimelineResponse, createResponse })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })
    act(() => result.current.core.setSelectionText('Fresh selection'))
    await act(async () => { await result.current.actions.openActionMode('rewrite') })
    act(() => { void result.current.actions.handleRewrite() })

    await resolveDeferredResponse(storyTimelineResponse, jsonResponse(buildRecoverableRewriteStoryTimeline()))
    await waitFor(() => expect(result.current.core.workspaceSelection).toEqual({ kind: 'continue_block', nodeId: 'continue-node-1', continueBlockId: 'continue-1', anchorChapterNo: 1 }))
    await resolveDeferredResponse(createResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('queued') }))
    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('succeeded') }))

    expect(result.current.core.activeMode).toBeNull()
    expect(result.current.core.ownedRecoverableRewriteJobIdRef.current).toBeNull()
    expect(result.current.core.rewriteFlow.jobId).toBeNull()
  })

  it('lets delayed URL branch hydration close a restored rewrite and reject its in-flight poll', async () => {
    window.history.replaceState({}, '', '/?selectionKind=continue_block&selectionNodeId=continue-node-1&selectionContinueBlockId=continue-1&selectionAnchorChapterNo=1')
    const restoreResponse = createDeferred<Response>()
    const storyTimelineResponse = createDeferred<Response>()
    const pollResponse = createDeferred<Response>()
    const poll = captureRewritePoll()
    installRecoverableRewriteFetchMock({ restoreResponse, storyTimelineResponse, pollResponses: [pollResponse] })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })

    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('running') }))
    await waitFor(() => expect(result.current.core.rewriteFlow.jobId).toBe('rewrite-job-1'))
    act(() => poll.runNext())
    await resolveDeferredResponse(storyTimelineResponse, jsonResponse(buildRecoverableRewriteStoryTimeline()))
    await waitFor(() => expect(result.current.core.workspaceSelection).toEqual({ kind: 'continue_block', nodeId: 'continue-node-1', continueBlockId: 'continue-1', anchorChapterNo: 1 }))
    await resolveDeferredResponse(pollResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('succeeded') }))

    expect(result.current.core.activeMode).toBeNull()
    expect(result.current.core.ownedRecoverableRewriteJobIdRef.current).toBeNull()
    expect(result.current.core.rewriteFlow.jobStatus).toBe('running')
  })

  it('ignores a delayed restore after a fresh rewrite open', async () => {
    const restoreResponse = createDeferred<Response>()
    const fetchMock = installRecoverableRewriteFetchMock({ restoreResponse })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/rewrite\?/), expect.anything()))
    act(() => result.current.core.setSelectionText('Fresh selection'))
    act(() => {
      void result.current.actions.openActionMode('rewrite')
    })

    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('succeeded') }))

    expect(result.current.core.activeMode).toBe('rewrite')
    expect(result.current.core.selectionText).toBe('Fresh selection')
    expect(result.current.core.lockedSelectionText).toBe('Fresh selection')
    expect(result.current.core.rewritePrompt).toBe('workspace.rewrite.defaultPrompt')
    expect(result.current.core.rewriteFlow.jobId).toBeNull()
  })

  it('ignores a delayed restore after the rewrite prompt is edited', async () => {
    const restoreResponse = createDeferred<Response>()
    const fetchMock = installRecoverableRewriteFetchMock({ restoreResponse })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/rewrite\?/), expect.anything()))
    act(() => result.current.actions.handleRewritePromptChange('Fresh instruction'))
    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('succeeded') }))

    expect(result.current.core.activeMode).toBeNull()
    expect(result.current.core.rewritePrompt).toBe('Fresh instruction')
    expect(result.current.core.selectionText).toBe('')
    expect(result.current.core.rewriteFlow.jobId).toBeNull()
  })

  it('does not reopen the panel when a delayed restore resolves after close', async () => {
    const restoreResponse = createDeferred<Response>()
    const fetchMock = installRecoverableRewriteFetchMock({ restoreResponse })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/rewrite\?/), expect.anything()))
    act(() => result.current.core.setActiveMode('rewrite'))
    act(() => result.current.core.closePanel())
    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('succeeded') }))

    expect(result.current.core.activeMode).toBeNull()
    expect(result.current.core.rewritePrompt).toBe('workspace.rewrite.defaultPrompt')
    expect(result.current.core.selectionText).toBe('')
    expect(result.current.core.rewriteFlow.jobId).toBeNull()
  })

  it('synchronizes a rewrite POST job without hydrating returned panel fields', async () => {
    const restoreResponse = createDeferred<Response>()
    const createResponse = createDeferred<Response>()
    const fetchMock = installRecoverableRewriteFetchMock({ restoreResponse, createResponse })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/rewrite\?/), expect.anything()))
    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: null }))
    act(() => result.current.core.setSelectionText('Fresh selection'))
    act(() => {
      void result.current.actions.openActionMode('rewrite')
    })
    act(() => result.current.actions.handleRewritePromptChange('Fresh instruction'))

    let rewritePromise: Promise<void> | undefined
    act(() => {
      rewritePromise = result.current.actions.handleRewrite()
    })
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/rewrite', expect.objectContaining({ method: 'POST' }))
    })

    await act(async () => {
      createResponse.resolve(jsonResponse({ ok: true, job: buildRecoverableRewriteJob('queued') }))
      await rewritePromise
    })

    expect(result.current.core.selectionText).toBe('Fresh selection')
    expect(result.current.core.lockedSelectionText).toBe('Fresh selection')
    expect(result.current.core.rewritePrompt).toBe('Fresh instruction')
    expect(result.current.core.rewriteFlow.jobId).toBe('rewrite-job-1')
    expect(result.current.core.rewriteFlow.jobStatus).toBe('queued')
  })

  it('uses the latest flushed editor text as the rewrite source', async () => {
    const restoreResponse = createDeferred<Response>()
    const createResponse = createDeferred<Response>()
    const fetchMock = installRecoverableRewriteFetchMock({ restoreResponse, createResponse })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })
    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: null }))
    act(() => result.current.core.setSelectionText('Fresh selection'))
    await act(async () => { await result.current.actions.openActionMode('rewrite') })
    const updateChapterContent = vi.fn()
    const latestText = 'Latest buffered editor text'
    result.current.core.flushEditorBuffer = () => {
      updateChapterContent(chapter.id, `<p>${latestText}</p>`, latestText.length)
      return { chapterId: chapter.id, html: `<p>${latestText}</p>`, plainText: latestText }
    }

    act(() => { void result.current.actions.handleRewrite() })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/rewrite', expect.objectContaining({ method: 'POST' })))
    const rewriteCall = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/rewrite' && init?.method === 'POST')
    const requestBody = JSON.parse(String(rewriteCall?.[1]?.body)) as { sourceText: string }

    expect(updateChapterContent.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder.at(-1) ?? 0)
    expect(requestBody.sourceText).toBe(latestText)
    await resolveDeferredResponse(createResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('queued') }))
  })

  it('ignores a delayed create after close and reopen', async () => {
    const restoreResponse = createDeferred<Response>()
    const createResponse = createDeferred<Response>()
    installRecoverableRewriteFetchMock({ restoreResponse, createResponse })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })
    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: null }))
    act(() => result.current.core.setSelectionText('Fresh selection'))
    await act(async () => { await result.current.actions.openActionMode('rewrite') })
    act(() => { void result.current.actions.handleRewrite() })
    act(() => result.current.core.closePanel())
    await act(async () => { await result.current.actions.openActionMode('rewrite') })

    await resolveDeferredResponse(createResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('queued') }))

    expect(result.current.core.activeMode).toBe('rewrite')
    expect(result.current.core.rewriteFlow.jobId).toBeNull()
    expect(result.current.core.rewriteFlow.loading).toBe(false)
  })

  it('lets only the newest concurrent create claim the panel', async () => {
    const restoreResponse = createDeferred<Response>()
    const olderCreate = createDeferred<Response>()
    const newerCreate = createDeferred<Response>()
    const fetchMock = installRecoverableRewriteFetchMock({ restoreResponse, createResponses: [olderCreate, newerCreate] })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })
    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: null }))
    act(() => result.current.core.setSelectionText('Fresh selection'))
    await act(async () => { await result.current.actions.openActionMode('rewrite') })
    act(() => { void result.current.actions.handleRewrite() })
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) => String(url) === '/api/rewrite' && (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1))
    act(() => { void result.current.actions.handleRewrite() })
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) => String(url) === '/api/rewrite' && (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(2))

    await resolveDeferredResponse(newerCreate, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('queued', { jobId: 'newer-job' }) }))
    await resolveDeferredResponse(olderCreate, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('queued', { jobId: 'older-job' }) }))

    expect(result.current.core.rewriteFlow.jobId).toBe('newer-job')
  })

  it('ignores an in-flight poll after close and reopen', async () => {
    const restoreResponse = createDeferred<Response>()
    const pollResponse = createDeferred<Response>()
    const poll = captureRewritePoll()
    installRecoverableRewriteFetchMock({ restoreResponse, pollResponses: [pollResponse] })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })
    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('running') }))
    await waitFor(() => expect(result.current.core.rewriteFlow.jobId).toBe('rewrite-job-1'))
    act(() => poll.runNext())
    act(() => result.current.core.closePanel())
    act(() => result.current.core.setSelectionText('Fresh selection'))
    await act(async () => { await result.current.actions.openActionMode('rewrite') })

    await resolveDeferredResponse(pollResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('succeeded') }))

    expect(result.current.core.rewriteFlow.jobId).toBeNull()
    expect(result.current.core.rewriteState.result).toBe('')
  })

  it('ignores a poll response with the wrong returned job ID', async () => {
    const restoreResponse = createDeferred<Response>()
    const pollResponse = createDeferred<Response>()
    const poll = captureRewritePoll()
    installRecoverableRewriteFetchMock({ restoreResponse, pollResponses: [pollResponse] })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })
    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('running') }))
    await waitFor(() => expect(result.current.core.rewriteFlow.jobId).toBe('rewrite-job-1'))
    act(() => poll.runNext())

    await resolveDeferredResponse(pollResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('succeeded', { jobId: 'wrong-job' }) }))

    expect(result.current.core.rewriteFlow.jobId).toBe('rewrite-job-1')
    expect(result.current.core.rewriteFlow.jobStatus).toBe('running')
    expect(poll.scheduledCount()).toBe(1)
  })

  it('continues polling after null, wrong-context, and recoverable error responses', async () => {
    const restoreResponse = createDeferred<Response>()
    const nullPollResponse = createDeferred<Response>()
    const wrongContextPollResponse = createDeferred<Response>()
    const errorPollResponse = createDeferred<Response>()
    const terminalPollResponse = createDeferred<Response>()
    const poll = captureRewritePoll()
    installRecoverableRewriteFetchMock({ restoreResponse, pollResponses: [nullPollResponse, wrongContextPollResponse, errorPollResponse, terminalPollResponse] })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })
    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('running') }))
    await waitFor(() => expect(poll.scheduledCount()).toBe(1))

    act(() => poll.runNext())
    await resolveDeferredResponse(nullPollResponse, jsonResponse({ ok: true, job: null }))
    expect(poll.scheduledCount()).toBe(1)

    const wrongContextJob = buildRecoverableRewriteJob('running')
    act(() => poll.runNext())
    await resolveDeferredResponse(wrongContextPollResponse, jsonResponse({ ok: true, job: { ...wrongContextJob, panel: { ...wrongContextJob.panel, chapterId: 'wrong-chapter' } } }))
    expect(poll.scheduledCount()).toBe(1)

    act(() => poll.runNext())
    await resolveDeferredResponse(errorPollResponse, jsonResponse({ ok: false, error: 'SENTINEL temporary poll SQL stack' }, 503))
    expect(result.current.core.rewriteFlow.error).toBe('Failed to refresh recoverable rewrite job')
    expect(result.current.core.rewriteFlow.error).not.toContain('SENTINEL')
    expect(result.current.core.rewriteFlow.jobStatus).toBe('running')
    expect(poll.scheduledCount()).toBe(1)

    act(() => poll.runNext())
    await resolveDeferredResponse(terminalPollResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('succeeded') }))
    expect(result.current.core.rewriteFlow.jobStatus).toBe('succeeded')
    expect(poll.scheduledCount()).toBe(0)
  })

  it('keeps prompt edits while a valid poll synchronizes status and result', async () => {
    const restoreResponse = createDeferred<Response>()
    const pollResponse = createDeferred<Response>()
    const poll = captureRewritePoll()
    installRecoverableRewriteFetchMock({ restoreResponse, pollResponses: [pollResponse] })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })
    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('running') }))
    await waitFor(() => expect(result.current.core.rewriteFlow.jobId).toBe('rewrite-job-1'))
    act(() => result.current.actions.handleRewritePromptChange('Edited while running'))
    act(() => poll.runNext())

    await resolveDeferredResponse(pollResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('succeeded') }))

    expect(result.current.core.rewritePrompt).toBe('Edited while running')
    expect(result.current.core.rewriteFlow.jobStatus).toBe('succeeded')
    expect(result.current.core.rewriteState.result).toBe('Recovered content')
  })

  it('keeps slow rewrite polling single-flight and schedules the next poll after settlement', async () => {
    const restoreResponse = createDeferred<Response>()
    const firstPollResponse = createDeferred<Response>()
    const secondPollResponse = createDeferred<Response>()
    const poll = captureRewritePoll()
    const fetchMock = installRecoverableRewriteFetchMock({ restoreResponse, pollResponses: [firstPollResponse, secondPollResponse] })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })
    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('running') }))
    await waitFor(() => expect(poll.scheduledCount()).toBe(1))

    act(() => poll.runNext())
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('jobId=rewrite-job-1'))).toHaveLength(1)
    expect(poll.scheduledCount()).toBe(0)
    expect(() => poll.runNext()).toThrow('Rewrite poll was not scheduled')
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('jobId=rewrite-job-1'))).toHaveLength(1)

    await resolveDeferredResponse(firstPollResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('running', { currentStep: 'Slow response applied' }) }))
    expect(result.current.core.rewriteFlow.jobCurrentStep).toBe('Slow response applied')
    expect(poll.scheduledCount()).toBe(1)

    act(() => poll.runNext())
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('jobId=rewrite-job-1'))).toHaveLength(2)
    await resolveDeferredResponse(secondPollResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('succeeded') }))
    expect(result.current.core.rewriteFlow.jobStatus).toBe('succeeded')
    expect(poll.scheduledCount()).toBe(0)
  })

  it('keeps rewrite polling single-flight across equivalent poll effect generations', async () => {
    const restoreResponse = createDeferred<Response>()
    const oldGenerationPollResponse = createDeferred<Response>()
    const currentGenerationPollResponse = createDeferred<Response>()
    const poll = captureRewritePoll()
    const fetchMock = installRecoverableRewriteFetchMock({ restoreResponse, pollResponses: [oldGenerationPollResponse, currentGenerationPollResponse] })
    const { result, rerender } = renderActionsHook({ currentNovelId: 'novel-1' })
    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('running') }))
    await waitFor(() => expect(poll.scheduledCount()).toBe(1))

    act(() => poll.runNext())
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('jobId=rewrite-job-1'))).toHaveLength(1)

    await act(async () => {
      rerender({ currentNovelId: 'novel-1', localChapters: [{ ...chapter }] })
      await Promise.resolve()
    })
    await waitFor(() => expect(poll.scheduledCount()).toBe(1))
    act(() => poll.runNext())
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('jobId=rewrite-job-1'))).toHaveLength(1)

    await resolveDeferredResponse(oldGenerationPollResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('running', { currentStep: 'Stale generation response' }) }))
    expect(result.current.core.rewriteFlow.jobCurrentStep).toBe('Stale generation response')
    await waitFor(() => expect(poll.scheduledCount()).toBe(1))

    act(() => poll.runNext())
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('jobId=rewrite-job-1'))).toHaveLength(2)
    await resolveDeferredResponse(currentGenerationPollResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('succeeded') }))
    expect(result.current.core.rewriteFlow.jobStatus).toBe('succeeded')
    expect(result.current.core.rewriteState.result).toBe('Recovered content')
  })

  it('ignores a delayed abort after close and reopen', async () => {
    const restoreResponse = createDeferred<Response>()
    const abortResponse = createDeferred<Response>()
    installRecoverableRewriteFetchMock({ restoreResponse, abortResponses: [abortResponse] })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })
    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('running') }))
    await waitFor(() => expect(result.current.core.rewriteFlow.jobId).toBe('rewrite-job-1'))
    act(() => { void result.current.actions.handleAbortRewriteGeneration() })
    act(() => result.current.core.closePanel())
    act(() => result.current.core.setSelectionText('Fresh selection'))
    await act(async () => { await result.current.actions.openActionMode('rewrite') })

    await resolveDeferredResponse(abortResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('succeeded') }))

    expect(result.current.core.rewriteFlow.jobId).toBeNull()
    expect(result.current.core.toast).toBe('')
  })

  it('ignores an abort response with the wrong returned job ID', async () => {
    const restoreResponse = createDeferred<Response>()
    const abortResponse = createDeferred<Response>()
    installRecoverableRewriteFetchMock({ restoreResponse, abortResponses: [abortResponse] })
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })
    await resolveDeferredResponse(restoreResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('running') }))
    await waitFor(() => expect(result.current.core.rewriteFlow.jobId).toBe('rewrite-job-1'))
    act(() => { void result.current.actions.handleAbortRewriteGeneration() })

    await resolveDeferredResponse(abortResponse, jsonResponse({ ok: true, job: buildRecoverableRewriteJob('succeeded', { jobId: 'wrong-job' }) }))

    expect(result.current.core.rewriteFlow.jobId).toBe('rewrite-job-1')
    expect(result.current.core.toast).toBe('')
  })

  it('invalidates ownership only when the context identity key changes', async () => {
    const restoreResponse = createDeferred<Response>()
    installRecoverableRewriteFetchMock({ restoreResponse })
    const { result, rerender } = renderActionsHook({ currentNovelId: 'novel-1' })
    const initialGeneration = result.current.core.rewritePanelOwnershipGenerationRef.current

    await act(async () => {
      rerender({ currentNovelId: 'novel-1', localChapters: [chapter] })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.core.rewritePanelOwnershipGenerationRef.current).toBe(initialGeneration)

    await act(async () => {
      rerender({ currentNovelId: 'novel-2', localChapters: [chapter] })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.core.rewritePanelOwnershipGenerationRef.current).toBe(initialGeneration + 1)
    expect(result.current.core.ownedRecoverableRewriteJobIdRef.current).toBeNull()
  })

  it('optimistically deletes the current novel and reconciles a null authoritative survivor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, branchNodes: [] })))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const deleteNovel = vi.fn()
    const deleteNovelFromBackend = vi.fn(async (novelId: string) => deletedNovelResult(novelId))
    const beginNovelDeletion = vi.fn((novelId: string) => ({ novelId, before: useNovelStore.getState().snapshotPersistedState(), optimistic: useNovelStore.getState().snapshotPersistedState(), summary: null }))
    const setNovelDeletionPending = vi.fn()
    const reconcileNovelDeletion = vi.fn()
    const { result } = renderActionsHook({ currentNovelId: 'novel-1', deleteNovel, deleteNovelFromBackend, beginNovelDeletion, setNovelDeletionPending, reconcileNovelDeletion })

    await act(async () => {
      await result.current.actions.handleDeleteNovel()
    })

    expect(beginNovelDeletion).toHaveBeenCalledWith('novel-1')
    expect(deleteNovel).not.toHaveBeenCalled()
    expect(deleteNovelFromBackend).toHaveBeenCalledWith('novel-1')
    expect(reconcileNovelDeletion).toHaveBeenCalledWith(null)
    expect(setNovelDeletionPending.mock.calls).toEqual([[true], [false]])
    expect(result.current.core.toast).toBe('library.deleted')
    expect(result.current.core.toastVariant).toBe('success')
  })

  it('uses targeted rollback without backend reload and retains the rejection toast', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, branchNodes: [] })))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const loadFromBackend = vi.fn(async () => undefined)
    const deleteNovel = vi.fn(useNovelStore.getState().deleteNovel)
    const deleteNovelFromBackend = vi.fn(async () => ({ status: 'rejected' as const, error: 'delete failed' }))
    const transaction = { novelId: 'novel-1', before: useNovelStore.getState().snapshotPersistedState(), optimistic: useNovelStore.getState().snapshotPersistedState(), summary: null }
    const beginNovelDeletion = vi.fn(() => transaction)
    const rollbackNovelDeletion = vi.fn()
    const setNovelDeletionPending = vi.fn()
    const { result } = renderActionsHook({ currentNovelId: 'novel-1', loadFromBackend, deleteNovel, deleteNovelFromBackend, beginNovelDeletion, rollbackNovelDeletion, setNovelDeletionPending })

    await act(async () => {
      await result.current.actions.handleDeleteNovel()
    })

    expect(deleteNovel).not.toHaveBeenCalled()
    expect(rollbackNovelDeletion).toHaveBeenCalledTimes(1)
    expect(rollbackNovelDeletion).toHaveBeenCalledWith(transaction)
    expect(loadFromBackend).not.toHaveBeenCalled()
    expect(setNovelDeletionPending.mock.calls).toEqual([[true], [false]])
    expect(result.current.core.toast).toBe('library.deleteFailed')
    expect(result.current.core.toastVariant).toBe('error')
  })

  it.each([
    { targetPresent: false, expectedToast: 'library.deleted' },
    { targetPresent: true, expectedToast: 'library.deleteFailedAuthoritative' },
  ])('reconciles indeterminate deletion with target present=$targetPresent before clearing pending', async ({ targetPresent, expectedToast }) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, branchNodes: [] })))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const reconciliation = createDeferred<'deleted' | 'present'>()
    const setNovelDeletionPending = vi.fn()
    const reconcileNovelDeletionFromBackend = vi.fn(() => reconciliation.promise)
    const transaction = {
      novelId: 'novel-1',
      before: useNovelStore.getState().snapshotPersistedState(),
      optimistic: useNovelStore.getState().snapshotPersistedState(),
      summary: null,
    }
    const { result } = renderActionsHook({
      currentNovelId: 'novel-1',
      deleteNovelFromBackend: vi.fn(async () => ({ status: 'indeterminate' as const, error: 'response lost' })),
      reconcileNovelDeletionFromBackend,
      beginNovelDeletion: vi.fn(() => transaction),
      setNovelDeletionPending,
    })

    let deletionPromise: Promise<void> | undefined
    act(() => {
      deletionPromise = result.current.actions.handleDeleteNovel()
    })

    await waitFor(() => expect(reconcileNovelDeletionFromBackend).toHaveBeenCalledWith(transaction))
    expect(setNovelDeletionPending.mock.calls).toEqual([[true]])

    await act(async () => {
      reconciliation.resolve(targetPresent ? 'present' : 'deleted')
      await deletionPromise
    })

    expect(result.current.core.toast).toBe(expectedToast)
    expect(result.current.core.toastVariant).toBe(targetPresent ? 'error' : 'success')
    expect(setNovelDeletionPending.mock.calls).toEqual([[true], [false]])
  })

  it('does not roll back blindly when indeterminate reconciliation fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, branchNodes: [] })))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const rollbackNovelDeletion = vi.fn()
    const setNovelDeletionPending = vi.fn()
    const { result } = renderActionsHook({
      currentNovelId: 'novel-1',
      deleteNovelFromBackend: vi.fn(async () => ({ status: 'indeterminate' as const, error: 'malformed success' })),
      reconcileNovelDeletionFromBackend: vi.fn().mockRejectedValue(new Error('workspace unavailable')),
      rollbackNovelDeletion,
      setNovelDeletionPending,
    })

    await act(async () => {
      await result.current.actions.handleDeleteNovel()
    })

    expect(rollbackNovelDeletion).not.toHaveBeenCalled()
    expect(result.current.core.toast).toBe('library.deleteReconcileFailed')
    expect(result.current.core.toastVariant).toBe('error')
    expect(setNovelDeletionPending.mock.calls).toEqual([[true], [false]])
  })

  it('guards duplicate deletion while a novel deletion is already pending', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, branchNodes: [] })))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const deleteNovelFromBackend = vi.fn(async (novelId: string) => deletedNovelResult(novelId))
    const { result } = renderActionsHook({ currentNovelId: 'novel-1', isNovelDeletionPending: true, deleteNovelFromBackend })

    await act(async () => {
      await result.current.actions.handleDeleteNovel()
    })

    expect(confirm).not.toHaveBeenCalled()
    expect(deleteNovelFromBackend).not.toHaveBeenCalled()
  })

  it('saves settings before refreshing the exact current projection and closes after both succeed', async () => {
    installIdleWorkspaceFetchMock()
    const saveDeferred = createDeferred<void>()
    const refreshDeferred = createDeferred<KnowledgeProjectionResult>()
    const saveAISettings = vi.fn(() => saveDeferred.promise)
    const refreshKnowledgeProjection = vi.fn(() => refreshDeferred.promise)
    const missingOverview = buildKnowledgeStatusOverview({
      embeddingCache: {
        status: 'missing',
        coveredChapterCount: 0,
        totalChapterCount: 1,
        validThroughChapterNo: null,
        provider: null,
        model: null,
      },
    })
    const { result } = renderActionsHook({
      backendLoaded: false,
      currentNovelId: 'novel-1',
      saveAISettings,
      refreshKnowledgeProjection,
    })

    act(() => result.current.core.setSettingsOpen(true))
    let savePromise: Promise<void> | undefined
    act(() => {
      savePromise = result.current.actions.saveSettings()
    })

    expect(saveAISettings).toHaveBeenCalledTimes(1)
    expect(refreshKnowledgeProjection).not.toHaveBeenCalled()
    expect(result.current.core.settingsOpen).toBe(true)

    await act(async () => {
      saveDeferred.resolve(undefined)
      await saveDeferred.promise
    })

    await waitFor(() => {
      expect(refreshKnowledgeProjection).toHaveBeenCalledWith('novel-1', 1, expect.any(AbortSignal))
    })
    expect(result.current.core.settingsOpen).toBe(true)

    await act(async () => {
      refreshDeferred.resolve(buildKnowledgeProjectionResult(missingOverview))
      await savePromise
    })

    expect(result.current.core.knowledgeStatusOverview).toEqual(missingOverview)
    expect(result.current.core.settingsOpen).toBe(false)
  })

  it('saves settings and closes without refreshing when no novel is selected', async () => {
    const saveAISettings = vi.fn().mockResolvedValue(undefined)
    const refreshKnowledgeProjection = vi.fn().mockResolvedValue(buildKnowledgeProjectionResult(null))
    const { result } = renderActionsHook({
      backendLoaded: false,
      currentNovelId: '',
      saveAISettings,
      refreshKnowledgeProjection,
    })

    act(() => result.current.core.setSettingsOpen(true))

    await act(async () => {
      await result.current.actions.saveSettings()
    })

    expect(saveAISettings).toHaveBeenCalledTimes(1)
    expect(refreshKnowledgeProjection).not.toHaveBeenCalled()
    expect(result.current.core.settingsOpen).toBe(false)
  })

  it('rejects an older settings projection after a newer refresh applies', async () => {
    installIdleWorkspaceFetchMock()
    const olderRefresh = createDeferred<KnowledgeProjectionResult>()
    const currentRefresh = createDeferred<KnowledgeProjectionResult>()
    const refreshKnowledgeProjection = vi.fn()
      .mockImplementationOnce(() => olderRefresh.promise)
      .mockImplementationOnce(() => currentRefresh.promise)
    const currentOverview = buildKnowledgeStatusOverview({
      embeddingCache: {
        status: 'missing',
        coveredChapterCount: 0,
        totalChapterCount: 1,
        validThroughChapterNo: null,
        provider: null,
        model: null,
      },
    })
    const staleOverview = buildKnowledgeStatusOverview()
    const { result } = renderActionsHook({
      backendLoaded: false,
      currentNovelId: 'novel-1',
      saveAISettings: vi.fn().mockResolvedValue(undefined),
      refreshKnowledgeProjection,
    })

    let olderSavePromise: Promise<void> | undefined
    let currentSavePromise: Promise<void> | undefined
    act(() => {
      olderSavePromise = result.current.actions.saveSettings()
    })
    await waitFor(() => expect(refreshKnowledgeProjection).toHaveBeenCalledTimes(1))
    act(() => {
      currentSavePromise = result.current.actions.saveSettings()
    })
    await waitFor(() => expect(refreshKnowledgeProjection).toHaveBeenCalledTimes(2))
    expect(refreshKnowledgeProjection.mock.calls).toEqual([
      ['novel-1', 1, expect.any(AbortSignal)],
      ['novel-1', 1, expect.any(AbortSignal)],
    ])

    await act(async () => {
      currentRefresh.resolve(buildKnowledgeProjectionResult(currentOverview))
      await currentSavePromise
    })
    expect(result.current.core.knowledgeStatusOverview).toEqual(currentOverview)

    await act(async () => {
      olderRefresh.resolve(buildKnowledgeProjectionResult(staleOverview))
      await olderSavePromise
    })
    expect(result.current.core.knowledgeStatusOverview).toEqual(currentOverview)
  })

  it('keeps settings open and skips projection refresh when saving fails', async () => {
    installIdleWorkspaceFetchMock()
    const saveError = new Error('settings save failed')
    const refreshKnowledgeProjection = vi.fn().mockResolvedValue(buildKnowledgeProjectionResult(null))
    const { result } = renderActionsHook({
      backendLoaded: false,
      currentNovelId: 'novel-1',
      saveAISettings: vi.fn().mockRejectedValue(saveError),
      refreshKnowledgeProjection,
    })

    act(() => result.current.core.setSettingsOpen(true))

    await act(async () => {
      await expect(result.current.actions.saveSettings()).rejects.toBe(saveError)
    })

    expect(refreshKnowledgeProjection).not.toHaveBeenCalled()
    expect(result.current.core.settingsOpen).toBe(true)
  })

  it('blocks rapid duplicate What-if creation for the full request lifecycle', async () => {
    const createResponse = createDeferred<Response>()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.startsWith('/api/knowledge-view?')) {
        return Promise.resolve(jsonResponse({ ok: true, knowledgeRebuildStatus: null, hanlpCacheSnapshot: null, knowledgeStatusOverview: null }))
      }
      if (url.startsWith('/api/story-timeline?')) {
        return Promise.resolve(jsonResponse({ novelId: 'novel-1', branchId: 'novel-1:main', chapters: [], branchNodes: [], edges: [] }))
      }
      if (url === '/api/what-if/sessions' && method === 'POST') {
        return createResponse.promise
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderActionsHook({ currentNovelId: 'novel-1' })
  
    act(() => {
      result.current.core.setSelectionText('Selected source')
      result.current.core.setRewriteFlow((current) => ({
        ...current,
        candidates: [{ title: 'Candidate', summary: 'Summary', content: 'Generated branch' }],
      }))
    })
  
    let firstRequest: Promise<void> | undefined
    let secondRequest: Promise<void> | undefined
    act(() => {
      firstRequest = result.current.actions.handleCreateWhatIf()
      secondRequest = result.current.actions.handleCreateWhatIf()
    })
  
    expect(result.current.core.saveContinueBlockPending).toBe(true)
    expect(fetchMock.mock.calls.filter(([url, init]) => (
      String(url) === '/api/what-if/sessions'
      && (init as RequestInit | undefined)?.method === 'POST'
    ))).toHaveLength(1)
  
    await act(async () => {
      createResponse.resolve(jsonResponse({
        sessionId: 'what-if-1',
        timelineNodeId: 'what-if-node-1',
        title: 'What-if branch',
      }))
      await Promise.all([firstRequest, secondRequest])
    })
  
    expect(result.current.core.saveContinueBlockPending).toBe(false)
  })
  
  it('keeps settings open when the post-save projection refresh fails', async () => { installIdleWorkspaceFetchMock()
  const refreshError = new Error('projection refresh failed')
  const { result } = renderActionsHook({
    backendLoaded: false,
    currentNovelId: 'novel-1',
    saveAISettings: vi.fn().mockResolvedValue(undefined),
    refreshKnowledgeProjection: vi.fn().mockRejectedValue(refreshError),
  })
  
  act(() => result.current.core.setSettingsOpen(true))
  
  await act(async () => {
    await expect(result.current.actions.saveSettings()).rejects.toBe(refreshError)
  })
  
  expect(result.current.core.settingsOpen).toBe(true) })
})
