"use client"

import '@xyflow/react/dist/style.css'
import { useEffect, useMemo } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'
import type { GraphEdge, GraphNode } from '@/lib/server/graph-types'
import type { GraphReviewControls } from '@/components/graph/types'

const LOW_CONFIDENCE_THRESHOLD = 0.5
const NODE_WIDTH = 252
const NODE_MIN_HEIGHT = 96
const COLUMN_X = [40, 356, 672]
const ROW_Y_START = 52
const ROW_GAP = 152

function getNodeHop(nodeId: string, seedIds: Set<string>, edges: GraphEdge[]) {
  if (seedIds.has(nodeId)) return 0
  const related = edges.filter((edge) => edge.source === nodeId || edge.target === nodeId)
  if (!related.length) return 1
  return Math.min(...related.map((edge) => edge.hop))
}

function getNodeTone(node: GraphNode, seedIds: Set<string>) {
  if (seedIds.has(node.id)) {
    return {
      background: 'rgba(245, 158, 11, 0.18)',
      borderColor: 'rgba(252, 211, 77, 0.44)',
      textColor: '#fef3c7',
    }
  }

  if (node.userConfirmed) {
    return {
      background: 'rgba(56, 189, 248, 0.12)',
      borderColor: 'rgba(125, 211, 252, 0.3)',
      textColor: '#e0f2fe',
    }
  }

  return {
    background: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    textColor: '#f4f4f5',
  }
}

function buildFlowNodes(nodes: GraphNode[], edges: GraphEdge[], seedIds: Set<string>): Node[] {
  const buckets = new Map<number, GraphNode[]>()

  for (const node of nodes) {
    const hop = getNodeHop(node.id, seedIds, edges)
    const current = buckets.get(hop) ?? []
    current.push(node)
    buckets.set(hop, current)
  }

  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => right.score - left.score || right.importance - left.importance)
  }

  return nodes.map((node) => {
    const hop = getNodeHop(node.id, seedIds, edges)
    const bucket = buckets.get(hop) ?? [node]
    const index = Math.max(bucket.findIndex((item) => item.id === node.id), 0)
    const y = ROW_Y_START + index * ROW_GAP
    const tone = getNodeTone(node, seedIds)

    return {
      id: node.id,
      position: {
        x: COLUMN_X[Math.min(hop, COLUMN_X.length - 1)] ?? COLUMN_X[COLUMN_X.length - 1],
        y,
      },
      draggable: true,
      data: {
        label: (
          <div className="w-full rounded-[inherit] px-4 py-3.5">
            <div className="flex items-start gap-2.5">
              <div className="min-w-0 flex-1 space-y-2">
                <p className="line-clamp-3 break-words text-[15px] font-medium leading-5 text-pretty">{node.label}</p>
                <div className="flex flex-wrap gap-1.5 text-[10px] uppercase tracking-[0.14em] text-zinc-400">
                  <span>{node.entityType}</span>
                  <span>·</span>
                  <span>{Math.round(node.confidence * 100)}%</span>
                  <span>·</span>
                  <span>score {node.score.toFixed(1)}</span>
                </div>
              </div>
              {seedIds.has(node.id) ? (
                <span className="shrink-0 rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-amber-100">
                  Seed
                </span>
              ) : null}
            </div>
          </div>
        ),
      },
      style: {
        width: NODE_WIDTH,
        minHeight: NODE_MIN_HEIGHT,
        borderRadius: 24,
        border: `1px solid ${tone.borderColor}`,
        background: tone.background,
        color: tone.textColor,
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.28)',
        padding: 0,
        overflow: 'hidden',
        boxSizing: 'border-box',
      },
    }
  })
}

function buildFlowEdges(edges: GraphEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label?.trim() || edge.linkType,
    type: 'smoothstep',
    animated: edge.status === 'potentially_stale',
    style: {
      stroke: edge.status === 'potentially_stale' ? '#f59e0b' : edge.confidence < LOW_CONFIDENCE_THRESHOLD ? '#64748b' : '#38bdf8',
      strokeOpacity: edge.confidence < LOW_CONFIDENCE_THRESHOLD ? 0.55 : 0.88,
      strokeWidth: edge.hop === 1 ? 1.9 : 1.4,
    },
    labelStyle: {
      fill: '#e4e4e7',
      fontSize: 11,
      fontWeight: 500,
    },
    labelBgStyle: {
      fill: 'rgba(13, 16, 23, 0.92)',
      fillOpacity: 1,
    },
  }))
}

