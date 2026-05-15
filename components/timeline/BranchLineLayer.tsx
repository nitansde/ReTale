"use client"

import type { StoryTimelineEdge } from '@/lib/story-branch-types'
import { cn } from '@/lib/utils'

type NodePosition = {
  x: number
  y: number
}

function buildFoldedPath(from: NodePosition, to: NodePosition) {
  const trunkX = Math.min(from.x, to.x) - 18
  return `M ${from.x} ${from.y} H ${trunkX} V ${to.y} H ${to.x}`
}

export function BranchLineLayer(props: {
  width: number
  height: number
  edges: StoryTimelineEdge[]
  nodePositions: Record<string, NodePosition>
  selectedNodeId: string | null
  hoveredNodeId: string | null
}) {
  return (
    <svg className="pointer-events-none absolute inset-0 z-0 overflow-visible" width={props.width} height={props.height} aria-hidden="true">
      {props.edges.map((edge) => {
        const from = props.nodePositions[edge.fromNodeId]
        const to = props.nodePositions[edge.toNodeId]
        if (!from || !to) return null

        const highlighted = props.hoveredNodeId === edge.fromNodeId || props.hoveredNodeId === edge.toNodeId
        const selected = props.selectedNodeId === edge.fromNodeId || props.selectedNodeId === edge.toNodeId

        return (
          <path
            key={`${edge.fromNodeId}-${edge.toNodeId}`}
            data-testid={`timeline-edge-${edge.fromNodeId}-${edge.toNodeId}`}
            data-active={selected ? 'true' : 'false'}
            data-highlighted={highlighted ? 'true' : 'false'}
            d={buildFoldedPath(from, to)}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={selected ? 2.8 : highlighted ? 2.4 : 2}
            className={cn(
              'transition-all',
              selected ? 'stroke-sky-300' : highlighted ? 'stroke-fuchsia-300/90' : 'stroke-white/22'
            )}
          />
        )
      })}
    </svg>
  )
}
