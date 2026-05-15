"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BranchBlock } from '@/components/timeline/BranchBlock'
import { BranchLineLayer } from '@/components/timeline/BranchLineLayer'
import { ChapterTimelineCard } from '@/components/timeline/ChapterTimelineCard'
import type { ChapterTimelineItem, StoryTimelineBranchNode, StoryTimelineEdge, TimelineSelection } from '@/lib/story-branch-types'
import type { Chapter } from '@/lib/types'

type NodePosition = {
  x: number
  y: number
}

function toSelection(node: StoryTimelineBranchNode): TimelineSelection | null {
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
    const grouped = new Map<number, StoryTimelineBranchNode[]>()
    for (const node of props.branchNodes) {
      const current = grouped.get(node.anchorChapterNo) ?? []
      current.push(node)
      grouped.set(node.anchorChapterNo, current)
    }
    for (const group of grouped.values()) {
      group.sort((left, right) => {
        if (left.laneIndex !== right.laneIndex) return left.laneIndex - right.laneIndex
        return left.id.localeCompare(right.id)
      })
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
        x: rect.left - bounds.left,
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
                  const selection = toSelection(node)
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
                      disabled={!selection}
                      onSelect={() => {
                        if (selection) props.onSelectionChange(selection)
                      }}
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
