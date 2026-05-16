import { describe, expect, it } from 'vitest'
import {
  PRESET_COMPAT_REGEX_RUNTIME_MAX_ACTIVE_RULES,
  PRESET_COMPAT_REGEX_RUNTIME_MAX_INPUT_LENGTH,
  runPresetCompatRegexRuntime,
} from '@/lib/preset-compat/regex-runtime'
import type { PresetCompatRegexRecord } from '@/lib/preset-compat/types'

function createRegexRecord(overrides: Partial<PresetCompatRegexRecord> = {}): PresetCompatRegexRecord {
  return {
    id: 'regex-001',
    name: 'Test regex',
    pattern: 'hello',
    replacement: 'hi',
    flags: '',
    disabled: false,
    placements: ['user_input'],
    trimStrings: [],
    promptOnly: false,
    markdownOnly: false,
    minDepth: null,
    maxDepth: null,
    substituteRegex: null,
    runOnEdit: false,
    passthrough: {},
    ...overrides,
  }
}

describe('preset compat regex runtime', () => {
  it('executes resolved standalone rules before embedded rules in deterministic order', () => {
    const standaloneRule = createRegexRecord({
      id: 'standalone-1',
      pattern: 'cat',
      replacement: 'dog',
    })
    const embeddedRule = createRegexRecord({
      id: 'embedded-1',
      pattern: 'dog',
      replacement: 'fox',
    })

    const result = runPresetCompatRegexRuntime({
      value: 'cat',
      phase: 'user_input',
      standalone: [standaloneRule],
      embedded: [embeddedRule],
    })

    expect(result).toEqual({
      value: 'fox',
      warnings: [],
      appliedRuleIds: ['standalone-1', 'embedded-1'],
      skippedRuleIds: [],
    })
  })

  it('supports regex literals, raw patterns, {{match}} aliasing, numbered captures, named captures, and trim-string filtering', () => {
    const literalRule = createRegexRecord({
      id: 'literal-1',
      pattern: '/(?<word>he..o) (?<target>wo..d)/i',
      replacement: '[{{match}}][$1][$<target>]',
      trimStrings: ['l'],
    })
    const rawPatternRule = createRegexRecord({
      id: 'raw-1',
      pattern: 'world',
      replacement: 'planet',
    })

    const result = runPresetCompatRegexRuntime({
      value: 'Hello world',
      phase: 'user_input',
      standalone: [literalRule, rawPatternRule],
      embedded: [],
    })

    expect(result.value).toBe('[Heo word][Heo][word]')
    expect(result.appliedRuleIds).toEqual(['literal-1', 'raw-1'])
    expect(result.skippedRuleIds).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('skips invalid regexes and substituteRegex rules without aborting valid rules', () => {
    const validRule = createRegexRecord({
      id: 'valid-1',
      pattern: 'beta',
      replacement: 'BETA',
    })
    const invalidRule = createRegexRecord({
      id: 'invalid-1',
      pattern: '/(/g',
      replacement: 'broken',
    })
    const skippedMacroRule = createRegexRecord({
      id: 'macro-1',
      pattern: 'alpha',
      replacement: 'unused',
      passthrough: {
        __presetCompatRegexMeta: {
          substituteRegex: 1,
        },
      },
    })

    const result = runPresetCompatRegexRuntime({
      value: 'alpha beta',
      phase: 'user_input',
      standalone: [skippedMacroRule, invalidRule, validRule],
      embedded: [],
    })

    expect(result.value).toBe('alpha BETA')
    expect(result.appliedRuleIds).toEqual(['valid-1'])
    expect(result.skippedRuleIds).toEqual(['macro-1', 'invalid-1'])
    expect(result.warnings).toEqual([
      'Skipped rule macro-1 because substituteRegex=1 is outside the MVP runtime subset.',
      'Skipped rule invalid-1 because its regex source could not be compiled.',
    ])
  })

  it('enforces prompt, markdown, depth, edit, and disabled gating without throwing', () => {
    const disabledRule = createRegexRecord({
      id: 'disabled-1',
      disabled: true,
      pattern: 'hello',
      replacement: 'DISABLED',
    })
    const promptRule = createRegexRecord({
      id: 'prompt-1',
      promptOnly: true,
      pattern: 'hello',
      replacement: 'PROMPT',
    })
    const markdownRule = createRegexRecord({
      id: 'markdown-1',
      markdownOnly: true,
      pattern: 'PROMPT',
      replacement: 'MARKDOWN',
    })
    const depthRule = createRegexRecord({
      id: 'depth-1',
      pattern: 'hello',
      replacement: 'DEPTH',
      minDepth: 2,
      maxDepth: 4,
    })
    const editRule = createRegexRecord({
      id: 'edit-1',
      pattern: 'hello',
      replacement: 'EDIT',
      runOnEdit: false,
    })

    const skippedPromptResult = runPresetCompatRegexRuntime({
      value: 'hello',
      phase: 'user_input',
      standalone: [disabledRule, promptRule],
      embedded: [],
      isPrompt: false,
    })
    const appliedResult = runPresetCompatRegexRuntime({
      value: 'hello',
      phase: 'user_input',
      standalone: [promptRule, markdownRule],
      embedded: [],
      isPrompt: true,
      isMarkdown: true,
    })
    const depthResult = runPresetCompatRegexRuntime({
      value: 'hello',
      phase: 'user_input',
      standalone: [depthRule],
      embedded: [],
      depth: 3,
    })
    const editResult = runPresetCompatRegexRuntime({
      value: 'hello',
      phase: 'user_input',
      standalone: [editRule],
      embedded: [],
      isEdit: true,
    })

    expect(skippedPromptResult.value).toBe('hello')
    expect(skippedPromptResult.appliedRuleIds).toEqual([])
    expect(skippedPromptResult.skippedRuleIds).toEqual(['prompt-1'])

    expect(appliedResult.value).toBe('MARKDOWN')
    expect(appliedResult.appliedRuleIds).toEqual(['prompt-1', 'markdown-1'])
    expect(appliedResult.skippedRuleIds).toEqual([])

    expect(depthResult.value).toBe('DEPTH')
    expect(depthResult.appliedRuleIds).toEqual(['depth-1'])
    expect(depthResult.skippedRuleIds).toEqual([])

    expect(editResult.value).toBe('hello')
    expect(editResult.appliedRuleIds).toEqual([])
    expect(editResult.skippedRuleIds).toEqual(['edit-1'])
  })

  it('warns for preserved unsupported placements and enforces runtime safety limits', () => {
    const placementRule = createRegexRecord({
      id: 'placement-1',
      placements: ['user_input', 'md_display', 'world_info', 'reasoning'],
      pattern: 'hello',
      replacement: 'HELLO',
    })

    const placementResult = runPresetCompatRegexRuntime({
      value: 'hello',
      phase: 'user_input',
      standalone: [placementRule],
      embedded: [],
    })

    expect(placementResult.value).toBe('HELLO')
    expect(placementResult.warnings).toEqual([
      'Rule placement-1 preserves unsupported placements (md_display, world_info, reasoning) which are not executed by the MVP runtime.',
    ])

    const manyRules = Array.from({ length: PRESET_COMPAT_REGEX_RUNTIME_MAX_ACTIVE_RULES + 2 }, (_, index) => createRegexRecord({
      id: `rule-${index + 1}`,
      pattern: `\\bx${index + 1}\\b`,
      replacement: `y${index + 1}`,
    }))
    const boundedResult = runPresetCompatRegexRuntime({
      value: 'x1 x101 x102',
      phase: 'user_input',
      standalone: manyRules,
      embedded: [],
    })
    const overlongResult = runPresetCompatRegexRuntime({
      value: 'a'.repeat(PRESET_COMPAT_REGEX_RUNTIME_MAX_INPUT_LENGTH + 1),
      phase: 'user_input',
      standalone: [createRegexRecord({ id: 'length-1', pattern: 'a', replacement: 'b' })],
      embedded: [],
    })

    expect(boundedResult.value).toBe('y1 x101 x102')
    expect(boundedResult.appliedRuleIds).toHaveLength(PRESET_COMPAT_REGEX_RUNTIME_MAX_ACTIVE_RULES)
    expect(boundedResult.skippedRuleIds).toEqual(['rule-101', 'rule-102'])
    expect(boundedResult.warnings).toEqual([
      'Skipped 2 preset-compat regex rule(s) for user_input after reaching the 100-rule limit.',
    ])

    expect(overlongResult.value).toHaveLength(PRESET_COMPAT_REGEX_RUNTIME_MAX_INPUT_LENGTH + 1)
    expect(overlongResult.appliedRuleIds).toEqual([])
    expect(overlongResult.skippedRuleIds).toEqual(['length-1'])
    expect(overlongResult.warnings).toEqual([
      `Skipped preset-compat regex runtime for user_input because input length ${PRESET_COMPAT_REGEX_RUNTIME_MAX_INPUT_LENGTH + 1} exceeds ${PRESET_COMPAT_REGEX_RUNTIME_MAX_INPUT_LENGTH} characters.`,
    ])
  })
})
