import type { GraphEdgeEditDraft, GenerationContextBuildData, GenerationContextEvidence, GraphReviewControls, GraphSelection } from '@/components/graph/types'
import { RefreshCcw } from 'lucide-react'
import { getVisibleAdvancedContextPromptBlocks } from '@/components/graph/context-prompt-block-visibility'
import { ContextPromptBlocks } from '@/components/graph/context-prompt-blocks'
import { GraphEvidenceDrawer } from '@/components/graph/graph-evidence-drawer'
import { GraphFlowCanvas } from '@/components/graph/graph-flow-canvas'
import { GraphInspector } from '@/components/graph/graph-inspector'
import { useI18n } from '@/lib/i18n/provider'
import { formatContextWarning } from '@/lib/context-warnings'
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
  const { locale, t } = useI18n()
  const nodeById = new Map(props.graphNodes.map((node) => [node.id, node] as const))
  const selectedEdge = props.selection?.type === 'edge' ? props.selection.edge : null
  const visiblePromptBlocks = getVisibleAdvancedContextPromptBlocks(props.context.promptBlocks)

  return (
    <section className="mb-4 rounded-[24px] border border-amber-400/20 bg-amber-500/10 p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-amber-200/70">{t('graph.reviewEyebrow')}</p>
          <p className="mt-1 text-sm text-zinc-300">{t('graph.reviewDescription')}</p>
        </div>
        <button
          type="button"
          onClick={props.onRefresh}
          className="inline-flex items-center gap-2 rounded-2xl border border-line/10 bg-shade/20 px-3 py-2 text-xs text-zinc-300 transition hover:bg-overlay/[0.06]"
        >
          <RefreshCcw className="h-4 w-4" />
          {t('graph.refreshContext')}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-[11px] text-zinc-400">
        <span className="rounded-full border border-line/10 bg-shade/20 px-3 py-1">{t('graph.chapterOnly', { chapterNo: props.context.chapterNo })}</span>
        {props.context.sourceMeta?.mode === 'inherited-parent' ? (
          <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-500/10 px-3 py-1 text-fuchsia-100">
            {t('graph.inheritedFromMainline', { chapterNo: props.context.sourceMeta.chapterNo })}
          </span>
        ) : null}
        <span className="rounded-full border border-line/10 bg-shade/20 px-3 py-1">{t('graph.selectedLines', { start: props.context.selectedLineStart ?? '?', end: props.context.selectedLineEnd ?? '?' })}</span>
        <span className="rounded-full border border-line/10 bg-shade/20 px-3 py-1">{t('graph.promptApproxTokens', { count: props.context.tokenEstimate })}</span>
      </div>

      {props.context.warnings.length ? (
        <div className="mb-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {props.context.warnings.map((warning) => (
            <p key={warning}>{formatContextWarning(warning, locale)}</p>
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
          modeLabel={t('graph.selectionReviewMode')}
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
          blocks={visiblePromptBlocks}
          disabledBlockIds={props.disabledBlockIds}
          onToggle={props.onTogglePromptBlock}
        />
      </div>
    </section>
  )
}
