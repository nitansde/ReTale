import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import type {
  PresetCompatLibrary,
  PresetCompatPresetRecord,
  PresetCompatRegexRecord,
} from '@/lib/preset-compat/types'
import { useNovelStore } from '@/store/novel-store'
import { resetClientRequestBrokerForTests } from '@/lib/client-request-broker'

function createPreset(id: string, overrides: Partial<PresetCompatPresetRecord> = {}): PresetCompatPresetRecord {
  return {
    id,
    name: `Preset ${id}`,
    sourceApiId: 'openai',
    promptRules: [
      {
        id: `${id}-prompt-1`,
        name: 'Prompt 1',
        role: 'system',
        content: 'Stay consistent.',
        enabled: true,
        marker: false,
        injectAsSystemPrompt: true,
        injectionPosition: 'before',
        injectionDepth: null,
        injectionOrder: 0,
        injectionTrigger: [],
        forbidOverrides: false,
        condition: null,
        passthrough: {},
      },
    ],
    promptOrderLists: {
      rewrite: [`${id}-prompt-1`],
    },
    embeddedRegexes: [],
    attachedStandaloneRegexIds: [],
    runtimeSampler: {
      temperature: 1,
      topP: 1,
      topK: null,
      topA: null,
      minP: null,
      presencePenalty: null,
      frequencyPenalty: null,
      repetitionPenalty: null,
      openaiMaxContext: null,
      maxTokens: null,
      seed: null,
      candidateCount: null,
    },
    promptTemplate: {
      namesBehavior: null,
      sendIfEmpty: null,
      impersonationPrompt: null,
      newChatPrompt: null,
      newGroupChatPrompt: null,
      newExampleChatPrompt: null,
      continueNudgePrompt: null,
      wiFormat: null,
      scenarioFormat: null,
      personalityFormat: null,
      groupNudgePrompt: null,
      assistantPrefill: null,
      assistantImpersonation: null,
      continuePostfix: null,
      legacyMainPrompt: null,
      legacyNsfwPrompt: null,
      legacyJailbreakPrompt: null,
    },
    transport: {
      maxContextUnlocked: null,
      streamOpenAI: null,
      useSysprompt: null,
      squashSystemMessages: null,
      mediaInlining: null,
      inlineImageQuality: null,
      continuePrefill: null,
      functionCalling: null,
      showThoughts: null,
      reasoningEffort: null,
      verbosity: null,
      enableWebSearch: null,
      requestImages: null,
      requestImageAspectRatio: null,
      requestImageResolution: null,
    },
    preservedFields: {
      biasPresetSelected: null,
    },
    passthrough: {
      root: {},
      extensions: {},
      unknownPromptFields: {},
    },
    importWarnings: [],
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
    ...overrides,
  }
}

function createRegex(id: string, overrides: Partial<PresetCompatRegexRecord> = {}): PresetCompatRegexRecord {
  return {
    id,
    name: `Regex ${id}`,
    pattern: 'foo',
    replacement: 'bar',
    flags: 'g',
    disabled: false,
    placements: ['assistant_output'],
    trimStrings: [],
    promptOnly: false,
    markdownOnly: false,
    minDepth: null,
    maxDepth: null,
    substituteRegex: null,
    runOnEdit: false,
    passthrough: {},
    ...overrides,
  }
}

function createLibrary(overrides: Partial<PresetCompatLibrary> = {}): PresetCompatLibrary {
  const library = createDefaultPresetCompatLibrary()
  return {
    ...library,
    presets: {
      'preset-1': createPreset('preset-1'),
    },
    standaloneRegexes: {
      'regex-1': createRegex('regex-1'),
    },
    ...overrides,
  }
}

function resetStore() {
  useNovelStore.getState().resetWorkspace()
  useNovelStore.setState({
    isHydrated: false,
    isSaving: false,
    isNovelDeletionPending: false,
    backendLoaded: false,
    backendLoadError: '',
    workspaceRevision: null,
    revisionNovelId: '',
    lastAcknowledgedPersistedWorkspace: null,
    librarySummaries: [],
    librarySummariesLoaded: false,
    librarySummariesError: '',
    presetCompatLibrary: createDefaultPresetCompatLibrary(),
    presetCompatLibraryLoading: false,
    presetCompatLibraryError: '',
  })
}

function createWorkspacePayload(novelId = 'novel-survivor') {
  const chapterId = `${novelId}-chapter`
  return {
    ...useNovelStore.getState().snapshotPersistedState(),
    currentNovelId: novelId,
    currentChapterId: chapterId,
    localNovels: [{ id: novelId, title: 'Authoritative novel', summary: '', tags: [] }],
    localChapters: [{
      id: chapterId,
      novelId,
      title: 'Chapter',
      order: 1,
      content: '<p>Authoritative</p>',
      status: 'draft' as const,
      wordCount: 1,
      updatedAt: 'now',
    }],
    workspaceRevision: 3,
    revisionNovelId: novelId,
  }
}

