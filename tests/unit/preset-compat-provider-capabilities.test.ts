import { describe, expect, it } from 'vitest'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import {
  PRESET_COMPAT_PROVIDER_CAPABILITY_MATRIX,
  PRESET_COMPAT_PROMPT_RULE_SUPPORTED_ROLES,
} from '@/lib/preset-compat/capability-matrix'
import { resolvePresetCompatRuntime } from '@/lib/preset-compat/resolve-runtime'
import type { PresetCompatPresetRecord } from '@/lib/preset-compat/types'

function createPreset(): PresetCompatPresetRecord {
  return {
    id: 'preset-rewrite-001',
    name: 'Fixture preset',
    sourceApiId: 'openai',
    promptRules: [],
    promptOrderLists: {
      rewrite: [],
    },
    embeddedRegexes: [],
    attachedStandaloneRegexIds: [],
    runtimeSampler: {
      temperature: 0.81,
      topP: 0.92,
      topK: 40,
      topA: 0.25,
      minP: 0.07,
      presencePenalty: 0.31,
      frequencyPenalty: 0.22,
      repetitionPenalty: 1.14,
      openaiMaxContext: 2000000,
      maxTokens: 4096,
      seed: 123456,
      candidateCount: 3,
    },
    promptTemplate: {
      namesBehavior: 0,
      sendIfEmpty: '',
      impersonationPrompt: '',
      newChatPrompt: '',
      newGroupChatPrompt: '',
      newExampleChatPrompt: '',
      continueNudgePrompt: '',
      wiFormat: '',
      scenarioFormat: '',
      personalityFormat: '',
      groupNudgePrompt: '',
      assistantPrefill: 'ASSISTANT PREFILL',
      assistantImpersonation: 'ASSISTANT IMPERSONATION',
      continuePostfix: 'CONTINUE POSTFIX',
      legacyMainPrompt: null,
      legacyNsfwPrompt: null,
      legacyJailbreakPrompt: null,
    },
    transport: {
      maxContextUnlocked: true,
      streamOpenAI: true,
      useSysprompt: true,
      squashSystemMessages: true,
      mediaInlining: true,
      inlineImageQuality: 'high',
      continuePrefill: true,
      functionCalling: true,
      showThoughts: true,
      reasoningEffort: 'high',
      verbosity: 'low',
      enableWebSearch: true,
      requestImages: true,
      requestImageAspectRatio: '16:9',
      requestImageResolution: '1024x1024',
    },
    preservedFields: {
      biasPresetSelected: 'Default (none)',
    },
    passthrough: {
      root: {
        max_context_unlocked: true,
        names_behavior: 0,
        send_if_empty: '',
        impersonation_prompt: '',
        new_chat_prompt: '',
        new_group_chat_prompt: '',
        new_example_chat_prompt: '',
        continue_nudge_prompt: '',
        wi_format: '',
        scenario_format: '',
        personality_format: '',
        group_nudge_prompt: '',
        stream_openai: true,
        function_calling: true,
        show_thoughts: true,
        reasoning_effort: 'high',
        image_inlining: true,
      },
      extensions: {
        SPreset: {
          RegexBinding: {
            regexes: [],
          },
        },
      },
      unknownPromptFields: {},
    },
    importWarnings: [],
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
  }
}

