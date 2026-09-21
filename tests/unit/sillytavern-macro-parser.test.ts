import { describe, expect, it } from 'vitest'

import { parsePresetCompatMacroSource } from '@/lib/preset-compat/macro-parser'

describe('sillytavern macro parser', () => {
  it('handles long context previews with many inline macros without repeatedly parsing the remaining text', () => {
    const body = '正文与对话。'.repeat(25_000)
    const macros = '{{user}}{{char}}'.repeat(32)
    const start = performance.now()
    const result = parsePresetCompatMacroSource(macros + body)

    expect(performance.now() - start).toBeLessThan(1_000)
    expect(result.diagnostics).toEqual([])
    expect(result.nodes).toHaveLength(65)
    expect(result.nodes.slice(0, -1).every((node) => node.type === 'macro' && node.form === 'inline')).toBe(true)
    expect(result.nodes.at(-1)).toMatchObject({ type: 'text', value: body, range: { start: macros.length, end: macros.length + body.length } })
  })

  it('preserves nested same-name blocks, inline tags, else branches and argument-local closing tags', () => {
    const source = '{{if outer}}{{user}}{{if inner}}yes{{else}}no{{/if}}{{else}}{{getvar::{{char}}}}{{/if}}{{user}}{{note::{{/user}}}}'
    const result = parsePresetCompatMacroSource(source)
    expect(result.nodes).toMatchObject([
      { type: 'macro', form: 'block', normalizedName: 'if',
        children: [
          { type: 'macro', form: 'inline', normalizedName: 'user' },
          { type: 'macro', form: 'block', normalizedName: 'if', children: [{ value: 'yes' }], elseChildren: [{ value: 'no' }] },
        ],
        elseChildren: [{ normalizedName: 'getvar', args: [{ segments: [{ normalizedName: 'char' }] }] }],
      },
      { type: 'macro', form: 'inline', normalizedName: 'user' },
      { type: 'macro', form: 'inline', normalizedName: 'note' },
    ])
    expect(result.diagnostics).toMatchObject([{ code: 'MALFORMED_MACRO', raw: '{{/user}}' }])
    expect(result.nodes.map((node) => node.raw).join('')).toBe(source)
  })

  it('parses inline macros case-insensitively while preserving raw names, adjacent macros, and escaped delimiters', () => {
    const result = parsePresetCompatMacroSource('Hi {{User}}{{bot}} \\{\\{literal\\}\\}!')

    expect(result.diagnostics).toEqual([])
    expect(result.nodes).toMatchObject([
      {
        type: 'text',
        value: 'Hi ',
      },
      {
        type: 'macro',
        form: 'inline',
        rawName: 'User',
        normalizedName: 'user',
        raw: '{{User}}',
      },
      {
        type: 'macro',
        form: 'inline',
        rawName: 'bot',
        normalizedName: 'bot',
        raw: '{{bot}}',
      },
      {
        type: 'text',
        value: ' {{literal}}!',
      },
    ])
  })

  it('parses whitespace, double-colon, single-colon, and nested macro arguments into evaluator-ready segments', () => {
    const result = parsePresetCompatMacroSource(
      '{{name arg}}{{name::arg1::arg2}}{{name:arg1:arg2}}{{getvar::{{char}}_mood}}'
    )

    expect(result.diagnostics).toEqual([])
    expect(result.nodes).toMatchObject([
      {
        type: 'macro',
        form: 'inline',
        normalizedName: 'name',
        args: [
          {
            separator: 'space',
            raw: 'arg',
            segments: [{ type: 'text', value: 'arg' }],
          },
        ],
      },
      {
        type: 'macro',
        form: 'inline',
        normalizedName: 'name',
        args: [
          { separator: 'double-colon', raw: 'arg1' },
          { separator: 'double-colon', raw: 'arg2' },
        ],
      },
      {
        type: 'macro',
        form: 'inline',
        normalizedName: 'name',
        args: [
          { separator: 'single-colon', raw: 'arg1' },
          { separator: 'single-colon', raw: 'arg2' },
        ],
      },
      {
        type: 'macro',
        form: 'inline',
        normalizedName: 'getvar',
        args: [
          {
            separator: 'double-colon',
            raw: '{{char}}_mood',
            segments: [
              {
                type: 'macro',
                form: 'inline',
                normalizedName: 'char',
                raw: '{{char}}',
              },
              {
                type: 'text',
                value: '_mood',
              },
            ],
          },
        ],
      },
    ])
  })

  it('parses scoped macros, else branches, and # whitespace-control blocks without evaluating them', () => {
    const result = parsePresetCompatMacroSource('{{if cond}}A{{else}}B{{/if}}{{#trim}} x {{/trim}}')

    expect(result.diagnostics).toEqual([])
    expect(result.nodes).toMatchObject([
      {
        type: 'macro',
        form: 'block',
        rawName: 'if',
        normalizedName: 'if',
        whitespaceControl: null,
        args: [
          {
            separator: 'space',
            raw: 'cond',
          },
        ],
        children: [{ type: 'text', value: 'A' }],
        elseChildren: [{ type: 'text', value: 'B' }],
      },
      {
        type: 'macro',
        form: 'block',
        rawName: 'trim',
        normalizedName: 'trim',
        whitespaceControl: '#',
        children: [{ type: 'text', value: ' x ' }],
        elseChildren: null,
      },
    ])
  })

  it('parses comment-style macros as regular invocations with raw source preserved', () => {
    const result = parsePresetCompatMacroSource('A{{// hidden note}}B')

    expect(result.diagnostics).toEqual([])
    expect(result.nodes).toMatchObject([
      {
        type: 'text',
        value: 'A',
      },
      {
        type: 'macro',
        form: 'inline',
        rawName: '//',
        normalizedName: '//',
        args: [
          {
            separator: 'space',
            raw: 'hidden note',
          },
        ],
      },
      {
        type: 'text',
        value: 'B',
      },
    ])
  })

  it('keeps unterminated opens as literal text when no safe macro boundary exists', () => {
    const result = parsePresetCompatMacroSource('before {{if user')

    expect(result.diagnostics).toEqual([])
    expect(result.nodes).toMatchObject([
      {
        type: 'text',
        value: 'before {{if user',
      },
    ])
  })

  it('emits MALFORMED_MACRO diagnostics and safe malformed nodes for stray else and closing tags', () => {
    const result = parsePresetCompatMacroSource('{{else}}{{/trim}}')

    expect(result.diagnostics).toMatchObject([
      {
        code: 'MALFORMED_MACRO',
        raw: '{{else}}',
      },
      {
        code: 'MALFORMED_MACRO',
        raw: '{{/trim}}',
      },
    ])
    expect(result.nodes).toMatchObject([
      {
        type: 'malformed-macro',
        raw: '{{else}}',
        rawName: 'else',
        normalizedName: 'else',
      },
      {
        type: 'malformed-macro',
        raw: '{{/trim}}',
        rawName: 'trim',
        normalizedName: 'trim',
      },
    ])
  })
})
