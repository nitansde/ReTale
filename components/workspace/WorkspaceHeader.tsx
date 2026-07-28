"use client"

import Link from 'next/link'
import { useState } from 'react'
import { ArrowLeft, BookOpen, Brain, Ellipsis, Gauge, ScrollText, Settings2, Trash2, X } from 'lucide-react'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { IconButton } from '@/components/ui/IconButton'
import { useI18n } from '@/lib/i18n/provider'

type WorkspaceMetrics = {
  wordCount: string
  inputTokens: string
  outputTokens: string
}

export function WorkspaceHeader({
  title,
  metrics,
  providerLabel,
  deletionPending,
  onOpenChapters,
  onOpenContext,
  onOpenKnowledge,
  onOpenPresets,
  onOpenSettings,
  onDeleteNovel,
}: {
  title: string
  metrics: WorkspaceMetrics
  providerLabel: string
  deletionPending: boolean
  onOpenChapters: () => void
  onOpenContext: () => void
  onOpenKnowledge: () => void
  onOpenPresets: () => void
  onOpenSettings: () => void
  onDeleteNovel: () => void
}) {
  const { t } = useI18n()
  const [overflowOpen, setOverflowOpen] = useState(false)

  function runOverflowAction(action: () => void) {
    setOverflowOpen(false)
    action()
  }

  return (
    <header className="sticky top-0 z-30 mb-4 rounded-[24px] border border-white/10 bg-[#0d1017]/92 px-2 py-2 shadow-[0_20px_70px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:px-4 sm:py-3 lg:rounded-[28px]">
      <div className="grid grid-cols-[44px_44px_minmax(0,1fr)_44px_44px] items-center gap-1 lg:hidden" data-testid="workspace-mobile-header">
        <Link
          href="/library"
          aria-label={t('workspace.header.backToLibrary')}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
        <IconButton label={t('workspace.header.openChapters')} onClick={onOpenChapters}>
          <BookOpen className="h-4 w-4" aria-hidden="true" />
        </IconButton>
        <h1 className="min-w-0 truncate px-1 text-sm font-semibold tracking-tight text-zinc-100" title={title}>{title}</h1>
        <IconButton label={t('workspace.header.openContext')} onClick={onOpenContext}>
          <Brain className="h-4 w-4" aria-hidden="true" />
        </IconButton>
        <IconButton label={t('workspace.header.moreOptions')} onClick={() => setOverflowOpen(true)} aria-expanded={overflowOpen}>
          <Ellipsis className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      </div>

      <div className="hidden items-center justify-between gap-3 lg:flex">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/library"
            aria-label={t('workspace.header.backToLibrary')}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.08]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{t('workspace.headerEyebrow')}</p>
            <h1 className="mt-1 truncate text-xl font-semibold tracking-tight text-zinc-100">{title}</h1>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs text-zinc-400">
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5" data-testid="workspace-current-word-count">{metrics.wordCount}</span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5" data-testid="workspace-current-input-tokens">{metrics.inputTokens}</span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5" data-testid="workspace-current-output-tokens">{metrics.outputTokens}</span>
          <button type="button" data-testid="preset-compat-library-open" onClick={onOpenPresets} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 transition hover:bg-white/[0.08]">
            <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
            {t('workspace.preset')}
          </button>
          <button type="button" onClick={onOpenSettings} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 transition hover:bg-white/[0.08]">
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
            {providerLabel}
          </button>
          <button type="button" onClick={onDeleteNovel} disabled={deletionPending} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-rose-400/20 bg-rose-500/10 px-3 text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60">
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t('workspace.deleteNovel')}
          </button>
        </div>
      </div>

      <DialogSurface open={overflowOpen} onClose={() => setOverflowOpen(false)} title={t('workspace.header.overflowTitle')} description={t('workspace.header.overflowDescription')} placement="bottom">
        <div className="flex justify-end">
          <IconButton label={t('workspace.header.closeOverflow')} onClick={() => setOverflowOpen(false)}>
            <X className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>
        <section className="mt-4" aria-labelledby="workspace-mobile-metrics-title">
          <h3 id="workspace-mobile-metrics-title" className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
            <Gauge className="h-4 w-4" aria-hidden="true" />
            {t('workspace.header.metrics')}
          </h3>
          <div className="mt-3 grid gap-2 text-sm text-zinc-300">
            <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5">{metrics.wordCount}</div>
            <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5">{metrics.inputTokens}</div>
            <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5">{metrics.outputTokens}</div>
          </div>
        </section>
        <div className="mt-5 grid gap-2">
          <button type="button" onClick={() => runOverflowAction(onOpenKnowledge)} className="flex min-h-11 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-left text-sm text-zinc-200 transition hover:bg-white/[0.08]">
            <Brain className="h-4 w-4 text-violet-200" aria-hidden="true" />
            {t('workspace.header.openKnowledge')}
          </button>
          <button type="button" onClick={() => runOverflowAction(onOpenPresets)} className="flex min-h-11 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-left text-sm text-zinc-200 transition hover:bg-white/[0.08]">
            <ScrollText className="h-4 w-4 text-violet-200" aria-hidden="true" />
            {t('workspace.header.presets')}
          </button>
          <button type="button" onClick={() => runOverflowAction(onOpenSettings)} className="flex min-h-11 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-left text-sm text-zinc-200 transition hover:bg-white/[0.08]">
            <Settings2 className="h-4 w-4 text-violet-200" aria-hidden="true" />
            {t('workspace.header.modelSettings')}
          </button>
        </div>
        <section className="mt-6 border-t border-rose-400/15 pt-5" aria-labelledby="workspace-mobile-danger-title">
          <h3 id="workspace-mobile-danger-title" className="text-xs font-medium uppercase tracking-[0.16em] text-rose-200/70">{t('workspace.header.destructiveActions')}</h3>
          <button type="button" onClick={() => runOverflowAction(onDeleteNovel)} disabled={deletionPending} className="mt-3 flex min-h-11 w-full items-center gap-3 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 text-left text-sm text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t('workspace.deleteNovel')}
          </button>
        </section>
      </DialogSurface>
    </header>
  )
}
