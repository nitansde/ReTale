"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BookOpen, GitBranch, LoaderCircle, MessageCircle, Users, RefreshCcw, SendHorizonal, X } from 'lucide-react'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { useI18n } from '@/lib/i18n/provider'
import { normalizeSavedRoleplayReply, readRoleplayReplyContent } from '@/lib/roleplay-response'
import type { RoleplayMessageRecord, RoleplaySessionDetail } from '@/lib/story-branch-types'
import { resolveWorkspaceUserFacingError } from '@/lib/workspace-user-facing-errors'
import { cn } from '@/lib/utils'
import { RoleplayCastPicker } from './RoleplayCastPicker'
import { RoleplayScriptBlocks } from './RoleplayScriptBlocks'
import { parseRoleplayTurn, readGeneratedRoleplayScript, roleplayScriptText, roleplayTurnText, ROLEPLAY_DEFAULT_LENGTH, type RoleplayCast, type RoleplayTurn, type RoleplayScript, type RoleplayCharacterOption } from '@/lib/roleplay-script'

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
  characterOptions?: RoleplayCharacterOption[]
}

const ROLEPLAY_STICKY_BOTTOM_THRESHOLD = 80

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
  novelId: string
  branchId: string
  sessionId: string
  role: 'user' | 'assistant'
  turn?: RoleplayTurn
  script?: RoleplayScript
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
  script?: RoleplayScript
  novelId: string
  branchId: string
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

async function streamRoleplayReply(payload: Record<string, unknown>, onChunk: (chunk: string) => void, signal: AbortSignal) {
  const response = await fetch('/api/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, stream: true }),
    signal,
  })

  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const payload = await response.json().catch(() => null) as { error?: string } | null
      throw new Error(payload?.error || 'Roleplay streaming request failed')
    }

    throw new Error('Roleplay streaming request failed')
  }

  if (response.headers.get('content-type')?.includes('application/json')) {
    const data: unknown = await response.json().catch(() => null)
    const content = readRoleplayReplyContent(data)
    if (!content) throw new Error('Roleplay streaming response body is empty')
    onChunk(content)
    return
  }

  if (!response.body) {
    throw new Error('Roleplay streaming response body is empty')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      if (chunk) onChunk(chunk)
    }
    const tail = decoder.decode()
    if (tail) onChunk(tail)
  } finally {
    reader.releaseLock()
  }
}

