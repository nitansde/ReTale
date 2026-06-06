"use client"

import { ProjectGrid } from '@/components/library/project-grid'
import { useI18n } from '@/lib/i18n/provider'

export function LibraryPageClient() {
  const { t } = useI18n()

  return (
    <main className="min-h-screen bg-[#0a0c12] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.28em] text-zinc-500">{t('library.eyebrow')}</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">{t('library.title')}</h1>
            <p className="mt-2 text-sm text-zinc-400">{t('library.description')}</p>
          </div>
        </div>

        <ProjectGrid />
      </div>
    </main>
  )
}
