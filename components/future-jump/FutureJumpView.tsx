"use client"

import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { BridgeSummaryPanel } from '@/components/future-jump/BridgeSummaryPanel'
import { FutureJumpControlPanel } from '@/components/future-jump/FutureJumpControlPanel'
import { FutureNodeTextPanel } from '@/components/future-jump/FutureNodeTextPanel'
import type {
  FutureJumpMutationResponse,
  FutureJumpRunDetail,
  FutureMapEvent,
  FutureMapResponse,
  OutlineNodeChapterRecord,
  WhatIfSessionDetail,
} from '@/lib/story-branch-types'

export type FutureJumpContinueContext = {
  detail: FutureJumpRunDetail
  parentSession: WhatIfSessionDetail | null
  targetEvent: FutureMapEvent | null
  targetChapter: OutlineNodeChapterRecord | null
}

type FutureJumpBundle = {
  detail: FutureJumpRunDetail
  parentSession: WhatIfSessionDetail | null
  targetEvent: FutureMapEvent | null
  targetChapter: OutlineNodeChapterRecord | null
}

function getSuccessfulResult<T>(result: PromiseSettledResult<T>) {
  return result.status === 'fulfilled' ? result.value : null
}

async function loadFutureJumpRunDetail(input: { runId: string; branchId: string }) {
  const params = new URLSearchParams({ branchId: input.branchId })
  const response = await fetch(`/api/future-jump/runs/${input.runId}?${params.toString()}`, {
    cache: 'no-store',
  })
  const data = await response.json() as FutureJumpRunDetail & { ok?: boolean; error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'Future jump run load failed')
  }
  return data
}

async function loadWhatIfSessionDetail(input: { novelId: string; branchId: string; sessionId: string }) {
  const params = new URLSearchParams({ novelId: input.novelId, branchId: input.branchId })
  const response = await fetch(`/api/what-if/sessions/${input.sessionId}?${params.toString()}`, {
    cache: 'no-store',
  })
  const data = await response.json() as WhatIfSessionDetail & { ok?: boolean; error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'What-if session load failed')
  }
  return data
}

async function loadFutureMap(input: { novelId: string; branchId: string; sessionId: string; sourceChapterNo: number }) {
  const params = new URLSearchParams({
    novelId: input.novelId,
    branchId: input.branchId,
    sourceChapterNo: String(input.sourceChapterNo),
    parentSessionId: input.sessionId,
  })
  const response = await fetch(`/api/story-future-map?${params.toString()}`, { cache: 'no-store' })
  const data = await response.json() as FutureMapResponse & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'Future map load failed')
  }
  return data
}

