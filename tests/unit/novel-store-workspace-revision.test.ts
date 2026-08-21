import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersistedNovelState } from '@/lib/types'
import { createEmptyWorkspaceState } from '@/lib/workspace-state'
import { resetClientRequestBrokerForTests } from '@/lib/client-request-broker'
import { serializeState } from '@/store/novel-store-persistence'
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
    patchCapability: 'unknown',
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
    if (url === '/api/novels/novel-1') {
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
    for (const snapshot of [serializeState(state), state.snapshotPersistedState(), JSON.parse(state.exportWorkspace())]) {
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
      if (url === '/api/novels/novel-1') {
        return new Response(JSON.stringify({ ...workspace, workspaceRevision: 6, revisionNovelId: 'novel-1' }), { status: 200 })
      }
      if (url === '/api/settings/ai') return new Response(JSON.stringify({}), { status: 200 })
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await useNovelStore.getState().loadFromBackend('novel-1')

    expect(useNovelStore.getState()).toMatchObject({ workspaceRevision: 6, revisionNovelId: 'novel-1' })
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
    expect(JSON.parse(String(request?.body))).toEqual(captured)
  })

  it.each([
    ['owner mismatch', { workspaceRevision: 7, revisionNovelId: 'novel-other', lastAcknowledgedPersistedWorkspace: createWorkspace() }],
    ['no baseline', { workspaceRevision: 7, revisionNovelId: 'novel-1', lastAcknowledgedPersistedWorkspace: null }],
  ])('retains legacy POST compatibility for %s', async (_name, authority) => {
    useNovelStore.getState().restorePersistedState(createWorkspace())
    useNovelStore.setState(authority)
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await useNovelStore.getState().saveToBackend()

    const request = fetchMock.mock.calls[0]?.[1]
    expect(request?.method).toBe('POST')
    expect(request?.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('adopts a canonical acknowledgement returned by a legacy POST', async () => {
    const workspace = createWorkspace()
    useNovelStore.getState().restorePersistedState(workspace)
    vi.stubGlobal('fetch', vi.fn(async () => revisionResponse({
      ok: true,
      operation: 'full-snapshot',
      novelId: 'novel-1',
      revision: 1,
      updatedAt: 'server-time',
      replayed: false,
      shouldScheduleKnowledgeSync: true,
    }, 1)))

    await useNovelStore.getState().saveToBackend()

    expect(useNovelStore.getState()).toMatchObject({
      workspaceRevision: 1,
      revisionNovelId: 'novel-1',
      lastAcknowledgedPersistedWorkspace: workspace,
    })
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

  it('does not retry an authorityless legacy POST and classifies transport failure as indeterminate', async () => {
    useNovelStore.getState().restorePersistedState(createWorkspace())
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(useNovelStore.getState().saveToBackend()).rejects.toMatchObject({
      code: 'transport-indeterminate',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useNovelStore.getState().workspaceSaveFeedback).toEqual({ kind: 'save-failed' })
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

  it.each([405, 501])('falls back from PATCH status %s to one revision-aware POST with a new key', async (status) => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Local</p>', 2)
    const captured = serializeState(useNovelStore.getState())
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'unsupported' }), { status }))
      .mockResolvedValueOnce(mutationSuccess(8))
    vi.stubGlobal('fetch', fetchMock)

    await useNovelStore.getState().saveToBackend()

    const patch = fetchMock.mock.calls[0]?.[1]
    const post = fetchMock.mock.calls[1]?.[1]
    expect(patch?.method).toBe('PATCH')
    expect(post?.method).toBe('POST')
    expect(JSON.parse(String(post?.body))).toEqual(captured)
    expect((post?.headers as Record<string, string>)['X-Retale-Base-Revision']).toBe('7')
    expect((patch?.headers as Record<string, string>)['X-Retale-Revision-Novel-Id']).toBe('novel-1')
    expect((post?.headers as Record<string, string>)['X-Retale-Revision-Novel-Id']).toBe('novel-1')
    expect((post?.headers as Record<string, string>)['Idempotency-Key']).not.toBe((patch?.headers as Record<string, string>)['Idempotency-Key'])
    expect(useNovelStore.getState().patchCapability).toBe('unsupported')
  })

  it('retries an indeterminate fallback POST once with the exact same envelope', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Local</p>', 2)
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'unsupported' }), { status: 405 }))
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce(mutationSuccess(8, true))
    vi.stubGlobal('fetch', fetchMock)

    await useNovelStore.getState().saveToBackend()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('POST')
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ 'X-Retale-Revision-Novel-Id': 'novel-1' })
    expectSameMutationEnvelope(fetchMock.mock.calls[1]?.[1], fetchMock.mock.calls[2]?.[1])
  })

  it('uses revision-aware POST for future chapter saves when PATCH is unsupported', async () => {
    await hydrate()
    useNovelStore.setState({ patchCapability: 'unsupported' })
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Local</p>', 2)
    const fetchMock = vi.fn<typeof fetch>(async () => mutationSuccess(8))
    vi.stubGlobal('fetch', fetchMock)

    await useNovelStore.getState().saveToBackend()

    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      'X-Retale-Base-Revision': '7',
      'X-Retale-Revision-Novel-Id': 'novel-1',
    })
  })

  it.each([409, 500])('does not fall back from explicit PATCH status %s', async (status) => {
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
    const delayedSaveSnapshot = serializeState(useNovelStore.getState())
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
        if (String(input) === '/api/novels/novel-1') return revisionResponse(hydratedWorkspace, 8)
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
    expect(useNovelStore.getState().lastAcknowledgedPersistedWorkspace).not.toEqual(delayedSaveSnapshot)
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
        if (String(input) === '/api/novels/novel-1') return revisionResponse(hydratedWorkspace, 8)
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

  it('accepts strictly higher delayed success from before same-novel authoritative hydration', async () => {
    await hydrate()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Committed after GET</p>', 2)
    const delayedSaveSnapshot = serializeState(useNovelStore.getState())
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
        if (String(input) === '/api/novels/novel-1') return revisionResponse(hydratedWorkspace, 7)
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
      workspaceRevision: 8,
      lastAcknowledgedPersistedWorkspace: delayedSaveSnapshot,
      workspaceSaveFeedback: null,
    })
  })

  it('keeps unsupported PATCH capability sticky when an older PATCH resolves later', async () => {
    await hydrate()
    const olderRequest = Promise.withResolvers<Response>()
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => olderRequest.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'unsupported' }), { status: 405 }))
      .mockResolvedValueOnce(mutationSuccess(8))
    vi.stubGlobal('fetch', fetchMock)

    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Older</p>', 2)
    const olderSave = useNovelStore.getState().saveToBackend()
    useNovelStore.getState().updateChapterContent('chapter-1', '<p>Newer</p>', 3)
    const newerSave = useNovelStore.getState().saveToBackend()

    await newerSave
    expect(useNovelStore.getState().patchCapability).toBe('unsupported')
    olderRequest.resolve(mutationSuccess(8))
    await olderSave

    expect(useNovelStore.getState().patchCapability).toBe('unsupported')
  })

  it('transfers canonical authority from the unchanged prior owner to the current novel', async () => {
    const workspace = createWorkspace()
    const nextNovel = { id: 'novel-2', title: 'Next', summary: '', tags: [] }
    useNovelStore.getState().restorePersistedState({
      ...workspace,
      currentNovelId: 'novel-2',
      currentChapterId: '',
      localNovels: [...workspace.localNovels, nextNovel],
    })
    useNovelStore.setState({
      workspaceRevision: 7,
      revisionNovelId: 'novel-1',
      lastAcknowledgedPersistedWorkspace: workspace,
    })
    const sent = serializeState(useNovelStore.getState())
    vi.stubGlobal('fetch', vi.fn(async () => revisionResponse({
      ok: true,
      operation: 'full-snapshot',
      novelId: 'novel-2',
      revision: 1,
      updatedAt: 'server-time',
      replayed: false,
      shouldScheduleKnowledgeSync: true,
    }, 1, 'novel-2')))

    await useNovelStore.getState().saveToBackend()

    expect(useNovelStore.getState()).toMatchObject({
      workspaceRevision: 1,
      revisionNovelId: 'novel-2',
      lastAcknowledgedPersistedWorkspace: sent,
    })
  })

  it('fences canonical authority transfer after hydration changes the authority epoch', async () => {
    const workspace = createWorkspace()
    const nextChapter = {
      ...workspace.localChapters[0]!,
      id: 'chapter-next',
      novelId: 'novel-2',
    }
    const switchedWorkspace = {
      ...workspace,
      currentNovelId: 'novel-2',
      currentChapterId: nextChapter.id,
      localNovels: [...workspace.localNovels, { id: 'novel-2', title: 'Next', summary: '', tags: [] }],
      localChapters: [...workspace.localChapters, nextChapter],
    }
    useNovelStore.getState().restorePersistedState(switchedWorkspace)
    useNovelStore.setState({ workspaceRevision: 7, revisionNovelId: 'novel-1', lastAcknowledgedPersistedWorkspace: workspace })
    const saveRequest = Promise.withResolvers<Response>()
    const hydratedWorkspace = { ...switchedWorkspace, localNovels: switchedWorkspace.localNovels.map((novel) => ({ ...novel })) }
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => saveRequest.promise)
      .mockImplementationOnce(async (input) => {
        if (String(input) === '/api/novels/novel-2') return revisionResponse(hydratedWorkspace, 4, 'novel-2')
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
    await useNovelStore.getState().loadFromBackend('novel-2')
    const hydratedBaseline = useNovelStore.getState().lastAcknowledgedPersistedWorkspace
    saveRequest.resolve(revisionResponse({ ok: true, novelId: 'novel-2', revision: 5 }, 5, 'novel-2'))
    await delayedSave

    expect(useNovelStore.getState()).toMatchObject({ workspaceRevision: 4, revisionNovelId: 'novel-2' })
    expect(useNovelStore.getState().lastAcknowledgedPersistedWorkspace).toBe(hydratedBaseline)
  })

  it('fences canonical authority transfer after switching away from the captured novel', async () => {
    const workspace = createWorkspace()
    useNovelStore.getState().restorePersistedState({ ...workspace, currentNovelId: 'novel-2', currentChapterId: '' })
    useNovelStore.setState({ workspaceRevision: 7, revisionNovelId: 'novel-1', lastAcknowledgedPersistedWorkspace: workspace })
    const saveRequest = Promise.withResolvers<Response>()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => saveRequest.promise))

    const delayedSave = useNovelStore.getState().saveToBackend()
    useNovelStore.getState().setCurrentNovelId('novel-3')
    saveRequest.resolve(revisionResponse({ ok: true, novelId: 'novel-2', revision: 1 }, 1, 'novel-2'))
    await delayedSave

    expect(useNovelStore.getState()).toMatchObject({
      currentNovelId: 'novel-3',
      workspaceRevision: 7,
      revisionNovelId: 'novel-1',
    })
  })

  it('keeps the newer transferred authority when an older acknowledgement arrives later', async () => {
    const workspace = createWorkspace()
    const switchedWorkspace = {
      ...workspace,
      currentNovelId: 'novel-2',
      currentChapterId: '',
      localNovels: [...workspace.localNovels, { id: 'novel-2', title: 'Next', summary: '', tags: [] }],
    }
    useNovelStore.getState().restorePersistedState(switchedWorkspace)
    useNovelStore.setState({ workspaceRevision: 7, revisionNovelId: 'novel-1', lastAcknowledgedPersistedWorkspace: workspace })
    const olderRequest = Promise.withResolvers<Response>()
    const newerRequest = Promise.withResolvers<Response>()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockImplementationOnce(() => olderRequest.promise)
      .mockImplementationOnce(() => newerRequest.promise))

    const olderSave = useNovelStore.getState().saveToBackend()
    const newerSnapshot = serializeState(useNovelStore.getState())
    const newerSave = useNovelStore.getState().saveToBackend()
    newerRequest.resolve(revisionResponse({ ok: true, novelId: 'novel-2', revision: 2 }, 2, 'novel-2'))
    await newerSave
    olderRequest.resolve(revisionResponse({ ok: true, novelId: 'novel-2', revision: 1 }, 1, 'novel-2'))
    await olderSave

    expect(useNovelStore.getState()).toMatchObject({
      workspaceRevision: 2,
      revisionNovelId: 'novel-2',
      lastAcknowledgedPersistedWorkspace: newerSnapshot,
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
