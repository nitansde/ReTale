import { describe, expect, it } from 'vitest'

import { createPresetCompatEnvMacroBuiltins } from '@/lib/preset-compat/macro-builtins-env'
import { createPresetCompatMacroContext } from '@/lib/preset-compat/macro-context'
import { createPresetCompatMacroRegistry } from '@/lib/preset-compat/macro-registry'
import { runPresetCompatRegexRuntime } from '@/lib/preset-compat/regex-runtime'
import type { PresetCompatRegexRecord } from '@/lib/preset-compat/types'

function createRegexRecord(overrides: Partial<PresetCompatRegexRecord> = {}): PresetCompatRegexRecord {
  return {
    id: 'regex-macro-gate',
    name: 'Regex macro gate',
    pattern: '(Bob)',
    replacement: '{{user}}-$1',
    flags: '',
    disabled: false,
    placements: ['user_input'],
    trimStrings: [],
    promptOnly: false,
    markdownOnly: false,
    minDepth: null,
    maxDepth: null,
    substituteRegex: '1',
    runOnEdit: false,
    passthrough: {},
    ...overrides,
  }
}

describe('sillytavern macro regex runtime', () => {
  it('resolves macros during regex replacement when a macro processor is supplied', () => {
    const result = runPresetCompatRegexRuntime({
      value: 'Bob',
      phase: 'user_input',
      standalone: [createRegexRecord()],
      embedded: [],
      macroProcessor: {
        context: createPresetCompatMacroContext({
          surfaceId: 'rewrite',
          phase: 'regex-replacement',
          runtimeValues: { user: 'Alice' },
        }),
        registry: createPresetCompatMacroRegistry([
          ...createPresetCompatEnvMacroBuiltins(),
        ]),
      },
    })

    expect(result.value).toBe('Alice-Bob')
    expect(result.warnings).toEqual([])
  })
})
