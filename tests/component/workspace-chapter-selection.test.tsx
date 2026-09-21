// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import type { Dispatch, SetStateAction } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { GenerationContextBuildData, GraphReviewControls, GraphSelection } from '@/components/graph/types'
import {
  WORKSPACE_CHAPTER_ACTION_ENTRY_MODES,
  useWorkspaceChapterSelection,
  type PendingSourceJump,
  type WorkspaceActionMode,
  type WorkspaceFloatingPosition,
  type WorkspaceRoleplayTurn,
} from '@/components/workspace/use-workspace-chapter-selection'
import type { Chapter } from '@/lib/types'

const DEFAULT_GRAPH_REVIEW_CONTROLS: GraphReviewControls = {
  maxHops: 2,
  hideLowConfidence: false,
  confirmedOnly: false,
  showPotentiallyStale: false,
}

function createStateSetterMock<T>() {
  return vi.fn() as unknown as Dispatch<SetStateAction<T>>
}

function buildChapter(overrides: Partial<Chapter>): Chapter {
  return {
    id: 'chapter-1',
    novelId: 'novel-1',
    title: 'Chapter 1',
    order: 1,
    content: '<p>Alpha</p>',
    status: 'draft',
    wordCount: 100,
    updatedAt: '2026-05-15',
    ...overrides,
  }
}

function createResetControls() {
  return {
    defaultGraphReviewControls: DEFAULT_GRAPH_REVIEW_CONTROLS,
    resetPresetCompatSessionStateForChapter: vi.fn<(chapter: Chapter) => void>(),
    setRoleplayTurns: createStateSetterMock<WorkspaceRoleplayTurn[]>(),
    setRoleplayDraft: createStateSetterMock<string>(),
    setSelectionText: createStateSetterMock<string>(),
    setLockedSelectionText: createStateSetterMock<string>(),
    setGenerationContext: createStateSetterMock<GenerationContextBuildData | null>(),
    setGraphContext: createStateSetterMock<GenerationContextBuildData['graphContext'] | null>(),
    setContextPreviewError: createStateSetterMock<string>(),
    setGraphReviewControls: createStateSetterMock<GraphReviewControls>(),
    setGraphSelection: createStateSetterMock<GraphSelection>(),
    setDisabledContextBlockIds: createStateSetterMock<string[]>(),
    setExcludedGraphEdgeIds: createStateSetterMock<string[]>(),
    setExcludedEvidenceIds: createStateSetterMock<string[]>(),
    setGraphMutationPendingId: createStateSetterMock<string | null>(),
    setGraphMutationError: createStateSetterMock<string>(),
    setToolbarPos: createStateSetterMock<WorkspaceFloatingPosition | null>(),
    setActiveMode: createStateSetterMock<WorkspaceActionMode | null>(),
  }
}

