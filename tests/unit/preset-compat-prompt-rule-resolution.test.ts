import { describe, expect, it } from 'vitest'
import { resolvePresetCompatPromptRuleSubset } from '@/lib/preset-compat/resolve-runtime'
import type {
  PresetCompatPresetRecord,
  PresetCompatPromptRule,
  PresetCompatPromptRuleRuntimeContext,
} from '@/lib/preset-compat/types'

function createRule(overrides: Partial<PresetCompatPromptRule> & Pick<PresetCompatPromptRule, 'id' | 'name' | 'role' | 'content'>): PresetCompatPromptRule {
  return {
    enabled: true,
    marker: false,
    injectAsSystemPrompt: false,
    injectionPosition: 'before',
    injectionDepth: null,
    injectionOrder: null,
    injectionTrigger: [],
    forbidOverrides: false,
    condition: null,
    passthrough: {},
    ...overrides,
  }
}

function createPromptPreset(promptRules: PresetCompatPromptRule[]): PresetCompatPresetRecord {
  return {
    id: 'preset-prompts-001',
    name: 'Prompt fixture',
    sourceApiId: 'openai',
    promptRules,
    promptOrderLists: {
      rewrite: promptRules.map((rule) => rule.id),
      roleplay: promptRules.map((rule) => rule.id),
      continue: promptRules.map((rule) => rule.id),
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
      root: {},
      extensions: {},
      unknownPromptFields: {},
    },
    importWarnings: [],
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
  }
}

function createLegacyShapePromptPreset(): PresetCompatPresetRecord {
  return {
    id: 'preset-prompts-legacy-001',
    name: 'Prompt legacy fixture',
    sourceApiId: 'openai',
    promptRules: [
      {
        id: 'system-late',
        name: 'System Late',
        role: 'system',
        content: 'System content sorted second.',
        enabled: true,
        marker: false,
        injectAsSystemPrompt: true,
        injectionPosition: 'after',
        injectionDepth: 4,
        injectionOrder: 20,
        injectionTrigger: 'rewrite' as unknown as string[],
        forbidOverrides: true,
        condition: null,
        passthrough: {
          exportedFrom: 'fixture',
        },
      },
      {
        id: 'user-early',
        name: 'User Early',
        role: 'user',
        content: 'User content sorted first.',
        enabled: true,
        marker: false,
        injectAsSystemPrompt: false,
        injectionPosition: 'before',
        injectionDepth: null,
        injectionOrder: 10,
        injectionTrigger: null as unknown as string[],
        forbidOverrides: false,
        condition: null,
        passthrough: {},
      },
      {
        id: 'unsupported-role',
        name: 'Unsupported Role',
        role: 'assistant' as PresetCompatPromptRule['role'],
        content: 'Should not be applied.',
        enabled: true,
        marker: false,
        injectAsSystemPrompt: false,
        injectionPosition: 'before',
        injectionDepth: null,
        injectionOrder: 5,
        injectionTrigger: null as unknown as string[],
        forbidOverrides: false,
        condition: null,
        passthrough: {
          preservedOnly: true,
        },
      },
      {
        id: 'marker-rule',
        name: 'Marker Rule',
        role: 'user',
        content: 'Marker content should be skipped.',
        enabled: true,
        marker: true,
        injectAsSystemPrompt: false,
        injectionPosition: 'before',
        injectionDepth: null,
        injectionOrder: 15,
        injectionTrigger: null as unknown as string[],
        forbidOverrides: false,
        condition: null,
        passthrough: {},
      },
      {
        id: 'empty-rule',
        name: 'Empty Rule',
        role: 'system',
        content: '   ',
        enabled: true,
        marker: false,
        injectAsSystemPrompt: false,
        injectionPosition: 'before',
        injectionDepth: null,
        injectionOrder: 12,
        injectionTrigger: null as unknown as string[],
        forbidOverrides: false,
        condition: null,
        passthrough: {},
      },
      {
        id: 'same-order-a',
        name: 'Same Order A',
        role: 'system',
        content: 'Fallback keeps original order A.',
        enabled: true,
        marker: false,
        injectAsSystemPrompt: false,
        injectionPosition: 'none',
        injectionDepth: null,
        injectionOrder: null,
        injectionTrigger: null as unknown as string[],
        forbidOverrides: false,
        condition: null,
        passthrough: {},
      },
      {
        id: 'same-order-b',
        name: 'Same Order B',
        role: 'user',
        content: 'Fallback keeps original order B.',
        enabled: true,
        marker: false,
        injectAsSystemPrompt: false,
        injectionPosition: 'none',
        injectionDepth: null,
        injectionOrder: null,
        injectionTrigger: null as unknown as string[],
        forbidOverrides: false,
        condition: null,
        passthrough: {},
      },
      {
        id: 'not-in-active-order',
        name: 'Not In Active Order',
        role: 'system',
        content: 'This should not be considered active.',
        enabled: true,
        marker: false,
        injectAsSystemPrompt: false,
        injectionPosition: 'before',
        injectionDepth: null,
        injectionOrder: 1,
        injectionTrigger: null as unknown as string[],
        forbidOverrides: false,
        condition: null,
        passthrough: {},
      },
    ],
    promptOrderLists: {
      rewrite: [
        'user-early',
        'system-late',
        'unsupported-role',
        'marker-rule',
        'empty-rule',
        'same-order-a',
        'same-order-b',
      ],
      roleplay: [],
      continue: [],
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
      root: {},
      extensions: {},
      unknownPromptFields: {},
    },
    importWarnings: [],
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
  }
}

