"use client"

import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, RefreshCcw } from 'lucide-react'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { useI18n } from '@/lib/i18n/provider'
import type { RoleplayGenerationOptions, RoleplayPromptPreview } from '@/lib/roleplay-generation'
import { WRITING_SKILL_RUNTIME_EXAMPLE_COUNTS } from '@/lib/writing-skill-defaults'
import type { WritingSkillCard } from '@/lib/writing-skill-types'
import { cn } from '@/lib/utils'

export function RoleplayGenerationPanel(props: {
  panel: 'context' | 'skills' | null
  request: Record<string, unknown> | null
  options: RoleplayGenerationOptions
  onChange: (options: RoleplayGenerationOptions) => void
  onClose: () => void
  onSnapshot: (id: string | null) => void
}) {
  const { t } = useI18n()
  const [cards, setCards] = useState<WritingSkillCard[]>([])
  const [cardsLoading, setCardsLoading] = useState(false)
  const [cardsError, setCardsError] = useState('')
  const [preview, setPreview] = useState<{ key: string; data: RoleplayPromptPreview } | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(null)
  const [revision, setRevision] = useState(0)
  const contextSnapshotRef = useRef<string | null>(null)
  const requestJson = JSON.stringify(props.request)
  const previewKey = `${revision}:${requestJson}`
  const { panel, onSnapshot } = props
  const currentPreview = preview?.key === previewKey ? preview.data : null
  const currentError = error?.key === previewKey ? error.message : ''

  useEffect(() => {
    if (panel !== 'skills') return
    const controller = new AbortController()
    const load = async () => {
      setCardsLoading(true); setCardsError('')
      try {
        const response = await fetch('/api/writing-skills?status=ACTIVE', { cache: 'no-store', signal: controller.signal })
        const data = await response.json()
        if (!response.ok || !Array.isArray(data.cards)) throw new Error(data.error || t('roleplay.skillsLoadFailed'))
        if (!controller.signal.aborted) setCards(data.cards)
      } catch (reason) {
        if (!controller.signal.aborted) setCardsError(reason instanceof Error ? reason.message : t('roleplay.skillsLoadFailed'))
      } finally { if (!controller.signal.aborted) setCardsLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [panel, revision, t])

  useEffect(() => {
    // Prepare context while the user composes, just like the rewrite workspace.
    // Opening, closing or switching panels must not restart an in-flight request.
    if (requestJson === 'null') return
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(async () => {
      timeout = setTimeout(() => {
        setError({ key: previewKey, message: t('roleplay.previewTimeout') })
        controller.abort()
      }, 30_000)
      try {
        const response = await fetch('/api/roleplay/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...JSON.parse(requestJson), contextSnapshotId: contextSnapshotRef.current }), signal: controller.signal })
        const data = await response.json()
        if (!response.ok || data.ok !== true || !Array.isArray(data.promptBlocks)) throw new Error(data.error || t('workspace.action.contextPreviewFailed'))
        if (!controller.signal.aborted) {
          setPreview({ key: previewKey, data })
          contextSnapshotRef.current = data.contextSnapshotId
          onSnapshot(data.contextSnapshotId)
        }
      } catch (reason) {
        if (!controller.signal.aborted) setError({ key: previewKey, message: reason instanceof Error ? reason.message : t('workspace.action.contextPreviewFailed') })
      } finally {
        clearTimeout(timeout)
      }
    }, 250)
    return () => { clearTimeout(timer); clearTimeout(timeout); controller.abort() }
  }, [requestJson, previewKey, onSnapshot, t])

  const refresh = () => {
    contextSnapshotRef.current = null
    onSnapshot(null)
    setRevision((value) => value + 1)
  }

  const toggleBlock = (id: string, enabled: boolean) => props.onChange({ ...props.options, disabledBlockIds: enabled ? props.options.disabledBlockIds.filter((item) => item !== id) : [...new Set([...props.options.disabledBlockIds, id])] })
  const blockDetails = (block: RoleplayPromptPreview['promptBlocks'][number]) => <article key={block.id} className="rounded-2xl border border-line/10 bg-inset p-3" data-testid={`roleplay-context-block-${block.id}`}>
    <label className="flex min-h-9 items-center justify-between gap-3 text-sm text-zinc-200">
      <span>{block.label}</span>
      <input type="checkbox" aria-label={block.label} checked={block.required || !props.options.disabledBlockIds.includes(block.id)} disabled={block.required} onChange={(event) => toggleBlock(block.id, event.target.checked)} className="h-4 w-4 shrink-0 accent-violet-500" />
    </label>
    <p className={cn('mb-2 text-xs', block.trimmed ? 'text-amber-300' : 'text-zinc-500')}>
      {t(block.required ? 'roleplay.contextRequired' : block.trimmed ? 'roleplay.contextTrimmed' : block.enabled ? 'roleplay.contextEnabled' : 'roleplay.contextDisabled')}
    </p>
    <details><summary className="cursor-pointer text-xs text-zinc-400">{t('roleplay.viewContent')}</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-zinc-300 [overflow-wrap:anywhere]">{block.content}</p></details>
  </article>

  return <DialogSurface open={Boolean(panel)} onClose={props.onClose} closeLabel={t(panel === 'skills' ? 'roleplay.closeSkills' : 'roleplay.closeContext')} title={t(panel === 'skills' ? 'roleplay.writingSkills' : 'workspace.shell.advancedContext')} description={t(panel === 'skills' ? 'roleplay.skillsHint' : 'roleplay.contextHint')} placement="right" className="sm:w-[min(42rem,90vw)] sm:max-w-2xl" mobileFullscreen>
    {panel === 'skills' ? <div className="mb-5 space-y-4">
      <div className="flex items-center justify-between gap-3"><p className="text-sm text-zinc-400">{t('workspace.shell.writingSkillLabel')}</p><a href="/writing-skills" target="_blank" rel="noreferrer" className="text-xs text-violet-300 underline">{t('roleplay.manageSkills')}</a></div>
      {cardsLoading ? <p role="status" className="text-sm text-zinc-400">{t('workspace.shell.writingSkillLoading')}</p> : cardsError ? <p role="alert" className="text-sm text-rose-300">{cardsError}</p> : cards.length ? <fieldset className="space-y-2"><legend className="sr-only">{t('workspace.shell.writingSkillLabel')}</legend>{cards.map((card) => <label key={card.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line/10 bg-inset p-3 text-sm">
        <input type="checkbox" checked={props.options.writingSkillCardIds.includes(card.id)} onChange={(event) => props.onChange({ ...props.options, writingSkillCardIds: event.target.checked ? [...props.options.writingSkillCardIds, card.id] : props.options.writingSkillCardIds.filter((id) => id !== card.id), disabledBlockIds: props.options.disabledBlockIds.filter((id) => id !== `writing-skill:${card.id}`) })} className="mt-1 h-4 w-4 shrink-0 accent-violet-500" />
        <span><span className="block text-zinc-100">{card.title}</span><span className="mt-1 block text-xs leading-6 text-zinc-400">{card.summary}</span></span>
      </label>)}</fieldset> : <p className="text-sm text-zinc-400">{t('workspace.shell.writingSkillNone')}</p>}
      {props.options.writingSkillCardIds.filter((id) => !cards.some((card) => card.id === id)).map((id) => <button key={id} type="button" onClick={() => props.onChange({ ...props.options, writingSkillCardIds: props.options.writingSkillCardIds.filter((item) => item !== id) })} className="block text-xs text-rose-300">{t('roleplay.removeUnavailableSkill', { id })}</button>)}
      <label className="flex items-center justify-between gap-3 text-sm text-zinc-300">{t('workspace.shell.writingSkillExampleCount')}<select value={props.options.writingSkillExampleCount} onChange={(event) => props.onChange({ ...props.options, writingSkillExampleCount: Number(event.target.value) })} disabled={!props.options.writingSkillCardIds.length} className="min-h-10 rounded-xl border border-line/10 bg-inset px-3 text-zinc-200">{WRITING_SKILL_RUNTIME_EXAMPLE_COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
    </div> : null}
    <div className="mb-3 flex items-center justify-between gap-3"><p className="text-sm font-medium text-zinc-200">{t('roleplay.nextTurnContext')}</p><button type="button" onClick={refresh} className="inline-flex min-h-10 items-center gap-2 text-xs text-zinc-400"><RefreshCcw className="h-3.5 w-3.5" />{t('graph.refreshContext')}</button></div>
    {!props.request ? <p role="alert" className="text-sm text-zinc-400">{t('roleplay.previewInvalidInput')}</p> : !currentPreview && !currentError ? <p role="status" className="mb-3 flex items-center gap-2 text-sm text-zinc-400"><LoaderCircle className="h-4 w-4 animate-spin" />{t('workspace.shell.loadingContextEvidence')}</p> : null}
    {currentError ? <p role="alert" className="mb-3 text-sm text-rose-300">{currentError}</p> : null}
    {currentPreview?.warnings?.map((warning) => <p key={warning} role="status" className="mb-3 text-xs leading-6 text-amber-400">{warning}</p>)}
    <div className="space-y-3">{(currentPreview ?? preview?.data)?.promptBlocks.filter((block) => panel !== 'skills' || block.id.startsWith('writing-skill:')).map(blockDetails)}</div>
    {currentPreview ? <details className="mt-5 rounded-2xl border border-violet-400/20 bg-violet-500/5 p-3" data-testid="roleplay-final-prompt"><summary className="min-h-8 cursor-pointer text-sm font-medium text-violet-300">{t('roleplay.finalPrompt')}</summary><p className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-zinc-300 [overflow-wrap:anywhere]">{currentPreview.systemPrompt}{'\n\n'}{currentPreview.userPrompt}</p></details> : null}
  </DialogSurface>
}