describe('useWorkspaceChapterSelection', () => {
  it('keeps chapter-root action entries narrower than the canonical workspace surface union', () => {
    expect(WORKSPACE_CHAPTER_ACTION_ENTRY_MODES).toEqual(['rewrite', 'roleplay'])
  })

  it('resets selection and action state when selecting a chapter', () => {
    const chapterOne = buildChapter({ id: 'chapter-1', title: 'Chapter 1', content: '<p>Alpha</p>', order: 1 })
    const chapterTwo = buildChapter({ id: 'chapter-2', title: 'Chapter 2', content: '<p>Beta body</p>', order: 2 })
    const setCurrentChapterId = vi.fn<(chapterId: string) => void>()
    const flushEditorBuffer = vi.fn()
    const setCenterPaneView = createStateSetterMock<'body' | 'graph'>()
    const setPendingSourceJump = createStateSetterMock<PendingSourceJump | null>()
    const setLeftPanelOpen = createStateSetterMock<boolean>()
    const resetControls = createResetControls()

    const { result } = renderHook(() =>
      useWorkspaceChapterSelection({
        localChapters: [chapterOne, chapterTwo],
        currentNovelId: 'novel-1',
        currentChapterId: chapterOne.id,
        setCurrentChapterId,
        flushEditorBuffer,
        setCenterPaneView,
        setPendingSourceJump,
        setLeftPanelOpen,
        resetControls,
      })
    )

    act(() => {
      result.current.selectChapter(chapterTwo)
    })

    expect(setCurrentChapterId).toHaveBeenCalledWith(chapterTwo.id)
    expect(flushEditorBuffer).toHaveBeenCalledBefore(setCurrentChapterId)
    expect(setLeftPanelOpen).toHaveBeenCalledWith(false)
    expect(resetControls.resetPresetCompatSessionStateForChapter).toHaveBeenCalledWith(chapterTwo)
    expect(resetControls.setSelectionText).toHaveBeenCalledWith('')
    expect(resetControls.setLockedSelectionText).toHaveBeenCalledWith('')
    expect(resetControls.setGenerationContext).toHaveBeenCalledWith(null)
    expect(resetControls.setGraphContext).toHaveBeenCalledWith(null)
    expect(resetControls.setContextPreviewError).toHaveBeenCalledWith('')
    expect(resetControls.setGraphReviewControls).toHaveBeenCalledWith(DEFAULT_GRAPH_REVIEW_CONTROLS)
    expect(resetControls.setGraphSelection).toHaveBeenCalledWith(null)
    expect(resetControls.setDisabledContextBlockIds).toHaveBeenCalledWith([])
    expect(resetControls.setExcludedGraphEdgeIds).toHaveBeenCalledWith([])
    expect(resetControls.setExcludedEvidenceIds).toHaveBeenCalledWith([])
    expect(resetControls.setGraphMutationPendingId).toHaveBeenCalledWith(null)
    expect(resetControls.setGraphMutationError).toHaveBeenCalledWith('')
    expect(resetControls.setToolbarPos).toHaveBeenCalledWith(null)
    expect(resetControls.setActiveMode).toHaveBeenCalledWith(null)
    expect(setCenterPaneView).not.toHaveBeenCalled()
    expect(setPendingSourceJump).not.toHaveBeenCalled()
  })

  it('returns to body mode and resets context when jumping to a graph source', () => {
    const chapterOne = buildChapter({ id: 'chapter-1', title: 'Chapter 1', content: '<p>Alpha</p>', order: 1 })
    const chapterTwo = buildChapter({ id: 'chapter-2', title: 'Chapter 2', content: '<p>Beta body</p>', order: 2 })
    const setCurrentChapterId = vi.fn<(chapterId: string) => void>()
    const flushEditorBuffer = vi.fn()
    const setCenterPaneView = createStateSetterMock<'body' | 'graph'>()
    const setPendingSourceJump = createStateSetterMock<PendingSourceJump | null>()
    const setLeftPanelOpen = createStateSetterMock<boolean>()
    const resetControls = createResetControls()
    const target: PendingSourceJump = {
      chapterId: chapterTwo.id,
      chapterNo: chapterTwo.order,
      lineStart: 5,
      lineEnd: 6,
      searchText: 'Beta body',
    }

    const { result } = renderHook(() =>
      useWorkspaceChapterSelection({
        localChapters: [chapterOne, chapterTwo],
        currentNovelId: 'novel-1',
        currentChapterId: chapterOne.id,
        setCurrentChapterId,
        flushEditorBuffer,
        setCenterPaneView,
        setPendingSourceJump,
        setLeftPanelOpen,
        resetControls,
      })
    )

    act(() => {
      result.current.jumpToGraphSource(target)
    })

    expect(setPendingSourceJump).toHaveBeenCalledWith(target)
    expect(setCenterPaneView).toHaveBeenCalledWith('body')
    expect(setCurrentChapterId).toHaveBeenCalledWith(chapterTwo.id)
    expect(flushEditorBuffer).toHaveBeenCalledBefore(setCurrentChapterId)
    expect(setLeftPanelOpen).toHaveBeenCalledWith(false)
    expect(resetControls.resetPresetCompatSessionStateForChapter).toHaveBeenCalledWith(chapterTwo)
    expect(resetControls.setSelectionText).toHaveBeenCalledWith('')
    expect(resetControls.setLockedSelectionText).toHaveBeenCalledWith('')
    expect(resetControls.setToolbarPos).toHaveBeenCalledWith(null)
    expect(resetControls.setActiveMode).toHaveBeenCalledWith(null)
  })
})