function getFieldStatus(resolved: ReturnType<typeof resolvePresetCompatPromptRuleSubset>, field: string, fragmentId: string) {
  return resolved.fieldStatuses.find((status) => status.field === field && status.fragmentId === fragmentId)
}

describe('preset compat prompt rule resolution', () => {
  it('routes system_prompt content into the system slot and keeps supported ordering metadata', () => {
    const preset = createPromptPreset([
      createRule({
        id: 'as-system',
        name: 'As System',
        role: 'user',
        content: 'Route me to system.',
        injectAsSystemPrompt: true,
        injectionPosition: 'after',
        injectionOrder: 2,
      }),
      createRule({
        id: 'plain-user',
        name: 'Plain User',
        role: 'user',
        content: 'Keep me in user.',
        injectionOrder: 1,
      }),
    ])

    const resolved = resolvePresetCompatPromptRuleSubset({
      preset,
      surfaceId: 'rewrite',
    })

    expect(resolved.promptRules.ordered.map((rule) => ({ id: rule.id, channel: rule.channel }))).toEqual([
      { id: 'plain-user', channel: 'user' },
      { id: 'as-system', channel: 'system' },
    ])
    expect(resolved.promptRules.system.map((rule) => rule.id)).toEqual(['as-system'])
    expect(resolved.promptRules.user.map((rule) => rule.id)).toEqual(['plain-user'])
    expect(getFieldStatus(resolved, 'prompts.system_prompt', 'as-system')).toMatchObject({
      status: 'applied',
      reason: 'SUPPORTED_RUNTIME',
      value: true,
    })
    expect(getFieldStatus(resolved, 'prompts.injection_position', 'as-system')).toMatchObject({
      status: 'applied',
      reason: 'SUPPORTED_RUNTIME',
      value: 'after',
    })
  })

  it('applies only allowlisted triggers when the runtime context matches', () => {
    const preset = createPromptPreset([
      createRule({
        id: 'new-chat',
        name: 'New Chat',
        role: 'system',
        content: 'Only for new chat.',
        injectionTrigger: ['new_chat'],
      }),
      createRule({
        id: 'continue-only',
        name: 'Continue Only',
        role: 'user',
        content: 'Only for continue.',
        injectionTrigger: ['continue'],
      }),
      createRule({
        id: 'group-only',
        name: 'Group Only',
        role: 'system',
        content: 'Only for group.',
        injectionTrigger: ['group'],
      }),
      createRule({
        id: 'unknown-trigger',
        name: 'Unknown Trigger',
        role: 'system',
        content: 'Should never apply.',
        injectionTrigger: ['rewrite'],
      }),
    ])

    const runtimeContext: PresetCompatPromptRuleRuntimeContext = {
      sessionPhase: 'new_chat',
      hasGroupContext: false,
    }

    const resolved = resolvePresetCompatPromptRuleSubset({
      preset,
      surfaceId: 'rewrite',
      runtimeContext,
    })

    expect(resolved.promptRules.ordered.map((rule) => rule.id)).toEqual(['new-chat'])
    expect(getFieldStatus(resolved, 'prompts.injection_trigger', 'new-chat')).toMatchObject({
      status: 'applied',
      reason: 'SUPPORTED_RUNTIME',
      value: ['new_chat'],
    })
    expect(getFieldStatus(resolved, 'prompts.injection_trigger', 'continue-only')).toMatchObject({
      status: 'degraded',
      reason: 'CONTINUE_SURFACE_ONLY',
      value: ['continue'],
    })
    expect(getFieldStatus(resolved, 'prompts.injection_trigger', 'group-only')).toMatchObject({
      status: 'degraded',
      reason: 'NO_GROUP_CONTEXT',
      value: ['group'],
    })
    expect(getFieldStatus(resolved, 'prompts.injection_trigger', 'unknown-trigger')).toMatchObject({
      status: 'degraded',
      reason: 'UNKNOWN_TRIGGER',
      value: ['rewrite'],
    })
    expect(resolved.warnings).toEqual(expect.arrayContaining([
      'Prompt rule `Continue Only` was preserved but not applied because its triggers (continue) did not match the current runtime context.',
      'Prompt rule `Group Only` was preserved but not applied because its triggers (group) did not match the current runtime context.',
      'Prompt rule `Unknown Trigger` was preserved but not applied because it declares unsupported triggers (rewrite).',
    ]))
  })

  it('evaluates only allowlisted safe conditions and never executes unknown or unsafe strings', () => {
    const preset = createPromptPreset([
      createRule({
        id: 'always',
        name: 'Always',
        role: 'system',
        content: 'Always applies.',
        condition: 'true',
      }),
      createRule({
        id: 'never',
        name: 'Never',
        role: 'system',
        content: 'Never applies.',
        condition: 'false',
      }),
      createRule({
        id: 'unknown',
        name: 'Unknown',
        role: 'system',
        content: 'Unknown condition.',
        condition: 'chapter_mode',
      }),
      createRule({
        id: 'unsafe',
        name: 'Unsafe',
        role: 'system',
        content: 'Unsafe condition.',
        condition: 'globalThis.process.exit(1)',
      }),
    ])

    const resolved = resolvePresetCompatPromptRuleSubset({
      preset,
      surfaceId: 'rewrite',
      runtimeContext: {
        sessionPhase: 'new_chat',
      },
    })

    expect(resolved.promptRules.ordered.map((rule) => rule.id)).toEqual(['always'])
    expect(getFieldStatus(resolved, 'prompts.condition', 'always')).toMatchObject({
      status: 'applied',
      reason: 'SUPPORTED_RUNTIME',
      value: {
        expression: 'true',
        result: true,
      },
    })
    expect(getFieldStatus(resolved, 'prompts.condition', 'never')).toMatchObject({
      status: 'applied',
      reason: 'SUPPORTED_RUNTIME',
      value: {
        expression: 'false',
        result: false,
      },
    })
    expect(getFieldStatus(resolved, 'prompts.condition', 'unknown')).toMatchObject({
      status: 'degraded',
      reason: 'UNKNOWN_CONDITION',
      value: 'chapter_mode',
    })
    expect(getFieldStatus(resolved, 'prompts.condition', 'unsafe')).toMatchObject({
      status: 'degraded',
      reason: 'UNSAFE_CONDITION',
      value: 'globalThis.process.exit(1)',
    })
    expect(resolved.warnings).toEqual(expect.arrayContaining([
      'Prompt rule `Unknown` was preserved but not applied because condition `chapter_mode` is unknown.',
      'Prompt rule `Unsafe` was preserved but not applied because condition `globalThis.process.exit(1)` is unsafe.',
    ]))
    expect(resolved.preservedPromptMetadata).toEqual(expect.arrayContaining([
      {
        ruleId: 'unknown',
        metadata: {
          condition: 'chapter_mode',
        },
      },
      {
        ruleId: 'unsafe',
        metadata: {
          condition: 'globalThis.process.exit(1)',
        },
      },
    ]))
  })

  it('blocks later fragments from the same slot when forbidOverrides protects the imported slot', () => {
    const preset = createPromptPreset([
      createRule({
        id: 'protected',
        name: 'Protected',
        role: 'system',
        content: 'Protected system content.',
        forbidOverrides: true,
        injectionOrder: 1,
      }),
      createRule({
        id: 'blocked',
        name: 'Blocked',
        role: 'system',
        content: 'Blocked system content.',
        injectionOrder: 2,
      }),
      createRule({
        id: 'different-slot',
        name: 'Different Slot',
        role: 'system',
        content: 'Allowed because placement differs.',
        injectionPosition: 'after',
        injectionOrder: 3,
      }),
    ])

    const resolved = resolvePresetCompatPromptRuleSubset({
      preset,
      surfaceId: 'rewrite',
    })

    expect(resolved.promptRules.ordered.map((rule) => rule.id)).toEqual(['protected', 'different-slot'])
    expect(getFieldStatus(resolved, 'prompts.forbid_overrides', 'protected')).toMatchObject({
      status: 'applied',
      reason: 'SUPPORTED_RUNTIME',
      value: true,
    })
    expect(getFieldStatus(resolved, 'prompts.content', 'blocked')).toMatchObject({
      status: 'degraded',
      reason: 'FORBID_OVERRIDES_PROTECTED',
      value: 'Blocked system content.',
    })
    expect(resolved.warnings).toContain(
      'Prompt rule `Blocked` was preserved but not applied because `Protected` protects the same imported prompt slot with forbidOverrides.'
    )
  })

  it('degrades in_chat and depth placement on string-only surfaces with explicit statuses', () => {
    const preset = createPromptPreset([
      createRule({
        id: 'in-chat',
        name: 'In Chat',
        role: 'system',
        content: 'Chat history placement.',
        injectionPosition: 'in_chat',
        injectionDepth: 4,
      }),
    ])

    const resolved = resolvePresetCompatPromptRuleSubset({
      preset,
      surfaceId: 'rewrite',
      runtimeContext: {
        supportsVirtualDepth: false,
      },
    })

    expect(resolved.promptRules.ordered).toEqual([])
    expect(getFieldStatus(resolved, 'prompts.injection_position', 'in-chat')).toMatchObject({
      status: 'degraded',
      reason: 'VIRTUAL_DEPTH_REQUIRED',
      value: 'in_chat',
    })
    expect(getFieldStatus(resolved, 'prompts.injection_depth', 'in-chat')).toMatchObject({
      status: 'degraded',
      reason: 'VIRTUAL_DEPTH_REQUIRED',
      value: 4,
    })
    expect(resolved.warnings).toContain(
      'Prompt rule `In Chat` was preserved but not applied because virtual chat depth placement is unavailable on string-only surfaces.'
    )
    expect(resolved.preservedPromptMetadata).toEqual([
      {
        ruleId: 'in-chat',
        metadata: {
          injectionPosition: 'in_chat',
          injectionDepth: 4,
        },
      },
    ])
  })

  it('applies only enabled active-order non-marker system and user rules from legacy stored shapes', () => {
    const preset = createLegacyShapePromptPreset()

    const resolved = resolvePresetCompatPromptRuleSubset({
      preset,
      surfaceId: 'rewrite',
    })

    expect(resolved.promptRules.ordered.map((rule) => rule.id)).toEqual([
      'user-early',
      'same-order-a',
      'same-order-b',
    ])
    expect(resolved.promptRules.system.map((rule) => rule.id)).toEqual([
      'same-order-a',
    ])
    expect(resolved.promptRules.user.map((rule) => rule.id)).toEqual([
      'user-early',
      'same-order-b',
    ])
    expect(resolved.promptRules.ordered.every((rule) => rule.content.trim().length > 0)).toBe(true)
  })

  it('warns when preserved-only prompt metadata or unsupported prompt categories are encountered', () => {
    const preset = createLegacyShapePromptPreset()

    const resolved = resolvePresetCompatPromptRuleSubset({
      preset,
      surfaceId: 'rewrite',
    })

    expect(resolved.preservedPromptMetadata).toEqual([
      {
        ruleId: 'system-late',
        metadata: {
          injectionDepth: 4,
        },
      },
    ])
    expect(resolved.warnings).toEqual(expect.arrayContaining([
      'Prompt rule `System Late` was preserved but not applied because virtual chat depth placement is unavailable on string-only surfaces.',
      'Prompt rule `Unsupported Role` was preserved but not applied because role `assistant` is unsupported in MVP runtime.',
      'Prompt rule `Marker Rule` was active but skipped because marker prompts are preserved-only in MVP runtime.',
      'Prompt rule `Empty Rule` was active but skipped because its content was empty.',
    ]))
    expect(preset.promptRules.find((rule) => rule.id === 'unsupported-role')?.passthrough).toEqual({
      preservedOnly: true,
    })
  })

  it('tolerates missing or non-array injectionTrigger values from legacy stored shapes', () => {
    const preset = createLegacyShapePromptPreset() as unknown as {
      promptRules: Array<Record<string, unknown>>
    }

    preset.promptRules[0].injectionTrigger = 'rewrite'
    preset.promptRules[1].injectionTrigger = null

    const resolved = resolvePresetCompatPromptRuleSubset({
      preset: preset as unknown as PresetCompatPresetRecord,
      surfaceId: 'rewrite',
    })

    expect(resolved.promptRules.ordered.map((rule) => rule.id)).toEqual([
      'user-early',
      'same-order-a',
      'same-order-b',
    ])
    expect(resolved.fieldStatuses).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'prompts.injection_trigger',
        fragmentId: 'system-late',
      }),
    ]))
  })
})
