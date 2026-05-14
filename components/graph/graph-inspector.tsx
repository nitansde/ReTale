"use client"

import { useState } from 'react'
import { Ban, Check, Pencil, Save, X } from 'lucide-react'
import type { GraphEdge, GraphNode } from '@/lib/server/graph-types'
import type { GraphEdgeEditDraft, GraphNodeGenerationState, GraphSelection } from '@/components/graph/types'
import { INF_CHAPTER } from '@/lib/server/chapter-interval'

const STATUS_LABELS: Record<string, string> = {
  ai_generated: 'AI 推断',
  user_confirmed: '已确认',
  rejected: '已拒绝',
  outdated: '已过期',
  conflicted: '有冲突',
  potentially_stale: '可能过时',
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-white/8 bg-black/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{props.label}</p>
      <p className="mt-1 text-sm text-zinc-200">{props.value}</p>
    </div>
  )
}

function buildEdgeEditDraft(edge: GraphEdge): GraphEdgeEditDraft {
  return {
    linkType: edge.linkType,
    label: edge.label ?? '',
    description: edge.description ?? '',
    polarity: edge.polarity ?? '',
    strength: edge.strength,
    validFromChapter: edge.validFromChapter,
    validUntilChapter: edge.validUntilChapter >= INF_CHAPTER ? '' : String(edge.validUntilChapter),
    includeByDefault: edge.includeInPrompt,
  }
}

const NODE_GENERATION_LABELS: Record<GraphNodeGenerationState['inclusionState'], string> = {
  included: '关联边本次纳入',
  partial: '部分关联边本次排除',
  excluded: '关联边本次排除',
  unavailable: '暂无可映射关系边',
}

