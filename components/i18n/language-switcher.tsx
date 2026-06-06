"use client"

import { Languages } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import type { Locale } from '@/lib/i18n/messages'
import { cn } from '@/lib/utils'

const LOCALES: Locale[] = ['zh', 'en']

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n()

  return (
    <div className="fixed right-4 top-4 z-[80] flex items-center gap-2 rounded-full border border-white/10 bg-[#0d1017]/90 px-2 py-2 text-xs text-zinc-200 shadow-[0_16px_50px_rgba(0,0,0,0.35)] backdrop-blur" data-testid="app-language-switcher">
      <span className="inline-flex items-center gap-2 px-2 text-zinc-400">
        <Languages className="h-3.5 w-3.5" />
        {t('language.label')}
      </span>
      <div className="flex rounded-full border border-white/10 bg-black/20 p-1">
        {LOCALES.map((item) => {
          const active = locale === item
          const label = t(`language.${item}`)
          return (
            <button
              key={item}
              type="button"
              data-testid={`app-language-option-${item}`}
              onClick={() => setLocale(item)}
              className={cn(
                'rounded-full px-3 py-1.5 transition',
                active ? 'bg-violet-500 text-white' : 'text-zinc-300 hover:bg-white/[0.08]'
              )}
              aria-pressed={active}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