async function reviseFutureJumpRun(input: { runId: string; userFeedback: string }) {
  const response = await fetch(`/api/future-jump/runs/${input.runId}/revise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userFeedback: input.userFeedback }),
  })
  const data = await response.json() as FutureJumpMutationResponse & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'Future jump revise failed')
  }
  return data
}

async function loadFutureJumpBundle(input: { novelId: string; branchId: string; runId: string }) {
  const detail = await loadFutureJumpRunDetail({ runId: input.runId, branchId: input.branchId })
  const [parentSessionResult, futureMapResult] = await Promise.allSettled([
    loadWhatIfSessionDetail({ novelId: input.novelId, branchId: input.branchId, sessionId: detail.sessionId }),
    loadFutureMap({
      novelId: input.novelId,
      branchId: input.branchId,
      sessionId: detail.sessionId,
      sourceChapterNo: detail.sourceChapterNo,
    }),
  ])

  const parentSession = getSuccessfulResult(parentSessionResult)
  const futureMap = getSuccessfulResult(futureMapResult)

  const targetEvent = futureMap?.events.find((event) => event.id === detail.targetOutlineNodeId) ?? null
  const targetChapter = futureMap?.chaptersByEvent[detail.targetOutlineNodeId]?.find((chapter) => chapter.id === detail.targetOutlineChapterId) ?? null

  return { detail, parentSession, targetEvent, targetChapter } satisfies FutureJumpBundle
}

export function FutureJumpView(props: {
  novelId: string
  branchId: string
  runId: string
  sourceChapterNo: number
  targetChapterNo: number
  nodeTitle?: string | null
  onContinueInFuture: (context: FutureJumpContinueContext) => void
}) {
  const [bundle, setBundle] = useState<FutureJumpBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [regenerating, setRegenerating] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setLoading(true)
      setError('')
      setActionError('')

      try {
        const nextBundle = await loadFutureJumpBundle({
          novelId: props.novelId,
          branchId: props.branchId,
          runId: props.runId,
        })
        if (cancelled) return
        setBundle(nextBundle)
      } catch (loadError) {
        if (cancelled) return
        setBundle(null)
        setError(loadError instanceof Error ? loadError.message : 'Future jump run load failed')
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
  }, [props.branchId, props.novelId, props.runId])

  const revisionHistory = useMemo(
    () => [...(bundle?.detail.revisionHistory ?? [])].sort((left, right) => right.revisionNo - left.revisionNo),
    [bundle?.detail.revisionHistory]
  )

  const targetTitle = bundle?.targetChapter?.chapterTitle?.trim()
    || bundle?.targetEvent?.title?.trim()
    || props.nodeTitle?.trim()
    || `第 ${bundle?.detail.targetChapterNo ?? props.targetChapterNo} 章未来版本`

  const handleRegenerate = async () => {
    if (!bundle || regenerating) return

    setRegenerating(true)
    setActionError('')
    try {
      await reviseFutureJumpRun({
        runId: bundle.detail.id,
        userFeedback: feedback.trim(),
      })
      const nextBundle = await loadFutureJumpBundle({
        novelId: props.novelId,
        branchId: props.branchId,
        runId: bundle.detail.id,
      })
      setBundle(nextBundle)
      setFeedback('')
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : 'Future jump revise failed')
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <div className="space-y-4 px-4 py-4 sm:px-7 sm:py-6" data-testid="workspace-future-jump-view">
      <section
        className="overflow-hidden rounded-[28px] border border-sky-400/20 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_42%),#0b0d12] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
        data-testid="future-jump-view"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5 sm:px-6 sm:py-6">
          <div className="max-w-4xl">
            <p className="text-[11px] uppercase tracking-[0.22em] text-sky-200/70">Persisted Future Jump run</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">{props.nodeTitle?.trim() || `JUMP · 第 ${props.sourceChapterNo} → ${props.targetChapterNo} 章`}</h3>
            <p className="mt-3 text-sm leading-7 text-zinc-300">这个视图会直接读取持久化的 Future Jump run 详情，并始终把最新修订镜像到桥接摘要、目标正文与继续改写入口上。</p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-zinc-300">
            <span className="rounded-full border border-sky-300/20 bg-black/20 px-3 py-1.5">branch {props.branchId}</span>
            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">source 第 {props.sourceChapterNo} 章</span>
            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">target 第 {props.targetChapterNo} 章</span>
          </div>
        </div>
      </section>

      {loading ? (
        <section className="rounded-[24px] border border-white/8 bg-black/20 p-5 text-sm text-zinc-300">
          <div className="flex items-center gap-2 text-zinc-100">
            <LoaderCircle className="h-4 w-4 animate-spin text-sky-300" />
            正在读取 Future Jump run 详情…
          </div>
        </section>
      ) : null}

      {!loading && error ? (
        <section className="rounded-[24px] border border-rose-400/20 bg-rose-500/10 p-5 text-sm leading-6 text-rose-100">
          {error}
        </section>
      ) : null}

      {!loading && bundle ? (
        <>
          <BridgeSummaryPanel
            detail={bundle.detail}
            parentSession={bundle.parentSession}
            targetEvent={bundle.targetEvent}
            targetChapter={bundle.targetChapter}
            revisionHistory={revisionHistory}
          />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(320px,0.82fr)]">
            <FutureNodeTextPanel
              targetTitle={targetTitle}
              targetChapterLabel={`第 ${bundle.targetChapter?.chapterNo ?? bundle.detail.targetChapterNo} 章`}
              generatedTargetText={bundle.detail.generatedTargetText}
            />
            <FutureJumpControlPanel
              feedback={feedback}
              onFeedbackChange={setFeedback}
              onRegenerate={handleRegenerate}
              regenerating={regenerating}
              onContinue={() => props.onContinueInFuture(bundle)}
              continueDisabled={regenerating}
              latestRevisionNo={bundle.detail.latestRevisionNo}
              actionError={actionError}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}
