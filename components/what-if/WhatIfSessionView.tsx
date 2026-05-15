"use client"

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, GitBranch, LoaderCircle, RefreshCcw, Sparkles } from 'lucide-react'
import { WhatIfDeltaPanel } from '@/components/what-if/WhatIfDeltaPanel'
import type { WhatIfSessionDetail } from '@/lib/story-branch-types'

async function loadWhatIfSessionDetail(input: {
  novelId: string
  branchId: string
  sessionId: string
}) {
  const params = new URLSearchParams({
    novelId: input.novelId,
    branchId: input.branchId,
  })
  const response = await fetch(`/api/what-if/sessions/${input.sessionId}?${params.toString()}`, {
    cache: 'no-store',
  })
  const data = await response.json() as WhatIfSessionDetail & { ok?: boolean; error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'What-if session load failed')
  }
  return data
}

function excerptText(detail: WhatIfSessionDetail) {
  return detail.selectedText.trim() || detail.originalText.trim() || '当前会话没有保存可展示的原始片段。'
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

export function WhatIfSessionView(props: {
  novelId: string
  branchId: string
  sessionId: string
  anchorChapterNo: number
  nodeTitle?: string | null
  nodeSubtitle?: string | null
  onJumpToFuture: (detail: WhatIfSessionDetail) => void
  onRegenerateWhatIf: (detail: WhatIfSessionDetail) => void
  onContinueInBranch: (detail: WhatIfSessionDetail) => void
}) {
  const [detail, setDetail] = useState<WhatIfSessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setLoading(true)
      setError('')

      try {
        const nextDetail = await loadWhatIfSessionDetail({
          novelId: props.novelId,
          branchId: props.branchId,
          sessionId: props.sessionId,
        })
        if (cancelled) return
        setDetail(nextDetail)
      } catch (loadError) {
        if (cancelled) return
        setDetail(null)
        setError(loadError instanceof Error ? loadError.message : 'What-if session load failed')
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
  }, [props.branchId, props.novelId, props.sessionId])

  const resolvedTitle = detail?.title || props.nodeTitle || `IF · 第 ${props.anchorChapterNo} 章分支推演`
  const resolvedSubtitle = props.nodeSubtitle?.trim() || detail?.premise?.trim() || ''
  const canRunActions = Boolean(detail) && !loading
  const metaPills = useMemo(
    () => [
      `source 第 ${detail?.sourceChapterNo ?? props.anchorChapterNo} 章`,
      `session ${props.sessionId}`,
      detail ? `创建于 ${formatCreatedAt(detail.createdAt)}` : null,
    ].filter(Boolean) as string[],
    [detail, props.anchorChapterNo, props.sessionId]
  )

  return (
    <div className="space-y-4 px-4 py-4 sm:px-7 sm:py-6" data-testid="workspace-what-if-view">
      <section
        className="overflow-hidden rounded-[28px] border border-fuchsia-400/20 bg-[radial-gradient(circle_at_top,_rgba(217,70,239,0.14),_transparent_40%),#0b0d12] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
        data-testid="what-if-view"
      >
        <div className="flex flex-col gap-5 px-5 py-5 sm:px-6 sm:py-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] uppercase tracking-[0.22em] text-fuchsia-200/70">Persisted What-if session</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">{resolvedTitle}</h3>
            <p className="mt-3 text-sm leading-7 text-zinc-300">
              {resolvedSubtitle || '当前视图直接读取已持久化的 What-if 会话详情，并把原文、推演结果与提炼出的差异放在同一个工作台里。'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-zinc-300">
              {metaPills.map((pill) => (
                <span key={pill} className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">{pill}</span>
              ))}
            </div>
          </div>

          <div className="flex w-full max-w-md flex-col gap-2">
            <button
              type="button"
              data-testid="what-if-jump-button"
              onClick={() => detail && props.onJumpToFuture(detail)}
              disabled={!canRunActions}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-fuchsia-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowRight className="h-4 w-4" />
              Jump to Future
            </button>
            <button
              type="button"
              onClick={() => detail && props.onRegenerateWhatIf(detail)}
              disabled={!canRunActions}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-fuchsia-300/25 bg-black/20 px-4 py-3 text-sm text-fuchsia-100 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCcw className="h-4 w-4" />
              Regenerate What-if
            </button>
            <button
              type="button"
              onClick={() => detail && props.onContinueInBranch(detail)}
              disabled={!canRunActions}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GitBranch className="h-4 w-4" />
              Continue in Branch
            </button>
          </div>
        </div>
      </section>

      {loading ? (
        <section className="rounded-[24px] border border-white/8 bg-black/20 p-5 text-sm text-zinc-300">
          <div className="flex items-center gap-2 text-zinc-100">
            <LoaderCircle className="h-4 w-4 animate-spin text-fuchsia-300" />
            正在读取 What-if 会话详情…
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
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <section className="rounded-[24px] border border-white/8 bg-black/20 p-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-2xl border border-fuchsia-300/18 bg-fuchsia-500/10 p-2 text-fuchsia-100">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Original excerpt</p>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-zinc-200">{excerptText(detail)}</p>
                </div>
              </div>
            </section>

            <section className="rounded-[24px] border border-sky-300/18 bg-sky-500/10 p-5">
              <p className="text-[11px] uppercase tracking-[0.18em] text-sky-100/70">Generated what-if</p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-sky-50">{detail.generatedText}</p>
            </section>
          </div>

          <WhatIfDeltaPanel deltas={detail.deltas} />
        </>
      ) : null}
    </div>
  )
}
