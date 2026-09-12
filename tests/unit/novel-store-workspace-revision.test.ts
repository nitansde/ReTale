import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersistedNovelState } from '@/lib/types'
import { createEmptyWorkspaceState } from '@/lib/workspace-state'
import { resetClientRequestBrokerForTests } from '@/lib/client-request-broker'
import { fetchAuthoritativeWorkspace, serializeState } from '@/store/novel-store-persistence'
import { useNovelStore } from '@/store/novel-store'
import { WorkspaceSaveError } from '@/store/novel-store-types'

function createWorkspace(): PersistedNovelState {
  return {
    ...createEmptyWorkspaceState(),
    currentNovelId: 'novel-1',
    currentChapterId: 'chapter-1',
    localNovels: [{ id: 'novel-1', title: 'Novel', summary: '', tags: [] }],
    localChapters: [
      { id: 'chapter-1', novelId: 'novel-1', title: 'One', order: 1, content: '<p>One</p>', originalContent: '<p>Original</p>', status: 'draft', wordCount: 1, updatedAt: 'one' },
      { id: 'chapter-2', novelId: 'novel-1', title: 'Two', order: 2, content: '<p>Two</p>', status: 'draft', wordCount: 1, updatedAt: 'two' },
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
  })
}

function revisionResponse(payload: unknown, revision: number, novelId = 'novel-1') {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'X-Retale-Workspace-Revision': String(revision),
      'X-Retale-Revision-Novel-Id': novelId,
    },
  })
}

async function hydrate(workspace = createWorkspace(), revision = 7) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (new URL(url, 'http://localhost').pathname === '/api/novels/novel-1') {
      return revisionResponse(workspace, revision)
    }
    if (url === '/api/settings/ai') return new Response(JSON.stringify({}), { status: 200 })
    throw new Error(`Unexpected fetch: ${url}`)
  }))
  await useNovelStore.getState().loadFromBackend('novel-1')
}

function mutationSuccess(revision: number, replayed = false) {
  return revisionResponse({
    ok: true,
    operation: 'chapter-patch',
    novelId: 'novel-1',
    revision,
    updatedAt: 'server-time',
    replayed,
    shouldScheduleKnowledgeSync: !replayed,
  }, revision)
}

function staleResponse(currentRevision: number, chapter: PersistedNovelState['localChapters'][number] | null) {
  return new Response(JSON.stringify({
    ok: false,
    code: 'stale_revision',
    error: 'raw backend conflict detail',
    currentRevision,
    chapter,
  }), { status: 409 })
}

function expectSameMutationEnvelope(first: RequestInit | undefined, second: RequestInit | undefined) {
  expect(second?.method).toBe(first?.method)
  expect(second?.body).toBe(first?.body)
  expect(second?.headers).toEqual(first?.headers)
  expect(second?.keepalive).toBe(first?.keepalive)
}

