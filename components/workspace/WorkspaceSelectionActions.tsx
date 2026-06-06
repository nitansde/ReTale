"use client"

import { ACTION_META, CHAPTER_ACTION_ENTRY_TEST_IDS, CONTINUE_BLOCK_ACTION_TEST_IDS } from '@/components/workspace/selection-novel-studio-helpers'
import { useI18n } from '@/lib/i18n/provider'
import { WORKSPACE_CHAPTER_ACTION_ENTRY_MODES, type WorkspaceActionMode } from '@/components/workspace/use-workspace-chapter-selection'
import { cn } from '@/lib/utils'
import type { TimelineSelection } from '@/lib/story-branch-types'

type WorkspaceSelectionActionsProps = {
  selection: TimelineSelection
  currentChapterOrder: number | null
  selectedTimelineDisplayLabel: string
  selectedTimelineNodeTitle: string | null
  selectedTimelineInstructionPreview: string
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
    return (
      <div className="mb-4 rounded-[24px] border border-violet-400/20 bg-violet-500/10 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-violet-200/70">{t('workspace.chapterActionsEyebrow')}</p>
              <p className="mt-1 text-sm text-zinc-300">{t('workspace.chapterActionsDescription')}</p>
          </div>
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] text-zinc-300">{props.currentChapterOrder ? t('workspace.timeline.chapterLabel', { count: props.currentChapterOrder }) : '—'}</span>
        </div>
        <div className="mt-3 grid gap-2">
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
                  if (!props.selectionText.trim()) return
                  props.onOpenActionMode(mode)
                }}
                className={cn(
                  'flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition',
                  props.activeMode === mode
                    ? 'border-violet-300/30 bg-white/[0.08]'
                    : 'border-white/8 bg-black/20 hover:bg-white/[0.06]',
                  (!props.selectionText.trim() || (mode === 'roleplay' && props.roleplaySessionStarting)) && 'cursor-not-allowed opacity-50'
                )}
                disabled={!props.selectionText.trim() || (mode === 'roleplay' && props.roleplaySessionStarting)}
              >
                <div className="rounded-xl bg-white/10 p-2 text-violet-200"><Icon className="h-4 w-4" /></div>
                <div>
                  <p className="text-sm font-medium text-zinc-100">{meta.label}</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-400">{meta.description}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  if (props.selection.kind === 'rewrite' || props.selection.kind === 'continue_block') {
    return (
      <div className="mb-4 rounded-[24px] border border-fuchsia-400/20 bg-fuchsia-500/10 p-4" data-testid="workspace-continue-block-actions">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-fuchsia-200/70">{t('workspace.continueBlockActionsEyebrow')}</p>
            <h3 className="mt-1 text-sm font-medium text-zinc-100">{props.selectedTimelineDisplayLabel || props.selectedTimelineNodeTitle || t('workspace.continueBlock')}</h3>
            {props.selectedTimelineInstructionPreview ? <p className="mt-2 text-xs leading-6 text-fuchsia-100">{t('workspace.instructionPreview')} · {props.selectedTimelineInstructionPreview}</p> : null}
            <p className="mt-2 text-xs leading-6 text-zinc-300">{t('workspace.continueBlockActionsDescription')}</p>
          </div>
          <span className="rounded-full border border-fuchsia-300/20 bg-black/20 px-3 py-1 text-[11px] text-fuchsia-100">{props.selectedTimelineDisplayLabel || t('workspace.continueBlock')}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => props.onReopenContinueBlockRewriteFlow('continue')} data-testid={CONTINUE_BLOCK_ACTION_TEST_IDS.continue} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 transition hover:bg-white/[0.08]">{t('workspace.continueWriting')}</button>
          <button type="button" onClick={() => props.onReopenContinueBlockRewriteFlow('regenerate')} data-testid={CONTINUE_BLOCK_ACTION_TEST_IDS.regenerate} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 transition hover:bg-white/[0.08]">{t('workspace.regenerateCurrentNode')}</button>
          <button type="button" disabled={!props.hasFutureMapLaunch} onClick={props.onOpenContinueBlockFutureJump} data-testid={CONTINUE_BLOCK_ACTION_TEST_IDS.futureJump} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 transition hover:bg-white/[0.08] disabled:opacity-60">{t('workspace.futureJumpRun')}</button>
          <button type="button" onClick={props.onOpenAnchorChapter} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 transition hover:bg-white/[0.08]">{t('workspace.backToAnchorChapter')}</button>
        </div>
      </div>
    )
  }

  if (props.selection.kind === 'what_if') {
    return (
      <div className="mb-4 rounded-[24px] border border-fuchsia-400/20 bg-fuchsia-500/10 p-4" data-testid="workspace-what-if-actions">
        <div className="flex items-start justify-between gap-3">
          <div>
             <p className="text-[11px] uppercase tracking-[0.22em] text-fuchsia-200/70">{t('workspace.whatIfActionsEyebrow')}</p>
             <h3 className="mt-1 text-sm font-medium text-zinc-100">{props.selectedTimelineDisplayLabel || props.selectedTimelineNodeTitle || t('workspace.whatIfSession')}</h3>
             {props.selectedTimelineInstructionPreview ? <p className="mt-2 text-xs leading-6 text-fuchsia-100">{t('workspace.instructionPreview')} · {props.selectedTimelineInstructionPreview}</p> : null}
             <p className="mt-2 text-xs leading-6 text-zinc-300">{t('workspace.whatIfActionsDescription')}</p>
          </div>
          <span className="rounded-full border border-fuchsia-300/20 bg-black/20 px-3 py-1 text-[11px] text-fuchsia-100">{props.selectedTimelineDisplayLabel || t('workspace.whatIfSession')}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={props.onOpenAnchorChapter} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 transition hover:bg-white/[0.08]">{t('workspace.backToAnchorChapter')}</button>
        </div>
      </div>
    )
  }

  if (props.selection.kind === 'future_jump') {
    return (
      <div className="mb-4 rounded-[24px] border border-sky-400/20 bg-sky-500/10 p-4" data-testid="workspace-future-jump-actions">
        <div className="flex items-start justify-between gap-3">
          <div>
             <p className="text-[11px] uppercase tracking-[0.22em] text-sky-200/70">{t('workspace.futureJumpActionsEyebrow')}</p>
             <h3 className="mt-1 text-sm font-medium text-zinc-100">{props.selectedTimelineDisplayLabel || props.selectedTimelineNodeTitle || t('workspace.futureJumpRun')}</h3>
             {props.selectedTimelineInstructionPreview ? <p className="mt-2 text-xs leading-6 text-sky-100">{t('workspace.instructionPreview')} · {props.selectedTimelineInstructionPreview}</p> : null}
             <p className="mt-2 text-xs leading-6 text-zinc-300">{t('workspace.futureJumpActionsDescription')}</p>
          </div>
          <span className="rounded-full border border-sky-300/20 bg-black/20 px-3 py-1 text-[11px] text-sky-100">{props.selectedTimelineDisplayLabel || t('workspace.futureJumpRun')}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={props.onOpenFutureJumpSourceChapter} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 transition hover:bg-white/[0.08]">{t('workspace.openSourceChapter')}</button>
          <button type="button" onClick={props.onOpenFutureJumpTargetChapter} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 transition hover:bg-white/[0.08]">{t('workspace.openTargetChapter')}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-4 rounded-[24px] border border-emerald-400/20 bg-emerald-500/10 p-4" data-testid="workspace-roleplay-session-actions">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-200/70">{t('workspace.roleplayActionsEyebrow')}</p>
          <h3 className="mt-1 text-sm font-medium text-zinc-100">{props.selectedTimelineDisplayLabel || props.selectedTimelineNodeTitle || t('workspace.roleplaySession')}</h3>
          {props.selectedTimelineInstructionPreview ? <p className="mt-2 text-xs leading-6 text-emerald-100">{t('workspace.firstMessagePreview')} · {props.selectedTimelineInstructionPreview}</p> : null}
          <p className="mt-2 text-xs leading-6 text-zinc-300">{t('workspace.roleplayActionsDescription')}</p>
        </div>
        <span className="rounded-full border border-emerald-300/20 bg-black/20 px-3 py-1 text-[11px] text-emerald-100">{props.selectedTimelineDisplayLabel || t('workspace.roleplaySession')}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={props.onOpenAnchorChapter} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 transition hover:bg-white/[0.08]">{t('workspace.backToAnchorChapter')}</button>
      </div>
    </div>
  )
}
