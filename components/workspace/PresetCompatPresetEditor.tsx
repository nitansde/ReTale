"use client"

import { useMemo, type ChangeEvent } from 'react'
import {
  PRESET_COMPAT_FAIL_CLOSED_SURFACE_REGISTRY_IDS,
  PRESET_COMPAT_OPTED_IN_SURFACE_IDS,
  PRESET_COMPAT_SURFACE_REGISTRY,
} from '@/lib/preset-compat/surface-contract'
import { buildPresetCompatCreativeRuntimePreview } from '@/lib/preset-compat/creative-runtime-preview'
import { resolvePresetCompatRuntime } from '@/lib/preset-compat/resolve-runtime'
import type { PresetCompatMacroDiagnostic } from '@/lib/preset-compat/macro-context'
import {
  PRESET_COMPAT_CREATIVE_SURFACE_IDS,
  type PresetCompatResolvedFieldStatus,
  type PresetCompatResolvedProviderControlIntent,
  type PresetCompatSurfaceId,
} from '@/lib/preset-compat/types'
import type {
  PresetCompatLibrary,
  PresetCompatPresetRecord,
  PresetCompatPromptRule,
  PresetCompatRegexRecord,
} from '@/lib/preset-compat/types'
import { PresetCompatRegexEditor } from '@/components/workspace/PresetCompatRegexEditor'
import { createDefaultAISettings } from '@/lib/ai-settings'
import { createPresetCompatSessionStateKey } from '@/lib/workspace-state'
import type {
  AIScenarioSettings,
  PresetCompatSessionPhase,
  PresetCompatSessionWorkspaceSelection,
} from '@/lib/types'
import { useNovelStore } from '@/store/novel-store'
import { cn } from '@/lib/utils'

