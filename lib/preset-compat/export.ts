import {
  PRESET_COMPAT_CREATIVE_SURFACE_IDS,
  type PresetCompatPresetRecord,
  type PresetCompatPromptRule,
  type PresetCompatRegexPlacement,
  type PresetCompatRegexRecord,
} from '@/lib/preset-compat/types'
import {
  getPromptExportMeta,
  getRegexExportMeta,
  stripInternalRegexPassthroughMeta,
} from '@/lib/preset-compat/normalize'

const ACTIVE_PROMPT_ORDER_CHARACTER_ID = 100000

const REGEX_PLACEMENT_TO_ST: Record<PresetCompatRegexPlacement, number> = {
  md_display: 0,
  user_input: 1,
  assistant_output: 2,
  slash_command: 3,
  world_info: 6,
  reasoning: 7,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function getPresetPassthroughBucket(preset: PresetCompatPresetRecord, bucket: 'root' | 'extensions' | 'unknownPromptFields') {
  const value = preset.passthrough[bucket]
  return isRecord(value) ? cloneValue(value) : {}
}

function getActiveOrderIds(preset: PresetCompatPresetRecord) {
  for (const surfaceId of PRESET_COMPAT_CREATIVE_SURFACE_IDS) {
    const ids = preset.promptOrderLists[surfaceId]
    if (Array.isArray(ids) && ids.length > 0) {
      return ids
    }
  }
  return [] as string[]
}

function exportPromptRule(
  promptRule: PresetCompatPromptRule,
  unknownPromptFields: Record<string, unknown>,
  rawPrompt: Record<string, unknown> | null
) {
  const promptMeta = getPromptExportMeta(promptRule)
  const exported: Record<string, unknown> = {
    identifier: promptRule.id,
    name: promptRule.name,
    system_prompt: promptRule.injectAsSystemPrompt,
    role: promptRule.role,
    injection_position: promptRule.injectionPosition === 'in_chat'
      ? 1
      : typeof promptMeta.injectionPosition === 'number'
        ? promptMeta.injectionPosition
        : 0,
  }

  if (rawPrompt ? 'content' in rawPrompt : Boolean(promptRule.content)) {
    exported.content = promptRule.content
  }
  if (rawPrompt ? 'enabled' in rawPrompt : promptRule.enabled === false) {
    exported.enabled = promptRule.enabled
  }
  if (rawPrompt ? 'marker' in rawPrompt : promptRule.marker) {
    exported.marker = promptRule.marker
  }
  if (rawPrompt ? 'forbid_overrides' in rawPrompt : promptRule.forbidOverrides) {
    exported.forbid_overrides = promptRule.forbidOverrides
  }

  if (promptRule.injectionDepth !== null) {
    exported.injection_depth = promptRule.injectionDepth
  }
  if (promptRule.injectionOrder !== null) {
    exported.injection_order = promptRule.injectionOrder
  }
  if (Array.isArray(promptMeta.injectionTrigger)) {
    exported.injection_trigger = cloneValue(promptMeta.injectionTrigger)
  } else if (Array.isArray(promptRule.injectionTrigger) && promptRule.injectionTrigger.length > 0) {
    exported.injection_trigger = [promptRule.injectionTrigger]
  } else if ('injectionTrigger' in promptMeta && rawPrompt && 'injection_trigger' in rawPrompt) {
    exported.injection_trigger = cloneValue(promptMeta.injectionTrigger)
  }
  if (promptRule.condition !== null) {
    exported.condition = promptRule.condition
  }

  return {
    ...exported,
    ...unknownPromptFields,
  }
}

function exportPromptOrder(preset: PresetCompatPresetRecord) {
  const passthroughRoot = getPresetPassthroughBucket(preset, 'root')
  const rawPromptOrder = Array.isArray(passthroughRoot.prompt_order)
    ? cloneValue(passthroughRoot.prompt_order).filter(isRecord)
    : []
  const promptById = new Map(preset.promptRules.map((promptRule) => [promptRule.id, promptRule]))
  const activeOrderIds = getActiveOrderIds(preset)
  const nextOrder = activeOrderIds.map((identifier) => {
    const promptRule = promptById.get(identifier)
    return {
      identifier,
      enabled: promptRule?.enabled ?? false,
    }
  })

  if (rawPromptOrder.length === 0) {
    return [{
      character_id: ACTIVE_PROMPT_ORDER_CHARACTER_ID,
      order: nextOrder,
    }]
  }

  const activeIndex = rawPromptOrder.findIndex((entry) => entry.character_id === ACTIVE_PROMPT_ORDER_CHARACTER_ID)
  const replacementIndex = activeIndex >= 0 ? activeIndex : 0
  return rawPromptOrder.map((entry, index) => {
    if (index !== replacementIndex) {
      return entry
    }

    return {
      ...entry,
      character_id: entry.character_id ?? ACTIVE_PROMPT_ORDER_CHARACTER_ID,
      order: nextOrder,
    }
  })
}

function exportRegexRecord(regexRecord: PresetCompatRegexRecord) {
  const regexMeta = getRegexExportMeta(regexRecord)
  const rawPlacement = Array.isArray(regexMeta.placement)
    ? regexMeta.placement.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    : []
  const nextPlacement = Array.from(new Set([
    ...rawPlacement.filter((value) => !Object.values(REGEX_PLACEMENT_TO_ST).includes(value)),
    ...regexRecord.placements.map((placement) => REGEX_PLACEMENT_TO_ST[placement]),
  ]))

  const exported: Record<string, unknown> = {
    id: regexRecord.id,
    scriptName: regexRecord.name,
    findRegex: regexRecord.pattern,
    replaceString: regexRecord.replacement,
    trimStrings: cloneValue(regexRecord.trimStrings),
    placement: nextPlacement,
    disabled: regexRecord.disabled,
    markdownOnly: regexRecord.markdownOnly,
    promptOnly: regexRecord.promptOnly,
    runOnEdit: regexRecord.runOnEdit,
    substituteRegex: typeof regexMeta.substituteRegex === 'undefined'
      ? regexRecord.substituteRegex
      : cloneValue(regexMeta.substituteRegex),
    minDepth: regexRecord.minDepth,
    maxDepth: regexRecord.maxDepth,
  }

  return {
    ...exported,
    ...stripInternalRegexPassthroughMeta(regexRecord.passthrough),
  }
}

export function exportPresetCompatPreset(preset: PresetCompatPresetRecord) {
  const root = getPresetPassthroughBucket(preset, 'root')
  const extensions = getPresetPassthroughBucket(preset, 'extensions')
  const unknownPromptFieldsById = getPresetPassthroughBucket(preset, 'unknownPromptFields')
  const rawPrompts = Array.isArray(root.prompts) ? root.prompts.filter(isRecord) : []
  const rawPromptsById = new Map(
    rawPrompts
      .filter((prompt) => typeof prompt.identifier === 'string')
      .map((prompt) => [prompt.identifier as string, prompt])
  )

  const exportedExtensions: Record<string, unknown> = {
    ...extensions,
    regex_scripts: preset.embeddedRegexes.map(exportRegexRecord),
  }

  return {
    ...root,
    temperature: preset.runtimeSampler.temperature ?? root.temperature,
    top_p: preset.runtimeSampler.topP ?? root.top_p,
    top_k: preset.runtimeSampler.topK ?? root.top_k,
    min_p: preset.runtimeSampler.minP ?? root.min_p,
    presence_penalty: preset.runtimeSampler.presencePenalty ?? root.presence_penalty,
    frequency_penalty: preset.runtimeSampler.frequencyPenalty ?? root.frequency_penalty,
    repetition_penalty: preset.runtimeSampler.repetitionPenalty ?? root.repetition_penalty,
    openai_max_tokens: preset.runtimeSampler.maxTokens ?? root.openai_max_tokens,
    prompts: preset.promptRules.map((promptRule) => {
      const rawUnknownPromptFields = unknownPromptFieldsById[promptRule.id]
      return exportPromptRule(
        promptRule,
        isRecord(rawUnknownPromptFields) ? rawUnknownPromptFields : {},
        rawPromptsById.get(promptRule.id) ?? null
      )
    }),
    prompt_order: exportPromptOrder(preset),
    extensions: exportedExtensions,
  }
}

export function exportPresetCompatStandaloneRegex(regexes: PresetCompatRegexRecord[]) {
  return {
    regex_scripts: regexes.map(exportRegexRecord),
  }
}
