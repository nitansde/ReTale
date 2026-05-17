import { existsSync, readFileSync } from 'node:fs'
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
  const worktreePath = resolve(process.cwd(), 'external', name)
  const fallbackPath = resolve(process.cwd(), 'external', name)
  const fixturePath = existsSync(worktreePath) ? worktreePath : fallbackPath
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>
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
      minP: 0,
      presencePenalty: 0,
      frequencyPenalty: 0,
      repetitionPenalty: 1,
      maxTokens: 32000,
    })
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

  it('exports null, empty, and populated prompt triggers safely', () => {
    const preset = normalizePresetCompatPresetImport({}, {
      uploadedFileName: 'resets_example.json',
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
        injectionTrigger: null,
        forbidOverrides: false,
        condition: null,
        passthrough: {},
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
        injectionTrigger: null,
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
      expand: ['prompt-null', 'prompt-empty', 'prompt-array', 'prompt-raw-empty'],
      roleplay: ['prompt-null', 'prompt-empty', 'prompt-array', 'prompt-raw-empty'],
      polish: ['prompt-null', 'prompt-empty', 'prompt-array', 'prompt-raw-empty'],
      continue: ['prompt-null', 'prompt-empty', 'prompt-array', 'prompt-raw-empty'],
      future_jump_rewrite: ['prompt-null', 'prompt-empty', 'prompt-array', 'prompt-raw-empty'],
    }

    const exported = exportPresetCompatPreset(preset)
    const prompts = exported.prompts as Array<Record<string, unknown>>

    expect(prompts[0]).not.toHaveProperty('injection_trigger')
    expect(prompts[1]).not.toHaveProperty('injection_trigger')
    expect(prompts[2]?.injection_trigger).toEqual([['chat']])
    expect(prompts[3]?.injection_trigger).toEqual([])
  })

  it('keeps macro-bearing prompt, template, and regex fields raw across import/export round-trips', () => {
    const fixture = readFixture('resets_example.json')
    const rawFixture = structuredClone(fixture)
    const prompts = structuredClone(Array.isArray(rawFixture.prompts) ? rawFixture.prompts : []) as Array<Record<string, unknown>>
    const extensions = structuredClone(
      (rawFixture.extensions as Record<string, unknown>) ?? {}
    ) as Record<string, unknown>
    const regexScripts = structuredClone(
      Array.isArray(extensions.regex_scripts) ? extensions.regex_scripts : []
    ) as Array<Record<string, unknown>>

    prompts[0] = {
      ...prompts[0],
      content: 'Prompt {{getvar::hero}} text',
    }
    extensions.instruct = {
      template: 'Template {{getvar::hero}} text',
    }
    regexScripts[0] = {
      ...regexScripts[0],
      findRegex: '{{getvar::hero}}',
      replaceString: 'Regex {{setvar::hero::Alice}}',
    }

    rawFixture.prompts = prompts
    rawFixture.extensions = {
      ...extensions,
      regex_scripts: regexScripts,
    }

    const imported = normalizePresetCompatPresetImport(rawFixture, {
      uploadedFileName: 'resets_example.json',
      existingNames: [],
      now: '2026-05-15T00:00:00.000Z',
      idFactory: () => 'preset-import-raw-macros',
    })
    const exported = exportPresetCompatPreset(imported.preset)
    const reimported = normalizePresetCompatPresetImport(exported, {
      uploadedFileName: 'resets_example.json',
      existingNames: [],
      now: '2026-05-15T00:00:00.000Z',
      idFactory: () => 'preset-import-raw-macros-reimport',
    })

    expect((exported.prompts as Array<Record<string, unknown>>)[0]?.content).toBe('Prompt {{getvar::hero}} text')
    expect(((exported.extensions as Record<string, unknown>).instruct as Record<string, unknown>)?.template).toBe('Template {{getvar::hero}} text')
    expect((((exported.extensions as Record<string, unknown>).regex_scripts as Array<Record<string, unknown>>)[0])?.findRegex).toBe('{{getvar::hero}}')
    expect((((exported.extensions as Record<string, unknown>).regex_scripts as Array<Record<string, unknown>>)[0])?.replaceString).toBe('Regex {{setvar::hero::Alice}}')
    expect(imported.preset.promptRules[0]?.content).toBe('Prompt {{getvar::hero}} text')
    expect((((imported.preset.passthrough.extensions as Record<string, unknown>).instruct as Record<string, unknown>)?.template)).toBe('Template {{getvar::hero}} text')
    expect(reimported.preset.promptRules[0]?.content).toBe('Prompt {{getvar::hero}} text')
    expect((((reimported.preset.passthrough.extensions as Record<string, unknown>).instruct as Record<string, unknown>)?.template)).toBe('Template {{getvar::hero}} text')
    expect(reimported.preset.embeddedRegexes[0]).toMatchObject({
      pattern: '{{getvar::hero}}',
      replacement: 'Regex {{setvar::hero::Alice}}',
    })
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
})
