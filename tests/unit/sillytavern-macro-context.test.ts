import { describe, expect, it } from 'vitest'
import {
  createPresetCompatMacroContext,
  type PresetCompatMacroNodeLike,
} from '@/lib/preset-compat/macro-context'
import {
  createPresetCompatMacroRegistry,
  createPresetCompatRegisteredMacro,
} from '@/lib/preset-compat/macro-registry'
import { evaluatePresetCompatMacroInvocation } from '@/lib/preset-compat/macro-evaluator'

function createTextNode(value: string): PresetCompatMacroNodeLike {
  return {
    type: 'text',
    value,
  }
}

describe('sillytavern macro context and evaluator boundary', () => {
  it('creates isolated per-request state with deterministic now, rng, and variable stores', () => {
    const now = new Date('2026-05-16T12:34:56.000Z')
    const first = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
      now,
      seed: 123,
      runtimeValues: { user: 'Alice' },
      localVariables: { topic: 'dragons' },
      globalVariables: { tone: 'grim' },
    })
    const second = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
      now,
      seed: 123,
    })

    first.setLocalVariable('topic', 'phoenix')
    first.setGlobalVariable('tone', 'hopeful')
    first.addDiagnostic({
      code: 'MACRO_CONTEXT_WARNING',
      message: 'warning',
    })

    expect(first.getNow()).toEqual(now)
    expect(first.getRuntimeValue('user')).toBe('Alice')
    expect(first.getLocalVariable('topic')).toBe('phoenix')
    expect(first.getGlobalVariable('tone')).toBe('hopeful')
    expect(first.diagnostics).toHaveLength(1)

    expect(second.getRuntimeValue('user')).toBeUndefined()
    expect(second.getLocalVariable('topic')).toBeUndefined()
    expect(second.getGlobalVariable('tone')).toBeUndefined()
    expect(second.diagnostics).toEqual([])
    expect(first.random()).toBe(second.random())
    expect(first.random()).toBe(second.random())
  })

  it('keeps registry lookup case-insensitive and records delayed branch metadata for control macros', () => {
    const registry = createPresetCompatMacroRegistry([
      createPresetCompatRegisteredMacro({
        name: 'if',
        branchEvaluation: 'deferred',
        evaluate: () => 'unused',
      }),
    ])

    const entry = registry.get('IF')

    expect(entry?.canonicalName).toBe('if')
    expect(entry?.branchEvaluation).toBe('deferred')
    expect(entry?.argumentEvaluation).toBe('eager')
  })

  it('returns UNKNOWN_MACRO for unregistered names and UNSUPPORTED_MACRO for registered unsupported entries', () => {
    const context = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
      seed: 1,
    })
    const registry = createPresetCompatMacroRegistry([
      createPresetCompatRegisteredMacro({
        name: 'input',
        supported: false,
        evaluate: () => 'ignored',
      }),
    ])

    const unknownValue = evaluatePresetCompatMacroInvocation({
      invocation: { name: 'missing', args: [] },
      context,
      registry,
    })
    const unsupportedValue = evaluatePresetCompatMacroInvocation({
      invocation: { name: 'INPUT', args: [] },
      context,
      registry,
    })

    expect(unknownValue).toBe('')
    expect(unsupportedValue).toBe('')
    expect(context.diagnostics).toEqual([
      expect.objectContaining({
        code: 'UNKNOWN_MACRO',
        macroName: 'missing',
      }),
      expect.objectContaining({
        code: 'UNSUPPORTED_MACRO',
        macroName: 'input',
      }),
    ])
  })

  it('accepts parser-like structural invocation objects and defers branch resolution when requested', () => {
    const resolvedNodes: string[] = []
    const context = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
      seed: 7,
    })
    const registry = createPresetCompatMacroRegistry([
      createPresetCompatRegisteredMacro({
        name: 'trim',
        evaluate: ({ resolvedArguments }) => resolvedArguments[0]?.trim() ?? '',
      }),
      createPresetCompatRegisteredMacro({
        name: 'if',
        branchEvaluation: 'deferred',
        evaluate: ({ rawBranches, resolvedBranches }) => {
          expect(rawBranches).toEqual([createTextNode('branch-a'), createTextNode('branch-b')])
          expect(resolvedBranches).toBeUndefined()
          return 'branch-gated'
        },
      }),
    ])

    const trimValue = evaluatePresetCompatMacroInvocation({
      invocation: {
        type: 'macro',
        name: 'Trim',
        args: [createTextNode('  hello  ')],
      },
      context,
      registry,
      resolveNode(node) {
        const value = typeof node === 'string'
          ? node
          : 'value' in node && typeof node.value === 'string'
            ? node.value
            : ''
        resolvedNodes.push(value)
        return value
      },
    })
    const ifValue = evaluatePresetCompatMacroInvocation({
      invocation: {
        name: 'if',
        args: [createTextNode('condition')],
        branches: [createTextNode('branch-a'), createTextNode('branch-b')],
      },
      context,
      registry,
      resolveNode(node) {
        const value = typeof node === 'string'
          ? node
          : 'value' in node && typeof node.value === 'string'
            ? node.value
            : ''
        resolvedNodes.push(value)
        return value
      },
    })

    expect(trimValue).toBe('hello')
    expect(ifValue).toBe('branch-gated')
    expect(resolvedNodes).toEqual(['  hello  ', 'condition'])
  })
})
