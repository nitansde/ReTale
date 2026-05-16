import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import {
  createPresetCompatSessionStateKey,
  normalizeWorkspaceState,
} from '@/lib/workspace-state'
import { useNovelStore } from '@/store/novel-store'

function createChapter(id: string, order: number) {
  return {
    id,
    novelId: 'novel-1',
    volumeId: 'volume-1',
    title: `Chapter ${order}`,
    order,
    content: `<p>Body ${order}</p>`,
    originalContent: `<p>Body ${order}</p>`,
    status: 'draft' as const,
    wordCount: 2,
    updatedAt: `2026-05-16T00:00:0${order}.000Z`,
    trajectory: [],
  }
}

function resetStore() {
  useNovelStore.getState().resetWorkspace()
  useNovelStore.setState({
    isHydrated: false,
    isSaving: false,
    backendLoaded: false,
    backendLoadError: '',
    presetCompatLibrary: createDefaultPresetCompatLibrary(),
    presetCompatLibraryLoading: false,
    presetCompatLibraryError: '',
  })
}

describe('preset compat session state', () => {
  beforeEach(() => {
    resetStore()
  })

  it('normalizes missing or invalid persisted session payloads safely', () => {
    const validKey = createPresetCompatSessionStateKey({ kind: 'chapter', chapterId: 'chapter-1' }, 'rewrite')

    const normalized = normalizeWorkspaceState({
      currentNovelId: 'novel-1',
      currentChapterId: 'chapter-1',
      localChapters: [createChapter('chapter-1', 1)],
      presetCompatSessionState: {
        [validKey]: {
          surfaceId: 'rewrite',
          phase: 'continue',
          resetPending: false,
        },
        invalid_phase: {
          surfaceId: 'rewrite',
          phase: 'branch_chat',
          resetPending: false,
          turns: [{ role: 'assistant', content: 'should not persist' }],
        },
        invalid_shape: ['assistant turn leak'],
      } as Record<string, unknown>,
    })

    expect(normalized.presetCompatSessionState).toEqual({
      [validKey]: {
        surfaceId: 'rewrite',
        phase: 'continue',
        resetPending: false,
      },
    })

    expect(normalizeWorkspaceState({ localChapters: [createChapter('chapter-1', 1)] }).presetCompatSessionState).toEqual({})
  })

  it('serializes only lightweight phase and reset metadata, then resets it without touching the preset library', () => {
    useNovelStore.setState({
      currentNovelId: 'novel-1',
      currentChapterId: 'chapter-1',
      localChapters: [createChapter('chapter-1', 1)],
      presetCompatLibrary: {
        ...createDefaultPresetCompatLibrary(),
        revision: 8,
      },
    })

    useNovelStore.getState().setPresetCompatSessionPhase(
      { kind: 'chapter', chapterId: 'chapter-1' },
      'rewrite',
      'new_example_chat',
      true
    )

    const exportedWorkspace = JSON.parse(useNovelStore.getState().exportWorkspace()) as {
      presetCompatSessionState: Record<string, Record<string, unknown>>
    }

    expect(Object.values(exportedWorkspace.presetCompatSessionState)).toEqual([
      {
        surfaceId: 'rewrite',
        phase: 'new_example_chat',
        resetPending: true,
      },
    ])

    useNovelStore.getState().resetWorkspace()

    expect(useNovelStore.getState().presetCompatSessionState).toEqual({})
    expect(useNovelStore.getState().presetCompatLibrary.revision).toBe(8)
  })

  it('reinitializes and prunes chapter-scoped session state during reset and chapter deletion flows', () => {
    useNovelStore.setState({
      currentNovelId: 'novel-1',
      currentChapterId: 'chapter-1',
      localNovels: [{ id: 'novel-1', title: 'Novel', summary: 'Summary', tags: [] }],
      localVolumes: [{ id: 'volume-1', novelId: 'novel-1', title: 'Volume', order: 1 }],
      localChapters: [createChapter('chapter-1', 1), createChapter('chapter-2', 2)],
    })

    useNovelStore.getState().setPresetCompatSessionPhase(
      { kind: 'chapter', chapterId: 'chapter-1' },
      'rewrite',
      'continue'
    )
    useNovelStore.getState().setPresetCompatSessionPhase(
      { kind: 'chapter', chapterId: 'chapter-1' },
      'roleplay',
      'continue'
    )
    useNovelStore.getState().setPresetCompatSessionPhase(
      { kind: 'chapter', chapterId: 'chapter-1' },
      'continue',
      'continue'
    )
    useNovelStore.getState().setPresetCompatSessionPhase(
      { kind: 'chapter', chapterId: 'chapter-2' },
      'expand',
      'continue'
    )

    useNovelStore.getState().resetPresetCompatSessionStateForSelection(
      { kind: 'chapter', chapterId: 'chapter-1' },
      ['rewrite', 'roleplay']
    )

    expect(useNovelStore.getState().presetCompatSessionState).toMatchObject({
      [createPresetCompatSessionStateKey({ kind: 'chapter', chapterId: 'chapter-1' }, 'rewrite')]: {
        surfaceId: 'rewrite',
        phase: 'new_chat',
        resetPending: true,
      },
      [createPresetCompatSessionStateKey({ kind: 'chapter', chapterId: 'chapter-1' }, 'roleplay')]: {
        surfaceId: 'roleplay',
        phase: 'new_chat',
        resetPending: true,
      },
      [createPresetCompatSessionStateKey({ kind: 'chapter', chapterId: 'chapter-1' }, 'continue')]: {
        surfaceId: 'continue',
        phase: 'continue',
        resetPending: false,
      },
    })

    useNovelStore.getState().deleteChapter('chapter-1')

    expect(useNovelStore.getState().presetCompatSessionState).toEqual({
      [createPresetCompatSessionStateKey({ kind: 'chapter', chapterId: 'chapter-2' }, 'expand')]: {
        surfaceId: 'expand',
        phase: 'continue',
        resetPending: false,
      },
    })
  })

  it('resets only the targeted creative surface for one selection', () => {
    useNovelStore.setState({
      currentNovelId: 'novel-1',
      currentChapterId: 'chapter-1',
      localChapters: [createChapter('chapter-1', 1)],
    })

    useNovelStore.getState().setPresetCompatSessionPhase(
      { kind: 'chapter', chapterId: 'chapter-1' },
      'rewrite',
      'new_chat'
    )
    useNovelStore.getState().setPresetCompatSessionPhase(
      { kind: 'chapter', chapterId: 'chapter-1' },
      'expand',
      'continue'
    )
    useNovelStore.getState().setPresetCompatSessionPhase(
      { kind: 'chapter', chapterId: 'chapter-1' },
      'continue',
      'continue'
    )

    useNovelStore.getState().resetPresetCompatSessionStateForSelection(
      { kind: 'chapter', chapterId: 'chapter-1' },
      ['rewrite']
    )

    expect(useNovelStore.getState().presetCompatSessionState).toMatchObject({
      [createPresetCompatSessionStateKey({ kind: 'chapter', chapterId: 'chapter-1' }, 'rewrite')]: {
        surfaceId: 'rewrite',
        phase: 'new_chat',
        resetPending: true,
      },
      [createPresetCompatSessionStateKey({ kind: 'chapter', chapterId: 'chapter-1' }, 'expand')]: {
        surfaceId: 'expand',
        phase: 'continue',
        resetPending: false,
      },
      [createPresetCompatSessionStateKey({ kind: 'chapter', chapterId: 'chapter-1' }, 'continue')]: {
        surfaceId: 'continue',
        phase: 'continue',
        resetPending: false,
      },
    })
  })
})