describe('preset compat store lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetClientRequestBrokerForTests()
    resetStore()
  })

  afterEach(() => {
    resetClientRequestBrokerForTests()
    vi.useRealTimers()
  })

  it('loads compact library summaries without hydrating chapter bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/novels') {
        return new Response(JSON.stringify({
          ok: true,
          novels: [{
            id: 'novel-1',
            title: 'Compact Novel',
            summary: 'Metadata only',
            tags: ['fast'],
            updatedAt: 'now',
            wordCount: 42,
            chapterCount: 3,
            firstChapterId: 'chapter-1',
          }],
        }), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await useNovelStore.getState().loadLibrarySummaries()

    const state = useNovelStore.getState()
    expect(state.librarySummariesLoaded).toBe(true)
    expect(state.librarySummariesError).toBe('')
    expect(state.getNovels()).toEqual([expect.objectContaining({
      id: 'novel-1',
      chapterCount: 3,
      firstChapterId: 'chapter-1',
    })])
    expect(state.localChapters).toEqual([])
    expect(state.backendLoaded).toBe(false)
  })

  it('opens the first novel resource when a browser has no prior local selection', async () => {
    const requests: string[] = []
    useNovelStore.setState({ currentNovelId: '', currentChapterId: '' })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/novels') {
        return Response.json({
          ok: true,
          novels: [{
            id: 'novel-first',
            title: 'First novel',
            summary: '',
            tags: [],
            updatedAt: 'now',
            wordCount: 1,
            chapterCount: 1,
            firstChapterId: 'novel-first-chapter',
          }],
        })
      }
      if (url === '/api/novels/novel-first') {
        return Response.json(createWorkspacePayload('novel-first'))
      }
      if (url === '/api/settings/ai') return Response.json({})
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await useNovelStore.getState().loadFromBackend()

    expect(requests.slice(0, 2)).toEqual(['/api/novels', '/api/novels/novel-first'])
    expect(useNovelStore.getState()).toMatchObject({
      currentNovelId: 'novel-first',
      currentChapterId: 'novel-first-chapter',
      backendLoaded: true,
      backendLoadError: '',
    })
  })

  it('begins and rolls back deletion for a summary-only library card', () => {
    const summary = {
      id: 'novel-summary-only',
      title: 'Summary-only novel',
      summary: 'Metadata only',
      tags: ['compact'],
      updatedAt: 'now',
      wordCount: 42,
      chapterCount: 3,
      firstChapterId: 'chapter-1',
    }
    useNovelStore.setState({
      currentNovelId: summary.id,
      localNovels: [],
      localChapters: [],
      librarySummaries: [summary],
      librarySummariesLoaded: true,
    })

    const transaction = useNovelStore.getState().beginNovelDeletion(summary.id)

    expect(transaction).toMatchObject({ novelId: summary.id, summary })
    expect(useNovelStore.getState().librarySummaries).toEqual([])

    useNovelStore.getState().rollbackNovelDeletion(transaction!)

    expect(useNovelStore.getState().librarySummaries).toEqual([summary])
  })

  it('restores a summary-only card during authoritative present reconciliation without a summary refresh', async () => {
    const summary = {
      id: 'novel-summary-only',
      title: 'Captured summary',
      summary: 'Metadata only',
      tags: ['compact'],
      updatedAt: 'captured',
      wordCount: 42,
      chapterCount: 3,
      firstChapterId: 'chapter-captured',
    }
    const unrelatedSummary = { ...summary, id: 'novel-unrelated', title: 'Unrelated' }
    useNovelStore.setState({
      currentNovelId: summary.id,
      localNovels: [],
      localChapters: [],
      librarySummaries: [summary, unrelatedSummary],
      librarySummariesLoaded: true,
    })
    const transaction = useNovelStore.getState().beginNovelDeletion(summary.id)
    expect(transaction).not.toBeNull()

    const authoritative = createWorkspacePayload(summary.id)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/novels/novel-summary-only?deletionStatus=1') {
        return new Response(JSON.stringify({ ok: true, novelId: summary.id, deletionState: 'ready' }), { status: 200 })
      }
      if (url === '/api/novels/novel-summary-only') {
        return new Response(JSON.stringify(authoritative), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await expect(useNovelStore.getState().reconcileNovelDeletionFromBackend(transaction!)).resolves.toBe('present')

    const summaries = useNovelStore.getState().librarySummaries
    expect(summaries.filter((item) => item.id === summary.id)).toHaveLength(1)
    expect(summaries.find((item) => item.id === summary.id)).toMatchObject({
      title: 'Authoritative novel',
      firstChapterId: `${summary.id}-chapter`,
    })
    expect(summaries).toContainEqual(unrelatedSummary)
  })

  it('restores only the captured summary when reconciliation throws and rethrows the original error', async () => {
    const summary = {
      id: 'novel-summary-only',
      title: 'Captured summary',
      summary: 'Metadata only',
      tags: ['compact'],
      updatedAt: 'captured',
      wordCount: 42,
      chapterCount: 3,
      firstChapterId: 'chapter-captured',
    }
    const unrelatedSummary = { ...summary, id: 'novel-unrelated', title: 'Unrelated' }
    useNovelStore.setState({
      currentNovelId: summary.id,
      localNovels: [],
      localChapters: [],
      librarySummaries: [summary, unrelatedSummary],
      librarySummariesLoaded: true,
    })
    const transaction = useNovelStore.getState().beginNovelDeletion(summary.id)
    expect(transaction).not.toBeNull()
    useNovelStore.setState({
      currentNovelId: 'novel-post-optimistic',
      localNovels: [{ id: 'novel-post-optimistic', title: 'Post optimistic', summary: '', tags: [] }],
    })
    const optimisticWorkspace = useNovelStore.getState().snapshotPersistedState()
    const originalError = new Error('status unavailable')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(originalError))

    const reconciliationError = await useNovelStore.getState().reconcileNovelDeletionFromBackend(transaction!).then(
      () => null,
      (error: unknown) => error
    )

    expect(reconciliationError).toBe(originalError)
    expect(useNovelStore.getState().snapshotPersistedState()).toEqual(optimisticWorkspace)
    expect(useNovelStore.getState().librarySummaries).toEqual([unrelatedSummary, summary])
  })

  it('rejects malformed compact library summaries without accepting partial data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      novels: [{
        id: 'novel-1',
        title: 'Invalid Novel',
        summary: '',
        tags: [],
        updatedAt: '',
        wordCount: 10,
        chapterCount: 1,
        firstChapterId: 'chapter-1',
        content: '<p>body must not appear here</p>',
      }],
    }), { status: 200 })))

    await expect(useNovelStore.getState().loadLibrarySummaries()).rejects.toThrow(
      'Library summary endpoint returned an invalid response'
    )

    const state = useNovelStore.getState()
    expect(state.librarySummariesLoaded).toBe(true)
    expect(state.librarySummaries).toEqual([])
    expect(state.librarySummariesError).toBe('Library summary endpoint returned an invalid response')
  })

  it('defers the global library during backend load and keeps workspace export/import isolated', async () => {
    const workspacePayload = {
      ...useNovelStore.getState().snapshotPersistedState(),
      currentNovelId: 'novel-1',
      currentChapterId: 'chapter-1',
      localNovels: [{ id: 'novel-1', title: 'Novel', summary: 'Summary', tags: [] }],
      localChapters: [{
        id: 'chapter-1',
        novelId: 'novel-1',
        title: 'Chapter 1',
        order: 1,
        content: '<p>Body</p>',
        originalContent: '<p>Body</p>',
        status: 'draft',
        wordCount: 1,
        updatedAt: 'now',
        trajectory: [],
      }],
    }
    const presetCompatLibrary = createLibrary({ revision: 3 })
    useNovelStore.setState({ currentNovelId: 'novel-1' })

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/novels/novel-1') {
        return new Response(JSON.stringify({
          ...workspacePayload,
          workspaceRevision: 3,
          revisionNovelId: 'novel-1',
        }), { status: 200 })
      }
      if (url === '/api/settings/ai') {
        return new Response(JSON.stringify({ provider: 'openai-compatible', model: 'gpt-4.1-mini' }), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await useNovelStore.getState().loadFromBackend()

    const state = useNovelStore.getState()
    expect(state.presetCompatLibrary.revision).not.toBe(3)
    expect(state.presetCompatLibraryLoading).toBe(false)
    expect(state.presetCompatLibraryError).toBe('')

    const exportedWorkspace = JSON.parse(state.exportWorkspace()) as Record<string, unknown>
    expect(exportedWorkspace).not.toHaveProperty('presetCompatLibrary')
    expect(exportedWorkspace).not.toHaveProperty('presetCompatLibraryLoading')
    expect(exportedWorkspace).not.toHaveProperty('presetCompatLibraryError')

    state.importWorkspace({ currentNovelId: 'novel-2' })
    expect(useNovelStore.getState().presetCompatLibrary.revision).not.toBe(3)
  })

  it('fails open when the initial workspace restore request stalls', async () => {
    vi.useFakeTimers()
    useNovelStore.setState({ currentNovelId: 'novel-a' })

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url !== '/api/novels/novel-a') {
        throw new Error(`Unexpected fetch: ${url}`)
      }

      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('Aborted')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    }))

    const restore = useNovelStore.getState().loadFromBackend()
    await vi.advanceTimersByTimeAsync(15_000)
    await restore

    const state = useNovelStore.getState()
    expect(state.backendLoaded).toBe(true)
    expect(state.isHydrated).toBe(true)
    expect(state.presetCompatLibraryLoading).toBe(false)
    expect(state.backendLoadError).toBe('Workspace restore timed out')
  })

  it('resolves workspace restore without waiting for a stalled AI settings request', async () => {
    const workspacePayload = createWorkspacePayload('novel-a')
    const settingsRequest = Promise.withResolvers<Response>()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/novels/novel-a') {
        return Promise.resolve(new Response(JSON.stringify(workspacePayload), { status: 200 }))
      }
      if (url === '/api/settings/ai') return settingsRequest.promise
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await useNovelStore.getState().loadFromBackend('novel-a')

    expect(useNovelStore.getState()).toMatchObject({
      currentNovelId: 'novel-a',
      backendLoaded: true,
      backendLoadError: '',
    })
    settingsRequest.resolve(new Response(JSON.stringify({}), { status: 200 }))
    await settingsRequest.promise
  })

  it('records and rejects a targeted workspace restore failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/novels/novel-a') {
        return new Response(JSON.stringify({ error: 'Targeted restore failed' }), { status: 500 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await expect(useNovelStore.getState().loadFromBackend('novel-a')).rejects.toThrow('Targeted restore failed')

    const state = useNovelStore.getState()
    expect(state.backendLoaded).toBe(true)
    expect(state.isHydrated).toBe(true)
    expect(state.backendLoadError).toBe('Targeted restore failed')
  })

  it('shares a StrictMode-style duplicate restore and prevents an older novel response from overwriting a newer restore', async () => {
    const pending = new Map<string, { resolve: (response: Response) => void; signal?: AbortSignal }>()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/settings/ai') return Promise.resolve(new Response(JSON.stringify({})))
      return new Promise<Response>((resolve) => {
        pending.set(url, { resolve, signal: init?.signal ?? undefined })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const duplicateOne = useNovelStore.getState().loadFromBackend('novel-a')
    const duplicateTwo = useNovelStore.getState().loadFromBackend('novel-a')
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/novels/novel-a')).toHaveLength(1)

    const newer = useNovelStore.getState().loadFromBackend('novel-b')
    await vi.waitFor(() => {
      expect(pending.get('/api/novels/novel-a')?.signal?.aborted).toBe(true)
    })
    pending.get('/api/novels/novel-b')?.resolve(new Response(JSON.stringify(createWorkspacePayload('novel-b'))))
    await newer
    expect(useNovelStore.getState().currentNovelId).toBe('novel-b')

    pending.get('/api/novels/novel-a')?.resolve(new Response(JSON.stringify(createWorkspacePayload('novel-a'))))
    await Promise.all([duplicateOne, duplicateTwo])
    expect(useNovelStore.getState().currentNovelId).toBe('novel-b')
  })

  it('does not issue a store-owned status-only knowledge request during loadFromBackend', async () => {
    const workspacePayload = {
      ...useNovelStore.getState().snapshotPersistedState(),
      currentNovelId: 'novel-1',
      currentChapterId: 'chapter-1',
      localNovels: [{ id: 'novel-1', title: 'Novel', summary: 'Summary', tags: [] }],
      localChapters: [{
        id: 'chapter-1',
        novelId: 'novel-1',
        title: 'Chapter 1',
        order: 1,
        content: '<p>Body</p>',
        originalContent: '<p>Body</p>',
        status: 'draft',
        wordCount: 1,
        updatedAt: 'now',
        trajectory: [],
      }],
    }
    useNovelStore.setState({ currentNovelId: 'novel-1' })

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/novels/novel-1') {
        return new Response(JSON.stringify({
          ...workspacePayload,
          workspaceRevision: 3,
          revisionNovelId: 'novel-1',
        }), { status: 200 })
      }
      if (url === '/api/settings/ai') {
        return new Response(JSON.stringify({ provider: 'openai-compatible', model: 'gpt-4.1-mini' }), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await useNovelStore.getState().loadFromBackend()

    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/knowledge-view'), expect.anything())
  })

  it('loads, saves, imports, binds, edits, and exports through the dedicated preset compat slice', async () => {
    const savedLibrary = createLibrary({
      revision: 3,
      presets: {
        'preset-1': createPreset('preset-1', {
          embeddedRegexes: [createRegex('embedded-1')],
        }),
      },
      standaloneRegexes: {
        'regex-1': createRegex('regex-1'),
        'regex-2': createRegex('regex-2', { name: 'Regex 2' }),
      },
    })
    const importedLibrary = createLibrary({
      revision: 4,
      presets: {
        ...savedLibrary.presets,
        'preset-2': createPreset('preset-2', { name: 'Imported preset' }),
      },
      standaloneRegexes: {
        ...savedLibrary.standaloneRegexes,
        'regex-3': createRegex('regex-3', { name: 'Imported regex' }),
      },
    })

    useNovelStore.setState({
      presetCompatLibrary: createLibrary({ revision: 2 }),
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/settings/preset-compat' && !init?.method) {
        return new Response(JSON.stringify(savedLibrary), { status: 200 })
      }
      if (url === '/api/settings/preset-compat' && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true, library: savedLibrary }), { status: 200 })
      }
      if (url === '/api/settings/preset-compat/import') {
        const body = JSON.parse(String(init?.body)) as { kind: 'preset' | 'regex' }
        if (body.kind === 'preset') {
          return new Response(JSON.stringify({ ok: true, library: importedLibrary, importedIds: ['preset-2'], warnings: ['preset warning'] }), { status: 200 })
        }
        return new Response(JSON.stringify({ ok: true, library: importedLibrary, importedIds: ['regex-3'], warnings: ['regex warning'] }), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await useNovelStore.getState().loadPresetCompatLibrary()
    expect(useNovelStore.getState().presetCompatLibrary.revision).toBe(3)
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/preset-compat', expect.objectContaining({ cache: 'no-cache' }))

    await useNovelStore.getState().savePresetCompatLibrary()
    expect(useNovelStore.getState().presetCompatLibrary.revision).toBe(3)
    expect(fetchMock.mock.calls.find(([input, init]) => String(input) === '/api/settings/preset-compat' && init?.method === 'POST')?.[1]?.cache).toBeUndefined()

    await expect(useNovelStore.getState().importPresetCompatPreset({ jsonText: '{"name":"preset"}' })).resolves.toEqual({
      importedIds: ['preset-2'],
      warnings: ['preset warning'],
    })
    await expect(useNovelStore.getState().importPresetCompatRegexBundle({ jsonText: '[]' })).resolves.toEqual({
      importedIds: ['regex-3'],
      warnings: ['regex warning'],
    })
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/settings/preset-compat/import').every(([, init]) => init?.cache === undefined)).toBe(true)

    useNovelStore.getState().bindPresetCompatPresetToSurface('rewrite', 'preset-2')
    useNovelStore.getState().attachPresetCompatStandaloneRegex('preset-2', 'regex-3')
    useNovelStore.getState().updatePresetCompatPromptRule('preset-2', 'preset-2-prompt-1', { content: 'Updated prompt' })
    useNovelStore.getState().updatePresetCompatRuntimeSampler('preset-2', {
      openaiMaxContext: 32768,
      maxTokens: 4096,
      temperature: 0.45,
      frequencyPenalty: 0.25,
      presencePenalty: 0.15,
      topP: 0.8,
    })
    useNovelStore.getState().updatePresetCompatTransport('preset-2', { streamOpenAI: true })
    useNovelStore.getState().updatePresetCompatBuiltinSystemPrompt('rewrite', {
      enabled: false,
      content: 'Edited ReTale built-in prompt',
    })
    useNovelStore.getState().updatePresetCompatStandaloneRegex('regex-3', { replacement: 'updated replacement' })
    useNovelStore.getState().detachPresetCompatStandaloneRegex('preset-2', 'regex-3')

    const state = useNovelStore.getState()
    expect(state.presetCompatLibrary.surfaceBindings.rewrite.presetId).toBe('preset-2')
    expect(state.presetCompatLibrary.presets['preset-2']?.promptRules[0]?.content).toBe('Updated prompt')
    expect(state.presetCompatLibrary.presets['preset-2']?.runtimeSampler.openaiMaxContext).toBe(32768)
    expect(state.presetCompatLibrary.presets['preset-2']?.runtimeSampler.maxTokens).toBe(4096)
    expect(state.presetCompatLibrary.presets['preset-2']?.runtimeSampler.temperature).toBe(0.45)
    expect(state.presetCompatLibrary.presets['preset-2']?.runtimeSampler.frequencyPenalty).toBe(0.25)
    expect(state.presetCompatLibrary.presets['preset-2']?.runtimeSampler.presencePenalty).toBe(0.15)
    expect(state.presetCompatLibrary.presets['preset-2']?.runtimeSampler.topP).toBe(0.8)
    expect(state.presetCompatLibrary.presets['preset-2']?.transport.streamOpenAI).toBe(true)
    expect(state.presetCompatLibrary.builtinSystemPrompts.rewrite).toMatchObject({
      enabled: false,
      content: 'Edited ReTale built-in prompt',
    })
    expect(state.presetCompatLibrary.presets['preset-2']?.attachedStandaloneRegexIds).toEqual([])
    expect(state.presetCompatLibrary.standaloneRegexes['regex-3']?.replacement).toBe('updated replacement')

    const exportedPreset = state.exportPresetCompatPreset('preset-2')
    const exportedRegexBundle = state.exportPresetCompatStandaloneRegexBundle(['regex-3'])
    expect(exportedPreset).toContain('Updated prompt')
    expect(exportedPreset).toContain('32768')
    expect(exportedPreset).toContain('4096')
    expect(exportedPreset).toContain('0.45')
    expect(exportedPreset).toContain('0.8')
    expect(exportedPreset).toContain('true')
    expect(exportedPreset).not.toContain('Edited ReTale built-in prompt')
    expect(exportedRegexBundle).toContain('regex_scripts')
  })

  it('keeps workspace autosave isolated from the global preset-compatible library payload', async () => {
    const initialLibrary = createLibrary({ revision: 5 })
    const requestBodies: Array<{ url: string; body: unknown }> = []

    useNovelStore.getState().restorePersistedState(createWorkspacePayload('novel-1'))
    useNovelStore.setState({
      presetCompatLibrary: initialLibrary,
      backendLoaded: true,
      backendLoadError: '',
      workspaceRevision: 1,
      revisionNovelId: 'novel-1',
      lastAcknowledgedPersistedWorkspace: createWorkspacePayload('novel-1'),
    })
    useNovelStore.getState().createNewChapter()

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/novels/novel-1' && init?.method === 'POST') {
        requestBodies.push({
          url,
          body: JSON.parse(String(init.body)),
        })
        return new Response(JSON.stringify({ ok: true, novelId: 'novel-1', revision: 2 }), { status: 200, headers: { 'X-Retale-Workspace-Revision': '2', 'X-Retale-Revision-Novel-Id': 'novel-1' } })
      }
      if (url === '/api/knowledge-view') {
        return new Response(JSON.stringify({
          ok: true,
          localOutlines: [],
          localCharacters: [],
          localCharacterRelations: [],
          localWorldEntries: [],
          localTimelineEvents: [],
          knowledgeRebuildStatus: null,
          jobOutcome: null,
        }), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await useNovelStore.getState().saveToBackend()

    expect(requestBodies).toHaveLength(1)
    expect(requestBodies[0]?.url).toBe('/api/novels/novel-1')
    expect(requestBodies[0]?.body).not.toHaveProperty('presetCompatLibrary')
    expect(useNovelStore.getState().presetCompatLibrary.revision).toBe(5)
  })

  it('surfaces failed workspace saves and skips projection refresh', async () => {
    const requests: string[] = []
    useNovelStore.setState({ currentNovelId: 'novel-only' })

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/novels/novel-only') {
        return new Response(
          JSON.stringify({ ok: false, error: 'Refusing to overwrite a recoverable workspace with an empty payload' }),
          { status: 409 }
        )
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await expect(useNovelStore.getState().saveToBackend()).rejects.toMatchObject({ code: 'authority-required' })

    expect(requests).toEqual([])
    expect(useNovelStore.getState().isSaving).toBe(false)
  })

  it('permanently deletes a novel with the post-optimistic survivor encoded in the query', async () => {
    useNovelStore.setState({ currentNovelId: 'novel survivor/二' })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('DELETE')
      return new Response(JSON.stringify({
        ok: true,
        deletedNovelId: 'novel target/?',
        nextNovelId: 'novel survivor/二',
        deletionState: 'deleted',
        cleanupPending: false,
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(useNovelStore.getState().deleteNovelFromBackend('novel target/?')).resolves.toEqual({
      status: 'committed',
      result: {
        ok: true,
        deletedNovelId: 'novel target/?',
        nextNovelId: 'novel survivor/二',
        deletionState: 'deleted',
        cleanupPending: false,
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost')
    expect(requestUrl.pathname).toBe('/api/novels/novel%20target%2F%3F')
    expect(requestUrl.searchParams.get('nextNovelId')).toBe('novel survivor/二')
  })

  it('accepts a queued cleanup deletion response', async () => {
    useNovelStore.setState({ currentNovelId: 'novel-survivor' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      deletedNovelId: 'novel-target',
      nextNovelId: 'novel-survivor',
      deletionState: 'deleted',
      cleanupPending: true,
    }), { status: 202 })))

    await expect(useNovelStore.getState().deleteNovelFromBackend('novel-target')).resolves.toEqual({
      status: 'committed',
      result: {
        ok: true,
        deletedNovelId: 'novel-target',
        nextNovelId: 'novel-survivor',
        deletionState: 'deleted',
        cleanupPending: true,
      },
    })
  })

  it('omits the survivor for the last novel and distinguishes rejection from indeterminate responses', async () => {
    useNovelStore.setState({ currentNovelId: '' })
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'Novel is busy' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, deletedNovelId: 'wrong-id', nextNovelId: null, deletionState: 'deleted', cleanupPending: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, deletedNovelId: 'novel-only', nextNovelId: null, deletionState: 'deleted', cleanupPending: false }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(useNovelStore.getState().deleteNovelFromBackend('novel-only')).resolves.toEqual({ status: 'rejected', error: 'Novel is busy' })
    await expect(useNovelStore.getState().deleteNovelFromBackend('novel-only')).resolves.toMatchObject({ status: 'indeterminate' })
    await expect(useNovelStore.getState().deleteNovelFromBackend('novel-only')).resolves.toMatchObject({ status: 'indeterminate' })

    for (const [input] of fetchMock.mock.calls) {
      const requestUrl = new URL(String(input), 'http://localhost')
      expect(requestUrl.pathname).toBe('/api/novels/novel-only')
      expect(requestUrl.searchParams.has('nextNovelId')).toBe(false)
    }
  })

  it.each([
    {
      name: 'missing success marker',
      status: 200,
      body: { deletedNovelId: 'novel-only', nextNovelId: null, deletionState: 'deleted', cleanupPending: false },
      error: 'Failed to delete novel',
    },
    {
      name: 'non-string deleted novel ID',
      status: 200,
      body: { ok: true, deletedNovelId: 42, nextNovelId: null, deletionState: 'deleted', cleanupPending: false },
      error: 'invalid deleted novel ID',
    },
    {
      name: 'invalid next novel ID',
      status: 200,
      body: { ok: true, deletedNovelId: 'novel-only', nextNovelId: 42, deletionState: 'deleted', cleanupPending: false },
      error: 'invalid next novel ID',
    },
    {
      name: 'invalid deletion state',
      status: 200,
      body: { ok: true, deletedNovelId: 'novel-only', nextNovelId: null, deletionState: 'deleting', cleanupPending: false },
      error: 'invalid deletion state',
    },
    {
      name: 'non-boolean cleanup marker',
      status: 200,
      body: { ok: true, deletedNovelId: 'novel-only', nextNovelId: null, deletionState: 'deleted', cleanupPending: 'false' },
      error: 'invalid cleanup pending state',
    },
    {
      name: '200 response with cleanup pending',
      status: 200,
      body: { ok: true, deletedNovelId: 'novel-only', nextNovelId: null, deletionState: 'deleted', cleanupPending: true },
      error: 'inconsistent cleanup pending state',
    },
    {
      name: '202 response without cleanup pending',
      status: 202,
      body: { ok: true, deletedNovelId: 'novel-only', nextNovelId: null, deletionState: 'deleted', cleanupPending: false },
      error: 'inconsistent cleanup pending state',
    },
  ])('classifies deletion transport contract violations as indeterminate: $name', async ({ status, body }) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

    await expect(useNovelStore.getState().deleteNovelFromBackend('novel-only')).resolves.toEqual({
      status: 'indeterminate',
      error: 'Workspace endpoint returned an invalid deletion response',
    })
  })

  it.each([400, 404, 409])('classifies strict %s delete errors as definitive rejection', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'Delete rejected' }), { status })))

    await expect(useNovelStore.getState().deleteNovelFromBackend('novel-only')).resolves.toEqual({
      status: 'rejected',
      error: 'Delete rejected',
    })
  })

  it('treats an inconsistent rejection contract as indeterminate', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'Delete rejected', deletedNovelId: 'novel-only' }), { status: 409 })))

    await expect(useNovelStore.getState().deleteNovelFromBackend('novel-only')).resolves.toMatchObject({
      status: 'indeterminate',
    })
  })

  it('classifies response loss and malformed JSON as indeterminate', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('{not-json', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(useNovelStore.getState().deleteNovelFromBackend('novel-only')).resolves.toEqual({
      status: 'indeterminate',
      error: 'Failed to fetch',
    })
    await expect(useNovelStore.getState().deleteNovelFromBackend('novel-only')).resolves.toEqual({
      status: 'indeterminate',
      error: 'Workspace endpoint returned invalid JSON',
    })
  })

  it('reconciles an immediately ready target through ordered status and targeted workspace requests', async () => {
    const novelId = 'novel target/?'
    useNovelStore.setState({
      currentNovelId: novelId,
      currentChapterId: 'chapter-target',
      selectionText: 'before selection',
      selectedParagraphIndex: 1,
      localNovels: [
        { id: novelId, title: 'Target before', summary: '', tags: [] },
        { id: 'novel-survivor', title: 'Survivor', summary: '', tags: [] },
      ],
      localChapters: [
        { id: 'chapter-target', novelId, title: 'Target chapter', order: 1, content: '<p>Target before</p>', status: 'draft', wordCount: 1, updatedAt: 'before' },
        { id: 'chapter-survivor', novelId: 'novel-survivor', title: 'Survivor chapter', order: 1, content: '<p>Survivor before</p>', status: 'draft', wordCount: 1, updatedAt: 'before' },
      ],
    })
    const transaction = useNovelStore.getState().beginNovelDeletion(novelId)
    expect(transaction).not.toBeNull()
    useNovelStore.setState((state) => ({
      currentNovelId: 'novel-imported',
      currentChapterId: 'chapter-imported',
      selectionText: 'post-optimistic selection',
      selectedParagraphIndex: 9,
      localNovels: [...state.localNovels, { id: 'novel-imported', title: 'Imported', summary: '', tags: [] }],
      localChapters: [
        ...state.localChapters.map((chapter) => chapter.id === 'chapter-survivor'
          ? { ...chapter, content: '<p>Survivor edited</p>', updatedAt: 'after' }
          : chapter),
        { id: 'chapter-imported', novelId: 'novel-imported', title: 'Imported chapter', order: 1, content: '<p>Imported</p>', status: 'draft', wordCount: 1, updatedAt: 'after' },
      ],
    }))
    const authoritative = {
      ...transaction!.before,
      currentNovelId: novelId,
      currentChapterId: 'chapter-target',
      selectionText: 'authoritative selection',
      selectedParagraphIndex: 4,
      localNovels: transaction!.before.localNovels.map((novel) => novel.id === novelId
        ? { ...novel, title: 'Target authoritative' }
        : novel),
      localChapters: transaction!.before.localChapters.map((chapter) => chapter.novelId === novelId
        ? { ...chapter, content: '<p>Target authoritative</p>', updatedAt: 'authoritative' }
        : chapter),
    }
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/novels/novel%20target%2F%3F?deletionStatus=1') {
        return new Response(JSON.stringify({ ok: true, novelId, deletionState: 'ready' }), { status: 200 })
      }
      if (url === '/api/novels/novel%20target%2F%3F') {
        return new Response(JSON.stringify(authoritative), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await expect(useNovelStore.getState().reconcileNovelDeletionFromBackend(transaction!)).resolves.toBe('present')

    expect(requests).toEqual([
      '/api/novels/novel%20target%2F%3F?deletionStatus=1',
      '/api/novels/novel%20target%2F%3F',
    ])
    const state = useNovelStore.getState()
    expect(state.currentNovelId).toBe('novel-imported')
    expect(state.currentChapterId).toBe('chapter-imported')
    expect(state.selectionText).toBe('post-optimistic selection')
    expect(state.selectedParagraphIndex).toBe(9)
    expect(state.localNovels.find((novel) => novel.id === novelId)?.title).toBe('Target authoritative')
    expect(state.localChapters.find((chapter) => chapter.id === 'chapter-target')).toMatchObject({
      content: '<p>Target authoritative</p>',
      updatedAt: 'authoritative',
    })
    expect(state.localChapters.find((chapter) => chapter.id === 'chapter-survivor')).toMatchObject({
      content: '<p>Survivor edited</p>',
      updatedAt: 'after',
    })
    expect(state.localNovels.some((novel) => novel.id === 'novel-imported')).toBe(true)
    expect(state.localChapters.some((chapter) => chapter.id === 'chapter-imported')).toBe(true)
  })

  it('returns deleted immediately without fetching or mutating a workspace', async () => {
    useNovelStore.setState({
      currentNovelId: 'novel-target',
      currentChapterId: 'chapter-target',
      localNovels: [{ id: 'novel-target', title: 'Target', summary: '', tags: [] }],
      localChapters: [{ id: 'chapter-target', novelId: 'novel-target', title: 'Target chapter', order: 1, content: '<p>Target</p>', status: 'draft', wordCount: 1, updatedAt: 'now' }],
    })
    const transaction = useNovelStore.getState().beginNovelDeletion('novel-target')
    expect(transaction).not.toBeNull()
    const optimistic = useNovelStore.getState().snapshotPersistedState()
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return new Response(JSON.stringify({ ok: true, novelId: 'novel-target', deletionState: 'deleted' }), { status: 200 })
    }))

    await expect(useNovelStore.getState().reconcileNovelDeletionFromBackend(transaction!)).resolves.toBe('deleted')

    expect(requests).toEqual(['/api/novels/novel-target?deletionStatus=1'])
    expect(useNovelStore.getState().snapshotPersistedState()).toEqual(optimistic)
  })

  it('polls deleting status after 100ms and fetches the targeted workspace only once ready', async () => {
    vi.useFakeTimers()
    useNovelStore.setState({
      currentNovelId: 'novel-target',
      currentChapterId: 'chapter-target',
      localNovels: [{ id: 'novel-target', title: 'Target', summary: '', tags: [] }],
      localChapters: [{ id: 'chapter-target', novelId: 'novel-target', title: 'Target chapter', order: 1, content: '<p>Target</p>', status: 'draft', wordCount: 1, updatedAt: 'now' }],
    })
    const transaction = useNovelStore.getState().beginNovelDeletion('novel-target')
    expect(transaction).not.toBeNull()
    const targetedWorkspace = transaction!.before
    const requests: string[] = []
    let statusRequestCount = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/novels/novel-target?deletionStatus=1') {
        statusRequestCount += 1
        return new Response(JSON.stringify({
          ok: true,
          novelId: 'novel-target',
          deletionState: statusRequestCount === 1 ? 'deleting' : 'ready',
        }), { status: 200 })
      }
      if (url === '/api/novels/novel-target') {
        return new Response(JSON.stringify(targetedWorkspace), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    const reconciliation = useNovelStore.getState().reconcileNovelDeletionFromBackend(transaction!).then(
      (result) => ({ status: 'resolved' as const, result }),
      (error) => ({ status: 'rejected' as const, error })
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(requests).toEqual(['/api/novels/novel-target?deletionStatus=1'])
    await vi.advanceTimersByTimeAsync(99)
    expect(requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)

    await expect(reconciliation).resolves.toEqual({ status: 'resolved', result: 'present' })
    expect(requests).toEqual([
      '/api/novels/novel-target?deletionStatus=1',
      '/api/novels/novel-target?deletionStatus=1',
      '/api/novels/novel-target',
    ])
  })

  it('stops polling on deleting to deleted without fetching or mutating a workspace', async () => {
    vi.useFakeTimers()
    useNovelStore.setState({
      currentNovelId: 'novel-target',
      currentChapterId: 'chapter-target',
      localNovels: [{ id: 'novel-target', title: 'Target', summary: '', tags: [] }],
      localChapters: [{ id: 'chapter-target', novelId: 'novel-target', title: 'Target chapter', order: 1, content: '<p>Target</p>', status: 'draft', wordCount: 1, updatedAt: 'now' }],
    })
    const transaction = useNovelStore.getState().beginNovelDeletion('novel-target')
    expect(transaction).not.toBeNull()
    const optimistic = useNovelStore.getState().snapshotPersistedState()
    const requests: string[] = []
    let statusRequestCount = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input))
      statusRequestCount += 1
      return new Response(JSON.stringify({
        ok: true,
        novelId: 'novel-target',
        deletionState: statusRequestCount === 1 ? 'deleting' : 'deleted',
      }), { status: 200 })
    }))

    const reconciliation = useNovelStore.getState().reconcileNovelDeletionFromBackend(transaction!).then(
      (result) => ({ status: 'resolved' as const, result }),
      (error) => ({ status: 'rejected' as const, error })
    )
    await vi.advanceTimersByTimeAsync(99)
    expect(requests).toEqual(['/api/novels/novel-target?deletionStatus=1'])
    await vi.advanceTimersByTimeAsync(1)

    await expect(reconciliation).resolves.toEqual({ status: 'resolved', result: 'deleted' })
    expect(requests).toEqual([
      '/api/novels/novel-target?deletionStatus=1',
      '/api/novels/novel-target?deletionStatus=1',
    ])
    expect(useNovelStore.getState().snapshotPersistedState()).toEqual(optimistic)
  })

  it('exhausts deleting retries at deterministic 100ms, 250ms, and 500ms delays without mutation', async () => {
    vi.useFakeTimers()
    useNovelStore.setState({
      currentNovelId: 'novel-target',
      currentChapterId: 'chapter-target',
      localNovels: [{ id: 'novel-target', title: 'Target', summary: '', tags: [] }],
      localChapters: [{ id: 'chapter-target', novelId: 'novel-target', title: 'Target chapter', order: 1, content: '<p>Target</p>', status: 'draft', wordCount: 1, updatedAt: 'now' }],
    })
    const transaction = useNovelStore.getState().beginNovelDeletion('novel-target')
    expect(transaction).not.toBeNull()
    const optimistic = useNovelStore.getState().snapshotPersistedState()
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return new Response(JSON.stringify({ ok: true, novelId: 'novel-target', deletionState: 'deleting' }), { status: 200 })
    }))

    const reconciliation = useNovelStore.getState().reconcileNovelDeletionFromBackend(transaction!).then(
      (result) => ({ status: 'resolved' as const, result }),
      (error) => ({ status: 'rejected' as const, error })
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(249)
    expect(requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(requests).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(499)
    expect(requests).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1)
    await expect(reconciliation).resolves.toMatchObject({ status: 'rejected', error: expect.any(Error) })

    expect(requests).toEqual(Array(4).fill('/api/novels/novel-target?deletionStatus=1'))
    expect(useNovelStore.getState().snapshotPersistedState()).toEqual(optimistic)
  })

  it('rejects malformed deletion-status JSON without mutating the store', async () => {
    useNovelStore.setState({
      currentNovelId: 'novel-target',
      currentChapterId: 'chapter-target',
      localNovels: [{ id: 'novel-target', title: 'Target', summary: '', tags: [] }],
      localChapters: [{ id: 'chapter-target', novelId: 'novel-target', title: 'Target chapter', order: 1, content: '<p>Target</p>', status: 'draft', wordCount: 1, updatedAt: 'now' }],
    })
    const transaction = useNovelStore.getState().beginNovelDeletion('novel-target')
    expect(transaction).not.toBeNull()
    const optimistic = useNovelStore.getState().snapshotPersistedState()
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return new Response('{not-json', { status: 200 })
    }))

    await expect(useNovelStore.getState().reconcileNovelDeletionFromBackend(transaction!)).rejects.toThrow()

    expect(requests).toEqual(['/api/novels/novel-target?deletionStatus=1'])
    expect(useNovelStore.getState().snapshotPersistedState()).toEqual(optimistic)
  })

  it.each([
    ['missing deletion state', { ok: true, novelId: 'novel-target' }],
    ['extra response field', { ok: true, novelId: 'novel-target', deletionState: 'deleted', extra: true }],
    ['mismatched novel ID', { ok: true, novelId: 'novel-other', deletionState: 'deleted' }],
    ['invalid deletion state', { ok: true, novelId: 'novel-target', deletionState: 'pending' }],
  ])('rejects %s deletion-status responses without mutating the store', async (_name, statusPayload) => {
    useNovelStore.setState({
      currentNovelId: 'novel-target',
      currentChapterId: 'chapter-target',
      localNovels: [{ id: 'novel-target', title: 'Target', summary: '', tags: [] }],
      localChapters: [{ id: 'chapter-target', novelId: 'novel-target', title: 'Target chapter', order: 1, content: '<p>Target</p>', status: 'draft', wordCount: 1, updatedAt: 'now' }],
    })
    const transaction = useNovelStore.getState().beginNovelDeletion('novel-target')
    expect(transaction).not.toBeNull()
    const optimistic = useNovelStore.getState().snapshotPersistedState()
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return new Response(JSON.stringify(statusPayload), { status: 200 })
    }))

    await expect(useNovelStore.getState().reconcileNovelDeletionFromBackend(transaction!)).rejects.toThrow()

    expect(requests).toEqual(['/api/novels/novel-target?deletionStatus=1'])
    expect(useNovelStore.getState().snapshotPersistedState()).toEqual(optimistic)
  })

  it('propagates deletion-status request errors without fetching or mutating a workspace', async () => {
    useNovelStore.setState({
      currentNovelId: 'novel-target',
      currentChapterId: 'chapter-target',
      localNovels: [{ id: 'novel-target', title: 'Target', summary: '', tags: [] }],
      localChapters: [{ id: 'chapter-target', novelId: 'novel-target', title: 'Target chapter', order: 1, content: '<p>Target</p>', status: 'draft', wordCount: 1, updatedAt: 'now' }],
    })
    const transaction = useNovelStore.getState().beginNovelDeletion('novel-target')
    expect(transaction).not.toBeNull()
    const optimistic = useNovelStore.getState().snapshotPersistedState()
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return new Response(JSON.stringify({ ok: false, error: 'Status unavailable' }), { status: 503 })
    }))

    await expect(useNovelStore.getState().reconcileNovelDeletionFromBackend(transaction!)).rejects.toThrow('Status unavailable')

    expect(requests).toEqual(['/api/novels/novel-target?deletionStatus=1'])
    expect(useNovelStore.getState().snapshotPersistedState()).toEqual(optimistic)
  })

  it('rejects a ready targeted workspace that does not represent the requested novel', async () => {
    useNovelStore.setState({
      currentNovelId: 'novel-target',
      currentChapterId: 'chapter-target',
      localNovels: [{ id: 'novel-target', title: 'Target', summary: '', tags: [] }],
      localChapters: [{ id: 'chapter-target', novelId: 'novel-target', title: 'Target chapter', order: 1, content: '<p>Target</p>', status: 'draft', wordCount: 1, updatedAt: 'now' }],
    })
    const transaction = useNovelStore.getState().beginNovelDeletion('novel-target')
    expect(transaction).not.toBeNull()
    const optimistic = useNovelStore.getState().snapshotPersistedState()
    const unrelatedWorkspace = createWorkspacePayload('novel-other')
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/novels/novel-target?deletionStatus=1') {
        return new Response(JSON.stringify({ ok: true, novelId: 'novel-target', deletionState: 'ready' }), { status: 200 })
      }
      if (url === '/api/novels/novel-target') {
        return new Response(JSON.stringify(unrelatedWorkspace), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await expect(useNovelStore.getState().reconcileNovelDeletionFromBackend(transaction!)).rejects.toThrow()

    expect(requests).toEqual([
      '/api/novels/novel-target?deletionStatus=1',
      '/api/novels/novel-target',
    ])
    expect(useNovelStore.getState().snapshotPersistedState()).toEqual(optimistic)
  })

  it('keeps survivor edits and unrelated imports when authoritative reconciliation confirms deletion', async () => {
    useNovelStore.setState({
      currentNovelId: 'novel-target',
      currentChapterId: 'chapter-target',
      localNovels: [
        { id: 'novel-target', title: 'Target', summary: '', tags: [] },
        { id: 'novel-survivor', title: 'Survivor', summary: '', tags: [] },
      ],
      localChapters: [
        { id: 'chapter-target', novelId: 'novel-target', title: 'Target chapter', order: 1, content: '<p>Target</p>', status: 'draft', wordCount: 1, updatedAt: 'now' },
        { id: 'chapter-survivor-1', novelId: 'novel-survivor', title: 'Survivor one', order: 1, content: '<p>Before</p>', status: 'draft', wordCount: 1, updatedAt: 'before' },
        { id: 'chapter-survivor-2', novelId: 'novel-survivor', title: 'Survivor two', order: 2, content: '<p>Second</p>', status: 'draft', wordCount: 1, updatedAt: 'before' },
      ],
    })
    const transaction = useNovelStore.getState().beginNovelDeletion('novel-target')
    expect(transaction).not.toBeNull()
    useNovelStore.setState((state) => ({
      localNovels: [...state.localNovels, { id: 'novel-imported', title: 'Imported', summary: '', tags: [] }],
      localChapters: [
        ...state.localChapters.map((item) => item.id === 'chapter-survivor-1'
          ? { ...item, content: '<p>Edited after delete</p>', updatedAt: 'after' }
          : item),
        { id: 'chapter-imported', novelId: 'novel-imported', title: 'Imported chapter', order: 1, content: '<p>Imported</p>', status: 'draft', wordCount: 1, updatedAt: 'after' },
      ],
    }))
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/novels/novel-target?deletionStatus=1') {
        return new Response(JSON.stringify({ ok: true, novelId: 'novel-target', deletionState: 'deleted' }), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await expect(useNovelStore.getState().reconcileNovelDeletionFromBackend(transaction!)).resolves.toBe('deleted')

    expect(requests).toEqual(['/api/novels/novel-target?deletionStatus=1'])
    const state = useNovelStore.getState()
    expect(state.currentNovelId).toBe('novel-survivor')
    expect(state.currentChapterId).toBe('chapter-survivor-1')
    expect(state.localChapters.find((item) => item.id === 'chapter-survivor-1')).toMatchObject({
      content: '<p>Edited after delete</p>',
      updatedAt: 'after',
    })
    expect(state.localNovels.some((item) => item.id === 'novel-imported')).toBe(true)
    expect(state.localChapters.some((item) => item.id === 'chapter-imported')).toBe(true)
    expect(state.localNovels.some((item) => item.id === 'novel-target')).toBe(false)
  })

  it('restores authoritative target and chapter-scoped state while preserving post-optimistic mutations', async () => {
    const beforeCandidate = {
      id: 'candidate-before',
      batchId: 'batch-before',
      title: 'Before candidate',
      summary: 'Before summary',
      content: 'Before content',
      mode: 'medium' as const,
      tone: 'keep' as const,
      selected: true,
      createdAt: 'before',
      prompt: 'Before prompt',
      sourceExcerpt: 'Before source',
      actions: ['apply' as const],
    }
    const authoritativeCandidate = {
      ...beforeCandidate,
      id: 'candidate-authoritative',
      title: 'Authoritative candidate',
      content: 'Authoritative content',
      createdAt: 'authoritative',
    }
    useNovelStore.setState({
      currentNovelId: 'novel-target',
      currentChapterId: 'chapter-target',
      rewriteCandidates: [beforeCandidate],
      selectionText: 'before selection',
      selectedParagraphIndex: 3,
      localNovels: [
        { id: 'novel-target', title: 'Target before', summary: '', tags: [] },
        { id: 'novel-survivor', title: 'Survivor', summary: '', tags: [] },
      ],
      localChapters: [
        { id: 'chapter-target', novelId: 'novel-target', title: 'Target chapter', order: 1, content: '<p>Target before</p>', status: 'draft', wordCount: 1, updatedAt: 'before' },
        { id: 'chapter-survivor', novelId: 'novel-survivor', title: 'Survivor chapter', order: 1, content: '<p>Survivor before</p>', status: 'draft', wordCount: 1, updatedAt: 'before' },
      ],
    })
    const transaction = useNovelStore.getState().beginNovelDeletion('novel-target')
    expect(transaction).not.toBeNull()
    useNovelStore.setState((state) => ({
      currentNovelId: 'novel-imported',
      currentChapterId: 'chapter-imported',
      selectionText: 'post-optimistic selection',
      localNovels: [...state.localNovels, { id: 'novel-imported', title: 'Imported', summary: '', tags: [] }],
      localChapters: [
        ...state.localChapters.map((item) => item.id === 'chapter-survivor'
          ? { ...item, content: '<p>Survivor edited</p>', updatedAt: 'after' }
          : item),
        { id: 'chapter-imported', novelId: 'novel-imported', title: 'Imported chapter', order: 1, content: '<p>Imported</p>', status: 'draft', wordCount: 1, updatedAt: 'after' },
      ],
    }))
    const authoritative = {
      ...transaction!.before,
      currentNovelId: 'novel-target',
      currentChapterId: 'chapter-target',
      rewriteCandidates: [authoritativeCandidate],
      selectionText: 'authoritative selection',
      selectedParagraphIndex: 7,
      localNovels: transaction!.before.localNovels.map((item) => item.id === 'novel-target'
        ? { ...item, title: 'Target authoritative' }
        : item),
      localChapters: transaction!.before.localChapters.map((item) => item.id === 'chapter-target'
        ? { ...item, content: '<p>Target authoritative</p>', updatedAt: 'authoritative' }
        : item),
    }
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/novels/novel-target?deletionStatus=1') {
        return new Response(JSON.stringify({ ok: true, novelId: 'novel-target', deletionState: 'ready' }), { status: 200 })
      }
      if (url === '/api/novels/novel-target') {
        return new Response(JSON.stringify(authoritative), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await expect(useNovelStore.getState().reconcileNovelDeletionFromBackend(transaction!)).resolves.toBe('present')

    expect(requests).toEqual([
      '/api/novels/novel-target?deletionStatus=1',
      '/api/novels/novel-target',
    ])
    const state = useNovelStore.getState()
    expect(state.currentNovelId).toBe('novel-imported')
    expect(state.currentChapterId).toBe('chapter-imported')
    expect(state.rewriteCandidates).toEqual([authoritativeCandidate])
    expect(state.selectionText).toBe('post-optimistic selection')
    expect(state.selectedParagraphIndex).toBe(7)
    expect(state.localNovels.find((item) => item.id === 'novel-target')?.title).toBe('Target authoritative')
    expect(state.localChapters.find((item) => item.id === 'chapter-target')).toMatchObject({
      content: '<p>Target authoritative</p>',
      updatedAt: 'authoritative',
    })
    expect(state.localChapters.find((item) => item.id === 'chapter-survivor')).toMatchObject({
      content: '<p>Survivor edited</p>',
      updatedAt: 'after',
    })
    expect(state.localNovels.some((item) => item.id === 'novel-imported')).toBe(true)
    expect(state.localChapters.some((item) => item.id === 'chapter-imported')).toBe(true)
  })

  it('propagates reconciliation failure without replacing optimistic state', async () => {
    useNovelStore.setState({
      currentNovelId: 'novel-target',
      currentChapterId: 'chapter-target',
      localNovels: [{ id: 'novel-target', title: 'Target', summary: '', tags: [] }],
      localChapters: [{ id: 'chapter-target', novelId: 'novel-target', title: 'Target chapter', order: 1, content: '<p>Target</p>', status: 'draft', wordCount: 1, updatedAt: 'now' }],
    })
    const transaction = useNovelStore.getState().beginNovelDeletion('novel-target')
    expect(transaction).not.toBeNull()
    const optimistic = useNovelStore.getState().snapshotPersistedState()
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/novels/novel-target?deletionStatus=1') {
        return new Response(JSON.stringify({ ok: true, novelId: 'novel-target', deletionState: 'ready' }), { status: 200 })
      }
      if (url === '/api/novels/novel-target') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await expect(useNovelStore.getState().reconcileNovelDeletionFromBackend(transaction!)).rejects.toThrow('invalid workspace')
    expect(requests).toEqual([
      '/api/novels/novel-target?deletionStatus=1',
      '/api/novels/novel-target',
    ])
    expect(useNovelStore.getState().snapshotPersistedState()).toEqual(optimistic)
  })

  it('restores an exact persisted snapshot without overwriting transient state', () => {
    useNovelStore.setState({
      currentNovelId: 'novel-target',
      currentChapterId: 'chapter-target',
      currentTab: 'characters',
      localNovels: [
        { id: 'novel-target', title: 'Target', summary: 'Target summary', tags: ['target'] },
        { id: 'novel-survivor', title: 'Survivor', summary: 'Survivor summary', tags: ['survivor'] },
      ],
      localChapters: [
        {
          id: 'chapter-target',
          novelId: 'novel-target',
          title: 'Target chapter',
          order: 1,
          content: '<p>Target</p>',
          status: 'draft',
          wordCount: 1,
          updatedAt: 'target-now',
        },
        {
          id: 'chapter-survivor',
          novelId: 'novel-survivor',
          title: 'Survivor chapter',
          order: 1,
          content: '<p>Survivor</p>',
          status: 'draft',
          wordCount: 1,
          updatedAt: 'survivor-now',
        },
      ],
      backendLoadError: 'before snapshot',
      isNovelDeletionPending: false,
    })
    const snapshot = useNovelStore.getState().snapshotPersistedState()

    useNovelStore.getState().deleteNovel('novel-target')
    useNovelStore.setState({
      currentTab: 'world',
      backendLoadError: 'preserve this transient error',
    })
    useNovelStore.getState().setNovelDeletionPending(true)
    useNovelStore.getState().restorePersistedState(snapshot)

    const restored = useNovelStore.getState()
    expect(restored.snapshotPersistedState()).toEqual(snapshot)
    expect(restored.backendLoadError).toBe('preserve this transient error')
    expect(restored.isNovelDeletionPending).toBe(true)
  })

  it('targeted rollback restores only deleted records and preserves post-optimistic survivor edits', () => {
    useNovelStore.setState({
      currentNovelId: 'novel-target',
      currentChapterId: 'chapter-target',
      selectionText: 'target selection',
      localNovels: [
        { id: 'novel-target', title: 'Target', summary: '', tags: [] },
        { id: 'novel-survivor', title: 'Survivor', summary: '', tags: [] },
      ],
      localChapters: [
        { id: 'chapter-target', novelId: 'novel-target', title: 'Target chapter', order: 1, content: '<p>Target</p>', status: 'draft', wordCount: 1, updatedAt: 'now' },
        { id: 'chapter-survivor', novelId: 'novel-survivor', title: 'Survivor chapter', order: 1, content: '<p>Before</p>', status: 'draft', wordCount: 1, updatedAt: 'before' },
      ],
    })

    const transaction = useNovelStore.getState().beginNovelDeletion('novel-target')
    expect(transaction).not.toBeNull()
    useNovelStore.setState((state) => ({
      selectionText: 'post-optimistic selection',
      localChapters: state.localChapters.map((item) => item.id === 'chapter-survivor'
        ? { ...item, content: '<p>Edited after delete</p>', updatedAt: 'after' }
        : item),
    }))

    useNovelStore.getState().rollbackNovelDeletion(transaction!)

    const state = useNovelStore.getState()
    expect(state.localNovels.map((item) => item.id)).toEqual(['novel-target', 'novel-survivor'])
    expect(state.localChapters.find((item) => item.id === 'chapter-target')).toBeDefined()
    expect(state.localChapters.find((item) => item.id === 'chapter-survivor')).toMatchObject({
      content: '<p>Edited after delete</p>',
      updatedAt: 'after',
    })
    expect(state.selectionText).toBe('post-optimistic selection')
  })

  it('reconciles to the authoritative survivor with a deterministic valid chapter', () => {
    useNovelStore.setState({
      currentNovelId: 'novel-other',
      currentChapterId: 'chapter-other',
      localChapters: [
        {
          id: 'survivor-branch',
          novelId: 'novel-survivor',
          title: 'Branch',
          order: 0,
          content: '<p>Branch</p>',
          status: 'draft',
          wordCount: 1,
          updatedAt: 'now',
          parentChapterId: 'survivor-first',
        },
        {
          id: 'survivor-second',
          novelId: 'novel-survivor',
          title: 'Second',
          order: 2,
          content: '<p>Second</p>',
          status: 'draft',
          wordCount: 1,
          updatedAt: 'now',
        },
        {
          id: 'survivor-first',
          novelId: 'novel-survivor',
          title: 'First',
          order: 1,
          content: '<p>First</p>',
          status: 'draft',
          wordCount: 1,
          updatedAt: 'now',
        },
        {
          id: 'chapter-other',
          novelId: 'novel-other',
          title: 'Other',
          order: 1,
          content: '<p>Other</p>',
          status: 'draft',
          wordCount: 1,
          updatedAt: 'now',
        },
      ],
    })

    useNovelStore.getState().reconcileNovelDeletion('novel-survivor')

    expect(useNovelStore.getState()).toMatchObject({
      currentNovelId: 'novel-survivor',
      currentChapterId: 'survivor-first',
    })
  })

  it('clears the current selection when deletion has no surviving novel', () => {
    useNovelStore.setState({
      currentNovelId: 'stale-novel',
      currentChapterId: 'stale-chapter',
    })

    useNovelStore.getState().reconcileNovelDeletion(null)

    expect(useNovelStore.getState()).toMatchObject({
      currentNovelId: '',
      currentChapterId: '',
    })
  })

  it('retains the last good library when load, save, or import fails and records explicit errors', async () => {
    useNovelStore.setState({
      presetCompatLibrary: createLibrary({ revision: 7 }),
    })

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/settings/preset-compat' && !init?.method) {
        return new Response(JSON.stringify({ ok: false, error: 'load_failed' }), { status: 500 })
      }
      if (url === '/api/settings/preset-compat' && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: false, error: 'revision_mismatch' }), { status: 409 })
      }
      if (url === '/api/settings/preset-compat/import') {
        return new Response(JSON.stringify({ ok: false, error: 'invalid_import_kind' }), { status: 400 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await expect(useNovelStore.getState().loadPresetCompatLibrary()).rejects.toThrow('load_failed')
    expect(useNovelStore.getState().presetCompatLibrary.revision).toBe(7)
    expect(useNovelStore.getState().presetCompatLibraryError).toBe('load_failed')

    await expect(useNovelStore.getState().savePresetCompatLibrary()).rejects.toThrow('revision_mismatch')
    expect(useNovelStore.getState().presetCompatLibrary.revision).toBe(7)
    expect(useNovelStore.getState().presetCompatLibraryError).toBe('revision_mismatch')

    await expect(useNovelStore.getState().importPresetCompatPreset({ jsonText: '{}' })).rejects.toThrow('invalid_import_kind')
    expect(useNovelStore.getState().presetCompatLibrary.revision).toBe(7)
    expect(useNovelStore.getState().presetCompatLibraryError).toBe('invalid_import_kind')
    expect(useNovelStore.getState().presetCompatLibraryLoading).toBe(false)
  })
})
