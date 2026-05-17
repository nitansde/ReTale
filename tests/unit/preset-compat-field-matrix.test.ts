import { describe, expect, it } from 'vitest'
import {
  PRESET_COMPAT_FIELD_FAMILY_MATRIX,
  PRESET_COMPAT_FIELD_STATUS,
  PRESET_COMPAT_STATUS_REASON_CODES,
} from '@/lib/preset-compat/capability-matrix'
import {
  PRESET_COMPAT_MACRO_CAPABILITY_MATRIX,
  PRESET_COMPAT_MACRO_FIELD_FAMILY_LINKS,
} from '@/lib/preset-compat/macro-types'
import {
  PRESET_COMPAT_CREATIVE_SURFACE_IDS,
  PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS,
  PRESET_COMPAT_SURFACE_IDS,
} from '@/lib/preset-compat/types'

const MACRO_FIELD_FAMILIES = [
  'macro.setvar',
  'macro.getvar',
  'macro.trim',
  'macro.comment',
  'macro.user_bot_variable',
] as const

const DRAFT_FIELD_FAMILIES = [
  'temperature',
  'frequency_penalty',
  'presence_penalty',
  'top_p',
  'top_k',
  'top_a',
  'min_p',
  'repetition_penalty',
  'max_context_unlocked',
  'openai_max_context',
  'openai_max_tokens',
  'bias_preset_selected',
  'stream_openai',
  'seed',
  'n',
  'names_behavior',
  'send_if_empty',
  'impersonation_prompt',
  'new_chat_prompt',
  'new_group_chat_prompt',
  'new_example_chat_prompt',
  'continue_nudge_prompt',
  'wi_format',
  'scenario_format',
  'personality_format',
  'group_nudge_prompt',
  'assistant_prefill',
  'assistant_impersonation',
  'continue_prefill',
  'continue_postfix',
  'use_sysprompt',
  'squash_system_messages',
  'media_inlining',
  'inline_image_quality',
  'function_calling',
  'show_thoughts',
  'reasoning_effort',
  'verbosity',
  'enable_web_search',
  'request_images',
  'request_image_aspect_ratio',
  'request_image_resolution',
  'prompts.identifier',
  'prompts.name',
  'prompts.system_prompt',
  'prompts.role',
  'prompts.content',
  'prompts.marker',
  'prompts.enabled',
  'prompts.injection_position',
  'prompts.injection_depth',
  'prompts.forbid_overrides',
  'prompts.injection_order',
  'prompts.injection_trigger',
  'prompts.condition',
  'prompt_order',
  'prompt_order.character_id',
  'prompt_order.order.identifier',
  'prompt_order.order.enabled',
  'extensions.regex_scripts',
  'regex_script.id',
  'regex_script.scriptName',
  'regex_script.findRegex',
  'regex_script.replaceString',
  'regex_script.trimStrings',
  'regex_script.placement',
  'regex_script.disabled',
  'regex_script.markdownOnly',
  'regex_script.promptOnly',
  'regex_script.runOnEdit',
  'regex_script.substituteRegex',
  'regex_script.minDepth',
  'regex_script.maxDepth',
  'extensions.SPreset.ChatSquash',
  'extensions.SPreset.RegexBinding',
  'extensions.MacroNest',
  'extensions.ToolBindings',
  'extensions.tavern_helper',
  'macro.setvar',
  'macro.getvar',
  'macro.trim',
  'macro.comment',
  'macro.user_bot_variable',
] as const

const REQUIRED_REASON_CODES = [
  'NO_GROUP_CONTEXT',
  'NO_CHAT_HISTORY',
  'UNSAFE_CONDITION',
  'ANALYTICAL_SURFACE_FAIL_CLOSED',
  'PROVIDER_ONLY',
  'PRESERVED_EXPORT_ONLY',
] as const

describe('preset compat field family matrix', () => {
  it('covers every draft field family and every creative and analytical surface', () => {
    expect(Object.keys(PRESET_COMPAT_FIELD_FAMILY_MATRIX).sort()).toEqual([...DRAFT_FIELD_FAMILIES].sort())

    for (const fieldFamily of DRAFT_FIELD_FAMILIES) {
      const contract = PRESET_COMPAT_FIELD_FAMILY_MATRIX[fieldFamily]
      expect(contract).toBeDefined()
      expect(Object.keys(contract.surfaceClassifications).sort()).toEqual([...PRESET_COMPAT_SURFACE_IDS].sort())

      for (const surfaceId of PRESET_COMPAT_CREATIVE_SURFACE_IDS) {
        expect(contract.surfaceClassifications[surfaceId]).toBeDefined()
      }

      for (const surfaceId of PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS) {
        expect(contract.surfaceClassifications[surfaceId]).toBeDefined()
      }
    }
  })

  it('keeps status enums and required reason codes covered by the contract', () => {
    expect(PRESET_COMPAT_FIELD_STATUS).toEqual(['applied', 'degraded', 'preserved', 'unsupported'])

    for (const reasonCode of REQUIRED_REASON_CODES) {
      expect(PRESET_COMPAT_STATUS_REASON_CODES).toContain(reasonCode)
    }

    const usedReasonCodes = new Set<string>()
    for (const contract of Object.values(PRESET_COMPAT_FIELD_FAMILY_MATRIX)) {
      for (const classification of Object.values(contract.surfaceClassifications)) {
        usedReasonCodes.add(classification.reason)
      }

      for (const classification of Object.values(contract.providerClassifications ?? {})) {
        usedReasonCodes.add(classification.reason)
      }

      if (contract.routeClassification) {
        usedReasonCodes.add(contract.routeClassification.reason)
      }
    }

    for (const reasonCode of REQUIRED_REASON_CODES) {
      expect(usedReasonCodes).toContain(reasonCode)
    }
  })

  it('fails closed for analytical surfaces on creative reset and prompt families', () => {
    for (const contract of Object.values(PRESET_COMPAT_FIELD_FAMILY_MATRIX)) {
      if (!contract.creativeResetPromptFamily) {
        continue
      }

      for (const surfaceId of PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS) {
        expect(contract.surfaceClassifications[surfaceId]).toEqual({
          status: 'degraded',
          reason: 'ANALYTICAL_SURFACE_FAIL_CLOSED',
        })
      }
    }
  })

  it('links macro field families to explicit macro capability contracts', () => {
    for (const fieldFamily of MACRO_FIELD_FAMILIES) {
      const contract = PRESET_COMPAT_FIELD_FAMILY_MATRIX[fieldFamily]

      expect(contract.category).toBe('macro')
      expect(contract.macroContractNames).toEqual(PRESET_COMPAT_MACRO_FIELD_FAMILY_LINKS[fieldFamily])

      for (const macroContractName of contract.macroContractNames ?? []) {
        const macroContract = PRESET_COMPAT_MACRO_CAPABILITY_MATRIX[macroContractName]

        expect(macroContract).toBeDefined()
        for (const surfaceId of PRESET_COMPAT_CREATIVE_SURFACE_IDS) {
          expect(macroContract.surfaces[surfaceId].reason).not.toBe('MACRO_TODO')
        }
      }

      for (const surfaceId of PRESET_COMPAT_CREATIVE_SURFACE_IDS) {
        expect(contract.surfaceClassifications[surfaceId].reason).not.toBe('MACRO_TODO')
      }
    }
  })
})
