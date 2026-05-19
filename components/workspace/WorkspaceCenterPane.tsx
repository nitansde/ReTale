"use client"

import type { ReactNode } from 'react'
import { BookOpen, GitBranch, Globe } from 'lucide-react'
import { formatStoryBranchInstructionPreview } from '@/lib/story-branch-labels'
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
  branchReadableLabel?: string | null
  branchInstructionText?: string | null
}) {
  const isChapter = props.selection.kind === 'chapter'
  let eyebrow = props.centerPaneView === 'body' ? 'Chapter body first' : 'Chapter graph browser'
  let title = props.chapterTitle
  let description = props.centerPaneView === 'body'
    ? '先选章节，再在正文里直接选中想处理的文本。章节正文入口只保留魔改和角色扮演，避免在主线章节里提前暴露不稳定的续写分支动作。'
    : '切到图谱后会持续停留在这个浏览视角；你从左侧切换章节时，中心面板会直接换成对应章节的已检索图谱。'
  let statusSummary = props.centerPaneView === 'body' ? props.chapterSelectionSummary : props.chapterGraphSummary
  const branchReadableLabel = props.branchReadableLabel?.trim() || ''
  const instructionPreview = formatStoryBranchInstructionPreview(props.branchInstructionText)

  if (props.selection.kind === 'what_if') {
    eyebrow = 'What-if session workspace'
    title = branchReadableLabel || `IF · 第 ${props.selection.anchorChapterNo} 章分支推演`
    description = '这里展示已持久化的 What-if 会话详情：原始片段、推演正文、变化清单，以及继续进入未来跳转或重开改写流的入口。'
    statusSummary = `锚点章节：第 ${props.selection.anchorChapterNo} 章`
  } else if (props.selection.kind === 'rewrite') {
    eyebrow = '改写节点工作区'
    title = branchReadableLabel || `RE · 第 ${props.selection.anchorChapterNo} 章改写节点`
    description = '这里直接读取首个已保存改写节点的最新版本，继续保留 reader 视图与节点级动作入口，但不再把它伪装成 continue-only 分支。'
    statusSummary = `锚点章节：第 ${props.selection.anchorChapterNo} 章`
  } else if (props.selection.kind === 'continue_block') {
    eyebrow = '续写块工作区'
    title = branchReadableLabel || `CONT · 第 ${props.selection.anchorChapterNo} 章续写块`
    description = '这里直接读取已保存的续写块最新版本，默认停留在干净的 reader 视图里；续写、重生与 Future Jump 仍保留为稳定的节点级动作入口。'
    statusSummary = `锚点章节：第 ${props.selection.anchorChapterNo} 章`
  } else if (props.selection.kind === 'future_jump') {
    eyebrow = 'Future jump workspace'
    title = branchReadableLabel || `JUMP · 第 ${props.selection.sourceChapterNo} → ${props.selection.targetChapterNo} 章`
    description = '这里展示已持久化的 Future Jump run 详情、最新修订内容，以及 continue / regenerate 两个节点级动作入口。'
    statusSummary = `源 / 目标章节：第 ${props.selection.sourceChapterNo} 章 → 第 ${props.selection.targetChapterNo} 章`
  }

  return (
    <section className="min-w-0 rounded-[30px] border border-white/10 bg-[#11141d] shadow-[0_28px_90px_rgba(0,0,0,0.35)]" data-testid="workspace-center-pane">
      <div className="border-b border-white/8 px-5 py-4 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500" data-testid="workspace-center-pane-kind">{eyebrow}</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">{title}</h2>
            {!isChapter && instructionPreview ? <p className="mt-2 text-sm text-zinc-200">指令预览 · {instructionPreview}</p> : null}
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
                    {view === 'body' ? 'Body' : 'Graph'}
                  </button>
                ))}
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-[22px] border border-fuchsia-300/20 bg-fuchsia-500/10 px-4 py-3 text-xs text-fuchsia-100">
                <GitBranch className="h-4 w-4" />
                <span className="font-medium">{branchReadableLabel || 'Branch view'}</span>
                {instructionPreview ? <span className="text-fuchsia-100/70">· {instructionPreview}</span> : null}
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
            : props.chapterBodyView}
    </section>
  )
}
