"use client"

import { useEffect, useMemo, useState } from 'react'
import { Clock3, LoaderCircle } from 'lucide-react'
import { formatStoryBranchInstructionPreview } from '@/lib/story-branch-labels'
import type { ContinueBlockDetail } from '@/lib/story-branch-types'
import { cn, splitPlainTextParagraphs } from '@/lib/utils'

async function loadContinueBlockDetail(input: {
  novelId: string
  branchId: string
  continueBlockId: string
}) {
  const params = new URLSearchParams({
    novelId: input.novelId,
    branchId: input.branchId,
  })
  const response = await fetch(`/api/continue-blocks/${input.continueBlockId}?${params.toString()}`, {
    cache: 'no-store',
  })
  const data = await response.json() as ContinueBlockDetail & { ok?: boolean; error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'Continue block load failed')
  }
  return data
}

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

function renderReaderBodyParagraphs(text: string, className?: string, dataTestId?: string) {
  const paragraphs = splitPlainTextParagraphs(text)
  const visibleParagraphs = paragraphs.length ? paragraphs : [text.trim() || '　']

  return (
    <div className={cn('reader-body-prose', className)} data-testid={dataTestId}>
      {visibleParagraphs.map((paragraph, index) => (
        <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
      ))}
    </div>
  )
}

export function ContinueBlockDetailView(props: {
  novelId: string
  branchId: string
  continueBlockId: string
  latestRevisionNo?: number | null
  anchorChapterNo: number
  nodeTitle?: string | null
  nodeSubtitle?: string | null
  readableLineageLabel?: string | null
  onMetricsChange?: (metrics: { currentText: string; inputTokens: number | null; outputTokens: number | null }) => void
}) {
  const { onMetricsChange } = props
  const [detail, setDetail] = useState<ContinueBlockDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setLoading(true)
      setError('')

      try {
        const nextDetail = await loadContinueBlockDetail({
          novelId: props.novelId,
          branchId: props.branchId,
          continueBlockId: props.continueBlockId,
        })
        if (cancelled) return
        setDetail(nextDetail)
      } catch (loadError) {
        if (cancelled) return
        setDetail(null)
        setError(loadError instanceof Error ? loadError.message : 'Continue block load failed')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [props.branchId, props.continueBlockId, props.latestRevisionNo, props.novelId])

  useEffect(() => {
    if (!detail) return
    onMetricsChange?.({
      currentText: detail.latestText,
      inputTokens: detail.inputTokens ?? null,
      outputTokens: detail.outputTokens ?? null,
    })
  }, [detail, onMetricsChange])

  const readableLabel = props.readableLineageLabel?.trim() || ''
  const instructionPreview = formatStoryBranchInstructionPreview(detail?.userInstruction ?? props.nodeSubtitle)
  const revisionEntries = useMemo(
    () => [...(detail?.revisions ?? [])].sort((left, right) => right.revisionNo - left.revisionNo),
    [detail?.revisions]
  )
  const historyEntries = revisionEntries.slice(1)

  return (
    <div className="space-y-4 px-4 py-4 sm:px-7 sm:py-6" data-testid="workspace-continue-block-view">
      <section className="overflow-hidden rounded-[28px] border border-fuchsia-400/20 bg-[radial-gradient(circle_at_top,_rgba(217,70,239,0.12),_transparent_42%),#0b0d12] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <div className="flex flex-col gap-5 px-5 py-5 sm:px-6 sm:py-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] uppercase tracking-[0.22em] text-fuchsia-200/70">已保存续写块</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">{readableLabel || detail?.title || props.nodeTitle || '续写块'}</h3>
            {instructionPreview ? <p className="mt-2 text-sm text-fuchsia-100">指令预览 · {instructionPreview}</p> : null}
            <p className="mt-3 text-sm leading-7 text-zinc-300">{detail?.subtitle?.trim() || props.nodeSubtitle?.trim() || '这里展示已保存的续写块最新版本，并在下方保留重生前的历史版本。'}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-zinc-300">
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">reader mode</span>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">revision {detail?.latestRevisionNo ?? 1}</span>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">{readableLabel || `第 ${props.anchorChapterNo} 章`}</span>
            </div>
          </div>
          <div className="rounded-[22px] border border-fuchsia-300/20 bg-black/20 px-4 py-3 text-xs uppercase tracking-[0.18em] text-fuchsia-100" data-testid="workspace-continue-block-reader-mode">
            Read mode
          </div>
        </div>
      </section>

      {loading ? (
        <section className="rounded-[24px] border border-white/8 bg-black/20 p-5 text-sm text-zinc-300">
          <div className="flex items-center gap-2 text-zinc-100">
            <LoaderCircle className="h-4 w-4 animate-spin text-fuchsia-300" />
            正在读取续写块详情…
          </div>
        </section>
      ) : null}

      {!loading && error ? (
        <section className="rounded-[24px] border border-rose-400/20 bg-rose-500/10 p-5 text-sm leading-6 text-rose-100">
          {error}
        </section>
      ) : null}

      {!loading && detail ? (
        <>
          <section className="rounded-[28px] border border-white/8 bg-[#0b0d12] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] sm:p-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Latest saved revision</p>
              {instructionPreview ? <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-300">指令预览 {instructionPreview}</span> : null}
            </div>
            <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
              {renderReaderBodyParagraphs(detail.latestText.trim() || '当前续写块还没有可展示的已保存正文。', 'text-zinc-200', 'workspace-continue-block-reader-body')}
            </div>
          </section>

          {historyEntries.length ? (
            <section className="rounded-[28px] border border-white/8 bg-[#0b0d12] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] sm:p-6" data-testid="continue-block-revision-history">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Revision history</p>
                  <p className="mt-1 text-sm text-zinc-300">最新版本保持为当前 reader；更早的重生前版本会继续保留在这里。</p>
                </div>
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-300">{historyEntries.length} 条历史</span>
              </div>

              <div className="mt-4 space-y-4">
                {historyEntries.map((revision) => {
                  const revisionPreview = formatStoryBranchInstructionPreview(revision.userInstruction)
                  return (
                    <article key={`${revision.revisionNo}-${revision.createdAt}`} className="rounded-[24px] border border-white/8 bg-black/20 p-4" data-testid={`continue-block-history-item-${revision.revisionNo}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-zinc-100">第 {revision.revisionNo} 版 · {revision.revisionKind}</p>
                          {revisionPreview ? <p className="mt-2 text-xs leading-6 text-fuchsia-100">指令预览 · {revisionPreview}</p> : null}
                        </div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-400">
                          <Clock3 className="h-3.5 w-3.5" />
                          {formatCreatedAt(revision.createdAt)}
                        </div>
                      </div>

                      <div className="mt-3 rounded-[20px] border border-fuchsia-300/16 bg-fuchsia-500/10 p-4">
                        {renderReaderBodyParagraphs(revision.generatedText, 'text-zinc-200')}
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