function normalizeMessage(message: RoleplayMessagePayload): RoleplayMessagePayload {
  return {
    ...message,
    content: message.role === 'assistant' ? normalizeSavedRoleplayReply(message.content) : message.content,
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
  navigationActions?: ReactNode
  onMetricsChange?: (metrics: { currentText: string; inputTokens: number | null; outputTokens: number | null }) => void
}) {
  const { locale, t } = useI18n()
  const { onMetricsChange } = props
  const [detail, setDetail] = useState<RoleplaySessionDetailPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cast, setCast] = useState<RoleplayCast | null>(null)
  const [editingCast, setEditingCast] = useState(false)
  const [dialogue, setDialogue] = useState('')
  const [storyGuidance, setStoryGuidance] = useState('')
  const [targetCharacters, setTargetCharacters] = useState(ROLEPLAY_DEFAULT_LENGTH)
  const [forkMessageId, setForkMessageId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingScript, setPendingScript] = useState<RoleplayScript | null>(null)
  const [sourceOpen, setSourceOpen] = useState(false)
  const messageListRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const stickToBottomRef = useRef(true)
  const controllerRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)

  const refreshDetail = useCallback(async () => {
    const next = await loadRoleplaySessionDetail({ novelId: props.novelId, branchId: props.branchId, sessionId: props.sessionId })
    const normalized = { ...next, messages: next.messages.filter((message) => message.turn || message.script).map(normalizeMessage) }
    setDetail(normalized)
    return normalized
  }, [props.novelId, props.branchId, props.sessionId])

  useEffect(() => {
    let cancelled = false
    void loadRoleplaySessionDetail({ novelId: props.novelId, branchId: props.branchId, sessionId: props.sessionId }).then((next) => {
      if (cancelled) return
      const messages = next.messages.filter((message) => message.turn || message.script).map(normalizeMessage)
      setDetail({ ...next, messages })
      const lastTurn = [...messages].reverse().find((message) => message.turn)?.turn
      if (lastTurn) { setCast(lastTurn); setTargetCharacters(lastTurn.maxCharacters) }
    }).catch((reason) => {
      if (!cancelled) setError(resolveWorkspaceUserFacingError('roleplay-session-load', reason, locale))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; controllerRef.current?.abort() }
  }, [props.novelId, props.branchId, props.sessionId, locale])

  useEffect(() => {
    const last = detail?.messages.at(-1)
    onMetricsChange?.({ currentText: last?.content ?? '', inputTokens: null, outputTokens: null })
  }, [detail, onMetricsChange])

  useEffect(() => {
    const list = messageListRef.current
    if (list && stickToBottomRef.current) list.scrollTop = list.scrollHeight
  }, [detail?.messages, busy, pendingScript])

  useEffect(() => {
    const list = messageListRef.current
    if (!list || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { if (stickToBottomRef.current) list.scrollTop = list.scrollHeight })
    observer.observe(list)
    return () => observer.disconnect()
  }, [loading, detail?.id, cast, editingCast])

  const messagesById = useMemo(() => new Map((detail?.messages ?? []).map((message) => [message.id, message])), [detail?.messages])
  const latestMessage = detail?.messages.at(-1) ?? null
  const forkMessage = forkMessageId ? messagesById.get(forkMessageId) ?? null : null
  const turn = parseRoleplayTurn({ ...cast, storyGuidance, dialogue, maxCharacters: targetCharacters })
  const canSend = Boolean(turn && !busy)
  const retryUser = latestMessage?.role === 'user' && latestMessage.turn ? latestMessage : null
  const latestAssistant = latestMessage?.role === 'assistant' ? latestMessage : null
  const resolvedTitle = props.readableLineageLabel?.trim() || detail?.title || props.nodeTitle || t('roleplay.defaultTitle', { count: props.anchorChapterNo })

  const generate = async (user: RoleplayMessagePayload, regenerateFrom?: RoleplayMessagePayload) => {
    if (!detail || !user.turn) return
    const history = buildMessagePath(messagesById, user.parentMessageId)
    const controller = new AbortController()
    controllerRef.current = controller
    let content = ''
    await streamRoleplayReply({
      novelId: props.novelId, branchId: props.branchId, chapterId: detail.sourceSnapshot.chapterId,
      selectedText: detail.sourceSnapshot.selectedText || detail.sourceSnapshot.textSnapshot,
      sourceText: detail.sourceSnapshot.textSnapshot || detail.sourceSnapshot.selectedText,
      operationType: 'roleplay', roleplayTurn: user.turn, userInstruction: roleplayTurnText(user.turn),
      roleplayMessages: history.map((message) => ({ role: message.role, content: message.turn ? roleplayTurnText(message.turn) : message.script ? roleplayScriptText(message.script) : message.content })),
      scope: 'chapter', mode: 'dialogue', tone: 'dramatic',
      presetCompatRuntimeContext: {
        sessionPhase: history.length ? 'continue' : 'new_chat', hasImpersonationContext: true,
        namedTranscript: { kind: 'roleplay', userName: user.turn.playerName, assistantName: user.turn.counterpartName },
      },
    }, (chunk) => { content += chunk }, controller.signal)
    if (controller.signal.aborted) return
    const script = readGeneratedRoleplayScript(content, user.turn)
    if (!script) throw new Error(t('roleplay.invalidScript'))
    setPendingScript(script)
    const input = {
      novelId: props.novelId, branchId: props.branchId, sessionId: detail.id,
      content: roleplayScriptText(script), script, parentMessageId: user.id,
      forkedFromMessageId: regenerateFrom?.id ?? user.forkedFromMessageId,
    }
    if (regenerateFrom) await createLatestAssistantVariant(input)
    else await appendRoleplayMessage({ ...input, role: 'assistant' })
    await refreshDetail()
    setPendingScript(null)
  }

  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true); setError(''); stickToBottomRef.current = true
    try { await action() }
    catch (reason) {
      if (controllerRef.current?.signal.aborted) return
      setError(reason instanceof Error && reason.message === t('roleplay.invalidScript') ? reason.message : resolveWorkspaceUserFacingError('roleplay-stream', reason, locale))
      await refreshDetail().catch(() => undefined)
    } finally { setBusy(false); busyRef.current = false; setPendingScript(null) }
  }

  const handleSend = () => run(async () => {
    if (!detail || !turn) return
    const anchor = forkMessage ?? latestMessage
    const user = normalizeMessage(await appendRoleplayMessage({
      novelId: props.novelId, branchId: props.branchId, sessionId: detail.id,
      role: 'user', turn, content: turn.dialogue || turn.storyGuidance,
      parentMessageId: anchor?.id ?? null, forkedFromMessageId: forkMessage?.id ?? null,
    }))
    setDetail((current) => current ? { ...current, messages: [...current.messages, user] } : current)
    setDialogue(''); setStoryGuidance(''); setForkMessageId(null)
    await generate(user)
  })

  const handleRegenerate = () => run(async () => {
    const user = retryUser ?? (latestAssistant?.parentMessageId ? messagesById.get(latestAssistant.parentMessageId) : null)
    if (user?.turn) await generate(user, latestAssistant ?? undefined)
  })

  return <div className="flex min-h-0 flex-1 flex-col bg-surface" data-testid="workspace-roleplay-session-view">
    <header className="flex shrink-0 items-center gap-2 border-b border-line/8 px-3 py-2 sm:px-5 sm:py-3">
      {props.navigationActions}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold text-zinc-100" title={resolvedTitle}>{resolvedTitle}</h2>
        <p className="mt-1 truncate text-xs text-zinc-500">{cast ? `${cast.playerName} ↔ ${cast.counterpartName}` : t('roleplay.sourceChapter', { count: props.anchorChapterNo })}</p>
      </div>
      <button type="button" disabled={!detail || busy} onClick={() => setEditingCast(!editingCast)} aria-label={t('roleplay.chooseCast')} title={t('roleplay.chooseCast')} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-zinc-400 hover:bg-overlay/5 disabled:opacity-40"><Users className="h-4 w-4" /></button>
      <button type="button" disabled={!detail} onClick={() => setSourceOpen(true)} aria-label={t('roleplay.advancedSettings')} title={t('roleplay.advancedSettings')} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-zinc-400 hover:bg-overlay/5 disabled:opacity-40"><BookOpen className="h-4 w-4" /></button>
      <button type="button" data-testid="roleplay-regenerate-last" disabled={busy || !(latestAssistant || retryUser)} onClick={() => void handleRegenerate()} aria-label={t(retryUser ? 'roleplay.retry' : 'roleplay.regenerateLatest')} title={t(retryUser ? 'roleplay.retry' : 'roleplay.regenerateLatest')} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-zinc-400 hover:bg-overlay/5 disabled:opacity-40"><RefreshCcw className="h-4 w-4" /></button>
    </header>
    {loading ? <div className="flex flex-1 items-center justify-center gap-2 text-sm text-zinc-400" role="status"><LoaderCircle className="h-4 w-4 animate-spin" />{t('roleplay.loading')}</div> : null}
    {error ? <div role="alert" className="shrink-0 border-b border-rose-400/20 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">{error}</div> : null}
    {!loading && detail && (!cast || editingCast) ? <div className="min-h-0 flex-1 overflow-y-auto"><RoleplayCastPicker initial={cast} options={detail.characterOptions ?? []} onStart={(next) => { setCast(next); setEditingCast(false) }} /></div> : null}
    {!loading && detail && cast && !editingCast ? <section className="flex min-h-0 flex-1 flex-col" data-testid="roleplay-chat-core" aria-label={t('roleplay.sessionMessages')}>
      <div ref={messageListRef} data-testid="roleplay-message-list" onScroll={(event) => { const list = event.currentTarget; stickToBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= ROLEPLAY_STICKY_BOTTOM_THRESHOLD }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-8 sm:py-8">
        <div className="mx-auto max-w-3xl space-y-8">
          {!detail.messages.length ? <div className="mx-auto max-w-xl py-5" data-testid="roleplay-empty-state">
            <MessageCircle className="mb-4 h-7 w-7 text-violet-300" /><h3 className="text-lg font-medium text-zinc-100">{t('roleplay.emptyTitle')}</h3><p className="mt-2 text-sm leading-7 text-zinc-400">{t('roleplay.emptyHint')}</p>
            {detail.sourceSnapshot.selectedText ? <blockquote className="mt-5 line-clamp-3 border-l-2 border-violet-400/40 pl-4 text-sm leading-7 text-zinc-400">{detail.sourceSnapshot.selectedText}</blockquote> : null}
          </div> : null}
          {detail.messages.map((message, index) => <article key={message.id} data-testid={`roleplay-message-${index}`} data-roleplay-message-id={message.id} className={cn('min-w-0', forkMessageId === message.id && 'rounded-xl ring-1 ring-violet-400/40')}>
            {message.script ? <RoleplayScriptBlocks script={message.script} /> : message.turn ? <div className="ml-auto max-w-[90%] space-y-3 rounded-2xl border border-violet-400/20 bg-violet-500/10 px-4 py-3">
              {message.turn.storyGuidance ? <div><p className="mb-1 text-xs text-zinc-500">{t('roleplay.storyGuidance')}</p><p className="whitespace-pre-wrap break-words text-sm leading-7 text-zinc-400">{message.turn.storyGuidance}</p></div> : null}
              {message.turn.dialogue ? <div><p className="mb-1 text-xs text-violet-300">{message.turn.playerName} · {t('roleplay.you')} → {message.turn.counterpartName}</p><p className="whitespace-pre-wrap break-words text-[15px] leading-8 text-zinc-100">{message.turn.dialogue}</p></div> : null}
            </div> : null}
            {index < detail.messages.length - 1 && !busy ? <button type="button" aria-label={t('roleplay.forkFrom', { index: message.messageIndex })} aria-pressed={forkMessageId === message.id} onClick={() => { setForkMessageId(message.id); composerRef.current?.focus({ preventScroll: true }) }} className="mt-2 inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs text-zinc-500 hover:bg-overlay/5"><GitBranch className="h-3.5 w-3.5" />{t('roleplay.forkAction')}</button> : null}
          </article>)}
          {busy ? <div data-testid="roleplay-pending-reply" aria-live="polite" aria-busy="true">{pendingScript ? <RoleplayScriptBlocks script={pendingScript} /> : <p className="flex items-center gap-2 text-sm text-zinc-400"><LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />{t('roleplay.pendingReply')}</p>}</div> : null}
          {retryUser && !busy ? <button type="button" onClick={() => void handleRegenerate()} className="min-h-11 rounded-xl border border-violet-400/30 px-4 text-sm text-violet-300">{t('roleplay.retry')}</button> : null}
        </div>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); if (canSend) void handleSend() }} className="shrink-0 border-t border-line/8 bg-surface px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pb-4">
        <div className="mx-auto max-w-3xl">
          {forkMessage ? <div className="mb-2 flex items-center gap-2 text-xs text-violet-300" data-testid="roleplay-fork-point-visual-state"><GitBranch className="h-3.5 w-3.5" /><span data-testid="roleplay-fork-anchor">{t('roleplay.nextForkFrom', { index: forkMessage.messageIndex })}</span><button type="button" onClick={() => setForkMessageId(null)} aria-label={t('roleplay.backToLatestBranch')} className="ml-auto inline-flex h-8 w-8 items-center justify-center"><X className="h-4 w-4" /></button></div> : null}
          <div className="rounded-2xl border border-line/10 bg-inset p-3 focus-within:border-violet-400/40 sm:grid sm:grid-cols-2 sm:gap-3">
            <label className="block text-xs text-zinc-500">{t('roleplay.storyGuidance')}<textarea value={storyGuidance} onChange={(event) => setStoryGuidance(event.target.value)} rows={1} maxLength={10000} placeholder={t('roleplay.storyGuidancePlaceholder')} className="mt-1 block max-h-24 min-h-8 w-full resize-y bg-transparent text-sm leading-6 text-zinc-200 outline-none placeholder:text-zinc-500" /></label>
            <label className="mt-2 block border-t border-line/8 pt-2 text-xs text-violet-300 sm:mt-0 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">{t('roleplay.dialogueTo', { name: cast.counterpartName })}<textarea ref={composerRef} aria-label={t('roleplay.composerLabel')} value={dialogue} onChange={(event) => setDialogue(event.target.value)} rows={2} maxLength={10000} placeholder={t('roleplay.composerPlaceholder')} onKeyDown={(event) => { if (!event.nativeEvent.isComposing && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); if (canSend) void handleSend() } }} className="mt-1 block max-h-28 min-h-12 w-full resize-y bg-transparent text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-500" /></label>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <label className="flex min-w-0 items-center gap-2 text-xs text-zinc-500">{t('roleplay.lengthTarget')}<input type="number" min={100} max={4000} step={100} aria-label={t('roleplay.lengthTarget')} value={Number.isNaN(targetCharacters) ? '' : targetCharacters} onChange={(event) => setTargetCharacters(event.target.valueAsNumber)} className="min-h-10 w-20 rounded-lg border border-line/10 bg-inset px-2 text-sm text-zinc-200" /><span>{t('roleplay.characters')}</span></label>
            <button type="submit" data-testid="roleplay-composer-send" disabled={!canSend} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-violet-500 px-4 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-40">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}{t('roleplay.send')}</button>
          </div>
        </div>
      </form>
    </section> : null}
    <DialogSurface open={sourceOpen} onClose={() => setSourceOpen(false)} closeLabel={t('roleplay.closeSource')} title={t('roleplay.advancedSettings')} placement="right">
      {detail ? <div className="space-y-6 text-sm leading-7 text-zinc-300"><section><h3 className="mb-2 font-medium">{t('roleplay.sourceExcerpt')}</h3><p className="whitespace-pre-wrap break-words">{detail.sourceSnapshot.selectedText || t('roleplay.sourceExcerptEmpty')}</p></section><section><h3 className="mb-2 font-medium">{t('roleplay.sourceSnapshot')}</h3><p className="whitespace-pre-wrap break-words">{detail.sourceSnapshot.textSnapshot || t('roleplay.sourceSnapshotEmpty')}</p></section></div> : null}
    </DialogSurface>
  </div>
}
