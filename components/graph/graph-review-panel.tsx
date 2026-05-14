import type { GraphEdgeEditDraft, GenerationContextBuildData, GenerationContextEvidence, GraphReviewControls, GraphSelection } from '@/components/graph/types'
import { RefreshCcw } from 'lucide-react'
import { ContextPromptBlocks } from '@/components/graph/context-prompt-blocks'
import { GraphEvidenceDrawer } from '@/components/graph/graph-evidence-drawer'
import { GraphFlowCanvas } from '@/components/graph/graph-flow-canvas'
import { GraphInspector } from '@/components/graph/graph-inspector'
import type { GraphEdge, GraphNode } from '@/lib/server/graph-types'

export function GraphReviewPanel(props: {
  context: GenerationContextBuildData
  graphNodes: GraphNode[]
  graphEdges: GraphEdge[]
  controls: GraphReviewControls
  loading: boolean
  error: string
  selection: GraphSelection
  evidenceDrawerOpen: boolean
  disabledBlockIds: string[]
  excludedEdgeIds: string[]
  excludedEvidenceIds: string[]
  edgeMutationPending: boolean
  edgeMutationError: string
  onTogglePromptBlock: (blockId: string, enabled: boolean) => void
  onToggleEvidenceDrawer: () => void
  onSelectNode: (node: GraphNode) => void
  onSelectEdge: (edge: GraphEdge) => void
  onClearSelection: () => void
  onConfirmEdge: (edge: GraphEdge) => void
  onRejectEdge: (edge: GraphEdge) => void
  onSaveEdgeEdit: (edge: GraphEdge, draft: GraphEdgeEditDraft) => void
  onToggleEdgeExcluded: (edge: GraphEdge, excluded: boolean) => void
  onToggleNodeExcluded: (node: GraphNode, excluded: boolean) => void
  onToggleEvidenceExcluded: (itemId: string, excluded: boolean) => void
  onChangeControls: (controls: GraphReviewControls) => void
  onJumpToEdgeSource: (edge: GraphEdge) => void
  canJumpToEdgeSource: (edge: GraphEdge) => boolean
  onJumpToEvidenceSource: (item: GenerationContextEvidence) => void
  canJumpToEvidenceSource: (item: GenerationContextEvidence) => boolean
  onRefresh: () => void
}) {
  const nodeById = new Map(props.graphNodes.map((node) => [node.id, node] as const))
  const selectedEdge = props.selection?.type === 'edge' ? props.selection.edge : null

  return (
    <section className="mb-4 rounded-[24px] border border-amber-400/20 bg-amber-500/10 p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-amber-200/70">Graph review</p>
          <p className="mt-1 text-sm text-zinc-300">当前面板会先读取生成上下文，再把图谱、证据和 prompt 块拆开给你检查。这里可以只对本次生成临时排除边、节点关联边或证据，也可以直接确认、拒绝或编辑关系边。</p>
        </div>
        <button
          type="button"
          onClick={props.onRefresh}
          className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300 transition hover:bg-white/[0.06]"
        >
          <RefreshCcw className="h-4 w-4" />
          刷新上下文
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-[11px] text-zinc-400">
        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">第 {props.context.chapterNo} 章</span>
        {props.context.sourceMeta?.mode === 'inherited-parent' ? (
          <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-500/10 px-3 py-1 text-fuchsia-100">
            图谱继承自主线第 {props.context.sourceMeta.chapterNo} 章
          </span>
        ) : null}
        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">选中行：{props.context.selectedLineStart ?? '?'} - {props.context.selectedLineEnd ?? '?'}</span>
        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">Prompt 约 {props.context.tokenEstimate} tokens</span>
      </div>

      {props.context.warnings.length ? (
        <div className="mb-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {props.context.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      {props.error ? <p className="mb-4 text-sm text-rose-300">{props.error}</p> : null}

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.9fr)_minmax(340px,0.74fr)]">
        <GraphFlowCanvas
          nodes={props.graphNodes}
          edges={props.graphEdges}
          seedNodeIds={props.context.graphContext.seedEntities.map((node) => node.id)}
          controls={props.controls}
          loading={props.loading}
          onSelectNode={props.onSelectNode}
          onSelectEdge={props.onSelectEdge}
          onClearSelection={props.onClearSelection}
          onChangeControls={props.onChangeControls}
          onRefresh={props.onRefresh}
        />
        <GraphInspector
          selection={props.selection}
          nodeById={nodeById}
          nodeCount={props.graphNodes.length}
          edgeCount={props.graphEdges.length}
          warningCount={props.context.warnings.length}
          graphEdges={props.graphEdges}
          mode="selection"
          modeLabel="selection-review"
          excludedEdgeIds={props.excludedEdgeIds}
          edgeMutationPending={props.edgeMutationPending}
          edgeMutationError={props.edgeMutationError}
          onConfirmEdge={props.onConfirmEdge}
          onRejectEdge={props.onRejectEdge}
          onSaveEdgeEdit={props.onSaveEdgeEdit}
          onToggleEdgeExcluded={props.onToggleEdgeExcluded}
          onToggleNodeExcluded={props.onToggleNodeExcluded}
        />
      </div>

      <div className="mt-4 space-y-4">
        <GraphEvidenceDrawer
          open={props.evidenceDrawerOpen}
          onToggle={props.onToggleEvidenceDrawer}
          selectedEdge={selectedEdge}
          evidence={props.context.lanceEvidence}
          interactive
          excludedEvidenceIds={props.excludedEvidenceIds}
          onToggleEvidenceExcluded={(item, excluded) => props.onToggleEvidenceExcluded(item.id, excluded)}
          canJumpToEdgeSource={Boolean(selectedEdge && props.canJumpToEdgeSource(selectedEdge))}
          onJumpToEdgeSource={props.onJumpToEdgeSource}
          canJumpToEvidenceSource={props.canJumpToEvidenceSource}
          onJumpToEvidenceSource={props.onJumpToEvidenceSource}
        />
        <ContextPromptBlocks
          blocks={props.context.promptBlocks}
          disabledBlockIds={props.disabledBlockIds}
          onToggle={props.onTogglePromptBlock}
        />
      </div>
    </section>
  )
}