function GraphFlowInner(props: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  seedNodeIds: string[]
  controls: GraphReviewControls
  loading: boolean
  onSelectNode: (node: GraphNode) => void
  onSelectEdge: (edge: GraphEdge) => void
  onClearSelection: () => void
  onChangeControls: (controls: GraphReviewControls) => void
  onRefresh: () => void
}) {
  const { t } = useI18n()
  const seedIds = useMemo(() => new Set(props.seedNodeIds), [props.seedNodeIds])
  const visibleEdges = useMemo(() => {
    return props.edges.filter((edge) => {
      if (edge.hop > props.controls.maxHops) return false
      if (props.controls.hideLowConfidence && edge.confidence < LOW_CONFIDENCE_THRESHOLD) return false
      if (props.controls.confirmedOnly && edge.status !== 'user_confirmed') return false
      if (!props.controls.showPotentiallyStale && edge.status === 'potentially_stale') return false
      return true
    })
  }, [props.controls.confirmedOnly, props.controls.hideLowConfidence, props.controls.maxHops, props.controls.showPotentiallyStale, props.edges])

  const visibleNodeIds = useMemo(() => {
    const ids = new Set<string>(Array.from(seedIds))
    for (const edge of visibleEdges) {
      ids.add(edge.source)
      ids.add(edge.target)
    }
    return ids
  }, [seedIds, visibleEdges])

  const visibleNodes = useMemo(() => {
    return props.nodes.filter((node) => {
      if (!visibleNodeIds.has(node.id)) return false
      if (!props.controls.confirmedOnly) return true
      return seedIds.has(node.id) || node.userConfirmed
    })
  }, [props.controls.confirmedOnly, props.nodes, seedIds, visibleNodeIds])
  const flowNodes = useMemo(() => buildFlowNodes(visibleNodes, visibleEdges, seedIds), [seedIds, visibleEdges, visibleNodes])
  const flowEdges = useMemo(() => buildFlowEdges(visibleEdges), [visibleEdges])
  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges)

  useEffect(() => {
    setNodes(flowNodes)
  }, [flowNodes, setNodes])

  useEffect(() => {
    setEdges(flowEdges)
  }, [flowEdges, setEdges])

  return (
    <div className="h-[500px] overflow-hidden rounded-[24px] border border-white/8 bg-[#090c12] sm:h-[580px] xl:h-[660px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          const match = props.nodes.find((item) => item.id === node.id)
          if (match) props.onSelectNode(match)
        }}
        onEdgeClick={(_, edge) => {
          const match = props.edges.find((item) => item.id === edge.id)
          if (match) props.onSelectEdge(match)
        }}
        onPaneClick={props.onClearSelection}
        fitView
        fitViewOptions={{ padding: 0.32 }}
        minZoom={0.4}
        maxZoom={1.45}
        defaultEdgeOptions={{ zIndex: 1 }}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background color="rgba(255,255,255,0.08)" gap={20} size={1} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => (seedIds.has(node.id) ? 'rgba(251, 191, 36, 0.85)' : 'rgba(148, 163, 184, 0.8)')}
          maskColor="rgba(4, 6, 10, 0.68)"
          style={{ backgroundColor: 'rgba(10, 12, 18, 0.9)', border: '1px solid rgba(255,255,255,0.08)' }}
        />
        <Controls style={{ background: 'rgba(10, 12, 18, 0.92)', border: '1px solid rgba(255,255,255,0.08)' }} />
        <Panel position="top-left" className="m-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => props.onChangeControls({ ...props.controls, maxHops: 1 })}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs transition',
              props.controls.maxHops === 1 ? 'border-amber-300/30 bg-amber-500/14 text-amber-100' : 'border-white/10 bg-black/40 text-zinc-400'
            )}
          >
            1-hop
          </button>
          <button
            type="button"
            onClick={() => props.onChangeControls({ ...props.controls, maxHops: 2 })}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs transition',
              props.controls.maxHops === 2 ? 'border-amber-300/30 bg-amber-500/14 text-amber-100' : 'border-white/10 bg-black/40 text-zinc-400'
            )}
          >
            2-hop
          </button>
          <button
            type="button"
            onClick={() => props.onChangeControls({ ...props.controls, hideLowConfidence: !props.controls.hideLowConfidence })}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs transition',
              props.controls.hideLowConfidence ? 'border-sky-300/30 bg-sky-500/14 text-sky-100' : 'border-white/10 bg-black/40 text-zinc-400'
            )}
          >
            {t('graph.controls.hideLowConfidence')}
          </button>
          <button
            type="button"
            onClick={() => props.onChangeControls({ ...props.controls, confirmedOnly: !props.controls.confirmedOnly })}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs transition',
              props.controls.confirmedOnly ? 'border-emerald-300/30 bg-emerald-500/14 text-emerald-100' : 'border-white/10 bg-black/40 text-zinc-400'
            )}
          >
            {t('graph.controls.confirmedOnly')}
          </button>
          <button
            type="button"
            onClick={() => props.onChangeControls({ ...props.controls, showPotentiallyStale: !props.controls.showPotentiallyStale })}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs transition',
              props.controls.showPotentiallyStale ? 'border-orange-300/30 bg-orange-500/14 text-orange-100' : 'border-white/10 bg-black/40 text-zinc-400'
            )}
          >
            {t('graph.controls.showPotentiallyStale')}
          </button>
          <button
            type="button"
            onClick={props.onRefresh}
            className="rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-white/[0.06]"
          >
            {t('graph.controls.refresh')}
          </button>
        </Panel>
        <Panel position="bottom-left" className="m-3 rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-[11px] text-zinc-400">
          {props.loading ? t('graph.refreshing') : t('graph.statusCounts', { nodes: visibleNodes.length, edges: visibleEdges.length })}
        </Panel>
      </ReactFlow>
    </div>
  )
}

export function GraphFlowCanvas(props: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  seedNodeIds: string[]
  controls: GraphReviewControls
  loading: boolean
  onSelectNode: (node: GraphNode) => void
  onSelectEdge: (edge: GraphEdge) => void
  onClearSelection: () => void
  onChangeControls: (controls: GraphReviewControls) => void
  onRefresh: () => void
}) {
  return (
    <ReactFlowProvider>
      <GraphFlowInner {...props} />
    </ReactFlowProvider>
  )
}
