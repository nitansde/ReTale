"use client"

import { forwardRef, useState, type ReactNode } from 'react'
import { Ellipsis, Trash2 } from 'lucide-react'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { useI18n } from '@/lib/i18n/provider'
import type { ChapterTimelineItem } from '@/lib/story-branch-types'
import type { Chapter } from '@/lib/types'
import { cn } from '@/lib/utils'

export const ChapterTimelineCard = forwardRef<HTMLButtonElement, {
  chapter: ChapterTimelineItem
  activeChapterId: string
  navigationTargetChapterId: string | null
  branchChapters: Chapter[]
  onSelectChapter: () => void
  onDeleteChapter: () => void
  onSelectBranchChapter: (chapter: Chapter) => void
  onDeleteBranchChapter: (chapter: Chapter) => void
  branchArtifacts?: ReactNode
}>((props, ref) => {
  const { t } = useI18n()
  const [menuChapter, setMenuChapter] = useState<'main' | Chapter | null>(null)
  const chapterSelected = props.activeChapterId === props.chapter.chapterId
  const branchChapterSelected = props.branchChapters.some((chapter) => chapter.id === props.activeChapterId)

  return (
    <article
      data-testid={`timeline-chapter-${props.chapter.chapterNo}`}
      data-navigation-current={chapterSelected || branchChapterSelected ? 'true' : undefined}
      className="relative z-10 space-y-2 border-b border-line/8 pb-1 lg:space-y-3 lg:border-0 lg:pb-0"
    >
      <div className="space-y-2">
        <div className="flex items-center gap-1 lg:items-start lg:gap-2">
          <button
            ref={ref}
            type="button"
            data-navigation-target={props.navigationTargetChapterId === props.chapter.chapterId ? 'true' : undefined}
            aria-current={chapterSelected ? "page" : undefined}
            onClick={props.onSelectChapter}
            className={cn(
              'min-h-16 min-w-0 flex-1 border-l-2 px-3 py-2.5 text-left transition lg:rounded-[22px] lg:border lg:py-3',
              chapterSelected ? 'border-violet-400 bg-violet-500/10 lg:border-violet-400/30' : 'border-transparent hover:bg-overlay/[0.04] lg:border-line/8 lg:bg-shade/20'
            )}
          >
            <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
              <span>{t('workspace.timeline.chapterLabel', { count: props.chapter.chapterNo })}</span>
              <span className="lg:hidden">{t('workspace.wordCount', { count: props.chapter.wordCount })}</span>
            </div>
            <p className="mt-1 break-words text-sm font-medium text-zinc-100">{props.chapter.title}</p>
            {props.chapter.summary ? (
              <p className="mt-2 break-words text-xs leading-5 text-zinc-400">{props.chapter.summary}</p>
            ) : null}
            <p className="mt-2 hidden text-xs text-zinc-500 lg:block">{t('workspace.wordCount', { count: props.chapter.wordCount })}</p>
          </button>
          <button type="button" aria-label={t('workspace.mobile.chapterOptions', { title: props.chapter.title })} onClick={() => setMenuChapter('main')} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-zinc-400 hover:bg-overlay/5 lg:hidden"><Ellipsis className="h-4 w-4" aria-hidden="true" /></button>
          <button
            type="button"
            onClick={props.onDeleteChapter}
            className="hidden rounded-2xl border border-rose-400/20 bg-rose-500/10 p-2 lg:inline-flex text-rose-200 transition hover:bg-rose-500/20"
            aria-label={t('workspace.timeline.deleteChapterAria', { title: props.chapter.title })}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {props.branchChapters.length ? (
          <div className="ml-3 border-l border-line/10 pl-3">
            {props.branchChapters.map((branch) => {
              const branchSelected = props.activeChapterId === branch.id
              return (
                <div key={branch.id} className="mt-2 flex items-start gap-2">
                  <button
                    type="button"
                    data-navigation-target={props.navigationTargetChapterId === branch.id ? 'true' : undefined}
                    onClick={() => props.onSelectBranchChapter(branch)}
                    className={cn(
                      'flex-1 rounded-2xl border px-3 py-3 text-left transition',
                      branchSelected ? 'border-fuchsia-400/30 bg-fuchsia-500/12' : 'border-line/8 bg-shade/20 hover:bg-overlay/[0.06]'
                    )}
                  >
                    <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{t('workspace.timeline.branchLabel', { label: branch.branchLabel ?? 'B' })}</p>
                    <p className="mt-1 break-words text-sm font-medium text-zinc-100">{branch.title}</p>
                  </button>
                  <button type="button" aria-label={t('workspace.mobile.chapterOptions', { title: branch.title })} onClick={() => setMenuChapter(branch)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-zinc-400 hover:bg-overlay/5 lg:hidden"><Ellipsis className="h-4 w-4" aria-hidden="true" /></button>
                  <button
                    type="button"
                    onClick={() => props.onDeleteBranchChapter(branch)}
                    className="hidden rounded-2xl border border-rose-400/20 bg-rose-500/10 p-2 lg:inline-flex text-rose-200 transition hover:bg-rose-500/20"
                    aria-label={t('workspace.timeline.deleteChapterAria', { title: branch.title })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>

      {props.branchArtifacts ? (
        <div className="ml-2 border-l border-line/10 pl-2">
          <div className="space-y-2">{props.branchArtifacts}</div>
        </div>
      ) : null}
      <DialogSurface open={menuChapter !== null} onClose={() => setMenuChapter(null)} closeLabel={t('common.close')} title={menuChapter === 'main' ? props.chapter.title : menuChapter?.title ?? ''} placement="bottom">
        <button type="button" aria-label={t('workspace.timeline.deleteChapterAria', { title: menuChapter === 'main' ? props.chapter.title : menuChapter?.title ?? '' })} onClick={() => {
          const target = menuChapter
          setMenuChapter(null)
          if (target === 'main') props.onDeleteChapter()
          else if (target) props.onDeleteBranchChapter(target)
        }} className="flex min-h-12 w-full items-center gap-3 text-sm text-rose-300"><Trash2 className="h-4 w-4" aria-hidden="true" />{t('workspace.timeline.deleteChapterAria', { title: menuChapter === 'main' ? props.chapter.title : menuChapter?.title ?? '' })}</button>
      </DialogSurface>
    </article>
  )
})

ChapterTimelineCard.displayName = 'ChapterTimelineCard'
