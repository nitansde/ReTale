import { describe, expect, it } from 'vitest'
import {
  assemblePresetCompatPrompts,
  PRESET_COMPAT_PROMPT_ASSEMBLY_STAGE_ORDER,
  assemblePresetCompatRuntimePrompts,
} from '@/lib/preset-compat/prompt-assembly'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
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
  it('preserves the legacy append/prepend contract when only unstructured imported rule arrays are provided', () => {
    const assembled = assemblePresetCompatPrompts({
      baseSystemPrompt: 'Base system prompt.',
      baseUserPrompt: 'Base user prompt.',
      importedSystemRuleContents: ['System rule A.', 'System rule B.'],
      importedUserRuleContents: ['User rule A.', 'User rule B.'],
    })

    expect(assembled.systemPrompt).toBe([
      'System rule A.',
      'System rule B.',
    ].join('\n\n'))
    expect(assembled.userPromptBeforeRegex).toBe([
      'User rule A.',
      'User rule B.',
      'Base user prompt.',
    ].join('\n\n'))
  })

  it('routes structured imported rules into their canonical channels and placements', () => {
    const assembled = assemblePresetCompatPrompts({
      baseSystemPrompt: 'Base system prompt.',
      baseUserPrompt: 'Base user prompt.',
      importedPromptRules: [
        { channel: 'system', placement: 'prepend', text: 'System before.' },
        { channel: 'system', placement: 'append', text: 'System after.' },
        { channel: 'user', placement: 'prepend', text: 'User before.' },
        { channel: 'user', placement: 'append', text: 'User after.' },
      ],
      systemMetadataInsertions: ['System metadata insertion.'],
      userMetadataInsertions: ['User metadata insertion.'],
    })

    expect(assembled.systemPrompt).toBe([
      'System before.',
      'System after.',
      'System metadata insertion.',
    ].join('\n\n'))
    expect(assembled.userPromptBeforeRegex).toBe([
      'User before.',
      'Base user prompt.',
      'User after.',
      'User metadata insertion.',
    ].join('\n\n'))
  })

  it('emits structured stage metadata for structured imported rules', () => {
    const assembled = assemblePresetCompatPrompts({
      baseSystemPrompt: 'Base system prompt.',
      baseUserPrompt: 'Base user prompt.',
      systemTemplateFragments: ['System template fragment.'],
      userTemplateFragments: ['User template fragment.'],
      importedPromptRules: [
        { channel: 'system', placement: 'append', text: 'System rule A.' },
        { channel: 'user', placement: 'prepend', text: 'User rule A.' },
      ],
      systemMetadataInsertions: ['System metadata insertion.'],
      userMetadataInsertions: ['User metadata insertion.'],
    })

    expect(assembled.metadata.stageOrder).toEqual(PRESET_COMPAT_PROMPT_ASSEMBLY_STAGE_ORDER)
    expect(assembled.metadata.system.stages).toEqual([
      { stage: 'builtin_system_prompt', status: 'empty', segmentCount: 0 },
      { stage: 'base_prompt', status: 'empty', segmentCount: 0 },
      { stage: 'template_fragments', status: 'applied', segmentCount: 1 },
      { stage: 'imported_prompt_rules', status: 'applied', segmentCount: 1 },
      { stage: 'metadata_insertions', status: 'applied', segmentCount: 1 },
      { stage: 'regex_processing', status: 'pending', segmentCount: 0 },
    ])
    expect(assembled.metadata.user.stages).toEqual([
      { stage: 'builtin_system_prompt', status: 'empty', segmentCount: 0 },
      { stage: 'base_prompt', status: 'applied', segmentCount: 1 },
      { stage: 'template_fragments', status: 'applied', segmentCount: 1 },
      { stage: 'imported_prompt_rules', status: 'applied', segmentCount: 1 },
      { stage: 'metadata_insertions', status: 'applied', segmentCount: 1 },
      { stage: 'regex_processing', status: 'pending', segmentCount: 0 },
    ])
    expect(assembled.metadata.user.segments.find((segment) => segment.stage === 'imported_prompt_rules')).toMatchObject({
      channel: 'user',
      placement: 'prepend',
    })
  })

  it('drops empty sections without introducing blank wrappers', () => {
    const assembled = assemblePresetCompatPrompts({
      baseSystemPrompt: '  ',
      baseUserPrompt: 'Base user prompt.',
      importedPromptRules: [
        { channel: 'system', placement: 'append', text: '   ' },
      ],
      userMetadataInsertions: ['   '],
    })

    expect(assembled.systemPrompt).toBe('')
    expect(assembled.userPromptBeforeRegex).toBe('Base user prompt.')
    expect(assembled.metadata.system.stages).toEqual([
      { stage: 'builtin_system_prompt', status: 'empty', segmentCount: 0 },
      { stage: 'base_prompt', status: 'empty', segmentCount: 0 },
      { stage: 'template_fragments', status: 'empty', segmentCount: 0 },
      { stage: 'imported_prompt_rules', status: 'empty', segmentCount: 0 },
      { stage: 'metadata_insertions', status: 'empty', segmentCount: 0 },
      { stage: 'regex_processing', status: 'pending', segmentCount: 0 },
    ])
  })

  it('renders structured imported rules by channel and placement inside the assembly layer', () => {
    const assembled = assemblePresetCompatPrompts({
      baseSystemPrompt: 'Base system prompt.',
      baseUserPrompt: 'Base user prompt.',
      importedPromptRules: [
        { channel: 'system', placement: 'prepend', text: 'System prepended.' },
        { channel: 'system', placement: 'append', text: 'System appended.' },
        { channel: 'user', placement: 'prepend', text: 'User prepended.' },
        { channel: 'user', placement: 'append', text: 'User appended.' },
      ],
    })

    expect(assembled.systemPrompt).toBe([
      'System prepended.',
      'System appended.',
    ].join('\n\n'))
    expect(assembled.userPromptBeforeRegex).toBe([
      'User prepended.',
      'Base user prompt.',
      'User appended.',
    ].join('\n\n'))
    expect(assembled.metadata.system.stages).toEqual([
      { stage: 'builtin_system_prompt', status: 'empty', segmentCount: 0 },
      { stage: 'base_prompt', status: 'empty', segmentCount: 0 },
      { stage: 'template_fragments', status: 'empty', segmentCount: 0 },
      { stage: 'imported_prompt_rules', status: 'applied', segmentCount: 2 },
      { stage: 'metadata_insertions', status: 'empty', segmentCount: 0 },
      { stage: 'regex_processing', status: 'pending', segmentCount: 0 },
    ])
  })

  it('prepends ChatBook built-in system prompt before imported system rules', () => {
    const assembled = assemblePresetCompatPrompts({
      builtinSystemPrompt: 'ChatBook built-in system.',
      baseSystemPrompt: 'Base system prompt.',
      baseUserPrompt: 'Base user prompt.',
      importedPromptRules: [
        { channel: 'system', placement: 'append', text: 'Imported system rule.' },
      ],
    })

    expect(assembled.systemPrompt).toBe([
      'ChatBook built-in system.',
      'Imported system rule.',
    ].join('\n\n'))
    expect(assembled.metadata.system.stages[0]).toEqual({
      stage: 'builtin_system_prompt',
      status: 'applied',
      segmentCount: 1,
    })
  })

  it('concatenates active imported system rules in order, replaces the base system prompt, and reuses one macro context', () => {
    const library = createDefaultPresetCompatLibrary()
    library.builtinSystemPrompts.rewrite = {
      ...library.builtinSystemPrompts.rewrite,
      content: 'ChatBook builtin system',
    }
    library.presets['rewrite-preset'] = {
      id: 'rewrite-preset',
      name: 'Rewrite preset',
      sourceApiId: 'openai',
      promptRules: [
        {
          id: 'system-rule-a',
          name: 'System rule A',
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
          id: 'system-rule-b',
          name: 'System rule B',
          role: 'system',
          content: 'System echo {{getvar::topic}}',
          enabled: true,
          marker: false,
          injectAsSystemPrompt: true,
          injectionPosition: 'before',
          injectionDepth: null,
          injectionOrder: 3,
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
        rewrite: ['system-rule-a', 'user-rule', 'system-rule-b'],
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

    expect(assembled.systemPrompt).toBe([
      'ChatBook builtin system',
      'System topic ALPHA',
      'System echo ALPHA',
    ].join('\n\n'))
    expect(assembled.systemPrompt).not.toContain('Base system')
    expect(assembled.userPrompt).not.toContain('## Imported Preset User Rules')
    expect(assembled.userPrompt).toContain('User topic ALPHA')
    expect(assembled.userPrompt).toContain('Prompt topic ALPHA / max 222')
    expect(assembled.systemPrompt).not.toContain('{{')
    expect(assembled.userPrompt).not.toContain('{{')
    expect(assembled.metadata.macroDiagnostics).toEqual([])
  })

  it('omits disabled ChatBook built-in prompts from runtime assembly without leaving blank wrappers', () => {
    const library = createDefaultPresetCompatLibrary()
    library.builtinSystemPrompts.rewrite = {
      ...library.builtinSystemPrompts.rewrite,
      enabled: false,
      content: 'Disabled built-in prompt',
    }

    const resolvedRuntime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'rewrite',
      providerDefaults: PROVIDER_DEFAULTS,
    })

    const assembled = assemblePresetCompatRuntimePrompts({
      surfaceId: 'rewrite',
      resolvedRuntime,
      systemPrompt: '',
      userPrompt: 'Base user prompt.',
    })

    expect(assembled.systemPrompt).toBe('')
    expect(assembled.promptAssembly.system.stages[0]).toEqual({
      stage: 'builtin_system_prompt',
      status: 'empty',
      segmentCount: 0,
    })
  })
})
