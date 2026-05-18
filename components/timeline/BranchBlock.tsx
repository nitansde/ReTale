"use client"

import { forwardRef } from 'react'
import { GitBranch, LoaderCircle, Sparkles, Trash2 } from 'lucide-react'
import type { StoryTimelineBranchNode } from '@/lib/story-branch-types'
import { cn } from '@/lib/utils'

const INDENT_CLASSES = ['', 'lg:ml-5', 'lg:ml-10', 'lg:ml-14'] as const

function resolveIndentClass(laneIndex: number) {
  return INDENT_CLASSES[Math.min(Math.max(laneIndex, 0), INDENT_CLASSES.length - 1)]
}

export const BranchBlock = forwardRef<HTMLButtonElement, {
  node: StoryTimelineBranchNode
  selected: boolean
  highlighted: boolean
  disabled?: boolean
  deleting?: boolean
  onSelect: () => void
  onDelete?: () => void
  onHoverChange: (hovered: boolean) => void
}>((props, ref) => {
  const isWhatIfLike = props.node.nodeType === 'what_if' || props.node.nodeType === 'continue_block'
  const Icon = isWhatIfLike ? GitBranch : Sparkles

  return (
    <div
      className={cn('flex items-start gap-2', resolveIndentClass(props.node.laneIndex))}
      onMouseEnter={() => props.onHoverChange(true)}
      onMouseLeave={() => props.onHoverChange(false)}
    >
      <button
        ref={ref}
        type="button"
        disabled={props.disabled || props.deleting}
        data-testid={`timeline-node-${props.node.id}`}
        data-active={props.selected ? 'true' : 'false'}
        data-highlighted={props.highlighted ? 'true' : 'false'}
        data-node-type={props.node.nodeType}
        onClick={props.onSelect}
        className={cn(
          'flex-1 rounded-[22px] border px-3 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition disabled:cursor-not-allowed disabled:opacity-60',
          isWhatIfLike
            ? 'border-violet-300/20 bg-[linear-gradient(135deg,rgba(109,40,217,0.22),rgba(17,20,29,0.94))] text-zinc-100 hover:border-violet-300/30 hover:bg-[linear-gradient(135deg,rgba(124,58,237,0.28),rgba(17,20,29,0.98))]'
            : 'border-sky-300/20 bg-[linear-gradient(135deg,rgba(59,130,246,0.20),rgba(76,29,149,0.90))] text-zinc-100 hover:border-sky-300/32 hover:bg-[linear-gradient(135deg,rgba(96,165,250,0.28),rgba(91,33,182,0.96))]',
          props.highlighted && !props.selected && (isWhatIfLike ? 'border-fuchsia-300/28 bg-fuchsia-500/12' : 'border-sky-300/28 bg-sky-500/12'),
          props.selected && (isWhatIfLike ? 'border-fuchsia-300/36 bg-fuchsia-500/16 text-fuchsia-50' : 'border-sky-300/40 bg-sky-500/16 text-sky-50')
        )}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'mt-0.5 rounded-2xl border p-2',
              isWhatIfLike ? 'border-fuchsia-300/18 bg-black/20 text-fuchsia-100' : 'border-sky-300/18 bg-black/20 text-sky-100'
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className={cn('text-[11px] uppercase tracking-[0.16em]', isWhatIfLike ? 'text-fuchsia-100/70' : 'text-sky-100/75')}>
              {props.node.nodeType === 'continue_block' ? 'Continue block' : isWhatIfLike ? 'What if' : 'Future jump'}
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-50">{props.node.title}</p>
            {props.node.subtitle ? <p className="mt-2 text-xs leading-5 text-zinc-300">{props.node.subtitle}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-300/90">
              <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">Anchor {props.node.anchorChapterNo}</span>
              {props.node.sourceChapterNo ? <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">From {props.node.sourceChapterNo}</span> : null}
              {props.node.targetChapterNo ? <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">To {props.node.targetChapterNo}</span> : null}
            </div>
          </div>
        </div>
      </button>
      {props.onDelete ? (
        <button
          type="button"
          disabled={props.deleting}
          onClick={props.onDelete}
          className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-2 text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={`删除 ${isWhatIfLike ? props.node.nodeType === 'continue_block' ? 'Continue block' : 'What-if' : 'Future jump'} 节点 ${props.node.title}`}
        >
          {props.deleting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      ) : null}
    </div>
  )
})

BranchBlock.displayName = 'BranchBlock'
