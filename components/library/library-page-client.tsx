"use client"

import { LanguageSwitcher } from '@/components/i18n/language-switcher'
import { ProjectGrid } from '@/components/library/project-grid'
import { useI18n } from '@/lib/i18n/provider'

export function LibraryPageClient() {
  const { t } = useI18n()

  return (
    <main className="min-h-screen bg-[#0a0c12] px-4 py-6 text-zinc-100 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm uppercase tracking-[0.28em] text-zinc-500">{t('library.eyebrow')}</p>
            <LanguageSwitcher />
          </div>
          <div className="mt-3">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('library.title')}</h1>
              <p className="mt-2 max-w-2xl text-sm text-zinc-400">{t('library.description')}</p>
            </div>
          </div>
        </div>

        <ProjectGrid />
      </div>
    </main>
  )
}
