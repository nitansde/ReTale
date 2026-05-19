import type { StoryTimelineBranchNode, TimelineSelection } from '@/lib/story-branch-types'
import type { Chapter } from '@/lib/types'

const WORKSPACE_SELECTION_QUERY_KEYS = [
  'selectionKind',
  'selectionChapterId',
  'selectionChapterNo',
  'selectionNodeId',
  'selectionContinueBlockId',
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

function matchesBranchSelectionNode(selection: Exclude<TimelineSelection, { kind: 'chapter' }>, node: StoryTimelineBranchNode) {
  if (selection.kind === 'what_if') {
    return node.nodeType === 'what_if' && node.whatIfSessionId === selection.sessionId
  }

  if (selection.kind === 'rewrite') {
    return node.nodeType === 'rewrite' && node.continueBlockId === selection.continueBlockId
  }

  if (selection.kind === 'continue_block') {
    return node.nodeType === 'continue_block' && node.continueBlockId === selection.continueBlockId
  }

  return node.nodeType === 'future_jump' && node.futureJumpRunId === selection.runId
}

export function toBranchTimelineSelection(node: StoryTimelineBranchNode): TimelineSelection | null {
  if (node.nodeType === 'rewrite') {
    return node.continueBlockId
      ? {
          kind: 'rewrite',
          nodeId: node.id,
          continueBlockId: node.continueBlockId,
          anchorChapterNo: node.anchorChapterNo,
        }
      : null
  }

  if (node.nodeType === 'continue_block') {
    return node.continueBlockId
      ? {
          kind: 'continue_block',
          nodeId: node.id,
          continueBlockId: node.continueBlockId,
          anchorChapterNo: node.anchorChapterNo,
        }
      : null
  }

  if (node.nodeType === 'what_if') {
    return node.whatIfSessionId
      ? {
          kind: 'what_if',
          nodeId: node.id,
          sessionId: node.whatIfSessionId,
          anchorChapterNo: node.anchorChapterNo,
        }
      : null
  }

  return node.futureJumpRunId && node.sourceChapterNo !== null && node.targetChapterNo !== null
    ? {
        kind: 'future_jump',
        nodeId: node.id,
        runId: node.futureJumpRunId,
        sourceChapterNo: node.sourceChapterNo,
        targetChapterNo: node.targetChapterNo,
      }
    : null
}

export function toChapterTimelineSelection(chapter: Pick<Chapter, 'id' | 'order'>): TimelineSelection {
  return {
    kind: 'chapter',
    chapterId: chapter.id,
    chapterNo: chapter.order,
  }
}

function resolveDeletedBranchNodeParentSelection(
  deletedNode: StoryTimelineBranchNode,
  branchNodes: StoryTimelineBranchNode[]
): TimelineSelection | null {
  const branchNodesById = new Map(branchNodes.map((node) => [node.id, node]))
  let parentNodeId = deletedNode.parentNodeId

  while (parentNodeId) {
    const parentNode = branchNodesById.get(parentNodeId)
    if (!parentNode) break

    const parentSelection = toBranchTimelineSelection(parentNode)
    if (parentSelection) return parentSelection

    parentNodeId = parentNode.parentNodeId
  }

  return null
}

export function resolveSelectionAfterDeletedBranchNode(options: {
  deletedNode: StoryTimelineBranchNode
  previousSelection: TimelineSelection
  currentChapter: Pick<Chapter, 'id' | 'order'> | null
  chapters: Array<Pick<Chapter, 'id' | 'order' | 'parentChapterId'>>
  branchNodes: StoryTimelineBranchNode[]
}): TimelineSelection | null {
  const { deletedNode, previousSelection, currentChapter, chapters, branchNodes } = options
  if (!currentChapter) return previousSelection

  const fallbackSelection = toChapterTimelineSelection(currentChapter)

  if (previousSelection.kind !== 'chapter' && previousSelection.nodeId === deletedNode.id) {
    const parentSelection = resolveDeletedBranchNodeParentSelection(deletedNode, branchNodes)
    if (parentSelection) return parentSelection

    const fallbackChapterNo = deletedNode.nodeType === 'future_jump'
      ? deletedNode.sourceChapterNo ?? deletedNode.anchorChapterNo
      : deletedNode.anchorChapterNo
    const fallbackChapter = chapters.find((chapter) => !chapter.parentChapterId && chapter.order === fallbackChapterNo)
    return fallbackChapter ? toChapterTimelineSelection(fallbackChapter) : fallbackSelection
  }

  return resolveWorkspaceSelection({
    currentSelection: previousSelection,
    currentChapter,
    branchNodes,
  }) ?? fallbackSelection
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
  if (matchingNode && matchesBranchSelectionNode(currentSelection, matchingNode)) {
    return toBranchTimelineSelection(matchingNode) ?? fallbackSelection
  }

  const fallbackBranchMatch = branchNodes.find((node) => matchesBranchSelectionNode(currentSelection, node))
  return fallbackBranchMatch ? (toBranchTimelineSelection(fallbackBranchMatch) ?? fallbackSelection) : fallbackSelection
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

  if (selectionKind === 'rewrite') {
    const nodeId = searchParams.get('selectionNodeId')
    const continueBlockId = searchParams.get('selectionContinueBlockId')
    const anchorChapterNo = parseSelectionNumber(searchParams.get('selectionAnchorChapterNo'))
    if (!nodeId || !continueBlockId || anchorChapterNo === null) return null

    return {
      kind: 'rewrite',
      nodeId,
      continueBlockId,
      anchorChapterNo,
    }
  }

  if (selectionKind === 'continue_block') {
    const nodeId = searchParams.get('selectionNodeId')
    const continueBlockId = searchParams.get('selectionContinueBlockId')
    const anchorChapterNo = parseSelectionNumber(searchParams.get('selectionAnchorChapterNo'))
    if (!nodeId || !continueBlockId || anchorChapterNo === null) return null

    return {
      kind: 'continue_block',
      nodeId,
      continueBlockId,
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

  if (selection.kind === 'rewrite') {
    nextSearchParams.set('selectionKind', 'rewrite')
    nextSearchParams.set('selectionNodeId', selection.nodeId)
    nextSearchParams.set('selectionContinueBlockId', selection.continueBlockId)
    nextSearchParams.set('selectionAnchorChapterNo', String(selection.anchorChapterNo))
    return nextSearchParams
  }

  if (selection.kind === 'continue_block') {
    nextSearchParams.set('selectionKind', 'continue_block')
    nextSearchParams.set('selectionNodeId', selection.nodeId)
    nextSearchParams.set('selectionContinueBlockId', selection.continueBlockId)
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
