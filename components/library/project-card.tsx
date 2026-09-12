"use client"

import Image from 'next/image'
import { LoaderCircle, Pencil, Trash2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import type { LibraryKnowledgeStatus } from '@/lib/library-knowledge-status'
import type { LibrarySummary } from '@/store/novel-store-types'

const knowledgeStatusStyles: Record<LibraryKnowledgeStatus, string> = {
  ready: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
  building: 'border-sky-400/20 bg-sky-400/10 text-sky-300',
  missing: 'border-zinc-400/15 bg-zinc-400/5 text-zinc-400',
  partial: 'border-amber-400/20 bg-amber-400/10 text-amber-300',
  paused: 'border-amber-400/20 bg-amber-400/10 text-amber-300',
  failed: 'border-rose-400/20 bg-rose-400/10 text-rose-300',
  unknown: 'border-zinc-400/15 bg-zinc-400/5 text-zinc-400',
}

export function ProjectCard({
  novel,
  onOpen,
  onEdit,
  onDelete,
  opening,
  deleting,
  disabled,
}: {
  novel: LibrarySummary
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
  opening?: boolean
  deleting?: boolean
  disabled?: boolean
}) {
  const { t } = useI18n()
  const knowledgeStatus = novel.knowledgeStatus ?? 'unknown'

  return (
    <article className="group relative rounded-[24px] border border-white/8 bg-white/[0.04] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.3)] backdrop-blur transition hover:border-white/12 hover:bg-white/[0.06] sm:rounded-[28px] sm:p-5">
      <div className="absolute right-7 top-7 z-10 flex gap-2 sm:right-8 sm:top-8">
        <button
          type="button"
          onClick={onEdit}
          disabled={deleting || opening || disabled}
          className="rounded-2xl border border-white/15 bg-black/55 p-2 text-zinc-100 shadow-lg backdrop-blur transition hover:bg-indigo-500/70 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={t('library.cardEditAria', { title: novel.title })}
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting || opening || disabled}
          className="rounded-2xl border border-rose-300/20 bg-black/55 p-2 text-rose-100 shadow-lg backdrop-blur transition hover:bg-rose-500/70 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={t('library.cardDeleteAria', { title: novel.title })}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={onOpen}
        disabled={opening || disabled}
        aria-busy={opening}
        className="block w-full text-left disabled:cursor-progress"
      >
          <div className="relative mb-4 h-40 overflow-hidden rounded-[20px] bg-[radial-gradient(circle_at_top_left,_rgba(124,156,255,0.45),_transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(168,85,247,0.25),_transparent_35%),linear-gradient(135deg,_rgba(255,255,255,0.05),_rgba(255,255,255,0.01))] sm:mb-5 sm:h-48 sm:rounded-[22px]">
            {novel.coverImage ? (
              <Image
                src={novel.coverImage}
                alt={t('library.metadataCoverPreview', { title: novel.title })}
                fill
                unoptimized
                sizes="(min-width: 1280px) 30vw, (min-width: 768px) 45vw, 100vw"
                className="object-cover transition duration-500 group-hover:scale-[1.025]"
              />
            ) : null}
          </div>

          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-zinc-100 group-hover:text-white">
                {novel.title}
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                {novel.author
                  ? t('library.cardAuthor', { author: novel.author })
                  : t('library.cardUnknownAuthor')}
              </p>
            </div>

            <div className="flex items-center border-t border-white/[0.06] pt-3">
              <span
                role="status"
                className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${knowledgeStatusStyles[knowledgeStatus]}`}
              >
                {knowledgeStatus === 'building' ? (
                  <LoaderCircle aria-hidden="true" className="h-3 w-3 motion-safe:animate-spin" />
                ) : (
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                )}
                {t('library.cardKnowledgeStatus', { status: t(`library.knowledgeStatus.${knowledgeStatus}`) })}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-zinc-500">
              <span>{t('library.cardChapterCount', { count: novel.chapterCount })}</span>
              <span>{t('library.cardWordCount', { count: novel.wordCount.toLocaleString() })}</span>
              <span>{novel.updatedAt}</span>
            </div>

            {opening ? (
              <div className="flex items-center gap-2 text-xs text-zinc-300">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin text-indigo-200" />
                <span>{t('library.cardOpening')}</span>
              </div>
            ) : null}
          </div>
      </button>
    </article>
  )
}
