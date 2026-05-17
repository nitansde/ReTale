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

describe('sillytavern variable built-ins', () => {
  it('supports local and global variable stores through explicit macros', () => {
    const context = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
    })
    const render = createRenderer(context, createRegistry())

    expect(render('{{setvar::mood::happy}}{{setglobalvar::mood::grim}}{{getvar::mood}}|{{getglobalvar::mood}}')).toBe(
      'happy|grim'
    )
    expect(render('{{setvar::count::1}}{{addvar::count::4}}{{decvar::count}}{{getvar::count}}')).toBe('4')
    expect(render('{{hasvar::count}}|{{deletevar::count}}|{{hasvar::count}}')).toBe('true|true|false')
    expect(render('{{setglobalvar::total::2}}{{incglobalvar::total}}{{hasglobalvar::total}}|{{getglobalvar::total}}')).toBe(
      'true|3'
    )
    expect(context.diagnostics).toEqual([])
  })

  it('supports shorthand local/global getters and mutation operators', () => {
    const context = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
    })
    const render = createRenderer(context, createRegistry())

    expect(render('{{.topic=dragons}}{{.topic}}|{{$topic=phoenix}}{{$topic}}')).toBe('dragons|phoenix')
    expect(render('{{.count=1}}{{.count++}}{{.count+=4}}{{.count--}}{{.count}}')).toBe('5')
    expect(render('{{.count-=2}}{{.count}}|{{$count=10}}{{$count-=3}}{{$count}}')).toBe('3|7')
    expect(context.diagnostics).toEqual([])
  })

  it('distinguishes || from ?? and supports fallback assignment variants', () => {
    const context = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
    })
    const render = createRenderer(context, createRegistry())

    expect(render('{{.empty=}}{{.empty||fallback}}|{{.empty??fallback}}|{{.missing||fallback}}|{{.missing??fallback}}')).toBe(
      'fallback||fallback|fallback'
    )
    expect(render('{{.empty||=filled}}{{.empty}}|{{.maybe??=set}}{{.maybe}}')).toBe('filled|set')
    expect(context.diagnostics).toEqual([])
  })

  it('returns exact true/false strings for comparisons', () => {
    const context = createPresetCompatMacroContext({
      surfaceId: 'rewrite',
      phase: 'prompt-rule',
    })
    const render = createRenderer(context, createRegistry())

    expect(render('{{.count=10}}{{.count==10}}|{{.count!=2}}|{{.count>2}}|{{.count>=10}}|{{.count<5}}|{{.count<=9}}')).toBe(
      'true|true|true|true|false|false'
    )
    expect(render('{{$name=Alice}}{{$name==Alice}}|{{$name!=Bob}}|{{$name<Bob}}')).toBe('true|true|true')
    expect(context.diagnostics).toEqual([])
  })
})