describe('preset compat provider capabilities', () => {
  function getFieldStatus(runtime: ReturnType<typeof resolvePresetCompatRuntime>, field: string) {
    const matches = runtime.fieldStatuses.filter((status) => status.field === field)
    expect(matches).toHaveLength(1)
    return matches[0]
  }

  it('locks the MVP capability matrix for both providers', () => {
    expect(PRESET_COMPAT_PROVIDER_CAPABILITY_MATRIX['openai-compatible'].appliedFields).toEqual({
      temperature: 'temperature',
      top_p: 'top_p',
      frequency_penalty: 'frequency_penalty',
      presence_penalty: 'presence_penalty',
      openai_max_tokens: 'max_tokens',
    })
    expect(PRESET_COMPAT_PROVIDER_CAPABILITY_MATRIX.ollama.appliedFields).toEqual({
      temperature: 'options.temperature',
      top_p: 'options.top_p',
      top_k: 'options.top_k',
      min_p: 'options.min_p',
      repetition_penalty: 'options.repeat_penalty',
      openai_max_tokens: 'options.num_predict',
      seed: 'options.seed',
    })
    expect(PRESET_COMPAT_PROMPT_RULE_SUPPORTED_ROLES).toEqual(['system', 'user'])
  })

  it('resolves OpenAI-compatible runtime options with session overrides taking precedence', () => {
    const library = createDefaultPresetCompatLibrary()
    const preset = createPreset()
    library.presets[preset.id] = preset
    library.surfaceBindings.rewrite = {
      ...library.surfaceBindings.rewrite,
      presetId: preset.id,
      enabled: true,
    }

    const runtime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'rewrite',
      providerDefaults: {
        provider: 'openai-compatible',
        openAICompatible: {
          config: {
            baseUrl: 'https://default.example/v1',
            apiKey: 'default-key',
            model: 'default-model',
          },
          request: {
            temperature: 0.4,
            top_p: 0.5,
            frequency_penalty: 0.1,
            presence_penalty: 0.2,
            max_tokens: 512,
          },
        },
      },
      sessionOverrides: {
        openAICompatible: {
          config: {
            model: 'session-model',
          },
          request: {
            temperature: 0.61,
            max_tokens: 2048,
          },
        },
      },
    })

    expect(runtime.providerRuntime).toEqual({
      provider: 'openai-compatible',
      config: {
        baseUrl: 'https://default.example/v1',
        apiKey: 'default-key',
        model: 'session-model',
      },
      request: {
        temperature: 0.61,
        top_p: 0.92,
        frequency_penalty: 0.22,
        presence_penalty: 0.31,
        max_tokens: 2048,
      },
    })
    expect(runtime.templateFragments).toEqual({
      ordered: [],
      system: [],
      user: [],
    })

    expect(runtime.preservedSamplerFields).toMatchObject({
      top_k: 40,
      min_p: 0.07,
      repetition_penalty: 1.14,
      top_a: 0.25,
      openai_max_context: 2000000,
      max_context_unlocked: true,
      stream_openai: true,
      function_calling: true,
      show_thoughts: true,
      reasoning_effort: 'high',
      image_inlining: true,
      SPreset: {
        RegexBinding: {
          regexes: [],
        },
      },
    })
    expect(runtime.providerControlIntents).toEqual(expect.arrayContaining([
      {
        field: 'temperature',
        provider: 'openai-compatible',
        target: 'request',
        path: 'temperature',
        value: 0.81,
      },
      {
        field: 'openai_max_tokens',
        provider: 'openai-compatible',
        target: 'request',
        path: 'max_tokens',
        value: 4096,
      },
      {
        field: 'openai_max_context',
        provider: 'openai-compatible',
        target: 'route',
        path: 'contextWindow.maxContextTokens',
        value: 2000000,
      },
      {
        field: 'max_context_unlocked',
        provider: 'openai-compatible',
        target: 'route',
        path: 'contextWindow.unlockMaximum',
        value: true,
      },
      {
        field: 'stream_openai',
        provider: 'openai-compatible',
        target: 'route',
        path: 'stream.enabled',
        value: true,
      },
      {
        field: 'n',
        provider: 'openai-compatible',
        target: 'route',
        path: 'candidateCount',
        value: 3,
      },
    ]))
    expect(getFieldStatus(runtime, 'temperature')).toMatchObject({
      surface: 'rewrite',
      status: 'applied',
      reason: 'SUPPORTED_RUNTIME',
    })
    expect(getFieldStatus(runtime, 'top_k')).toMatchObject({
      surface: 'rewrite',
      status: 'degraded',
      reason: 'PROVIDER_ONLY',
    })
    expect(getFieldStatus(runtime, 'top_a')).toMatchObject({
      surface: 'rewrite',
      status: 'degraded',
      reason: 'PROVIDER_UNSUPPORTED',
    })
    expect(getFieldStatus(runtime, 'openai_max_context')).toMatchObject({
      surface: 'rewrite',
      status: 'applied',
      reason: 'SUPPORTED_RUNTIME',
      providerIntent: {
        field: 'openai_max_context',
        provider: 'openai-compatible',
        target: 'route',
        path: 'contextWindow.maxContextTokens',
        value: 2000000,
      },
    })
    expect(getFieldStatus(runtime, 'max_context_unlocked')).toMatchObject({
      surface: 'rewrite',
      status: 'applied',
      reason: 'SUPPORTED_RUNTIME',
    })
    expect(getFieldStatus(runtime, 'stream_openai')).toMatchObject({
      surface: 'rewrite',
      status: 'applied',
      reason: 'SUPPORTED_RUNTIME',
    })
    expect(getFieldStatus(runtime, 'seed')).toMatchObject({
      surface: 'rewrite',
      status: 'degraded',
      reason: 'PROVIDER_ONLY',
    })
    expect(getFieldStatus(runtime, 'send_if_empty')).toMatchObject({
      surface: 'rewrite',
      status: 'degraded',
      reason: 'NO_EMPTY_SEND_CONTEXT',
      value: '',
    })
    expect(getFieldStatus(runtime, 'assistant_prefill')).toMatchObject({
      surface: 'rewrite',
      status: 'degraded',
      reason: 'ASSISTANT_PREFILL_UNSUPPORTED',
    })
    expect(getFieldStatus(runtime, 'assistant_impersonation')).toMatchObject({
      surface: 'rewrite',
      status: 'preserved',
      reason: 'PRESERVED_EXPORT_ONLY',
    })
    expect(getFieldStatus(runtime, 'continue_prefill')).toMatchObject({
      surface: 'rewrite',
      status: 'degraded',
      reason: 'ASSISTANT_PREFILL_UNSUPPORTED',
    })
    expect(getFieldStatus(runtime, 'continue_postfix')).toMatchObject({
      surface: 'rewrite',
      status: 'preserved',
      reason: 'PRESERVED_EXPORT_ONLY',
    })
    expect(getFieldStatus(runtime, 'use_sysprompt')).toMatchObject({
      surface: 'rewrite',
      status: 'preserved',
      reason: 'PRESERVED_EXPORT_ONLY',
    })
    expect(getFieldStatus(runtime, 'squash_system_messages')).toMatchObject({
      surface: 'rewrite',
      status: 'degraded',
      reason: 'MESSAGE_SQUASH_UNSUPPORTED',
    })
    expect(getFieldStatus(runtime, 'function_calling')).toMatchObject({
      surface: 'rewrite',
      status: 'preserved',
      reason: 'PRESERVED_EXPORT_ONLY',
    })
    expect(getFieldStatus(runtime, 'show_thoughts')).toMatchObject({
      surface: 'rewrite',
      status: 'preserved',
      reason: 'PRESERVED_EXPORT_ONLY',
    })
    expect(getFieldStatus(runtime, 'reasoning_effort')).toMatchObject({
      surface: 'rewrite',
      status: 'preserved',
      reason: 'PRESERVED_EXPORT_ONLY',
    })
    expect(getFieldStatus(runtime, 'verbosity')).toMatchObject({
      surface: 'rewrite',
      status: 'preserved',
      reason: 'PRESERVED_EXPORT_ONLY',
    })
    expect(getFieldStatus(runtime, 'bias_preset_selected')).toMatchObject({
      surface: 'rewrite',
      status: 'preserved',
      reason: 'PRESERVED_EXPORT_ONLY',
    })
    expect(getFieldStatus(runtime, 'media_inlining')).toMatchObject({
      surface: 'rewrite',
      status: 'preserved',
      reason: 'PRESERVED_EXPORT_ONLY',
    })
    expect(getFieldStatus(runtime, 'inline_image_quality')).toMatchObject({
      surface: 'rewrite',
      status: 'preserved',
      reason: 'PRESERVED_EXPORT_ONLY',
    })
    expect(getFieldStatus(runtime, 'enable_web_search')).toMatchObject({
      surface: 'rewrite',
      status: 'preserved',
      reason: 'WEB_SEARCH_IMPORT_DISABLED',
    })
    expect(getFieldStatus(runtime, 'request_images')).toMatchObject({
      surface: 'rewrite',
      status: 'preserved',
      reason: 'IMAGE_REQUEST_METADATA_ONLY',
    })
    expect(getFieldStatus(runtime, 'request_image_aspect_ratio')).toMatchObject({
      surface: 'rewrite',
      status: 'preserved',
      reason: 'IMAGE_REQUEST_METADATA_ONLY',
    })
    expect(getFieldStatus(runtime, 'request_image_resolution')).toMatchObject({
      surface: 'rewrite',
      status: 'preserved',
      reason: 'IMAGE_REQUEST_METADATA_ONLY',
    })
    expect(getFieldStatus(runtime, 'n')).toMatchObject({
      surface: 'rewrite',
      status: 'degraded',
      reason: 'ROUTE_UNSUPPORTED',
      providerIntent: {
        field: 'n',
        provider: 'openai-compatible',
        target: 'route',
        path: 'candidateCount',
        value: 3,
      },
    })
    expect(runtime.warnings).toEqual(expect.arrayContaining([
      'Preset field `top_k` was preserved for export but not applied to openai-compatible.',
      'Preset field `min_p` was preserved for export but not applied to openai-compatible.',
      'Preset field `repetition_penalty` was preserved for export but not applied to openai-compatible.',
      'Preset field `top_a` was preserved for export but not applied to openai-compatible.',
      'Preset field `seed` was preserved for export but not applied to openai-compatible.',
      'Preset field `send_if_empty` was preserved for export but not applied to openai-compatible.',
      'Preset field `assistant_prefill` was preserved for export but not applied to openai-compatible.',
      'Preset field `assistant_impersonation` was preserved for export but not applied to openai-compatible.',
      'Preset field `continue_prefill` was preserved for export but not applied to openai-compatible.',
      'Preset field `continue_postfix` was preserved for export but not applied to openai-compatible.',
      'Preset field `use_sysprompt` was preserved for export but not applied to openai-compatible.',
      'Preset field `squash_system_messages` was preserved for export but not applied to openai-compatible.',
      'Preset field `function_calling` was preserved for export but not applied to openai-compatible.',
      'Preset field `show_thoughts` was preserved for export but not applied to openai-compatible.',
      'Preset field `reasoning_effort` was preserved for export but not applied to openai-compatible.',
      'Preset field `verbosity` was preserved for export but not applied to openai-compatible.',
      'Preset field `bias_preset_selected` was preserved for export but not applied to openai-compatible.',
      'Preset field `media_inlining` was preserved for export but not applied to openai-compatible.',
      'Preset field `inline_image_quality` was preserved for export but not applied to openai-compatible.',
      'Preset field `enable_web_search` was preserved for export but not applied to openai-compatible.',
      'Preset field `request_images` was preserved for export but not applied to openai-compatible.',
      'Preset field `request_image_aspect_ratio` was preserved for export but not applied to openai-compatible.',
      'Preset field `request_image_resolution` was preserved for export but not applied to openai-compatible.',
      'Preset image field `image_inlining` was preserved for export but not applied to openai-compatible.',
      'Preset extension `SPreset` was preserved for export but not applied to openai-compatible.',
    ]))
    expect(runtime.snapshot.activePresetId).toBe(preset.id)
  })

  it('resolves template fragments and statuses only when the runtime context matches', () => {
    const library = createDefaultPresetCompatLibrary()
    const preset = createPreset()
    preset.promptTemplate = {
      ...preset.promptTemplate,
      newChatPrompt: 'NEW CHAT TEMPLATE',
      newGroupChatPrompt: 'NEW GROUP CHAT TEMPLATE',
      newExampleChatPrompt: 'NEW EXAMPLE CHAT TEMPLATE',
      continueNudgePrompt: 'CONTINUE NUDGE TEMPLATE',
      groupNudgePrompt: 'GROUP NUDGE TEMPLATE',
      impersonationPrompt: 'IMPERSONATION TEMPLATE',
    }
    library.presets[preset.id] = preset
    for (const surfaceId of ['rewrite', 'roleplay', 'continue'] as const) {
      library.surfaceBindings[surfaceId] = {
        ...library.surfaceBindings[surfaceId],
        presetId: preset.id,
        enabled: true,
      }
    }

    const rewriteRuntime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'rewrite',
      providerDefaults: {
        provider: 'openai-compatible',
      },
      promptRuleRuntimeContext: {
        sessionPhase: 'new_chat',
      },
    })
    expect(rewriteRuntime.templateFragments.system.map((fragment) => fragment.field)).toEqual(['new_chat_prompt'])
    expect(getFieldStatus(rewriteRuntime, 'new_chat_prompt')).toMatchObject({ status: 'applied', reason: 'SUPPORTED_RUNTIME' })
    expect(getFieldStatus(rewriteRuntime, 'new_group_chat_prompt')).toMatchObject({ status: 'degraded', reason: 'NO_GROUP_CONTEXT' })
    expect(getFieldStatus(rewriteRuntime, 'new_example_chat_prompt')).toMatchObject({ status: 'degraded', reason: 'NO_EXAMPLE_CONTEXT' })
    expect(getFieldStatus(rewriteRuntime, 'continue_nudge_prompt')).toMatchObject({ status: 'degraded', reason: 'CONTINUE_SURFACE_ONLY' })
    expect(getFieldStatus(rewriteRuntime, 'group_nudge_prompt')).toMatchObject({ status: 'degraded', reason: 'NO_GROUP_CONTEXT' })
    expect(getFieldStatus(rewriteRuntime, 'impersonation_prompt')).toMatchObject({ status: 'degraded', reason: 'NO_IMPERSONATION_CONTEXT' })

    const roleplayRuntime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'roleplay',
      providerDefaults: {
        provider: 'openai-compatible',
      },
      promptRuleRuntimeContext: {
        sessionPhase: 'new_group_chat',
        hasGroupContext: true,
        hasImpersonationContext: true,
      },
    })
    expect(roleplayRuntime.templateFragments.system.map((fragment) => fragment.field)).toEqual([
      'new_group_chat_prompt',
      'group_nudge_prompt',
      'impersonation_prompt',
    ])

    const roleplayWithoutImpersonationRuntime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'roleplay',
      providerDefaults: {
        provider: 'openai-compatible',
      },
      promptRuleRuntimeContext: {
        sessionPhase: 'new_group_chat',
        hasGroupContext: true,
      },
    })
    expect(roleplayWithoutImpersonationRuntime.templateFragments.system.map((fragment) => fragment.field)).toEqual([
      'new_group_chat_prompt',
      'group_nudge_prompt',
    ])
    expect(getFieldStatus(roleplayWithoutImpersonationRuntime, 'impersonation_prompt')).toMatchObject({
      status: 'degraded',
      reason: 'NO_IMPERSONATION_CONTEXT',
    })

    const exampleRuntime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'rewrite',
      providerDefaults: {
        provider: 'openai-compatible',
      },
      promptRuleRuntimeContext: {
        sessionPhase: 'new_example_chat',
      },
    })
    expect(exampleRuntime.templateFragments.system.map((fragment) => fragment.field)).toEqual([])
    expect(getFieldStatus(exampleRuntime, 'new_example_chat_prompt')).toMatchObject({ status: 'degraded', reason: 'NO_EXAMPLE_CONTEXT' })

    const explicitExampleRuntime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'rewrite',
      providerDefaults: {
        provider: 'openai-compatible',
      },
      promptRuleRuntimeContext: {
        sessionPhase: 'new_example_chat',
        hasExampleContext: true,
      },
    })
    expect(explicitExampleRuntime.templateFragments.system.map((fragment) => fragment.field)).toEqual(['new_example_chat_prompt'])
    expect(getFieldStatus(explicitExampleRuntime, 'new_example_chat_prompt')).toMatchObject({ status: 'applied', reason: 'SUPPORTED_RUNTIME' })

    const continueRuntime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'continue',
      providerDefaults: {
        provider: 'openai-compatible',
      },
      promptRuleRuntimeContext: {
        sessionPhase: 'continue',
      },
    })
    expect(continueRuntime.templateFragments.system.map((fragment) => fragment.field)).toEqual(['continue_nudge_prompt'])
    expect(getFieldStatus(continueRuntime, 'continue_nudge_prompt')).toMatchObject({ status: 'applied', reason: 'SUPPORTED_RUNTIME' })
    expect(getFieldStatus(continueRuntime, 'new_chat_prompt')).toMatchObject({ status: 'degraded', reason: 'NEW_CHAT_CONTEXT_REQUIRED' })
  })

  it('resolves Ollama runtime options with provider selection and session overrides taking precedence', () => {
    const library = createDefaultPresetCompatLibrary()
    const preset = createPreset()
    library.presets[preset.id] = preset
    library.surfaceBindings.rewrite = {
      ...library.surfaceBindings.rewrite,
      presetId: preset.id,
      enabled: true,
    }

    const runtime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'rewrite',
      providerDefaults: {
        provider: 'openai-compatible',
        ollama: {
          config: {
            baseUrl: 'http://127.0.0.1:11434',
            model: 'llama-default',
          },
          request: {
            top_k: 4,
            seed: 55,
          },
        },
      },
      sessionOverrides: {
        provider: 'ollama',
        ollama: {
          config: {
            model: 'llama-session',
          },
          request: {
            top_k: 64,
            seed: 987654,
          },
        },
      },
    })

    expect(runtime.providerRuntime).toEqual({
      provider: 'ollama',
      config: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama-session',
      },
      request: {
        options: {
          temperature: 0.81,
          top_p: 0.92,
          top_k: 64,
          min_p: 0.07,
          repeat_penalty: 1.14,
          num_predict: 4096,
          seed: 987654,
        },
      },
    })

    expect(runtime.warnings).toEqual(expect.arrayContaining([
      'Preset field `presence_penalty` was preserved for export but not applied to ollama.',
      'Preset field `frequency_penalty` was preserved for export but not applied to ollama.',
      'Preset field `top_a` was preserved for export but not applied to ollama.',
      'Preset extension `SPreset` was preserved for export but not applied to ollama.',
    ]))
    expect(runtime.providerControlIntents).toEqual(expect.arrayContaining([
      {
        field: 'top_k',
        provider: 'ollama',
        target: 'request',
        path: 'options.top_k',
        value: 40,
      },
      {
        field: 'openai_max_tokens',
        provider: 'ollama',
        target: 'request',
        path: 'options.num_predict',
        value: 4096,
      },
      {
        field: 'openai_max_context',
        provider: 'ollama',
        target: 'route',
        path: 'contextWindow.maxContextTokens',
        value: 2000000,
      },
      {
        field: 'stream_openai',
        provider: 'ollama',
        target: 'route',
        path: 'stream.enabled',
        value: true,
      },
      {
        field: 'seed',
        provider: 'ollama',
        target: 'request',
        path: 'options.seed',
        value: 123456,
      },
      {
        field: 'n',
        provider: 'ollama',
        target: 'route',
        path: 'candidateCount',
        value: 3,
      },
    ]))
    expect(getFieldStatus(runtime, 'presence_penalty')).toMatchObject({
      surface: 'rewrite',
      status: 'degraded',
      reason: 'PROVIDER_ONLY',
    })
    expect(getFieldStatus(runtime, 'top_k')).toMatchObject({
      surface: 'rewrite',
      status: 'applied',
      reason: 'SUPPORTED_RUNTIME',
    })
    expect(getFieldStatus(runtime, 'openai_max_context')).toMatchObject({
      surface: 'rewrite',
      status: 'applied',
      reason: 'SUPPORTED_RUNTIME',
    })
    expect(getFieldStatus(runtime, 'stream_openai')).toMatchObject({
      surface: 'rewrite',
      status: 'applied',
      reason: 'SUPPORTED_RUNTIME',
    })
    expect(getFieldStatus(runtime, 'seed')).toMatchObject({
      surface: 'rewrite',
      status: 'applied',
      reason: 'SUPPORTED_RUNTIME',
    })
    expect(getFieldStatus(runtime, 'reasoning_effort')).toMatchObject({
      surface: 'rewrite',
      status: 'preserved',
      reason: 'PRESERVED_EXPORT_ONLY',
    })
    expect(getFieldStatus(runtime, 'n')).toMatchObject({
      surface: 'rewrite',
      status: 'degraded',
      reason: 'ROUTE_UNSUPPORTED',
    })
    expect(runtime.providerRuntime.provider).toBe('ollama')
  })
})
