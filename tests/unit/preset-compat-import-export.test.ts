import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  exportPresetCompatPreset,
  exportPresetCompatStandaloneRegex,
} from '@/lib/preset-compat/export'
import {
  normalizePresetCompatPresetImport,
  normalizePresetCompatStandaloneRegexImport,
  resolvePresetCompatCopyName,
} from '@/lib/preset-compat/normalize'

function readFixture(name: string) {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'external', name), 'utf8')) as Record<string, unknown>
}

describe('preset compat import/export compatibility', () => {
  it('normalizes a preset from the golden fixture and round-trips key ST sections', () => {
    const fixture = readFixture('resets_example.json')
    const { preset, warnings } = normalizePresetCompatPresetImport(fixture, {
      uploadedFileName: 'resets_example.json',
      existingNames: ['resets_example'],
      now: '2026-05-15T00:00:00.000Z',
      idFactory: () => 'preset-import-001',
    })

    expect(warnings).toEqual([])
    expect(preset.id).toBe('preset-import-001')
    expect(preset.name).toBe('resets_example (copy)')
    expect(preset.runtimeSampler).toMatchObject({
      temperature: 1,
      topP: 1,
      topK: 0,
      topA: 1,
      minP: 0,
      presencePenalty: 0,
      frequencyPenalty: 0,
      repetitionPenalty: 1,
      openaiMaxContext: 2000000,
      maxTokens: 32000,
      seed: -1,
      candidateCount: 1,
    })
    expect(preset.promptTemplate).toMatchObject({
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
      assistantPrefill: '',
      assistantImpersonation: '',
      continuePostfix: ' ',
      legacyMainPrompt: null,
      legacyNsfwPrompt: null,
      legacyJailbreakPrompt: null,
    })
    expect(preset.transport).toMatchObject({
      maxContextUnlocked: true,
      streamOpenAI: true,
      useSysprompt: true,
      squashSystemMessages: false,
      mediaInlining: false,
      inlineImageQuality: 'low',
      continuePrefill: false,
      functionCalling: false,
      showThoughts: true,
      reasoningEffort: 'high',
      verbosity: 'auto',
      enableWebSearch: false,
      requestImages: false,
      requestImageAspectRatio: '',
      requestImageResolution: '',
    })
    expect(preset.preservedFields).toEqual({
      biasPresetSelected: 'Default (none)',
    })
    expect(preset.promptRules[0]?.injectionTrigger).toEqual([])
    expect(Object.keys(preset.passthrough)).toEqual(['root', 'extensions', 'unknownPromptFields'])
    expect(preset.promptOrderLists.rewrite).toEqual(
      (fixture.prompt_order as Array<{ character_id: number, order: Array<{ identifier: string }> }>)[0].order.map((entry) => entry.identifier)
    )
    expect(preset.promptOrderLists.expand).toEqual(preset.promptOrderLists.rewrite)
    expect(preset.embeddedRegexes).toHaveLength(
      ((fixture.extensions as Record<string, unknown>).regex_scripts as unknown[]).length
    )
    expect((preset.passthrough.extensions as Record<string, unknown>).SPreset).toBeDefined()

    const exported = exportPresetCompatPreset(preset)
    expect(exported.prompts).toEqual(fixture.prompts)
    expect(exported.prompt_order).toEqual(fixture.prompt_order)
    expect((exported.extensions as Record<string, unknown>).regex_scripts).toEqual(
      (fixture.extensions as Record<string, unknown>).regex_scripts
    )
  })

  it('preserves legacy flat prompt fields without migrating away from structured prompts', () => {
    const fixture = {
      main_prompt: 'legacy main',
      nsfw_prompt: 'legacy nsfw',
      jailbreak_prompt: 'legacy jailbreak',
      prompts: [
        {
          identifier: 'main',
          name: 'Structured main',
          role: 'system',
          system_prompt: true,
          content: 'Structured content',
          injection_position: 0,
        },
      ],
      prompt_order: [
        {
          character_id: 100000,
          order: [
            { identifier: 'main', enabled: true },
          ],
        },
      ],
    }

    const { preset } = normalizePresetCompatPresetImport(fixture, {
      idFactory: () => 'preset-import-legacy',
      now: '2026-05-15T00:00:00.000Z',
    })

    expect(preset.promptTemplate).toMatchObject({
      legacyMainPrompt: 'legacy main',
      legacyNsfwPrompt: 'legacy nsfw',
      legacyJailbreakPrompt: 'legacy jailbreak',
    })
    expect(preset.promptRules).toHaveLength(1)

    const exported = exportPresetCompatPreset(preset)
    expect(exported).toMatchObject({
      main_prompt: 'legacy main',
      nsfw_prompt: 'legacy nsfw',
      jailbreak_prompt: 'legacy jailbreak',
    })
    expect(exported.prompts).toEqual(fixture.prompts)
    expect(exported.prompt_order).toEqual(fixture.prompt_order)
  })

  it('normalizes a single-string injection_trigger into a one-element array and preserves it on export', () => {
    const payload = {
      prompts: [
        {
          identifier: 'triggered-rule',
          name: 'Triggered rule',
          role: 'system',
          content: 'Triggered content',
          system_prompt: true,
          injection_position: 0,
          injection_trigger: 'continue',
        },
      ],
      prompt_order: [
        {
          character_id: 100000,
          order: [{ identifier: 'triggered-rule', enabled: true }],
        },
      ],
    }

    const { preset } = normalizePresetCompatPresetImport(payload, {
      idFactory: () => 'preset-import-trigger-string',
      now: '2026-05-16T00:00:00.000Z',
    })

    expect(preset.promptRules[0]?.injectionTrigger).toEqual(['continue'])

    const exported = exportPresetCompatPreset(preset)
    expect((exported.prompts as Array<Record<string, unknown>>)[0]?.injection_trigger).toEqual(['continue'])
  })

  it('uses uploaded name hints and deterministic copy suffixes', () => {
    expect(resolvePresetCompatCopyName('Preset', ['Preset'])).toBe('Preset (copy)')
    expect(resolvePresetCompatCopyName('Preset', ['Preset', 'Preset (copy)'])).toBe('Preset (copy 2)')

    const { preset } = normalizePresetCompatPresetImport({}, {
      nameHint: 'Imported by hint',
      existingNames: ['Imported by hint', 'Imported by hint (copy)'],
      idFactory: () => 'preset-import-002',
      now: '2026-05-15T00:00:00.000Z',
    })

    expect(preset.name).toBe('Imported by hint (copy 2)')
  })

  it('accepts standalone regex imports from all supported shapes and degrades malformed entries with warnings', () => {
    const fixture = readFixture('resets_example.json')
    const rawRegexes = (fixture.extensions as Record<string, unknown>).regex_scripts as unknown[]

    const fromArray = normalizePresetCompatStandaloneRegexImport(rawRegexes, {
      existingNames: ['【云瑾】包裹最新指示'],
    })
    const fromObject = normalizePresetCompatStandaloneRegexImport({ regex_scripts: rawRegexes })
    const fromSPreset = normalizePresetCompatStandaloneRegexImport({
      SPreset: {
        RegexBinding: {
          regexes: rawRegexes,
        },
      },
    })

    expect(fromArray.regexes).toHaveLength(rawRegexes.length)
    expect(fromObject.regexes).toHaveLength(rawRegexes.length)
    expect(fromSPreset.regexes).toHaveLength(rawRegexes.length)
    expect(fromArray.regexes[0]?.name).toBe('【云瑾】包裹最新指示 (copy)')

    const malformed = normalizePresetCompatStandaloneRegexImport({
      regex_scripts: [
        rawRegexes[0],
        null,
        { scriptName: 'Broken regex', replaceString: 'x' },
        { scriptName: 'Odd trim', findRegex: 'abc', replaceString: 'def', trimStrings: 'not-an-array' },
      ],
    })

    expect(malformed.regexes).toHaveLength(2)
    expect(malformed.warnings).toEqual([
      'Regex entry 2 was not an object and was skipped.',
      'Regex entry 3 was missing findRegex or replaceString and was skipped.',
      'Regex entry 4 trimStrings was not an array and was replaced with an empty list.',
    ])

    expect(exportPresetCompatStandaloneRegex(fromObject.regexes)).toEqual({
      regex_scripts: rawRegexes,
    })
  })

  it('migrates legacy flat prompt keys when structured prompts are absent and preserves root passthrough fields', () => {
    const payload = {
      name: 'Legacy prompt preset',
      main_prompt: 'Legacy main prompt content',
      nsfw_prompt: 'Legacy nsfw prompt content',
      jailbreak_prompt: 'Legacy jailbreak prompt content',
      use_sysprompt: true,
      post_history: 'Keep this exact root field',
      custom_root_field: {
        nested: ['alpha', 'beta'],
      },
      extensions: {
        tavern_helper: {
          untouched: true,
        },
      },
    }

    const { preset } = normalizePresetCompatPresetImport(payload, {
      idFactory: () => 'legacy-preset-001',
      now: '2026-05-16T00:00:00.000Z',
    })

    expect(preset.promptRules.map((rule) => ({ id: rule.id, role: rule.role, content: rule.content }))).toEqual([
      { id: 'main', role: 'user', content: 'Legacy main prompt content' },
      { id: 'nsfw', role: 'system', content: 'Legacy nsfw prompt content' },
      { id: 'jailbreak', role: 'system', content: 'Legacy jailbreak prompt content' },
    ])
    expect(preset.promptOrderLists.rewrite).toEqual(['main', 'nsfw', 'jailbreak'])
    expect(preset.promptOrderLists.future_jump_rewrite).toEqual(['main', 'nsfw', 'jailbreak'])
    expect(preset.passthrough).toMatchObject({
      root: {
        main_prompt: 'Legacy main prompt content',
        nsfw_prompt: 'Legacy nsfw prompt content',
        jailbreak_prompt: 'Legacy jailbreak prompt content',
        use_sysprompt: true,
        post_history: 'Keep this exact root field',
        custom_root_field: {
          nested: ['alpha', 'beta'],
        },
      },
      extensions: {
        tavern_helper: {
          untouched: true,
        },
      },
      legacyFlatPrompts: {
        main: 'main_prompt',
        nsfw: 'nsfw_prompt',
        jailbreak: 'jailbreak_prompt',
      },
    })

    const exported = exportPresetCompatPreset(preset)
    expect(exported.main_prompt).toBe('Legacy main prompt content')
    expect(exported.nsfw_prompt).toBe('Legacy nsfw prompt content')
    expect(exported.jailbreak_prompt).toBe('Legacy jailbreak prompt content')
    expect(exported.use_sysprompt).toBe(true)
    expect(exported.post_history).toBe('Keep this exact root field')
    expect(exported.post_history_instructions).toBeUndefined()
    expect(exported.prompts).toEqual([
      {
        identifier: 'main',
        name: 'Main Prompt',
        system_prompt: true,
        role: 'user',
        injection_position: 0,
        content: 'Legacy main prompt content',
        injection_order: 100,
      },
      {
        identifier: 'nsfw',
        name: 'NSFW Prompt',
        system_prompt: true,
        role: 'system',
        injection_position: 0,
        content: 'Legacy nsfw prompt content',
        injection_order: 100,
      },
      {
        identifier: 'jailbreak',
        name: 'Jailbreak Prompt',
        system_prompt: true,
        role: 'system',
        injection_position: 0,
        content: 'Legacy jailbreak prompt content',
        injection_order: 100,
      },
    ])
    expect(exported.prompt_order).toEqual([
      {
        character_id: 100000,
        order: [
          { identifier: 'main', enabled: true },
          { identifier: 'nsfw', enabled: true },
          { identifier: 'jailbreak', enabled: true },
        ],
      },
    ])
  })

  it('does not duplicate legacy flat prompt migration when structured prompts already exist', () => {
    const payload = {
      name: 'Structured prompt preset',
      main_prompt: 'Legacy main prompt content',
      prompts: [
        {
          identifier: 'structured-main',
          name: 'Structured main prompt',
          role: 'system',
          content: 'Use structured prompts only.',
          system_prompt: true,
        },
      ],
      prompt_order: [
        {
          character_id: 100000,
          order: [{ identifier: 'structured-main', enabled: true }],
        },
      ],
    }

    const { preset } = normalizePresetCompatPresetImport(payload, {
      idFactory: () => 'structured-preset-001',
      now: '2026-05-16T00:00:00.000Z',
    })

    expect(preset.promptRules.map((rule) => rule.id)).toEqual(['structured-main'])
    expect(preset.passthrough.legacyFlatPrompts).toBeUndefined()

    const exported = exportPresetCompatPreset(preset)
    expect(exported.prompts).toEqual([
      {
        identifier: 'structured-main',
        name: 'Structured main prompt',
        system_prompt: true,
        role: 'system',
        injection_position: 0,
        content: 'Use structured prompts only.',
      },
    ])
    expect(exported.main_prompt).toBe('Legacy main prompt content')
  })
})
