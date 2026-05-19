"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BranchBlock } from '@/components/timeline/BranchBlock'
import { BranchLineLayer } from '@/components/timeline/BranchLineLayer'
import { ChapterTimelineCard } from '@/components/timeline/ChapterTimelineCard'
import { orderStoryTimelineBranchNodes, type ChapterTimelineItem, type StoryTimelineBranchNode, type StoryTimelineEdge, type TimelineSelection } from '@/lib/story-branch-types'
import { toBranchTimelineSelection } from '@/components/workspace/workspace-selection'
import type { Chapter } from '@/lib/types'

type NodePosition = {
  x: number
  y: number
}

function areNodePositionsEqual(left: Record<string, NodePosition>, right: Record<string, NodePosition>) {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false

  for (const key of leftKeys) {
    const leftPosition = left[key]
    const rightPosition = right[key]
    if (!rightPosition) return false
    if (leftPosition.x !== rightPosition.x || leftPosition.y !== rightPosition.y) return false
  }

  return true
}

function compareNodeCreation(left: StoryTimelineBranchNode, right: StoryTimelineBranchNode): number {
  const leftCreatedAt = left.createdAt ?? ''
  const rightCreatedAt = right.createdAt ?? ''
  if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt.localeCompare(rightCreatedAt)
  return left.id.localeCompare(right.id)
}

function orderBranchNodes(branchNodes: StoryTimelineBranchNode[]): StoryTimelineBranchNode[] {
  return orderStoryTimelineBranchNodes(branchNodes, compareNodeCreation)
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
  onDeleteBranchNode: (node: StoryTimelineBranchNode) => void
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

    setLayout((current) => {
      if (
        current.width === bounds.width
        && current.height === bounds.height
        && areNodePositionsEqual(current.nodePositions, nodePositions)
      ) {
        return current
      }

      return {
        width: bounds.width,
        height: bounds.height,
        nodePositions,
      }
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
                        node.nodeType === 'rewrite'
                          || node.nodeType === 'continue_block'
                          || node.nodeType === 'what_if'
                          || node.nodeType === 'future_jump'
                          ? () => props.onDeleteBranchNode(node)
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
