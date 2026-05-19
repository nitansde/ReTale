"use client"

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, GitBranch, LoaderCircle, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  FutureJumpMutationResponse,
  FutureJumpSourceContext,
  FutureMapEvent,
  FutureMapResponse,
  OutlineNodeChapterRecord,
} from '@/lib/story-branch-types'

type FutureMapOverlayProps = {
  novelId: string
  branchId: string
  sourceContext: FutureJumpSourceContext
  title: string
  parentTimelineNodeId: string | null
  onClose: () => void
  onCreated: (
    result: FutureJumpMutationResponse,
    context: { sourceChapterNo: number; targetChapterNo: number }
  ) => Promise<void> | void
}

type FutureMapMode = 'history_node' | 'direct_chapter'

type DirectChapterOption = {
  event: FutureMapEvent
  chapter: OutlineNodeChapterRecord
}

function formatConfidence(confidence: number | null) {
  if (confidence === null || Number.isNaN(confidence)) return '未标注'
  return `${Math.round(confidence * 100)}%`
}

function buildSourceMeta(sourceType: string) {
  if (sourceType === 'authored') {
    return {
      label: 'Authored',
      tone: 'border-emerald-300/20 bg-emerald-500/12 text-emerald-100',
      description: '作者明确写入的大纲节点',
    }
  }

  return {
    label: sourceType.replaceAll('_', ' '),
    tone: 'border-amber-300/20 bg-amber-500/12 text-amber-100',
    description: '由已有素材推导出的候选未来事件',
  }
}

async function loadFutureMap(input: Pick<FutureMapOverlayProps, 'novelId' | 'branchId' | 'sourceContext'>) {
  const params = new URLSearchParams({
    novelId: input.novelId,
    branchId: input.branchId,
    sourceChapterNo: String(input.sourceContext.chapterNo),
  })
  if (input.sourceContext.chapterId) {
    params.set('sourceChapterId', input.sourceContext.chapterId)
  }
  if (input.sourceContext.nodeId) {
    params.set('sourceNodeId', input.sourceContext.nodeId)
  }
  params.set('sourceNodeType', input.sourceContext.nodeType)
  if (input.sourceContext.whatIfSessionId) {
    params.set('parentSessionId', input.sourceContext.whatIfSessionId)
  }
  const response = await fetch(`/api/story-future-map?${params.toString()}`, { cache: 'no-store' })
  const data = await response.json() as FutureMapResponse & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'Future map load failed')
  }
  return data
}

async function createFutureJump(input: {
  sourceContext: FutureJumpSourceContext
  targetOutlineNodeId: string
  targetOutlineChapterId: string
  parentTimelineNodeId: string | null
  userDirection?: string | null
}) {
  const response = await fetch('/api/future-jump/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await response.json() as FutureJumpMutationResponse & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'Future jump create failed')
  }
  return data
}

