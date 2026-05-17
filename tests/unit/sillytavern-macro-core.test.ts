import { describe, expect, it } from 'vitest'

import {
  type PresetCompatMacroContext,
  createPresetCompatMacroContext,
  type PresetCompatMacroNodeLike,
} from '@/lib/preset-compat/macro-context'
import { evaluatePresetCompatMacroInvocation } from '@/lib/preset-compat/macro-evaluator'
import {
  parsePresetCompatMacroSource,
  type PresetCompatMacroNode,
  type PresetCompatParsedMacroNode,
} from '@/lib/preset-compat/macro-parser'
import { createPresetCompatMacroRegistry, type PresetCompatMacroRegistry } from '@/lib/preset-compat/macro-registry'
import { registerPresetCompatCoreMacroBuiltins } from '@/lib/preset-compat/macro-builtins-core'
import {
  normalizePresetCompatVariableInvocation,
  registerPresetCompatVariableMacroBuiltins,
} from '@/lib/preset-compat/macro-builtins-variables'

function createRegistry() {
  return createPresetCompatMacroRegistry([
    ...registerPresetCompatCoreMacroBuiltins(),
    ...registerPresetCompatVariableMacroBuiltins(),
  ])
}

function createInvocation(node: PresetCompatParsedMacroNode) {
  return normalizePresetCompatVariableInvocation({
    name: node.rawName || node.normalizedName,
    whitespaceControl: node.whitespaceControl,
    args: node.args.map((argument) => ({ children: argument.segments })),
    branches: node.form === 'block'
      ? [
          { children: node.children },
          { children: node.elseChildren ?? [] },
        ]
      : [],
  })
}

function createRenderer(context: PresetCompatMacroContext, registry: PresetCompatMacroRegistry) {
  function renderNodeLike(node: PresetCompatMacroNodeLike): string {
    if (typeof node === 'string') {
      return node
    }

    if ('children' in node && Array.isArray(node.children) && (!('type' in node) || node.type !== 'macro')) {
      return node.children.map((child) => renderNodeLike(child)).join('')
    }

    if ('type' in node && node.type === 'text' && typeof node.value === 'string') {
      return node.value
    }

    if ('type' in node && node.type === 'macro') {
      return evaluatePresetCompatMacroInvocation({
        invocation: createInvocation(node as PresetCompatParsedMacroNode),
        context,
        registry,
        resolveNode: renderNodeLike,
      })
    }

    return ''
  }

  return function render(source: string) {
    const parsed = parsePresetCompatMacroSource(source)
    expect(parsed.diagnostics).toEqual([])
    return parsed.nodes.map((node) => renderNodeLike(node as PresetCompatMacroNode)).join('')
  }
}

describe('sillytavern core/control built-ins', () => {
  it('renders whitespace helpers, noop/comment elision, and reverse', () => {
    const context = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
    })
    const render = createRenderer(context, createRegistry())

    expect(render('A{{space}}B{{newline}}C{{noop}}D{{// hidden note}}E{{reverse::stressed}}')).toBe(
      'A B\nCDEdesserts'
    )
    expect(context.diagnostics).toEqual([])
  })

  it('trims and dedents block content while preserving #trim outer scoped whitespace', () => {
    const context = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
    })
    const render = createRenderer(context, createRegistry())

    expect(render('start{{trim}}\n    alpha\n      beta\n{{/trim}}end')).toBe('startalpha\n  betaend')
    expect(render('start{{#trim}}\n    alpha\n      beta\n{{/trim}}end')).toBe('start\nalpha\n  beta\nend')
    expect(context.diagnostics).toEqual([])
  })

  it('evaluates only the selected if branch and skips nested side effects or diagnostics in the other branch', () => {
    const context = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
    })
    const render = createRenderer(context, createRegistry())

    expect(render('{{if false}}{{setvar::x::bad}}{{else}}ok{{/if}}{{getvar::x}}')).toBe('ok')
    expect(render('{{if true}}yes{{else}}{{missing}}{{/if}}')).toBe('yes')
    expect(context.diagnostics).toEqual([])
  })
})
