import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import {
  exportPresetCompatPreset,
  exportPresetCompatStandaloneRegex,
} from '@/lib/preset-compat/export'
import {
  normalizePresetCompatPresetImport,
  normalizePresetCompatStandaloneRegexImport,
  normalizeDisplayName,
} from '@/lib/preset-compat/normalize'

function readFixture(name: string) {
  const fixturePath = resolve(process.cwd(), 'tests', 'fixtures', 'preset-compat', name)
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>
}

describe('preset compat import/export compatibility', () => {
  it('normalizes the synthetic preset fixture and round-trips key ST sections', () => {
    const fixture = readFixture('synthetic-sillytavern-preset.json')
    const { preset, warnings } = normalizePresetCompatPresetImport(fixture, {
      uploadedFileName: 'synthetic-sillytavern-preset.json',
      existingNames: ['synthetic-sillytavern-preset'],
      now: '2026-05-15T00:00:00.000Z',
      idFactory: () => 'preset-import-001',
    })

    expect(warnings).toEqual([])
    expect(preset.id).toBe('preset-import-001')
    expect(fixture.name).not.toBe('synthetic-sillytavern-preset')
    expect(preset.name).toBe('synthetic-sillytavern-preset (copy)')
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
    expect(preset.promptRules.find((rule) => rule.id === 'synthetic-main')?.injectionTrigger).toEqual([])
    expect(Object.keys(preset.passthrough)).toEqual(['root', 'extensions', 'unknownPromptFields'])
    const activeFixtureOrder = (fixture.prompt_order as Array<{ character_id: number, order: Array<{ identifier: string }> }>)
      .find((entry) => entry.character_id === 100001)?.order ?? []
    expect(preset.promptOrderLists.rewrite).toEqual(activeFixtureOrder.map((entry) => entry.identifier))
    expect(preset.promptOrderLists.future_jump).toEqual(preset.promptOrderLists.rewrite)
    expect(preset.embeddedRegexes.map((regex) => regex.id)).toEqual([
      'synthetic-input-wrapper',
      'synthetic-output-cleanup',
    ])
    expect(preset.passthrough.root).toMatchObject({
      synthetic_root_sentinel: {
        source: 'tracked-test-fixture',
        preserve: true,
      },
    })
    const fixtureExtensions = fixture.extensions as Record<string, unknown>
    const fixtureSPreset = fixtureExtensions.SPreset as Record<string, unknown>
    expect(preset.passthrough.extensions).toMatchObject({
      SPreset: {
        ChatSquash: fixtureSPreset.ChatSquash,
        RegexBinding: fixtureSPreset.RegexBinding,
        synthetic_extension_sentinel: 'preserve-spreset',
      },
      MacroNest: fixtureExtensions.MacroNest,
      ToolBindings: fixtureExtensions.ToolBindings,
      tavern_helper: fixtureExtensions.tavern_helper,
      synthetic_extension_sentinel: {
        source: 'tracked-test-fixture',
        preserve: true,
      },
    })

    const exported = exportPresetCompatPreset(preset)
    const exportedExtensions = exported.extensions as Record<string, unknown>
    const exportedSPreset = exportedExtensions.SPreset as Record<string, unknown>
    expect(exported.prompts).toEqual(fixture.prompts)
    expect(exported.prompt_order).toEqual(fixture.prompt_order)
    expect(exportedExtensions.regex_scripts).toEqual(fixtureExtensions.regex_scripts)
    expect((exported as Record<string, unknown>).synthetic_root_sentinel).toEqual(fixture.synthetic_root_sentinel)
    expect(exportedSPreset.ChatSquash).toEqual(fixtureSPreset.ChatSquash)
    expect(exportedSPreset.RegexBinding).toEqual(fixtureSPreset.RegexBinding)
    expect(exportedExtensions.MacroNest).toEqual(fixtureExtensions.MacroNest)
    expect(exportedExtensions.ToolBindings).toEqual(fixtureExtensions.ToolBindings)
    expect(exportedExtensions.tavern_helper).toEqual(fixtureExtensions.tavern_helper)
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
          character_id: 100001,
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

  it('keeps unknown active-order identifiers implicitly enabled when no enabled flag is present', () => {
    const payload = {
      prompts: [
        { identifier: 'main', name: 'Main', role: 'system', content: 'Main content' },
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: 'main', enabled: true },
            { identifier: 'chatHistory' },
          ],
        },
      ],
    }

    const { preset } = normalizePresetCompatPresetImport(payload, {
      idFactory: () => 'preset-import-unknown-active-order',
      now: '2026-05-16T00:00:00.000Z',
    })

    const exported = exportPresetCompatPreset(preset)
    expect(exported.prompt_order).toEqual([
      {
        character_id: 100001,
        order: [
          { identifier: 'main', enabled: true },
          { identifier: 'chatHistory', enabled: true },
        ],
      },
    ])
  })

  it('falls back to natural prompt order when the active 100001 bucket is missing', () => {
    const payload = {
      prompts: [
        { identifier: 'alpha', name: 'Alpha', role: 'system', content: 'Alpha content', enabled: true },
        { identifier: 'beta', name: 'Beta', role: 'user', content: 'Beta content', enabled: false },
      ],
      prompt_order: [
        {
          character_id: 100000,
          order: [{ identifier: 'beta', enabled: true }],
        },
      ],
    }

    const { preset } = normalizePresetCompatPresetImport(payload, {
      idFactory: () => 'preset-import-natural-order',
      now: '2026-05-16T00:00:00.000Z',
    })

    expect(preset.promptOrderLists.rewrite).toEqual(['alpha', 'beta'])
    expect(preset.promptRules.map((rule) => ({ id: rule.id, enabled: rule.enabled }))).toEqual([
      { id: 'alpha', enabled: true },
      { id: 'beta', enabled: false },
    ])

    const exported = exportPresetCompatPreset(preset)
    expect(exported.prompt_order).toEqual([
      {
        character_id: 100000,
        order: [{ identifier: 'beta', enabled: true }],
      },
      {
        character_id: 100001,
        order: [
          { identifier: 'alpha', enabled: true },
          { identifier: 'beta', enabled: false },
        ],
      },
    ])
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
          character_id: 100001,
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
    expect(normalizeDisplayName('Preset', ['Preset'])).toBe('Preset (copy)')
    expect(normalizeDisplayName('Preset', ['Preset', 'Preset (copy)'])).toBe('Preset (copy 2)')

    const { preset } = normalizePresetCompatPresetImport({}, {
      nameHint: 'Imported by hint',
      existingNames: ['Imported by hint', 'Imported by hint (copy)'],
      idFactory: () => 'preset-import-002',
      now: '2026-05-15T00:00:00.000Z',
    })

    expect(preset.name).toBe('Imported by hint (copy 2)')
  })

  it('exports null, empty, and populated prompt triggers safely', () => {
    const preset = normalizePresetCompatPresetImport({}, {
      uploadedFileName: 'synthetic-sillytavern-preset.json',
      existingNames: [],
      now: '2026-05-15T00:00:00.000Z',
      idFactory: () => 'preset-import-trigger-cases',
    }).preset

    preset.promptRules = [
      {
        id: 'prompt-null',
        name: 'Prompt Null',
        role: 'system',
        content: 'Null trigger',
        enabled: true,
        marker: false,
        injectAsSystemPrompt: true,
        injectionPosition: 'before',
        injectionDepth: null,
        injectionOrder: null,
        injectionTrigger: [],
        forbidOverrides: false,
        condition: null,
        passthrough: {
          __presetCompatPromptMeta: {
            injectionTrigger: null,
          },
        },
      },
      {
        id: 'prompt-empty',
        name: 'Prompt Empty',
        role: 'system',
        content: 'Empty trigger',
        enabled: true,
        marker: false,
        injectAsSystemPrompt: true,
        injectionPosition: 'before',
        injectionDepth: null,
        injectionOrder: null,
        injectionTrigger: [],
        forbidOverrides: false,
        condition: null,
        passthrough: {},
      },
      {
        id: 'prompt-array',
        name: 'Prompt Array',
        role: 'system',
        content: 'Array trigger',
        enabled: true,
        marker: false,
        injectAsSystemPrompt: true,
        injectionPosition: 'before',
        injectionDepth: null,
        injectionOrder: null,
        injectionTrigger: ['chat'],
        forbidOverrides: false,
        condition: null,
        passthrough: {},
      },
      {
        id: 'prompt-raw-empty',
        name: 'Prompt Raw Empty',
        role: 'system',
        content: 'Raw empty trigger',
        enabled: true,
        marker: false,
        injectAsSystemPrompt: true,
        injectionPosition: 'before',
        injectionDepth: null,
        injectionOrder: null,
        injectionTrigger: [],
        forbidOverrides: false,
        condition: null,
        passthrough: {
          __presetCompatPromptMeta: {
            injectionTrigger: [],
          },
        },
      },
    ]
    preset.passthrough = {
      root: {
        prompts: [
          { identifier: 'prompt-null', content: 'Null trigger' },
          { identifier: 'prompt-empty', content: 'Empty trigger' },
          { identifier: 'prompt-array', content: 'Array trigger' },
          { identifier: 'prompt-raw-empty', content: 'Raw empty trigger', injection_trigger: [] },
        ],
      },
      extensions: {},
      unknownPromptFields: {},
    }
    preset.promptOrderLists = {
      rewrite: ['prompt-null', 'prompt-empty', 'prompt-array', 'prompt-raw-empty'],
      future_jump: ['prompt-null', 'prompt-empty', 'prompt-array', 'prompt-raw-empty'],
      roleplay: ['prompt-null', 'prompt-empty', 'prompt-array', 'prompt-raw-empty'],
    }

    const exported = exportPresetCompatPreset(preset)
    const prompts = exported.prompts as Array<Record<string, unknown>>

    expect(prompts[0]).not.toHaveProperty('injection_trigger')
    expect(prompts[1]).not.toHaveProperty('injection_trigger')
    expect(prompts[2]?.injection_trigger).toEqual(['chat'])
    expect(prompts[3]?.injection_trigger).toEqual([])
  })

  it('keeps macro-bearing prompt, template, and regex fields raw across import/export round-trips', () => {
    const fixture = readFixture('synthetic-sillytavern-preset.json')
    const rawFixture = structuredClone(fixture)
    const prompts = structuredClone(Array.isArray(rawFixture.prompts) ? rawFixture.prompts : []) as Array<Record<string, unknown>>
    const extensions = structuredClone(
      (rawFixture.extensions as Record<string, unknown>) ?? {}
    ) as Record<string, unknown>
    const regexScripts = structuredClone(
      Array.isArray(extensions.regex_scripts) ? extensions.regex_scripts : []
    ) as Array<Record<string, unknown>>

    const mainPromptIndex = prompts.findIndex((prompt) => prompt.identifier === 'synthetic-main')
    const inputWrapperIndex = regexScripts.findIndex((regex) => regex.id === 'synthetic-input-wrapper')
    expect(mainPromptIndex).toBeGreaterThanOrEqual(0)
    expect(inputWrapperIndex).toBeGreaterThanOrEqual(0)
    prompts[mainPromptIndex] = {
      ...prompts[mainPromptIndex],
      content: 'Prompt {{getvar::hero}} text',
    }
    extensions.instruct = {
      template: 'Template {{getvar::hero}} text',
    }
    regexScripts[inputWrapperIndex] = {
      ...regexScripts[inputWrapperIndex],
      findRegex: '{{getvar::hero}}',
      replaceString: 'Regex {{setvar::hero::Alice}}',
    }

    rawFixture.prompts = prompts
    rawFixture.extensions = {
      ...extensions,
      regex_scripts: regexScripts,
    }

    const imported = normalizePresetCompatPresetImport(rawFixture, {
      uploadedFileName: 'synthetic-sillytavern-preset.json',
      existingNames: [],
      now: '2026-05-15T00:00:00.000Z',
      idFactory: () => 'preset-import-raw-macros',
    })
    const exported = exportPresetCompatPreset(imported.preset)
    const reimported = normalizePresetCompatPresetImport(exported, {
      uploadedFileName: 'synthetic-sillytavern-preset.json',
      existingNames: [],
      now: '2026-05-15T00:00:00.000Z',
      idFactory: () => 'preset-import-raw-macros-reimport',
    })

    expect((exported.prompts as Array<Record<string, unknown>>).find((prompt) => prompt.identifier === 'synthetic-main')?.content).toBe('Prompt {{getvar::hero}} text')
    expect(((exported.extensions as Record<string, unknown>).instruct as Record<string, unknown>)?.template).toBe('Template {{getvar::hero}} text')
    expect(((exported.extensions as Record<string, unknown>).regex_scripts as Array<Record<string, unknown>>).find((regex) => regex.id === 'synthetic-input-wrapper')?.findRegex).toBe('{{getvar::hero}}')
    expect(((exported.extensions as Record<string, unknown>).regex_scripts as Array<Record<string, unknown>>).find((regex) => regex.id === 'synthetic-input-wrapper')?.replaceString).toBe('Regex {{setvar::hero::Alice}}')
    expect(imported.preset.promptRules.find((rule) => rule.id === 'synthetic-main')?.content).toBe('Prompt {{getvar::hero}} text')
    expect((((imported.preset.passthrough.extensions as Record<string, unknown>).instruct as Record<string, unknown>)?.template)).toBe('Template {{getvar::hero}} text')
    expect(reimported.preset.promptRules.find((rule) => rule.id === 'synthetic-main')?.content).toBe('Prompt {{getvar::hero}} text')
    expect((((reimported.preset.passthrough.extensions as Record<string, unknown>).instruct as Record<string, unknown>)?.template)).toBe('Template {{getvar::hero}} text')
    expect(reimported.preset.embeddedRegexes.find((regex) => regex.id === 'synthetic-input-wrapper')).toMatchObject({
      pattern: '{{getvar::hero}}',
      replacement: 'Regex {{setvar::hero::Alice}}',
    })
  })

  it('accepts standalone regex imports from all supported shapes and degrades malformed entries with warnings', () => {
    const fixture = readFixture('synthetic-sillytavern-preset.json')
    const rawRegexes = (fixture.extensions as Record<string, unknown>).regex_scripts as unknown[]

    const fromArray = normalizePresetCompatStandaloneRegexImport(rawRegexes, {
      existingNames: ['Synthetic input wrapper'],
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
    expect(fromArray.regexes.find((regex) => regex.id === 'synthetic-input-wrapper')?.name).toBe('Synthetic input wrapper (copy)')

    const malformed = normalizePresetCompatStandaloneRegexImport({
      regex_scripts: [
        rawRegexes.find((regex) => (regex as Record<string, unknown>)?.id === 'synthetic-input-wrapper'),
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
    expect(preset.promptOrderLists.future_jump).toEqual(['main', 'nsfw', 'jailbreak'])
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
    expect((exported as Record<string, unknown>).post_history).toBe('Keep this exact root field')
    expect((exported as Record<string, unknown>).post_history_instructions).toBeUndefined()
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
        character_id: 100001,
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
          character_id: 100001,
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

  it('exactly round-trips a generated large heterogeneous preset corpus', () => {
    const roles = ['system', 'user', 'assistant', 'model']
    const prompts = Array.from({ length: 130 }, (_, index) => ({
      identifier: `corpus-prompt-${index.toString().padStart(3, '0')}`,
      name: `Neutral corpus prompt ${index}`,
      role: roles[index % roles.length],
      system_prompt: index % 4 === 0,
      content: `Deterministic neutral prompt content ${index}.`,
      enabled: index % 3 !== 0,
      marker: index % 17 === 0,
      injection_position: index % 5 === 0 ? 1 : 0,
      injection_depth: index % 7,
      injection_order: 1000 - index,
      injection_trigger: index % 3 === 0
        ? null
        : index % 3 === 1
          ? []
          : ['continue', 'chat'],
      forbid_overrides: index % 11 === 0,
      synthetic_prompt_metadata: {
        group: index % 5,
        retained: true,
      },
    }))
    const regexPlacements = [0, 1, 2, 3, 6, 7]
    const regexScripts = Array.from({ length: 9 }, (_, index) => ({
      id: `corpus-regex-${index.toString().padStart(2, '0')}`,
      scriptName: `Neutral corpus regex ${index}`,
      findRegex: `^synthetic-${index}-(.*)$`,
      replaceString: `neutral-${index}-$1`,
      trimStrings: index % 2 === 0 ? [] : [`trim-${index}`],
      placement: [regexPlacements[index % regexPlacements.length]],
      disabled: index % 4 === 0,
      markdownOnly: index % 3 === 0,
      promptOnly: index % 3 === 1,
      runOnEdit: index % 2 === 0,
      substituteRegex: index % 2 === 0 ? 0 : `substitute-${index}`,
      minDepth: index % 2 === 0 ? null : index,
      maxDepth: index + 3,
      synthetic_regex_metadata: {
        sequence: index,
        retained: true,
      },
    }))
    const legacyOrder = prompts
      .filter((_, index) => index % 3 === 0)
      .map((prompt, index) => ({ identifier: prompt.identifier, enabled: index % 2 === 0 }))
    const activeOrder = prompts
      .map((prompt, index) => ({ identifier: prompt.identifier, enabled: index % 2 === 0 }))
      .reverse()
    const payload = {
      name: 'Embedded generated corpus metadata',
      synthetic_large_root: {
        promptCount: prompts.length,
        regexCount: regexScripts.length,
      },
      prompts,
      prompt_order: [
        { character_id: 100000, order: legacyOrder },
        { character_id: 100001, order: activeOrder },
      ],
      extensions: {
        regex_scripts: regexScripts,
        SPreset: {
          ChatSquash: {
            enabled: true,
            strategy: 'generated-neutral-window',
            message_limit: 24,
          },
          RegexBinding: {
            regexes: regexScripts,
            source: 'generated-neutral-corpus',
          },
        },
        MacroNest: {
          enabled: true,
          entries: Array.from({ length: 12 }, (_, index) => ({
            key: `corpus-macro-${index}`,
            value: `neutral-value-${index}`,
          })),
        },
        ToolBindings: {
          enabled: false,
          tools: Array.from({ length: 4 }, (_, index) => ({
            id: `corpus-tool-${index}`,
            active: false,
          })),
        },
        tavern_helper: {
          enabled: true,
          records: Array.from({ length: 8 }, (_, index) => ({
            id: `helper-record-${index}`,
            value: index,
          })),
        },
      },
    }

    const { preset, warnings } = normalizePresetCompatPresetImport(payload, {
      uploadedFileName: 'generated-large-corpus.json',
      now: '2026-05-19T00:00:00.000Z',
      idFactory: () => 'generated-large-corpus-preset',
    })
    const exported = exportPresetCompatPreset(preset)
    const jsonRoundTrip = JSON.parse(JSON.stringify(exported)) as Record<string, unknown>

    expect(warnings).toEqual([])
    expect(preset.name).toBe('generated-large-corpus')
    expect(preset.promptRules).toHaveLength(130)
    expect(new Set(preset.promptRules.map((prompt) => prompt.role))).toEqual(
      new Set(['system', 'user', 'assistant', 'model'])
    )
    expect(preset.embeddedRegexes).toHaveLength(9)
    expect(preset.promptOrderLists.rewrite).toEqual(activeOrder.map((entry) => entry.identifier))
    expect(preset.promptRules.find((prompt) => prompt.id === 'corpus-prompt-000')).toMatchObject({
      role: 'system',
      enabled: true,
      injectionTrigger: [],
    })
    expect(preset.promptRules.find((prompt) => prompt.id === 'corpus-prompt-001')).toMatchObject({
      role: 'user',
      enabled: false,
      injectionTrigger: [],
    })
    expect(preset.promptRules.find((prompt) => prompt.id === 'corpus-prompt-002')).toMatchObject({
      role: 'assistant',
      enabled: true,
      injectionTrigger: ['continue', 'chat'],
    })
    expect(preset.promptRules.find((prompt) => prompt.id === 'corpus-prompt-003')?.role).toBe('model')
    expect((exported.prompts as Array<Record<string, unknown>>).find((prompt) => prompt.identifier === 'corpus-prompt-000')).toMatchObject({
      enabled: false,
      injection_trigger: null,
    })
    expect((exported.prompts as Array<Record<string, unknown>>).find((prompt) => prompt.identifier === 'corpus-prompt-001')?.injection_trigger).toEqual([])
    expect((exported.prompts as Array<Record<string, unknown>>).find((prompt) => prompt.identifier === 'corpus-prompt-002')?.injection_trigger).toEqual(['continue', 'chat'])
    expect((exported.extensions as Record<string, unknown>).SPreset).toEqual(payload.extensions.SPreset)
    expect((exported.extensions as Record<string, unknown>).MacroNest).toEqual(payload.extensions.MacroNest)
    expect((exported.extensions as Record<string, unknown>).ToolBindings).toEqual(payload.extensions.ToolBindings)
    expect((exported.extensions as Record<string, unknown>).tavern_helper).toEqual(payload.extensions.tavern_helper)
    expect(jsonRoundTrip).toEqual(payload)
  })

  it('keeps restored preset content parseable when a full-library blob is rebuilt from imported preset exports', () => {
    const fixture = readFixture('synthetic-sillytavern-preset.json')
    const { preset } = normalizePresetCompatPresetImport(fixture, {
      uploadedFileName: 'synthetic-sillytavern-preset.json',
      existingNames: [],
      now: '2026-05-18T00:00:00.000Z',
      idFactory: () => 'reset-roundtrip-preset',
    })
    const { regexes } = normalizePresetCompatStandaloneRegexImport({
      regex_scripts: ((fixture.extensions as Record<string, unknown>)?.regex_scripts as unknown[]) ?? [],
    })

    const exportedPreset = exportPresetCompatPreset(preset)
    const exportedRegexes = exportPresetCompatStandaloneRegex(regexes)
    const library = createDefaultPresetCompatLibrary()
    library.revision = 3
    library.lastImportedAt = '2026-05-18T00:00:00.000Z'
    library.lastExportedAt = '2026-05-18T00:00:01.000Z'
    library.presets[preset.id] = preset
    library.standaloneRegexes = Object.fromEntries(regexes.map((regex) => [regex.id, regex]))
    library.surfaceBindings.rewrite = {
      ...library.surfaceBindings.rewrite,
      presetId: preset.id,
    }

    const restoredLibraryBlob = JSON.stringify(library)
    const restoredLibrary = JSON.parse(restoredLibraryBlob) as typeof library

    expect(restoredLibrary.presets[preset.id]?.passthrough.root).toMatchObject({
      prompts: exportedPreset.prompts,
    })
    expect((restoredLibrary.presets[preset.id]?.passthrough.extensions as Record<string, unknown>).regex_scripts).toEqual(
      (exportedRegexes as Record<string, unknown>).regex_scripts
    )
    expect(restoredLibrary.presets[preset.id]?.promptRules.find((rule) => rule.id === 'synthetic-main')?.content).toBe(
      preset.promptRules.find((rule) => rule.id === 'synthetic-main')?.content
    )
    expect(restoredLibrary.surfaceBindings.rewrite.presetId).toBe(preset.id)
    expect(Object.keys(restoredLibrary.standaloneRegexes)).toHaveLength(regexes.length)
  })
})
