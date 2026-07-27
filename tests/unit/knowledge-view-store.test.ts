import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNovelStore } from '@/store/novel-store'
import { fetchKnowledgeProjection } from '@/store/novel-store-knowledge'

function resetStore() {
  useNovelStore.getState().resetWorkspace()
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function knowledgeProjectionResponse(marker?: string) {
  return new Response(JSON.stringify({
    ok: true,
    localOutlines: marker ? [{ id: `outline-${marker}`, novelId: 'novel-1', title: `Outline ${marker}`, type: 'foreshadow', summary: marker, relatedChapterIds: [] }] : [],
    localCharacters: marker ? [{ id: `char-${marker}`, novelId: 'novel-1', name: `Character ${marker}`, role: '主角', goal: marker, trait: marker, note: marker }] : [],
    localCharacterRelations: marker ? [{ id: `relation-${marker}`, novelId: 'novel-1', fromCharacterId: `char-${marker}`, toCharacterId: `char-${marker}`, label: marker, strength: 'weak', status: 'active', note: marker, chapterIds: [] }] : [],
    localWorldEntries: marker ? [{ id: `world-${marker}`, novelId: 'novel-1', title: `World ${marker}`, type: 'location', content: marker }] : [],
    localTimelineEvents: marker ? [{ id: `timeline-${marker}`, novelId: 'novel-1', title: `Timeline ${marker}`, phase: marker, worldline: '主线', summary: marker, order: 1, chapterIds: [] }] : [],
    knowledgeRebuildStatus: null,
    hanlpCacheSnapshot: null,
    knowledgeStatusOverview: null,
    jobOutcome: null,
    actionError: null,
  }), { status: 200 })
}

describe('knowledge view store lightweight action responses', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetStore()
    useNovelStore.setState({
      currentNovelId: 'novel-1',
      localChapters: [{
        id: 'chapter-1',
        novelId: 'novel-1',
        volumeId: '',
        title: 'Chapter 1',
        order: 1,
        content: '<p>Body</p>',
        originalContent: '<p>Body</p>',
        status: 'draft',
        wordCount: 1,
        updatedAt: 'now',
        trajectory: [],
        parentChapterId: null,
      }],
      localCharacters: [{ id: 'char-1', novelId: 'novel-1', name: 'Existing Character', role: '主角', goal: '目标', trait: '冷静', note: '保留' }],
      localCharacterRelations: [{ id: 'rel-1', novelId: 'novel-1', fromCharacterId: 'char-1', toCharacterId: 'char-1', label: '自我认知', strength: 'weak', status: 'active', note: '', chapterIds: [] }],
      localWorldEntries: [{ id: 'world-1', novelId: 'novel-1', title: '旧地点', type: 'location', content: '保留' }],
      localTimelineEvents: [{ id: 'event-1', novelId: 'novel-1', title: '旧事件', phase: '第一章', worldline: '主线', summary: '保留', order: 1, chapterIds: [] }],
      localOutlines: [{ id: 'outline-1', novelId: 'novel-1', title: '旧伏笔', type: 'foreshadow', summary: '保留', relatedChapterIds: [] }],
    })
  })

  it('keeps existing local knowledge arrays when rebuild-like POST actions return lightweight empty projections', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(JSON.stringify({
        ok: true,
        localOutlines: [],
        localCharacters: [],
        localCharacterRelations: [],
        localWorldEntries: [],
        localTimelineEvents: [],
        knowledgeRebuildStatus: {
          jobId: 'job-1',
          novelId: 'novel-1',
          jobType: 'extract_chapter_knowledge',
          status: 'queued',
          progress: 0,
          currentStep: null,
          createdAt: '2026-05-29T00:00:00.000Z',
          updatedAt: '2026-05-29T00:00:00.000Z',
          etaMinutes: null,
          steps: [],
        },
        hanlpCacheSnapshot: { status: 'queued' },
        knowledgeStatusOverview: null,
        jobOutcome: 'queued',
        actionError: null,
      }), { status: 200 })
    }))

    await useNovelStore.getState().rebuildStoryKnowledge('novel-1')
    await useNovelStore.getState().rebuildStoryRetrievalIndex('novel-1')
    await useNovelStore.getState().pauseStoryKnowledgeRebuild('novel-1')
    await useNovelStore.getState().abortStoryKnowledgeRebuild('novel-1')

    const state = useNovelStore.getState()
    expect(state.localCharacters).toEqual([
      expect.objectContaining({ id: 'char-1', novelId: 'novel-1', name: 'Existing Character' }),
    ])
    expect(state.localCharacterRelations).toEqual([
      expect.objectContaining({ id: 'rel-1', novelId: 'novel-1', label: '自我认知' }),
    ])
    expect(state.localWorldEntries).toEqual([
      expect.objectContaining({ id: 'world-1', novelId: 'novel-1', title: '旧地点' }),
    ])
    expect(state.localTimelineEvents).toEqual([
      expect.objectContaining({ id: 'event-1', novelId: 'novel-1', title: '旧事件' }),
    ])
    expect(state.localOutlines).toEqual([
      expect.objectContaining({ id: 'outline-1', novelId: 'novel-1', title: '旧伏笔' }),
    ])
  })

  it('clears stale local knowledge arrays when a completed rebuild returns an empty projection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(JSON.stringify({
        ok: true,
        localOutlines: [],
        localCharacters: [],
        localCharacterRelations: [],
        localWorldEntries: [],
        localTimelineEvents: [],
        knowledgeRebuildStatus: null,
        hanlpCacheSnapshot: { status: 'empty' },
        knowledgeStatusOverview: null,
        jobOutcome: 'completed',
        actionError: null,
      }), { status: 200 })
    }))

    await useNovelStore.getState().rebuildStoryKnowledge('novel-1')

    const state = useNovelStore.getState()
    expect(state.localCharacters.filter((item) => item.novelId === 'novel-1')).toEqual([])
    expect(state.localCharacterRelations.filter((item) => item.novelId === 'novel-1')).toEqual([])
    expect(state.localWorldEntries.filter((item) => item.novelId === 'novel-1')).toEqual([])
    expect(state.localTimelineEvents.filter((item) => item.novelId === 'novel-1')).toEqual([])
    expect(state.localOutlines.filter((item) => item.novelId === 'novel-1')).toEqual([])
  })

  it('appends statusOnly=1 only for GET status checks', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({
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
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchKnowledgeProjection({ novelId: 'novel-1', asOfChapter: 2, statusOnly: true })

    expect(fetchMock).toHaveBeenCalledWith('/api/knowledge-view?novelId=novel-1&asOfChapter=2&statusOnly=1', { cache: 'no-store' })
  })

  it('keeps POST knowledge actions unchanged when statusOnly is provided', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({
        ok: true,
        localOutlines: [],
        localCharacters: [],
        localCharacterRelations: [],
        localWorldEntries: [],
        localTimelineEvents: [],
        knowledgeRebuildStatus: null,
        hanlpCacheSnapshot: null,
        knowledgeStatusOverview: null,
        jobOutcome: 'queued',
        actionError: null,
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchKnowledgeProjection({ novelId: 'novel-1', method: 'POST', action: 'pause', statusOnly: true })

    expect(fetchMock).toHaveBeenCalledWith('/api/knowledge-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ novelId: 'novel-1', action: 'pause' }),
    })
  })

  it('returns the authoritative projection result from a full refresh', async () => {
    const knowledgeStatusOverview = {
      knowledgeGraph: { status: 'full' as const, coveredChapterCount: 64, totalChapterCount: 64, validThroughChapterNo: 64 },
      extractionCache: { status: 'full' as const, coveredChapterCount: 64, totalChapterCount: 64, validThroughChapterNo: 64 },
      embeddingCache: {
        status: 'full' as const,
        coveredChapterCount: 64,
        totalChapterCount: 64,
        validThroughChapterNo: 64,
        provider: 'ollama',
        model: 'qwen3-embedding:4b',
      },
      retrievalIndex: { status: 'full' as const, indexedScopeCount: 64, task: null },
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
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
    }), { status: 200 })))

    const result = await useNovelStore.getState().refreshKnowledgeProjection('novel-1', 64)

    expect(result.knowledgeStatusOverview).toEqual(knowledgeStatusOverview)
  })

  it('keeps the newest projection when refresh responses resolve out of order', async () => {
    const refreshAResponse = createDeferred<Response>()
    const refreshBResponse = createDeferred<Response>()
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(() => refreshAResponse.promise)
      .mockImplementationOnce(() => refreshBResponse.promise))

    const refreshA = useNovelStore.getState().refreshKnowledgeProjection('novel-1', 1)
    const refreshB = useNovelStore.getState().refreshKnowledgeProjection('novel-1', 2)

    refreshBResponse.resolve(knowledgeProjectionResponse('B'))
    await refreshB
    refreshAResponse.resolve(knowledgeProjectionResponse('A'))
    const staleResult = await refreshA

    const state = useNovelStore.getState()
    expect(state.localOutlines.map((item) => item.id)).toEqual(['outline-B'])
    expect(state.localCharacters.map((item) => item.id)).toEqual(['char-B'])
    expect(state.localCharacterRelations.map((item) => item.id)).toEqual(['relation-B'])
    expect(state.localWorldEntries.map((item) => item.id)).toEqual(['world-B'])
    expect(state.localTimelineEvents.map((item) => item.id)).toEqual(['timeline-B'])
    expect(staleResult.localCharacters.map((item) => item.id)).toEqual(['char-A'])
  })

  it('scopes an omitted-id refresh to the current novel and invalidates it after an explicit delete', async () => {
    const refreshResponse = createDeferred<Response>()
    const deleteResponse = createDeferred<Response>()
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => refreshResponse.promise)
      .mockImplementationOnce(() => deleteResponse.promise)
    vi.stubGlobal('fetch', fetchMock)

    const refresh = useNovelStore.getState().refreshKnowledgeProjection(undefined, 1)
    const deleteKnowledge = useNovelStore.getState().deleteStoryKnowledgeGraph('novel-1')

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/knowledge-view?novelId=novel-1&asOfChapter=1', { cache: 'no-store' })

    deleteResponse.resolve(knowledgeProjectionResponse())
    await deleteKnowledge
    refreshResponse.resolve(knowledgeProjectionResponse('stale'))
    await refresh

    const state = useNovelStore.getState()
    expect(state.localOutlines).toEqual([])
    expect(state.localCharacters).toEqual([])
    expect(state.localCharacterRelations).toEqual([])
    expect(state.localWorldEntries).toEqual([])
    expect(state.localTimelineEvents).toEqual([])
  })
})