type PresetCompatPresetEditorProps = {
  activeSurfaceId?: PresetCompatSurfaceId | null
  activeSelection?: PresetCompatSessionWorkspaceSelection | null
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

type SurfaceRuntimePreview = {
  surfaceId: PresetCompatSurfaceId
  runtime: ReturnType<typeof resolvePresetCompatRuntime>
  promptPreview: {
    systemPrompt: string
    userPrompt: string
    warnings: string[]
    macroDiagnostics: PresetCompatMacroDiagnostic[]
  }
  providerIntents: PresetCompatResolvedProviderControlIntent[]
  sessionPhase: PresetCompatSessionPhase
  resetPending: boolean
  isFailClosed: boolean
  canReset: boolean
  usesSelectedBinding: boolean
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

const STATUS_LABELS: Record<PresetCompatResolvedFieldStatus['status'], string> = {
  applied: '已应用',
  degraded: '已降级',
  preserved: '仅保留',
  unsupported: '不支持',
}

const STATUS_BADGE_CLASS_NAMES: Record<PresetCompatResolvedFieldStatus['status'], string> = {
  applied: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100',
  degraded: 'border-amber-400/20 bg-amber-500/10 text-amber-100',
  preserved: 'border-sky-400/20 bg-sky-500/10 text-sky-100',
  unsupported: 'border-rose-400/20 bg-rose-500/10 text-rose-100',
}

const REASON_LABELS: Partial<Record<PresetCompatResolvedFieldStatus['reason'], string>> = {
  SUPPORTED_RUNTIME: '当前 provider 与界面已按兼容契约应用。',
  PROVIDER_ONLY: '这个字段只在另一类 provider 上可直接生效。',
  PROVIDER_UNSUPPORTED: '当前 provider 没有安全可映射的运行时控制。',
  ROUTE_UNSUPPORTED: '当前路由还没有开放这个控制位。',
  NO_GROUP_CONTEXT: '当前上下文不是群聊场景。',
  NO_EXAMPLE_CONTEXT: '当前上下文没有 example-chat 抽象。',
  NO_CHAT_HISTORY: '当前界面没有可安全注入的命名对话历史。',
  NO_EMPTY_SEND_CONTEXT: '当前界面不会发送空输入，因此只能保留导出。',
  NO_IMPERSONATION_CONTEXT: '当前上下文没有显式 impersonation 抽象。',
  NEW_CHAT_CONTEXT_REQUIRED: '只有新会话阶段才会应用。',
  CONTINUE_SURFACE_ONLY: '只有 continue 界面会应用。',
  WORLD_INFO_CONTEXT_REQUIRED: '当前提示里没有 world-info 上下文块。',
  SCENARIO_CONTEXT_REQUIRED: '当前提示里没有 scenario 上下文块。',
  PERSONA_CONTEXT_REQUIRED: '当前提示里没有 personality 上下文块。',
  ASSISTANT_PREFILL_UNSUPPORTED: '当前字符串式界面没有 assistant-prefill 等价物。',
  SYSTEM_CHANNEL_REQUIRED: '这个字段只能进入 system 通道。',
  MESSAGE_SQUASH_UNSUPPORTED: '当前运行时不会重排消息结构。',
  WEB_SEARCH_IMPORT_DISABLED: '导入会保留，但当前不会开启联网搜索。',
  IMAGE_REQUEST_METADATA_ONLY: '图像请求元数据只保留导出，不在这里执行。',
  PROMPT_ORDER_CANONICAL: '运行时使用 ChatBook 的固定组装顺序。',
  UNSUPPORTED_ROLE: '这个 prompt role 在当前 MVP 运行时里没有实现。',
  UNSUPPORTED_MARKER: 'marker prompt 仍然只保留导出。',
  UNKNOWN_TRIGGER: 'trigger 不在 allowlist 里，因此 fail-closed。',
  UNKNOWN_CONDITION: 'condition 无法安全识别，因此只保留。',
  UNSAFE_CONDITION: 'condition 需要不安全求值，因此被阻止。',
  MARKDOWN_CHANNEL_REQUIRED: '当前运行时没有 markdown-only 注入通道。',
  EDIT_HOOK_UNSUPPORTED: '当前工作区没有等价 edit-hook 生命周期。',
  REGEX_SUBSTITUTE_MODE_UNSUPPORTED: 'substituteRegex 模式超出当前受支持子集。',
  VIRTUAL_DEPTH_REQUIRED: '这个字段需要真实聊天深度，字符串界面无法安全模拟。',
  FORBID_OVERRIDES_PROTECTED: '同一插槽已被 forbidOverrides 片段保护。',
  UNSUPPORTED_RUNTIME_SURFACE: '该运行时界面不支持这类宏语义。',
  PRESERVED_EXPORT_ONLY: '保留在导出载荷中，但当前界面不会执行。',
  ANALYTICAL_SURFACE_FAIL_CLOSED: '分析型界面保持 fail-closed，不接入创作预设字段。',
}

function buildProviderDefaults(settings: AIScenarioSettings) {
  return {
    provider: settings.provider,
    openAICompatible: {
      config: settings.openAICompatible,
    },
    ollama: {
      config: settings.ollama,
    },
  } as const
}

function getPreviewSessionPhase(surfaceId: PresetCompatSurfaceId, phase: PresetCompatSessionPhase | null) {
  if (phase) return phase
  return surfaceId === 'continue' ? 'continue' : 'new_chat'
}

function getResetPhaseForSurface(surfaceId: PresetCompatSurfaceId): PresetCompatSessionPhase {
  return surfaceId === 'continue' ? 'continue' : 'new_chat'
}

function getReasonText(status: PresetCompatResolvedFieldStatus) {
  return REASON_LABELS[status.reason] ?? status.reason.replaceAll('_', ' ').toLowerCase()
}

function formatSurfaceSelectionLabel(selection: PresetCompatSessionWorkspaceSelection | null | undefined) {
  if (!selection) return '当前工作区上下文'
  if (selection.kind === 'chapter') return `章节 ${selection.chapterId}`
  if (selection.kind === 'what_if') return `What-if ${selection.sessionId}`
  return `Future Jump ${selection.runId}`
}

function formatProviderLabel(provider: PresetCompatResolvedProviderControlIntent['provider']) {
  return provider === 'openai-compatible' ? 'OpenAI-compatible' : 'Ollama'
}

function resolveActiveSurfaceFromSessionState(params: {
  activeSelection: PresetCompatSessionWorkspaceSelection | null
  presetCompatSessionState: ReturnType<typeof useNovelStore.getState>['presetCompatSessionState']
  explicitActiveSurfaceId: PresetCompatSurfaceId | null
}) {
  if (params.explicitActiveSurfaceId) {
    return params.explicitActiveSurfaceId
  }

  if (!params.activeSelection) {
    return null
  }

  const activeSurfaceIds = PRESET_COMPAT_CREATIVE_SURFACE_IDS.filter((surfaceId) => {
    const entryKey = createPresetCompatSessionStateKey(params.activeSelection!, surfaceId)
    return Boolean(params.presetCompatSessionState[entryKey])
  })

  return activeSurfaceIds.length === 1 ? activeSurfaceIds[0] : null
}

function buildPromptRuleWarnings(rule: PresetCompatPromptRule) {
  const warnings: string[] = []
  const injectionTriggers = Array.isArray(rule.injectionTrigger) ? rule.injectionTrigger : []
  if (rule.marker) warnings.push('Marker prompts are preserved-only in MVP runtime.')
  if (rule.role !== 'system' && rule.role !== 'user') warnings.push(`Role \`${rule.role}\` is preserved-only and not applied at runtime.`)
  if (rule.injectionPosition !== 'before' && rule.injectionPosition !== 'none') warnings.push(`Injection position \`${rule.injectionPosition}\` is preserved-only.`)
  if (rule.injectionDepth !== null) warnings.push('Injection depth is preserved-only in MVP runtime.')
  if (injectionTriggers.length > 0) warnings.push('Injection trigger is preserved-only in MVP runtime.')
  if (rule.forbidOverrides) warnings.push('`forbidOverrides` is preserved-only in MVP runtime.')
  return warnings
}

function buildPreviewPromptRuntimeContext(sessionPhase: PresetCompatSessionPhase) {
  return {
    sessionPhase,
    surfaceContextBlocks: [
      {
        id: 'preview-named-transcript',
        label: 'Preview named transcript',
        content: 'Alice: Hello\nBob: Hi',
        abstraction: 'named_transcript' as const,
      },
    ],
    namedTranscript: {
      kind: 'chat' as const,
      userName: 'Alice',
      assistantName: 'Bob',
    },
  }
}

function handleRuleContentChange(
  event: ChangeEvent<HTMLTextAreaElement>,
  promptRuleId: string,
  onUpdatePromptRule: (promptRuleId: string, updates: Partial<PresetCompatPromptRule>) => void
) {
  onUpdatePromptRule(promptRuleId, { content: event.target.value })
}

export function PresetCompatPresetEditor({
  activeSurfaceId = null,
  activeSelection = null,
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
  const aiSettings = useNovelStore((state) => state.aiSettings)
  const currentChapterId = useNovelStore((state) => state.currentChapterId)
  const presetCompatSessionState = useNovelStore((state) => state.presetCompatSessionState)
  const resetPresetCompatSessionStateForSelection = useNovelStore((state) => state.resetPresetCompatSessionStateForSelection)
  const rewriteAISettings = aiSettings?.rewrite ?? createDefaultAISettings().rewrite
  const effectiveSelection = activeSelection ?? (currentChapterId
    ? {
        kind: 'chapter' as const,
        chapterId: currentChapterId,
      }
    : null)
  const standardSurfaces = PRESET_COMPAT_OPTED_IN_SURFACE_IDS.filter((surfaceId) => surfaceId !== 'future_jump_rewrite')
  const standaloneRegexes = Object.values(library.standaloneRegexes)
  const activeSelectionLabel = formatSurfaceSelectionLabel(effectiveSelection)
  const effectiveActiveSurfaceId = resolveActiveSurfaceFromSessionState({
    activeSelection: effectiveSelection,
    presetCompatSessionState,
    explicitActiveSurfaceId: activeSurfaceId,
  })
  const activeSurfaceLabel = effectiveActiveSurfaceId ? SURFACE_LABELS[effectiveActiveSurfaceId] : null
  const surfacePreviews = useMemo<SurfaceRuntimePreview[]>(() => {
    const providerDefaults = buildProviderDefaults(rewriteAISettings)
    const previewSurfaceIds = [...PRESET_COMPAT_OPTED_IN_SURFACE_IDS, ...PRESET_COMPAT_FAIL_CLOSED_SURFACE_REGISTRY_IDS]

    return previewSurfaceIds.map((surfaceId) => {
      const sessionEntry = effectiveSelection
        ? presetCompatSessionState[createPresetCompatSessionStateKey(effectiveSelection, surfaceId)] ?? null
        : null
      const sessionPhase = getPreviewSessionPhase(surfaceId, sessionEntry?.phase ?? null)
      const previewLibrary: PresetCompatLibrary = {
        ...library,
        surfaceBindings: {
          ...library.surfaceBindings,
          [surfaceId]: {
            ...library.surfaceBindings[surfaceId],
            presetId: preset.id,
            enabled: true,
          },
        },
      }
      const runtime = resolvePresetCompatRuntime({
        library: previewLibrary,
        surfaceId,
        providerDefaults,
        promptRuleRuntimeContext: buildPreviewPromptRuntimeContext(sessionPhase),
      })
      const standalone = runtime.activePreset
        ? runtime.activePreset.attachedStandaloneRegexIds
            .map((regexId) => previewLibrary.standaloneRegexes[regexId])
            .filter((regex): regex is PresetCompatRegexRecord => Boolean(regex))
        : []
      const embedded = runtime.activePreset?.embeddedRegexes ?? []
      const promptPreview = buildPresetCompatCreativeRuntimePreview({
        surfaceId,
        resolvedRuntime: runtime,
        systemPrompt: '',
        userPrompt: '',
        standalone,
        embedded,
      })

      return {
        surfaceId,
        runtime,
        promptPreview: {
          systemPrompt: promptPreview.systemPrompt,
          userPrompt: promptPreview.userPrompt,
          warnings: promptPreview.warnings,
          macroDiagnostics: promptPreview.metadata.macroDiagnostics,
        },
        providerIntents: runtime.providerControlIntents.filter((intent) => intent.field === 'max_context_unlocked' || intent.field === 'openai_max_context' || intent.field === 'stream_openai'),
        sessionPhase,
        resetPending: sessionEntry?.resetPending ?? false,
        isFailClosed: PRESET_COMPAT_SURFACE_REGISTRY[surfaceId].failClosed,
        canReset: Boolean(effectiveSelection && effectiveActiveSurfaceId && surfaceId === effectiveActiveSurfaceId),
        usesSelectedBinding: library.surfaceBindings[surfaceId].presetId === preset.id && library.surfaceBindings[surfaceId].enabled,
      }
    })
  }, [effectiveSelection, effectiveActiveSurfaceId, library, preset.id, presetCompatSessionState, rewriteAISettings])
  const creativeSurfacePreviews = surfacePreviews.filter((preview) => !preview.isFailClosed)
  const failClosedSurfacePreviews = surfacePreviews.filter((preview) => preview.isFailClosed)

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

        {preset.importWarnings.length ? (
          <div className="mt-4 rounded-[20px] border border-amber-300/18 bg-amber-500/10 p-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-amber-100/80">导入备注</p>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-100">
              {preset.importWarnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">运行时兼容预览</p>
            <p className="mt-2 text-sm leading-6 text-zinc-400">这里直接展示现有兼容运行时返回的字段状态：字段名、状态以及原因。重置只作用于 {activeSelectionLabel} 的临时 preset-session 状态，不会改动全局预设库或账户设置。</p>
          </div>
          <div className="flex flex-wrap gap-2">
          {effectiveSelection ? (
            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-300">
              作用域：{activeSelectionLabel}
            </span>
            ) : null}
            {activeSurfaceLabel ? (
              <span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-[11px] text-violet-100">
                当前创作界面：{activeSurfaceLabel}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 space-y-4">
          {creativeSurfacePreviews.map((preview) => {
            const maxContextIntent = preview.providerIntents.find((intent) => intent.field === 'openai_max_context')
            const maxContextUnlockIntent = preview.providerIntents.find((intent) => intent.field === 'max_context_unlocked')
            const streamIntent = preview.providerIntents.find((intent) => intent.field === 'stream_openai')

            return (
              <div
                key={preview.surfaceId}
                className="rounded-[22px] border border-white/8 bg-[#0b0d12] p-4"
                data-testid={`preset-compat-status-surface-${preview.surfaceId}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-zinc-100">{SURFACE_LABELS[preview.surfaceId]}</p>
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">
                        {preview.runtime.providerRuntime.provider === 'openai-compatible' ? 'OpenAI-compatible' : 'Ollama'}
                      </span>
                      <span className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px]',
                        preview.usesSelectedBinding
                          ? 'border-violet-400/30 bg-violet-500/12 text-violet-100'
                          : 'border-white/10 text-zinc-400'
                      )}>
                        {preview.usesSelectedBinding ? '当前绑定' : '使用当前预设预览'}
                      </span>
                    </div>
                    <p
                      className="mt-2 text-xs leading-5 text-zinc-400"
                      data-testid={`preset-compat-session-state-${preview.surfaceId}`}
                    >
                      会话阶段：{preview.sessionPhase}{preview.resetPending ? ' · 待重置' : ' · 正常'}
                    </p>
                  </div>

                  {preview.canReset && effectiveSelection ? (
                    <button
                      type="button"
                      data-testid={`preset-compat-session-reset-${preview.surfaceId}`}
                      onClick={() => resetPresetCompatSessionStateForSelection(effectiveSelection, [preview.surfaceId], getResetPhaseForSurface(preview.surfaceId))}
                      className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-200 transition hover:bg-white/[0.06]"
                    >
                      重置当前上下文
                    </button>
                  ) : null}
                </div>

                {maxContextIntent || maxContextUnlockIntent || streamIntent ? (
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                    {maxContextUnlockIntent ? (
                      <span className="rounded-full border border-sky-400/20 bg-sky-500/10 px-2.5 py-1 text-sky-100">
                        Max context：{String(maxContextUnlockIntent.value) === 'true' ? '已解锁上限' : '保持 provider 默认'}
                      </span>
                    ) : null}
                    {maxContextIntent ? (
                      <span className="rounded-full border border-sky-400/20 bg-sky-500/10 px-2.5 py-1 text-sky-100">
                        上下文窗口：{String(maxContextIntent.value)} · route → {maxContextIntent.path}
                      </span>
                    ) : null}
                    {streamIntent ? (
                      <span className="rounded-full border border-sky-400/20 bg-sky-500/10 px-2.5 py-1 text-sky-100">
                        流式策略：{streamIntent.value === true ? '开启' : '关闭'} · route → {streamIntent.path}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <label className="block rounded-[18px] border border-white/8 bg-black/20 p-3">
                    <span className="mb-2 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">System preview</span>
                    <textarea
                      readOnly
                      value={preview.promptPreview.systemPrompt}
                      data-testid={`preset-compat-preview-system-${preview.surfaceId}`}
                      className="h-28 w-full rounded-2xl border border-white/10 bg-[#090b10] px-4 py-3 text-xs leading-6 text-zinc-200 outline-none"
                    />
                  </label>
                  <label className="block rounded-[18px] border border-white/8 bg-black/20 p-3">
                    <span className="mb-2 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">User preview</span>
                    <textarea
                      readOnly
                      value={preview.promptPreview.userPrompt}
                      data-testid={`preset-compat-preview-user-${preview.surfaceId}`}
                      className="h-28 w-full rounded-2xl border border-white/10 bg-[#090b10] px-4 py-3 text-xs leading-6 text-zinc-200 outline-none"
                    />
                  </label>
                </div>

                {preview.promptPreview.macroDiagnostics.length ? (
                  <div className="mt-3 rounded-[18px] border border-rose-300/18 bg-rose-500/8 p-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-rose-100/80">Macro diagnostics</p>
                    <ul className="mt-2 space-y-2 text-xs leading-5 text-rose-100">
                      {preview.promptPreview.macroDiagnostics.map((diagnostic, index) => (
                        <li
                          key={`${preview.surfaceId}-${diagnostic.code}-${diagnostic.macroName ?? index}`}
                          data-testid={`preset-compat-macro-diagnostic-${preview.surfaceId}-${index}`}
                        >
                          <span className="font-mono text-[11px]">{diagnostic.code}</span>
                          <span className="mx-2 text-rose-200/60">·</span>
                          <span>{diagnostic.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {preview.promptPreview.warnings.length ? (
                  <div className="mt-3 rounded-[18px] border border-amber-300/18 bg-amber-500/8 p-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-amber-100/80">Runtime warnings</p>
                    <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-100">
                      {preview.promptPreview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                  </div>
                ) : null}

                <div className="mt-4 overflow-hidden rounded-[18px] border border-white/8">
                  <div className="grid grid-cols-[minmax(0,1.3fr)_88px_minmax(0,1.8fr)] gap-3 border-b border-white/8 bg-white/[0.03] px-4 py-2 text-[11px] uppercase tracking-[0.14em] text-zinc-500">
                    <span>字段</span>
                    <span>状态</span>
                    <span>原因</span>
                  </div>
                  <div className="divide-y divide-white/6">
                    {preview.runtime.fieldStatuses.length ? preview.runtime.fieldStatuses.map((status, index) => (
                      <div
                        key={`${preview.surfaceId}-${status.field}-${status.fragmentId ?? index}`}
                        className="grid grid-cols-[minmax(0,1.3fr)_88px_minmax(0,1.8fr)] gap-3 px-4 py-3 text-sm"
                        data-testid={`preset-compat-status-row-${preview.surfaceId}-${status.field}-${index}`}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-mono text-[12px] text-zinc-100">{status.field}</p>
                          {status.fragmentName ? <p className="mt-1 truncate text-xs text-zinc-500">{status.fragmentName}</p> : null}
                        </div>
                        <div>
                          <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px]', STATUS_BADGE_CLASS_NAMES[status.status])}>
                            {STATUS_LABELS[status.status]}
                          </span>
                        </div>
                        <div className="min-w-0 text-xs leading-5 text-zinc-300">
                          <p>{getReasonText(status)}</p>
                          {status.providerIntent ? (
                            <p className="mt-1 text-zinc-500">
                              {formatProviderLabel(status.providerIntent.provider)} · {status.providerIntent.target} → {status.providerIntent.path}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    )) : (
                      <div className="px-4 py-4 text-sm text-zinc-400">当前预设在这个界面上没有需要展示的运行时状态。</div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-4 rounded-[20px] border border-rose-300/18 bg-rose-500/8 p-4">
          <p className="text-[11px] uppercase tracking-[0.16em] text-rose-100/80">Fail-closed surfaces</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {failClosedSurfacePreviews.map((preview) => (
              <div key={preview.surfaceId} className="rounded-[18px] border border-white/8 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-zinc-100">{SURFACE_LABELS[preview.surfaceId]}</p>
                  <span className="rounded-full border border-rose-400/20 bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-100">不提供重置</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-zinc-400">
                  {preview.runtime.fieldStatuses.length
                    ? `${preview.runtime.fieldStatuses.length} 条状态会按 fail-closed 契约阻断创作字段。`
                    : '这个界面当前没有可展示的兼容字段。'}
                </p>
              </div>
            ))}
          </div>
        </div>
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
