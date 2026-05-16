import type {
  AIProvider,
  AIScenarioSettings,
  OllamaProviderSettings,
  OpenAICompatibleProviderSettings,
} from '@/lib/types'
import {
  PRESET_COMPAT_PROMPT_RULE_PRESERVED_ONLY_FIELDS,
  PRESET_COMPAT_PROMPT_RULE_SUPPORTED_ROLES,
  getPresetCompatProviderCapability,
  isPresetCompatImageRequestField,
  isPresetCompatPreservedOnlyField,
  type PresetCompatProviderSamplerField,
} from '@/lib/preset-compat/capability-matrix'
import type {
  PresetCompatLibrary,
  PresetCompatPresetRecord,
  PresetCompatPromptRule,
  PresetCompatRuntimePromptRuleRole,
  PresetCompatRuntimeSnapshot,
  PresetCompatSurfaceId,
} from '@/lib/preset-compat/types'

type PresetCompatOpenAICompatibleRequest = Partial<{
  temperature: number
  top_p: number
  frequency_penalty: number
  presence_penalty: number
  max_tokens: number
}>

type PresetCompatOllamaRequestOptions = Partial<{
  temperature: number
  top_p: number
  top_k: number
  min_p: number
  repeat_penalty: number
  num_predict: number
  seed: number
}>

export type PresetCompatRuntimeProviderDefaults = {
  provider: AIProvider
  openAICompatible?: {
    config?: Partial<OpenAICompatibleProviderSettings>
    request?: PresetCompatOpenAICompatibleRequest
  }
  ollama?: {
    config?: Partial<OllamaProviderSettings>
    request?: PresetCompatOllamaRequestOptions
  }
}

export type PresetCompatRuntimeSessionOverrides = Partial<PresetCompatRuntimeProviderDefaults>

export type PresetCompatResolvedPromptRule = {
  id: string
  name: string
  role: PresetCompatRuntimePromptRuleRole
  content: string
  sourceIndex: number
  injectionOrder: number | null
}

export type PresetCompatResolvedPromptRuleSet = {
  ordered: PresetCompatResolvedPromptRule[]
  system: PresetCompatResolvedPromptRule[]
  user: PresetCompatResolvedPromptRule[]
}

export type PresetCompatResolvedProviderRuntime =
  | {
      provider: 'openai-compatible'
      config: Partial<OpenAICompatibleProviderSettings>
      request: PresetCompatOpenAICompatibleRequest
    }
  | {
      provider: 'ollama'
      config: Partial<OllamaProviderSettings>
      request: {
        options: PresetCompatOllamaRequestOptions
      }
    }

export type PresetCompatResolvedRuntime = {
  snapshot: PresetCompatRuntimeSnapshot
  activePreset: PresetCompatPresetRecord | null
  providerRuntime: PresetCompatResolvedProviderRuntime
  promptRules: PresetCompatResolvedPromptRuleSet
  warnings: string[]
  preservedSamplerFields: Record<string, unknown>
  preservedPromptMetadata: Array<{
    ruleId: string
    metadata: Partial<Record<(typeof PRESET_COMPAT_PROMPT_RULE_PRESERVED_ONLY_FIELDS)[number], unknown>>
  }>
}

