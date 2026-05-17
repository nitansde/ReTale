import { describe, expect, it } from 'vitest'
import { resolvePresetCompatPromptRuleSubset } from '@/lib/preset-compat/resolve-runtime'
import type { PresetCompatPresetRecord } from '@/lib/preset-compat/types'

function createPromptPreset(): PresetCompatPresetRecord {
  return {
    id: 'preset-prompts-001',
    name: 'Prompt fixture',
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
        injectionTrigger: 'rewrite',
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
        injectionTrigger: null,
        forbidOverrides: false,
        condition: null,
        passthrough: {},
      },
      {
        id: 'unsupported-role',
        name: 'Unsupported Role',
        role: 'assistant',
        content: 'Should not be applied.',
        enabled: true,
        marker: false,
        injectAsSystemPrompt: false,
        injectionPosition: 'before',
        injectionDepth: null,
        injectionOrder: 5,
        injectionTrigger: null,
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
        injectionTrigger: null,
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
        injectionTrigger: null,
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
        injectionTrigger: null,
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
        injectionTrigger: null,
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
        injectionTrigger: null,
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
    },
    embeddedRegexes: [],
    attachedStandaloneRegexIds: [],
    runtimeSampler: {
      temperature: null,
      topP: null,
      topK: null,
      minP: null,
      presencePenalty: null,
      frequencyPenalty: null,
      repetitionPenalty: null,
      maxTokens: null,
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

describe('preset compat prompt rule resolution', () => {
  it('applies only enabled active-order non-marker system and user rules', () => {
    const preset = createPromptPreset()

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
    const preset = createPromptPreset()

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
    const preset = createPromptPreset() as unknown as {
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