function NodeInspector(props: {
  node: GraphNode
  mode: 'selection' | 'browse-only'
  generationState?: GraphNodeGenerationState
  onToggleNodeExcluded?: (node: GraphNode, excluded: boolean) => void
}) {
  const { node } = props

  return (
    <>
      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Selected node</p>
      <h4 className="mt-2 text-lg font-semibold text-zinc-100">{node.label}</h4>
      <p className="mt-1 text-sm text-zinc-400">{node.description?.trim() || '当前节点没有额外描述，图中展示的是知识图谱里的实体摘要。'} </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric label="Type" value={node.entityType} />
        <Metric label="Status" value={node.status?.trim() || 'active'} />
        <Metric label="Confidence" value={`${Math.round(node.confidence * 100)}%`} />
        <Metric label="Importance" value={String(node.importance)} />
        <Metric label="Score" value={node.score.toFixed(1)} />
        <Metric label="First seen" value={node.firstSeenChapter ? `第 ${node.firstSeenChapter} 章` : '未知'} />
        {props.generationState ? <Metric label="Generation" value={NODE_GENERATION_LABELS[props.generationState.inclusionState]} /> : null}
        {props.generationState ? <Metric label="Mapped edges" value={String(props.generationState.connectedEdgeIds.length)} /> : null}
      </div>

      {props.mode === 'selection' && props.generationState ? (
        <div className="mt-4 rounded-[20px] border border-amber-300/15 bg-amber-500/10 p-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={props.generationState.inclusionState === 'included' || props.generationState.inclusionState === 'unavailable'}
              onClick={() => props.onToggleNodeExcluded?.(node, false)}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100 transition hover:bg-emerald-500/16 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              重新纳入关联边
            </button>
            <button
              type="button"
              disabled={props.generationState.inclusionState === 'excluded' || props.generationState.inclusionState === 'unavailable'}
              onClick={() => props.onToggleNodeExcluded?.(node, true)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-50"
            >
              <Ban className="h-3.5 w-3.5" />
              排除关联边用于本次生成
            </button>
          </div>
          <p className="mt-3 text-xs leading-6 text-zinc-400">
            节点操作不会改写图谱，只会把当前图里与「{node.label}」直接相连的关系边映射到这一次 prompt 的临时排除列表。
          </p>
        </div>
      ) : null}
    </>
  )
}

function EdgeInspector(props: {
  edge: GraphEdge
  source?: GraphNode
  target?: GraphNode
  mode: 'selection' | 'browse-only'
  excluded: boolean
  mutationPending: boolean
  mutationError: string
  onConfirmEdge?: (edge: GraphEdge) => void
  onRejectEdge?: (edge: GraphEdge) => void
  onSaveEdgeEdit?: (edge: GraphEdge, draft: GraphEdgeEditDraft) => void
  onToggleEdgeExcluded?: (edge: GraphEdge, excluded: boolean) => void
}) {
  const { edge, source, target } = props
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<GraphEdgeEditDraft>(() => buildEdgeEditDraft(edge))

  return (
    <>
      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Selected edge</p>
      <h4 className="mt-2 text-lg font-semibold text-zinc-100">{edge.label?.trim() || edge.linkType}</h4>
      <p className="mt-1 text-sm text-zinc-400">
        {source?.label ?? edge.source} → {target?.label ?? edge.target}
      </p>
      <p className="mt-3 text-sm leading-6 text-zinc-300">{edge.description?.trim() || '当前关系边没有额外描述。'}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric label="Status" value={STATUS_LABELS[edge.status] ?? edge.status} />
        <Metric label="Hop" value={`${edge.hop}-hop`} />
        <Metric label="Confidence" value={`${Math.round(edge.confidence * 100)}%`} />
        <Metric label="Strength" value={edge.strength.toFixed(1)} />
        <Metric label="Valid from" value={`第 ${edge.validFromChapter} 章`} />
        <Metric
          label="Valid until"
          value={edge.validUntilChapter >= INF_CHAPTER ? '当前仍有效' : `第 ${edge.validUntilChapter} 章前有效`}
        />
        <Metric label="Prompt" value={edge.includeInPrompt ? '默认纳入' : '默认排除'} />
        <Metric label="Generation" value={props.excluded ? '本次排除' : '本次纳入'} />
      </div>

      {props.mode === 'selection' ? (
        <div className="mt-4 rounded-[20px] border border-amber-300/15 bg-amber-500/10 p-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={props.mutationPending}
              onClick={() => props.onConfirmEdge?.(edge)}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100 transition hover:bg-emerald-500/16 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              确认关系
            </button>
            <button
              type="button"
              disabled={props.mutationPending}
              onClick={() => props.onRejectEdge?.(edge)}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100 transition hover:bg-rose-500/16 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              拒绝关系
            </button>
            <button
              type="button"
              disabled={props.mutationPending}
              onClick={() => props.onToggleEdgeExcluded?.(edge, !props.excluded)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-50"
            >
              <Ban className="h-3.5 w-3.5" />
              {props.excluded ? '重新纳入本次生成' : '排除本次生成'}
            </button>
            <button
              type="button"
              disabled={props.mutationPending}
              onClick={() => setEditing((current) => !current)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-50"
            >
              <Pencil className="h-3.5 w-3.5" />
              {editing ? '收起编辑' : '编辑关系'}
            </button>
          </div>

          {props.mutationError ? <p className="mt-3 text-xs leading-6 text-rose-200">{props.mutationError}</p> : null}

          {editing ? (
            <div className="mt-3 grid gap-3 rounded-[18px] border border-white/8 bg-black/20 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">Link type</span>
                  <input
                    value={draft.linkType}
                    onChange={(event) => setDraft((current) => ({ ...current, linkType: event.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">Label</span>
                  <input
                    value={draft.label}
                    onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none"
                    placeholder="可选展示名称"
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">Description</span>
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                  className="min-h-[84px] w-full rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none"
                  placeholder="补充关系说明"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">Polarity</span>
                  <select
                    value={draft.polarity}
                    onChange={(event) => setDraft((current) => ({ ...current, polarity: event.target.value as GraphEdgeEditDraft['polarity'] }))}
                    className="w-full rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none"
                  >
                    <option value="">未设置</option>
                    <option value="positive">positive</option>
                    <option value="negative">negative</option>
                    <option value="neutral">neutral</option>
                    <option value="mixed">mixed</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">Strength</span>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={draft.strength}
                    onChange={(event) => setDraft((current) => ({ ...current, strength: Number(event.target.value || 1) }))}
                    className="w-full rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">Valid from</span>
                  <input
                    type="number"
                    min={1}
                    value={draft.validFromChapter}
                    onChange={(event) => setDraft((current) => ({ ...current, validFromChapter: Number(event.target.value || 1) }))}
                    className="w-full rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">Valid until</span>
                  <input
                    type="number"
                    min={1}
                    value={draft.validUntilChapter}
                    onChange={(event) => setDraft((current) => ({ ...current, validUntilChapter: event.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none"
                    placeholder="留空表示仍有效"
                  />
                </label>
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={draft.includeByDefault}
                  onChange={(event) => setDraft((current) => ({ ...current, includeByDefault: event.target.checked }))}
                  className="h-4 w-4 rounded border-white/20 bg-[#0b0d12]"
                />
                默认纳入后续 Prompt 图谱上下文
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={props.mutationPending || !draft.linkType.trim()}
                  onClick={() => props.onSaveEdgeEdit?.(edge, draft)}
                  className="inline-flex items-center gap-2 rounded-xl border border-sky-300/20 bg-sky-500/10 px-3 py-2 text-xs text-sky-100 transition hover:bg-sky-500/16 disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  保存修改
                </button>
                <button
                  type="button"
                  disabled={props.mutationPending}
                  onClick={() => {
                    setDraft(buildEdgeEditDraft(edge))
                    setEditing(false)
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                  取消编辑
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

export function GraphInspector(props: {
  selection: GraphSelection
  nodeById: Map<string, GraphNode>
  nodeCount: number
  edgeCount: number
  warningCount: number
  graphEdges?: GraphEdge[]
  mode?: 'selection' | 'browse-only'
  modeLabel?: string
  excludedEdgeIds?: string[]
  edgeMutationPending?: boolean
  edgeMutationError?: string
  onConfirmEdge?: (edge: GraphEdge) => void
  onRejectEdge?: (edge: GraphEdge) => void
  onSaveEdgeEdit?: (edge: GraphEdge, draft: GraphEdgeEditDraft) => void
  onToggleEdgeExcluded?: (edge: GraphEdge, excluded: boolean) => void
  onToggleNodeExcluded?: (node: GraphNode, excluded: boolean) => void
  emptyStateCopy?: {
    eyebrow: string
    title: string
    description: string
  }
}) {
  const edge = props.selection?.type === 'edge' ? props.selection.edge : null
  const node = props.selection?.type === 'node' ? props.selection.node : null
  const mode = props.mode ?? 'browse-only'
  const nodeGenerationState = node
    ? (() => {
        const connectedEdgeIds = (props.graphEdges ?? [])
          .filter((graphEdge) => graphEdge.source === node.id || graphEdge.target === node.id)
          .map((graphEdge) => graphEdge.id)

        if (!connectedEdgeIds.length) {
          return {
            connectedEdgeIds,
            inclusionState: 'unavailable',
          } satisfies GraphNodeGenerationState
        }

        const excludedCount = connectedEdgeIds.filter((edgeId) => props.excludedEdgeIds?.includes(edgeId)).length
        return {
          connectedEdgeIds,
          inclusionState:
            excludedCount === 0
              ? 'included'
              : excludedCount === connectedEdgeIds.length
                ? 'excluded'
                : 'partial',
        } satisfies GraphNodeGenerationState
      })()
    : undefined
  const emptyStateCopy = props.emptyStateCopy ?? {
    eyebrow: 'Inspector',
    title: 'Graph review overview',
    description: '点击图中的实体或关系边后，这里会显示对应的只读详情。当前先给你一个总体视角，方便在小屏上也不会迷路。',
  }

  return (
    <aside className="rounded-[24px] border border-white/8 bg-black/20 p-4">
      {node ? <NodeInspector node={node} mode={mode} generationState={nodeGenerationState} onToggleNodeExcluded={props.onToggleNodeExcluded} /> : null}
      {edge ? (
        <EdgeInspector
          key={edge.id}
          edge={edge}
          source={props.nodeById.get(edge.source)}
          target={props.nodeById.get(edge.target)}
          mode={mode}
          excluded={Boolean(props.excludedEdgeIds?.includes(edge.id))}
          mutationPending={Boolean(props.edgeMutationPending)}
          mutationError={props.edgeMutationError ?? ''}
          onConfirmEdge={props.onConfirmEdge}
          onRejectEdge={props.onRejectEdge}
          onSaveEdgeEdit={props.onSaveEdgeEdit}
          onToggleEdgeExcluded={props.onToggleEdgeExcluded}
        />
      ) : null}
      {!props.selection ? (
        <>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{emptyStateCopy.eyebrow}</p>
          <h4 className="mt-2 text-lg font-semibold text-zinc-100">{emptyStateCopy.title}</h4>
          <p className="mt-2 text-sm leading-6 text-zinc-400">{emptyStateCopy.description}</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Metric label="Nodes" value={String(props.nodeCount)} />
            <Metric label="Edges" value={String(props.edgeCount)} />
            <Metric label="Warnings" value={String(props.warningCount)} />
            <Metric label="Mode" value={props.modeLabel ?? 'read-only'} />
          </div>
        </>
      ) : null}
    </aside>
  )
}
