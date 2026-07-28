"use client"

import { ChevronDown, Circle, CircleCheck, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { TranslationKey } from '@/lib/i18n/messages'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'
import type { WorkspaceKnowledgeStatus as WorkspaceKnowledgeStatusModel } from '@/components/workspace/workspace-knowledge-status'

type PrimaryAction = {
  label: TranslationKey
  onClick: () => void
} | null

function statusIcon(status: 'not_ready' | 'pending' | 'partial' | 'ready') {
  if (status === 'ready') return CircleCheck
  if (status === 'pending') return LoaderCircle
  if (status === 'partial') return TriangleAlert
  return Circle
}

function getPrimaryAction(
  status: WorkspaceKnowledgeStatusModel,
  onPrepareAnalysis: () => void,
  onPrepareSearch: () => void
): PrimaryAction {
  if (status.overall === 'loading' || status.overall === 'working_analysis' || status.overall === 'working_search' || status.overall === 'ready') return null

  if (status.overall === 'paused' || status.overall === 'failed') {
    const isSearch = status.stage === 'search'
    return {
      label: status.overall === 'paused'
        ? isSearch ? 'workspace.knowledge.status.action.resumeSearch' : 'workspace.knowledge.status.action.resumeAnalysis'
        : isSearch ? 'workspace.knowledge.status.action.retrySearch' : 'workspace.knowledge.status.action.retryAnalysis',
      onClick: isSearch ? onPrepareSearch : onPrepareAnalysis,
    }
  }

  if (status.analysis === 'ready') {
    return { label: 'workspace.knowledge.status.action.prepareSearch', onClick: onPrepareSearch }
  }

  return { label: 'workspace.knowledge.status.action.startAnalysis', onClick: onPrepareAnalysis }
}

export function WorkspaceKnowledgeStatus({
  status,
  advancedDetailsOpen,
  onAdvancedDetailsChange,
  onPrepareAnalysis,
  onPrepareSearch,
  actionDisabled = false,
}: {
  status: WorkspaceKnowledgeStatusModel
  advancedDetailsOpen: boolean
  onAdvancedDetailsChange: (open: boolean) => void
  onPrepareAnalysis: () => void
  onPrepareSearch: () => void
  actionDisabled?: boolean
}) {
  const { t } = useI18n()
  const primaryAction = getPrimaryAction(status, onPrepareAnalysis, onPrepareSearch)
  const AnalysisIcon = statusIcon(status.analysis)
  const SearchIcon = statusIcon(status.search)

  return (
    <section className="rounded-[24px] border border-violet-400/20 bg-violet-500/10 p-4" data-testid="workspace-knowledge-status">
      <p className="text-[11px] uppercase tracking-[0.22em] text-violet-200/70">{t('workspace.knowledge.status.eyebrow')}</p>
      <h3 className="mt-1 text-sm font-medium leading-6 text-zinc-100">
        {t(`workspace.knowledge.status.overall.${status.overall}`)}
      </h3>

      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <AnalysisIcon className={cn('h-4 w-4 shrink-0', status.analysis === 'ready' ? 'text-emerald-300' : status.analysis === 'partial' ? 'text-amber-300' : 'text-zinc-500')} aria-hidden="true" />
            <span className="text-xs text-zinc-200">{t('workspace.knowledge.status.storyAnalysis')}</span>
          </div>
          <span className="text-right text-[11px] text-zinc-400">{t(`workspace.knowledge.status.analysis.${status.analysis}`)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <SearchIcon className={cn('h-4 w-4 shrink-0', status.search === 'ready' ? 'text-emerald-300' : status.search === 'partial' ? 'text-amber-300' : status.search === 'pending' ? 'animate-spin text-violet-300' : 'text-zinc-500')} aria-hidden="true" />
            <span className="text-xs text-zinc-200">{t('workspace.knowledge.status.contentSearch')}</span>
          </div>
          <span className="text-right text-[11px] text-zinc-400">{t(`workspace.knowledge.status.search.${status.search}`)}</span>
        </div>
      </div>

      {status.validThroughChapterNo !== null ? (
        <p className="mt-3 text-xs leading-5 text-zinc-400">{t('workspace.knowledge.status.readyThrough', { chapter: status.validThroughChapterNo })}</p>
      ) : null}
      {(status.overall === 'failed' || status.overall === 'paused') && status.previousResultsAvailable ? (
        <p className="mt-2 text-xs leading-5 text-zinc-400">{t('workspace.knowledge.status.previousResultsAvailable')}</p>
      ) : status.searchMayBeStale ? (
        <p className="mt-2 text-xs leading-5 text-amber-100/80">{t('workspace.knowledge.status.searchMayBeStale')}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {primaryAction ? (
          <button
            type="button"
            onClick={primaryAction.onClick}
            disabled={actionDisabled}
            className="min-h-11 rounded-xl border border-violet-300/30 bg-violet-500/20 px-4 text-xs font-medium text-violet-50 transition hover:bg-violet-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t(primaryAction.label)}
          </button>
        ) : null}
        <button
          type="button"
          aria-expanded={advancedDetailsOpen}
          onClick={() => onAdvancedDetailsChange(!advancedDetailsOpen)}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 text-xs text-zinc-300 transition hover:bg-white/[0.08]"
        >
          {t(advancedDetailsOpen ? 'workspace.knowledge.status.hideAdvancedDetails' : 'workspace.knowledge.status.advancedDetails')}
          <ChevronDown className={cn('h-4 w-4 transition-transform', advancedDetailsOpen && 'rotate-180')} aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}
