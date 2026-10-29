"use client"

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LoaderCircle, Mic, MicOff, Phone, PhoneOff, Settings2, Square } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import type { PublicVoiceSettings } from '@/lib/voice-chat'
import { VoiceCall, type VoiceCallState, type VoiceReplyRunner } from '@/lib/voice-call'
import { RoleplayVoiceSettings } from './RoleplayVoiceSettings'

export function RoleplayVoicePanel(props: {
  names: string[]
  disabled: boolean
  onActiveChange: (active: boolean) => void
  onReply: (text: string) => void
  onTurn: (text: string, runReply: VoiceReplyRunner) => Promise<void>
}) {
  const { t } = useI18n()
  const latest = useRef(props)
  useLayoutEffect(() => { latest.current = props })
  const call = useRef<VoiceCall | null>(null)
  const [state, setState] = useState<VoiceCallState>('idle')
  const [muted, setMuted] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [settings, setSettings] = useState<PublicVoiceSettings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [secure] = useState(() => typeof window !== 'undefined' && Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia))
  const mounted = useRef(true)
  const active = state !== 'idle'
  const configured = Boolean(settings && settings.fishConfigured && settings.voiceId && (settings.asrProvider === 'soniox' ? settings.sonioxConfigured : settings.qwenConfigured))
  useEffect(() => {
    const abort = new AbortController()
    void fetch('/api/settings/voice', { cache: 'no-store', signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Unable to load voice settings')
      setSettings(await response.json())
    }).catch((reason: unknown) => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load voice settings') })
    return () => abort.abort()
  }, [reload])
  useEffect(() => {
    mounted.current = true
    const end = () => { void call.current?.end() }
    window.addEventListener('pagehide', end)
    return () => { mounted.current = false; window.removeEventListener('pagehide', end); end(); latest.current.onActiveChange(false) }
  }, [])
  const start = async () => {
    if (call.current || props.disabled || !configured) return
    setError(''); setMuted(false); setTranscript(''); setShowSettings(false)
    props.onActiveChange(true)
    const next = new VoiceCall({
      state: (value) => {
        if (!mounted.current) return
        setState(value)
        if (value === 'thinking') setError('') // A new turn replaces the last turn's error.
        if (value === 'idle') { call.current = null; latest.current.onActiveChange(false); latest.current.onReply('') }
      },
      transcript: (text) => { if (mounted.current) setTranscript(text) },
      reply: (text) => { if (mounted.current) latest.current.onReply(text) },
      error: (message) => { if (mounted.current) setError(message) },
      turn: (text, runReply) => latest.current.onTurn(text, runReply),
    })
    call.current = next
    try { await next.start(props.names) }
    catch (reason) {
      if (mounted.current) { setError(reason instanceof Error ? reason.message : 'Unable to start microphone'); await next.end() }
    }
  }
  return <div className="space-y-3 rounded-2xl border border-violet-400/20 bg-violet-500/5 p-3 sm:p-4" data-testid="roleplay-voice-panel">
    <div className="flex items-center justify-between gap-3">
      <p role="status" className="flex items-center gap-2 text-sm text-violet-200">{state === 'connecting' || state === 'thinking' || state === 'ending' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}{muted && active ? t('voice.muted') : t(`voice.${state}`)}</p>
      <button type="button" disabled={active} aria-label={t('voice.settings')} aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs text-zinc-400 hover:bg-overlay/5 disabled:opacity-40"><Settings2 className="h-4 w-4" />{t('voice.settings')}</button>
    </div>
    {!active ? <p className="text-xs leading-5 text-zinc-400">{t('voice.hint')}</p> : null}
    {!secure ? <p className="text-xs leading-5 text-amber-300">{t('voice.secureRequired')}</p> : null}
    {error ? <p role="alert" className="break-words text-sm text-rose-300">{error}</p> : null}
    {!settings ? <div className="text-xs text-zinc-400">{error ? <button type="button" onClick={() => { setError(''); setReload(reload + 1) }} className="min-h-10 underline">{t('voice.retry')}</button> : t('voice.loading')}</div> : null}
    {settings && !configured && !showSettings ? <button type="button" onClick={() => setShowSettings(true)} className="text-left text-xs leading-5 text-amber-200 underline">{t('voice.setupNeeded')}</button> : null}
    {showSettings && settings ? <RoleplayVoiceSettings settings={settings} onSaved={setSettings} /> : null}
    {active && transcript ? <p className="max-h-20 overflow-y-auto break-words text-sm leading-6 text-zinc-300"><span className="mr-2 text-xs text-zinc-500">{t('voice.transcript')}</span>{transcript}</p> : null}
    <div className="flex flex-wrap items-center gap-2">
      {active ? <>
        <button type="button" disabled={state === 'ending'} onClick={() => void call.current?.end()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-rose-500/15 px-4 text-sm text-rose-200 disabled:opacity-40"><PhoneOff className="h-4 w-4" />{t('voice.end')}</button>
        <button type="button" disabled={state === 'connecting' || state === 'ending'} aria-label={t(muted ? 'voice.unmute' : 'voice.mute')} aria-pressed={muted} onClick={() => { call.current?.setMuted(!muted); setMuted(!muted) }} className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-line/10 text-zinc-300 disabled:opacity-40">{muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}</button>
        <button type="button" disabled={!['thinking', 'speaking'].includes(state)} onClick={() => call.current?.interrupt()} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-xs text-zinc-400 disabled:opacity-40"><Square className="h-3.5 w-3.5" />{t('voice.interrupt')}</button>
      </> : <button type="button" disabled={props.disabled || !configured || !secure} onClick={() => void start()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-500 px-4 text-sm text-white disabled:opacity-40"><Phone className="h-4 w-4" />{t('voice.start')}</button>}
    </div>
  </div>
}
