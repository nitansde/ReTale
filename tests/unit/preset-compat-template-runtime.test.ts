import { describe, expect, it } from 'vitest'
import { assemblePresetCompatPrompts } from '@/lib/preset-compat/prompt-assembly'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import { resolvePresetCompatRuntime } from '@/lib/preset-compat/resolve-runtime'

function createProviderDefaults() {
  return {
    provider: 'openai-compatible' as const,
    openAICompatible: {
      config: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        model: 'test-model',
      },
      request: {},
    },
  }
}

function createTemplateLibrary() {
  const library = createDefaultPresetCompatLibrary()
  library.presets['template-preset'] = {
    id: 'template-preset',
    name: 'Template Preset',
    sourceApiId: 'openai',
    promptRules: [],
    promptOrderLists: {
      rewrite: [],
      future_jump: [],
      roleplay: [],
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
      maxTokens: null,
      seed: null,
      candidateCount: null,
    },
    promptTemplate: {
      namesBehavior: null,
      sendIfEmpty: null,
      impersonationPrompt: 'IMPERSONATION TEMPLATE',
      newChatPrompt: 'NEW CHAT TEMPLATE',
      newGroupChatPrompt: 'NEW GROUP TEMPLATE',
      newExampleChatPrompt: 'NEW EXAMPLE TEMPLATE',
      continueNudgePrompt: 'CONTINUE TEMPLATE',
      wiFormat: null,
      scenarioFormat: null,
      personalityFormat: null,
      groupNudgePrompt: 'GROUP NUDGE TEMPLATE',
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
      root: {},
      extensions: {},
      unknownPromptFields: {},
    },
    importWarnings: [],
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:00.000Z',
  }

  for (const surfaceId of ['rewrite', 'future_jump', 'roleplay'] as const) {
    library.surfaceBindings[surfaceId] = {
      ...library.surfaceBindings[surfaceId],
      enabled: true,
      presetId: 'template-preset',
    }
  }

  return library
}

function getStatus(runtime: ReturnType<typeof resolvePresetCompatRuntime>, field: string) {
  return runtime.fieldStatuses.find((status) => status.field === field)
}

