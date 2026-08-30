"use client"

import { ACTION_META, CHAPTER_ACTION_ENTRY_TEST_IDS, CONTINUE_BLOCK_ACTION_TEST_IDS } from '@/components/workspace/selection-novel-studio-helpers'
import { useI18n } from '@/lib/i18n/provider'
import { WORKSPACE_CHAPTER_ACTION_ENTRY_MODES, type WorkspaceActionMode } from '@/components/workspace/use-workspace-chapter-selection'
import { cn } from '@/lib/utils'
import type { TimelineSelection } from '@/lib/story-branch-types'

type WorkspaceSelectionActionsProps = {
  selection: TimelineSelection
  selectedTimelineDisplayLabel: string
  selectedTimelineNodeTitle: string | null
  selectedTimelineInstructionText: string
  selectionText: string
  activeMode: WorkspaceActionMode | null
  roleplaySessionStarting: boolean
  hasFutureMapLaunch: boolean
  onOpenActionMode: (mode: WorkspaceActionMode) => void
  onReopenContinueBlockRewriteFlow: (variant: 'continue' | 'regenerate') => void
  onOpenContinueBlockFutureJump: () => void
  onOpenAnchorChapter: () => void
  onOpenFutureJumpSourceChapter: () => void
  onOpenFutureJumpTargetChapter: () => void
}

export function WorkspaceSelectionActions(props: WorkspaceSelectionActionsProps) {
  const { t } = useI18n()

  if (props.selection.kind === 'chapter') {
    const hasSelection = Boolean(props.selectionText.trim())

    return (
      <div
        className="mb-3 flex items-center gap-2 rounded-2xl border border-violet-400/20 bg-violet-500/[0.08] px-2.5 py-2 sm:px-3"
        data-testid="workspace-chapter-actions"
      >
        <div className="mr-auto flex min-w-0 items-center gap-2 px-1">
          <span className="hidden shrink-0 text-[10px] font-medium uppercase tracking-[0.18em] text-violet-200/70 sm:inline">
            {t('workspace.chapterActionsEyebrow')}
          </span>
          <span className={cn('truncate text-[11px]', hasSelection ? 'text-zinc-300' : 'text-zinc-500')}>
            {hasSelection ? t('workspace.chapterActionsReady') : t('workspace.chapterActionsIdle')}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {WORKSPACE_CHAPTER_ACTION_ENTRY_MODES.map((mode) => {
            const meta = ACTION_META[mode]
            const Icon = meta.icon
            return (
              <button
                key={mode}
                type="button"
                data-testid={CHAPTER_ACTION_ENTRY_TEST_IDS[mode]}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (!hasSelection) return
                  props.onOpenActionMode(mode)
                }}
                className={cn(
                  'inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition sm:px-3',
                  props.activeMode === mode
                    ? 'border-violet-300/30 bg-violet-500/20 text-white'
                    : 'border-white/10 bg-black/20 text-zinc-200 hover:bg-white/[0.08]',
                  (!hasSelection || (mode === 'roleplay' && props.roleplaySessionStarting)) && 'cursor-not-allowed opacity-45'
                )}
                disabled={!hasSelection || (mode === 'roleplay' && props.roleplaySessionStarting)}
              >
                <Icon className="h-3.5 w-3.5 text-violet-200" aria-hidden="true" />
                <span>{meta.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  if (props.selection.kind === 'rewrite' || props.selection.kind === 'continue_block') {
    return (
      <div className="mb-0" data-testid="workspace-continue-block-actions">
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap">
          <button type="button" onClick={() => props.onReopenContinueBlockRewriteFlow('continue')} data-testid={CONTINUE_BLOCK_ACTION_TEST_IDS.continue} className="min-h-11 shrink-0 rounded-2xl bg-fuchsia-500 px-4 text-sm font-medium text-white transition hover:bg-fuchsia-400">{t('workspace.continueWriting')}</button>
          <button type="button" onClick={() => props.onReopenContinueBlockRewriteFlow('regenerate')} data-testid={CONTINUE_BLOCK_ACTION_TEST_IDS.regenerate} className="min-h-11 shrink-0 rounded-2xl border border-fuchsia-300/25 bg-fuchsia-500/10 px-4 text-sm text-fuchsia-50 transition hover:bg-fuchsia-500/20">{t('workspace.regenerateCurrentNode')}</button>
          <button type="button" disabled={!props.hasFutureMapLaunch} onClick={props.onOpenContinueBlockFutureJump} data-testid={CONTINUE_BLOCK_ACTION_TEST_IDS.futureJump} className="min-h-11 shrink-0 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-zinc-200 transition hover:bg-white/[0.08] disabled:opacity-50">{t('workspace.futureJumpRun')}</button>
          <button type="button" onClick={props.onOpenAnchorChapter} className="min-h-11 shrink-0 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-zinc-200 transition hover:bg-white/[0.08]">{t('workspace.backToAnchorChapter')}</button>
        </div>
      </div>
    )
  }

  if (props.selection.kind === 'what_if') {
    return (
      <div data-testid="workspace-what-if-actions">
        <button type="button" onClick={props.onOpenAnchorChapter} className="min-h-11 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-zinc-200 transition hover:bg-white/[0.08]">{t('workspace.backToAnchorChapter')}</button>
      </div>
    )
  }

  if (props.selection.kind === 'future_jump') {
    return (
      <div className="flex flex-wrap gap-2" data-testid="workspace-future-jump-actions">
        <button type="button" onClick={props.onOpenFutureJumpSourceChapter} className="min-h-11 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-zinc-200 transition hover:bg-white/[0.08]">{t('workspace.openSourceChapter')}</button>
        <button type="button" onClick={props.onOpenFutureJumpTargetChapter} className="min-h-11 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-zinc-200 transition hover:bg-white/[0.08]">{t('workspace.openTargetChapter')}</button>
      </div>
    )
  }

  return (
    <div data-testid="workspace-roleplay-session-actions">
      <button type="button" onClick={props.onOpenAnchorChapter} className="min-h-11 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-zinc-200 transition hover:bg-white/[0.08]">{t('workspace.backToAnchorChapter')}</button>
    </div>
  )
}
