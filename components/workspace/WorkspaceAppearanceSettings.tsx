'use client'

import { RotateCcw, Type } from 'lucide-react'
import { useFontPreferences } from '@/components/FontPreferencesProvider'
import { DEFAULT_FONT_PREFERENCES, FONT_OPTIONS, getFontFamily, isFontId } from '@/lib/font-preferences'
import { useI18n } from '@/lib/i18n/provider'

export function WorkspaceAppearanceSettings() {
  const { t } = useI18n()
  const { preferences, setPreferences, persistenceError } = useFontPreferences()
  const isDefault = preferences.interfaceFont === DEFAULT_FONT_PREFERENCES.interfaceFont
    && preferences.readingFont === DEFAULT_FONT_PREFERENCES.readingFont

  return (
    <section aria-label={t('appearance.title')} className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="rounded-2xl border border-violet-300/20 bg-violet-500/10 p-3 text-violet-200">
          <Type className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-base font-medium text-zinc-100">{t('appearance.title')}</h3>
          <p className="mt-1 text-sm leading-6 text-zinc-400">{t('appearance.description')}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {(['interfaceFont', 'readingFont'] as const).map((field) => (
          <div key={field} className="min-w-0 rounded-[24px] border border-white/10 bg-[#0b0d12] p-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-zinc-200">{t(`appearance.${field}`)}</span>
              <span className="mb-4 block text-xs leading-5 text-zinc-400">{t(`appearance.${field}Hint`)}</span>
              <select
                aria-label={t(`appearance.${field}`)}
                value={preferences[field]}
                onChange={(event) => {
                  if (isFontId(event.target.value)) setPreferences({ ...preferences, [field]: event.target.value })
                }}
                className="min-h-11 w-full rounded-xl border border-white/15 bg-[#11141c] px-3 py-2 text-sm text-zinc-100 outline-none focus-visible:border-violet-300/60 focus-visible:ring-2 focus-visible:ring-violet-300/30"
              >
                {(['chinese', 'english'] as const).map((group) => (
                  <optgroup key={group} label={t(`appearance.${group}`)}>
                    {FONT_OPTIONS.filter((font) => font.group === group).map((font) => (
                      <option key={font.id} value={font.id}>{font.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="mb-3 text-[11px] tracking-wide text-zinc-500">{t('appearance.preview')}</p>
              <div style={{ fontFamily: getFontFamily(preferences[field]) }} className="space-y-2 text-base leading-8 text-zinc-200">
                <p lang="zh-CN">每一个故事，都有新的可能。</p>
                <p lang="en">Every story begins with a possibility.</p>
                <p className="text-sm text-zinc-400">Aa 0123456789 · 你好，世界</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs leading-5 text-zinc-400">{t('appearance.fontAvailability')}</p>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
        <p role="status" className={`text-xs leading-5 ${persistenceError ? 'text-amber-200' : 'text-zinc-400'}`}>
          {t(persistenceError ? 'appearance.saveFailed' : 'appearance.autoSaved')}
        </p>
        <button
          type="button"
          onClick={() => setPreferences(DEFAULT_FONT_PREFERENCES)}
          disabled={isDefault}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 px-3 text-xs text-zinc-300 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70 disabled:cursor-default disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          {t('appearance.reset')}
        </button>
      </div>
    </section>
  )
}
