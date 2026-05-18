"use client"

import { useCallback, useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type {
  GenerationContextBuildData,
  GraphContextSourceMeta,
  GraphReviewControls,
  GraphSelection,
} from '@/components/graph/types'
import type { Chapter, ProductSurfaceId } from '@/lib/types'
import type { WorkspaceCenterPaneView } from '@/components/workspace/use-workspace-pane-state'

export type WorkspaceActionMode = ProductSurfaceId

export const WORKSPACE_CHAPTER_ACTION_ENTRY_MODES = ['rewrite', 'roleplay'] as const satisfies readonly WorkspaceActionMode[]

export type WorkspaceFloatingPosition = {
  top: number
  left: number
}

export type WorkspaceRoleplayTurn = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export type PendingSourceJump = {
  chapterId: string
  chapterNo: number
  lineStart: number | null
  lineEnd: number | null
  searchText: string
}

type ChapterResetControls = {
  defaultGraphReviewControls: GraphReviewControls
  resetPresetCompatSessionStateForChapter: (chapter: Chapter) => void
  setRoleplayTurns: Dispatch<SetStateAction<WorkspaceRoleplayTurn[]>>
  setRoleplayDraft: Dispatch<SetStateAction<string>>
  setSelectionText: Dispatch<SetStateAction<string>>
  setLockedSelectionText: Dispatch<SetStateAction<string>>
  setGenerationContext: Dispatch<SetStateAction<GenerationContextBuildData | null>>
  setGraphContext: Dispatch<SetStateAction<GenerationContextBuildData['graphContext'] | null>>
  setContextPreviewError: Dispatch<SetStateAction<string>>
  setGraphReviewControls: Dispatch<SetStateAction<GraphReviewControls>>
  setGraphSelection: Dispatch<SetStateAction<GraphSelection>>
  setEvidenceDrawerOpen: Dispatch<SetStateAction<boolean>>
  setDisabledContextBlockIds: Dispatch<SetStateAction<string[]>>
  setExcludedGraphEdgeIds: Dispatch<SetStateAction<string[]>>
  setExcludedEvidenceIds: Dispatch<SetStateAction<string[]>>
  setGraphMutationPendingId: Dispatch<SetStateAction<string | null>>
  setGraphMutationError: Dispatch<SetStateAction<string>>
  setToolbarPos: Dispatch<SetStateAction<WorkspaceFloatingPosition | null>>
  setActiveMode: Dispatch<SetStateAction<WorkspaceActionMode | null>>
}

type UseWorkspaceChapterSelectionOptions = {
  localChapters: Chapter[]
  currentNovelId: string | null
  currentChapterId: string | null
  setCurrentChapterId: (chapterId: string) => void
  setCenterPaneView: Dispatch<SetStateAction<WorkspaceCenterPaneView>>
  setPendingSourceJump: Dispatch<SetStateAction<PendingSourceJump | null>>
  setLeftPanelOpen: Dispatch<SetStateAction<boolean>>
  htmlToPlainText: (html: string) => string
  resetControls: ChapterResetControls
}

export function useWorkspaceChapterSelection(options: UseWorkspaceChapterSelectionOptions) {
  const {
    localChapters,
    currentNovelId,
    currentChapterId,
    setCurrentChapterId,
    setCenterPaneView,
    setPendingSourceJump,
    setLeftPanelOpen,
    htmlToPlainText,
    resetControls,
  } = options

  const sortedChapters = useMemo(
    () => localChapters.filter((chapter) => chapter.novelId === currentNovelId).slice().sort((a, b) => a.order - b.order),
    [currentNovelId, localChapters]
  )

  const currentChapter = useMemo(
    () => sortedChapters.find((chapter) => chapter.id === currentChapterId) ?? sortedChapters[0],
    [currentChapterId, sortedChapters]
  )

  const parentChapter = useMemo(
    () => (currentChapter?.parentChapterId ? sortedChapters.find((chapter) => chapter.id === currentChapter.parentChapterId) ?? null : null),
    [currentChapter, sortedChapters]
  )

  const effectiveGraphSourceChapter = useMemo(
    () => (currentChapter?.parentChapterId ? parentChapter ?? currentChapter : currentChapter ?? null),
    [currentChapter, parentChapter]
  )

  const graphSourceMeta = useMemo<GraphContextSourceMeta | undefined>(() => {
    if (!currentChapter || !effectiveGraphSourceChapter) return undefined

    return {
      mode: currentChapter.parentChapterId ? 'inherited-parent' : 'direct',
      chapterId: effectiveGraphSourceChapter.id,
      chapterNo: effectiveGraphSourceChapter.order,
      chapterTitle: effectiveGraphSourceChapter.title,
    }
  }, [currentChapter, effectiveGraphSourceChapter])

  const resetContextForChapter = useCallback((chapter: Chapter) => {
    const nextText = htmlToPlainText(chapter.content)
    resetControls.resetPresetCompatSessionStateForChapter(chapter)
    resetControls.setRoleplayTurns([])
    resetControls.setRoleplayDraft(nextText)
    resetControls.setSelectionText('')
    resetControls.setLockedSelectionText('')
    resetControls.setGenerationContext(null)
    resetControls.setGraphContext(null)
    resetControls.setContextPreviewError('')
    resetControls.setGraphReviewControls(resetControls.defaultGraphReviewControls)
    resetControls.setGraphSelection(null)
    resetControls.setEvidenceDrawerOpen(false)
    resetControls.setDisabledContextBlockIds([])
    resetControls.setExcludedGraphEdgeIds([])
    resetControls.setExcludedEvidenceIds([])
    resetControls.setGraphMutationPendingId(null)
    resetControls.setGraphMutationError('')
    resetControls.setToolbarPos(null)
    resetControls.setActiveMode(null)
  }, [htmlToPlainText, resetControls])

  const selectChapter = useCallback((chapter: Chapter) => {
    setCurrentChapterId(chapter.id)
    resetContextForChapter(chapter)
    setLeftPanelOpen(false)
  }, [resetContextForChapter, setCurrentChapterId, setLeftPanelOpen])

  const resolveSourceChapter = useCallback((source: { chapterId?: string | null; chapterNo: number | null }) => {
    if (source.chapterId) {
      const byId = sortedChapters.find((chapter) => chapter.id === source.chapterId)
      if (byId) return byId
    }

    if (source.chapterNo === null) return null

    const mainlineMatch = sortedChapters.find((chapter) => !chapter.parentChapterId && chapter.order === source.chapterNo)
    if (mainlineMatch) return mainlineMatch

    return sortedChapters.find((chapter) => chapter.order === source.chapterNo) ?? null
  }, [sortedChapters])

  const jumpToGraphSource = useCallback((target: PendingSourceJump) => {
    const targetChapter = sortedChapters.find((chapter) => chapter.id === target.chapterId)
    if (!targetChapter) return

    setPendingSourceJump(target)
    setCenterPaneView('body')
    setCurrentChapterId(targetChapter.id)
    resetContextForChapter(targetChapter)
    setLeftPanelOpen(false)
  }, [resetContextForChapter, setCenterPaneView, setCurrentChapterId, setLeftPanelOpen, setPendingSourceJump, sortedChapters])

  return {
    sortedChapters,
    currentChapter,
    parentChapter,
    graphSourceMeta,
    resetContextForChapter,
    selectChapter,
    resolveSourceChapter,
    jumpToGraphSource,
  }
}
