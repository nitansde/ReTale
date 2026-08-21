import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import type { PresetCompatSessionState } from '@/lib/types'
import {
  clearPresetCompatSessionStateForSelection,
  createPresetCompatSessionSelectionKey,
  createPresetCompatSessionStateKey,
  normalizeWorkspaceState,
  setPresetCompatSessionEntry,
} from '@/lib/workspace-state'
import { useNovelStore } from '@/store/novel-store'

function createChapter(id: string, order: number) {
  return {
    id,
    novelId: 'novel-1',
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
      } as Record<string, unknown> as PresetCompatSessionState,
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

  it('keys branch session entries by canonical selection identity and clears one branch selection at a time', () => {
    const continueSelection = {
      kind: 'continue_block' as const,
      nodeId: 'continue-node-1',
      continueBlockId: 'continue-block-1',
      anchorChapterNo: 10,
    }
    const whatIfSelection = {
      kind: 'what_if' as const,
      nodeId: 'what-if-node-1',
      sessionId: 'what-if-session-1',
      anchorChapterNo: 10,
    }
    const futureJumpSelection = {
      kind: 'future_jump' as const,
      nodeId: 'jump-node-1',
      runId: 'jump-run-1',
      sourceChapterNo: 10,
      targetChapterNo: 100,
    }

    let state = {} as PresetCompatSessionState
    state = setPresetCompatSessionEntry(state, continueSelection, 'rewrite', 'continue')
    state = setPresetCompatSessionEntry(state, continueSelection, 'roleplay', 'continue')
    state = setPresetCompatSessionEntry(state, whatIfSelection, 'rewrite', 'continue')
    state = setPresetCompatSessionEntry(state, futureJumpSelection, 'future_jump', 'continue')

    expect(createPresetCompatSessionSelectionKey(continueSelection)).toBe('continue_block:continue-node-1:continue-block-1:10')
    expect(createPresetCompatSessionSelectionKey(whatIfSelection)).toBe('what_if:what-if-node-1:what-if-session-1:10')
    expect(createPresetCompatSessionSelectionKey(futureJumpSelection)).toBe('future_jump:jump-node-1:jump-run-1:10:100')

    expect(Object.keys(clearPresetCompatSessionStateForSelection(state, continueSelection)).sort()).toEqual([
      createPresetCompatSessionStateKey(futureJumpSelection, 'future_jump'),
      createPresetCompatSessionStateKey(whatIfSelection, 'rewrite'),
    ])
  })

  it('preserves session state identity when clear or reset makes no semantic change', () => {
    const chapterSelection = { kind: 'chapter' as const, chapterId: 'chapter-1' }
    const otherSelection = { kind: 'chapter' as const, chapterId: 'chapter-2' }
    const state = setPresetCompatSessionEntry({}, chapterSelection, 'rewrite', 'new_chat', true)

    expect(clearPresetCompatSessionStateForSelection(state, otherSelection)).toBe(state)
    expect(setPresetCompatSessionEntry(state, chapterSelection, 'rewrite', 'new_chat', true)).toBe(state)
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
      'future_jump',
      'continue'
    )
    useNovelStore.getState().setPresetCompatSessionPhase(
      { kind: 'chapter', chapterId: 'chapter-2' },
      'future_jump',
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
      [createPresetCompatSessionStateKey({ kind: 'chapter', chapterId: 'chapter-1' }, 'future_jump')]: {
        surfaceId: 'future_jump',
        phase: 'continue',
        resetPending: false,
      },
    })

    useNovelStore.getState().deleteChapter('chapter-1')

    expect(useNovelStore.getState().presetCompatSessionState).toEqual({
      [createPresetCompatSessionStateKey({ kind: 'chapter', chapterId: 'chapter-2' }, 'future_jump')]: {
        surfaceId: 'future_jump',
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
      'future_jump',
      'continue'
    )
    useNovelStore.getState().setPresetCompatSessionPhase(
      { kind: 'chapter', chapterId: 'chapter-1' },
      'roleplay',
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
      [createPresetCompatSessionStateKey({ kind: 'chapter', chapterId: 'chapter-1' }, 'future_jump')]: {
        surfaceId: 'future_jump',
        phase: 'continue',
        resetPending: false,
      },
      [createPresetCompatSessionStateKey({ kind: 'chapter', chapterId: 'chapter-1' }, 'roleplay')]: {
        surfaceId: 'roleplay',
        phase: 'continue',
        resetPending: false,
      },
    })
  })
})
