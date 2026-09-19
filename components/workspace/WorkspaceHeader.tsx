"use client"

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { BookMarked, BookOpen, Ellipsis, Globe, House, ScrollText, Search, Settings2, Trash2 } from 'lucide-react'
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
  onSearch,
  onOpenChapters,
  onOpenContext,
  onOpenKnowledge,
  onOpenPresets,
  onOpenSettings,
  onDeleteNovel,
  onBackToLibrary,
  mobileReaderAction,
  mobileSelectionActions,
  hideMobileToolbar = false,
  onOpenGraph,
}: {
  title: string
  metrics: WorkspaceMetrics
  providerLabel: string
  deletionPending: boolean
  onSearch: () => void
  onOpenChapters: () => void
  onOpenContext: () => void
  onOpenKnowledge: () => void
  onOpenPresets: () => void
  onOpenSettings: () => void
  onDeleteNovel: () => void
  onBackToLibrary: () => Promise<void>
  mobileReaderAction?: ReactNode
  mobileSelectionActions?: ReactNode
  hideMobileToolbar?: boolean
  onOpenGraph?: () => void
}) {
  const { t } = useI18n()
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [backPending, setBackPending] = useState(false)

  function handleBackNavigation(event: { preventDefault: () => void }) {
    event.preventDefault()
    if (backPending) return
    setBackPending(true)
    void onBackToLibrary().finally(() => setBackPending(false))
  }

  function runOverflowAction(action: () => void) {
    setOverflowOpen(false)
    action()
  }

  return (
    <>
    <header className="sticky top-0 z-30 mb-2 border-b border-white/10 bg-[#0d1017]/92 px-4 py-2 shadow-[0_14px_40px_rgba(0,0,0,0.3)] backdrop-blur-2xl sm:mb-4 sm:rounded-[24px] sm:border sm:py-3 sm:shadow-[0_20px_70px_rgba(0,0,0,0.35)] lg:rounded-[28px]">
      <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-1 lg:hidden" data-testid="workspace-mobile-header">
        <button
          type="button"
          onClick={onOpenChapters}
          aria-label={t('workspace.header.openChapters')}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-zinc-300 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70"
        >
          <BookOpen className="h-4 w-4" aria-hidden="true" />
        </button>
        <h1 className="min-w-0 truncate px-2 text-base font-medium tracking-tight text-zinc-100" title={title}>
          {title}
        </h1>
        <IconButton label={t('workspace.header.moreOptions')} onClick={() => setOverflowOpen(true)} aria-expanded={overflowOpen} className="border-transparent bg-transparent">
          <Ellipsis className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      </div>

      <div className="hidden items-center justify-between gap-3 lg:flex">
        <div className="flex min-w-0 items-center gap-3">
          <IconButton label={t('workspace.header.openChapters')} onClick={onOpenChapters} className="shrink-0">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <IconButton label={t('bookSearch.open')} title={t('bookSearch.title')} onClick={onSearch} disabled={deletionPending} data-testid="workspace-book-search-open-desktop" className="shrink-0">
            <Search className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <Link
            href="/library"
            onNavigate={handleBackNavigation}
            aria-busy={backPending}
            aria-label={t('workspace.header.backToLibrary')}
            title={t('workspace.header.home')}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70"
          >
            <House className="h-4 w-4" aria-hidden="true" />
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
          <button type="button" onClick={onOpenSettings} title={providerLabel} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 transition hover:bg-white/[0.08]">
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t('settings.title')}
          </button>
          <button type="button" onClick={onDeleteNovel} disabled={deletionPending} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-rose-400/20 bg-rose-500/10 px-3 text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60">
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t('workspace.deleteNovel')}
          </button>
        </div>
      </div>

      <DialogSurface
        open={overflowOpen}
        onClose={() => setOverflowOpen(false)}
        closeLabel={t('workspace.header.closeOverflow')}
        title={t('workspace.header.overflowTitle')}
        description={t('workspace.header.overflowDescription')}
        placement="bottom"
      >
        <div className="grid divide-y divide-white/8">
          {hideMobileToolbar ? <>
            <Link href="/library" onNavigate={handleBackNavigation} aria-busy={backPending} aria-label={t('workspace.header.backToLibrary')} className="flex min-h-12 items-center gap-3 px-2 text-left text-sm text-zinc-200"><House className="h-4 w-4" aria-hidden="true" />{t('workspace.header.home')}</Link>
            <button type="button" onClick={() => runOverflowAction(onOpenContext)} className="flex min-h-12 items-center gap-3 px-2 text-left text-sm text-zinc-200"><BookMarked className="h-4 w-4" aria-hidden="true" />{t('workspace.header.openContext')}</button>
            <button type="button" onClick={() => runOverflowAction(onSearch)} disabled={deletionPending} className="flex min-h-12 items-center gap-3 px-2 text-left text-sm text-zinc-200 disabled:opacity-50"><Search className="h-4 w-4" aria-hidden="true" />{t('bookSearch.open')}</button>
          </> : null}
          {onOpenGraph ? <button type="button" onClick={() => runOverflowAction(onOpenGraph)} className="flex min-h-12 items-center gap-3 px-2 text-left text-sm text-zinc-200 hover:bg-white/[0.04]">
            <Globe className="h-4 w-4" aria-hidden="true" />{t('workspace.centerPane.graphTab')}
          </button> : null}
          <button type="button" onClick={() => runOverflowAction(onOpenKnowledge)} className="flex min-h-12 items-center gap-3 px-2 text-left text-sm text-zinc-200 transition hover:bg-white/[0.04]">
            <BookMarked className="h-4 w-4 text-violet-200" aria-hidden="true" />
            {t('workspace.header.openKnowledge')}
          </button>
          <button type="button" onClick={() => runOverflowAction(onOpenPresets)} className="flex min-h-12 items-center gap-3 px-2 text-left text-sm text-zinc-200 transition hover:bg-white/[0.04]">
            <ScrollText className="h-4 w-4 text-violet-200" aria-hidden="true" />
            {t('workspace.header.presets')}
          </button>
          <button type="button" onClick={() => runOverflowAction(onOpenSettings)} className="flex min-h-12 items-center gap-3 px-2 text-left text-sm text-zinc-200 transition hover:bg-white/[0.04]">
            <Settings2 className="h-4 w-4 text-violet-200" aria-hidden="true" />
            {t('settings.title')}
          </button>
        </div>
      </DialogSurface>
    </header>
    {!hideMobileToolbar ? (
      <nav aria-label={t('workspace.mobile.navigation')} data-testid="workspace-mobile-toolbar" className="fixed inset-x-0 bottom-0 z-30 border-t border-white/8 bg-[#0d1017] px-3 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden">
        {mobileSelectionActions || <div className="flex items-center justify-around gap-1">
          <Link href="/library" onNavigate={handleBackNavigation} aria-busy={backPending} aria-label={t('workspace.header.backToLibrary')} className="flex min-h-12 min-w-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-xs text-zinc-300 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70">
            <House className="h-4 w-4" aria-hidden="true" />{t('workspace.header.home')}
          </Link>
          <button type="button" aria-label={t('workspace.header.openContext')} onClick={onOpenContext} className="flex min-h-12 min-w-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-xs text-zinc-300 hover:bg-white/[0.05]">
            <BookMarked className="h-4 w-4" aria-hidden="true" />{t('workspace.mobile.story')}
          </button>
          <button type="button" aria-label={t('bookSearch.open')} onClick={onSearch} disabled={deletionPending} data-testid="workspace-book-search-open" className="flex min-h-12 min-w-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-xs text-zinc-300 hover:bg-white/[0.05] disabled:opacity-50">
            <Search className="h-4 w-4" aria-hidden="true" />{t('bookSearch.open')}
          </button>
          {mobileReaderAction}
        </div>}
      </nav>
    ) : null}
    </>
  )
}