function EventCard(props: {
  event: FutureMapEvent
  selected: boolean
  dimmed: boolean
  onClick: () => void
}) {
  const sourceMeta = buildSourceMeta(props.event.sourceType)

  return (
    <button
      type="button"
      data-testid={`future-map-event-${props.event.id}`}
      onClick={props.onClick}
      className={cn(
        'w-full rounded-[24px] border p-4 text-left transition',
        props.selected
          ? 'border-sky-300/35 bg-sky-500/12 shadow-[0_18px_60px_rgba(14,165,233,0.12)]'
          : 'border-white/8 bg-black/20 hover:border-white/15 hover:bg-white/[0.05]',
        props.dimmed && !props.selected && 'opacity-60'
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            {props.event.phaseLabel || props.event.trackKey}
          </p>
          <h4 className="mt-1 text-sm font-medium text-zinc-100">{props.event.title}</h4>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className={cn('rounded-full border px-2.5 py-1', sourceMeta.tone)}>{sourceMeta.label}</span>
          <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-zinc-300">
            置信度 {formatConfidence(props.event.confidence)}
          </span>
        </div>
      </div>

      <p className="mt-3 text-sm leading-6 text-zinc-300">{props.event.summary}</p>

      {props.event.originalOutcome ? (
        <div className="mt-3 rounded-[18px] border border-white/8 bg-white/[0.03] p-3 text-xs leading-6 text-zinc-400">
          <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Original outcome</p>
          <p className="mt-1">{props.event.originalOutcome}</p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-300">
        <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">track {props.event.trackKey}</span>
        {props.event.chapterNo !== null ? (
          <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">第 {props.event.chapterNo} 章节点</span>
        ) : null}
      </div>
    </button>
  )
}

export function FutureMapOverlay(props: FutureMapOverlayProps) {
  const { branchId, novelId, onClose, onCreated, parentTimelineNodeId, sourceContext, title } = props
  const [data, setData] = useState<FutureMapResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<FutureMapMode>('history_node')
  const [selectedTrackKey, setSelectedTrackKey] = useState<string | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [userDirection, setUserDirection] = useState('')
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setLoading(true)
      setError('')
      setCreateError('')
      setMode('history_node')
      setSelectedEventId(null)
      setSelectedChapterId(null)

      try {
        const nextData = await loadFutureMap({ novelId, branchId, sourceContext })
        if (cancelled) return
        setData(nextData)
        setSelectedTrackKey(nextData.defaults.selectedTrackKey ?? nextData.tracks[0]?.trackKey ?? null)
      } catch (loadError) {
        if (cancelled) return
        setData(null)
        setError(loadError instanceof Error ? loadError.message : 'Future map load failed')
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
  }, [branchId, novelId, sourceContext])

  const eventsById = useMemo(() => new Map((data?.events ?? []).map((event) => [event.id, event] as const)), [data?.events])
  const visibleEvents = useMemo(() => {
    if (!data) return []
    if (!selectedTrackKey) return data.events
    return data.events.filter((event) => event.trackKey === selectedTrackKey)
  }, [data, selectedTrackKey])
  const selectedEvent = selectedEventId ? eventsById.get(selectedEventId) ?? null : null
  const resolveHistoryNodeChapterId = (event: FutureMapEvent) => {
    const chapters = data?.chaptersByEvent[event.id] ?? []
    if (!chapters.length) return null
    return chapters.find((chapter) => chapter.chapterNo === event.chapterNo)?.id
      ?? chapters.find((chapter) => chapter.isPrimary)?.id
      ?? chapters[0]?.id
      ?? null
  }
  const chapterOptions = useMemo<OutlineNodeChapterRecord[]>(() => {
    if (!selectedEvent || !data) return []
    return data.chaptersByEvent[selectedEvent.id] ?? []
  }, [data, selectedEvent])
  const directChapterOptions = useMemo<DirectChapterOption[]>(() => {
    if (!data) return []
    return data.events.flatMap((event) =>
      (data.chaptersByEvent[event.id] ?? []).map((chapter) => ({ event, chapter }))
    )
  }, [data])
  const visibleDirectChapterOptions = useMemo(() => {
    if (!selectedTrackKey) return directChapterOptions
    return directChapterOptions.filter((option) => option.event.trackKey === selectedTrackKey)
  }, [directChapterOptions, selectedTrackKey])
  const selectedChapter = chapterOptions.find((chapter) => chapter.id === selectedChapterId) ?? null
  const canConfirm = Boolean(selectedEvent && selectedChapter) && !creating

  const handleTrackSelect = (trackKey: string) => {
    setSelectedTrackKey(trackKey)
    const currentEvent = selectedEventId ? eventsById.get(selectedEventId) ?? null : null
    if (!currentEvent || currentEvent.trackKey !== trackKey) {
      setSelectedEventId(null)
      setSelectedChapterId(null)
    }
  }

  const handleEventSelect = (event: FutureMapEvent) => {
    setSelectedTrackKey(event.trackKey)
    setSelectedEventId(event.id)
    setSelectedChapterId(mode === 'history_node' ? resolveHistoryNodeChapterId(event) : null)
    setCreateError('')
  }

  const handleDirectChapterSelect = (option: DirectChapterOption) => {
    setSelectedTrackKey(option.event.trackKey)
    setSelectedEventId(option.event.id)
    setSelectedChapterId(option.chapter.id)
    setCreateError('')
  }

  const handleConfirm = async () => {
    if (!selectedEvent || !selectedChapter || creating) return

    setCreating(true)
    setCreateError('')

    try {
        const result = await createFutureJump({
          sourceContext,
          targetOutlineNodeId: selectedEvent.id,
          targetOutlineChapterId: selectedChapter.id,
          parentTimelineNodeId,
          userDirection: userDirection.trim() || undefined,
        })
        await onCreated(result, {
          sourceChapterNo: sourceContext.chapterNo,
          targetChapterNo: selectedChapter.chapterNo,
        })
    } catch (submitError) {
      setCreateError(submitError instanceof Error ? submitError.message : 'Future jump create failed')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/72 backdrop-blur-sm" data-testid="future-map-overlay" onClick={onClose}>
      <div
        className="absolute inset-x-0 top-0 h-full overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="min-h-screen px-4 py-4 sm:px-6 sm:py-6">
          <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-[1680px] flex-col rounded-[34px] border border-sky-300/20 bg-[#0d1017] shadow-[0_30px_120px_rgba(0,0,0,0.55)]">
            <div className="border-b border-white/8 px-5 py-5 sm:px-7 sm:py-6">
              <div className="flex items-start justify-between gap-4">
                <div className="max-w-4xl">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-sky-200/70">Future map</p>
                  <h3 className="mt-2 text-2xl font-semibold text-zinc-100">{title}</h3>
                  <p className="mt-3 text-sm leading-7 text-zinc-300">
                    先选一种跳转方式：历史节点会直接绑定该节点所属章节；直接章节会列出可跳到的章节锚点，并展示已有摘要帮助你判断落点。
                  </p>
                </div>
                <button data-testid="future-map-close" onClick={onClose} className="rounded-2xl border border-white/10 p-2 text-zinc-300 transition hover:bg-white/[0.06]">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-300">
                <span className="rounded-full border border-sky-300/20 bg-black/20 px-3 py-1.5">source {sourceContext.nodeType}</span>
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">当前分支</span>
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">source 第 {sourceContext.chapterNo} 章</span>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="future-map-mode-history-node"
                  onClick={() => {
                    setMode('history_node')
                    setSelectedEventId(null)
                    setSelectedChapterId(null)
                    setCreateError('')
                  }}
                  className={cn(
                    'rounded-full border px-4 py-2 text-sm transition',
                    mode === 'history_node'
                      ? 'border-sky-300/35 bg-sky-500/12 text-sky-50'
                      : 'border-white/10 bg-black/20 text-zinc-300 hover:bg-white/[0.05]'
                  )}
                >
                  历史节点
                </button>
                <button
                  type="button"
                  data-testid="future-map-mode-direct-chapter"
                  onClick={() => {
                    setMode('direct_chapter')
                    setSelectedEventId(null)
                    setSelectedChapterId(null)
                    setCreateError('')
                  }}
                  className={cn(
                    'rounded-full border px-4 py-2 text-sm transition',
                    mode === 'direct_chapter'
                      ? 'border-sky-300/35 bg-sky-500/12 text-sky-50'
                      : 'border-white/10 bg-black/20 text-zinc-300 hover:bg-white/[0.05]'
                  )}
                >
                  直接章节
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex flex-1 items-center justify-center px-6 py-12 text-sm text-zinc-200">
                <div className="flex items-center gap-2 rounded-[24px] border border-white/8 bg-black/20 px-5 py-4">
                  <LoaderCircle className="h-4 w-4 animate-spin text-sky-300" />
                  正在读取 future map 候选事件…
                </div>
              </div>
            ) : error ? (
              <div className="px-6 py-8 sm:px-7">
                <div className="rounded-[24px] border border-rose-400/20 bg-rose-500/10 p-5 text-sm leading-6 text-rose-100">{error}</div>
              </div>
            ) : data ? (
              <div className="grid flex-1 gap-4 p-4 sm:grid-cols-[248px_minmax(0,1.3fr)_360px] sm:p-5 lg:p-6">
                <aside className="rounded-[28px] border border-white/8 bg-black/20 p-4">
                  <div className="flex items-center gap-2 text-zinc-200">
                    <GitBranch className="h-4 w-4 text-sky-300" />
                    <h4 className="text-sm font-medium">Tracks</h4>
                  </div>
                  <p className="mt-2 text-xs leading-6 text-zinc-400">先按未来阶段或世界线收窄候选范围，再进入 {mode === 'history_node' ? '历史节点' : '直接章节'} 选择。</p>
                  <div className="mt-4 space-y-2">
                    {data.tracks.map((track) => {
                      const selected = selectedTrackKey === track.trackKey
                      return (
                        <button
                          key={track.trackKey}
                          type="button"
                          data-testid={`future-map-track-${track.trackKey}`}
                          onClick={() => handleTrackSelect(track.trackKey)}
                          className={cn(
                            'w-full rounded-[22px] border px-3 py-3 text-left transition',
                            selected ? 'border-sky-300/35 bg-sky-500/12 text-sky-50' : 'border-white/8 bg-white/[0.03] text-zinc-200 hover:bg-white/[0.06]'
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium">{track.phaseLabel || track.trackKey}</p>
                              <p className="mt-1 text-xs text-zinc-400">{track.trackKey}</p>
                            </div>
                            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-zinc-300">{track.eventCount}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </aside>

                <section className="rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.08),_transparent_40%),#0b0d12] p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{mode === 'history_node' ? 'History nodes' : 'Direct chapter anchors'}</p>
                      <h4 className="mt-1 text-lg font-semibold text-zinc-100">
                        {selectedTrackKey
                          ? `${mode === 'history_node' ? visibleEvents.length : visibleDirectChapterOptions.length} 个候选${mode === 'history_node' ? '节点' : '章节'}`
                          : '选择一个轨道'}
                      </h4>
                    </div>
                    <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] text-zinc-300">
                      authored vs derived provenance visible
                    </div>
                  </div>

                  {(mode === 'history_node' ? visibleEvents.length : visibleDirectChapterOptions.length) ? (
                    <div className="mt-4 grid gap-3 xl:grid-cols-2">
                      {mode === 'history_node'
                        ? visibleEvents.map((event) => (
                            <EventCard
                              key={event.id}
                              event={event}
                              selected={selectedEventId === event.id}
                              dimmed={Boolean(selectedTrackKey) && event.trackKey !== selectedTrackKey}
                              onClick={() => handleEventSelect(event)}
                            />
                          ))
                        : visibleDirectChapterOptions.map((option) => {
                            const selected = selectedChapterId === option.chapter.id
                            const sourceMeta = buildSourceMeta(option.event.sourceType)
                            return (
                              <button
                                key={option.chapter.id}
                                type="button"
                                data-testid={`future-map-direct-chapter-${option.chapter.chapterNo}`}
                                onClick={() => handleDirectChapterSelect(option)}
                                className={cn(
                                  'w-full rounded-[24px] border p-4 text-left transition',
                                  selected
                                    ? 'border-sky-300/35 bg-sky-500/12 shadow-[0_18px_60px_rgba(14,165,233,0.12)]'
                                    : 'border-white/8 bg-black/20 hover:border-white/15 hover:bg-white/[0.05]'
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{option.event.phaseLabel || option.event.trackKey}</p>
                                    <h4 className="mt-1 text-sm font-medium text-zinc-100">第 {option.chapter.chapterNo} 章 · {option.chapter.chapterTitle || option.event.title}</h4>
                                  </div>
                                  <div className="flex flex-wrap gap-2 text-[11px]">
                                    <span className={cn('rounded-full border px-2.5 py-1', sourceMeta.tone)}>{sourceMeta.label}</span>
                                    <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-zinc-300">
                                      置信度 {formatConfidence(option.event.confidence)}
                                    </span>
                                    {option.chapter.isPrimary ? (
                                      <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-zinc-300">primary</span>
                                    ) : null}
                                  </div>
                                </div>
                                <p className="mt-3 text-sm leading-6 text-zinc-300">{option.event.summary}</p>
                                {option.event.originalOutcome ? (
                                  <p className="mt-3 text-xs leading-6 text-zinc-500">原线结果：{option.event.originalOutcome}</p>
                                ) : null}
                              </button>
                            )
                          })}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-[24px] border border-dashed border-white/10 bg-black/20 p-5 text-sm leading-6 text-zinc-400">
                      当前轨道下还没有可跳转的未来{mode === 'history_node' ? '节点' : '章节'}候选。
                    </div>
                  )}
                </section>

                <aside className="rounded-[28px] border border-white/8 bg-black/20 p-4 sm:p-5">
                  <div className="flex items-center gap-2 text-zinc-200">
                    <Sparkles className="h-4 w-4 text-sky-300" />
                    <h4 className="text-sm font-medium">Confirm target</h4>
                  </div>
                  <p className="mt-2 text-xs leading-6 text-zinc-400">
                    {mode === 'history_node'
                      ? '历史节点模式会在你选中节点后立刻绑定所属章节，不再要求第二次选章节。'
                      : '直接章节模式会把章节锚点与现有摘要一起展示，选中后即可生成 Future Jump。'}
                  </p>

                  <div className="mt-4 rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{mode === 'history_node' ? 'Step 1 · History node' : 'Step 1 · Direct chapter'}</p>
                    {selectedEvent ? (
                      <div className="mt-2 space-y-2">
                        <p className="text-sm font-medium text-zinc-100">{mode === 'history_node' ? selectedEvent.title : `第 ${selectedChapter?.chapterNo ?? '—'} 章 · ${selectedChapter?.chapterTitle || selectedEvent.title}`}</p>
                        <p className="text-sm leading-6 text-zinc-300">{selectedEvent.summary}</p>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm leading-6 text-zinc-400">先从中间区域选中一个{mode === 'history_node' ? '历史节点' : '目标章节'}，右侧才会解锁生成确认。</p>
                    )}
                  </div>

                  <div className="mt-4 rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Step 2 · Resolved chapter</p>
                      <span className="text-[11px] text-zinc-500">{mode === 'history_node' ? 'auto-bound' : chapterOptions.length ? 'selected' : 'pending'}</span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {selectedChapter ? (
                        <div
                          data-testid="future-map-resolved-chapter"
                          className="rounded-[18px] border border-sky-300/20 bg-sky-500/10 px-3 py-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-sky-50">第 {selectedChapter.chapterNo} 章</p>
                              <p className="mt-1 text-xs text-sky-100/75">{selectedChapter.chapterTitle || selectedChapter.chapterId || '未命名章节锚点'}</p>
                            </div>
                            {selectedChapter.isPrimary ? <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-zinc-300">primary</span> : null}
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-[18px] border border-dashed border-white/10 bg-black/20 px-3 py-3 text-sm leading-6 text-zinc-400">
                          {selectedEvent ? '当前选择还没有可用的章节锚点。' : '尚未选中目标，章节锚点暂不可用。'}
                        </div>
                      )}
                    </div>
                  </div>

                  <label className="mt-4 block">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Optional direction</span>
                    <textarea
                      value={userDirection}
                      onChange={(event) => setUserDirection(event.target.value)}
                      rows={4}
                      placeholder="可选：给这次 Future Jump 一句额外方向，例如“先保留误会，再让救援更晚到来”。"
                      className="mt-2 w-full rounded-[20px] border border-white/10 bg-[#0b0d12] px-3 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
                    />
                  </label>

                  {createError ? (
                    <div data-testid="future-map-create-error" className="mt-4 rounded-[20px] border border-rose-400/20 bg-rose-500/10 p-3 text-sm leading-6 text-rose-100">{createError}</div>
                  ) : null}

                  <button
                    type="button"
                    data-testid="future-map-confirm"
                    disabled={!canConfirm}
                    onClick={() => {
                      void handleConfirm()
                    }}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[22px] bg-sky-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : canConfirm ? <Check className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                    确认并生成 Future Jump
                  </button>
                </aside>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
