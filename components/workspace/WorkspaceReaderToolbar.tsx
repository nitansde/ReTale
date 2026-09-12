'use client'

import { BookOpen, Check, LoaderCircle, Pencil } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'

export function WorkspaceReaderToolbar({
  isEditing,
  isSaving,
  onStartEditing,
  onFinishEditing,
}: {
  isEditing: boolean
  isSaving: boolean
  onStartEditing: () => void
  onFinishEditing: () => Promise<void>
}) {
  const { t } = useI18n()
  const ModeIcon = isEditing ? Pencil : BookOpen
  const ActionIcon = isSaving ? LoaderCircle : isEditing ? Check : Pencil

  return (
    <div className="mb-3 flex items-center justify-between gap-3 px-4 pt-3 sm:px-0 sm:pt-0">
      <span className="inline-flex items-center gap-2 text-xs text-zinc-400" role="status">
        <ModeIcon className="h-4 w-4" aria-hidden="true" />
        {t(isEditing ? 'workspace.reader.editing' : 'workspace.reader.readOnly')}
      </span>
      <button
        type="button"
        data-testid="workspace-reader-edit-toggle"
        disabled={isSaving}
        aria-busy={isSaving}
        onClick={() => { if (isEditing) void onFinishEditing(); else onStartEditing() }}
        className={cn(
          'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70 disabled:opacity-60',
          isEditing ? 'border-violet-300/30 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25' : 'border-white/10 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]',
        )}
      >
        <ActionIcon className={cn('h-3.5 w-3.5', isSaving && 'animate-spin')} aria-hidden="true" />
        {t(isSaving ? 'workspace.reader.saving' : isEditing ? 'workspace.reader.done' : 'workspace.reader.edit')}
      </button>
    </div>
  )
}
