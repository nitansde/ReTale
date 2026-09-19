"use client"

import { useEffect, useMemo, useState } from 'react'
import { Clock3, LoaderCircle } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { normalizeStoryBranchInstructionText } from '@/lib/story-branch-labels'
import type { ContinueBlockDetail, ContinueBlockRecord } from '@/lib/story-branch-types'
import { resolveWorkspaceUserFacingError } from '@/lib/workspace-user-facing-errors'
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
  fallbackDetail?: Pick<ContinueBlockRecord, 'latestText' | 'latestRevisionNo' | 'title' | 'subtitle' | 'userInstruction' | 'inputTokens' | 'outputTokens'> | null
  readableLineageLabel?: string | null
  onMetricsChange?: (metrics: { currentText: string; inputTokens: number | null; outputTokens: number | null }) => void
}) {
  const { locale, t } = useI18n()
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
        setError(resolveWorkspaceUserFacingError('continue-block-load', loadError, locale))
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
  }, [locale, props.branchId, props.continueBlockId, props.latestRevisionNo, props.novelId])

  const effectiveDetail = detail ?? props.fallbackDetail ?? null

  useEffect(() => {
    if (!effectiveDetail) return
    onMetricsChange?.({
      currentText: effectiveDetail.latestText,
      inputTokens: effectiveDetail.inputTokens ?? null,
      outputTokens: effectiveDetail.outputTokens ?? null,
    })
  }, [effectiveDetail, onMetricsChange])

  const readableLabel = props.readableLineageLabel?.trim() || ''
  const userRequest = normalizeStoryBranchInstructionText(effectiveDetail?.userInstruction ?? props.nodeSubtitle)
  const revisionEntries = useMemo(
    () => [...(detail?.revisions ?? [])].sort((left, right) => right.revisionNo - left.revisionNo),
    [detail?.revisions]
  )
  const historyEntries = revisionEntries.slice(1)
  const effectiveReaderText = effectiveDetail?.latestText.trim() || ''
  const rawSubtitle = effectiveDetail?.subtitle?.trim() || props.nodeSubtitle?.trim() || ''
  const displaySubtitle = rawSubtitle === '基于当前章节知识状态与证据装配生成。' || rawSubtitle === '已保存版本。'
    ? t('continue.defaultSubtitle')
    : rawSubtitle || t('continue.defaultSubtitle')

  return (
    <div className="space-y-0 sm:space-y-4 sm:px-7 sm:py-6" data-testid="workspace-continue-block-view">
      <section className="overflow-hidden border-b border-fuchsia-400/15 bg-[radial-gradient(circle_at_top,_rgba(217,70,239,0.1),_transparent_45%),var(--surface)] sm:rounded-[28px] sm:border sm:border-fuchsia-400/20 sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <div className="flex flex-col gap-4 px-5 py-5 sm:px-6 sm:py-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] uppercase tracking-[0.22em] text-fuchsia-200/70">{t('continue.savedEyebrow')}</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">{readableLabel || effectiveDetail?.title || props.nodeTitle || t('continue.defaultTitle')}</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">{displaySubtitle}</p>
            {userRequest ? (
              <div className="mt-4 rounded-[20px] border border-fuchsia-300/16 bg-shade/20 px-4 py-3" data-testid="continue-block-user-request">
                <p className="text-[10px] uppercase tracking-[0.16em] text-fuchsia-200/65">{t('continue.userRequest')}</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-fuchsia-50">{userRequest}</p>
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-zinc-300">
              <span className="rounded-full border border-line/10 bg-shade/20 px-3 py-1.5">{t('continue.revision', { count: effectiveDetail?.latestRevisionNo ?? 1 })}</span>
              <span className="rounded-full border border-line/10 bg-shade/20 px-3 py-1.5">{readableLabel || t('continue.chapter', { count: props.anchorChapterNo })}</span>
            </div>
          </div>
          <div className="hidden rounded-[22px] border border-fuchsia-300/20 bg-shade/20 px-4 py-3 text-xs uppercase tracking-[0.18em] text-fuchsia-100 sm:block" data-testid="workspace-continue-block-reader-mode">
            {t('continue.readerMode')}
          </div>
        </div>
      </section>

      {loading ? (
        <section className="rounded-[24px] border border-line/8 bg-shade/20 p-5 text-sm text-zinc-300">
          <div className="flex items-center gap-2 text-zinc-100">
            <LoaderCircle className="h-4 w-4 animate-spin text-fuchsia-300" />
            {t('continue.loading')}
          </div>
        </section>
      ) : null}

      {!loading && error ? (
        <section className="rounded-[24px] border border-rose-400/20 bg-rose-500/10 p-5 text-sm leading-6 text-rose-100">
          {error}
        </section>
      ) : null}

      {effectiveDetail ? (
        <>
          <section className="bg-surface px-5 py-5 sm:rounded-[28px] sm:border sm:border-line/8 sm:p-6 sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            <div className="mb-3 hidden items-center justify-between gap-3 sm:flex">
              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('continue.latestRevision')}</p>
            </div>
            <div className="bg-transparent sm:rounded-[24px] sm:border sm:border-line/8 sm:bg-shade/20 sm:p-5">
              {renderReaderBodyParagraphs(effectiveReaderText || t('continue.emptyBody'), 'text-zinc-200', 'workspace-continue-block-reader-body')}
            </div>
          </section>

          {historyEntries.length ? (
            <section className="rounded-[28px] border border-line/8 bg-surface p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] sm:p-6" data-testid="continue-block-revision-history">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('continue.history')}</p>
                  <p className="mt-1 text-sm text-zinc-300">{t('continue.historyDescription')}</p>
                </div>
                <span className="rounded-full border border-line/10 bg-shade/20 px-3 py-1 text-[11px] text-zinc-300">{t('continue.historyCount', { count: historyEntries.length })}</span>
              </div>

              <div className="mt-4 space-y-4">
                {historyEntries.map((revision) => {
                  const revisionUserRequest = normalizeStoryBranchInstructionText(revision.userInstruction)
                  return (
                    <article key={`${revision.revisionNo}-${revision.createdAt}`} className="rounded-[24px] border border-line/8 bg-shade/20 p-4" data-testid={`continue-block-history-item-${revision.revisionNo}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-zinc-100">{t('continue.historyRevision', { count: revision.revisionNo, kind: revision.revisionKind })}</p>
                          {revisionUserRequest ? (
                            <div className="mt-3 rounded-[18px] border border-fuchsia-300/14 bg-fuchsia-500/[0.08] px-3 py-2.5">
                              <p className="text-[10px] uppercase tracking-[0.14em] text-fuchsia-200/60">{t('continue.userRequest')}</p>
                              <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-6 text-fuchsia-50">{revisionUserRequest}</p>
                            </div>
                          ) : null}
                        </div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-line/10 bg-shade/20 px-3 py-1 text-[11px] text-zinc-400">
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
