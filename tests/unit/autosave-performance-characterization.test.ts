import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { serializeState } from '@/store/novel-store-persistence'
import { useNovelStore } from '@/store/novel-store'
import {
  AUTOSAVE_EDIT_BURST_LENGTH,
  AUTOSAVE_PERFORMANCE_CHAPTER_COUNT,
  applyEditBurstToWorkspace,
  materializeAutosavePerformanceFixtures,
  writeAutosavePerformanceEvidence,
} from '@/tests/helpers/autosave-performance-fixtures'

describe('Phase 0 autosave payload characterization', () => {
  beforeEach(() => {
    useNovelStore.getState().resetWorkspace()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    useNovelStore.getState().resetWorkspace()
  })

  it('serializes and posts the complete 1,000-chapter workspace with the 10,000-character edit intact', async () => {
    const fixtures = materializeAutosavePerformanceFixtures()
    const editedWorkspace = applyEditBurstToWorkspace(fixtures.workspace, fixtures.editBurst)
    useNovelStore.setState(editedWorkspace)

    const constructionSamples = Array.from({ length: 5 }, () => {
      const startedAt = performance.now()
      const body = JSON.stringify(serializeState(useNovelStore.getState()))
      return { body, durationMs: performance.now() - startedAt }
    })
    const postedBodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`/api/novels/${encodeURIComponent(editedWorkspace.currentNovelId)}`)
      expect(init?.method).toBe('POST')
      postedBodies.push(String(init?.body))
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }))

    await useNovelStore.getState().saveToBackend()

    expect(constructionSamples.every((sample) => Number.isFinite(sample.durationMs) && sample.durationMs >= 0)).toBe(true)
    expect(new Set(constructionSamples.map((sample) => sample.body)).size).toBe(1)
    expect(postedBodies).toEqual([constructionSamples[0].body])

    const payload = JSON.parse(postedBodies[0]) as ReturnType<typeof serializeState>
    expect(payload.localChapters).toHaveLength(AUTOSAVE_PERFORMANCE_CHAPTER_COUNT)
    expect(payload.localChapters.find((chapter) => chapter.id === payload.currentChapterId)?.content).toBe(`<p>${fixtures.editBurst}</p>`)
    expect(fixtures.editBurst).toHaveLength(AUTOSAVE_EDIT_BURST_LENGTH)

    const sortedDurations = constructionSamples.map((sample) => sample.durationMs).sort((left, right) => left - right)
    writeAutosavePerformanceEvidence(fixtures.evidencePath, {
      chapterCount: payload.localChapters.length,
      editBurstCharacters: fixtures.editBurst.length,
      payloadBytes: Buffer.byteLength(postedBodies[0]),
      constructionSamplesMs: constructionSamples.map((sample) => sample.durationMs),
      observedP95ConstructionMs: sortedDurations[Math.ceil(sortedDurations.length * 0.95) - 1],
      timingGateApplied: false,
    })
  })
})
