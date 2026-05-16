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
