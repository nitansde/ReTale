"use client"

import type { ChangeEvent } from 'react'
import { PRESET_COMPAT_OPTED_IN_SURFACE_IDS } from '@/lib/preset-compat/surface-contract'
import type {
  PresetCompatLibrary,
  PresetCompatPresetRecord,
  PresetCompatPromptRule,
  PresetCompatRegexRecord,
  PresetCompatSurfaceId,
} from '@/lib/preset-compat/types'
import { PresetCompatRegexEditor } from '@/components/workspace/PresetCompatRegexEditor'

type PresetCompatPresetEditorProps = {
  preset: PresetCompatPresetRecord
  library: PresetCompatLibrary
  onBindSurface: (surfaceId: PresetCompatSurfaceId, presetId: string | null) => void
  onUpdatePromptRule: (promptRuleId: string, updates: Partial<PresetCompatPromptRule>) => void
  onUpdateEmbeddedRegex: (regexId: string, updates: Partial<PresetCompatRegexRecord>) => void
  onUpdateStandaloneRegex: (regexId: string, updates: Partial<PresetCompatRegexRecord>) => void
  onToggleStandaloneRegexAttachment: (regexId: string) => void
  onDeletePreset: () => void
  onExportPreset: () => void
}

const SURFACE_LABELS: Record<PresetCompatSurfaceId, string> = {
  rewrite: 'Rewrite',
  expand: 'Expand',
  roleplay: 'Roleplay',
  polish: 'Polish',
  continue: 'Continue',
  future_jump_rewrite: 'Future Jump rewrite',
  future_jump_bridge: 'Future Jump bridge',
  what_if_delta_extraction: 'What-if delta extraction',
  knowledge_extraction: 'Knowledge extraction',
  embeddings: 'Embeddings',
}

function buildPromptRuleWarnings(rule: PresetCompatPromptRule) {
  const warnings: string[] = []
  if (rule.marker) warnings.push('Marker prompts are preserved-only in MVP runtime.')
  if (rule.role !== 'system' && rule.role !== 'user') warnings.push(`Role \`${rule.role}\` is preserved-only and not applied at runtime.`)
  if (rule.injectionPosition !== 'before' && rule.injectionPosition !== 'none') warnings.push(`Injection position \`${rule.injectionPosition}\` is preserved-only.`)
  if (rule.injectionDepth !== null) warnings.push('Injection depth is preserved-only in MVP runtime.')
  if (rule.injectionTrigger) warnings.push('Injection trigger is preserved-only in MVP runtime.')
  if (rule.forbidOverrides) warnings.push('`forbidOverrides` is preserved-only in MVP runtime.')
  return warnings
}

function buildPresetWarnings(preset: PresetCompatPresetRecord) {
  const warnings = [...preset.importWarnings]
  if (preset.passthrough.root && typeof preset.passthrough.root === 'object') {
    for (const fieldName of Object.keys(preset.passthrough.root as Record<string, unknown>)) {
      if (
        fieldName === 'top_a'
        || fieldName === 'openai_max_context'
        || fieldName === 'max_context_unlocked'
        || fieldName === 'names_behavior'
        || fieldName === 'send_if_empty'
        || fieldName === 'impersonation_prompt'
        || fieldName === 'new_chat_prompt'
        || fieldName === 'new_group_chat_prompt'
        || fieldName === 'new_example_chat_prompt'
        || fieldName === 'continue_nudge_prompt'
        || fieldName === 'bias_preset_selected'
        || fieldName === 'wi_format'
        || fieldName === 'scenario_format'
        || fieldName === 'personality_format'
        || fieldName === 'group_nudge_prompt'
        || fieldName === 'stream_openai'
        || fieldName === 'function_calling'
        || fieldName === 'show_thoughts'
        || fieldName === 'reasoning_effort'
        || fieldName === 'image_inlining'
      ) {
        warnings.push(`Sampler field \`${fieldName}\` is preserved for export and not exposed as a live runtime control.`)
      }
    }
  }
  return Array.from(new Set(warnings))
}

function handleRuleContentChange(
  event: ChangeEvent<HTMLTextAreaElement>,
  promptRuleId: string,
  onUpdatePromptRule: (promptRuleId: string, updates: Partial<PresetCompatPromptRule>) => void
) {
  onUpdatePromptRule(promptRuleId, { content: event.target.value })
}

