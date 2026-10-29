"use client"

import { useState } from 'react'
import { useI18n } from '@/lib/i18n/provider'
import type { PublicVoiceSettings } from '@/lib/voice-chat'

export function RoleplayVoiceSettings({ settings, onSaved }: { settings: PublicVoiceSettings; onSaved: (settings: PublicVoiceSettings) => void }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(settings)
  const [keys, setKeys] = useState({ sonioxApiKey: '', qwenApiKey: '', fishApiKey: '' })
  const [cleared, setCleared] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const inputClass = 'mt-1 min-h-10 w-full rounded-lg border border-line/15 bg-inset px-3 text-sm text-zinc-100 outline-none focus:border-violet-400'
  const field = (key: 'sonioxModel' | 'qwenModel' | 'qwenUrl' | 'fishModel' | 'voiceId', label: string) => <label className="block text-xs text-zinc-400">{label}<input value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} className={inputClass} autoComplete="off" /></label>
  const keyField = (key: keyof typeof keys, configured: boolean) => <div>
    <label className="block text-xs text-zinc-400">{t('voice.key')}<input type="password" autoComplete="new-password" value={keys[key]} placeholder={t(configured ? 'voice.configured' : 'voice.notConfigured')} onChange={(event) => setKeys({ ...keys, [key]: event.target.value })} className={inputClass} /></label>
    {configured ? <label className="mt-2 flex min-h-8 items-center gap-2 text-xs text-zinc-500"><input type="checkbox" checked={Boolean(cleared[`clear_${key}`])} onChange={(event) => setCleared({ ...cleared, [`clear_${key}`]: event.target.checked })} />{t('voice.clearKey')}</label> : null}
  </div>
  const save = async () => {
    setSaving(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/settings/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, ...keys, ...cleared }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to save voice settings')
      onSaved(data); setDraft(data); setKeys({ sonioxApiKey: '', qwenApiKey: '', fishApiKey: '' }); setCleared({}); setMessage(t('voice.saved'))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save voice settings') }
    finally { setSaving(false) }
  }
  return <div className="max-h-[55dvh] space-y-4 overflow-y-auto overscroll-contain pr-1" data-testid="roleplay-voice-settings">
    <p className="text-xs leading-6 text-zinc-400">{t('voice.servicesHint')}</p>
    <fieldset disabled={saving} className="space-y-4 disabled:opacity-60">
      <label className="block text-xs text-zinc-400">{t('voice.asr')}<select className={inputClass} value={draft.asrProvider} onChange={(event) => setDraft({ ...draft, asrProvider: event.target.value as 'soniox' | 'qwen' })}><option value="soniox">Soniox</option><option value="qwen">Qwen</option></select></label>
      {draft.asrProvider === 'soniox' ? <>{keyField('sonioxApiKey', settings.sonioxConfigured)}{field('sonioxModel', t('voice.model'))}</> : <>
        {keyField('qwenApiKey', settings.qwenConfigured)}{field('qwenModel', t('voice.model'))}{field('qwenUrl', t('voice.endpoint'))}<p className="text-xs leading-5 text-zinc-500">{t('voice.endpointHint')}</p>
      </>}
      <div className="space-y-3 border-t border-line/10 pt-4"><p className="text-sm text-zinc-200">{t('voice.fish')}</p>{keyField('fishApiKey', settings.fishConfigured)}{field('fishModel', t('voice.model'))}{field('voiceId', t('voice.voiceId'))}<p className="text-xs leading-5 text-zinc-500">{t('voice.voiceIdHint')}</p></div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-zinc-400">{t('voice.language')}<select className={inputClass} value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.target.value as PublicVoiceSettings['language'] })}>{(['zh', 'en', 'auto'] as const).map((lang) => <option key={lang} value={lang}>{t(`voice.${lang}`)}</option>)}</select></label>
        <label className="text-xs text-zinc-400">{t('voice.silence')}<input type="number" min={300} max={2000} step={100} value={Number.isNaN(draft.silenceMs) ? '' : draft.silenceMs} onChange={(event) => setDraft({ ...draft, silenceMs: event.target.valueAsNumber })} className={inputClass} /></label>
      </div>
      <p className="text-xs leading-5 text-zinc-500">{t('voice.silenceHint')}</p>
      <label className="block text-xs text-zinc-400">{t('voice.thinkingLabel')}<select className={inputClass} value={draft.thinking} onChange={(event) => setDraft({ ...draft, thinking: event.target.value as PublicVoiceSettings['thinking'] })}><option value="low">{t('voice.thinkingLow')}</option><option value="off">{t('voice.thinkingOff')}</option><option value="default">{t('voice.thinkingDefault')}</option></select></label>
      <p className="text-xs text-zinc-500">{t('voice.thinkingHint')}</p>
      <button type="button" onClick={() => void save()} className="min-h-11 rounded-xl bg-violet-500 px-4 text-sm text-white disabled:opacity-40">{t('voice.save')}</button>
    </fieldset>
    {message ? <p role="status" className="text-sm text-emerald-300">{message}</p> : null}
    {error ? <p role="alert" className="break-words text-sm text-rose-300">{error}</p> : null}
  </div>
}
