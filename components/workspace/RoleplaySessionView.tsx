"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, CornerDownRight, GitBranch, LoaderCircle, RefreshCcw, SendHorizonal, Settings2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { formatStoryBranchInstructionPreview } from '@/lib/story-branch-labels'
import type { RoleplayMessageRecord, RoleplaySessionDetail } from '@/lib/story-branch-types'
import { cn } from '@/lib/utils'

type RoleplayMessagePayload = RoleplayMessageRecord & {
  variantMetadata: {
    turnIndex: number
    variantIndex: number
    variantGroupId: string | null
  }
  forkMetadata: {
    parentMessageId: string | null
    forkedFromMessageId: string | null
  }
}

type RoleplaySessionDetailPayload = Omit<RoleplaySessionDetail, 'messages'> & {
  sourceSnapshot: {
    chapterId: string | null
    chapterNo: number
    chapterTitle: string | null
    timelineNodeId: string | null
    timelineNodeType: string | null
    selectedText: string
    textSnapshot: string
    selectedLineStart: number | null
    selectedLineEnd: number | null
  }
  messages: RoleplayMessagePayload[]
}

type PendingAssistantState = {
  content: string
  parentMessageId: string | null
  forkedFromMessageId: string | null
  mode: 'send' | 'regenerate'
}

async function loadRoleplaySessionDetail(input: {
  novelId: string
  branchId: string
  sessionId: string
}) {
  const params = new URLSearchParams({
    novelId: input.novelId,
    branchId: input.branchId,
  })
  const response = await fetch(`/api/roleplay/sessions/${input.sessionId}?${params.toString()}`, {
    cache: 'no-store',
  })
  const data = await response.json() as RoleplaySessionDetailPayload & { ok?: boolean; error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'Roleplay session load failed')
  }
  return data
}

async function appendRoleplayMessage(input: {
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  parentMessageId?: string | null
  forkedFromMessageId?: string | null
}) {
  const response = await fetch(`/api/roleplay/sessions/${input.sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  const data = await response.json() as RoleplayMessagePayload & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'Roleplay message append failed')
  }
  return data
}

async function createLatestAssistantVariant(input: {
  sessionId: string
  content: string
  parentMessageId?: string | null
  forkedFromMessageId?: string | null
}) {
  const response = await fetch(`/api/roleplay/sessions/${input.sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input,
      mode: 'latest-turn-variant',
      role: 'assistant',
    }),
  })

  const data = await response.json() as RoleplayMessagePayload & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'Roleplay variant creation failed')
  }
  return data
}

async function streamRoleplayReply(payload: Record<string, unknown>, onChunk: (chunk: string) => void) {
  const response = await fetch('/api/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, stream: true }),
  })

  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const payload = await response.json().catch(() => null) as { error?: string } | null
      throw new Error(payload?.error || 'Roleplay streaming request failed')
    }

    const text = await response.text()
    throw new Error(text || 'Roleplay streaming request failed')
  }

  if (!response.body) {
    throw new Error('Roleplay streaming response body is empty')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    if (chunk) onChunk(chunk)
  }
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

function resolveLatestRoleplayText(messages: Array<Pick<RoleplayMessageRecord, 'role' | 'content'>>) {
  const assistantMessage = [...messages].reverse().find((message) => message.role === 'assistant' && message.content.trim())
  return assistantMessage?.content.trim() || messages[messages.length - 1]?.content.trim() || ''
}

function normalizeMessage(message: RoleplayMessagePayload): RoleplayMessagePayload {
  return {
    ...message,
    variantMetadata: message.variantMetadata ?? {
      turnIndex: message.turnIndex,
      variantIndex: message.variantIndex,
      variantGroupId: message.variantGroupId,
    },
    forkMetadata: message.forkMetadata ?? {
      parentMessageId: message.parentMessageId,
      forkedFromMessageId: message.forkedFromMessageId,
    },
  }
}

