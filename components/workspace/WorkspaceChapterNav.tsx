"use client"

import type { Dispatch, SetStateAction } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { StoryTimeline } from '@/components/timeline/StoryTimeline'
import { cn } from '@/lib/utils'
import type { ChapterTimelineItem, StoryTimelineBranchNode, StoryTimelineEdge, TimelineSelection } from '@/lib/story-branch-types'
import type { Chapter, Volume } from '@/lib/types'

export function WorkspaceChapterNav(props: {
  leftPanelOpen: boolean
  onClose: () => void
  onCreateChapter: () => void
  novelVolumes: Volume[]
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
  onDeleteWhatIfSession: (nodeId: string) => void
  onDeleteFutureJumpRun: (nodeId: string) => void
}) {
  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 w-[86vw] max-w-[320px] overflow-y-auto border-r border-white/10 bg-[#0d1017] p-4 shadow-[0_24px_90px_rgba(0,0,0,0.5)] transition lg:static lg:w-auto lg:max-w-none lg:rounded-[30px] lg:border lg:bg-[#11141d] lg:shadow-[0_24px_70px_rgba(0,0,0,0.3)]',
        props.leftPanelOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}
    >
      <div className="mb-4 flex items-center justify-between lg:block">
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Novel</p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-100">章节导航</h2>
        </div>
        <button onClick={props.onClose} className="rounded-2xl border border-white/10 p-2 text-zinc-300 lg:hidden">
          <X className="h-4 w-4" />
        </button>
      </div>

      <button
        onClick={props.onCreateChapter}
        className="mb-4 w-full rounded-2xl bg-violet-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-violet-400"
      >
        + 新建章节
      </button>

      <div className="space-y-3">
        {props.novelVolumes.map((volume) => {
          const chaptersInVolume = props.sortedChapters.filter((chapter) => chapter.volumeId === volume.id && !chapter.parentChapterId)
          const visibleChapters = chaptersInVolume.slice(0, props.chapterListTarget)
          const visibleAnchorChapterNos = new Set(visibleChapters.map((chapter) => chapter.order))
          const visibleBranchNodes = props.branchNodes.filter((node) => visibleAnchorChapterNos.has(node.anchorChapterNo))
          const visibleNodeIds = new Set(visibleBranchNodes.map((node) => node.id))
          const hiddenCount = Math.max(0, chaptersInVolume.length - visibleChapters.length)

          return (
            <section key={volume.id} className="rounded-[24px] border border-white/8 bg-white/[0.03] p-3">
              <div className="flex w-full items-center justify-between gap-3 rounded-2xl px-2 py-2 text-left">
                <div>
                  <p className="text-sm font-medium text-zinc-100">{volume.title}</p>
                  <p className="mt-1 text-xs text-zinc-500">{chaptersInVolume.length} 章</p>
                </div>
                <ChevronDown className="h-4 w-4 text-zinc-500" />
              </div>
              <div className="mt-2 space-y-3">
                {props.storyTimelineError ? (
                  <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
                    {props.storyTimelineError}
                  </div>
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
                  onSelectionChange={props.onSelectionChange}
                  onDeleteChapter={props.onDeleteChapter}
                  onDeleteBranchChapter={props.onDeleteChapter}
                  deletingBranchNodeId={props.deletingBranchNodeId}
                  onDeleteWhatIfSession={(node) => props.onDeleteWhatIfSession(node.id)}
                  onDeleteFutureJumpRun={(node) => props.onDeleteFutureJumpRun(node.id)}
                />
                {hiddenCount > 0 ? (
                  <button
                    onClick={() =>
                      props.setChapterListState((current) => ({
                        ...current,
                        [props.currentNovelId]: Math.min(chaptersInVolume.length, (current[props.currentNovelId] ?? 80) + 80),
                      }))
                    }
                    className="w-full rounded-2xl border border-dashed border-white/10 bg-black/20 px-3 py-3 text-sm text-zinc-300 transition hover:bg-white/[0.06]"
                  >
                    显示更多章节（剩余 {hiddenCount} 章）
                  </button>
                ) : null}
              </div>
            </section>
          )
        })}
      </div>
    </aside>
  )
}