export function PresetCompatPresetEditor({
  preset,
  library,
  onBindSurface,
  onUpdatePromptRule,
  onUpdateEmbeddedRegex,
  onUpdateStandaloneRegex,
  onToggleStandaloneRegexAttachment,
  onDeletePreset,
  onExportPreset,
}: PresetCompatPresetEditorProps) {
  const presetWarnings = buildPresetWarnings(preset)
  const standardSurfaces = PRESET_COMPAT_OPTED_IN_SURFACE_IDS.filter((surfaceId) => surfaceId !== 'future_jump_rewrite')
  const standaloneRegexes = Object.values(library.standaloneRegexes)

  return (
    <div className="space-y-4">
      <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">预设详情</p>
            <h4 className="mt-2 text-lg font-semibold text-zinc-100">{preset.name}</h4>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              {preset.promptRules.length} 条提示词规则 · {preset.embeddedRegexes.length} 条内嵌正则 · {preset.attachedStandaloneRegexIds.length} 条已附加独立正则
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid={`preset-compat-preset-delete-${preset.id}`}
              onClick={onDeletePreset}
              className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-2 text-sm text-rose-100 transition hover:bg-rose-500/20"
            >
              删除预设
            </button>
            <button
              type="button"
              data-testid={`preset-compat-preset-export-${preset.id}`}
              onClick={onExportPreset}
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-zinc-100 transition hover:bg-white/[0.08]"
            >
              导出预设 JSON
            </button>
          </div>
        </div>

        {presetWarnings.length ? (
          <div className="mt-4 rounded-[20px] border border-amber-300/18 bg-amber-500/10 p-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-amber-100/80">仅保留警告</p>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-100">
              {presetWarnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">界面绑定</p>
        <p className="mt-2 text-sm leading-6 text-zinc-400">为每个已接入的创作界面选择要使用的预设。</p>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {standardSurfaces.map((surfaceId) => {
            const binding = library.surfaceBindings[surfaceId]
            return (
              <label key={surfaceId} className="block rounded-[20px] border border-white/8 bg-[#0b0d12] p-3">
                <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">{SURFACE_LABELS[surfaceId]}</span>
                <select
                  data-testid={`preset-compat-binding-${surfaceId}`}
                  value={binding?.presetId ?? ''}
                  onChange={(event) => onBindSurface(surfaceId, event.target.value || null)}
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none"
                >
                  <option value="">不使用预设</option>
                  {Object.values(library.presets).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            )
          })}
        </div>

        <div className="mt-4 rounded-[20px] border border-violet-400/16 bg-violet-500/8 p-4">
          <p className="text-[11px] uppercase tracking-[0.16em] text-violet-200/80">高级</p>
          <p className="mt-2 text-sm leading-6 text-zinc-300">Future Jump 改写保留独立绑定，因为 bridge 生成仍需保持 fail-closed。</p>
          <label className="mt-3 block">
            <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">{SURFACE_LABELS.future_jump_rewrite}</span>
            <select
              data-testid="preset-compat-binding-future_jump_rewrite"
              value={library.surfaceBindings.future_jump_rewrite.presetId ?? ''}
              onChange={(event) => onBindSurface('future_jump_rewrite', event.target.value || null)}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none"
            >
              <option value="">不使用预设</option>
              {Object.values(library.presets).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">提示词规则</p>
        <div className="mt-4 space-y-3">
          {preset.promptRules.map((rule) => {
            const warnings = buildPromptRuleWarnings(rule)
            const activeOnSurfaceCount = PRESET_COMPAT_OPTED_IN_SURFACE_IDS.filter((surfaceId) => preset.promptOrderLists[surfaceId]?.includes(rule.id)).length

            return (
              <div key={rule.id} className="rounded-[22px] border border-white/8 bg-[#0b0d12] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-zinc-100">{rule.name}</p>
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">角色：{rule.role}</span>
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">已在 {activeOnSurfaceCount} 个界面生效</span>
                    </div>
                  </div>

                  <label className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      data-testid={`preset-compat-rule-toggle-${rule.id}`}
                      checked={rule.enabled}
                      onChange={(event) => onUpdatePromptRule(rule.id, { enabled: event.target.checked })}
                      className="h-3.5 w-3.5 rounded border-white/20 bg-transparent"
                    />
                    启用
                  </label>
                </div>

                {warnings.length ? (
                  <div className="mt-3 rounded-[18px] border border-amber-300/18 bg-amber-500/10 p-3">
                    <ul className="space-y-1 text-xs leading-5 text-amber-100">
                      {warnings.map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                  </div>
                ) : null}

                <label className="mt-3 block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">内容</span>
                  <textarea
                    data-testid={`preset-compat-rule-content-${rule.id}`}
                    value={rule.content}
                    onChange={(event) => handleRuleContentChange(event, rule.id, onUpdatePromptRule)}
                    className="h-28 w-full rounded-[20px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none"
                  />
                </label>
              </div>
            )
          })}
        </div>
      </div>

      <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">内嵌正则</p>
        <div className="mt-4 space-y-3">
          {preset.embeddedRegexes.length ? preset.embeddedRegexes.map((regexRecord) => (
            <PresetCompatRegexEditor
              key={regexRecord.id}
              title="Embedded regex"
              regexRecord={regexRecord}
              onUpdate={(updates) => onUpdateEmbeddedRegex(regexRecord.id, updates)}
            />
          )) : (
            <div className="rounded-[20px] border border-white/8 bg-[#0b0d12] p-4 text-sm text-zinc-400">这个预设没有内嵌正则规则。</div>
          )}
        </div>
      </div>

      <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">独立正则库</p>
        <p className="mt-2 text-sm leading-6 text-zinc-400">把全局正则规则附加到当前预设上，而不改动原始导入的预设载荷。</p>
        <div className="mt-4 space-y-3">
          {standaloneRegexes.length ? standaloneRegexes.map((regexRecord) => {
            const attached = preset.attachedStandaloneRegexIds.includes(regexRecord.id)
            return (
              <PresetCompatRegexEditor
                key={regexRecord.id}
                title="Standalone regex"
                regexRecord={regexRecord}
                onUpdate={(updates) => onUpdateStandaloneRegex(regexRecord.id, updates)}
                attachment={{
                  attached,
                  onToggle: () => onToggleStandaloneRegexAttachment(regexRecord.id),
                  testId: `preset-compat-standalone-regex-attach-${regexRecord.id}`,
                }}
              />
            )
          }) : (
            <div className="rounded-[20px] border border-white/8 bg-[#0b0d12] p-4 text-sm text-zinc-400">先导入独立正则包，才能在这里附加全局正则规则。</div>
          )}
        </div>
      </div>
    </div>
  )
}