type PresetCompatRuntimeContext = {
  preset: PresetCompatPresetRecord | null
  surfaceId: PresetCompatSurfaceId
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function getPresetRootPassthrough(preset: PresetCompatPresetRecord | null) {
  const root = preset?.passthrough.root
  return isRecord(root) ? root : {}
}

function getPresetExtensionsPassthrough(preset: PresetCompatPresetRecord | null) {
  const extensions = preset?.passthrough.extensions
  return isRecord(extensions) ? extensions : {}
}

function getPresetBoundToSurface(library: PresetCompatLibrary, surfaceId: PresetCompatSurfaceId) {
  const binding = library.surfaceBindings[surfaceId]
  if (!binding?.enabled || !binding.presetId) {
    return null
  }

  return library.presets[binding.presetId] ?? null
}

function pickNumericPresetFields(context: PresetCompatRuntimeContext) {
  const root = getPresetRootPassthrough(context.preset)

  return {
    temperature: context.preset?.runtimeSampler.temperature ?? null,
    top_p: context.preset?.runtimeSampler.topP ?? null,
    top_k: context.preset?.runtimeSampler.topK ?? null,
    min_p: context.preset?.runtimeSampler.minP ?? null,
    presence_penalty: context.preset?.runtimeSampler.presencePenalty ?? null,
    frequency_penalty: context.preset?.runtimeSampler.frequencyPenalty ?? null,
    repetition_penalty: context.preset?.runtimeSampler.repetitionPenalty ?? null,
    openai_max_tokens: context.preset?.runtimeSampler.maxTokens ?? null,
    seed: isFiniteNumber(root.seed) ? root.seed : null,
  } satisfies Partial<Record<PresetCompatProviderSamplerField, number | null>>
}

function mergeOpenAICompatibleRequest(
  defaults: PresetCompatOpenAICompatibleRequest | undefined,
  fromPreset: PresetCompatOpenAICompatibleRequest,
  overrides: PresetCompatOpenAICompatibleRequest | undefined
) {
  return {
    ...(defaults ?? {}),
    ...fromPreset,
    ...(overrides ?? {}),
  }
}

function mergeOllamaRequest(
  defaults: PresetCompatOllamaRequestOptions | undefined,
  fromPreset: PresetCompatOllamaRequestOptions,
  overrides: PresetCompatOllamaRequestOptions | undefined
) {
  return {
    ...(defaults ?? {}),
    ...fromPreset,
    ...(overrides ?? {}),
  }
}

function buildProviderWarnings(provider: AIProvider, context: PresetCompatRuntimeContext) {
  const warnings: string[] = []
  const preserved: Record<string, unknown> = {}
  const capability = getPresetCompatProviderCapability(provider)
  const root = getPresetRootPassthrough(context.preset)
  const extensions = getPresetExtensionsPassthrough(context.preset)
  const numericFields = pickNumericPresetFields(context)
  const numericFieldsByName = numericFields as Partial<Record<string, number | null>>

  for (const fieldName of capability.preservedOnlyFields) {
    const value = fieldName in numericFieldsByName
      ? numericFieldsByName[fieldName]
      : root[fieldName]

    if (value === null || typeof value === 'undefined') {
      continue
    }

    preserved[fieldName] = value
    warnings.push(`Preset field \`${fieldName}\` was preserved for export but not applied to ${provider}.`)
  }

  for (const [fieldName, value] of Object.entries(root)) {
    if (
      typeof value === 'undefined'
      || fieldName in capability.appliedFields
      || isPresetCompatPreservedOnlyField(fieldName)
      || numericFieldsByName[fieldName] === value
    ) {
      continue
    }

    if (isPresetCompatImageRequestField(fieldName)) {
      preserved[fieldName] = value
      warnings.push(`Preset image field \`${fieldName}\` was preserved for export but not applied to ${provider}.`)
    }
  }

  if (isRecord(extensions.SPreset)) {
    preserved.SPreset = extensions.SPreset
    warnings.push(`Preset extension \`SPreset\` was preserved for export but not applied to ${provider}.`)
  }

  return {
    warnings,
    preserved,
  }
}

function resolveOpenAICompatibleProviderRuntime(
  context: PresetCompatRuntimeContext,
  providerDefaults: PresetCompatRuntimeProviderDefaults,
  sessionOverrides: PresetCompatRuntimeSessionOverrides
): PresetCompatResolvedProviderRuntime {
  const fields = pickNumericPresetFields(context)

  return {
    provider: 'openai-compatible',
    config: {
      ...(providerDefaults.openAICompatible?.config ?? {}),
      ...(sessionOverrides.openAICompatible?.config ?? {}),
    },
    request: mergeOpenAICompatibleRequest(
      providerDefaults.openAICompatible?.request,
      {
        ...(isFiniteNumber(fields.temperature) ? { temperature: fields.temperature } : {}),
        ...(isFiniteNumber(fields.top_p) ? { top_p: fields.top_p } : {}),
        ...(isFiniteNumber(fields.frequency_penalty) ? { frequency_penalty: fields.frequency_penalty } : {}),
        ...(isFiniteNumber(fields.presence_penalty) ? { presence_penalty: fields.presence_penalty } : {}),
        ...(isFiniteNumber(fields.openai_max_tokens) ? { max_tokens: fields.openai_max_tokens } : {}),
      },
      sessionOverrides.openAICompatible?.request,
    ),
  }
}

function resolveOllamaProviderRuntime(
  context: PresetCompatRuntimeContext,
  providerDefaults: PresetCompatRuntimeProviderDefaults,
  sessionOverrides: PresetCompatRuntimeSessionOverrides
): PresetCompatResolvedProviderRuntime {
  const fields = pickNumericPresetFields(context)

  return {
    provider: 'ollama',
    config: {
      ...(providerDefaults.ollama?.config ?? {}),
      ...(sessionOverrides.ollama?.config ?? {}),
    },
    request: {
      options: mergeOllamaRequest(
        providerDefaults.ollama?.request,
        {
          ...(isFiniteNumber(fields.temperature) ? { temperature: fields.temperature } : {}),
          ...(isFiniteNumber(fields.top_p) ? { top_p: fields.top_p } : {}),
          ...(isFiniteNumber(fields.top_k) ? { top_k: fields.top_k } : {}),
          ...(isFiniteNumber(fields.min_p) ? { min_p: fields.min_p } : {}),
          ...(isFiniteNumber(fields.repetition_penalty) ? { repeat_penalty: fields.repetition_penalty } : {}),
          ...(isFiniteNumber(fields.openai_max_tokens) ? { num_predict: fields.openai_max_tokens } : {}),
          ...(isFiniteNumber(fields.seed) ? { seed: fields.seed } : {}),
        },
        sessionOverrides.ollama?.request,
      ),
    },
  }
}

function sortResolvedPromptRules(left: PresetCompatResolvedPromptRule, right: PresetCompatResolvedPromptRule) {
  const leftOrder = left.injectionOrder
  const rightOrder = right.injectionOrder

  if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) {
    return leftOrder - rightOrder
  }

  if (leftOrder !== null && rightOrder === null) {
    return -1
  }

  if (leftOrder === null && rightOrder !== null) {
    return 1
  }

  return left.sourceIndex - right.sourceIndex
}

