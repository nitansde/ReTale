"use client"

import { ArrowRight, Clock3, GitBranch, Sparkles } from 'lucide-react'
import { formatStoryBranchInstructionPreview } from '@/lib/story-branch-labels'
import type { FutureJumpRevisionRecord, FutureJumpRunDetail, FutureMapEvent, OutlineNodeChapterRecord, WhatIfSessionDetail } from '@/lib/story-branch-types'
import { cn } from '@/lib/utils'

function formatCreatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function buildSourceMetaLabel(sourceType: string | null | undefined) {
  if (!sourceType) return 'unknown'
  if (sourceType === 'authored') return 'authored'
  return sourceType.replaceAll('_', ' ')
}

export function BridgeSummaryPanel(props: {
  detail: FutureJumpRunDetail
  parentSession: WhatIfSessionDetail | null
  targetEvent: FutureMapEvent | null
  targetChapter: OutlineNodeChapterRecord | null
  revisions: FutureJumpRevisionRecord[]
  readableLineageLabel?: string | null
}) {
  const instructionPreview = formatStoryBranchInstructionPreview(props.detail.userDirection)
  const historyEntries = props.revisions
    .sort((left, right) => right.revisionNo - left.revisionNo)

  return (
    <section className="rounded-[24px] border border-sky-400/20 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_42%),#0b0d12] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-sky-200/70">Bridge summary</p>
          <h3 className="mt-2 text-lg font-semibold text-zinc-100">最新桥接摘要与修订脉络</h3>
          {instructionPreview ? <p className="mt-2 text-sm text-sky-100">指令预览 · {instructionPreview}</p> : null}
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">
            主面板始终读取当前 run 上镜像出的最新桥接摘要；下方修订记录只负责回顾每一版是怎样演化过来的。
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] text-zinc-300">
          {props.readableLineageLabel?.trim() ? <span className="rounded-full border border-sky-300/20 bg-black/20 px-3 py-1.5">{props.readableLineageLabel.trim()}</span> : null}
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">revision {props.detail.latestRevisionNo}</span>
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">status {props.detail.status}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)]">
        <div className="rounded-[22px] border border-sky-300/18 bg-sky-500/10 p-4" data-testid="future-jump-bridge">
          <div className="flex items-center gap-2 text-sky-100">
            <Sparkles className="h-4 w-4" />
            <p className="text-[11px] uppercase tracking-[0.16em] text-sky-100/75">Latest mirrored bridge</p>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-sky-50">{props.detail.bridgeSummary}</p>
        </div>

        <div className="space-y-4">
          <div className="rounded-[22px] border border-fuchsia-300/18 bg-fuchsia-500/10 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-2xl border border-fuchsia-300/18 bg-black/20 p-2 text-fuchsia-100">
                <GitBranch className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-[0.16em] text-fuchsia-200/70">Parent IF session</p>
                <h4 className="mt-1 text-sm font-medium text-zinc-100">{props.parentSession?.title || `IF · 第 ${props.detail.sourceChapterNo} 章分支推演`}</h4>
                <p className="mt-2 text-xs leading-6 text-zinc-300">{props.parentSession?.premise?.trim() || '当前 Future Jump 继承自已持久化的 What-if 分支前提。'}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-300">
                  <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">source 第 {props.detail.sourceChapterNo} 章</span>
                  {props.parentSession?.premise?.trim() ? <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">指令预览 {formatStoryBranchInstructionPreview(props.parentSession.premise)}</span> : null}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[22px] border border-white/8 bg-black/20 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-2xl border border-sky-300/18 bg-sky-500/10 p-2 text-sky-100">
                <ArrowRight className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Target anchor</p>
                <h4 className="mt-1 text-sm font-medium text-zinc-100">{props.targetEvent?.title || `第 ${props.detail.targetChapterNo} 章未来节点`}</h4>
                <p className="mt-2 text-xs leading-6 text-zinc-300">{props.targetEvent?.summary || '未来节点元数据会从分支作用域下的 future map 里回填。'}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-300">
                  <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">target 第 {props.targetChapter?.chapterNo ?? props.detail.targetChapterNo} 章</span>
                  {props.targetChapter?.chapterTitle ? (
                    <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">{props.targetChapter.chapterTitle}</span>
                  ) : null}
                  {props.targetEvent?.phaseLabel || props.targetEvent?.trackKey ? (
                    <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">{props.targetEvent?.phaseLabel || props.targetEvent?.trackKey}</span>
                  ) : null}
                  <span
                    className={cn(
                      'rounded-full border px-2.5 py-1',
                      props.targetEvent?.sourceType === 'authored'
                        ? 'border-emerald-300/18 bg-emerald-500/10 text-emerald-100'
                        : 'border-amber-300/18 bg-amber-500/10 text-amber-100'
                    )}
                  >
                    {buildSourceMetaLabel(props.targetEvent?.sourceType)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {historyEntries.length ? (
        <div className="mt-4 rounded-[22px] border border-white/8 bg-black/20 p-4" data-testid="future-jump-revision-history">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Revision history</p>
              <p className="mt-1 text-sm text-zinc-300">当前主面板继续锁定最新镜像；历史区保留修订标签，更早版本继续展示桥接摘要和未来正文。</p>
            </div>
            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-300">{historyEntries.length} 条历史</span>
          </div>

          <ul className="mt-4 space-y-3">
            {historyEntries.map((item) => {
              const isCurrentMirror = item.revisionNo === props.detail.latestRevisionNo
                && item.bridgeSummary.trim() === props.detail.bridgeSummary.trim()
                && item.generatedTargetText.trim() === props.detail.generatedTargetText.trim()
              return (
            <li key={`${item.revisionNo}-${item.createdAt}`} className="rounded-[18px] border border-white/8 bg-white/[0.03] p-3" data-testid={`future-jump-history-item-${item.revisionNo}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-zinc-100">第 {item.revisionNo} 版 · {item.revisionKind}</p>
                  <p className="mt-2 text-xs leading-6 text-zinc-300">{item.userFeedback?.trim() || '初始生成版，没有额外反馈。'}</p>
                  {isCurrentMirror ? <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-sky-100">当前版本已在主面板展示</p> : null}
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-400">
                  <Clock3 className="h-3.5 w-3.5" />
                  {formatCreatedAt(item.createdAt)}
                </div>
              </div>

              {!isCurrentMirror ? <div className="mt-3 grid gap-3 xl:grid-cols-2">
                <div className="rounded-[16px] border border-sky-300/18 bg-sky-500/10 p-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-sky-100/75">Bridge</p>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-sky-50">{item.bridgeSummary}</p>
                </div>
                <div className="rounded-[16px] border border-white/8 bg-black/20 p-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Future text</p>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-zinc-200">{item.generatedTargetText}</p>
                </div>
              </div> : null}
            </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
