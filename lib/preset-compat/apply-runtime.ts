import type {
  PresetCompatPromptRuleRuntimeContext,
  PresetCompatRegexRecord,
  PresetCompatSurfaceId,
} from '@/lib/preset-compat/types'
import {
  assemblePresetCompatPrompts,
  type PresetCompatPromptAssemblyMetadata,
} from '@/lib/preset-compat/prompt-assembly'
import { runPresetCompatRegexRuntime } from '@/lib/preset-compat/regex-runtime'
import {
  resolvePresetCompatRuntime,
  type PresetCompatResolvedRuntime,
  type PresetCompatRuntimeProviderDefaults,
} from '@/lib/preset-compat/resolve-runtime'
import { loadStoredPresetCompatLibrary } from '@/lib/server/preset-compat-library'

export type PresetCompatCreativeRuntime = {
  resolvedRuntime: PresetCompatResolvedRuntime
  systemPrompt: string
  userPrompt: string
  warnings: string[]
  promptAssembly: PresetCompatPromptAssemblyMetadata
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
  const assembledPrompts = assemblePresetCompatPrompts({
    baseSystemPrompt: params.systemPrompt,
    baseUserPrompt: params.userPrompt,
    systemTemplateFragments: resolvedRuntime.templateFragments.system.map((fragment) => fragment.text),
    userTemplateFragments: resolvedRuntime.templateFragments.user.map((fragment) => fragment.text),
    surfaceContextBlocks: params.promptRuleRuntimeContext?.surfaceContextBlocks?.map((block) => ({
      id: block.id,
      content: block.content,
      abstraction: block.abstraction,
    })),
    contextBlockFormats: resolvedRuntime.contextBlockFormats,
    namesBehavior: resolvedRuntime.namesBehavior,
    importedPromptRules: resolvedRuntime.promptRules.ordered.map((rule) => {
      const placement = rule.channel === 'system'
        ? 'append'
        : rule.injectionPosition === 'after'
          ? 'append'
          : 'prepend'

      return {
        channel: rule.channel,
        placement,
        text: rule.content,
      }
    }),
  })
  const inputRuntime = runPresetCompatRegexRuntime({
    value: assembledPrompts.userPromptBeforeRegex,
    phase: 'user_input',
    standalone,
    embedded,
    isPrompt: true,
  })

  return {
    resolvedRuntime,
    systemPrompt: assembledPrompts.systemPrompt,
    userPrompt: inputRuntime.value,
    warnings: [...resolvedRuntime.warnings, ...inputRuntime.warnings],
    promptAssembly: {
      ...assembledPrompts.metadata,
      user: {
        ...assembledPrompts.metadata.user,
        stages: assembledPrompts.metadata.user.stages.map((stage) => stage.stage === 'regex_processing'
          ? {
              stage: 'regex_processing',
              status: 'applied',
              segmentCount: inputRuntime.appliedRuleIds.length + inputRuntime.skippedRuleIds.length,
            }
          : stage),
      },
    },
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
