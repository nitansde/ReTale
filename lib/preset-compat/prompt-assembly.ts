import { processPresetCompatMacroString } from '@/lib/preset-compat/macro-processor'
import type { PresetCompatResolvedRuntime } from '@/lib/preset-compat/resolve-runtime'
import {
  createPresetCompatRuntimeMacroProcessing,
  createPresetCompatRuntimeMetadata,
  type PresetCompatRuntimeMacroProcessing,
  type PresetCompatRuntimeMetadata,
} from '@/lib/preset-compat/runtime-integration'
import type { PresetCompatSurfaceId } from '@/lib/preset-compat/types'

const IMPORTED_PRESET_USER_RULES_HEADING = '## Imported Preset User Rules'
const IMPORTED_PRESET_SYSTEM_RULES_HEADING = '## Imported Preset System Rules'

export type PresetCompatPromptAssemblyResult = {
  systemPrompt: string
  userPrompt: string
  metadata: PresetCompatRuntimeMetadata
}

function buildImportedRulesSection(heading: string, contents: string[]) {
  const trimmedContents = contents.map((content) => content.trim()).filter(Boolean)
  if (!trimmedContents.length) {
    return ''
  }

  return [heading, ...trimmedContents].join('\n\n')
}

export function assemblePresetCompatRuntimePrompts(params: {
  surfaceId: PresetCompatSurfaceId
  resolvedRuntime: PresetCompatResolvedRuntime
  systemPrompt: string
  userPrompt: string
  macroProcessing?: PresetCompatRuntimeMacroProcessing
}) : PresetCompatPromptAssemblyResult {
  const macroProcessing = params.macroProcessing ?? createPresetCompatRuntimeMacroProcessing({
    surfaceId: params.surfaceId,
    resolvedRuntime: params.resolvedRuntime,
  })
  const systemRuleSection = buildImportedRulesSection(
    IMPORTED_PRESET_SYSTEM_RULES_HEADING,
    params.resolvedRuntime.promptRules.system.map((rule) => rule.content)
  )
  const userRuleSection = buildImportedRulesSection(
    IMPORTED_PRESET_USER_RULES_HEADING,
    params.resolvedRuntime.promptRules.user.map((rule) => rule.content)
  )
  const assembledSystemPrompt = [params.systemPrompt.trim(), systemRuleSection].filter(Boolean).join('\n\n')
  const assembledUserPrompt = [userRuleSection, params.userPrompt.trim()].filter(Boolean).join('\n\n')

  return {
    systemPrompt: processPresetCompatMacroString(assembledSystemPrompt, macroProcessing),
    userPrompt: processPresetCompatMacroString(assembledUserPrompt, macroProcessing),
    metadata: createPresetCompatRuntimeMetadata(macroProcessing),
  }
}
