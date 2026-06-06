import { ArrowUpRight, Ban, ChevronDown, Quote } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'
import type { GraphEdge } from '@/lib/server/graph-types'
import type { GenerationContextEvidence } from '@/components/graph/types'

function formatEdgeLocation(edge: GraphEdge, t: ReturnType<typeof useI18n>['t']) {
  const location = edge.evidenceLocation
  if (!location) return null
  if (location.lineStart && location.lineEnd) return t('graph.chapterLineRange', { chapterNo: location.chapterNo, start: location.lineStart, end: location.lineEnd })
  if (location.lineStart) return t('graph.chapterLineSingle', { chapterNo: location.chapterNo, line: location.lineStart })
  return t('graph.chapterOnly', { chapterNo: location.chapterNo })
}

function formatEvidenceLocation(item: GenerationContextEvidence, t: ReturnType<typeof useI18n>['t']) {
  if (item.lineStart !== null && item.lineEnd !== null) return t('graph.chapterLineRange', { chapterNo: item.chapterNo, start: item.lineStart, end: item.lineEnd })
  if (item.lineStart !== null) return t('graph.chapterLineSingle', { chapterNo: item.chapterNo, line: item.lineStart })
  return t('graph.chapterOnly', { chapterNo: item.chapterNo })
}

export function GraphEvidenceDrawer(props: {
  open: boolean
  onToggle: () => void
  selectedEdge: GraphEdge | null
  evidence: GenerationContextEvidence[]
  interactive?: boolean
  excludedEvidenceIds?: string[]
  onToggleEvidenceExcluded?: (item: GenerationContextEvidence, excluded: boolean) => void
  canJumpToEdgeSource?: boolean
  onJumpToEdgeSource?: (edge: GraphEdge) => void
  canJumpToEvidenceSource?: (item: GenerationContextEvidence) => boolean
  onJumpToEvidenceSource?: (item: GenerationContextEvidence) => void
  copy?: {
    eyebrow: string
    description: string
    empty: string
  }
}) {
  const { t } = useI18n()
  const copy = props.copy ?? {
    eyebrow: t('graph.evidenceDrawerEyebrow'),
    description: t('graph.evidenceDrawerDescription'),
    empty: t('graph.evidenceDrawerEmpty'),
  }

  return (
    <section className="rounded-[24px] border border-white/8 bg-black/20 p-4">
      <button
        type="button"
        onClick={props.onToggle}
        className="flex w-full items-center justify-between gap-3 text-left"
        >
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{copy.eyebrow}</p>
          <p className="mt-1 text-sm text-zinc-300">{copy.description}</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-zinc-400">
          {props.evidence.length}
          <ChevronDown className={cn('h-4 w-4 transition', props.open && 'rotate-180')} />
        </span>
      </button>

      {props.open ? (
        <div className="mt-4 space-y-3">
          {props.selectedEdge?.evidenceQuote ? (
            <div className="rounded-[22px] border border-sky-400/20 bg-sky-500/10 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sky-100">
                  <Quote className="h-4 w-4" />
                  <p className="text-sm font-medium">{t('graph.selectedEdgeEvidence')}</p>
                </div>
                {props.canJumpToEdgeSource && props.selectedEdge ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (props.selectedEdge) props.onJumpToEdgeSource?.(props.selectedEdge)
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-sky-300/20 bg-black/20 px-3 py-1 text-[11px] text-sky-50 transition hover:bg-white/[0.06]"
                  >
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    {t('graph.jumpToSource')}
                  </button>
                ) : null}
              </div>
              <p className="text-xs uppercase tracking-[0.14em] text-sky-200/70">{formatEdgeLocation(props.selectedEdge, t) ?? t('graph.edgeNoLocation')}</p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-sky-50">{props.selectedEdge.evidenceQuote}</p>
            </div>
          ) : null}

          {props.evidence.length ? (
            props.evidence.map((item) => {
              const excluded = Boolean(props.excludedEvidenceIds?.includes(item.id))
              const canJumpToSource = props.canJumpToEvidenceSource?.(item) ?? false
              return (
                <article key={item.id} className={cn('rounded-[20px] border p-4', excluded ? 'border-amber-300/20 bg-amber-500/10' : 'border-white/8 bg-white/[0.03]')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">{item.sourceLabel}{item.title ? ` · ${item.title}` : ''}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-zinc-500/80">{formatEvidenceLocation(item, t)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canJumpToSource ? (
                        <button
                          type="button"
                          onClick={() => props.onJumpToEvidenceSource?.(item)}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-300 transition hover:bg-white/[0.06]"
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" />
                          {t('graph.jumpToSource')}
                        </button>
                      ) : null}
                      {props.interactive ? (
                        <button
                          type="button"
                          onClick={() => props.onToggleEvidenceExcluded?.(item, !excluded)}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-300 transition hover:bg-white/[0.06]"
                        >
                          <Ban className="h-3.5 w-3.5" />
                          {excluded ? t('graph.includeThisRun') : t('graph.excludeThisRun')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <p className={cn('mt-2 whitespace-pre-wrap text-sm leading-6', excluded ? 'text-amber-50/85' : 'text-zinc-300')}>{item.text}</p>
                </article>
              )
            })
          ) : (
            <div className="rounded-[20px] border border-white/8 bg-black/30 p-4 text-sm text-zinc-400">
              {copy.empty}
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
