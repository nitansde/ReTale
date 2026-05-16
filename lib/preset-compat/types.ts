export const PRESET_COMPAT_LIBRARY_SCHEMA_VERSION = 1
export const PRESET_COMPAT_LIBRARY_INITIAL_REVISION = 0
export const PRESET_COMPAT_SOURCE_API_ID = 'openai' as const

export const PRESET_COMPAT_CREATIVE_SURFACE_IDS = [
  'rewrite',
  'expand',
  'roleplay',
  'polish',
  'continue',
  'future_jump_rewrite',
] as const

export const PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS = [
  'future_jump_bridge',
  'what_if_delta_extraction',
  'knowledge_extraction',
  'embeddings',
] as const

export const PRESET_COMPAT_SURFACE_IDS = [
  ...PRESET_COMPAT_CREATIVE_SURFACE_IDS,
  ...PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS,
] as const

export type PresetCompatRuntimePromptRuleRole = 'system' | 'user'

export type PresetCompatPromptRuleRole = PresetCompatRuntimePromptRuleRole | (string & {})

export type PresetCompatPromptRuleInjectionPosition = 'before' | 'after' | 'in_chat' | 'none'

export type PresetCompatPromptRule = {
  id: string
  name: string
  role: PresetCompatPromptRuleRole
  content: string
  enabled: boolean
  marker: boolean
  injectAsSystemPrompt: boolean
  injectionPosition: PresetCompatPromptRuleInjectionPosition
  injectionDepth: number | null
  injectionOrder: number | null
  injectionTrigger: string | null
  forbidOverrides: boolean
  condition: string | null
  passthrough: Record<string, unknown>
}

export type PresetCompatRegexPlacement =
  | 'user_input'
  | 'assistant_output'
  | 'slash_command'
  | 'world_info'
  | 'reasoning'
  | 'md_display'

export type PresetCompatRegexRecord = {
  id: string
  name: string
  pattern: string
  replacement: string
  flags: string
  disabled: boolean
  placements: PresetCompatRegexPlacement[]
  trimStrings: string[]
  promptOnly: boolean
  markdownOnly: boolean
  minDepth: number | null
  maxDepth: number | null
  substituteRegex: string | null
  runOnEdit: boolean
  passthrough: Record<string, unknown>
}

export type PresetCompatSurfaceId = (typeof PRESET_COMPAT_SURFACE_IDS)[number]

export type PresetCompatSurfaceBinding = {
  surfaceId: PresetCompatSurfaceId
  presetId: string | null
  enabled: boolean
  failClosed: boolean
}

export type PresetCompatRuntimeSnapshot = {
  activePresetId: string | null
  activeSurfaceId: PresetCompatSurfaceId | null
  importedAt: string | null
  warnings: string[]
}

export type PresetCompatPresetRecord = {
  id: string
  name: string
  sourceApiId: typeof PRESET_COMPAT_SOURCE_API_ID
  promptRules: PresetCompatPromptRule[]
  promptOrderLists: Partial<Record<PresetCompatSurfaceId, string[]>>
  embeddedRegexes: PresetCompatRegexRecord[]
  attachedStandaloneRegexIds: string[]
  runtimeSampler: {
    temperature: number | null
    topP: number | null
    topK: number | null
    minP: number | null
    presencePenalty: number | null
    frequencyPenalty: number | null
    repetitionPenalty: number | null
    maxTokens: number | null
  }
  passthrough: Record<string, unknown>
  importWarnings: string[]
  createdAt: string
  updatedAt: string
}

export type PresetCompatLibrary = {
  schemaVersion: number
  revision: number
  presets: Record<string, PresetCompatPresetRecord>
  standaloneRegexes: Record<string, PresetCompatRegexRecord>
  surfaceBindings: Record<PresetCompatSurfaceId, PresetCompatSurfaceBinding>
  lastImportedAt: string | null
  lastExportedAt: string | null
}
