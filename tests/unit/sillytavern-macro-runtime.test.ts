import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import type { PresetCompatLibrary } from '@/lib/preset-compat/types'

function createRuntimeLibrary(): PresetCompatLibrary {
  const library = createDefaultPresetCompatLibrary()

  library.standaloneRegexes['regex-user-input'] = {
    id: 'regex-user-input',
    name: 'Rewrite user input',
    pattern: 'ALPHA',
    replacement: 'BETA',
    flags: 'g',
    disabled: false,
    placements: ['user_input'],
    trimStrings: [],
    promptOnly: true,
    markdownOnly: false,
    minDepth: null,
    maxDepth: null,
    substituteRegex: null,
    runOnEdit: true,
    passthrough: {},
  }

  library.standaloneRegexes['regex-warning'] = {
    id: 'regex-warning',
    name: 'Skipped warning rule',
    pattern: 'unused',
    replacement: 'unused',
    flags: 'g',
    disabled: false,
    placements: ['user_input'],
    trimStrings: [],
    promptOnly: true,
    markdownOnly: false,
    minDepth: null,
    maxDepth: null,
    substituteRegex: '1',
    runOnEdit: true,
    passthrough: {},
  }

  library.presets['rewrite-preset'] = {
    id: 'rewrite-preset',
    name: 'Rewrite preset',
    sourceApiId: 'openai',
    promptRules: [
      {
        id: 'system-rule',
        name: 'System rule',
        role: 'system',
        content: 'Hello {{user}} {{setvar::topic::ALPHA}}',
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
        content: 'Rule sees {{getvar::topic}}',
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
    attachedStandaloneRegexIds: ['regex-user-input', 'regex-warning'],
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
      maxTokens: 333,
      seed: 987,
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
        seed: 987,
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

  return library
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('sillytavern macro runtime', () => {
  it('runs macro expansion before user_input regex, exposes macro diagnostics, and preserves raw stored presets', async () => {
    const library = createRuntimeLibrary()
    vi.doMock('@/lib/server/preset-compat-library', () => ({
      loadStoredPresetCompatLibrary: () => library,
    }))

    const { applyPresetCompatCreativeRuntime: applyRuntime } = await import('@/lib/preset-compat/apply-runtime')
    const runtime = applyRuntime({
      surfaceId: 'rewrite',
      providerDefaults: {
        provider: 'openai-compatible',
        openAICompatible: {
          config: {
            baseUrl: 'https://example.test/v1',
            apiKey: 'test-key',
            model: 'test-model',
          },
          request: {
            max_tokens: 333,
          },
        },
      },
      systemPrompt: 'Base system',
      userPrompt: 'Prompt sees {{getvar::topic}}',
    })

    expect(runtime.systemPrompt).toContain('Hello ')
    expect(runtime.userPrompt).toContain('Rule sees BETA')
    expect(runtime.userPrompt).toContain('Prompt sees BETA')
    expect(runtime.warnings).toEqual(expect.arrayContaining([
      'Preset field `seed` was preserved for export but not applied to openai-compatible.',
    ]))
    expect(runtime.warnings).not.toContain(
      'Skipped rule regex-warning because substituteRegex=1 is outside the MVP runtime subset.'
    )
    expect(runtime.metadata.macroDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'MISSING_CONTEXT_VALUE',
        macroName: 'user',
      }),
    ]))
    expect(library.presets['rewrite-preset']?.promptRules[0]?.content).toBe('Hello {{user}} {{setvar::topic::ALPHA}}')
    expect(library.presets['rewrite-preset']?.promptRules[1]?.content).toBe('Rule sees {{getvar::topic}}')
  })
})
