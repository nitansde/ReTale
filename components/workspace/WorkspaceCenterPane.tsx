"use client"

import type { ReactNode } from 'react'
import { BookOpen, GitBranch, Globe } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { normalizeStoryBranchInstructionText } from '@/lib/story-branch-labels'
import { cn } from '@/lib/utils'
import type { TimelineSelection } from '@/lib/story-branch-types'

export function WorkspaceCenterPane(props: {
  selection: TimelineSelection
  chapterTitle: string
  centerPaneView: 'body' | 'graph'
  onCenterPaneViewChange: (view: 'body' | 'graph') => void
  chapterSelectionSummary: string
  chapterGraphSummary: string
  chapterBodyView: ReactNode
  chapterGraphView: ReactNode
  continueBlockView: ReactNode
  whatIfView: ReactNode
  futureJumpView: ReactNode
  roleplayView: ReactNode
  branchReadableLabel?: string | null
  branchInstructionText?: string | null
}) {
  const { t } = useI18n()
  const isChapter = props.selection.kind === 'chapter'
  let eyebrow = props.centerPaneView === 'body' ? t('workspace.centerPane.chapterBodyEyebrow') : t('workspace.centerPane.chapterGraphEyebrow')
  let title = props.chapterTitle
  let description = props.centerPaneView === 'body'
    ? t('workspace.centerPane.chapterBodyDescription')
    : t('workspace.centerPane.chapterGraphDescription')
  let statusSummary = props.centerPaneView === 'body' ? props.chapterSelectionSummary : props.chapterGraphSummary
  const branchReadableLabel = props.branchReadableLabel?.trim() || ''
  const instructionText = normalizeStoryBranchInstructionText(props.branchInstructionText)

  if (props.selection.kind === 'what_if') {
    eyebrow = t('workspace.centerPane.whatIfEyebrow')
    title = branchReadableLabel || t('whatIf.defaultTitle', { count: props.selection.anchorChapterNo })
    description = t('workspace.centerPane.whatIfDescription')
    statusSummary = t('workspace.centerPane.anchorChapter', { chapterNo: props.selection.anchorChapterNo })
  } else if (props.selection.kind === 'rewrite') {
    eyebrow = t('workspace.centerPane.rewriteEyebrow')
    title = branchReadableLabel || t('workspace.centerPane.rewriteTitle', { chapterNo: props.selection.anchorChapterNo })
    description = t('workspace.centerPane.rewriteDescription')
    statusSummary = t('workspace.centerPane.anchorChapter', { chapterNo: props.selection.anchorChapterNo })
  } else if (props.selection.kind === 'continue_block') {
    eyebrow = t('workspace.centerPane.continueEyebrow')
    title = branchReadableLabel || t('workspace.centerPane.continueTitle', { chapterNo: props.selection.anchorChapterNo })
    description = t('workspace.centerPane.continueDescription')
    statusSummary = t('workspace.centerPane.anchorChapter', { chapterNo: props.selection.anchorChapterNo })
  } else if (props.selection.kind === 'future_jump') {
    eyebrow = t('workspace.centerPane.futureJumpEyebrow')
    title = branchReadableLabel || t('futureJump.defaultTitle', { source: props.selection.sourceChapterNo, target: props.selection.targetChapterNo })
    description = t('workspace.centerPane.futureJumpDescription')
    statusSummary = t('workspace.centerPane.futureJumpStatus', { source: props.selection.sourceChapterNo, target: props.selection.targetChapterNo })
  } else if (props.selection.kind === 'roleplay_session') {
    eyebrow = t('workspace.centerPane.roleplayEyebrow')
    title = branchReadableLabel || t('roleplay.defaultTitle', { count: props.selection.anchorChapterNo })
    description = t('workspace.centerPane.roleplayDescription')
    statusSummary = t('workspace.centerPane.anchorChapter', { chapterNo: props.selection.anchorChapterNo })
  }

  return (
    <section className="min-w-0 rounded-[30px] border border-white/10 bg-[#11141d] shadow-[0_28px_90px_rgba(0,0,0,0.35)]" data-testid="workspace-center-pane">
      <div className="border-b border-white/8 px-5 py-4 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500" data-testid="workspace-center-pane-kind">{eyebrow}</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">{title}</h2>
            {!isChapter && instructionText ? (
              <div className="mt-3 max-w-2xl rounded-[18px] border border-fuchsia-300/14 bg-fuchsia-500/[0.07] px-3.5 py-3">
                <p className="text-[10px] uppercase tracking-[0.14em] text-fuchsia-200/60">{t('workspace.userRequest')}</p>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-200">{instructionText}</p>
              </div>
            ) : null}
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{description}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {isChapter ? (
              <div className="inline-flex rounded-[22px] border border-white/10 bg-black/20 p-1 text-sm text-zinc-400" data-testid="workspace-chapter-view-toggle">
                {(['body', 'graph'] as const).map((view) => (
                  <button
                    key={view}
                    type="button"
                    onClick={() => props.onCenterPaneViewChange(view)}
                    className={cn(
                      'rounded-[18px] px-4 py-2 transition',
                      props.centerPaneView === view ? 'bg-white/10 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
                    )}
                  >
                    {view === 'body' ? t('workspace.centerPane.bodyTab') : t('workspace.centerPane.graphTab')}
                  </button>
                ))}
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-[22px] border border-fuchsia-300/20 bg-fuchsia-500/10 px-4 py-3 text-xs text-fuchsia-100">
                <GitBranch className="h-4 w-4" />
                <span className="font-medium">{branchReadableLabel || t('workspace.centerPane.branchView')}</span>
              </div>
            )}
            <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-3 text-xs leading-6 text-zinc-400">
              <div className="flex items-center gap-2">
                {isChapter ? (
                  props.centerPaneView === 'body' ? <BookOpen className="h-4 w-4 text-violet-300" /> : <Globe className="h-4 w-4 text-sky-300" />
                ) : (
                  <GitBranch className="h-4 w-4 text-fuchsia-300" />
                )}
                {statusSummary}
              </div>
            </div>
          </div>
        </div>
      </div>

      {isChapter
        ? (props.centerPaneView === 'body' ? props.chapterBodyView : props.chapterGraphView)
        : props.selection.kind === 'what_if'
          ? props.whatIfView
          : props.selection.kind === 'rewrite' || props.selection.kind === 'continue_block'
            ? props.continueBlockView
          : props.selection.kind === 'future_jump'
            ? props.futureJumpView
            : props.selection.kind === 'roleplay_session'
              ? props.roleplayView
             : props.chapterBodyView}
    </section>
  )
}
