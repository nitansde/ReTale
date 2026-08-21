"use client"

import type { Dispatch, SetStateAction } from 'react'
import { X } from 'lucide-react'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { IconButton } from '@/components/ui/IconButton'
import { StoryTimeline } from '@/components/timeline/StoryTimeline'
import { useDesktopWorkspaceLayout } from '@/components/workspace/use-desktop-workspace-layout'
import { useI18n } from '@/lib/i18n/provider'
import type { ChapterTimelineItem, StoryTimelineBranchNode, StoryTimelineEdge, TimelineSelection } from '@/lib/story-branch-types'
import type { Chapter } from '@/lib/types'

type WorkspaceChapterNavProps = {
  leftPanelOpen: boolean
  onClose: () => void
  onCreateChapter: () => void
  sortedChapters: Chapter[]
  chapterListTarget: number
  currentNovelId: string
  setChapterListState: Dispatch<SetStateAction<Record<string, number>>>
  storyTimelineError: string
  branchNodes: StoryTimelineBranchNode[]
  edges: StoryTimelineEdge[]
  timelineChapterById: Map<string, ChapterTimelineItem>
  currentChapterId: string
  activeSelection: TimelineSelection | null
  branchChaptersByParentId: Map<string, Chapter[]>
  onSelectionChange: (selection: TimelineSelection) => void
  onDeleteChapter: (chapterId: string) => void
  deletingBranchNodeId: string | null
  onDeleteBranchNode: (node: StoryTimelineBranchNode) => void
}

export function WorkspaceChapterNav(props: WorkspaceChapterNavProps) {
  const { t } = useI18n()
  const desktop = useDesktopWorkspaceLayout()
  const mainlineChapters = props.sortedChapters.filter((chapter) => !chapter.parentChapterId)
  const visibleChapters = mainlineChapters.slice(0, props.chapterListTarget)
  const visibleAnchorChapterNos = new Set(visibleChapters.map((chapter) => chapter.order))
  const visibleBranchNodes = props.branchNodes.filter((node) => visibleAnchorChapterNos.has(node.anchorChapterNo))
  const visibleNodeIds = new Set(visibleBranchNodes.map((node) => node.id))
  const hiddenCount = Math.max(0, mainlineChapters.length - visibleChapters.length)

  const content = (
    <>
      <button
        type="button"
        onClick={() => {
          props.onCreateChapter()
          props.onClose()
        }}
        className="mb-4 min-h-11 w-full rounded-2xl bg-violet-500 px-4 text-sm font-medium text-white transition hover:bg-violet-400"
      >
        {t('chapterNav.newChapter')}
      </button>
      <section className="space-y-3 rounded-[24px] border border-white/8 bg-white/[0.03] p-3">
        <p className="px-2 text-xs text-zinc-500">{t('chapterNav.chapterCount', { count: mainlineChapters.length })}</p>
        {props.storyTimelineError ? (
          <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">{props.storyTimelineError}</div>
        ) : null}
        <StoryTimeline
          chapters={visibleChapters.map((chapter) => props.timelineChapterById.get(chapter.id) ?? {
            type: 'chapter',
            chapterNo: chapter.order,
            chapterId: chapter.id,
            title: chapter.title,
            wordCount: chapter.wordCount,
          })}
          branchNodes={visibleBranchNodes}
          edges={props.edges.filter((edge) => visibleNodeIds.has(edge.fromNodeId) && visibleNodeIds.has(edge.toNodeId))}
          activeChapterId={props.currentChapterId}
          activeSelection={props.activeSelection}
          branchChaptersByParentId={props.branchChaptersByParentId}
          onSelectionChange={(selection) => {
            props.onSelectionChange(selection)
            props.onClose()
          }}
          onDeleteChapter={props.onDeleteChapter}
          onDeleteBranchChapter={props.onDeleteChapter}
          deletingBranchNodeId={props.deletingBranchNodeId}
          onDeleteBranchNode={props.onDeleteBranchNode}
        />
        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => props.setChapterListState((current) => ({
              ...current,
              [props.currentNovelId]: Math.min(mainlineChapters.length, (current[props.currentNovelId] ?? 80) + 80),
            }))}
            className="min-h-11 w-full rounded-2xl border border-dashed border-white/10 bg-black/20 px-3 text-sm text-zinc-300 transition hover:bg-white/[0.06]"
          >
            {t('chapterNav.showMore', { count: hiddenCount })}
          </button>
        ) : null}
      </section>
    </>
  )

  if (desktop) {
    return (
      <aside className="rounded-[30px] border border-white/10 bg-[#11141d] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.3)]" data-testid="workspace-chapter-nav">
        <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{t('chapterNav.novel')}</p>
        <h2 className="mb-4 mt-1 text-lg font-semibold text-zinc-100">{t('chapterNav.title')}</h2>
        {content}
      </aside>
    )
  }

  return (
    <DialogSurface open={props.leftPanelOpen} onClose={props.onClose} title={t('chapterNav.title')} description={t('chapterNav.description')} placement="left">
      <div className="mb-4 flex justify-end">
        <IconButton label={t('chapterNav.close')} onClick={props.onClose}>
          <X className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      </div>
      <div data-testid="workspace-chapter-nav">{content}</div>
    </DialogSurface>
  )
}
