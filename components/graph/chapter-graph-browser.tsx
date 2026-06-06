"use client"

import { useMemo, useState } from 'react'
import { AlertTriangle, GitBranch, Globe, Network, RefreshCcw, Sparkles } from 'lucide-react'
import { GraphEvidenceDrawer } from '@/components/graph/graph-evidence-drawer'
import { GraphFlowCanvas } from '@/components/graph/graph-flow-canvas'
import { GraphInspector } from '@/components/graph/graph-inspector'
import type { ChapterGraphContextData, GraphContextSourceMeta, GraphReviewControls, GraphSelection } from '@/components/graph/types'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'
import type { GraphEdge, GraphNode } from '@/lib/server/graph-types'
import type { Chapter } from '@/lib/types'

function Pill(props: { label: string; tone?: 'default' | 'violet' | 'amber' | 'rose' | 'sky' }) {
  return (
    <span
      className={cn(
        'rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.16em]',
        props.tone === 'violet' && 'border-violet-300/20 bg-violet-500/12 text-violet-100',
        props.tone === 'amber' && 'border-amber-300/20 bg-amber-500/12 text-amber-100',
        props.tone === 'rose' && 'border-rose-300/20 bg-rose-500/12 text-rose-100',
        props.tone === 'sky' && 'border-sky-300/20 bg-sky-500/12 text-sky-100',
        (!props.tone || props.tone === 'default') && 'border-white/10 bg-black/20 text-zinc-300'
      )}
    >
      {props.label}
    </span>
  )
}

function formatEdgeLocation(edge: GraphEdge, emptyLabel: string, t: ReturnType<typeof useI18n>['t']) {
  const location = edge.evidenceLocation
  if (!location) return emptyLabel
  if (location.lineStart && location.lineEnd) return t('graph.chapterLineRange', { chapterNo: location.chapterNo, start: location.lineStart, end: location.lineEnd })
  if (location.lineStart) return t('graph.chapterLineSingle', { chapterNo: location.chapterNo, line: location.lineStart })
  return t('graph.chapterOnly', { chapterNo: location.chapterNo })
}

