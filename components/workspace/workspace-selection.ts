import type { StoryTimelineBranchNode, TimelineSelection } from '@/lib/story-branch-types'
import type { Chapter } from '@/lib/types'

const WORKSPACE_SELECTION_QUERY_KEYS = [
  'selectionKind',
  'selectionChapterId',
  'selectionChapterNo',
  'selectionNodeId',
  'selectionSessionId',
  'selectionRunId',
  'selectionAnchorChapterNo',
  'selectionSourceChapterNo',
  'selectionTargetChapterNo',
] as const

function parseSelectionNumber(value: string | null) {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function toChapterTimelineSelection(chapter: Pick<Chapter, 'id' | 'order'>): TimelineSelection {
  return {
    kind: 'chapter',
    chapterId: chapter.id,
    chapterNo: chapter.order,
  }
}

export function resolveWorkspaceSelection(options: {
  currentSelection: TimelineSelection | null
  currentChapter: Pick<Chapter, 'id' | 'order'> | null
  branchNodes: StoryTimelineBranchNode[]
}): TimelineSelection | null {
  const { currentSelection, currentChapter, branchNodes } = options
  if (!currentChapter) return null

  const fallbackSelection = toChapterTimelineSelection(currentChapter)
  if (!currentSelection) return fallbackSelection

  if (currentSelection.kind === 'chapter') return fallbackSelection

  const matchingNode = branchNodes.find((node) => node.id === currentSelection.nodeId)
  if (!matchingNode) return fallbackSelection

  if (currentSelection.kind === 'what_if') {
    return matchingNode.nodeType === 'what_if' && matchingNode.whatIfSessionId === currentSelection.sessionId
      ? currentSelection
      : fallbackSelection
  }

  return matchingNode.nodeType === 'future_jump' && matchingNode.futureJumpRunId === currentSelection.runId
    ? currentSelection
    : fallbackSelection
}

export function readWorkspaceSelectionFromSearchParams(searchParams: URLSearchParams): TimelineSelection | null {
  const selectionKind = searchParams.get('selectionKind')

  if (selectionKind === 'chapter') {
    const chapterId = searchParams.get('selectionChapterId')
    const chapterNo = parseSelectionNumber(searchParams.get('selectionChapterNo'))
    if (!chapterId || chapterNo === null) return null

    return {
      kind: 'chapter',
      chapterId,
      chapterNo,
    }
  }

  if (selectionKind === 'what_if') {
    const nodeId = searchParams.get('selectionNodeId')
    const sessionId = searchParams.get('selectionSessionId')
    const anchorChapterNo = parseSelectionNumber(searchParams.get('selectionAnchorChapterNo'))
    if (!nodeId || !sessionId || anchorChapterNo === null) return null

    return {
      kind: 'what_if',
      nodeId,
      sessionId,
      anchorChapterNo,
    }
  }

  if (selectionKind === 'future_jump') {
    const nodeId = searchParams.get('selectionNodeId')
    const runId = searchParams.get('selectionRunId')
    const sourceChapterNo = parseSelectionNumber(searchParams.get('selectionSourceChapterNo'))
    const targetChapterNo = parseSelectionNumber(searchParams.get('selectionTargetChapterNo'))
    if (!nodeId || !runId || sourceChapterNo === null || targetChapterNo === null) return null

    return {
      kind: 'future_jump',
      nodeId,
      runId,
      sourceChapterNo,
      targetChapterNo,
    }
  }

  return null
}

export function writeWorkspaceSelectionToSearchParams(searchParams: URLSearchParams, selection: TimelineSelection | null) {
  const nextSearchParams = new URLSearchParams(searchParams)
  for (const key of WORKSPACE_SELECTION_QUERY_KEYS) {
    nextSearchParams.delete(key)
  }

  if (!selection) return nextSearchParams

  if (selection.kind === 'chapter') {
    nextSearchParams.set('selectionKind', 'chapter')
    nextSearchParams.set('selectionChapterId', selection.chapterId)
    nextSearchParams.set('selectionChapterNo', String(selection.chapterNo))
    return nextSearchParams
  }

  if (selection.kind === 'what_if') {
    nextSearchParams.set('selectionKind', 'what_if')
    nextSearchParams.set('selectionNodeId', selection.nodeId)
    nextSearchParams.set('selectionSessionId', selection.sessionId)
    nextSearchParams.set('selectionAnchorChapterNo', String(selection.anchorChapterNo))
    return nextSearchParams
  }

  nextSearchParams.set('selectionKind', 'future_jump')
  nextSearchParams.set('selectionNodeId', selection.nodeId)
  nextSearchParams.set('selectionRunId', selection.runId)
  nextSearchParams.set('selectionSourceChapterNo', String(selection.sourceChapterNo))
  nextSearchParams.set('selectionTargetChapterNo', String(selection.targetChapterNo))
  return nextSearchParams
}
