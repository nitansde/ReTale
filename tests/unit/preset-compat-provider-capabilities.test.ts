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
      candidateCount: null,
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
      assistantPrefill: null,
      assistantImpersonation: null,
      continuePostfix: null,
      legacyMainPrompt: null,
      legacyNsfwPrompt: null,
      legacyJailbreakPrompt: null,
    },
    transport: {
      maxContextUnlocked: true,
      streamOpenAI: true,
      useSysprompt: null,
      squashSystemMessages: null,
      mediaInlining: null,
      inlineImageQuality: null,
      continuePrefill: null,
      functionCalling: true,
      showThoughts: true,
      reasoningEffort: 'high',
      verbosity: null,
      enableWebSearch: null,
      requestImages: null,
      requestImageAspectRatio: null,
      requestImageResolution: null,
    },
    preservedFields: {
      biasPresetSelected: 'Default (none)',
    },
    passthrough: {
      root: {
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
    expect(runtime.warnings).toEqual(expect.arrayContaining([
      'Preset field `top_k` was preserved for export but not applied to openai-compatible.',
      'Preset field `min_p` was preserved for export but not applied to openai-compatible.',
      'Preset field `repetition_penalty` was preserved for export but not applied to openai-compatible.',
      'Preset field `top_a` was preserved for export but not applied to openai-compatible.',
      'Preset field `function_calling` was preserved for export but not applied to openai-compatible.',
      'Preset field `show_thoughts` was preserved for export but not applied to openai-compatible.',
      'Preset field `reasoning_effort` was preserved for export but not applied to openai-compatible.',
      'Preset image field `image_inlining` was preserved for export but not applied to openai-compatible.',
      'Preset extension `SPreset` was preserved for export but not applied to openai-compatible.',
    ]))
    expect(runtime.snapshot.activePresetId).toBe(preset.id)
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
    expect(runtime.providerRuntime.provider).toBe('ollama')
  })

  it('tolerates missing transport, promptTemplate, and preservedFields structures from legacy stored shapes', () => {
    const library = createDefaultPresetCompatLibrary()
    const preset = createPreset() as unknown as Record<string, unknown>
    delete preset.transport
    delete preset.promptTemplate
    delete preset.preservedFields
    library.presets['legacy-shape'] = preset as unknown as PresetCompatPresetRecord
    library.surfaceBindings.rewrite = {
      ...library.surfaceBindings.rewrite,
      presetId: 'legacy-shape',
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
          },
        },
      },
    })

    expect(runtime.providerRuntime).toEqual({
      provider: 'openai-compatible',
      config: {
        baseUrl: 'https://default.example/v1',
        apiKey: 'default-key',
        model: 'default-model',
      },
      request: {
        temperature: 0.81,
        top_p: 0.92,
        frequency_penalty: 0.22,
        presence_penalty: 0.31,
        max_tokens: 4096,
      },
    })
    expect(runtime.warnings).not.toEqual(expect.arrayContaining([
      expect.stringContaining('max_context_unlocked'),
      expect.stringContaining('send_if_empty'),
    ]))
  })
})
