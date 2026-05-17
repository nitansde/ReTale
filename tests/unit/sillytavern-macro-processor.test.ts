import { describe, expect, it } from 'vitest'

import { registerPresetCompatCoreMacroBuiltins } from '@/lib/preset-compat/macro-builtins-core'
import { registerPresetCompatVariableMacroBuiltins } from '@/lib/preset-compat/macro-builtins-variables'
import { createPresetCompatMacroContext } from '@/lib/preset-compat/macro-context'
import { createPresetCompatMacroRegistry } from '@/lib/preset-compat/macro-registry'
import { processPresetCompatMacroJson, processPresetCompatMacroString } from '@/lib/preset-compat/macro-processor'

function createProcessorRegistry() {
  return createPresetCompatMacroRegistry([
    ...registerPresetCompatCoreMacroBuiltins(),
    ...registerPresetCompatVariableMacroBuiltins(),
  ])
}

describe('sillytavern macro processor', () => {
  it('processes nested JSON strings immutably while preserving keys and non-string values', () => {
    const registry = createProcessorRegistry()
    const context = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
      seed: 1,
    })
    const input = {
      prompt: 'Hello {{setvar::name::Ada}}{{getvar::name}}!',
      nested: {
        later: '{{getvar::name}}',
        count: 2,
        enabled: true,
        nullable: null,
      },
      list: ['{{getvar::name}}', 7, false, { tail: '{{getvar::name}}' }],
    }
    const original = structuredClone(input)

    const result = processPresetCompatMacroJson(input, { context, registry })

    expect(input).toEqual(original)
    expect(result).toEqual({
      prompt: 'Hello Ada!',
      nested: {
        later: 'Ada',
        count: 2,
        enabled: true,
        nullable: null,
      },
      list: ['Ada', 7, false, { tail: 'Ada' }],
    })
    expect(result).not.toBe(input)
    expect(result.nested).not.toBe(input.nested)
    expect(result.list).not.toBe(input.list)
    expect(Object.keys(result)).toEqual(Object.keys(input))
    expect(Object.keys(result.nested)).toEqual(Object.keys(input.nested))
  })

  it('uses deterministic object and array traversal order for cross-field variable visibility', () => {
    const registry = createProcessorRegistry()
    const context = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
      seed: 2,
    })

    const result = processPresetCompatMacroJson({
      first: '{{setvar::topic::dragons}}',
      second: '{{getvar::topic}}',
      array: ['{{setvar::topic::phoenix}}', '{{getvar::topic}}'],
      nested: {
        before: '{{getvar::topic}}',
        afterSet: '{{setvar::topic::griffin}}',
        final: '{{getvar::topic}}',
      },
    }, { context, registry })

    expect(result).toEqual({
      first: '',
      second: 'dragons',
      array: ['', 'phoenix'],
      nested: {
        before: 'phoenix',
        afterSet: '',
        final: 'griffin',
      },
    })
  })

  it('normalizes shorthand variable macros before evaluation inside the processor', () => {
    const registry = createProcessorRegistry()
    const context = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
      seed: 3,
    })

    const result = processPresetCompatMacroString('{{.topic=dragons}}{{.topic}}', { context, registry })

    expect(result).toBe('dragons')
    expect(context.diagnostics).toEqual([])
  })

  it('preserves parser whitespaceControl metadata for #trim scoped blocks', () => {
    const registry = createProcessorRegistry()
    const context = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
      seed: 4,
    })

    const result = processPresetCompatMacroString('start{{#trim}}\n    alpha\n      beta\n{{/trim}}end', { context, registry })

    expect(result).toBe('start\nalpha\n  beta\nend')
    expect(context.diagnostics).toEqual([])
  })
})
