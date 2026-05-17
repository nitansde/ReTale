import { describe, expect, it } from 'vitest'

import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import { assemblePresetCompatRuntimePrompts } from '@/lib/preset-compat/prompt-assembly'
import { resolvePresetCompatRuntime, type PresetCompatRuntimeProviderDefaults } from '@/lib/preset-compat/resolve-runtime'

const PROVIDER_DEFAULTS: PresetCompatRuntimeProviderDefaults = {
  provider: 'openai-compatible',
  openAICompatible: {
    config: {
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
    },
    request: {
      max_tokens: 222,
    },
  },
}

describe('preset compat prompt assembly', () => {
  it('expands macros after imported-rule insertion and reuses one context across assembled prompt strings', () => {
    const library = createDefaultPresetCompatLibrary()
    library.presets['rewrite-preset'] = {
      id: 'rewrite-preset',
      name: 'Rewrite preset',
      sourceApiId: 'openai',
      promptRules: [
        {
          id: 'system-rule',
          name: 'System rule',
          role: 'system',
          content: '{{setvar::topic::ALPHA}}System topic {{getvar::topic}}',
          enabled: true,
          marker: false,
          injectAsSystemPrompt: true,
          injectionPosition: 'before',
          injectionDepth: null,
          injectionOrder: 1,
          injectionTrigger: [],
          forbidOverrides: false,
          condition: null,
          passthrough: {},
        },
        {
          id: 'user-rule',
          name: 'User rule',
          role: 'user',
          content: 'User topic {{getvar::topic}}',
          enabled: true,
          marker: false,
          injectAsSystemPrompt: false,
          injectionPosition: 'before',
          injectionDepth: null,
          injectionOrder: 2,
          injectionTrigger: [],
          forbidOverrides: false,
          condition: null,
          passthrough: {},
        },
      ],
      promptOrderLists: {
        rewrite: ['system-rule', 'user-rule'],
      },
      embeddedRegexes: [],
      attachedStandaloneRegexIds: [],
      runtimeSampler: {
        temperature: null,
        topP: null,
        topK: null,
        topA: null,
        minP: null,
        presencePenalty: null,
        frequencyPenalty: null,
        repetitionPenalty: null,
        openaiMaxContext: null,
        maxTokens: 222,
        seed: 123,
        candidateCount: null,
      },
      promptTemplate: {
        namesBehavior: null,
        sendIfEmpty: null,
        impersonationPrompt: null,
        newChatPrompt: null,
        newGroupChatPrompt: null,
        newExampleChatPrompt: null,
        continueNudgePrompt: null,
        wiFormat: null,
        scenarioFormat: null,
        personalityFormat: null,
        groupNudgePrompt: null,
        assistantPrefill: null,
        assistantImpersonation: null,
        continuePostfix: null,
        legacyMainPrompt: null,
        legacyNsfwPrompt: null,
        legacyJailbreakPrompt: null,
      },
      transport: {
        maxContextUnlocked: null,
        streamOpenAI: null,
        useSysprompt: null,
        squashSystemMessages: null,
        mediaInlining: null,
        inlineImageQuality: null,
        continuePrefill: null,
        functionCalling: null,
        showThoughts: null,
        reasoningEffort: null,
        verbosity: null,
        enableWebSearch: null,
        requestImages: null,
        requestImageAspectRatio: null,
        requestImageResolution: null,
      },
      preservedFields: {
        biasPresetSelected: null,
      },
      passthrough: {
        root: {
          seed: 123,
        },
      },
      importWarnings: [],
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
    }
    library.surfaceBindings.rewrite = {
      ...library.surfaceBindings.rewrite,
      enabled: true,
      presetId: 'rewrite-preset',
    }

    const resolvedRuntime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'rewrite',
      providerDefaults: PROVIDER_DEFAULTS,
    })

    const assembled = assemblePresetCompatRuntimePrompts({
      surfaceId: 'rewrite',
      resolvedRuntime,
      systemPrompt: 'Base system',
      userPrompt: 'Prompt topic {{getvar::topic}} / max {{maxresponse}}',
    })

    expect(assembled.systemPrompt).toContain('## Imported Preset System Rules')
    expect(assembled.systemPrompt).toContain('System topic ALPHA')
    expect(assembled.userPrompt).toContain('## Imported Preset User Rules')
    expect(assembled.userPrompt).toContain('User topic ALPHA')
    expect(assembled.userPrompt).toContain('Prompt topic ALPHA / max 222')
    expect(assembled.systemPrompt).not.toContain('{{')
    expect(assembled.userPrompt).not.toContain('{{')
    expect(assembled.metadata.macroDiagnostics).toEqual([])
  })
})
