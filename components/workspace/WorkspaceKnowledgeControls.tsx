"use client"

import {
  formatEmbeddingProviderLabel,
  formatKnowledgeCoverageBadge,
  formatKnowledgeCoverageDetail,
  formatKnowledgeRebuildChapterRangeLabel,
  formatRetrievalIndexBadge,
  HANLP_CACHE_STATUS_LABELS,
  KNOWLEDGE_STEP_STATUS_LABELS,
  resolveKnowledgeStepDisplayStatus,
  resolveRetrievalTaskControlsState,
  toProgressPercent,
  type KnowledgeActionLoading,
  type KnowledgeChapterCoverageOverview,
  type KnowledgeRebuildRangeMode,
  type KnowledgeRebuildStatus,
  type KnowledgeStatusOverview,
  type RetrievalIndexCoverageOverview,
} from '@/components/workspace/selection-novel-studio-helpers'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'

type DeleteState = {
  disabled: boolean
  helperText: string
}

type WorkspaceKnowledgeControlsProps = {
  knowledgeRebuilding: boolean
  knowledgeRebuildActive: boolean
  knowledgeActionLoading: KnowledgeActionLoading
  knowledgeRebuildPaused: boolean
  knowledgeRebuildFailed: boolean
  knowledgeRebuildRangeMode: KnowledgeRebuildRangeMode
  knowledgeRebuildFirstChapterCount: string
  knowledgeRebuildStartChapter: string
  knowledgeRebuildEndChapter: string
  selectedKnowledgeRebuildChapterRangeLabel: string
  knowledgeStatusOverview: KnowledgeStatusOverview | null
  currentKnowledgeJobBusy: boolean
  knowledgeGraphOverview: KnowledgeChapterCoverageOverview | null
  embeddingCacheOverview: (KnowledgeChapterCoverageOverview & { provider: string | null; model: string | null }) | null
  retrievalIndexOverview: RetrievalIndexCoverageOverview | null
  retrievalIndexStatusLine: string
  retrievalTaskStatus: KnowledgeRebuildStatus | null
  retrievalTaskStatusLabel: string
  retrievalTaskPercent: number
  retrievalTaskPhaseLabel: string | null
  retrievalControlsState: ReturnType<typeof resolveRetrievalTaskControlsState>
  mainKnowledgeRebuildStatus: KnowledgeRebuildStatus | null
  knowledgeRebuildOverallPercent: number
  knowledgeRebuildFailureMessage: string | null
  knowledgeRebuildEtaMinutes: number | null
  hanlpBootstrapStatusLine: string
  hanlpBootstrapCompletedChapterCount: number | null
  hanlpBootstrapTotalChapterCount: number | null
  hanlpCacheStatusLabel: string
  hanlpBootstrapPercent: number | null
  hanlpBootstrapCacheHitRatePercent: number | null
  hanlpBootstrapPhaseLabel: string
  hanlpBootstrapEtaLabel: string
  hanlpBootstrapTimingLabel: string | null
  hanlpSettingsLine: string | null
  rawTextEmbeddingStatusLine: string
  rawTextEmbeddingPhaseBadge: string
  rawTextEmbeddingPercent: number | null
  rawTextEmbeddingCacheHitRatePercent: number | null
  rawTextEmbeddingTimingLabel: string | null
  rawTextEmbeddingSettingsLine: string | null
  knowledgeRebuildSteps: KnowledgeRebuildStatus['steps']
  currentKnowledgeRunningStepKey: KnowledgeRebuildStatus['steps'][number]['key'] | null
  confirmDeleteHanlpCache: boolean
  confirmDeleteExtractionCache: boolean
  confirmDeleteEmbeddingCache: boolean
  confirmDeleteKnowledge: boolean
  hanlpCacheDeleteState: DeleteState
  extractionCacheDeleteState: DeleteState
  embeddingCacheDeleteState: DeleteState
  onRebuildKnowledge: () => void
  onPauseKnowledge: () => void
  onAbortKnowledge: () => void
  onRebuildRetrievalIndex: () => void
  onSetKnowledgeRebuildRangeMode: (mode: KnowledgeRebuildRangeMode) => void
  onSetKnowledgeRebuildFirstChapterCount: (value: string) => void
  onSetKnowledgeRebuildStartChapter: (value: string) => void
  onSetKnowledgeRebuildEndChapter: (value: string) => void
  onToggleConfirmDeleteHanlpCache: () => void
  onToggleConfirmDeleteExtractionCache: () => void
  onToggleConfirmDeleteEmbeddingCache: () => void
  onToggleConfirmDeleteKnowledge: () => void
  onCancelDeleteHanlpCache: () => void
  onCancelDeleteExtractionCache: () => void
  onCancelDeleteEmbeddingCache: () => void
  onCancelDeleteKnowledge: () => void
  onDeleteHanlpCache: () => void
  onDeleteExtractionCache: () => void
  onDeleteEmbeddingCache: () => void
  onDeleteKnowledgeGraph: () => void
}

