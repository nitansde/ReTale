import { describe, expect, it } from 'vitest'
import {
  assemblePresetCompatPrompts,
  PRESET_COMPAT_PROMPT_ASSEMBLY_STAGE_ORDER,
} from '@/lib/preset-compat/prompt-assembly'

describe('preset compat prompt assembly', () => {
  it('preserves the legacy append/prepend contract when only unstructured imported rule arrays are provided', () => {
    const assembled = assemblePresetCompatPrompts({
      baseSystemPrompt: 'Base system prompt.',
      baseUserPrompt: 'Base user prompt.',
      importedSystemRuleContents: ['System rule A.', 'System rule B.'],
      importedUserRuleContents: ['User rule A.', 'User rule B.'],
    })

    expect(assembled.systemPrompt).toBe([
      'Base system prompt.',
      '## Imported Preset System Rules',
      'System rule A.',
      'System rule B.',
    ].join('\n\n'))
    expect(assembled.userPromptBeforeRegex).toBe([
      '## Imported Preset User Rules',
      'User rule A.',
      'User rule B.',
      'Base user prompt.',
    ].join('\n\n'))
  })

  it('routes structured imported rules into their canonical channels and placements', () => {
    const assembled = assemblePresetCompatPrompts({
      baseSystemPrompt: 'Base system prompt.',
      baseUserPrompt: 'Base user prompt.',
      importedPromptRules: [
        { channel: 'system', placement: 'prepend', text: 'System before.' },
        { channel: 'system', placement: 'append', text: 'System after.' },
        { channel: 'user', placement: 'prepend', text: 'User before.' },
        { channel: 'user', placement: 'append', text: 'User after.' },
      ],
      systemMetadataInsertions: ['System metadata insertion.'],
      userMetadataInsertions: ['User metadata insertion.'],
    })

    expect(assembled.systemPrompt).toBe([
      '## Imported Preset System Rules',
      'System before.',
      'Base system prompt.',
      '## Imported Preset System Rules',
      'System after.',
      'System metadata insertion.',
    ].join('\n\n'))
    expect(assembled.userPromptBeforeRegex).toBe([
      '## Imported Preset User Rules',
      'User before.',
      'Base user prompt.',
      '## Imported Preset User Rules',
      'User after.',
      'User metadata insertion.',
    ].join('\n\n'))
  })

  it('emits structured stage metadata for structured imported rules', () => {
    const assembled = assemblePresetCompatPrompts({
      baseSystemPrompt: 'Base system prompt.',
      baseUserPrompt: 'Base user prompt.',
      systemTemplateFragments: ['System template fragment.'],
      userTemplateFragments: ['User template fragment.'],
      importedPromptRules: [
        { channel: 'system', placement: 'append', text: 'System rule A.' },
        { channel: 'user', placement: 'prepend', text: 'User rule A.' },
      ],
      systemMetadataInsertions: ['System metadata insertion.'],
      userMetadataInsertions: ['User metadata insertion.'],
    })

    expect(assembled.metadata.stageOrder).toEqual(PRESET_COMPAT_PROMPT_ASSEMBLY_STAGE_ORDER)
    expect(assembled.metadata.system.stages).toEqual([
      { stage: 'base_prompt', status: 'applied', segmentCount: 1 },
      { stage: 'template_fragments', status: 'applied', segmentCount: 1 },
      { stage: 'imported_prompt_rules', status: 'applied', segmentCount: 1 },
      { stage: 'metadata_insertions', status: 'applied', segmentCount: 1 },
      { stage: 'regex_processing', status: 'pending', segmentCount: 0 },
    ])
    expect(assembled.metadata.user.stages).toEqual([
      { stage: 'base_prompt', status: 'applied', segmentCount: 1 },
      { stage: 'template_fragments', status: 'applied', segmentCount: 1 },
      { stage: 'imported_prompt_rules', status: 'applied', segmentCount: 1 },
      { stage: 'metadata_insertions', status: 'applied', segmentCount: 1 },
      { stage: 'regex_processing', status: 'pending', segmentCount: 0 },
    ])
    expect(assembled.metadata.user.segments.find((segment) => segment.stage === 'imported_prompt_rules')).toMatchObject({
      channel: 'user',
      placement: 'prepend',
    })
  })

  it('drops empty sections without introducing blank wrappers', () => {
    const assembled = assemblePresetCompatPrompts({
      baseSystemPrompt: '  ',
      baseUserPrompt: 'Base user prompt.',
      importedPromptRules: [
        { channel: 'system', placement: 'append', text: '   ' },
      ],
      userMetadataInsertions: ['   '],
    })

    expect(assembled.systemPrompt).toBe('')
    expect(assembled.userPromptBeforeRegex).toBe('Base user prompt.')
    expect(assembled.metadata.system.stages).toEqual([
      { stage: 'base_prompt', status: 'empty', segmentCount: 0 },
      { stage: 'template_fragments', status: 'empty', segmentCount: 0 },
      { stage: 'imported_prompt_rules', status: 'empty', segmentCount: 0 },
      { stage: 'metadata_insertions', status: 'empty', segmentCount: 0 },
      { stage: 'regex_processing', status: 'pending', segmentCount: 0 },
    ])
  })

  it('renders structured imported rules by channel and placement inside the assembly layer', () => {
    const assembled = assemblePresetCompatPrompts({
      baseSystemPrompt: 'Base system prompt.',
      baseUserPrompt: 'Base user prompt.',
      importedPromptRules: [
        { channel: 'system', placement: 'prepend', text: 'System prepended.' },
        { channel: 'system', placement: 'append', text: 'System appended.' },
        { channel: 'user', placement: 'prepend', text: 'User prepended.' },
        { channel: 'user', placement: 'append', text: 'User appended.' },
      ],
    })

    expect(assembled.systemPrompt).toBe([
      '## Imported Preset System Rules',
      'System prepended.',
      'Base system prompt.',
      '## Imported Preset System Rules',
      'System appended.',
    ].join('\n\n'))
    expect(assembled.userPromptBeforeRegex).toBe([
      '## Imported Preset User Rules',
      'User prepended.',
      'Base user prompt.',
      '## Imported Preset User Rules',
      'User appended.',
    ].join('\n\n'))
    expect(assembled.metadata.system.stages).toEqual([
      { stage: 'base_prompt', status: 'applied', segmentCount: 1 },
      { stage: 'template_fragments', status: 'empty', segmentCount: 0 },
      { stage: 'imported_prompt_rules', status: 'applied', segmentCount: 2 },
      { stage: 'metadata_insertions', status: 'empty', segmentCount: 0 },
      { stage: 'regex_processing', status: 'pending', segmentCount: 0 },
    ])
  })
})