function resolvePromptRules(preset: PresetCompatPresetRecord | null, surfaceId: PresetCompatSurfaceId) {
  const warnings: string[] = []
  const preservedPromptMetadata: PresetCompatResolvedRuntime['preservedPromptMetadata'] = []
  if (!preset) {
    return {
      promptRules: {
        ordered: [],
        system: [],
        user: [],
      } satisfies PresetCompatResolvedPromptRuleSet,
      warnings,
      preservedPromptMetadata,
    }
  }

  const activeIds = new Set(preset.promptOrderLists[surfaceId] ?? [])
  const ordered = preset.promptRules.flatMap((rule, sourceIndex) => {
    if (!activeIds.has(rule.id) || !rule.enabled) {
      return [] as PresetCompatResolvedPromptRule[]
    }

    const trimmedContent = rule.content.trim()
    const hasSupportedRole = PRESET_COMPAT_PROMPT_RULE_SUPPORTED_ROLES.includes(rule.role as PresetCompatRuntimePromptRuleRole)
    const wouldApplyRule = Boolean(trimmedContent) && !rule.marker && hasSupportedRole

    const metadata: PresetCompatResolvedRuntime['preservedPromptMetadata'][number]['metadata'] = {}
    for (const fieldName of PRESET_COMPAT_PROMPT_RULE_PRESERVED_ONLY_FIELDS) {
      const value = rule[fieldName]
      if (
        value === null
        || value === false
        || value === 'none'
        || typeof value === 'undefined'
      ) {
        continue
      }

      if (fieldName === 'injectionPosition' && value === 'before' && wouldApplyRule) {
        continue
      }

      metadata[fieldName] = value
    }

    if (Object.keys(metadata).length > 0) {
      preservedPromptMetadata.push({
        ruleId: rule.id,
        metadata,
      })
      if (wouldApplyRule) {
        warnings.push(
          `Prompt rule \`${rule.name}\` kept unsupported metadata (${Object.keys(metadata).join(', ')}) for export without applying it at runtime.`
        )
      }
    }

    if (!trimmedContent) {
      warnings.push(`Prompt rule \`${rule.name}\` was active but skipped because its content was empty.`)
      return [] as PresetCompatResolvedPromptRule[]
    }

    if (rule.marker) {
      warnings.push(`Prompt rule \`${rule.name}\` was active but skipped because marker prompts are preserved-only in MVP runtime.`)
      return [] as PresetCompatResolvedPromptRule[]
    }

    if (!hasSupportedRole) {
      warnings.push(`Prompt rule \`${rule.name}\` was preserved but not applied because role \`${rule.role}\` is unsupported in MVP runtime.`)
      return [] as PresetCompatResolvedPromptRule[]
    }

    return [{
      id: rule.id,
      name: rule.name,
      role: rule.role as PresetCompatRuntimePromptRuleRole,
      content: trimmedContent,
      sourceIndex,
      injectionOrder: rule.injectionOrder,
    }]
  })
    .sort(sortResolvedPromptRules)

  return {
    promptRules: {
      ordered,
      system: ordered.filter((rule) => rule.role === 'system'),
      user: ordered.filter((rule) => rule.role === 'user'),
    } satisfies PresetCompatResolvedPromptRuleSet,
    warnings,
    preservedPromptMetadata,
  }
}

