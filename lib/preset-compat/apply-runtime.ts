import type { PresetCompatRegexRecord, PresetCompatSurfaceId } from '@/lib/preset-compat/types'
import { runPresetCompatRegexRuntime } from '@/lib/preset-compat/regex-runtime'
import {
  resolvePresetCompatRuntime,
  type PresetCompatResolvedRuntime,
  type PresetCompatRuntimeProviderDefaults,
} from '@/lib/preset-compat/resolve-runtime'
import { loadStoredPresetCompatLibrary } from '@/lib/server/preset-compat-library'

const IMPORTED_PRESET_USER_RULES_HEADING = '## Imported Preset User Rules'
const IMPORTED_PRESET_SYSTEM_RULES_HEADING = '## Imported Preset System Rules'

export type PresetCompatCreativeRuntime = {
  resolvedRuntime: PresetCompatResolvedRuntime
  systemPrompt: string
  userPrompt: string
  warnings: string[]
  hasActiveOutputRegex: boolean
  applyOutputRuntime: (value: string) => {
    value: string
    warnings: string[]
    appliedRuleIds: string[]
    skippedRuleIds: string[]
  }
}

function buildImportedRulesSection(heading: string, contents: string[]) {
  const trimmedContents = contents.map((content) => content.trim()).filter(Boolean)
  if (!trimmedContents.length) {
    return ''
  }

  return [heading, ...trimmedContents].join('\n\n')
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
}) : PresetCompatCreativeRuntime {
  const library = loadStoredPresetCompatLibrary()
  const resolvedRuntime = resolvePresetCompatRuntime({
    library,
    surfaceId: params.surfaceId,
    providerDefaults: params.providerDefaults,
  })

  const standalone = resolvedRuntime.activePreset
    ? resolvedRuntime.activePreset.attachedStandaloneRegexIds
        .map((regexId) => library.standaloneRegexes[regexId])
        .filter((regex): regex is PresetCompatRegexRecord => Boolean(regex))
    : []
  const embedded = resolvedRuntime.activePreset?.embeddedRegexes ?? []
  const systemRuleSection = buildImportedRulesSection(
    IMPORTED_PRESET_SYSTEM_RULES_HEADING,
    resolvedRuntime.promptRules.system.map((rule) => rule.content)
  )
  const userRuleSection = buildImportedRulesSection(
    IMPORTED_PRESET_USER_RULES_HEADING,
    resolvedRuntime.promptRules.user.map((rule) => rule.content)
  )
  const systemPrompt = [params.systemPrompt.trim(), systemRuleSection].filter(Boolean).join('\n\n')
  const userPromptBeforeRegex = [userRuleSection, params.userPrompt.trim()].filter(Boolean).join('\n\n')
  const inputRuntime = runPresetCompatRegexRuntime({
    value: userPromptBeforeRegex,
    phase: 'user_input',
    standalone,
    embedded,
    isPrompt: true,
  })

  return {
    resolvedRuntime,
    systemPrompt,
    userPrompt: inputRuntime.value,
    warnings: [...resolvedRuntime.warnings, ...inputRuntime.warnings],
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
