import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n/provider'
import type { GenerationContextPromptBlock } from '@/components/graph/types'

export function ContextPromptBlocks(props: {
  blocks: GenerationContextPromptBlock[]
  disabledBlockIds: string[]
  onToggle: (blockId: string, enabled: boolean) => void
}) {
  const { t } = useI18n()
  const priorityLabels: Record<GenerationContextPromptBlock['priority'], string> = {
    highest: t('graph.priority.highest'),
    high: t('graph.priority.high'),
    medium: t('graph.priority.medium'),
  }

  return (
    <section className="rounded-[24px] border border-white/8 bg-black/20 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('graph.promptBlocksEyebrow')}</p>
          <p className="mt-1 text-sm text-zinc-300">{t('graph.promptBlocksDescription')}</p>
        </div>
        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-400">
          {t('graph.blocksCount', { count: props.blocks.length })}
        </span>
      </div>

      <div className="space-y-3">
        {props.blocks.map((block) => {
          const enabled = !props.disabledBlockIds.includes(block.id)
          return (
            <label
              key={block.id}
              className={cn(
                'block rounded-[22px] border px-4 py-3 transition',
                enabled ? 'border-amber-300/20 bg-amber-500/10' : 'border-white/8 bg-black/30 opacity-65'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-zinc-100">{block.label}</p>
                    <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                      {priorityLabels[block.priority]}
                    </span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => props.onToggle(block.id, event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-white/20 bg-black/20 text-amber-400"
                />
              </div>
              <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-zinc-400">{block.content}</p>
            </label>
          )
        })}
      </div>
    </section>
  )
}
