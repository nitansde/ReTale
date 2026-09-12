import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNovelStore } from '@/store/novel-store'
import {
  AUTOSAVE_EDIT_BURST_LENGTH,
  AUTOSAVE_PERFORMANCE_CHAPTER_COUNT,
  applyEditBurstToWorkspace,
  materializeAutosavePerformanceFixtures,
} from '@/tests/helpers/autosave-performance-fixtures'

describe('large workspace autosave payload', () => {
  beforeEach(() => useNovelStore.getState().resetWorkspace())
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    useNovelStore.getState().resetWorkspace()
  })

  it('sends only the edited chapter in a 1,000-chapter workspace with revision authority', async () => {
    const fixtures = materializeAutosavePerformanceFixtures()
    const editedWorkspace = applyEditBurstToWorkspace(fixtures.workspace, fixtures.editBurst)
    useNovelStore.setState({
      ...editedWorkspace,
      workspaceRevision: 7,
      revisionNovelId: editedWorkspace.currentNovelId,
      lastAcknowledgedPersistedWorkspace: fixtures.workspace,
      backendLoaded: true,
      backendLoadError: '',
    })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, novelId: editedWorkspace.currentNovelId, revision: 8 }), {
      status: 200,
      headers: { 'X-Retale-Workspace-Revision': '8', 'X-Retale-Revision-Novel-Id': editedWorkspace.currentNovelId },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await useNovelStore.getState().saveToBackend()

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/chapters/${encodeURIComponent(editedWorkspace.currentChapterId)}`, expect.objectContaining({
      method: 'PATCH',
      headers: expect.objectContaining({ 'X-Retale-Base-Revision': '7', 'Idempotency-Key': expect.any(String) }),
      body: expect.any(String),
    }))
    const request = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1]
    const payload = JSON.parse(String(request.body))
    expect(payload.content).toBe(`<p>${fixtures.editBurst}</p>`)
    expect(payload).not.toHaveProperty('localChapters')
    expect(fixtures.workspace.localChapters).toHaveLength(AUTOSAVE_PERFORMANCE_CHAPTER_COUNT)
    expect(fixtures.editBurst).toHaveLength(AUTOSAVE_EDIT_BURST_LENGTH)
    expect(Buffer.byteLength(String(request.body))).toBeLessThan(Buffer.byteLength(JSON.stringify(editedWorkspace)) / 10)
  })
})
