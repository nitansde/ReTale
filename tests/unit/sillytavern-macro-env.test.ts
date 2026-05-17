import { describe, expect, it } from 'vitest'

import { createPresetCompatMacroContext } from '@/lib/preset-compat/macro-context'
import { evaluatePresetCompatMacroInvocation } from '@/lib/preset-compat/macro-evaluator'
import { createPresetCompatEnvMacroBuiltins } from '@/lib/preset-compat/macro-builtins-env'
import { createPresetCompatRandomTimeMacroBuiltins } from '@/lib/preset-compat/macro-builtins-random-time'
import { createPresetCompatMacroRegistry } from '@/lib/preset-compat/macro-registry'

function createRegistry() {
  return createPresetCompatMacroRegistry([
    ...createPresetCompatEnvMacroBuiltins(),
    ...createPresetCompatRandomTimeMacroBuiltins(),
  ])
}

function evaluateMacro(
  registry: ReturnType<typeof createRegistry>,
  name: string,
  context: ReturnType<typeof createPresetCompatMacroContext>,
  args: string[] = [],
) {
  return evaluatePresetCompatMacroInvocation({
    invocation: {
      name,
      args: args.map((value) => ({ type: 'text', value })),
    },
    context,
    registry,
  })
}

describe('sillytavern macro env/time/random built-ins', () => {
  it('resolves context-backed macros from runtime values and key fallbacks', () => {
    const context = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
      runtimeValues: {
        userName: 'Alice',
        characterName: 'Bob',
        assistantName: 'Rho',
        personaPrompt: 'Curious investigator',
        lastMessage: 'Most recent line',
        maxContext: 8192,
        maxTokens: 512,
      },
    })
    const registry = createRegistry()

    expect(evaluateMacro(registry, 'user', context)).toBe('Alice')
    expect(evaluateMacro(registry, 'char', context)).toBe('Bob')
    expect(evaluateMacro(registry, 'bot', context)).toBe('Rho')
    expect(evaluateMacro(registry, 'persona', context)).toBe('Curious investigator')
    expect(evaluateMacro(registry, 'lastmessage', context)).toBe('Most recent line')
    expect(evaluateMacro(registry, 'maxcontext', context)).toBe('8192')
    expect(evaluateMacro(registry, 'maxresponse', context)).toBe('512')
    expect(context.diagnostics).toEqual([])
  })

  it('returns empty string with MISSING_CONTEXT_VALUE when a context-backed value is unavailable', () => {
    const context = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
    })
    const registry = createRegistry()

    expect(evaluateMacro(registry, 'user', context)).toBe('')
    expect(evaluateMacro(registry, 'maxcontext', context)).toBe('')
    expect(context.diagnostics).toEqual([
      expect.objectContaining({
        code: 'MISSING_CONTEXT_VALUE',
        macroName: 'user',
      }),
      expect.objectContaining({
        code: 'MISSING_CONTEXT_VALUE',
        macroName: 'maxcontext',
      }),
    ])
  })

  it('formats deterministic clock-backed macros from the injected now value', () => {
    const context = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
      now: new Date('2026-05-16T12:34:56.000Z'),
    })
    const registry = createRegistry()

    expect(evaluateMacro(registry, 'time', context)).toBe('12:34')
    expect(evaluateMacro(registry, 'date', context)).toBe('May 16, 2026')
    expect(evaluateMacro(registry, 'weekday', context)).toBe('Saturday')
    expect(evaluateMacro(registry, 'isotime', context)).toBe('12:34:56')
    expect(evaluateMacro(registry, 'isodate', context)).toBe('2026-05-16')
    expect(evaluateMacro(registry, 'datetimeformat', context, ['YYYY/MM/DD HH:mm:ss'])).toBe('2026/05/16 12:34:56')
    expect(context.diagnostics).toEqual([])
  })

  it('uses the seeded rng deterministically for roll, random, and pick', () => {
    const firstContext = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
      seed: 123,
    })
    const secondContext = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
      seed: 123,
    })
    const registry = createRegistry()

    const firstRoll = evaluateMacro(registry, 'roll', firstContext, ['1', '6'])
    const firstRandom = evaluateMacro(registry, 'random', firstContext)
    const firstPick = evaluateMacro(registry, 'pick', firstContext, ['red', 'green', 'blue'])

    expect(firstRoll).toBe(evaluateMacro(registry, 'roll', secondContext, ['1', '6']))
    expect(firstRandom).toBe(evaluateMacro(registry, 'random', secondContext))
    expect(firstPick).toBe(evaluateMacro(registry, 'pick', secondContext, ['red', 'green', 'blue']))
    expect(Number(firstRoll)).toBeGreaterThanOrEqual(1)
    expect(Number(firstRoll)).toBeLessThanOrEqual(6)
    expect(Number(firstRandom)).toBeGreaterThanOrEqual(0)
    expect(Number(firstRandom)).toBeLessThan(1)
    expect(['red', 'green', 'blue']).toContain(firstPick)
    expect(firstContext.diagnostics).toEqual([])
    expect(secondContext.diagnostics).toEqual([])
  })
})
