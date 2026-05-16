import { describe, expect, it } from 'vitest'
import type {
  PresetCompatLibrary,
  PresetCompatPresetRecord,
  PresetCompatPromptRule,
  PresetCompatRegexRecord,
  PresetCompatRuntimeSnapshot,
  PresetCompatSurfaceBinding,
} from '@/lib/preset-compat/types'

describe('preset compat domain types', () => {
  it('locks the preset and library record shape required by the compatibility subsystem', () => {
    const promptRule: PresetCompatPromptRule = {
      id: 'rule-001',
      name: 'Main instruction',
      role: 'system',
      content: 'Write in close third person.',
      enabled: true,
      marker: false,
      injectAsSystemPrompt: true,
      injectionPosition: 'before',
      injectionDepth: 0,
      injectionOrder: 10,
      injectionTrigger: 'rewrite',
      forbidOverrides: true,
      condition: 'always',
      passthrough: {
        originalPromptId: 'st-prompt-001',
      },
    }

    const preservedPromptRule: PresetCompatPromptRule = {
      id: 'rule-002',
      name: 'Preserved unsupported role',
      role: 'assistant',
      content: 'Preserve this role for round-trip import/export only.',
      enabled: false,
      marker: true,
      injectAsSystemPrompt: false,
      injectionPosition: 'none',
      injectionDepth: null,
      injectionOrder: null,
      injectionTrigger: null,
      forbidOverrides: false,
      condition: null,
      passthrough: {
        preservedOnly: true,
      },
    }

    const embeddedRegex: PresetCompatRegexRecord = {
      id: 'regex-embedded-001',
      name: 'Trim double spaces',
      pattern: '\\s{2,}',
      replacement: ' ',
      flags: 'g',
      disabled: false,
      placements: ['assistant_output'],
      trimStrings: ['\n'],
      promptOnly: false,
      markdownOnly: false,
      minDepth: 0,
      maxDepth: 8,
      substituteRegex: null,
      runOnEdit: true,
      passthrough: {
        sourceScope: 'embedded',
      },
    }

    const standaloneRegex: PresetCompatRegexRecord = {
      id: 'regex-standalone-001',
      name: 'Normalize ellipsis',
      pattern: '\\.\\.\\.',
      replacement: '……',
      flags: 'g',
      disabled: false,
      placements: ['assistant_output', 'user_input', 'md_display'],
      trimStrings: [],
      promptOnly: true,
      markdownOnly: true,
      minDepth: 1,
      maxDepth: null,
      substituteRegex: '(?:\\.\\.\\.)',
      runOnEdit: false,
      passthrough: {
        preserveReason: 'imported-from-st',
      },
    }

    const surfaceBinding: PresetCompatSurfaceBinding = {
      surfaceId: 'rewrite',
      presetId: 'preset-001',
      enabled: true,
      failClosed: false,
    }

    const preset: PresetCompatPresetRecord = {
      id: 'preset-001',
      name: 'Default Rewrite Preset',
      sourceApiId: 'openai',
      promptRules: [promptRule, preservedPromptRule],
      promptOrderLists: {
        rewrite: ['rule-001'],
      },
      embeddedRegexes: [embeddedRegex],
      attachedStandaloneRegexIds: ['regex-standalone-001'],
      runtimeSampler: {
        temperature: 0.8,
        topP: 0.95,
        topK: null,
        minP: null,
        presencePenalty: null,
        frequencyPenalty: null,
        repetitionPenalty: null,
        maxTokens: 2048,
      },
      passthrough: {
        stop: ['<END>'],
      },
      importWarnings: [],
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    }

    const library: PresetCompatLibrary = {
      schemaVersion: 1,
      revision: 0,
      presets: {
        [preset.id]: preset,
      },
      standaloneRegexes: {
        [standaloneRegex.id]: standaloneRegex,
      },
      surfaceBindings: {
        rewrite: surfaceBinding,
        expand: {
          surfaceId: 'expand',
          presetId: 'preset-001',
          enabled: true,
          failClosed: false,
        },
        roleplay: {
          surfaceId: 'roleplay',
          presetId: 'preset-001',
          enabled: true,
          failClosed: false,
        },
        polish: {
          surfaceId: 'polish',
          presetId: 'preset-001',
          enabled: true,
          failClosed: false,
        },
        continue: {
          surfaceId: 'continue',
          presetId: 'preset-001',
          enabled: true,
          failClosed: false,
        },
        future_jump_rewrite: {
          surfaceId: 'future_jump_rewrite',
          presetId: 'preset-001',
          enabled: true,
          failClosed: false,
        },
        future_jump_bridge: {
          surfaceId: 'future_jump_bridge',
          presetId: null,
          enabled: false,
          failClosed: true,
        },
        what_if_delta_extraction: {
          surfaceId: 'what_if_delta_extraction',
          presetId: null,
          enabled: false,
          failClosed: true,
        },
        knowledge_extraction: {
          surfaceId: 'knowledge_extraction',
          presetId: null,
          enabled: false,
          failClosed: true,
        },
        embeddings: {
          surfaceId: 'embeddings',
          presetId: null,
          enabled: false,
          failClosed: true,
        },
      },
      lastImportedAt: null,
      lastExportedAt: null,
    }

    const snapshot: PresetCompatRuntimeSnapshot = {
      activePresetId: preset.id,
      activeSurfaceId: 'rewrite',
      importedAt: '2026-05-15T00:00:00.000Z',
      warnings: [],
    }

    expect(Object.keys(preset)).toEqual(expect.arrayContaining([
      'id',
      'name',
      'sourceApiId',
      'promptRules',
      'promptOrderLists',
      'embeddedRegexes',
      'attachedStandaloneRegexIds',
      'runtimeSampler',
      'passthrough',
      'importWarnings',
      'createdAt',
      'updatedAt',
    ]))

    expect(promptRule).toMatchObject({
      id: 'rule-001',
      name: 'Main instruction',
      role: 'system',
      content: 'Write in close third person.',
      enabled: true,
      marker: false,
      injectAsSystemPrompt: true,
      injectionPosition: 'before',
      injectionDepth: 0,
      injectionOrder: 10,
      injectionTrigger: 'rewrite',
      forbidOverrides: true,
      condition: 'always',
    })

    expect(preservedPromptRule).toMatchObject({
      id: 'rule-002',
      name: 'Preserved unsupported role',
      role: 'assistant',
      enabled: false,
      marker: true,
      injectAsSystemPrompt: false,
      injectionPosition: 'none',
      injectionDepth: null,
      injectionOrder: null,
      injectionTrigger: null,
      forbidOverrides: false,
      condition: null,
    })

    expect(Object.keys(promptRule)).toEqual(expect.arrayContaining([
      'id',
      'name',
      'role',
      'content',
      'enabled',
      'marker',
      'injectAsSystemPrompt',
      'injectionPosition',
      'injectionDepth',
      'injectionOrder',
      'injectionTrigger',
      'forbidOverrides',
      'condition',
      'passthrough',
    ]))

    expect(embeddedRegex).toMatchObject({
      id: 'regex-embedded-001',
      name: 'Trim double spaces',
      pattern: '\\s{2,}',
      replacement: ' ',
      flags: 'g',
      disabled: false,
      placements: ['assistant_output'],
      trimStrings: ['\n'],
      promptOnly: false,
      markdownOnly: false,
      minDepth: 0,
      maxDepth: 8,
      substituteRegex: null,
      runOnEdit: true,
    })

    expect(standaloneRegex.placements).toEqual(['assistant_output', 'user_input', 'md_display'])

    expect(Object.keys(standaloneRegex)).toEqual(expect.arrayContaining([
      'id',
      'name',
      'pattern',
      'replacement',
      'flags',
      'disabled',
      'placements',
      'trimStrings',
      'promptOnly',
      'markdownOnly',
      'minDepth',
      'maxDepth',
      'substituteRegex',
      'runOnEdit',
      'passthrough',
    ]))

    expect(Object.keys(library)).toEqual(expect.arrayContaining([
      'schemaVersion',
      'revision',
      'presets',
      'standaloneRegexes',
      'surfaceBindings',
      'lastImportedAt',
      'lastExportedAt',
    ]))

    expect(snapshot).toMatchObject({
      activePresetId: 'preset-001',
      activeSurfaceId: 'rewrite',
      warnings: [],
    })
    expect(library.presets[preset.id]?.sourceApiId).toBe('openai')
    expect(library.standaloneRegexes[standaloneRegex.id]?.name).toBe('Normalize ellipsis')
    expect(library.surfaceBindings.rewrite).toBe(surfaceBinding)
  })
})
