import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyWorkspaceState } from '@/lib/workspace-state'
import { serializeState } from '@/store/novel-store-persistence'
import { useNovelStore } from '@/store/novel-store'

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
    isNovelDeletionPending: false,
    backendLoaded: false,
    backendLoadError: '',
  })
}

describe('novel store persist revision', () => {
  beforeEach(resetStore)

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    resetStore()
  })

  it('excludes the transient revision from snapshots, exports, and backend serialization', async () => {
    useNovelStore.setState({ persistRevision: 41 })
    const state = useNovelStore.getState()

    expect(serializeState(state)).not.toHaveProperty('persistRevision')
    expect(state.snapshotPersistedState()).not.toHaveProperty('persistRevision')
    expect(JSON.parse(state.exportWorkspace())).not.toHaveProperty('persistRevision')
    expect(serializeState(state)).not.toHaveProperty('workspaceSaveFeedback')
    expect(state.snapshotPersistedState()).not.toHaveProperty('workspaceSaveConflict')
    expect(JSON.parse(state.exportWorkspace())).not.toHaveProperty('patchCapability')

    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await state.saveToBackend()

    const request = fetchMock.mock.calls[0]?.[1]
    expect(JSON.parse(String(request?.body))).not.toHaveProperty('persistRevision')
  })

  it('increments once for logical workspace mutations, including serialized selection changes', () => {
    const store = useNovelStore.getState()

    store.importNovelFromText({ title: 'Revision novel', text: 'Chapter body' })
    expect(useNovelStore.getState().persistRevision).toBe(1)

    const chapterId = useNovelStore.getState().currentChapterId
    store.updateChapterContent(chapterId, '<p>Edited body</p>')
    expect(useNovelStore.getState().persistRevision).toBe(2)

    store.setCurrentChapterId(chapterId)
    expect(useNovelStore.getState().persistRevision).toBe(2)

    store.setSelectionText('selected text')
    expect(useNovelStore.getState().persistRevision).toBe(3)

    store.setSelectedParagraphIndex(1)
    expect(useNovelStore.getState().persistRevision).toBe(4)

    store.addCharacter(useNovelStore.getState().currentNovelId, {
      name: 'Character',
      role: 'Lead',
      goal: 'Goal',
      trait: 'Calm',
      note: '',
    })
    expect(useNovelStore.getState().persistRevision).toBe(5)
  })

  it('does not increment when preset session cleanup has no matching state', () => {
    const store = useNovelStore.getState()
    const sessionState = store.presetCompatSessionState

    store.clearPresetCompatSessionStateForSelection({ kind: 'chapter', chapterId: 'missing-chapter' })

    expect(useNovelStore.getState().presetCompatSessionState).toBe(sessionState)
    expect(useNovelStore.getState().persistRevision).toBe(0)
  })

  it('does not increment for transient status, AI settings, restoration, or authoritative projection refresh', async () => {
    const store = useNovelStore.getState()
    store.setHydrated(true)
    store.setNovelDeletionPending(true)
    store.setAISettings({
      rewrite: { provider: 'ollama', openAICompatible: { baseUrl: '', apiKey: '', model: '' }, ollama: { baseUrl: 'http://localhost:11434', model: 'qwen' } },
      knowledgeExtraction: { provider: 'ollama', openAICompatible: { baseUrl: '', apiKey: '', model: '', parallelism: 5 }, ollama: { baseUrl: 'http://localhost:11434', model: 'qwen', parallelism: 1 } },
      embeddings: { provider: 'ollama', openAICompatible: { baseUrl: '', apiKey: '', model: '' }, ollama: { baseUrl: 'http://localhost:11434', model: 'embed' }, embeddingBatchSize: 16 },
    })
    store.restorePersistedState({ ...createEmptyWorkspaceState(), currentNovelId: 'authoritative' })
    expect(useNovelStore.getState().persistRevision).toBe(0)

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
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
    }), { status: 200 })))
    await useNovelStore.getState().refreshKnowledgeProjection('authoritative')
    expect(useNovelStore.getState().persistRevision).toBe(0)
  })

  it('treats backend hydration as a clean baseline', async () => {
    const workspace = {
      ...createEmptyWorkspaceState(),
      currentNovelId: 'hydrated-novel',
      currentChapterId: 'hydrated-chapter',
      localNovels: [{ id: 'hydrated-novel', title: 'Hydrated', summary: '', tags: [] }],
      localChapters: [{
        id: 'hydrated-chapter',
        novelId: 'hydrated-novel',
        title: 'Chapter',
        order: 1,
        content: '<p>Hydrated</p>',
        status: 'draft' as const,
        wordCount: 8,
        updatedAt: 'now',
      }],
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/novels/hydrated-novel') return new Response(JSON.stringify({
        ...workspace,
        workspaceRevision: 4,
        revisionNovelId: 'hydrated-novel',
      }), { status: 200 })
      if (url === '/api/settings/ai') return new Response(JSON.stringify({}), { status: 200 })
      if (url.startsWith('/api/knowledge-view')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (url === '/api/settings/preset-compat') return new Response(JSON.stringify({ ok: false }), { status: 500 })
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await useNovelStore.getState().loadFromBackend('hydrated-novel')

    expect(useNovelStore.getState().currentNovelId).toBe('hydrated-novel')
    expect(useNovelStore.getState().workspaceRevision).toBe(4)
    expect(useNovelStore.getState().revisionNovelId).toBe('hydrated-novel')
    expect(useNovelStore.getState().lastAcknowledgedPersistedWorkspace).toEqual(workspace)
    expect(useNovelStore.getState().persistRevision).toBe(0)
  })

  it('restores deduplicated original chapter content from the transport encoding', async () => {
    const workspace = {
      ...createEmptyWorkspaceState(),
      currentNovelId: 'hydrated-novel',
      currentChapterId: 'hydrated-chapter',
      localNovels: [{ id: 'hydrated-novel', title: 'Hydrated', summary: '', tags: [] }],
      localChapters: [{
        id: 'hydrated-chapter',
        novelId: 'hydrated-novel',
        title: 'Chapter',
        order: 1,
        content: '<p>Shared content</p>',
        status: 'draft' as const,
        wordCount: 2,
        updatedAt: 'now',
      }],
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/novels/hydrated-novel') return new Response(JSON.stringify({
        ...workspace,
        chapterContentEncoding: 'original-content-equals-content-v1',
        workspaceRevision: 4,
        revisionNovelId: 'hydrated-novel',
      }), { status: 200 })
      if (url === '/api/settings/ai') return new Response(JSON.stringify({}), { status: 200 })
      if (url.startsWith('/api/knowledge-view')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (url === '/api/settings/preset-compat') return new Response(JSON.stringify({ ok: false }), { status: 500 })
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await useNovelStore.getState().loadFromBackend('hydrated-novel')

    expect(useNovelStore.getState().localChapters[0]).toMatchObject({
      content: '<p>Shared content</p>',
      originalContent: '<p>Shared content</p>',
    })
    expect(useNovelStore.getState().lastAcknowledgedPersistedWorkspace?.localChapters[0]).toMatchObject({
      originalContent: '<p>Shared content</p>',
    })
  })
})
