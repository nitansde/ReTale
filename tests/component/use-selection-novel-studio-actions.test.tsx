// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSelectionNovelStudioActions } from '@/components/workspace/use-selection-novel-studio-actions'
import { useSelectionNovelStudioCore } from '@/components/workspace/use-selection-novel-studio-core'
import type { Chapter } from '@/lib/types'

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
  let resolvePromise = (_value: T) => undefined
  let rejectPromise = (_reason: unknown) => undefined
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

function renderActionsHook() {
  const coreParams: Parameters<typeof useSelectionNovelStudioCore>[0] = {
    loadFromBackend: vi.fn().mockResolvedValue(undefined),
    saveToBackend: vi.fn().mockResolvedValue(undefined),
    backendLoaded: true,
    currentNovelId: '',
    localNovels: [],
    localVolumes: [],
    localChapters: [chapter],
    currentChapterId: chapter.id,
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
  }

  return renderHook(() => {
    const core = useSelectionNovelStudioCore(coreParams)
    const actions = useSelectionNovelStudioActions({
      core,
      viewModel: {
        activeWorkspaceSelection: { kind: 'chapter', chapterId: chapter.id, chapterNo: chapter.order },
        selectedTimelineNode: null,
        selectedContinueBlockNode: null,
        selectedContinueBlockFutureMapLaunch: null,
        selectedTimelineDisplayLabel: '',
        selectedTimelineInstructionPreview: '',
      },
      loadFromBackend: coreParams.loadFromBackend,
      saveToBackend: coreParams.saveToBackend,
      localChapters: [chapter],
      deleteChapter: vi.fn(),
      deleteNovel: vi.fn(),
      saveAISettings: vi.fn().mockResolvedValue(undefined),
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
  })
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

describe('useSelectionNovelStudioActions model discovery', () => {
  afterEach(() => {
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
})
