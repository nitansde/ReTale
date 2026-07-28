"use client"

import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { IconButton } from '@/components/ui/IconButton'
import { useDesktopWorkspaceLayout } from '@/components/workspace/use-desktop-workspace-layout'
import { useI18n } from '@/lib/i18n/provider'

export function WorkspaceReferencePanel(props: {
  open: boolean
  onClose: () => void
  knowledgeOpen: boolean
  onKnowledgeClose: () => void
  contextLabel: string
  selectionActions: ReactNode
  knowledgeControls: ReactNode
  references: ReactNode
}) {
  const { t } = useI18n()
  const desktop = useDesktopWorkspaceLayout()

  if (desktop) {
    return (
      <aside className="rounded-[30px] border border-white/10 bg-[#11141d] p-4 shadow-[0_28px_90px_rgba(0,0,0,0.35)] sm:p-5" data-testid="workspace-reference-panel">
        <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2">
          <span className="text-xs font-medium text-zinc-300">{t('workspace.context.title')}</span>
          <span className="text-[11px] text-zinc-500" data-testid="workspace-reference-selection-kind">{props.contextLabel}</span>
        </div>
        {props.selectionActions}
        {props.knowledgeControls}
        {props.references}
      </aside>
    )
  }

  return (
    <>
      <DialogSurface open={props.open} onClose={props.onClose} title={t('workspace.context.title')} description={t('workspace.context.description')} placement="right">
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-zinc-400" data-testid="workspace-reference-selection-kind">{props.contextLabel}</span>
          <IconButton label={t('workspace.context.close')} onClick={props.onClose}>
            <X className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>
        <div data-testid="workspace-reference-panel">
          {props.selectionActions}
          {props.references}
        </div>
      </DialogSurface>
      <DialogSurface open={props.knowledgeOpen} onClose={props.onKnowledgeClose} title={t('workspace.knowledge.sheetTitle')} description={t('workspace.knowledge.sheetDescription')} placement="bottom">
        <div className="mb-4 flex justify-end">
          <IconButton label={t('workspace.knowledge.closeSheet')} onClick={props.onKnowledgeClose}>
            <X className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>
        {props.knowledgeControls}
      </DialogSurface>
    </>
  )
}