describe('novel store workspace revision persistence', () => {
  beforeEach(() => {
    resetClientRequestBrokerForTests()
    resetStore()
  })

  afterEach(() => {
    resetClientRequestBrokerForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    resetStore()
  })

  it('keeps revision authority and acknowledgement transient', async () => {
    await hydrate()
    const state = useNovelStore.getState()

    expect(state.workspaceRevision).toBe(7)
    expect(state.revisionNovelId).toBe('novel-1')
    expect(state.lastAcknowledgedPersistedWorkspace).toEqual(serializeState(state))
    for (const snapshot of [serializeState(state), state.snapshotPersistedState(), JSON.parse(await state.exportWorkspace())]) {
      expect(snapshot).not.toHaveProperty('workspaceRevision')
      expect(snapshot).not.toHaveProperty('revisionNovelId')
      expect(snapshot).not.toHaveProperty('lastAcknowledgedPersistedWorkspace')
      expect(snapshot).not.toHaveProperty('patchCapability')
      expect(snapshot).not.toHaveProperty('workspaceSaveConflict')
      expect(snapshot).not.toHaveProperty('workspaceSaveFeedback')
    }
    expect(state.persistRevision).toBe(0)
  })

  it('hydrates authority from canonical response body metadata without headers', async () => {
    const workspace = createWorkspace()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (new URL(url, 'http://localhost').pathname === '/api/novels/novel-1') {
        return new Response(JSON.stringify({ ...workspace, workspaceRevision: 6, revisionNovelId: 'novel-1' }), { status: 200 })
      }
      if (url === '/api/settings/ai') return new Response(JSON.stringify({}), { status: 200 })
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await useNovelStore.getState().loadFromBackend('novel-1')

    expect(useNovelStore.getState()).toMatchObject({ workspaceRevision: 6, revisionNovelId: 'novel-1' })
  })

  it('revalidates the browser cache on every novel restore and reconciliation', async () => {
    await hydrate()
    await useNovelStore.getState().loadFromBackend('novel-1')
    await expect(fetchAuthoritativeWorkspace('novel-1')).resolves.toEqual(createWorkspace())

    const novelRequests = vi.mocked(fetch).mock.calls.filter(([url]) => new URL(String(url), 'http://localhost').pathname === '/api/novels/novel-1')
    expect(novelRequests).toHaveLength(3)
    for (const [, options] of novelRequests) expect(options?.cache).toBe('no-cache')
    expect(String(novelRequests[0][0])).toContain('view=workspace')
    expect(useNovelStore.getState()).toMatchObject({
      workspaceRevision: 7,
      revisionNovelId: 'novel-1',
      lastAcknowledgedPersistedWorkspace: createWorkspace(),
    })
  })

  it('loads chapter text on demand without dirtying the save baseline or fetching it twice', async () => {
    const workspace = createWorkspace()
    const stored = workspace.localChapters[1]
    workspace.localChapters[1] = { ...stored, content: '', contentLoaded: false }
    await hydrate(workspace)
    const fetchMock = vi.fn(async () => revisionResponse({ chapter: stored }, 7))
    vi.stubGlobal('fetch', fetchMock)
    await Promise.all([
      useNovelStore.getState().ensureChapterContent(stored.id),
      useNovelStore.getState().ensureChapterContent(stored.id),
    ])
    await useNovelStore.getState().ensureChapterContent(stored.id)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/novels/novel-1?view=chapter&chapterId=chapter-2', expect.objectContaining({ cache: 'no-cache' }),
    ])
    const state = useNovelStore.getState()
    expect(state.localChapters[1]).toEqual(stored)
    expect(state.lastAcknowledgedPersistedWorkspace?.localChapters[1]).toEqual(stored)
    await state.saveToBackend()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('prefetches following chapters in bounded batches, wraps around, and keeps saves sparse', async () => {
    const workspace = createWorkspace()
    const chapters = Array.from({ length: 20 }, (_, index) => ({
      ...workspace.localChapters[0], id: `chapter-${index + 1}`, order: index + 1,
      content: `Body ${index + 1}`, originalContent: `Original ${index + 1}`,
    }))
    workspace.currentChapterId = 'chapter-10'
    workspace.localChapters = chapters.map((chapter) => chapter.id === workspace.currentChapterId ? chapter : {
      ...chapter, content: '', originalContent: undefined, contentLoaded: false,
    })
    await hydrate(workspace)
    useNovelStore.getState().setCurrentChapterId('chapter-10')
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === 'POST') return mutationSuccess(8)
      const ids = new URL(String(input), 'http://localhost').searchParams.getAll('chapterId')
      return revisionResponse({ chapters: ids.map((id) => chapters.find((chapter) => chapter.id === id)) }, 7)
    })
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal
    while (await useNovelStore.getState().prefetchChapterContent(signal)) { /* drain idle batches */ }
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][0]).toContain('chapterId=chapter-11')
    for (const [input, init] of fetchMock.mock.calls) {
      expect(new URL(String(input), 'http://localhost').searchParams.getAll('chapterId').length).toBeLessThanOrEqual(8)
      expect(init).toMatchObject({ priority: 'low', cache: 'no-cache' })
    }
    expect(useNovelStore.getState().localChapters).toEqual(chapters)
    expect(useNovelStore.getState().persistRevision).toBe(0)
    await useNovelStore.getState().ensureChapterContent('chapter-11')
    await useNovelStore.getState().saveToBackend()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    useNovelStore.getState().updateChapterContent('chapter-11', 'Edited text', 2)
    useNovelStore.getState().reorderChapters('novel-1', chapters.map((chapter) => chapter.id).reverse())
    await useNovelStore.getState().saveToBackend()
    const body = JSON.parse(fetchMock.mock.calls[3][1]?.body as string)
    expect(body.localChapters.find((chapter: { id: string }) => chapter.id === 'chapter-11').content).toBe('Edited text')
    expect(body.localChapters.filter((chapter: { contentLoaded?: false }) => chapter.contentLoaded === false)).toHaveLength(19)
    expect(useNovelStore.getState().lastAcknowledgedPersistedWorkspace?.localChapters.every((chapter) => chapter.contentLoaded !== false)).toBe(true)
  })

  it.each(['abort', 'revision', 'novel', 'server-revision', 'invalid-batch'] as const)(
    'discards a background batch after %s without changing foreground feedback', async (change) => {
      const workspace = createWorkspace()
      const stored = workspace.localChapters[1]
      workspace.localChapters[1] = { ...stored, content: '', contentLoaded: false }
      await hydrate(workspace)
      let resolve!: (response: Response) => void
      vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((done) => { resolve = done })))
      const controller = new AbortController()
      const pending = useNovelStore.getState().prefetchChapterContent(controller.signal)
      const rejected = expect(pending).rejects.toThrow()
      if (change === 'abort') controller.abort()
      if (change === 'revision') useNovelStore.setState({ workspaceRevision: 8 })
      if (change === 'novel') useNovelStore.setState({ currentNovelId: 'novel-2' })
      useNovelStore.setState({ chapterLoadError: 'Existing foreground error' })
      resolve(revisionResponse({ chapters: change === 'invalid-batch' ? [] : [stored] }, change === 'server-revision' ? 8 : 7))
      await rejected
      expect(useNovelStore.getState().localChapters[1].contentLoaded).toBe(false)
      expect(useNovelStore.getState().chapterLoadError).toBe('Existing foreground error')
      expect(useNovelStore.getState().workspaceSaveFeedback).toBeNull()
    },
  )

  it('preserves foreground edits and local metadata when a background batch arrives', async () => {
    const workspace = createWorkspace()
    const stored = workspace.localChapters[1]
    workspace.localChapters[1] = { ...stored, content: '', contentLoaded: false }
    await hydrate(workspace)
    let resolve!: (response: Response) => void
    const fetchMock = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done }))
      .mockImplementationOnce(async () => revisionResponse({ chapter: stored }, 7))
    vi.stubGlobal('fetch', fetchMock)
    const pending = useNovelStore.getState().prefetchChapterContent(new AbortController().signal)
    await useNovelStore.getState().ensureChapterContent('chapter-2')
    useNovelStore.getState().updateChapterContent('chapter-2', 'Local edit', 2)
    useNovelStore.getState().reorderChapters('novel-1', ['chapter-2', 'chapter-1'])
    resolve(revisionResponse({ chapters: [stored] }, 7))
    await pending
    expect(useNovelStore.getState().localChapters.find((chapter) => chapter.id === 'chapter-2')).toMatchObject({ content: 'Local edit', order: 1 })
    expect(useNovelStore.getState().lastAcknowledgedPersistedWorkspace?.localChapters[1].content).toBe(stored.content)
  })

  it('preserves unloaded chapter markers on structural saves and refuses editing their empty placeholder', async () => {
    const workspace = createWorkspace()
    workspace.localChapters[1] = { ...workspace.localChapters[1], content: '', contentLoaded: false }
    await hydrate(workspace)
    expect(() => useNovelStore.getState().updateChapterContent('chapter-2', 'would overwrite')).toThrow('Load this chapter')
    useNovelStore.getState().reorderChapters('novel-1', ['chapter-2', 'chapter-1'])
    const fetchMock = vi.fn<typeof fetch>(async () => revisionResponse({
      ok: true, operation: 'full-snapshot', novelId: 'novel-1', revision: 8, updatedAt: 'now',
      replayed: false, shouldScheduleKnowledgeSync: true,
    }, 8))
    vi.stubGlobal('fetch', fetchMock)
    await useNovelStore.getState().saveToBackend()
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
    const payload = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(payload.localChapters.find((chapter: { id: string }) => chapter.id === 'chapter-2')).toMatchObject({
      content: '', contentLoaded: false,
    })
  })

  it('rejects chapter downloads from a different revision without changing save authority', async () => {
    const workspace = createWorkspace()
    const stored = workspace.localChapters[1]
    workspace.localChapters[1] = { ...stored, content: '', contentLoaded: false }
    await hydrate(workspace)
    vi.stubGlobal('fetch', vi.fn(async () => revisionResponse({ chapter: stored }, 8)))
    await expect(useNovelStore.getState().ensureChapterContent(stored.id)).rejects.toThrow('changed on the server')
    expect(useNovelStore.getState().workspaceRevision).toBe(7)
    expect(useNovelStore.getState().localChapters[1].contentLoaded).toBe(false)
  })

  it('exports unloaded text only when requested and preserves unsaved local edits', async () => {
    const full = createWorkspace()
    const partial = createWorkspace()
    partial.localChapters[1] = { ...partial.localChapters[1], content: '', contentLoaded: false }
    await hydrate(partial)
    useNovelStore.getState().updateChapterContent('chapter-1', 'Unsaved export edit')
    const fetchMock = vi.fn<typeof fetch>(async () => revisionResponse(full, 7))
    vi.stubGlobal('fetch', fetchMock)
    const exported = JSON.parse(await useNovelStore.getState().exportWorkspace())
    expect(exported.localChapters[0].content).toBe('Unsaved export edit')
    expect(exported.localChapters[1]).toEqual(full.localChapters[1])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/novels/novel-1')
  })

  it('dispatches a coalesced same-chapter delta as the exact revision-aware PATCH', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>First edit</p>', 2)
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Second edit</p>', 3)

    const fetchMock = vi.fn<typeof fetch>(async () => mutationSuccess(8))
    vi.stubGlobal('fetch', fetchMock)
    await useNovelStore.getState().saveToBackend()

    const request = fetchMock.mock.calls[0]?.[1]
    expect(request?.method).toBe('PATCH')
    expect(request?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Retale-Base-Revision': '7',
      'X-Retale-Revision-Novel-Id': 'novel-1',
    })
    expect((request?.headers as Record<string, string>)['Idempotency-Key']).toEqual(expect.any(String))
    expect(JSON.parse(String(request?.body))).toEqual({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      content: '<p>Second edit</p>',
      wordCount: 3,
      updatedAtLabel: useNovelStore.getState().localChapters[0]?.updatedAt,
    })
  })

  it('keeps chapter autosave on PATCH after an authoritative knowledge projection refresh', async () => {
    await hydrate()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      localCharacters: [{
        id: 'character-1',
        novelId: 'novel-1',
        name: 'Projection character',
        role: 'Lead',
        goal: '',
        trait: '',
        note: '',
      }],
    }), { status: 200 })))
    await useNovelStore.getState().refreshKnowledgeProjection('novel-1', 1)
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Edited after projection</p>', 3)

    const fetchMock = vi.fn<typeof fetch>(async () => mutationSuccess(8))
    vi.stubGlobal('fetch', fetchMock)
    await useNovelStore.getState().saveToBackend()

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/chapters/chapter-1')
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PATCH')
    expect(useNovelStore.getState().lastAcknowledgedPersistedWorkspace?.localCharacters).toEqual([
      expect.objectContaining({ id: 'character-1', name: 'Projection character' }),
    ])
  })

  it('merges a PATCH acknowledgement into a newer authoritative projection baseline', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Pending chapter edit</p>', 3)
    const saveRequest = Promise.withResolvers<Response>()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => saveRequest.promise))

    const save = useNovelStore.getState().saveToBackend()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      localWorldEntries: [{
        id: 'world-1',
        novelId: 'novel-1',
        title: 'Projection world',
        type: 'location',
        content: 'Server-side projection',
      }],
    }), { status: 200 })))
    await useNovelStore.getState().refreshKnowledgeProjection('novel-1', 1)
    saveRequest.resolve(mutationSuccess(8))
    await save

    const acknowledged = useNovelStore.getState().lastAcknowledgedPersistedWorkspace
    expect(acknowledged?.localChapters[0]?.content).toBe('<p>Pending chapter edit</p>')
    expect(acknowledged?.localWorldEntries).toEqual([
      expect.objectContaining({ id: 'world-1', title: 'Projection world' }),
    ])
  })

  it.each([
    ['structural change', () => useNovelStore.getState().createNewChapter()],
    ['two chapter changes', () => {
      useNovelStore.getState().updateChapterContent('chapter-1', '<p>Edited one</p>', 2)
      useNovelStore.getState().updateChapterContent('chapter-2', '<p>Edited two</p>', 2)
    }],
  ])('uses revision-aware POST for %s', async (_name, mutate) => {
    await hydrate()
    mutate()
    const captured = serializeState(useNovelStore.getState())
    const fetchMock = vi.fn<typeof fetch>(async () => mutationSuccess(8))
    vi.stubGlobal('fetch', fetchMock)

    await useNovelStore.getState().saveToBackend()

    const request = fetchMock.mock.calls[0]?.[1]
    expect(request?.method).toBe('POST')
    expect(request?.headers).toMatchObject({
      'X-Retale-Base-Revision': '7',
      'X-Retale-Revision-Novel-Id': 'novel-1',
    })
    const sent = JSON.parse(String(request?.body))
    const baseline = createWorkspace()
    // Resolve preservation markers as the server does, then compare the complete intended snapshot.
    sent.localChapters = sent.localChapters.map((chapter: PersistedNovelState['localChapters'][number]) => {
      if (chapter.contentLoaded !== false) return chapter
      const stored = baseline.localChapters.find((item) => item.id === chapter.id)!
      const hydrated = { ...chapter, content: stored.content, originalContent: stored.originalContent }
      delete hydrated.contentLoaded
      return hydrated
    })
    expect(sent).toEqual(captured)
  })

  it.each([
    ['missing revision', { workspaceRevision: null, revisionNovelId: 'novel-1', lastAcknowledgedPersistedWorkspace: createWorkspace() }],
    ['owner mismatch', { workspaceRevision: 7, revisionNovelId: 'novel-other', lastAcknowledgedPersistedWorkspace: createWorkspace() }],
    ['no baseline', { workspaceRevision: 7, revisionNovelId: 'novel-1', lastAcknowledgedPersistedWorkspace: null }],
    ['baseline mismatch', { workspaceRevision: 7, revisionNovelId: 'novel-1', lastAcknowledgedPersistedWorkspace: { ...createWorkspace(), currentNovelId: 'novel-other' } }],
  ])('refuses saving with %s and preserves local edits without fetching authority', async (_name, authority) => {
    useNovelStore.getState().restorePersistedState(createWorkspace())
    useNovelStore.setState({ ...authority, backendLoaded: true })
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Unsaved draft</p>', 2)
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    await expect(useNovelStore.getState().saveToBackend()).rejects.toMatchObject({ code: 'authority-required' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useNovelStore.getState().localChapters[0]?.content).toBe('<p>Unsaved draft</p>')
    expect(useNovelStore.getState().workspaceSaveFeedback).toEqual({ kind: 'save-failed' })
  })

  it('refuses autosave while hydration is pending and clears authority when switching novels', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Draft</p>', 2)
    useNovelStore.setState({ backendLoaded: false })
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    await expect(useNovelStore.getState().saveToBackend({ lifecycle: true })).rejects.toMatchObject({ code: 'authority-required' })
    expect(fetchMock).not.toHaveBeenCalled()
    useNovelStore.getState().setCurrentNovelId('novel-other')
    expect(useNovelStore.getState()).toMatchObject({ workspaceRevision: null, revisionNovelId: '', lastAcknowledgedPersistedWorkspace: null, backendLoaded: false })
  })

  it('does not send saves for an empty library', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    await useNovelStore.getState().saveToBackend()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts replay success and advances acknowledgement from the sent snapshot', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Sent</p>', 2)
    const sent = serializeState(useNovelStore.getState())
    vi.stubGlobal('fetch', vi.fn(async () => mutationSuccess(8, true)))

    await useNovelStore.getState().saveToBackend()

    expect(useNovelStore.getState()).toMatchObject({
      workspaceRevision: 8,
      revisionNovelId: 'novel-1',
      lastAcknowledgedPersistedWorkspace: sent,
    })
  })

  it('retries an indeterminate PATCH once with the exact same envelope and accepts replay success', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Sent</p>', 2)
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce(mutationSuccess(8, true))
    vi.stubGlobal('fetch', fetchMock)

    await useNovelStore.getState().saveToBackend()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = fetchMock.mock.calls[0]?.[1]
    const second = fetchMock.mock.calls[1]?.[1]
    expect(first?.headers).toMatchObject({ 'X-Retale-Revision-Novel-Id': 'novel-1' })
    expect(second?.method).toBe(first?.method)
    expect(second?.body).toBe(first?.body)
    expect(second?.headers).toEqual(first?.headers)
    expect(useNovelStore.getState().workspaceSaveFeedback).toBeNull()
  })

  it('retries an indeterminate revision-aware POST once with the exact same envelope', async () => {
    await hydrate()
    useNovelStore.getState().createNewChapter()
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce(mutationSuccess(8, true))
    vi.stubGlobal('fetch', fetchMock)

    await useNovelStore.getState().saveToBackend()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-Retale-Revision-Novel-Id': 'novel-1' })
    expectSameMutationEnvelope(fetchMock.mock.calls[0]?.[1], fetchMock.mock.calls[1]?.[1])
  })

  it('retries malformed revision-aware POST success once with the exact same envelope', async () => {
    await hydrate()
    useNovelStore.getState().createNewChapter()
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, novelId: 'novel-1', revision: 8 }), { status: 200 }))
      .mockResolvedValueOnce(mutationSuccess(8, true))
    vi.stubGlobal('fetch', fetchMock)

    await useNovelStore.getState().saveToBackend()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expectSameMutationEnvelope(fetchMock.mock.calls[0]?.[1], fetchMock.mock.calls[1]?.[1])
  })


  it('does not retry an explicit revision-aware POST rejection', async () => {
    await hydrate()
    useNovelStore.getState().createNewChapter()
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: false, error: 'rejected' }), { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(useNovelStore.getState().saveToBackend()).rejects.toMatchObject({ code: 'http-rejected' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses a new key when a later changed payload is saved', async () => {
    await hydrate()
    let revision = 8
    const fetchMock = vi.fn<typeof fetch>(async () => mutationSuccess(revision++))
    vi.stubGlobal('fetch', fetchMock)

    useNovelStore.getState().updateChapterContent('chapter-1', '<p>First</p>', 2)
    await useNovelStore.getState().saveToBackend()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Second</p>', 3)
    await useNovelStore.getState().saveToBackend()

    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>
    expect(secondHeaders['Idempotency-Key']).not.toBe(firstHeaders['Idempotency-Key'])
    expect(fetchMock.mock.calls[1]?.[1]?.body).not.toBe(fetchMock.mock.calls[0]?.[1]?.body)
  })

  it('stops after two indeterminate PATCH attempts and keeps local edits', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Local</p>', 2)
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(useNovelStore.getState().saveToBackend()).rejects.toMatchObject({
      code: 'transport-indeterminate',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(useNovelStore.getState().localChapters[0]?.content).toBe('<p>Local</p>')
    expect(useNovelStore.getState().workspaceSaveFeedback).toEqual({ kind: 'save-failed' })
  })

  it('times out and retries a revision-aware PATCH once with the same mutation envelope', async () => {
    vi.useFakeTimers()
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Timed out</p>', 2)
    const fetchMock = vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('Aborted')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const save = useNovelStore.getState().saveToBackend()
    const saveExpectation = expect(save).rejects.toMatchObject({ code: 'transport-indeterminate' })
    await vi.advanceTimersByTimeAsync(30_000)
    await saveExpectation

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = fetchMock.mock.calls[0]?.[1]
    const second = fetchMock.mock.calls[1]?.[1]
    expect(second?.method).toBe(first?.method)
    expect(second?.body).toBe(first?.body)
    expect(second?.headers).toEqual(first?.headers)
    expect(second?.signal).not.toBe(first?.signal)
  })

  it('uses keepalive for a lifecycle PATCH below the safe body limit', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Lifecycle</p>', 1)
    const fetchMock = vi.fn<typeof fetch>(async () => mutationSuccess(8))
    vi.stubGlobal('fetch', fetchMock)

    await useNovelStore.getState().saveToBackend({ lifecycle: true })

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PATCH', keepalive: true })
  })

  it('disables keepalive when a lifecycle mutation exceeds the safe body limit', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', `<p>${'x'.repeat(70_000)}</p>`, 1)
    const fetchMock = vi.fn<typeof fetch>(async () => mutationSuccess(8))
    vi.stubGlobal('fetch', fetchMock)

    await useNovelStore.getState().saveToBackend({ lifecycle: true })

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PATCH', keepalive: false })
  })

  it.each([405, 409, 500, 501])('does not fall back from explicit PATCH status %s', async (status) => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Local</p>', 2)
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: false, error: 'rejected' }), { status }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(useNovelStore.getState().saveToBackend()).rejects.toBeInstanceOf(WorkspaceSaveError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PATCH')
  })

  it('retries malformed PATCH success once without POST fallback', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Local</p>', 2)
    const malformed = () => new Response(JSON.stringify({ ok: true, novelId: 'novel-1', revision: 8 }), { status: 200 })
    const fetchMock = vi.fn<typeof fetch>(async () => malformed())
    vi.stubGlobal('fetch', fetchMock)

    await expect(useNovelStore.getState().saveToBackend()).rejects.toMatchObject({ code: 'invalid-response' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === 'PATCH')).toBe(true)
  })

  it('preserves live local edits and advances only authoritative baseline metadata on stale PATCH', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Rejected local</p>', 2)
    const rejectedPersistRevision = useNovelStore.getState().persistRevision
    const authoritativeChapter = { ...createWorkspace().localChapters[0]!, content: '<p>Server</p>', wordCount: 4, updatedAt: 'server' }
    vi.stubGlobal('fetch', vi.fn(async () => staleResponse(9, authoritativeChapter)))

    await expect(useNovelStore.getState().saveToBackend()).rejects.toMatchObject({ code: 'stale-revision' })

    const state = useNovelStore.getState()
    expect(state.localChapters[0]?.content).toBe('<p>Rejected local</p>')
    expect(state.workspaceRevision).toBe(9)
    expect(state.lastAcknowledgedPersistedWorkspace?.localChapters[0]).toEqual(authoritativeChapter)
    expect(state.persistRevision).toBe(rejectedPersistRevision)
    expect(state.workspaceSaveConflict).toMatchObject({ kind: 'chapter', chapterId: 'chapter-1', currentRevision: 9 })
    expect(state.workspaceSaveFeedback).toEqual({ kind: 'chapter-conflict' })
  })

  it('suppresses an unchanged conflicted chapter and later PATCHes a pure edit from current revision', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Rejected local</p>', 2)
    const authoritativeChapter = { ...createWorkspace().localChapters[0]!, content: '<p>Server</p>', wordCount: 4, updatedAt: 'server' }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(staleResponse(9, authoritativeChapter))
    vi.stubGlobal('fetch', fetchMock)
    await expect(useNovelStore.getState().saveToBackend()).rejects.toMatchObject({ code: 'stale-revision' })

    await expect(useNovelStore.getState().saveToBackend()).rejects.toMatchObject({ code: 'stale-revision' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Reconciled edit</p>', 3)
    fetchMock.mockResolvedValueOnce(mutationSuccess(10))
    await useNovelStore.getState().saveToBackend()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PATCH')
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ 'X-Retale-Base-Revision': '9' })
    expect(useNovelStore.getState().workspaceSaveConflict).toBeNull()
    expect(useNovelStore.getState().workspaceSaveFeedback).toBeNull()
  })

  it('blocks structural deltas during a chapter conflict without sending POST', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Rejected local</p>', 2)
    const authoritativeChapter = { ...createWorkspace().localChapters[0]!, content: '<p>Server</p>' }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(staleResponse(9, authoritativeChapter))
    vi.stubGlobal('fetch', fetchMock)
    await expect(useNovelStore.getState().saveToBackend()).rejects.toMatchObject({ code: 'stale-revision' })

    useNovelStore.getState().createNewChapter()
    await expect(useNovelStore.getState().saveToBackend()).rejects.toMatchObject({ code: 'conflict-blocked' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useNovelStore.getState().workspaceSaveFeedback).toEqual({ kind: 'structural-conflict' })
  })

  it('blocks stale revision-aware POST without legacy fallback or local overwrite', async () => {
    await hydrate()
    useNovelStore.getState().createNewChapter()
    const localChapterIds = useNovelStore.getState().localChapters.map((chapter) => chapter.id)
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      ok: false,
      code: 'stale_revision',
      error: 'raw conflict',
      currentRevision: 9,
    }), { status: 409 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(useNovelStore.getState().saveToBackend()).rejects.toMatchObject({ code: 'conflict-blocked' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(useNovelStore.getState().localChapters.map((chapter) => chapter.id)).toEqual(localChapterIds)
    expect(useNovelStore.getState().workspaceSaveConflict).toMatchObject({ kind: 'structural', currentRevision: 9 })
  })

  it('rejects malformed success without acknowledging it', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Sent</p>', 2)
    const baseline = useNovelStore.getState().lastAcknowledgedPersistedWorkspace
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, novelId: 'novel-1', revision: 8 }), { status: 200 })))

    await expect(useNovelStore.getState().saveToBackend()).rejects.toThrow('invalid revision acknowledgement')
    expect(useNovelStore.getState().workspaceRevision).toBe(7)
    expect(useNovelStore.getState().lastAcknowledgedPersistedWorkspace).toBe(baseline)
  })

  it('preserves a newer edit made while the acknowledged request is in flight', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Sent</p>', 2)
    const sent = serializeState(useNovelStore.getState())
    let resolveRequest!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveRequest = resolve })))

    const save = useNovelStore.getState().saveToBackend()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Newer</p>', 3)
    resolveRequest(mutationSuccess(8))
    await save

    const state = useNovelStore.getState()
    expect(state.localChapters[0]?.content).toBe('<p>Newer</p>')
    expect(state.lastAcknowledgedPersistedWorkspace).toEqual(sent)
    expect(state.persistRevision).toBe(2)
  })

  it('keeps newer success authoritative when older stale and failure outcomes arrive later', async () => {
    await hydrate()
    const firstRequest = Promise.withResolvers<Response>()
    const secondRequest = Promise.withResolvers<Response>()
    const thirdRequest = Promise.withResolvers<Response>()
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise)
      .mockImplementationOnce(() => thirdRequest.promise)
    vi.stubGlobal('fetch', fetchMock)

    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Older stale</p>', 2)
    const olderStale = useNovelStore.getState().saveToBackend()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Older failure</p>', 3)
    const olderFailure = useNovelStore.getState().saveToBackend()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Newest success</p>', 4)
    const newestSnapshot = serializeState(useNovelStore.getState())
    const newestSuccess = useNovelStore.getState().saveToBackend()

    thirdRequest.resolve(mutationSuccess(10))
    await newestSuccess
    expect(useNovelStore.getState()).toMatchObject({
      workspaceRevision: 10,
      lastAcknowledgedPersistedWorkspace: newestSnapshot,
      workspaceSaveConflict: null,
      workspaceSaveFeedback: null,
      isSaving: true,
    })

    firstRequest.resolve(staleResponse(9, createWorkspace().localChapters[0]!))
    await expect(olderStale).rejects.toMatchObject({ code: 'stale-revision' })
    secondRequest.resolve(new Response(JSON.stringify({ ok: false, error: 'older failure' }), { status: 500 }))
    await expect(olderFailure).rejects.toMatchObject({ code: 'http-rejected' })

    expect(useNovelStore.getState()).toMatchObject({
      workspaceRevision: 10,
      lastAcknowledgedPersistedWorkspace: newestSnapshot,
      workspaceSaveConflict: null,
      workspaceSaveFeedback: null,
      isSaving: false,
    })
  })

  it('keeps a newer conflict when an older success arrives later', async () => {
    await hydrate()
    const olderRequest = Promise.withResolvers<Response>()
    const newerRequest = Promise.withResolvers<Response>()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockImplementationOnce(() => olderRequest.promise)
      .mockImplementationOnce(() => newerRequest.promise))

    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Older</p>', 2)
    const olderSave = useNovelStore.getState().saveToBackend()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Newer rejected</p>', 3)
    const newerSave = useNovelStore.getState().saveToBackend()
    const authoritativeChapter = { ...createWorkspace().localChapters[0]!, content: '<p>Server</p>', updatedAt: 'server' }

    newerRequest.resolve(staleResponse(9, authoritativeChapter))
    await expect(newerSave).rejects.toMatchObject({ code: 'stale-revision' })
    olderRequest.resolve(mutationSuccess(8))
    await olderSave

    expect(useNovelStore.getState()).toMatchObject({
      workspaceRevision: 9,
      workspaceSaveConflict: { kind: 'chapter', currentRevision: 9 },
      workspaceSaveFeedback: { kind: 'chapter-conflict' },
      isSaving: false,
    })
    expect(useNovelStore.getState().lastAcknowledgedPersistedWorkspace?.localChapters[0]).toEqual(authoritativeChapter)
  })

  it('keeps authoritative conflict feedback when a later-started generic failure resolves afterward', async () => {
    await hydrate()
    const conflictRequest = Promise.withResolvers<Response>()
    const failureRequest = Promise.withResolvers<Response>()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockImplementationOnce(() => conflictRequest.promise)
      .mockImplementationOnce(() => failureRequest.promise))

    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Conflict</p>', 2)
    const conflictSave = useNovelStore.getState().saveToBackend()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Later failure</p>', 3)
    const failureSave = useNovelStore.getState().saveToBackend()
    const authoritativeChapter = { ...createWorkspace().localChapters[0]!, content: '<p>Server</p>', updatedAt: 'server' }

    conflictRequest.resolve(staleResponse(9, authoritativeChapter))
    await expect(conflictSave).rejects.toMatchObject({ code: 'stale-revision' })
    failureRequest.resolve(new Response(JSON.stringify({ ok: false, error: 'later failure' }), { status: 500 }))
    await expect(failureSave).rejects.toMatchObject({ code: 'http-rejected' })

    expect(useNovelStore.getState()).toMatchObject({
      workspaceSaveConflict: { kind: 'chapter', currentRevision: 9 },
      workspaceSaveFeedback: { kind: 'chapter-conflict' },
      isSaving: false,
    })
  })

  it('ignores equal-revision delayed success from before same-novel authoritative hydration', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Pre-hydration save</p>', 2)
    const saveRequest = Promise.withResolvers<Response>()
    const hydratedWorkspace = createWorkspace()
    hydratedWorkspace.localChapters[0] = {
      ...hydratedWorkspace.localChapters[0]!,
      content: '<p>Hydrated authority</p>',
      updatedAt: 'hydrated',
    }
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => saveRequest.promise)
      .mockImplementationOnce(async (input) => {
        if (new URL(String(input), 'http://localhost').pathname === '/api/novels/novel-1') return revisionResponse(hydratedWorkspace, 8)
        if (String(input) === '/api/settings/ai') return new Response(JSON.stringify({}), { status: 200 })
        throw new Error(`Unexpected fetch: ${String(input)}`)
      })
      .mockImplementationOnce(async (input) => {
        if (String(input) === '/api/settings/ai') return new Response(JSON.stringify({}), { status: 200 })
        throw new Error(`Unexpected fetch: ${String(input)}`)
      })
    vi.stubGlobal('fetch', fetchMock)

    const delayedSave = useNovelStore.getState().saveToBackend()
    resetClientRequestBrokerForTests()
    await useNovelStore.getState().loadFromBackend('novel-1')
    expect(useNovelStore.getState().lastAcknowledgedPersistedWorkspace).toEqual(hydratedWorkspace)

    saveRequest.resolve(mutationSuccess(8))
    await delayedSave

    expect(useNovelStore.getState().lastAcknowledgedPersistedWorkspace).toEqual(hydratedWorkspace)
    expect(useNovelStore.getState().workspaceSaveFeedback).toBeNull()
  })

  it('ignores delayed generic failure feedback from before authoritative hydration', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Pre-hydration failure</p>', 2)
    const saveRequest = Promise.withResolvers<Response>()
    const hydratedWorkspace = createWorkspace()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockImplementationOnce(() => saveRequest.promise)
      .mockImplementationOnce(async (input) => {
        if (new URL(String(input), 'http://localhost').pathname === '/api/novels/novel-1') return revisionResponse(hydratedWorkspace, 8)
        if (String(input) === '/api/settings/ai') return new Response(JSON.stringify({}), { status: 200 })
        throw new Error(`Unexpected fetch: ${String(input)}`)
      })
      .mockImplementationOnce(async (input) => {
        if (String(input) === '/api/settings/ai') return new Response(JSON.stringify({}), { status: 200 })
        throw new Error(`Unexpected fetch: ${String(input)}`)
      }))

    const delayedSave = useNovelStore.getState().saveToBackend()
    resetClientRequestBrokerForTests()
    await useNovelStore.getState().loadFromBackend('novel-1')
    saveRequest.resolve(new Response(JSON.stringify({ ok: false, error: 'delayed failure' }), { status: 500 }))
    await expect(delayedSave).rejects.toMatchObject({ code: 'http-rejected' })

    expect(useNovelStore.getState().workspaceSaveFeedback).toBeNull()
    expect(useNovelStore.getState().lastAcknowledgedPersistedWorkspace).toEqual(hydratedWorkspace)
  })

  it('fences delayed success from before same-novel authoritative hydration', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Committed after GET</p>', 2)
    const saveRequest = Promise.withResolvers<Response>()
    const hydratedWorkspace = createWorkspace()
    hydratedWorkspace.localChapters[0] = {
      ...hydratedWorkspace.localChapters[0]!,
      content: '<p>GET raced before commit</p>',
      updatedAt: 'hydrated',
    }
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockImplementationOnce(() => saveRequest.promise)
      .mockImplementationOnce(async (input) => {
        if (new URL(String(input), 'http://localhost').pathname === '/api/novels/novel-1') return revisionResponse(hydratedWorkspace, 7)
        if (String(input) === '/api/settings/ai') return new Response(JSON.stringify({}), { status: 200 })
        throw new Error(`Unexpected fetch: ${String(input)}`)
      })
      .mockImplementationOnce(async (input) => {
        if (String(input) === '/api/settings/ai') return new Response(JSON.stringify({}), { status: 200 })
        throw new Error(`Unexpected fetch: ${String(input)}`)
      }))

    const delayedSave = useNovelStore.getState().saveToBackend()
    resetClientRequestBrokerForTests()
    await useNovelStore.getState().loadFromBackend('novel-1')
    saveRequest.resolve(mutationSuccess(8))
    await delayedSave

    expect(useNovelStore.getState()).toMatchObject({
      workspaceRevision: 7,
      lastAcknowledgedPersistedWorkspace: hydratedWorkspace,
      workspaceSaveFeedback: null,
    })
  })






  it('removes a server-deleted chapter only from the baseline and blocks automatic recreation', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Locally retained</p>', 2)
    const rejectedPersistRevision = useNovelStore.getState().persistRevision
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(staleResponse(9, null))
    vi.stubGlobal('fetch', fetchMock)

    await expect(useNovelStore.getState().saveToBackend()).rejects.toMatchObject({ code: 'stale-revision' })

    const conflicted = useNovelStore.getState()
    expect(conflicted.localChapters[0]?.content).toBe('<p>Locally retained</p>')
    expect(conflicted.lastAcknowledgedPersistedWorkspace?.localChapters.map((chapter) => chapter.id)).toEqual(['chapter-2'])
    expect(conflicted.persistRevision).toBe(rejectedPersistRevision)

    await expect(useNovelStore.getState().saveToBackend()).rejects.toMatchObject({ code: 'conflict-blocked' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PATCH')
  })

  it('rejects targeted hydration with missing or mismatched authority', async () => {
    const workspace = createWorkspace()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(workspace), { status: 200 })))
    await expect(useNovelStore.getState().loadFromBackend('novel-1')).rejects.toThrow('invalid revision authority')

    resetClientRequestBrokerForTests()
    vi.stubGlobal('fetch', vi.fn(async () => revisionResponse({
      ...workspace,
      workspaceRevision: 2,
      revisionNovelId: 'novel-other',
    }, 2, 'novel-other')))
    await expect(useNovelStore.getState().loadFromBackend('novel-1')).rejects.toThrow('invalid revision authority')
  })
})