export function WorkspaceKnowledgeControls(props: WorkspaceKnowledgeControlsProps) {
  const { t } = useI18n()

  return (
    <div className="mb-4 rounded-[24px] border border-violet-400/20 bg-violet-500/10 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-violet-200/70">{t('workspace.knowledge.controlsEyebrow')}</p>
        <button
          onClick={props.onRebuildKnowledge}
          disabled={props.knowledgeRebuilding || props.knowledgeRebuildActive || Boolean(props.knowledgeActionLoading)}
          className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] text-zinc-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {props.knowledgeRebuilding ? t('workspace.knowledge.processing') : props.knowledgeRebuildPaused ? t('workspace.knowledge.resumeRebuild') : props.knowledgeRebuildFailed ? t('workspace.knowledge.retryRebuild') : t('workspace.knowledge.startRebuild')}
        </button>
      </div>
      <div className="mt-3 rounded-2xl border border-violet-300/15 bg-black/20 p-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-300">
          <span className="text-zinc-500">{t('workspace.knowledge.chapterRange')}</span>
          <button
            type="button"
            onClick={() => props.onSetKnowledgeRebuildRangeMode('all')}
            disabled={props.knowledgeRebuildActive || props.knowledgeRebuilding || Boolean(props.knowledgeActionLoading)}
            className={cn('rounded-full border px-3 py-1 transition disabled:cursor-not-allowed disabled:opacity-50', props.knowledgeRebuildRangeMode === 'all' ? 'border-violet-300/40 bg-violet-400/15 text-violet-50' : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]')}
          >
            {t('workspace.knowledge.rangeAll')}
          </button>
          <button
            type="button"
            onClick={() => props.onSetKnowledgeRebuildRangeMode('first')}
            disabled={props.knowledgeRebuildActive || props.knowledgeRebuilding || Boolean(props.knowledgeActionLoading)}
            className={cn('rounded-full border px-3 py-1 transition disabled:cursor-not-allowed disabled:opacity-50', props.knowledgeRebuildRangeMode === 'first' ? 'border-violet-300/40 bg-violet-400/15 text-violet-50' : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]')}
          >
            {t('workspace.knowledge.rangeFirst')}
          </button>
          <button
            type="button"
            onClick={() => props.onSetKnowledgeRebuildRangeMode('custom')}
            disabled={props.knowledgeRebuildActive || props.knowledgeRebuilding || Boolean(props.knowledgeActionLoading)}
            className={cn('rounded-full border px-3 py-1 transition disabled:cursor-not-allowed disabled:opacity-50', props.knowledgeRebuildRangeMode === 'custom' ? 'border-violet-300/40 bg-violet-400/15 text-violet-50' : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]')}
          >
            {t('workspace.knowledge.rangeCustom')}
          </button>
        </div>
        {props.knowledgeRebuildRangeMode === 'first' ? (
          <label className="mt-3 flex items-center gap-2 text-[11px] text-zinc-400">
            {t('workspace.knowledge.processFirst')}
            <input
              value={props.knowledgeRebuildFirstChapterCount}
              onChange={(event) => props.onSetKnowledgeRebuildFirstChapterCount(event.target.value)}
              disabled={props.knowledgeRebuildActive || props.knowledgeRebuilding || Boolean(props.knowledgeActionLoading)}
              inputMode="numeric"
              className="w-20 rounded-xl border border-white/10 bg-black/25 px-2 py-1.5 text-zinc-100 outline-none transition focus:border-violet-300/50 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {t('workspace.knowledge.chapterUnit')}
          </label>
        ) : null}
        {props.knowledgeRebuildRangeMode === 'custom' ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
            <span>{t('workspace.knowledge.fromChapter')}</span>
            <input
              value={props.knowledgeRebuildStartChapter}
              onChange={(event) => props.onSetKnowledgeRebuildStartChapter(event.target.value)}
              disabled={props.knowledgeRebuildActive || props.knowledgeRebuilding || Boolean(props.knowledgeActionLoading)}
              inputMode="numeric"
              className="w-20 rounded-xl border border-white/10 bg-black/25 px-2 py-1.5 text-zinc-100 outline-none transition focus:border-violet-300/50 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span>{t('workspace.knowledge.toChapter')}</span>
            <input
              value={props.knowledgeRebuildEndChapter}
              onChange={(event) => props.onSetKnowledgeRebuildEndChapter(event.target.value)}
              disabled={props.knowledgeRebuildActive || props.knowledgeRebuilding || Boolean(props.knowledgeActionLoading)}
              inputMode="numeric"
              className="w-20 rounded-xl border border-white/10 bg-black/25 px-2 py-1.5 text-zinc-100 outline-none transition focus:border-violet-300/50 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span>{t('workspace.knowledge.chapterUnit')}</span>
          </div>
        ) : null}
        <p className="mt-2 text-[10px] leading-4 text-zinc-500">{t('workspace.knowledge.selectedRangeHint', { range: props.selectedKnowledgeRebuildChapterRangeLabel })}</p>
      </div>
      {props.knowledgeStatusOverview ? (
        <div className="mt-3 rounded-2xl border border-violet-300/15 bg-violet-500/[0.06] px-3 py-3 text-xs text-zinc-300" data-testid="workspace-knowledge-status-overview-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-violet-100/70">{t('workspace.knowledge.overviewEyebrow')}</p>
              <p className="mt-1 leading-5 text-zinc-300">{t('workspace.knowledge.overviewDescription')}</p>
            </div>
            <span className="rounded-full border border-violet-300/20 bg-black/20 px-3 py-1.5 text-[11px] text-violet-100/85">{props.currentKnowledgeJobBusy ? t('workspace.knowledge.jobRunning') : t('workspace.knowledge.latestStatus')}</span>
          </div>
          <div className="mt-3 space-y-2">
            <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium text-zinc-100">{t('workspace.knowledge.graphLabel')}</p>
                  <p className="mt-1 text-[10px] leading-4 text-zinc-400">{formatKnowledgeCoverageDetail(t('workspace.knowledge.graphLabel'), props.knowledgeGraphOverview)}</p>
                </div>
                <span className="rounded-full border border-violet-300/20 bg-black/20 px-2.5 py-1 text-[10px] text-violet-100/85">{formatKnowledgeCoverageBadge(props.knowledgeGraphOverview)}</span>
              </div>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium text-zinc-100">{t('workspace.knowledge.embeddingCacheLabel')}</p>
                  <p className="mt-1 text-[10px] leading-4 text-zinc-400">{formatKnowledgeCoverageDetail(t('workspace.knowledge.embeddingCacheLabel'), props.embeddingCacheOverview)}</p>
                </div>
                <span className="rounded-full border border-violet-300/20 bg-black/20 px-2.5 py-1 text-[10px] text-violet-100/85">{formatKnowledgeCoverageBadge(props.embeddingCacheOverview)}</span>
              </div>
              {props.embeddingCacheOverview?.provider && props.embeddingCacheOverview.model ? (
                <p className="mt-1 text-[10px] leading-4 text-zinc-500">{formatEmbeddingProviderLabel(props.embeddingCacheOverview.provider)} · {props.embeddingCacheOverview.model}</p>
              ) : null}
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-zinc-100">{t('workspace.knowledge.lancedbIndexLabel')}</p>
                  <p className="mt-1 text-[10px] leading-4 text-zinc-400">{props.retrievalIndexStatusLine}</p>
                  {props.retrievalTaskStatus ? (
                    <>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] leading-4 text-zinc-400">
                        <span>{t('workspace.knowledge.taskStatus', { status: props.retrievalTaskStatusLabel })}</span>
                        <span className="text-violet-100/85">{props.retrievalTaskPercent}%</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={cn('h-full rounded-full transition-all', props.retrievalTaskStatus.status === 'failed' ? 'bg-rose-300' : 'bg-violet-300')}
                          style={{ width: `${Math.max(props.retrievalTaskPercent > 0 ? 8 : 0, Math.min(100, props.retrievalTaskPercent))}%` }}
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-4 text-zinc-500">
                        {props.retrievalTaskPhaseLabel ? <span>{t('workspace.knowledge.phase', { phase: props.retrievalTaskPhaseLabel })}</span> : null}
                        {props.retrievalTaskStatus.chapterRange ? <span>{t('workspace.knowledge.range', { range: formatKnowledgeRebuildChapterRangeLabel(props.retrievalTaskStatus.chapterRange) })}</span> : null}
                      </div>
                    </>
                  ) : null}
                  {props.retrievalControlsState.helperText ? <p className="mt-2 text-[10px] leading-4 text-zinc-500">{props.retrievalControlsState.helperText}</p> : null}
                </div>
                <span className="rounded-full border border-violet-300/20 bg-black/20 px-2.5 py-1 text-[10px] text-violet-100/85">{formatRetrievalIndexBadge(props.retrievalIndexOverview)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {props.retrievalControlsState.actions.map((action) => {
                  const isPrimary = action === 'start' || action === 'refresh' || action === 'continue' || action === 'retry'
                  const isDanger = action === 'abort'
                  const isLoading = props.knowledgeActionLoading === 'rebuild-retrieval-index'
                    ? action === 'start' || action === 'refresh' || action === 'continue' || action === 'retry'
                    : props.knowledgeActionLoading === 'pause'
                      ? action === 'pause'
                      : props.knowledgeActionLoading === 'abort'
                        ? action === 'abort'
                        : false
                  const label = action === 'start'
                    ? t('workspace.knowledge.action.start')
                    : action === 'refresh'
                      ? t('workspace.knowledge.action.refresh')
                      : action === 'pause'
                        ? t('workspace.knowledge.action.pause')
                        : action === 'abort'
                          ? t('workspace.knowledge.action.abort')
                          : action === 'continue'
                            ? t('workspace.knowledge.action.continue')
                            : t('workspace.knowledge.action.retry')
                  const loadingLabel = action === 'pause' ? t('workspace.knowledge.action.pausing') : action === 'abort' ? t('workspace.knowledge.action.aborting') : t('workspace.knowledge.action.starting')
                  return (
                    <button
                      key={action}
                      type="button"
                      onClick={() => {
                        if (action === 'pause') {
                          props.onPauseKnowledge()
                          return
                        }
                        if (action === 'abort') {
                          props.onAbortKnowledge()
                          return
                        }
                        props.onRebuildRetrievalIndex()
                      }}
                      disabled={props.retrievalControlsState.disabled}
                      className={cn(
                        'rounded-xl px-3 py-2 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
                        isDanger
                          ? 'border border-amber-400/20 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20'
                          : isPrimary
                            ? 'border border-violet-400/30 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25'
                            : 'border border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]'
                      )}
                    >
                      {isLoading ? loadingLabel : label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {props.mainKnowledgeRebuildStatus ? (
        <div className={cn('mt-3 rounded-2xl px-3 py-3 text-xs', props.knowledgeRebuildFailed ? 'border border-rose-300/20 bg-rose-500/[0.08] text-rose-50' : 'border border-violet-300/15 bg-black/20 text-zinc-300')}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <span>{props.knowledgeRebuildFailed ? t('workspace.knowledge.main.failed') : props.knowledgeRebuildPaused ? t('workspace.knowledge.main.paused') : t('workspace.knowledge.main.running')}</span>
            <span>{props.knowledgeRebuildFailed ? t('workspace.knowledge.failed') : `${props.knowledgeRebuildOverallPercent}%`}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className={cn('h-full rounded-full transition-all', props.knowledgeRebuildFailed ? 'bg-rose-300' : 'bg-violet-400')} style={{ width: `${Math.max(6, Math.min(100, props.knowledgeRebuildOverallPercent))}%` }} />
          </div>
          <p className={cn('mt-2 text-[11px] leading-5', props.knowledgeRebuildFailed ? 'text-rose-100/90' : 'text-zinc-400')}>
            {props.knowledgeRebuildFailed ? props.knowledgeRebuildFailureMessage : props.mainKnowledgeRebuildStatus.currentStep || (props.knowledgeRebuildPaused ? t('workspace.knowledge.waitingContinue') : t('workspace.knowledge.preparing'))}
          </p>
          <p className={cn('mt-1 text-[11px] leading-5', props.knowledgeRebuildFailed ? 'text-rose-100/70' : 'text-zinc-500')}>
            {props.knowledgeRebuildFailed ? t('workspace.knowledge.rebuildIncomplete') : t('workspace.knowledge.eta', { value: props.knowledgeRebuildPaused ? t('workspace.knowledge.etaPaused') : props.knowledgeRebuildEtaMinutes ? t('workspace.knowledge.etaMinutes', { count: props.knowledgeRebuildEtaMinutes }) : t('workspace.knowledge.calculating') })}
          </p>
          {props.mainKnowledgeRebuildStatus.chapterRange ? <p className="mt-1 text-[11px] leading-5 text-violet-100/75">{t('workspace.knowledge.taskRange', { range: formatKnowledgeRebuildChapterRangeLabel(props.mainKnowledgeRebuildStatus.chapterRange) })}</p> : null}
          <div className="mt-3 rounded-xl border border-violet-300/15 bg-violet-500/[0.08] px-3 py-3" data-testid="workspace-hanlp-bootstrap-card">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-medium text-violet-100">{t('workspace.knowledge.hanlpBootstrap')}</p>
                <p className="mt-1 text-[10px] leading-4 text-violet-100/75">{props.hanlpBootstrapStatusLine}</p>
              </div>
              <span className="rounded-full border border-violet-300/20 bg-black/20 px-2.5 py-1 text-[10px] text-violet-100/85">{typeof props.hanlpBootstrapCompletedChapterCount === 'number' && typeof props.hanlpBootstrapTotalChapterCount === 'number' ? `${props.hanlpBootstrapCompletedChapterCount} / ${props.hanlpBootstrapTotalChapterCount} ${t('workspace.knowledge.chapterUnit')}` : props.hanlpCacheStatusLabel}</span>
            </div>
            {props.hanlpBootstrapPercent !== null ? (
              <>
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-zinc-300">
                  <span>{t('workspace.knowledge.chapterProgress')}</span>
                  <span className="text-violet-100">{props.hanlpBootstrapPercent}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-violet-300 transition-all" style={{ width: `${Math.max(props.hanlpBootstrapPercent > 0 ? 8 : 0, Math.min(100, props.hanlpBootstrapPercent))}%` }} />
                </div>
              </>
            ) : null}
            <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[10px] leading-4 text-zinc-400 sm:grid-cols-2">
              <span>{t('workspace.knowledge.completedChapters', { value: typeof props.hanlpBootstrapCompletedChapterCount === 'number' && typeof props.hanlpBootstrapTotalChapterCount === 'number' ? `${props.hanlpBootstrapCompletedChapterCount} / ${props.hanlpBootstrapTotalChapterCount}` : t('workspace.knowledge.waitingProgress') })}</span>
              <span>{t('workspace.knowledge.cacheHitRate', { value: props.hanlpBootstrapCacheHitRatePercent !== null ? `${props.hanlpBootstrapCacheHitRatePercent}%` : t('workspace.knowledge.waitingProgress') })}</span>
              <span>{t('workspace.knowledge.currentPhase', { value: props.hanlpBootstrapPhaseLabel })}</span>
              <span>{t('workspace.knowledge.remaining', { value: props.hanlpBootstrapEtaLabel })}</span>
              <span>{t('workspace.knowledge.stepDuration', { value: props.hanlpBootstrapTimingLabel ?? t('workspace.knowledge.waitingProgress') })}</span>
            </div>
            {props.hanlpSettingsLine ? <p className="mt-1 truncate text-[10px] leading-4 text-zinc-500">{props.hanlpSettingsLine}</p> : null}
          </div>
          <div className="mt-3 rounded-xl border border-violet-300/15 bg-violet-500/[0.08] px-3 py-3" data-testid="workspace-raw-embedding-card">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-medium text-violet-100">{t('workspace.knowledge.rawEmbeddingPrecompute')}</p>
                <p className="mt-1 text-[10px] leading-4 text-violet-100/75">{props.rawTextEmbeddingStatusLine}</p>
              </div>
              <span className="rounded-full border border-violet-300/20 bg-black/20 px-2.5 py-1 text-[10px] text-violet-100/85">{props.rawTextEmbeddingPhaseBadge}</span>
            </div>
            {props.rawTextEmbeddingPercent !== null ? (
              <>
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-zinc-300">
                  <span>{t('workspace.knowledge.warmupProgress')}</span>
                  <span className="text-violet-100">{props.rawTextEmbeddingPercent}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-violet-300 transition-all" style={{ width: `${Math.max(props.rawTextEmbeddingPercent > 0 ? 8 : 0, Math.min(100, props.rawTextEmbeddingPercent))}%` }} />
                </div>
              </>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] leading-4 text-zinc-400">
              <span>{t('workspace.knowledge.cacheHitRate', { value: props.rawTextEmbeddingCacheHitRatePercent !== null ? `${props.rawTextEmbeddingCacheHitRatePercent}%` : t('workspace.knowledge.notReturnedYet') })}</span>
              {props.rawTextEmbeddingTimingLabel ? <span>{t('workspace.knowledge.stepDuration', { value: props.rawTextEmbeddingTimingLabel })}</span> : null}
            </div>
            {props.rawTextEmbeddingSettingsLine ? <p className="mt-1 truncate text-[10px] leading-4 text-zinc-500">{props.rawTextEmbeddingSettingsLine}</p> : null}
          </div>
          {props.knowledgeRebuildSteps.length > 0 ? (
            <div className="mt-3 space-y-2">
              {props.knowledgeRebuildSteps.map((step) => {
                const stepProgress = toProgressPercent(step.progress)
                const displayStatus = resolveKnowledgeStepDisplayStatus({
                  step,
                  isCurrentRunningStep: props.currentKnowledgeRunningStepKey === step.key,
                })
                const isActive = displayStatus === 'running' || displayStatus === 'paused'

                return (
                  <div key={step.key} className="rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-zinc-200">{step.label}</span>
                      <span className="text-zinc-500">{KNOWLEDGE_STEP_STATUS_LABELS[displayStatus]}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className={cn('h-full rounded-full transition-all', displayStatus === 'completed' ? 'bg-emerald-400' : isActive ? 'bg-violet-400' : 'bg-white/20')} style={{ width: `${displayStatus === 'pending' ? 0 : Math.max(isActive ? 8 : 0, stepProgress)}%` }} />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] leading-4 text-zinc-500">
                      <span className="truncate">{step.detail ?? `${stepProgress}%`}</span>
                      <span>{displayStatus === 'running' && step.etaMinutes ? t('workspace.knowledge.etaMinutes', { count: step.etaMinutes }) : displayStatus === 'paused' ? t('workspace.knowledge.etaPaused') : `${stepProgress}%`}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : null}
          <div className={cn('mt-3 grid gap-2', props.knowledgeRebuildFailed ? 'grid-cols-1' : 'grid-cols-2')}>
            {props.knowledgeRebuildPaused || props.knowledgeRebuildFailed ? (
              <button onClick={props.onRebuildKnowledge} disabled={Boolean(props.knowledgeActionLoading) || props.knowledgeRebuilding} className={cn('rounded-xl px-3 py-2 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50', props.knowledgeRebuildFailed ? 'border border-rose-300/30 bg-rose-500/15 text-rose-50 hover:bg-rose-500/25' : 'border border-violet-400/30 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25')}>
                {props.knowledgeRebuilding ? (props.knowledgeRebuildFailed ? t('workspace.knowledge.retryStarting') : t('workspace.knowledge.continuing')) : props.knowledgeRebuildFailed ? t('workspace.knowledge.retryRebuild') : t('workspace.knowledge.resumeButton')}
              </button>
            ) : (
              <button onClick={props.onPauseKnowledge} disabled={!props.knowledgeRebuildActive || Boolean(props.knowledgeActionLoading)} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-zinc-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50">
                {props.knowledgeActionLoading === 'pause' ? t('workspace.knowledge.action.pausing') : t('workspace.knowledge.pauseButton')}
              </button>
            )}
            {props.knowledgeRebuildFailed ? null : (
              <button onClick={props.onAbortKnowledge} disabled={Boolean(props.knowledgeActionLoading)} className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50">
                {props.knowledgeActionLoading === 'abort' ? t('workspace.knowledge.action.aborting') : t('workspace.knowledge.abortCurrent')}
              </button>
            )}
          </div>
        </div>
      ) : null}
      <div className="mt-3 rounded-2xl border border-sky-400/15 bg-sky-500/[0.06] px-3 py-3 text-xs text-zinc-300" data-testid="workspace-hanlp-cache-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-sky-200/70">{t('workspace.knowledge.hanlpCacheEyebrow')}</p>
            <p className="mt-1 leading-5 text-zinc-300">{t('workspace.knowledge.currentStatus', { value: props.hanlpCacheStatusLabel })}</p>
            <p className="mt-1 leading-5 text-zinc-400">{props.hanlpCacheDeleteState.helperText}</p>
          </div>
          <button onClick={props.onToggleConfirmDeleteHanlpCache} disabled={props.hanlpCacheDeleteState.disabled} data-testid="workspace-delete-hanlp-cache" aria-label={t('workspace.knowledge.deleteHanlpCache')} className="rounded-full border border-sky-400/20 bg-black/20 px-3 py-1.5 text-[11px] text-sky-100 transition hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-60">{t('workspace.knowledge.deleteHanlpCache')}</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] leading-4 text-zinc-400">
          <span>{t('workspace.knowledge.hanlpCacheStatus', { value: props.hanlpCacheStatusLabel })}</span>
          <span>{t('workspace.knowledge.cacheHitRate', { value: props.hanlpBootstrapCacheHitRatePercent !== null ? `${props.hanlpBootstrapCacheHitRatePercent}%` : t('workspace.knowledge.waitingProgress') })}</span>
          <span>{t('workspace.knowledge.stepDuration', { value: props.hanlpBootstrapTimingLabel ?? t('workspace.knowledge.waitingProgress') })}</span>
        </div>
        {props.hanlpSettingsLine ? <p className="mt-1 truncate text-[10px] leading-4 text-zinc-500">{props.hanlpSettingsLine}</p> : null}
        {props.confirmDeleteHanlpCache ? (
          <div className="mt-3 rounded-xl border border-sky-400/15 bg-black/20 p-3">
            <p className="text-[11px] leading-5 text-sky-100">{t('workspace.knowledge.confirmDeleteHanlpCacheDescription')}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={props.onDeleteHanlpCache} disabled={props.hanlpCacheDeleteState.disabled} className="flex-1 rounded-xl border border-sky-400/20 bg-sky-500/15 px-3 py-2 text-[11px] text-sky-100 transition hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-50">{props.knowledgeActionLoading === 'delete-hanlp-cache' ? t('workspace.knowledge.processing') : t('workspace.knowledge.confirmDeleteHanlpCache')}</button>
              <button onClick={props.onCancelDeleteHanlpCache} disabled={props.knowledgeActionLoading === 'delete-hanlp-cache'} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-zinc-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50">{t('workspace.knowledge.cancel')}</button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="mt-3 rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.06] px-3 py-3 text-xs text-zinc-300">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">{t('workspace.knowledge.extractionCacheEyebrow')}</p>
            <p className="mt-1 leading-5 text-zinc-300">{t('workspace.knowledge.extractionCacheDescription')}</p>
            <p className="mt-1 leading-5 text-zinc-400">{props.extractionCacheDeleteState.helperText}</p>
          </div>
          <button onClick={props.onToggleConfirmDeleteExtractionCache} disabled={props.extractionCacheDeleteState.disabled} data-testid="workspace-delete-extraction-cache" aria-label={t('workspace.knowledge.deleteExtractionCache')} className="rounded-full border border-emerald-400/20 bg-black/20 px-3 py-1.5 text-[11px] text-emerald-100 transition hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60">{t('workspace.knowledge.deleteExtractionCache')}</button>
        </div>
        <div className="mt-2 text-[10px] leading-4 text-zinc-400">{t('workspace.knowledge.extractionCacheAfterDeleteHint')}</div>
        {props.confirmDeleteExtractionCache ? (
          <div className="mt-3 rounded-xl border border-emerald-400/15 bg-black/20 p-3">
            <p className="text-[11px] leading-5 text-emerald-100">{t('workspace.knowledge.confirmDeleteExtractionCacheDescription')}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={props.onDeleteExtractionCache} disabled={props.extractionCacheDeleteState.disabled} className="flex-1 rounded-xl border border-emerald-400/20 bg-emerald-500/15 px-3 py-2 text-[11px] text-emerald-100 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50">{props.knowledgeActionLoading === 'delete-extraction-cache' ? t('workspace.knowledge.processing') : t('workspace.knowledge.confirmDeleteExtractionCache')}</button>
              <button onClick={props.onCancelDeleteExtractionCache} disabled={props.knowledgeActionLoading === 'delete-extraction-cache'} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-zinc-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50">{t('workspace.knowledge.cancel')}</button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="mt-3 rounded-2xl border border-amber-400/15 bg-amber-500/[0.06] px-3 py-3 text-xs text-zinc-300">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-amber-200/70">{t('workspace.knowledge.rawEmbeddingCacheEyebrow')}</p>
            <p className="mt-1 leading-5 text-zinc-300">{t('workspace.knowledge.currentStatus', { value: props.rawTextEmbeddingPercent !== null ? `${props.rawTextEmbeddingPercent}%` : t('workspace.knowledge.waitingProgress') })}</p>
            <p className="mt-1 leading-5 text-zinc-400">{props.embeddingCacheDeleteState.helperText}</p>
          </div>
          <button onClick={props.onToggleConfirmDeleteEmbeddingCache} disabled={props.embeddingCacheDeleteState.disabled} data-testid="workspace-delete-embedding-cache" aria-label={t('workspace.knowledge.deleteEmbeddingCache')} className="rounded-full border border-amber-400/20 bg-black/20 px-3 py-1.5 text-[11px] text-amber-100 transition hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-60">{t('workspace.knowledge.deleteEmbeddingCache')}</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] leading-4 text-zinc-400">
          <span>{t('workspace.knowledge.warmupStatus', { value: props.rawTextEmbeddingPercent !== null ? `${props.rawTextEmbeddingPercent}%` : t('workspace.knowledge.waitingProgress') })}</span>
          <span>{t('workspace.knowledge.cacheHitRate', { value: props.rawTextEmbeddingCacheHitRatePercent !== null ? `${props.rawTextEmbeddingCacheHitRatePercent}%` : t('workspace.knowledge.notReturnedYet') })}</span>
          <span>{t('workspace.knowledge.stepDuration', { value: props.rawTextEmbeddingTimingLabel ?? t('workspace.knowledge.waitingProgress') })}</span>
        </div>
        {props.rawTextEmbeddingSettingsLine ? <p className="mt-1 truncate text-[10px] leading-4 text-zinc-500">{props.rawTextEmbeddingSettingsLine}</p> : null}
        {props.confirmDeleteEmbeddingCache ? (
          <div className="mt-3 rounded-xl border border-amber-400/15 bg-black/20 p-3">
            <p className="text-[11px] leading-5 text-amber-100">{t('workspace.knowledge.confirmDeleteEmbeddingCacheDescription')}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={props.onDeleteEmbeddingCache} disabled={props.embeddingCacheDeleteState.disabled} className="flex-1 rounded-xl border border-amber-400/20 bg-amber-500/15 px-3 py-2 text-[11px] text-amber-100 transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50">{props.knowledgeActionLoading === 'delete-embedding-cache' ? t('workspace.knowledge.processing') : t('workspace.knowledge.confirmDeleteEmbeddingCache')}</button>
              <button onClick={props.onCancelDeleteEmbeddingCache} disabled={props.knowledgeActionLoading === 'delete-embedding-cache'} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-zinc-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50">{t('workspace.knowledge.cancel')}</button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="mt-3 rounded-2xl border border-rose-400/15 bg-rose-500/[0.06] px-3 py-3 text-xs text-zinc-300">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-rose-200/70">{t('workspace.knowledge.dangerZone')}</p>
            <p className="mt-1 leading-5 text-zinc-400">{t('workspace.knowledge.dangerZoneDescription')}</p>
          </div>
          <button onClick={props.onToggleConfirmDeleteKnowledge} disabled={props.knowledgeActionLoading === 'delete'} className="rounded-full border border-rose-400/20 bg-black/20 px-3 py-1.5 text-[11px] text-rose-100 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-60">{t('workspace.knowledge.deleteKnowledgeGraph')}</button>
        </div>
        {props.confirmDeleteKnowledge ? (
          <div className="mt-3 rounded-xl border border-rose-400/15 bg-black/20 p-3">
            <p className="text-[11px] leading-5 text-rose-100">{t('workspace.knowledge.confirmDeleteKnowledgeDescription')}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={props.onDeleteKnowledgeGraph} disabled={Boolean(props.knowledgeActionLoading)} className="flex-1 rounded-xl border border-rose-400/20 bg-rose-500/15 px-3 py-2 text-[11px] text-rose-100 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50">{props.knowledgeActionLoading === 'delete' ? t('workspace.knowledge.processing') : t('workspace.knowledge.confirmDeleteKnowledgeGraph')}</button>
              <button onClick={props.onCancelDeleteKnowledge} disabled={props.knowledgeActionLoading === 'delete'} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-zinc-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50">{t('workspace.knowledge.cancel')}</button>
            </div>
          </div>
        ) : null}
      </div>
      <p className="mt-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-xs leading-5 text-zinc-400">{t('workspace.knowledge.readonlyNotice')}</p>
    </div>
  )
}
