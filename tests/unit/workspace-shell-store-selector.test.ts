import { describe, expect, it } from 'vitest'
import { selectSelectionNovelStudioStore } from '@/components/workspace/selection-novel-studio-shell'
import { useNovelStore } from '@/store/novel-store'

describe('workspace shell store selector', () => {
  it('ignores unrelated transient store fields while exposing autosave identity and revision', () => {
    const state = useNovelStore.getState()
    const selected = selectSelectionNovelStudioStore(state)
    const nextSelected = selectSelectionNovelStudioStore({
      ...state,
      isSaving: !state.isSaving,
      librarySummariesError: 'transient error',
      presetCompatLibraryLoading: !state.presetCompatLibraryLoading,
      workspaceSaveFeedback: { kind: 'save-failed' },
    })

    expect(nextSelected).toEqual({ ...selected, workspaceSaveFeedback: { kind: 'save-failed' } })
    expect(selected.currentNovelId).toBe(state.currentNovelId)
    expect(selected.persistRevision).toBe(state.persistRevision)
    expect(selected.workspaceSaveFeedback).toBe(state.workspaceSaveFeedback)
    expect(selected).not.toHaveProperty('isSaving')
    expect(selected).not.toHaveProperty('librarySummariesError')
    expect(selected).not.toHaveProperty('presetCompatLibraryLoading')
  })
})
