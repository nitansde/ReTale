// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GraphReviewControls } from '@/components/graph/types'
import {
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
}

function buildChapter(overrides: Partial<Chapter>): Chapter {
  return {
    id: 'chapter-1',
    novelId: 'novel-1',
    volumeId: 'volume-1',
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
    setRoleplayTurns: vi.fn<(value: WorkspaceRoleplayTurn[]) => void>(),
    setRoleplayDraft: vi.fn<(value: string) => void>(),
    setSelectionText: vi.fn<(value: string) => void>(),
    setLockedSelectionText: vi.fn<(value: string) => void>(),
    setGenerationContext: vi.fn<(value: null) => void>(),
    setGraphContext: vi.fn<(value: null) => void>(),
    setContextPreviewError: vi.fn<(value: string) => void>(),
    setGraphReviewControls: vi.fn<(value: GraphReviewControls) => void>(),
    setGraphSelection: vi.fn<(value: null) => void>(),
    setEvidenceDrawerOpen: vi.fn<(value: boolean) => void>(),
    setDisabledContextBlockIds: vi.fn<(value: string[]) => void>(),
    setExcludedGraphEdgeIds: vi.fn<(value: string[]) => void>(),
    setExcludedEvidenceIds: vi.fn<(value: string[]) => void>(),
    setGraphMutationPendingId: vi.fn<(value: string | null) => void>(),
    setGraphMutationError: vi.fn<(value: string) => void>(),
    setToolbarPos: vi.fn<(value: WorkspaceFloatingPosition | null) => void>(),
    setActiveMode: vi.fn<(value: WorkspaceActionMode | null) => void>(),
  }
}

describe('useWorkspaceChapterSelection', () => {
  it('resets selection and action state when selecting a chapter', () => {
    const chapterOne = buildChapter({ id: 'chapter-1', title: 'Chapter 1', content: '<p>Alpha</p>', order: 1 })
    const chapterTwo = buildChapter({ id: 'chapter-2', title: 'Chapter 2', content: '<p>Beta body</p>', order: 2 })
    const htmlToPlainText = vi.fn((html: string) => html.replace(/<[^>]+>/g, '').trim())
    const setCurrentChapterId = vi.fn<(chapterId: string) => void>()
    const setCenterPaneView = vi.fn<(value: 'body' | 'graph') => void>()
    const setPendingSourceJump = vi.fn<(value: PendingSourceJump | null) => void>()
    const setLeftPanelOpen = vi.fn<(value: boolean) => void>()
    const resetControls = createResetControls()

    const { result } = renderHook(() =>
      useWorkspaceChapterSelection({
        localChapters: [chapterOne, chapterTwo],
        currentNovelId: 'novel-1',
        currentChapterId: chapterOne.id,
        setCurrentChapterId,
        setCenterPaneView,
        setPendingSourceJump,
        setLeftPanelOpen,
        htmlToPlainText,
        resetControls,
      })
    )

    act(() => {
      result.current.selectChapter(chapterTwo)
    })

    expect(setCurrentChapterId).toHaveBeenCalledWith(chapterTwo.id)
    expect(setLeftPanelOpen).toHaveBeenCalledWith(false)
    expect(htmlToPlainText).toHaveBeenCalledWith(chapterTwo.content)
    expect(resetControls.resetPresetCompatSessionStateForChapter).toHaveBeenCalledWith(chapterTwo)
    expect(resetControls.setRoleplayTurns).toHaveBeenCalledWith([])
    expect(resetControls.setRoleplayDraft).toHaveBeenCalledWith('Beta body')
    expect(resetControls.setSelectionText).toHaveBeenCalledWith('')
    expect(resetControls.setLockedSelectionText).toHaveBeenCalledWith('')
    expect(resetControls.setGenerationContext).toHaveBeenCalledWith(null)
    expect(resetControls.setGraphContext).toHaveBeenCalledWith(null)
    expect(resetControls.setContextPreviewError).toHaveBeenCalledWith('')
    expect(resetControls.setGraphReviewControls).toHaveBeenCalledWith(DEFAULT_GRAPH_REVIEW_CONTROLS)
    expect(resetControls.setGraphSelection).toHaveBeenCalledWith(null)
    expect(resetControls.setEvidenceDrawerOpen).toHaveBeenCalledWith(false)
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
    const setCenterPaneView = vi.fn<(value: 'body' | 'graph') => void>()
    const setPendingSourceJump = vi.fn<(value: PendingSourceJump | null) => void>()
    const setLeftPanelOpen = vi.fn<(value: boolean) => void>()
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
        setCenterPaneView,
        setPendingSourceJump,
        setLeftPanelOpen,
        htmlToPlainText: (html) => html.replace(/<[^>]+>/g, '').trim(),
        resetControls,
      })
    )

    act(() => {
      result.current.jumpToGraphSource(target)
    })

    expect(setPendingSourceJump).toHaveBeenCalledWith(target)
    expect(setCenterPaneView).toHaveBeenCalledWith('body')
    expect(setCurrentChapterId).toHaveBeenCalledWith(chapterTwo.id)
    expect(setLeftPanelOpen).toHaveBeenCalledWith(false)
    expect(resetControls.resetPresetCompatSessionStateForChapter).toHaveBeenCalledWith(chapterTwo)
    expect(resetControls.setSelectionText).toHaveBeenCalledWith('')
    expect(resetControls.setLockedSelectionText).toHaveBeenCalledWith('')
    expect(resetControls.setToolbarPos).toHaveBeenCalledWith(null)
    expect(resetControls.setActiveMode).toHaveBeenCalledWith(null)
  })
})
