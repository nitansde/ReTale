"use client"

import { mergeRoleplayNarrationBlocks, type RoleplayScript } from '@/lib/roleplay-script'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'

export function RoleplayScriptBlocks({ script }: { script: RoleplayScript }) {
  const { t } = useI18n()
  return <div className="space-y-5" data-testid="roleplay-script">
    {mergeRoleplayNarrationBlocks(script.blocks).map((block, index) => {
      const narration = block.type === 'narration'
      const player = block.type === 'player'
      return <div key={index} data-roleplay-block={block.type} className={cn(
        narration ? 'mx-2 border-l-2 border-line/15 py-1 pl-4 sm:mx-6' : 'max-w-[90%] rounded-2xl border px-4 py-3 sm:max-w-[85%]',
        !narration && (player ? 'ml-auto border-violet-400/20 bg-violet-500/10' : 'mr-auto border-emerald-400/20 bg-emerald-500/[0.08]'),
      )}>
        {!narration ? <p className={cn('mb-1 text-xs font-medium', player ? 'text-violet-300' : 'text-emerald-300')}>
          {player ? `${script.playerName} · ${t('roleplay.you')}` : script.counterpartName}
        </p> : null}
        <p className={cn('whitespace-pre-wrap break-words text-[15px] leading-8 [overflow-wrap:anywhere]', narration ? 'text-zinc-400' : 'text-zinc-100')}>{block.text}</p>
      </div>
    })}
  </div>
}
