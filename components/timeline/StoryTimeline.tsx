"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BranchBlock } from '@/components/timeline/BranchBlock'
import { BranchLineLayer } from '@/components/timeline/BranchLineLayer'
import { ChapterTimelineCard } from '@/components/timeline/ChapterTimelineCard'
import type { ChapterTimelineItem, StoryTimelineBranchNode, StoryTimelineEdge, TimelineSelection } from '@/lib/story-branch-types'
import { toBranchTimelineSelection } from '@/components/workspace/workspace-selection'
import type { Chapter } from '@/lib/types'

type NodePosition = {
  x: number
  y: number
}

function compareNodeCreation(left: StoryTimelineBranchNode, right: StoryTimelineBranchNode): number {
  const leftCreatedAt = left.createdAt ?? ''
  const rightCreatedAt = right.createdAt ?? ''
  if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt.localeCompare(rightCreatedAt)
  return left.id.localeCompare(right.id)
}

function resolveNodeDepth(node: StoryTimelineBranchNode, nodesById: Map<string, StoryTimelineBranchNode>, visited = new Set<string>()): number {
  if (!node.parentNodeId) return 0
  if (visited.has(node.id)) return 0

  const parentNode = nodesById.get(node.parentNodeId)
  if (!parentNode) return 0

  visited.add(node.id)
  return resolveNodeDepth(parentNode, nodesById, visited) + 1
}

function orderBranchNodes(branchNodes: StoryTimelineBranchNode[]): StoryTimelineBranchNode[] {
  const nodesById = new Map(branchNodes.map((node) => [node.id, node]))
  const childrenByParentId = new Map<string, StoryTimelineBranchNode[]>()
  const rootNodes: StoryTimelineBranchNode[] = []

  for (const node of branchNodes) {
    if (node.parentNodeId && nodesById.has(node.parentNodeId)) {
      const current = childrenByParentId.get(node.parentNodeId) ?? []
      current.push(node)
      childrenByParentId.set(node.parentNodeId, current)
      continue
    }

    rootNodes.push(node)
  }

  for (const children of childrenByParentId.values()) {
    children.sort(compareNodeCreation)
  }

  rootNodes.sort((left, right) => {
    if (left.anchorChapterNo !== right.anchorChapterNo) return left.anchorChapterNo - right.anchorChapterNo
    return compareNodeCreation(left, right)
  })

  const nodeDepths = new Map(branchNodes.map((node) => [node.id, resolveNodeDepth(node, nodesById)]))
  const ordered: StoryTimelineBranchNode[] = []
  const visit = (node: StoryTimelineBranchNode) => {
    ordered.push({ ...node, laneIndex: nodeDepths.get(node.id) ?? node.laneIndex })
    for (const child of childrenByParentId.get(node.id) ?? []) {
      visit(child)
    }
  }

  for (const rootNode of rootNodes) {
    visit(rootNode)
  }

  return ordered
}