describe('preset compat template runtime', () => {
  it('applies only supported template fragments through the shared runtime contract', () => {
    const runtime = resolvePresetCompatRuntime({
      library: createTemplateLibrary(),
      surfaceId: 'roleplay',
      providerDefaults: createProviderDefaults(),
      promptRuleRuntimeContext: {
        sessionPhase: 'new_group_chat',
        hasGroupContext: true,
        hasImpersonationContext: true,
      },
    })

    expect(runtime.templateFragments.system.map((fragment) => fragment.field)).toEqual([
      'group_nudge_prompt',
    ])
    expect(getStatus(runtime, 'group_nudge_prompt')).toMatchObject({
      status: 'applied',
      reason: 'SUPPORTED_RUNTIME',
    })
    expect(getStatus(runtime, 'new_group_chat_prompt')).toBeUndefined()
    expect(getStatus(runtime, 'impersonation_prompt')).toBeUndefined()
  })

  it('ignores SillyTavern-only template fields at runtime instead of degrading them', () => {
    const runtime = resolvePresetCompatRuntime({
      library: createTemplateLibrary(),
      surfaceId: 'rewrite',
      providerDefaults: createProviderDefaults(),
      promptRuleRuntimeContext: {
        sessionPhase: 'continue',
        hasGroupContext: false,
        hasImpersonationContext: false,
      },
    })

    expect(runtime.templateFragments.system.map((fragment) => fragment.field)).toEqual([])
    expect(getStatus(runtime, 'group_nudge_prompt')).toMatchObject({
      status: 'degraded',
      reason: 'NO_GROUP_CONTEXT',
    })
    expect(getStatus(runtime, 'new_chat_prompt')).toBeUndefined()
    expect(getStatus(runtime, 'new_group_chat_prompt')).toBeUndefined()
    expect(getStatus(runtime, 'new_example_chat_prompt')).toBeUndefined()
    expect(getStatus(runtime, 'continue_nudge_prompt')).toBeUndefined()
    expect(getStatus(runtime, 'impersonation_prompt')).toBeUndefined()
  })

  it('keeps ignored SillyTavern template fields out of runtime fragments even when matching contexts exist', () => {
    const library = createTemplateLibrary()

    const newChatRuntime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'rewrite',
      providerDefaults: createProviderDefaults(),
      promptRuleRuntimeContext: {
        sessionPhase: 'new_chat',
      },
    })
    expect(newChatRuntime.templateFragments.system.map((fragment) => fragment.field)).not.toContain('new_chat_prompt')
    expect(getStatus(newChatRuntime, 'new_chat_prompt')).toBeUndefined()

    const exampleRuntime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'rewrite',
      providerDefaults: createProviderDefaults(),
      promptRuleRuntimeContext: {
        sessionPhase: 'new_example_chat',
      },
    })
    expect(exampleRuntime.templateFragments.system.map((fragment) => fragment.field)).not.toContain('new_example_chat_prompt')
    expect(getStatus(exampleRuntime, 'new_example_chat_prompt')).toBeUndefined()

    const explicitExampleRuntime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'rewrite',
      providerDefaults: createProviderDefaults(),
      promptRuleRuntimeContext: {
        sessionPhase: 'new_example_chat',
        hasExampleContext: true,
      },
    })
    expect(explicitExampleRuntime.templateFragments.system.map((fragment) => fragment.field)).not.toContain('new_example_chat_prompt')
    expect(getStatus(explicitExampleRuntime, 'new_example_chat_prompt')).toBeUndefined()

    const implicitRoleplayRuntime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'roleplay',
      providerDefaults: createProviderDefaults(),
      promptRuleRuntimeContext: {},
    })
    expect(implicitRoleplayRuntime.templateFragments.system.map((fragment) => fragment.field)).not.toContain('impersonation_prompt')
    expect(getStatus(implicitRoleplayRuntime, 'impersonation_prompt')).toBeUndefined()

    const explicitRoleplayRuntime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'roleplay',
      providerDefaults: createProviderDefaults(),
      promptRuleRuntimeContext: {
        hasImpersonationContext: true,
      },
    })
    expect(explicitRoleplayRuntime.templateFragments.system.map((fragment) => fragment.field)).not.toContain('impersonation_prompt')
    expect(getStatus(explicitRoleplayRuntime, 'impersonation_prompt')).toBeUndefined()

    const continueRuntime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'rewrite',
      providerDefaults: createProviderDefaults(),
      promptRuleRuntimeContext: {
        sessionPhase: 'continue',
      },
    })
    expect(continueRuntime.templateFragments.system.map((fragment) => fragment.field)).not.toContain('continue_nudge_prompt')
    expect(getStatus(continueRuntime, 'continue_nudge_prompt')).toBeUndefined()
  })

  it('wraps matching world, scenario, and personality context blocks exactly once', () => {
    const library = createTemplateLibrary()
    library.presets['template-preset'] = {
      ...library.presets['template-preset'],
      promptTemplate: {
        ...library.presets['template-preset'].promptTemplate,
        wiFormat: '[WI]\n{0}\n[/WI]',
        scenarioFormat: '[SCENARIO]\n{{scenario}}\n[/SCENARIO]',
        personalityFormat: '[PERSONALITY]\n{{personality}}\n[/PERSONALITY]',
      },
    }

    const runtime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'rewrite',
      providerDefaults: createProviderDefaults(),
      promptRuleRuntimeContext: {
        surfaceContextBlocks: [
          { id: 'worldbuilding', label: '相关设定', abstraction: 'world_info', content: '# 相关世界设定\n- 月海｜location｜银蓝色潮汐' },
          { id: 'current-summary', label: '当前章节摘要', abstraction: 'scenario', content: '# 当前章节摘要\n男女主在码头对峙。' },
          { id: 'characters', label: '相关人物', abstraction: 'personality', content: '# 相关人物\n- 林澈｜状态：强撑镇定｜嘴硬心软' },
        ],
      },
    })

    const assembled = assemblePresetCompatPrompts({
      baseSystemPrompt: 'SYSTEM',
      baseUserPrompt: [
        '# 任务',
        '操作类型：rewrite',
        '',
        '# 当前章节摘要',
        '男女主在码头对峙。',
        '',
        '# 相关人物',
        '- 林澈｜状态：强撑镇定｜嘴硬心软',
        '',
        '# 相关世界设定',
        '- 月海｜location｜银蓝色潮汐',
      ].join('\n'),
      surfaceContextBlocks: runtime.promptRules.ordered.length >= 0
        ? [
            { id: 'worldbuilding', abstraction: 'world_info', content: '# 相关世界设定\n- 月海｜location｜银蓝色潮汐' },
            { id: 'current-summary', abstraction: 'scenario', content: '# 当前章节摘要\n男女主在码头对峙。' },
            { id: 'characters', abstraction: 'personality', content: '# 相关人物\n- 林澈｜状态：强撑镇定｜嘴硬心软' },
          ]
        : [],
      contextBlockFormats: runtime.contextBlockFormats,
      namesBehavior: runtime.namesBehavior,
    })

    expect(runtime.contextBlockFormats).toEqual([
      { field: 'wi_format', abstraction: 'world_info', format: '[WI]\n{0}\n[/WI]', blockIds: ['worldbuilding'] },
      { field: 'scenario_format', abstraction: 'scenario', format: '[SCENARIO]\n{{scenario}}\n[/SCENARIO]', blockIds: ['current-summary'] },
      { field: 'personality_format', abstraction: 'personality', format: '[PERSONALITY]\n{{personality}}\n[/PERSONALITY]', blockIds: ['characters'] },
    ])
    expect(assembled.userPromptBeforeRegex.match(/\[WI\]/g)?.length ?? 0).toBe(1)
    expect(assembled.userPromptBeforeRegex.match(/\[SCENARIO\]/g)?.length ?? 0).toBe(1)
    expect(assembled.userPromptBeforeRegex.match(/\[PERSONALITY\]/g)?.length ?? 0).toBe(1)
    expect(assembled.userPromptBeforeRegex).toContain('[WI]\n# 相关世界设定\n- 月海｜location｜银蓝色潮汐\n[/WI]')
    expect(assembled.userPromptBeforeRegex).toContain('[SCENARIO]\n# 当前章节摘要\n男女主在码头对峙。\n[/SCENARIO]')
    expect(assembled.userPromptBeforeRegex).toContain('[PERSONALITY]\n# 相关人物\n- 林澈｜状态：强撑镇定｜嘴硬心软\n[/PERSONALITY]')
  })

  it('degrades names behavior without a named transcript and applies it when named transcript exists', () => {
    const library = createTemplateLibrary()
    library.presets['template-preset'] = {
      ...library.presets['template-preset'],
      promptTemplate: {
        ...library.presets['template-preset'].promptTemplate,
        namesBehavior: 1,
      },
    }

    const degradedRuntime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'rewrite',
      providerDefaults: createProviderDefaults(),
      promptRuleRuntimeContext: {
        namedTranscript: {
          kind: 'chat',
          userName: '苏晚',
          assistantName: '林澈',
        },
        surfaceContextBlocks: [
          { id: 'characters', label: '相关人物', abstraction: 'personality', content: '# 相关人物\n- 林澈｜状态：克制｜话少但护短' },
        ],
      },
    })
    expect(getStatus(degradedRuntime, 'names_behavior')).toMatchObject({
      status: 'degraded',
      reason: 'NO_CHAT_HISTORY',
    })

    const appliedRuntime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'roleplay',
      providerDefaults: createProviderDefaults(),
      promptRuleRuntimeContext: {
        surfaceContextBlocks: [
          { id: 'transcript', label: '对话', abstraction: 'named_transcript', content: 'USER: 你好\nASSISTANT: 你好，林澈。' },
        ],
        namedTranscript: {
          kind: 'roleplay',
          userName: '苏晚',
          assistantName: '林澈',
        },
      },
    })
    const assembled = assemblePresetCompatPrompts({
      baseSystemPrompt: 'SYSTEM',
      baseUserPrompt: 'USER: 你好\nASSISTANT: 你好，林澈。',
      surfaceContextBlocks: [
        { id: 'transcript', abstraction: 'named_transcript', content: 'USER: 你好\nASSISTANT: 你好，林澈。' },
      ],
      contextBlockFormats: appliedRuntime.contextBlockFormats,
      namesBehavior: appliedRuntime.namesBehavior,
    })

    expect(getStatus(appliedRuntime, 'names_behavior')).toMatchObject({
      status: 'applied',
      reason: 'SUPPORTED_RUNTIME',
    })
    expect(assembled.userPromptBeforeRegex).toContain('苏晚: 你好')
    expect(assembled.userPromptBeforeRegex).toContain('林澈: 你好，林澈。')
  })

  it('degrades omitted formatting blocks instead of marking them applied', () => {
    const library = createTemplateLibrary()
    library.presets['template-preset'] = {
      ...library.presets['template-preset'],
      promptTemplate: {
        ...library.presets['template-preset'].promptTemplate,
        wiFormat: '[WI]\n{0}\n[/WI]',
        scenarioFormat: '[SCENARIO]\n{{scenario}}\n[/SCENARIO]',
      },
    }

    const runtime = resolvePresetCompatRuntime({
      library,
      surfaceId: 'rewrite',
      providerDefaults: createProviderDefaults(),
      promptRuleRuntimeContext: {
        surfaceContextBlocks: [
          { id: 'current-summary', label: '当前章节摘要', abstraction: 'scenario', content: '# 当前章节摘要\n雨夜里的对峙一触即发。' },
        ],
      },
    })

    expect(runtime.contextBlockFormats).toEqual([
      { field: 'scenario_format', abstraction: 'scenario', format: '[SCENARIO]\n{{scenario}}\n[/SCENARIO]', blockIds: ['current-summary'] },
    ])
    expect(getStatus(runtime, 'wi_format')).toMatchObject({
      status: 'degraded',
      reason: 'WORLD_INFO_CONTEXT_REQUIRED',
    })
    expect(getStatus(runtime, 'scenario_format')).toMatchObject({
      status: 'applied',
      reason: 'SUPPORTED_RUNTIME',
    })
  })
})
