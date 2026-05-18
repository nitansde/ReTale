"use client"

import type { ReactNode } from 'react'
import type { TimelineSelection } from '@/lib/story-branch-types'

export function WorkspaceReferencePanel(props: {
  selection: TimelineSelection
  selectionActions: ReactNode
  knowledgeControls: ReactNode
  references: ReactNode
}) {
  const selectionLabel = props.selection.kind === 'chapter'
    ? 'chapter'
    : props.selection.kind === 'continue_block'
      ? 'continue-block'
    : props.selection.kind === 'what_if'
      ? 'what-if'
      : 'future-jump'

  return (
    <aside className="rounded-[30px] border border-white/10 bg-[#11141d] p-4 shadow-[0_28px_90px_rgba(0,0,0,0.35)] sm:p-5" data-testid="workspace-reference-panel">
      <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
        <span>Workspace rail</span>
        <span data-testid="workspace-reference-selection-kind">{selectionLabel}</span>
      </div>
      {props.selectionActions}
      {props.knowledgeControls}
      {props.references}
    </aside>
  )
}
