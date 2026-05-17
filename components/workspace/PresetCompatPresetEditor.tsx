"use client"

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  PRESET_COMPAT_OPTED_IN_SURFACE_IDS,
} from '@/lib/preset-compat/surface-contract'
import { buildPresetCompatCreativeRuntimePreview } from '@/lib/preset-compat/creative-runtime-preview'
import { resolvePresetCompatRuntime } from '@/lib/preset-compat/resolve-runtime'
import {
  PRESET_COMPAT_CREATIVE_SURFACE_IDS,
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

type PresetCompatPresetEditorProps = {
  activeSurfaceId?: PresetCompatSurfaceId | null
  activeSelection?: PresetCompatSessionWorkspaceSelection | null
  preset: PresetCompatPresetRecord
  library: PresetCompatLibrary
  onBindSurface: (surfaceId: PresetCompatSurfaceId, presetId: string | null) => void
  onUpdatePromptRule: (promptRuleId: string, updates: Partial<PresetCompatPromptRule>) => void
  onUpdateEmbeddedRegex: (regexId: string, updates: Partial<PresetCompatRegexRecord>) => void
  onUpdateRuntimeSampler: (updates: Partial<PresetCompatPresetRecord['runtimeSampler']>) => void
  onUpdateTransport: (updates: Partial<PresetCompatPresetRecord['transport']>) => void
  onUpdateStandaloneRegex: (regexId: string, updates: Partial<PresetCompatRegexRecord>) => void
  onToggleStandaloneRegexAttachment: (regexId: string) => void
  onDeletePreset: () => void
  onExportPreset: () => void
}

type SurfaceRuntimePreview = {
  surfaceId: PresetCompatSurfaceId
  promptPreview: {
    systemPrompt: string
    userPrompt: string
  }
  sessionPhase: PresetCompatSessionPhase
  resetPending: boolean
  canReset: boolean
}

const INITIAL_DEFERRED_PROMPT_RULE_BATCH = 4
const DEFERRED_PROMPT_RULE_BATCH_SIZE = 8
const DEFERRED_PROMPT_RULE_INITIAL_DELAY_MS = 150
const DEFERRED_PROMPT_RULE_BATCH_DELAY_MS = 32
const SURFACE_PREVIEW_BATCH_SIZE = 2
const SURFACE_PREVIEW_BATCH_DELAY_MS = 64

type PreviewGenerationStatus = 'idle' | 'generating' | 'ready'

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

function formatSurfaceSelectionLabel(selection: PresetCompatSessionWorkspaceSelection | null | undefined) {
  if (!selection) return '当前工作区上下文'
  if (selection.kind === 'chapter') return `章节 ${selection.chapterId}`
  if (selection.kind === 'what_if') return `What-if ${selection.sessionId}`
  return `Future Jump ${selection.runId}`
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
  locked: boolean,
  onUpdatePromptRule: (promptRuleId: string, updates: Partial<PresetCompatPromptRule>) => void
) {
  if (locked) {
    return
  }

  onUpdatePromptRule(promptRuleId, { content: event.target.value })
}

function parseNullableNumber(rawValue: string) {
  const trimmed = rawValue.trim()
  if (!trimmed) {
    return null
  }

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function updateRuntimeSamplerNumberField(
  event: ChangeEvent<HTMLInputElement>,
  field: keyof Pick<
    PresetCompatPresetRecord['runtimeSampler'],
    'openaiMaxContext' | 'maxTokens' | 'temperature' | 'frequencyPenalty' | 'presencePenalty' | 'topP'
  >,
  onUpdateRuntimeSampler: (updates: Partial<PresetCompatPresetRecord['runtimeSampler']>) => void
) {
  onUpdateRuntimeSampler({ [field]: parseNullableNumber(event.target.value) })
}

function updateTransportStreamField(
  event: ChangeEvent<HTMLSelectElement>,
  onUpdateTransport: (updates: Partial<PresetCompatPresetRecord['transport']>) => void
) {
  const nextValue = event.target.value === '' ? null : event.target.value === 'true'
  onUpdateTransport({ streamOpenAI: nextValue })
}

export function PresetCompatPresetEditor({
  activeSurfaceId = null,
  activeSelection = null,
  preset,
  library,
  onBindSurface,
  onUpdatePromptRule,
  onUpdateEmbeddedRegex,
  onUpdateRuntimeSampler,
  onUpdateTransport,
  onUpdateStandaloneRegex,
  onToggleStandaloneRegexAttachment,
  onDeletePreset,
  onExportPreset,
}: PresetCompatPresetEditorProps) {
  const [surfacePreviews, setSurfacePreviews] = useState<SurfaceRuntimePreview[]>([])
  const [previewGenerationStatus, setPreviewGenerationStatus] = useState<PreviewGenerationStatus>('idle')
  const [visibleDeferredPromptRuleCount, setVisibleDeferredPromptRuleCount] = useState(0)
  const previewGenerationIdRef = useRef(0)
  const previewBatchTimerRef = useRef<number | null>(null)
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
  const [firstPromptRule, ...deferredPromptRules] = preset.promptRules
  const activeSelectionLabel = formatSurfaceSelectionLabel(effectiveSelection)
  const effectiveActiveSurfaceId = resolveActiveSurfaceFromSessionState({
    activeSelection: effectiveSelection,
    presetCompatSessionState,
    explicitActiveSurfaceId: activeSurfaceId,
  })
  const activeSurfaceLabel = effectiveActiveSurfaceId ? SURFACE_LABELS[effectiveActiveSurfaceId] : null
  const orderedPreviewSurfaceIds = useMemo(() => {
    const prioritizedSurfaceId = effectiveActiveSurfaceId ?? 'rewrite'
    return [
      prioritizedSurfaceId,
      ...PRESET_COMPAT_OPTED_IN_SURFACE_IDS.filter((surfaceId) => surfaceId !== prioritizedSurfaceId),
    ]
  }, [effectiveActiveSurfaceId])

  const cancelPendingPreviewGeneration = () => {
    previewGenerationIdRef.current += 1
    if (previewBatchTimerRef.current !== null) {
      window.clearTimeout(previewBatchTimerRef.current)
      previewBatchTimerRef.current = null
    }
  }

  const handleGenerateSurfacePreviews = () => {
    cancelPendingPreviewGeneration()
    setSurfacePreviews([])
    setPreviewGenerationStatus('generating')

    const generationId = previewGenerationIdRef.current
    const previewLibraryBase = library
    const previewSurfaceIds = [...orderedPreviewSurfaceIds]
    const providerDefaults = buildProviderDefaults(rewriteAISettings)
    const selectionForPreview = effectiveSelection
    const activeSurfaceForPreview = effectiveActiveSurfaceId
    const sessionStateForPreview = presetCompatSessionState
    const presetId = preset.id

    const appendPreviewBatch = (startIndex: number) => {
      if (previewGenerationIdRef.current !== generationId) {
        return
      }

      const nextSurfaceIds = previewSurfaceIds.slice(startIndex, startIndex + SURFACE_PREVIEW_BATCH_SIZE)
      const nextPreviews = nextSurfaceIds.map((surfaceId) => {
        const sessionEntry = selectionForPreview
          ? sessionStateForPreview[createPresetCompatSessionStateKey(selectionForPreview, surfaceId)] ?? null
          : null
        const sessionPhase = getPreviewSessionPhase(surfaceId, sessionEntry?.phase ?? null)
        const previewLibrary: PresetCompatLibrary = {
          ...previewLibraryBase,
          surfaceBindings: {
            ...previewLibraryBase.surfaceBindings,
            [surfaceId]: {
              ...previewLibraryBase.surfaceBindings[surfaceId],
              presetId,
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
          promptPreview: {
            systemPrompt: promptPreview.systemPrompt,
            userPrompt: promptPreview.userPrompt,
          },
          sessionPhase,
          resetPending: sessionEntry?.resetPending ?? false,
          canReset: Boolean(selectionForPreview && activeSurfaceForPreview && surfaceId === activeSurfaceForPreview),
        }
      })

      setSurfacePreviews((currentPreviews) => startIndex === 0 ? nextPreviews : [...currentPreviews, ...nextPreviews])

      const nextIndex = startIndex + SURFACE_PREVIEW_BATCH_SIZE
      if (nextIndex >= previewSurfaceIds.length) {
        previewBatchTimerRef.current = null
        setPreviewGenerationStatus('ready')
        return
      }

      previewBatchTimerRef.current = window.setTimeout(() => {
        appendPreviewBatch(nextIndex)
      }, SURFACE_PREVIEW_BATCH_DELAY_MS)
    }

    previewBatchTimerRef.current = window.setTimeout(() => {
      appendPreviewBatch(0)
    }, 0)
  }

  useEffect(() => {
    cancelPendingPreviewGeneration()
    setSurfacePreviews([])
    setPreviewGenerationStatus('idle')
    setVisibleDeferredPromptRuleCount(0)

    let deferredRulesTimer: number | null = null

    const deferredRulesInitialTimer = window.setTimeout(() => {
      deferredRulesTimer = window.setTimeout(() => {
        setVisibleDeferredPromptRuleCount(Math.min(INITIAL_DEFERRED_PROMPT_RULE_BATCH, deferredPromptRules.length))
      }, DEFERRED_PROMPT_RULE_INITIAL_DELAY_MS)
    }, 0)

    return () => {
      window.clearTimeout(deferredRulesInitialTimer)
      if (deferredRulesTimer !== null) {
        window.clearTimeout(deferredRulesTimer)
      }
    }
  }, [preset.id])

  useEffect(() => {
    if (visibleDeferredPromptRuleCount === 0 || visibleDeferredPromptRuleCount >= deferredPromptRules.length) {
      return
    }

    const nextBatchTimer = window.setTimeout(() => {
      setVisibleDeferredPromptRuleCount((currentCount) => Math.min(currentCount + DEFERRED_PROMPT_RULE_BATCH_SIZE, deferredPromptRules.length))
    }, DEFERRED_PROMPT_RULE_BATCH_DELAY_MS)

    return () => {
      window.clearTimeout(nextBatchTimer)
    }
  }, [deferredPromptRules.length, visibleDeferredPromptRuleCount])

  useEffect(() => {
    return () => {
      cancelPendingPreviewGeneration()
    }
  }, [])

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
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">生成设置</p>
        <p className="mt-2 text-sm leading-6 text-zinc-400">这些值会直接写回预设记录，并随现有保存与导出路径一起持久化。</p>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="block rounded-[20px] border border-white/8 bg-[#0b0d12] p-3">
            <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">Context length</span>
            <input
              type="number"
              min={0}
              data-testid="preset-compat-runtime-openai-max-context"
              value={preset.runtimeSampler.openaiMaxContext ?? ''}
              onChange={(event) => updateRuntimeSamplerNumberField(event, 'openaiMaxContext', onUpdateRuntimeSampler)}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none"
            />
          </label>
          <label className="block rounded-[20px] border border-white/8 bg-[#0b0d12] p-3">
            <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">Max reply length</span>
            <input
              type="number"
              min={0}
              data-testid="preset-compat-runtime-max-tokens"
              value={preset.runtimeSampler.maxTokens ?? ''}
              onChange={(event) => updateRuntimeSamplerNumberField(event, 'maxTokens', onUpdateRuntimeSampler)}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none"
            />
          </label>
          <label className="block rounded-[20px] border border-white/8 bg-[#0b0d12] p-3">
            <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">Temperature</span>
            <input
              type="number"
              step="0.01"
              data-testid="preset-compat-runtime-temperature"
              value={preset.runtimeSampler.temperature ?? ''}
              onChange={(event) => updateRuntimeSamplerNumberField(event, 'temperature', onUpdateRuntimeSampler)}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none"
            />
          </label>
          <label className="block rounded-[20px] border border-white/8 bg-[#0b0d12] p-3">
            <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">Top P</span>
            <input
              type="number"
              step="0.01"
              data-testid="preset-compat-runtime-top-p"
              value={preset.runtimeSampler.topP ?? ''}
              onChange={(event) => updateRuntimeSamplerNumberField(event, 'topP', onUpdateRuntimeSampler)}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none"
            />
          </label>
          <label className="block rounded-[20px] border border-white/8 bg-[#0b0d12] p-3">
            <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">Frequency penalty</span>
            <input
              type="number"
              step="0.01"
              data-testid="preset-compat-runtime-frequency-penalty"
              value={preset.runtimeSampler.frequencyPenalty ?? ''}
              onChange={(event) => updateRuntimeSamplerNumberField(event, 'frequencyPenalty', onUpdateRuntimeSampler)}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none"
            />
          </label>
          <label className="block rounded-[20px] border border-white/8 bg-[#0b0d12] p-3">
            <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">Presence penalty</span>
            <input
              type="number"
              step="0.01"
              data-testid="preset-compat-runtime-presence-penalty"
              value={preset.runtimeSampler.presencePenalty ?? ''}
              onChange={(event) => updateRuntimeSamplerNumberField(event, 'presencePenalty', onUpdateRuntimeSampler)}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none"
            />
          </label>
          <label className="block rounded-[20px] border border-white/8 bg-[#0b0d12] p-3">
            <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">Stream</span>
            <select
              data-testid="preset-compat-transport-stream-openai"
              value={preset.transport.streamOpenAI === null ? '' : String(preset.transport.streamOpenAI)}
              onChange={(event) => updateTransportStreamField(event, onUpdateTransport)}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none"
            >
              <option value="">未设置</option>
              <option value="true">开启</option>
              <option value="false">关闭</option>
            </select>
          </label>
        </div>
      </div>

      <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">运行时 Prompt 预览</p>
            <p className="mt-2 text-sm leading-6 text-zinc-400">这里展示 {activeSelectionLabel} 下各创作界面的当前 prompt 结果。重置只作用于临时 preset-session 状态，不会改动全局预设库或账户设置。</p>
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
          <div className="rounded-[20px] border border-white/8 bg-[#0b0d12] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm leading-6 text-zinc-400">
                预览不会在进入编辑器时自动计算。需要时手动生成，避免大型预设阻塞首屏与首条规则编辑。
              </p>
              <button
                type="button"
                data-testid="preset-compat-preview-generate"
                onClick={handleGenerateSurfacePreviews}
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-2 text-sm text-zinc-100 transition hover:bg-white/[0.06]"
              >
                {previewGenerationStatus === 'idle' ? '生成预览' : previewGenerationStatus === 'generating' ? '刷新预览中…' : '刷新预览'}
              </button>
            </div>
          </div>

          {surfacePreviews.length > 0 ? surfacePreviews.map((preview) => {
            return (
              <div
                key={preview.surfaceId}
                className="rounded-[22px] border border-white/8 bg-[#0b0d12] p-4"
                data-testid={`preset-compat-preview-surface-${preview.surfaceId}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-zinc-100">{SURFACE_LABELS[preview.surfaceId]}</p>
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
              </div>
            )
          }) : previewGenerationStatus === 'generating' ? (
            <div className="rounded-[20px] border border-white/8 bg-[#0b0d12] p-4 text-sm text-zinc-400">
              正在生成运行时预览…
            </div>
          ) : (
            <div className="rounded-[20px] border border-dashed border-white/8 bg-[#0b0d12] p-4 text-sm text-zinc-500">
              点击“生成预览”后，会按当前创作界面优先生成运行时 prompt 预览。
            </div>
          )}
        </div>
      </div>

      <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">提示词规则</p>
        <div className="mt-4 space-y-3">
          {firstPromptRule ? (() => {
            const activeOnSurfaceCount = PRESET_COMPAT_OPTED_IN_SURFACE_IDS.filter((surfaceId) => preset.promptOrderLists[surfaceId]?.includes(firstPromptRule.id)).length

            return (
              <div key={firstPromptRule.id} className="rounded-[22px] border border-white/8 bg-[#0b0d12] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-zinc-100">{firstPromptRule.name}</p>
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">角色：{firstPromptRule.role}</span>
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">已在 {activeOnSurfaceCount} 个界面生效</span>
                    </div>
                  </div>

                  <label className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      data-testid={`preset-compat-rule-toggle-${firstPromptRule.id}`}
                      checked={firstPromptRule.enabled}
                      onChange={(event) => onUpdatePromptRule(firstPromptRule.id, { enabled: event.target.checked })}
                      className="h-3.5 w-3.5 rounded border-white/20 bg-transparent"
                    />
                    启用
                  </label>
                </div>

                <label className="mt-3 block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">内容</span>
                  <textarea
                    data-testid={`preset-compat-rule-content-${firstPromptRule.id}`}
                    value={firstPromptRule.content}
                    disabled={firstPromptRule.forbidOverrides}
                    onChange={(event) => handleRuleContentChange(event, firstPromptRule.id, firstPromptRule.forbidOverrides, onUpdatePromptRule)}
                    className="h-28 w-full rounded-[20px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none disabled:cursor-not-allowed disabled:text-zinc-500"
                  />
                </label>
              </div>
            )
          })() : null}

          {deferredPromptRules.slice(0, visibleDeferredPromptRuleCount).map((rule) => {
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

                <label className="mt-3 block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">内容</span>
                  <textarea
                    data-testid={`preset-compat-rule-content-${rule.id}`}
                    value={rule.content}
                    disabled={rule.forbidOverrides}
                    onChange={(event) => handleRuleContentChange(event, rule.id, rule.forbidOverrides, onUpdatePromptRule)}
                    className="h-28 w-full rounded-[20px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none disabled:cursor-not-allowed disabled:text-zinc-500"
                  />
                </label>
              </div>
            )
          })}

          {visibleDeferredPromptRuleCount < deferredPromptRules.length ? (
            <div className="rounded-[20px] border border-white/8 bg-[#0b0d12] p-4 text-sm text-zinc-400">
              其余 {deferredPromptRules.length - visibleDeferredPromptRuleCount} 条规则正在就绪…
            </div>
          ) : null}
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