export function resolvePresetCompatRuntime(params: {
  library: PresetCompatLibrary
  surfaceId: PresetCompatSurfaceId
  providerDefaults: PresetCompatRuntimeProviderDefaults
  sessionOverrides?: PresetCompatRuntimeSessionOverrides
}) : PresetCompatResolvedRuntime {
  const sessionOverrides = params.sessionOverrides ?? {}
  const activePreset = getPresetBoundToSurface(params.library, params.surfaceId)
  const provider = sessionOverrides.provider ?? params.providerDefaults.provider
  const context = {
    preset: activePreset,
    surfaceId: params.surfaceId,
  } satisfies PresetCompatRuntimeContext
  const providerWarnings = buildProviderWarnings(provider, context)
  const promptResolution = resolvePromptRules(activePreset, params.surfaceId)
  const providerRuntime = provider === 'ollama'
    ? resolveOllamaProviderRuntime(context, params.providerDefaults, sessionOverrides)
    : resolveOpenAICompatibleProviderRuntime(context, params.providerDefaults, sessionOverrides)

  const warnings = [...providerWarnings.warnings, ...promptResolution.warnings]
  if (params.library.surfaceBindings[params.surfaceId]?.enabled && params.library.surfaceBindings[params.surfaceId]?.presetId && !activePreset) {
    warnings.unshift(`Surface \`${params.surfaceId}\` is bound to a missing preset and fell back to provider defaults.`)
  }

  return {
    snapshot: {
      activePresetId: activePreset?.id ?? null,
      activeSurfaceId: params.surfaceId,
      importedAt: params.library.lastImportedAt,
      warnings,
    },
    activePreset,
    providerRuntime,
    promptRules: promptResolution.promptRules,
    warnings,
    preservedSamplerFields: providerWarnings.preserved,
    preservedPromptMetadata: promptResolution.preservedPromptMetadata,
  }
}

export function resolvePresetCompatPromptRuleSubset(params: {
  preset: PresetCompatPresetRecord | null
  surfaceId: PresetCompatSurfaceId
}) {
  return resolvePromptRules(params.preset, params.surfaceId)
}