function buildMessagePath(messagesById: Map<string, RoleplayMessagePayload>, messageId: string | null | undefined) {
  if (!messageId) return [] as RoleplayMessagePayload[]

  const chain: RoleplayMessagePayload[] = []
  const visited = new Set<string>()
  let cursor: string | null | undefined = messageId

  while (cursor && !visited.has(cursor)) {
    const message = messagesById.get(cursor)
    if (!message) break
    chain.push(message)
    visited.add(cursor)
    cursor = message.parentMessageId
  }

  return chain.reverse()
}

export function RoleplaySessionView(props: {
  novelId: string
  branchId: string
  sessionId: string
  anchorChapterNo: number
  nodeTitle?: string | null
  nodeSubtitle?: string | null
  readableLineageLabel?: string | null
  onMetricsChange?: (metrics: { currentText: string; inputTokens: number | null; outputTokens: number | null }) => void
}) {
  const { t } = useI18n()
  const { onMetricsChange } = props
  const [detail, setDetail] = useState<RoleplaySessionDetailPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [composerValue, setComposerValue] = useState('')
  const [forkMessageId, setForkMessageId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [pendingAssistant, setPendingAssistant] = useState<PendingAssistantState | null>(null)
  const chatCoreRef = useRef<HTMLElement | null>(null)
  const messageListRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const sendButtonRef = useRef<HTMLButtonElement | null>(null)

  const refreshDetail = useCallback(async () => {
    const nextDetail = await loadRoleplaySessionDetail({
      novelId: props.novelId,
      branchId: props.branchId,
      sessionId: props.sessionId,
    })
    setDetail({
      ...nextDetail,
      messages: nextDetail.messages.map(normalizeMessage),
    })
    return nextDetail
  }, [props.branchId, props.novelId, props.sessionId])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setLoading(true)
      setError('')

      try {
        const nextDetail = await loadRoleplaySessionDetail({
          novelId: props.novelId,
          branchId: props.branchId,
          sessionId: props.sessionId,
        })
        if (cancelled) return
        setDetail({
          ...nextDetail,
          messages: nextDetail.messages.map(normalizeMessage),
        })
      } catch (loadError) {
        if (cancelled) return
        setDetail(null)
        setError(loadError instanceof Error ? loadError.message : 'Roleplay session load failed')
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

  useEffect(() => {
    if (!detail) return
    onMetricsChange?.({
      currentText: resolveLatestRoleplayText(detail.messages),
      inputTokens: null,
      outputTokens: null,
    })
  }, [detail, onMetricsChange])

  useEffect(() => {
    const element = composerRef.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`
  }, [composerValue])

  useEffect(() => {
    const messageList = messageListRef.current
    if (!messageList) return
    messageList.scrollTop = messageList.scrollHeight
  }, [detail?.messages, pendingAssistant])

  useEffect(() => {
    if (typeof window === 'undefined' || window.innerWidth >= 1024) return
    const timer = window.setTimeout(() => {
      sendButtonRef.current?.scrollIntoView({ block: 'end' })
    }, 80)

    return () => {
      window.clearTimeout(timer)
    }
  }, [props.sessionId])

  const readableLabel = props.readableLineageLabel?.trim() || ''
  const resolvedTitle = readableLabel || detail?.title?.trim() || props.nodeTitle?.trim() || t('roleplay.defaultTitle', { count: props.anchorChapterNo })
  const instructionPreview = formatStoryBranchInstructionPreview(detail?.messages.find((message) => message.role === 'user')?.content ?? props.nodeSubtitle)
  const metaPills = useMemo(
    () => [
      readableLabel || null,
      instructionPreview ? t('roleplay.firstUserMessage', { text: instructionPreview }) : null,
      t('roleplay.sourceChapter', { count: detail?.sourceChapterNo ?? props.anchorChapterNo }),
      detail ? t('roleplay.messageCount', { count: detail.messages.length }) : null,
      detail ? t('roleplay.createdAt', { value: formatCreatedAt(detail.createdAt) }) : null,
    ].filter(Boolean) as string[],
    [detail, instructionPreview, props.anchorChapterNo, readableLabel, t]
  )
  const messagesById = useMemo(
    () => new Map((detail?.messages ?? []).map((message) => [message.id, message])),
    [detail?.messages]
  )
  const latestMessage = detail?.messages.at(-1) ?? null
  const latestAssistant = latestMessage?.role === 'assistant' ? latestMessage : null
  const forkMessage = forkMessageId ? messagesById.get(forkMessageId) ?? null : null
  const canSend = Boolean(detail && composerValue.trim() && !sending && !regenerating)
  const canRegenerate = Boolean(detail && latestAssistant && !sending && !regenerating)

  const buildRoleplayRequestPayload = useCallback((params: {
    historyMessages: RoleplayMessagePayload[]
    userInstruction: string
  }) => {
    if (!detail) return null
    return {
      novelId: props.novelId,
      branchId: props.branchId,
      chapterId: detail.sourceSnapshot.chapterId,
      selectedText: detail.sourceSnapshot.selectedText || detail.sourceSnapshot.textSnapshot,
      sourceText: detail.sourceSnapshot.textSnapshot || detail.sourceSnapshot.selectedText,
      operationType: 'roleplay',
      userInstruction: params.userInstruction,
      roleplayMessages: params.historyMessages.map((message) => ({ role: message.role, content: message.content })),
      scope: 'chapter',
      mode: 'dialogue',
      tone: 'dramatic',
      presetCompatRuntimeContext: {
        sessionPhase: detail.messages.length > 0 ? 'continue' : 'new_chat',
        hasImpersonationContext: true,
        namedTranscript: {
          kind: 'roleplay',
          userName: t('roleplay.userLabel'),
          assistantName: detail.title?.trim() || t('roleplay.defaultAssistantName'),
        },
      },
    }
  }, [detail, props.branchId, props.novelId, t])

  const handleSend = useCallback(async () => {
    if (!detail || !composerValue.trim()) return

    const targetFork = forkMessage
    const anchorMessage = targetFork ?? latestMessage
    const historyMessages = anchorMessage ? buildMessagePath(messagesById, anchorMessage.id) : []
    const userContent = composerValue.trim()

    setSending(true)
    setError('')

    try {
      const userMessage = normalizeMessage(await appendRoleplayMessage({
        sessionId: detail.id,
        role: 'user',
        content: userContent,
        parentMessageId: anchorMessage?.id ?? null,
        forkedFromMessageId: targetFork?.id ?? null,
      }))

      setDetail((current) => current
        ? {
            ...current,
            messages: [...current.messages, userMessage],
          }
        : current)
      setComposerValue('')
      setForkMessageId(null)
      setPendingAssistant({
        content: '',
        parentMessageId: userMessage.id,
        forkedFromMessageId: targetFork?.id ?? null,
        mode: 'send',
      })

      const payload = buildRoleplayRequestPayload({
        historyMessages,
        userInstruction: userContent,
      })
      if (!payload) {
        throw new Error('Roleplay session payload unavailable')
      }

      let streamed = ''
      await streamRoleplayReply(payload, (chunk) => {
        streamed += chunk
        setPendingAssistant((current) => current ? { ...current, content: streamed } : current)
      })

      const assistantContent = streamed.trim()
      if (!assistantContent) {
        throw new Error(t('roleplay.replyEmpty'))
      }

      await appendRoleplayMessage({
        sessionId: detail.id,
        role: 'assistant',
        content: assistantContent,
        parentMessageId: userMessage.id,
        forkedFromMessageId: targetFork?.id ?? null,
      })

      setPendingAssistant(null)
      await refreshDetail()
    } catch (sendError) {
      setPendingAssistant(null)
      setError(sendError instanceof Error ? sendError.message : t('errors.roleplayMessageAppendFailed'))
      await refreshDetail().catch(() => undefined)
    } finally {
      setSending(false)
    }
  }, [buildRoleplayRequestPayload, composerValue, detail, forkMessage, latestMessage, messagesById, refreshDetail])

  const handleRegenerate = useCallback(async () => {
    if (!detail || !latestAssistant) return

    const parentUser = latestAssistant.parentMessageId ? messagesById.get(latestAssistant.parentMessageId) ?? null : null
    if (!parentUser || parentUser.role !== 'user') {
      setError(t('roleplay.latestAssistantMissingUser'))
      return
    }

    setRegenerating(true)
    setError('')
    setPendingAssistant({
      content: '',
      parentMessageId: parentUser.id,
      forkedFromMessageId: latestAssistant.id,
      mode: 'regenerate',
    })

    try {
      const historyMessages = buildMessagePath(messagesById, parentUser.parentMessageId)
      const payload = buildRoleplayRequestPayload({
        historyMessages,
        userInstruction: parentUser.content,
      })
      if (!payload) {
        throw new Error('Roleplay regenerate payload unavailable')
      }

      let streamed = ''
      await streamRoleplayReply(payload, (chunk) => {
        streamed += chunk
        setPendingAssistant((current) => current ? { ...current, content: streamed } : current)
      })

      const assistantContent = streamed.trim()
      if (!assistantContent) {
        throw new Error(t('roleplay.regenerateReplyEmpty'))
      }

      await createLatestAssistantVariant({
        sessionId: detail.id,
        content: assistantContent,
        parentMessageId: parentUser.id,
        forkedFromMessageId: latestAssistant.id,
      })

      setPendingAssistant(null)
      await refreshDetail()
    } catch (regenerateError) {
      setPendingAssistant(null)
      setError(regenerateError instanceof Error ? regenerateError.message : t('errors.roleplayVariantCreationFailed'))
      await refreshDetail().catch(() => undefined)
    } finally {
      setRegenerating(false)
    }
  }, [buildRoleplayRequestPayload, detail, latestAssistant, messagesById, refreshDetail])

  return (
    <div className="space-y-4 overflow-x-hidden px-3 py-3 sm:px-6 sm:py-5" data-testid="workspace-roleplay-session-view">
      <section className="overflow-hidden rounded-[28px] border border-emerald-400/20 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.14),_transparent_40%),#0b0d12] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 max-w-3xl">
            <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-200/70">{t('roleplay.persistedEyebrow')}</p>
            <h3 className="mt-2 text-xl font-semibold tracking-tight text-zinc-100 sm:text-2xl">{resolvedTitle}</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-300 sm:mt-3 sm:leading-7">
              {detail?.subtitle?.trim() || props.nodeSubtitle?.trim() || t('roleplay.subtitleFallback')}
            </p>
            <div className="mt-4 hidden flex-wrap gap-2 text-[11px] text-zinc-300 sm:flex">
              {metaPills.map((pill) => (
                <span key={pill} className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">{pill}</span>
              ))}
            </div>
          </div>

          <div className="hidden w-full max-w-md space-y-2 sm:block">
            <div className="rounded-[22px] border border-emerald-300/20 bg-black/20 px-4 py-3 text-xs text-emerald-100">
              {t('roleplay.timelineReopen')}
            </div>
            <div className="rounded-[22px] border border-amber-300/20 bg-amber-500/10 px-4 py-3 text-xs leading-6 text-amber-100">
              {t('roleplay.chatOnlyHint')}
            </div>
          </div>
        </div>
      </section>

      {loading ? (
        <section className="rounded-[24px] border border-white/8 bg-black/20 p-5 text-sm text-zinc-300">
          <div className="flex items-center gap-2 text-zinc-100">
            <LoaderCircle className="h-4 w-4 animate-spin text-emerald-300" />
            {t('roleplay.loading')}
          </div>
        </section>
      ) : null}

      {!loading && error ? (
        <section className="rounded-[24px] border border-rose-400/20 bg-rose-500/10 p-5 text-sm leading-6 text-rose-100">
          {error}
        </section>
      ) : null}

      {!loading && detail ? (
        <section ref={chatCoreRef} className="flex h-[calc(100dvh-19rem)] min-h-[420px] flex-col overflow-hidden rounded-[28px] border border-white/8 bg-[#0b0d12] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] sm:min-h-[calc(100dvh-15rem)] sm:h-auto" data-testid="roleplay-chat-core">
          <div className="border-b border-white/8 px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('roleplay.sessionMessages')}</p>
                <p className="mt-1 text-sm text-zinc-300">{t('roleplay.mobileChatHint')}</p>
              </div>
              <button
                type="button"
                data-testid="roleplay-regenerate-last"
                disabled={!canRegenerate}
                onClick={() => void handleRegenerate()}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-300/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100 transition hover:bg-emerald-500/18 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {regenerating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                {t('roleplay.regenerateLatest')}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-zinc-300">{t('roleplay.messageCount', { count: detail.messages.length })}</span>
              <span
                className={cn(
                  'rounded-full border px-3 py-1',
                  forkMessage
                    ? 'border-amber-300/25 bg-amber-500/10 text-amber-100'
                    : 'border-white/10 bg-black/20 text-zinc-400'
                )}
                data-testid="roleplay-fork-anchor"
              >
                {forkMessage ? t('roleplay.nextForkFrom', { index: forkMessage.messageIndex }) : t('roleplay.nextFollowLatest')}
              </span>
              {forkMessage ? (
                <button
                  type="button"
                  onClick={() => setForkMessageId(null)}
                  className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-zinc-300 transition hover:bg-white/[0.08]"
                >
                   {t('roleplay.backToLatestBranch')}
                 </button>
              ) : null}
            </div>
          </div>

          <div ref={messageListRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-4">
            {detail.messages.map((message, index) => {
              const isUser = message.role === 'user'
              const isForkTarget = forkMessageId === message.id
              const canForkFromMessage = index < detail.messages.length - 1
              return (
                <button
                  key={message.id}
                  type="button"
                  data-testid={`roleplay-message-${index}`}
                  data-roleplay-message-id={message.id}
                  onClick={() => canForkFromMessage && setForkMessageId(message.id)}
                  disabled={!canForkFromMessage}
                  className={cn(
                    'block w-full min-w-0 rounded-[24px] border p-4 text-left transition',
                    canForkFromMessage ? 'cursor-pointer hover:border-amber-300/30 hover:bg-white/[0.03]' : 'cursor-default',
                    isUser
                      ? 'border-emerald-300/16 bg-emerald-500/10 text-emerald-50'
                      : 'border-white/8 bg-black/20 text-zinc-100',
                    isForkTarget && 'border-amber-300/38 bg-amber-500/12 text-amber-50'
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-current/75">
                        {isUser ? t('roleplay.userLabel') : t('roleplay.assistantLabel')} · #{message.messageIndex}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-current/65">
                        <span className="rounded-full border border-current/15 px-2.5 py-1">{t('roleplay.turn', { count: message.variantMetadata.turnIndex })}</span>
                        <span className="rounded-full border border-current/15 px-2.5 py-1">{t('roleplay.variant', { count: message.variantMetadata.variantIndex })}</span>
                        {message.forkMetadata.forkedFromMessageId ? (
                          <span className="rounded-full border border-current/15 px-2.5 py-1">{t('roleplay.forkFrom', { index: messagesById.get(message.forkMetadata.forkedFromMessageId)?.messageIndex ?? '?' })}</span>
                        ) : null}
                      </div>
                    </div>
                    <span className="text-[11px] text-current/60">{formatCreatedAt(message.createdAt)}</span>
                  </div>

                  {canForkFromMessage ? (
                    <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-current/15 px-3 py-1 text-[11px] text-current/70">
                      <GitBranch className="h-3.5 w-3.5" />
                      {t('roleplay.clickAsFork')}
                    </div>
                  ) : null}

                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">{message.content}</p>
                </button>
              )
            })}

            {pendingAssistant ? (
              <article className="rounded-[24px] border border-dashed border-emerald-300/28 bg-emerald-500/10 p-4 text-emerald-50">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-100/75">
                    {t('roleplay.assistantLabel')} · {pendingAssistant.mode === 'regenerate' ? t('roleplay.pendingRegenerate') : t('roleplay.pendingReplying')}
                  </p>
                  <LoaderCircle className="h-4 w-4 animate-spin text-emerald-200" />
                </div>
                {pendingAssistant.forkedFromMessageId ? (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-200/15 px-3 py-1 text-[11px] text-emerald-100/75">
                    <CornerDownRight className="h-3.5 w-3.5" />
                    {t('roleplay.forkFrom', { index: messagesById.get(pendingAssistant.forkedFromMessageId)?.messageIndex ?? '?' })}
                  </div>
                ) : null}
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">{pendingAssistant.content || t('roleplay.pendingReply')}</p>
              </article>
            ) : null}
          </div>

          <div className="sticky bottom-0 border-t border-white/8 bg-[linear-gradient(180deg,rgba(11,13,18,0.84),rgba(11,13,18,0.98))] px-3 pb-3 pt-3 backdrop-blur sm:px-4 sm:pb-4">
            <div className="mb-3 flex flex-wrap items-start gap-2" data-testid="roleplay-fork-point-visual-state">
              {forkMessage ? (
                <div className="inline-flex max-w-full items-start gap-2 rounded-[18px] border border-amber-300/22 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
                  <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 break-words">{t('roleplay.nextForkFrom', { index: forkMessage.messageIndex })}：{forkMessage.content.slice(0, 72)}{forkMessage.content.length > 72 ? '…' : ''}</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 rounded-[18px] border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-400">
                  <CornerDownRight className="h-3.5 w-3.5" />
                  {t('roleplay.nextFollowLatest')}
                </div>
              )}
            </div>

            <div className="rounded-[26px] border border-white/10 bg-black/30 p-3 shadow-[0_-10px_30px_rgba(0,0,0,0.18)]">
              <textarea
                ref={composerRef}
                value={composerValue}
                onChange={(event) => setComposerValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    if (canSend) {
                      void handleSend()
                    }
                  }
                }}
                placeholder={t('roleplay.composerPlaceholder')}
                className="max-h-[220px] min-h-[84px] w-full resize-none overflow-y-auto rounded-[20px] border border-white/10 bg-[#0f1218] px-4 py-3 text-sm leading-7 text-zinc-100 outline-none transition focus:border-emerald-300/35"
              />

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <details className="group max-w-full rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-xs text-zinc-400">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-zinc-300">
                    <Settings2 className="h-3.5 w-3.5" />
                    {t('roleplay.advancedSettings')}
                    <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
                  </summary>
                  <div className="mt-3 space-y-3 border-t border-white/8 pt-3">
                    <div>
                        <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{t('roleplay.sourceExcerpt')}</p>
                        <p className="mt-2 whitespace-pre-wrap break-words leading-6 text-zinc-300">{detail.sourceSnapshot.selectedText.trim() || detail.sourceSnapshot.textSnapshot.trim() || t('roleplay.sourceExcerptEmpty')}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{t('roleplay.sourceSnapshot')}</p>
                        <p className="mt-2 whitespace-pre-wrap break-words leading-6 text-zinc-300">{detail.sourceSnapshot.textSnapshot.trim() || t('roleplay.sourceSnapshotEmpty')}</p>
                      </div>
                  </div>
                </details>

                <button
                  ref={sendButtonRef}
                  type="button"
                  data-testid="roleplay-composer-send"
                  disabled={!canSend}
                  onClick={() => void handleSend()}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
                  {t('roleplay.send')}
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}