function EdgeEvidencePanel(props: { edge: GraphEdge | null; source?: GraphNode; target?: GraphNode }) {
  const { t } = useI18n()
  return (
    <section className="rounded-[24px] border border-white/8 bg-black/20 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-2xl border border-sky-400/20 bg-sky-500/10 p-2 text-sky-100">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('graph.edgeEvidence')}</p>
          {props.edge ? (
            <>
              <h4 className="mt-2 text-sm font-medium text-zinc-100">
                {(props.source?.label ?? props.edge.source)} → {(props.target?.label ?? props.edge.target)}
              </h4>
              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-zinc-500">{formatEdgeLocation(props.edge, t('graph.edgeNoLocation'), t)}</p>
              {props.edge.evidenceQuote ? (
                <p className="mt-3 whitespace-pre-wrap rounded-[20px] border border-sky-300/15 bg-sky-500/10 p-4 text-sm leading-6 text-sky-50">
                  {props.edge.evidenceQuote}
                </p>
              ) : (
                <p className="mt-3 rounded-[20px] border border-white/8 bg-black/30 p-4 text-sm leading-6 text-zinc-400">
                  {t('graph.edgeNoQuote')}
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 rounded-[20px] border border-white/8 bg-black/30 p-4 text-sm leading-6 text-zinc-400">
              {t('graph.edgeSelectHint')}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function GraphEmptyState(props: { chapterLabel: string; warning?: string }) {
  const { t } = useI18n()
  return (
    <div className="rounded-[28px] border border-dashed border-white/10 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.08),_transparent_40%),#0b0d12] p-6 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] border border-white/10 bg-white/[0.04] text-zinc-200">
        <Network className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-xl font-semibold text-zinc-100">{t('graph.emptyTitle')}</h3>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
        {props.warning ?? t('graph.emptyDescription', { chapterLabel: props.chapterLabel })}
      </p>
    </div>
  )
}

export function ChapterGraphBrowser(props: {
  chapter: Chapter
  parentChapter: Chapter | null
  data: ChapterGraphContextData | null
  sourceMeta?: GraphContextSourceMeta
  controls: GraphReviewControls
  selection: GraphSelection
  loading: boolean
  error: string
  onSelectNode: (node: GraphNode) => void
  onSelectEdge: (edge: GraphEdge) => void
  onClearSelection: () => void
  onChangeControls: (controls: GraphReviewControls) => void
  onRefresh: () => void
  onJumpToParent?: () => void
  onJumpToEdgeSource?: (edge: GraphEdge) => void
  canJumpToEdgeSource?: (edge: GraphEdge) => boolean
  onJumpToEvidenceSource?: (item: ChapterGraphContextData['lanceEvidence'][number]) => void
  canJumpToEvidenceSource?: (item: ChapterGraphContextData['lanceEvidence'][number]) => boolean
}) {
  const { t } = useI18n()
  const [evidenceOpen, setEvidenceOpen] = useState(true)
  const visibleGraph = props.data?.graphContext ?? null
  const nodeById = useMemo(() => new Map((visibleGraph?.nodes ?? []).map((node) => [node.id, node] as const)), [visibleGraph?.nodes])
  const selectedEdge = props.selection?.type === 'edge' ? props.selection.edge : null
  const chapterNo = props.chapter.order
  const chapterTitle = props.chapter.title
  const sourceMeta = props.data?.sourceMeta ?? props.sourceMeta
  const inheritedFromParent = sourceMeta?.mode === 'inherited-parent'
  const warningList = props.data?.warnings ?? visibleGraph?.warnings ?? []
  const lanceEvidence = props.data?.lanceEvidence ?? []

  const evidenceOpenResolved = selectedEdge?.evidenceQuote || selectedEdge?.evidenceLocation ? true : evidenceOpen

  return (
    <div className="space-y-4 px-4 py-4 sm:px-7 sm:py-6">
      <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_36%),#0b0d12] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <div className="flex flex-col gap-5 px-5 py-5 sm:px-6 sm:py-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">{t('graph.chapterBrowserEyebrow')}</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">{t('graph.chapterTitle', { chapterNo, title: chapterTitle })}</h3>
            <p className="mt-3 text-sm leading-7 text-zinc-400">
              {inheritedFromParent
                ? t('graph.chapterBrowserInheritedDescription', { chapterNo: sourceMeta.chapterNo })
                : t('graph.chapterBrowserDescription')}
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <div className="flex flex-wrap gap-2">
              <Pill label={t('graph.browseOnly')} tone="violet" />
              {inheritedFromParent ? <Pill label={t('graph.inheritParent', { chapterNo: sourceMeta.chapterNo })} tone="rose" /> : null}
              <Pill label={t('graph.seeds', { count: visibleGraph?.seedEntities.length ?? 0 })} tone="amber" />
              <Pill label={t('graph.nodes', { count: visibleGraph?.nodes.length ?? 0 })} tone="sky" />
              <Pill label={t('graph.edges', { count: visibleGraph?.edges.length ?? 0 })} />
              <Pill label={t('graph.evidenceCount', { count: lanceEvidence.length })} tone="rose" />
            </div>
            <button
              type="button"
              onClick={props.onRefresh}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-zinc-200 transition hover:bg-white/[0.08]"
            >
              <RefreshCcw className={cn('h-4 w-4', props.loading && 'animate-spin')} />
              {t('graph.refresh')}
            </button>
          </div>
        </div>
      </section>

      {inheritedFromParent ? (
        <section className="rounded-[24px] border border-fuchsia-400/20 bg-fuchsia-500/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-300/20 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-fuchsia-100">
                <GitBranch className="h-3.5 w-3.5" />
                {t('graph.branchInheritsParent')}
              </div>
              <p className="mt-3 text-sm leading-7 text-zinc-300">
                {t('graph.branchInheritsParentDescription', { chapterNo: sourceMeta.chapterNo, chapterTitle: sourceMeta.chapterTitle })}
              </p>
            </div>
            {props.parentChapter ? (
              <button
                type="button"
                onClick={props.onJumpToParent}
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm text-zinc-100 transition hover:bg-white/[0.08]"
              >
                 {t('graph.jumpToParent')}
               </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {warningList.length ? (
        <section className="space-y-2 rounded-[24px] border border-amber-400/20 bg-amber-500/10 p-4">
          <div className="flex items-center gap-2 text-amber-100">
            <AlertTriangle className="h-4 w-4" />
             <p className="text-[11px] uppercase tracking-[0.18em]">{t('graph.warnings')}</p>
          </div>
          <div className="space-y-2">
            {warningList.map((warning) => (
              <p key={warning} className="text-sm leading-6 text-amber-50/90">{warning}</p>
            ))}
          </div>
        </section>
      ) : null}

      {props.error && !props.loading ? (
        <section className="rounded-[24px] border border-rose-400/20 bg-rose-500/10 p-4 text-sm leading-6 text-rose-100">
          {props.error}
        </section>
      ) : null}

      {props.loading && !props.data ? (
        <section className="rounded-[28px] border border-white/8 bg-black/20 p-6 text-sm text-zinc-400">
          <div className="flex items-center gap-2 text-zinc-200">
            <Globe className="h-4 w-4 text-sky-300" />
            {t('graph.loading')}
          </div>
        </section>
      ) : null}

      {!props.loading && visibleGraph && !visibleGraph.nodes.length ? (
        <GraphEmptyState chapterLabel={t('graph.chapterOnly', { chapterNo })} warning={warningList[0]} />
      ) : null}

      {visibleGraph && visibleGraph.nodes.length ? (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.95fr)_minmax(340px,0.72fr)]">
          <GraphFlowCanvas
            nodes={visibleGraph.nodes}
            edges={visibleGraph.edges}
            seedNodeIds={visibleGraph.seedEntities.map((node) => node.id)}
            controls={props.controls}
            loading={props.loading}
            onSelectNode={props.onSelectNode}
            onSelectEdge={props.onSelectEdge}
            onClearSelection={props.onClearSelection}
            onChangeControls={props.onChangeControls}
            onRefresh={props.onRefresh}
          />

          <div className="space-y-4">
            <GraphInspector
              selection={props.selection}
              nodeById={nodeById}
              nodeCount={visibleGraph.nodes.length}
              edgeCount={visibleGraph.edges.length}
              warningCount={warningList.length}
               modeLabel={t('graph.browseOnly')}
               emptyStateCopy={{
                 eyebrow: t('graph.browserInspectorEyebrow'),
                 title: t('graph.browserInspectorTitle'),
                 description: t('graph.browserInspectorDescription'),
               }}
            />
            <GraphEvidenceDrawer
              open={evidenceOpenResolved}
              onToggle={() => setEvidenceOpen((current) => !current)}
              selectedEdge={selectedEdge}
              evidence={lanceEvidence}
              canJumpToEdgeSource={Boolean(selectedEdge && props.canJumpToEdgeSource?.(selectedEdge))}
              onJumpToEdgeSource={props.onJumpToEdgeSource}
              canJumpToEvidenceSource={props.canJumpToEvidenceSource}
              onJumpToEvidenceSource={props.onJumpToEvidenceSource}
               copy={{
                 eyebrow: t('graph.chapterEvidenceEyebrow'),
                 description: t('graph.chapterEvidenceDescription'),
                 empty: t('graph.chapterEvidenceEmpty'),
               }}
            />
            <EdgeEvidencePanel
              edge={selectedEdge}
              source={selectedEdge ? nodeById.get(selectedEdge.source) : undefined}
              target={selectedEdge ? nodeById.get(selectedEdge.target) : undefined}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