export function StoryTimeline(props: {
  chapters: ChapterTimelineItem[]
  branchNodes: StoryTimelineBranchNode[]
  edges: StoryTimelineEdge[]
  activeChapterId: string
  activeSelection: TimelineSelection | null
  branchChaptersByParentId: Map<string, Chapter[]>
  onSelectionChange: (selection: TimelineSelection) => void
  onDeleteChapter: (chapterId: string) => void
  onDeleteBranchChapter: (chapterId: string) => void
  deletingBranchNodeId: string | null
  onDeleteWhatIfSession: (node: StoryTimelineBranchNode) => void
  onDeleteFutureJumpRun: (node: StoryTimelineBranchNode) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chapterRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const nodeRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [layout, setLayout] = useState<{ width: number; height: number; nodePositions: Record<string, NodePosition> }>({
    width: 0,
    height: 0,
    nodePositions: {},
  })

  const nodesByAnchor = useMemo(() => {
    const orderedNodes = orderBranchNodes(props.branchNodes)
    const grouped = new Map<number, StoryTimelineBranchNode[]>()
    for (const node of orderedNodes) {
      const current = grouped.get(node.anchorChapterNo) ?? []
      current.push(node)
      grouped.set(node.anchorChapterNo, current)
    }
    return grouped
  }, [props.branchNodes])

  const measureLayout = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const bounds = container.getBoundingClientRect()
    const nodePositions: Record<string, NodePosition> = {}

      nodeRefs.current.forEach((element, nodeId) => {
        if (!element) return
        const rect = element.getBoundingClientRect()
        nodePositions[nodeId] = {
          x: rect.right - bounds.left,
          y: rect.top - bounds.top + rect.height / 2,
        }
      })

    setLayout({
      width: bounds.width,
      height: bounds.height,
      nodePositions,
    })
  }, [])

  useEffect(() => {
    measureLayout()

    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      measureLayout()
    })
    const container = containerRef.current
    if (container) observer.observe(container)
    chapterRefs.current.forEach((element) => {
      if (element) observer.observe(element)
    })
    nodeRefs.current.forEach((element) => {
      if (element) observer.observe(element)
    })

    window.addEventListener('resize', measureLayout)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measureLayout)
    }
  }, [measureLayout, props.chapters, props.branchNodes])

  const selectedNodeId = props.activeSelection?.kind === 'chapter' ? null : props.activeSelection?.nodeId ?? null

  return (
    <div ref={containerRef} className="relative space-y-3">
      <BranchLineLayer
        width={layout.width}
        height={layout.height}
        edges={props.edges}
        nodePositions={layout.nodePositions}
        selectedNodeId={selectedNodeId}
        hoveredNodeId={hoveredNodeId}
      />

      {props.chapters.map((chapter) => {
        const branchChapters = props.branchChaptersByParentId.get(chapter.chapterId) ?? []
        const attachedNodes = nodesByAnchor.get(chapter.chapterNo) ?? []

        return (
          <ChapterTimelineCard
            key={chapter.chapterId}
            ref={(element) => {
              chapterRefs.current.set(chapter.chapterId, element)
            }}
            chapter={chapter}
            activeChapterId={props.activeChapterId}
            branchChapters={branchChapters}
            onSelectChapter={() => props.onSelectionChange({ kind: 'chapter', chapterId: chapter.chapterId, chapterNo: chapter.chapterNo })}
            onDeleteChapter={() => props.onDeleteChapter(chapter.chapterId)}
            onSelectBranchChapter={(branchChapter) => props.onSelectionChange({ kind: 'chapter', chapterId: branchChapter.id, chapterNo: branchChapter.order })}
            onDeleteBranchChapter={(branchChapter) => props.onDeleteBranchChapter(branchChapter.id)}
            branchArtifacts={
              attachedNodes.length ? (
                attachedNodes.map((node) => {
                  const selection = toBranchTimelineSelection(node)
                  const highlighted = hoveredNodeId === node.id || selectedNodeId === node.id

                  return (
                    <BranchBlock
                      key={node.id}
                      ref={(element) => {
                        nodeRefs.current.set(node.id, element)
                      }}
                      node={node}
                      selected={selectedNodeId === node.id}
                      highlighted={highlighted}
                      deleting={props.deletingBranchNodeId === node.id}
                      disabled={!selection}
                      onSelect={() => {
                        if (selection) props.onSelectionChange(selection)
                      }}
                      onDelete={
                        node.nodeType === 'what_if'
                          ? node.whatIfSessionId
                            ? () => props.onDeleteWhatIfSession(node)
                            : undefined
                          : node.nodeType === 'future_jump' && node.futureJumpRunId
                            ? () => props.onDeleteFutureJumpRun(node)
                            : undefined
                      }
                      onHoverChange={(hovered) => {
                        setHoveredNodeId((current) => (hovered ? node.id : current === node.id ? null : current))
                      }}
                    />
                  )
                })
              ) : (
                <div className="hidden lg:block" />
              )
            }
          />
        )
      })}
    </div>
  )
}
