import type { PresetCompatRegexRecord, PresetCompatSurfaceId } from '@/lib/preset-compat/types'
import type { PresetCompatPromptRuleRuntimeContext } from '@/lib/preset-compat/types'
import { buildPresetCompatCreativeRuntimePreview } from '@/lib/preset-compat/creative-runtime-preview'
import { runPresetCompatRegexRuntime } from '@/lib/preset-compat/regex-runtime'
import {
  resolvePresetCompatRuntime,
  type PresetCompatResolvedRuntime,
  type PresetCompatRuntimeProviderDefaults,
} from '@/lib/preset-compat/resolve-runtime'
import type { PresetCompatRuntimeMetadata } from '@/lib/preset-compat/runtime-integration'
import { loadStoredPresetCompatLibrary } from '@/lib/server/preset-compat-library'

export type PresetCompatCreativeRuntime = {
  resolvedRuntime: PresetCompatResolvedRuntime
  systemPrompt: string
  userPrompt: string
  warnings: string[]
  metadata: PresetCompatRuntimeMetadata
  hasActiveOutputRegex: boolean
  applyOutputRuntime: (value: string) => {
    value: string
    warnings: string[]
    appliedRuleIds: string[]
    skippedRuleIds: string[]
  }
}

function hasActiveAssistantOutputRegex(rules: readonly PresetCompatRegexRecord[]) {
  return rules.some((rule) => {
    if (rule.disabled || rule.promptOnly || rule.markdownOnly) {
      return false
    }

    if (!rule.placements.includes('assistant_output')) {
      return false
    }

    const substituteRegex = String(rule.substituteRegex ?? '').trim()
    return !substituteRegex || substituteRegex === '0'
  })
}

export function applyPresetCompatCreativeRuntime(params: {
  surfaceId: PresetCompatSurfaceId
  providerDefaults: PresetCompatRuntimeProviderDefaults
  systemPrompt: string
  userPrompt: string
  promptRuleRuntimeContext?: PresetCompatPromptRuleRuntimeContext
}) : PresetCompatCreativeRuntime {
  const library = loadStoredPresetCompatLibrary()
  const resolvedRuntime = resolvePresetCompatRuntime({
    library,
    surfaceId: params.surfaceId,
    providerDefaults: params.providerDefaults,
    promptRuleRuntimeContext: params.promptRuleRuntimeContext,
  })

  const standalone = resolvedRuntime.activePreset
    ? resolvedRuntime.activePreset.attachedStandaloneRegexIds
        .map((regexId) => library.standaloneRegexes[regexId])
        .filter((regex): regex is PresetCompatRegexRecord => Boolean(regex))
    : []
  const embedded = resolvedRuntime.activePreset?.embeddedRegexes ?? []
  const promptPreview = buildPresetCompatCreativeRuntimePreview({
    surfaceId: params.surfaceId,
    resolvedRuntime,
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    standalone,
    embedded,
  })

  return {
    resolvedRuntime,
    systemPrompt: promptPreview.systemPrompt,
    userPrompt: promptPreview.userPrompt,
    warnings: promptPreview.warnings,
    metadata: promptPreview.metadata,
    hasActiveOutputRegex: hasActiveAssistantOutputRegex([...standalone, ...embedded]),
    applyOutputRuntime(value: string) {
      return runPresetCompatRegexRuntime({
        value,
        phase: 'assistant_output',
        standalone,
        embedded,
      })
    },
  }
}
