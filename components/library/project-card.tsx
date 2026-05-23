import { LoaderCircle, Trash2 } from 'lucide-react'
import type { Novel } from '@/lib/types'

export function ProjectCard({
  novel,
  onOpen,
  onDelete,
  opening,
  deleting,
}: {
  novel: Novel
  onOpen: () => void
  onDelete: () => void
  opening?: boolean
  deleting?: boolean
}) {
  return (
    <article className="group rounded-[28px] border border-white/8 bg-white/[0.04] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur transition hover:border-white/12 hover:bg-white/[0.06]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onOpen}
          disabled={opening}
          aria-busy={opening}
          className="flex-1 text-left disabled:cursor-progress"
        >
          <div className="mb-5 h-32 rounded-[22px] bg-[radial-gradient(circle_at_top_left,_rgba(124,156,255,0.45),_transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(168,85,247,0.25),_transparent_35%),linear-gradient(135deg,_rgba(255,255,255,0.05),_rgba(255,255,255,0.01))]" />

          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-zinc-100 group-hover:text-white">
                {novel.title}
              </h2>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-400">
                {novel.summary}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {novel.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-zinc-300"
                >
                  {tag}
                </span>
              ))}
            </div>

            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>{novel.chapterCount} 章</span>
              <span>{novel.wordCount.toLocaleString()} 字</span>
              <span>{novel.updatedAt}</span>
            </div>

            {opening ? (
              <div className="flex items-center gap-2 text-xs text-zinc-300">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin text-indigo-200" />
                <span>打开中…</span>
              </div>
            ) : null}
          </div>
        </button>

        <button
          type="button"
          onClick={onDelete}
          disabled={deleting || opening}
          className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-2 text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={`删除小说 ${novel.title}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </article>
  )
}
