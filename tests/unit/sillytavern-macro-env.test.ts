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

  it('uses the protagonist fallback for user and reports missing non-fallback values', () => {
    const context = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
    })
    const registry = createRegistry()

    expect(evaluateMacro(registry, 'user', context)).toBe('主人公')
    expect(evaluateMacro(registry, 'maxcontext', context)).toBe('')
    expect(context.diagnostics).toEqual([
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
      now: new Date(2026, 4, 16, 12, 34, 56),
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

  it('follows SillyTavern list, dice, and stable-pick semantics', () => {
    const context = createPresetCompatMacroContext({ surfaceId: 'rewrite', phase: 'prompt-rule', seed: 7 })
    const registry = createRegistry()
    const pick = (seed: number) => evaluateMacro(
      registry, 'pick', createPresetCompatMacroContext({ surfaceId: 'rewrite', phase: 'prompt-rule', seed }), ['red', 'green', 'blue'],
    )

    expect(['a', 'b']).toContain(evaluateMacro(registry, 'random', context, ['a', 'b']))
    expect(['1', '2, 3']).toContain(evaluateMacro(registry, 'random', context, ['1,2\\, 3']))
    expect(pick(1)).toBe(pick(2))
    for (const [formula, min, max] of [['1d6', 1, 6], ['d20', 1, 20], ['3d6+4', 7, 22], ['20', 1, 20]] as const) {
      const total = Number(evaluateMacro(registry, 'roll', context, [formula]))
      expect(total).toBeGreaterThanOrEqual(min)
      expect(total).toBeLessThanOrEqual(max)
    }
    expect(context.diagnostics).toEqual([])

    expect(evaluateMacro(registry, 'roll', context, ['1d6x'])).toBe('')
    expect(evaluateMacro(registry, 'roll', context, ['-3'])).toBe('')
    expect(context.diagnostics).toHaveLength(2)
  })

  it('rolls differently per request when no seed is configured', () => {
    const registry = createRegistry()
    const rolls = new Set(Array.from({ length: 16 }, () => evaluateMacro(
      registry, 'roll', createPresetCompatMacroContext({ surfaceId: 'rewrite', phase: 'prompt-rule' }), ['1000000'],
    )))
    expect(rolls.size).toBeGreaterThan(1)
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
