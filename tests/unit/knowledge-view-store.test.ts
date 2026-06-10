import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNovelStore } from '@/store/novel-store'
import { fetchKnowledgeProjection } from '@/store/novel-store-knowledge'

function resetStore() {
  useNovelStore.getState().resetWorkspace()
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
})
