"use client"

import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { LanguageSwitcher } from '@/components/i18n/language-switcher'
import { ProjectGrid } from '@/components/library/project-grid'
import { useI18n } from '@/lib/i18n/provider'

export function LibraryPageClient() {
  const { t } = useI18n()

  return (
    <main className="min-h-screen bg-[#0a0c12] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm uppercase tracking-[0.28em] text-zinc-500">{t('library.eyebrow')}</p>
            <LanguageSwitcher />
          </div>
          <div className="mt-3 flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight">{t('library.title')}</h1>
              <p className="mt-2 text-sm text-zinc-400">{t('library.description')}</p>
            </div>
            <Link
              href="/writing-skills"
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl border border-violet-300/20 bg-violet-500/15 px-4 py-3 text-sm font-medium text-violet-100 transition hover:bg-violet-500/25"
            >
              <Sparkles className="h-4 w-4" /> {t('library.writingSkillsButton')}
            </Link>
          </div>
        </div>

        <ProjectGrid />
      </div>
    </main>
  )
}
