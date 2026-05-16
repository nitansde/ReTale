import type { AIProvider } from '@/lib/types'

export type PresetCompatProviderSamplerField =
  | 'temperature'
  | 'top_p'
  | 'top_k'
  | 'top_a'
  | 'min_p'
  | 'presence_penalty'
  | 'frequency_penalty'
  | 'repetition_penalty'
  | 'openai_max_tokens'
  | 'openai_max_context'
  | 'max_context_unlocked'
  | 'names_behavior'
  | 'send_if_empty'
  | 'impersonation_prompt'
  | 'new_chat_prompt'
  | 'new_group_chat_prompt'
  | 'new_example_chat_prompt'
  | 'continue_nudge_prompt'
  | 'bias_preset_selected'
  | 'wi_format'
  | 'scenario_format'
  | 'personality_format'
  | 'group_nudge_prompt'
  | 'stream_openai'
  | 'function_calling'
  | 'show_thoughts'
  | 'reasoning_effort'
  | 'seed'

export type PresetCompatPromptRulePreservedField =
  | 'injectionPosition'
  | 'injectionDepth'
  | 'injectionTrigger'
  | 'forbidOverrides'

export type PresetCompatProviderCapability = {
  provider: AIProvider
  appliedFields: Partial<Record<PresetCompatProviderSamplerField, string>>
  preservedOnlyFields: readonly PresetCompatProviderSamplerField[]
}

export const PRESET_COMPAT_PROMPT_RULE_SUPPORTED_ROLES = ['system', 'user'] as const

export const PRESET_COMPAT_PROMPT_RULE_PRESERVED_ONLY_FIELDS = [
  'injectionPosition',
  'injectionDepth',
  'injectionTrigger',
  'forbidOverrides',
] as const satisfies readonly PresetCompatPromptRulePreservedField[]

export const PRESET_COMPAT_IMAGE_REQUEST_FIELD_PREFIXES = ['image_', 'inline_image_'] as const

export const PRESET_COMPAT_PROVIDER_CAPABILITY_MATRIX: Record<AIProvider, PresetCompatProviderCapability> = {
  'openai-compatible': {
    provider: 'openai-compatible',
    appliedFields: {
      temperature: 'temperature',
      top_p: 'top_p',
      frequency_penalty: 'frequency_penalty',
      presence_penalty: 'presence_penalty',
      openai_max_tokens: 'max_tokens',
    },
    preservedOnlyFields: [
      'top_k',
      'top_a',
      'min_p',
      'repetition_penalty',
      'openai_max_context',
      'max_context_unlocked',
      'names_behavior',
      'send_if_empty',
      'impersonation_prompt',
      'new_chat_prompt',
      'new_group_chat_prompt',
      'new_example_chat_prompt',
      'continue_nudge_prompt',
      'bias_preset_selected',
      'wi_format',
      'scenario_format',
      'personality_format',
      'group_nudge_prompt',
      'stream_openai',
      'function_calling',
      'show_thoughts',
      'reasoning_effort',
      'seed',
    ],
  },
  ollama: {
    provider: 'ollama',
    appliedFields: {
      temperature: 'options.temperature',
      top_p: 'options.top_p',
      top_k: 'options.top_k',
      min_p: 'options.min_p',
      repetition_penalty: 'options.repeat_penalty',
      openai_max_tokens: 'options.num_predict',
      seed: 'options.seed',
    },
    preservedOnlyFields: [
      'presence_penalty',
      'frequency_penalty',
      'top_a',
      'openai_max_context',
      'max_context_unlocked',
      'names_behavior',
      'send_if_empty',
      'impersonation_prompt',
      'new_chat_prompt',
      'new_group_chat_prompt',
      'new_example_chat_prompt',
      'continue_nudge_prompt',
      'bias_preset_selected',
      'wi_format',
      'scenario_format',
      'personality_format',
      'group_nudge_prompt',
      'stream_openai',
      'function_calling',
      'show_thoughts',
      'reasoning_effort',
    ],
  },
}

const PRESET_COMPAT_PRESERVED_ONLY_FIELD_SET = new Set<PresetCompatProviderSamplerField>([
  ...PRESET_COMPAT_PROVIDER_CAPABILITY_MATRIX['openai-compatible'].preservedOnlyFields,
  ...PRESET_COMPAT_PROVIDER_CAPABILITY_MATRIX.ollama.preservedOnlyFields,
])

export function isPresetCompatImageRequestField(fieldName: string) {
  return PRESET_COMPAT_IMAGE_REQUEST_FIELD_PREFIXES.some((prefix) => fieldName.startsWith(prefix))
}

export function isPresetCompatPreservedOnlyField(fieldName: string): fieldName is PresetCompatProviderSamplerField {
  return PRESET_COMPAT_PRESERVED_ONLY_FIELD_SET.has(fieldName as PresetCompatProviderSamplerField)
}

export function getPresetCompatProviderCapability(provider: AIProvider) {
  return PRESET_COMPAT_PROVIDER_CAPABILITY_MATRIX[provider]
}
