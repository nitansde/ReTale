"use client"

import { forwardRef, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import type { ChapterTimelineItem } from '@/lib/story-branch-types'
import type { Chapter } from '@/lib/types'
import { cn } from '@/lib/utils'

export const ChapterTimelineCard = forwardRef<HTMLButtonElement, {
  chapter: ChapterTimelineItem
  activeChapterId: string
  branchChapters: Chapter[]
  onSelectChapter: () => void
  onDeleteChapter: () => void
  onSelectBranchChapter: (chapter: Chapter) => void
  onDeleteBranchChapter: (chapter: Chapter) => void
  branchArtifacts?: ReactNode
}>((props, ref) => {
  const { t } = useI18n()
  const chapterSelected = props.activeChapterId === props.chapter.chapterId

  return (
    <article data-testid={`timeline-chapter-${props.chapter.chapterNo}`} className="relative z-10 space-y-3">
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <button
            ref={ref}
            type="button"
            onClick={props.onSelectChapter}
            className={cn(
              'flex-1 rounded-[22px] border px-3 py-3 text-left transition',
              chapterSelected ? 'border-violet-400/30 bg-violet-500/12' : 'border-white/8 bg-black/20 hover:bg-white/[0.06]'
            )}
          >
            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{t('workspace.timeline.chapterLabel', { count: props.chapter.chapterNo })}</p>
            <p className="mt-1 text-sm font-medium text-zinc-100">{props.chapter.title}</p>
            <p className="mt-2 text-xs text-zinc-500">{t('workspace.wordCount', { count: props.chapter.wordCount })}</p>
          </button>
          <button
            type="button"
            onClick={props.onDeleteChapter}
            className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-2 text-rose-200 transition hover:bg-rose-500/20"
            aria-label={t('workspace.timeline.deleteChapterAria', { title: props.chapter.title })}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {props.branchChapters.length ? (
          <div className="ml-3 border-l border-white/10 pl-3">
            {props.branchChapters.map((branch) => {
              const branchSelected = props.activeChapterId === branch.id
              return (
                <div key={branch.id} className="mt-2 flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => props.onSelectBranchChapter(branch)}
                    className={cn(
                      'flex-1 rounded-2xl border px-3 py-3 text-left transition',
                      branchSelected ? 'border-fuchsia-400/30 bg-fuchsia-500/12' : 'border-white/8 bg-black/20 hover:bg-white/[0.06]'
                    )}
                  >
                    <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{t('workspace.timeline.branchLabel', { label: branch.branchLabel ?? 'B' })}</p>
                    <p className="mt-1 text-sm font-medium text-zinc-100">{branch.title}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onDeleteBranchChapter(branch)}
                    className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-2 text-rose-200 transition hover:bg-rose-500/20"
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
        <div className="ml-4 border-l border-white/10 pl-4">
          <div className="space-y-2">{props.branchArtifacts}</div>
        </div>
      ) : null}
    </article>
  )
})

ChapterTimelineCard.displayName = 'ChapterTimelineCard'
