import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import { createTempDatabaseCopy } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }

async function createTestDatabase(prefix: string) {
  const tempDatabase = createTempDatabaseCopy(prefix)
  cleanups.push(tempDatabase.cleanup)
  const database = new DatabaseSync(tempDatabase.dbPath)
  globalForSqlite.sqlite = database
  vi.resetModules()

  const { initializeDatabase } = await import('@/lib/server/sqlite')
  initializeDatabase(database)
  return database
}

function closeTestDatabase() {
  if (globalForSqlite.sqlite) {
    try {
      ;(globalForSqlite.sqlite as DatabaseSync & { close?: () => void }).close?.()
    } catch {
    }
    delete globalForSqlite.sqlite
  }
}

function readAppSetting(database: DatabaseSync, key: string) {
  return database.prepare('SELECT key, value FROM AppSetting WHERE key = ?').get(key) as { key: string; value: string } | undefined
}

function writeAppSetting(database: DatabaseSync, key: string, value: string) {
  database.prepare(
    `
      INSERT INTO AppSetting (id, key, value)
      VALUES (lower(hex(randomblob(16))), ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updatedAt = CURRENT_TIMESTAMP
    `
  ).run(key, value)
}

function deleteAppSetting(database: DatabaseSync, key: string) {
  database.prepare('DELETE FROM AppSetting WHERE key = ?').run(key)
}

afterEach(() => {
  vi.resetModules()
  closeTestDatabase()

  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('preset compat library app-setting store', () => {
  it('loads deterministic empty defaults when the stored blob is missing or corrupt', async () => {
    const database = await createTestDatabase('retale-preset-compat-library-defaults')
    deleteAppSetting(database, 'PRESET_COMPAT_LIBRARY_V1')
    vi.resetModules()
    const { loadStoredPresetCompatLibrary } = await import('@/lib/server/preset-compat-library')

    expect(loadStoredPresetCompatLibrary()).toEqual(createDefaultPresetCompatLibrary())

    writeAppSetting(database, 'PRESET_COMPAT_LIBRARY_V1', '{not valid json')
    expect(loadStoredPresetCompatLibrary()).toEqual(createDefaultPresetCompatLibrary())

    writeAppSetting(database, 'PRESET_COMPAT_LIBRARY_V1', JSON.stringify(['wrong-shape']))
    expect(loadStoredPresetCompatLibrary()).toEqual(createDefaultPresetCompatLibrary())

    writeAppSetting(database, 'PRESET_COMPAT_LIBRARY_V1', JSON.stringify({
      revision: 4,
      presets: {},
      standaloneRegexes: {},
      surfaceBindings: {},
      builtinSystemPrompts: {
        rewrite: {
          surfaceId: 'rewrite',
          enabled: false,
          content: 'Stored rewrite built-in.',
        },
      },
      lastImportedAt: null,
      lastExportedAt: null,
    }))
    const partialReload = loadStoredPresetCompatLibrary()
    expect(partialReload.builtinSystemPrompts.rewrite).toMatchObject({
      surfaceId: 'rewrite',
      enabled: false,
      content: 'Stored rewrite built-in.',
    })
    expect(partialReload.builtinSystemPrompts.future_jump).toMatchObject({
      surfaceId: 'future_jump',
      enabled: true,
    })
    expect(partialReload.builtinSystemPrompts.future_jump.content).toContain('Future Jump 目标节点改写生成器')

    writeAppSetting(database, 'PRESET_COMPAT_LIBRARY_V1', JSON.stringify({
      revision: 5,
      presets: {},
      standaloneRegexes: {},
      surfaceBindings: {},
      builtinSystemPrompts: {
        rewrite: {
          surfaceId: 'future_jump',
          enabled: 'yes',
          content: 42,
        },
        future_jump: {
          surfaceId: 'rewrite',
          enabled: false,
          content: 'Stored future jump built-in.',
        },
      },
      lastImportedAt: null,
      lastExportedAt: null,
    }))
    const malformedReload = loadStoredPresetCompatLibrary()
    expect(malformedReload.builtinSystemPrompts.rewrite).toEqual(createDefaultPresetCompatLibrary().builtinSystemPrompts.rewrite)
    expect(malformedReload.builtinSystemPrompts.future_jump).toEqual({
      surfaceId: 'future_jump',
      enabled: false,
      content: 'Stored future jump built-in.',
    })
  })

  it('stores under PRESET_COMPAT_LIBRARY_V1, keeps AI settings isolated, and bumps revision on every write', async () => {
    const database = await createTestDatabase('retale-preset-compat-library-key-isolation')
    deleteAppSetting(database, 'PRESET_COMPAT_LIBRARY_V1')
    writeAppSetting(database, 'AI_SETTINGS_V2', JSON.stringify({ rewriteProvider: 'ollama' }))
    vi.resetModules()

    const {
      bumpPresetCompatLibraryRevision,
      loadStoredPresetCompatLibrary,
      saveStoredPresetCompatLibrary,
    } = await import('@/lib/server/preset-compat-library')

    const initial = createDefaultPresetCompatLibrary()
    expect(loadStoredPresetCompatLibrary()).toEqual(initial)
    expect(bumpPresetCompatLibraryRevision(initial).revision).toBe(1)

    const firstSaved = await saveStoredPresetCompatLibrary(initial)
    expect(firstSaved.revision).toBe(1)
    expect(readAppSetting(database, 'AI_SETTINGS_V2')?.value).toBe(JSON.stringify({ rewriteProvider: 'ollama' }))

    const storedLibraryRow = readAppSetting(database, 'PRESET_COMPAT_LIBRARY_V1')
    expect(storedLibraryRow?.key).toBe('PRESET_COMPAT_LIBRARY_V1')
    expect(storedLibraryRow?.value).toBe(JSON.stringify(firstSaved))

    const secondSaved = await saveStoredPresetCompatLibrary(firstSaved)
    expect(secondSaved.revision).toBe(2)
    expect(loadStoredPresetCompatLibrary().revision).toBe(2)
  })

  it('persists a full library blob that remains parseable after raw app-setting reloads', async () => {
    const database = await createTestDatabase('retale-preset-compat-library-parseable-blob')
    deleteAppSetting(database, 'PRESET_COMPAT_LIBRARY_V1')
    vi.resetModules()

    const {
      loadStoredPresetCompatLibrary,
      saveStoredPresetCompatLibrary,
    } = await import('@/lib/server/preset-compat-library')

    const library = createDefaultPresetCompatLibrary()
    library.lastImportedAt = '2026-05-18T00:00:00.000Z'
    library.lastExportedAt = '2026-05-18T00:00:01.000Z'
    library.presets['raw-blob-preset'] = {
      id: 'raw-blob-preset',
      name: 'Raw Blob Preset',
      sourceApiId: 'openai',
      promptRules: [
        {
          id: 'raw-blob-rule',
          name: 'Raw Blob Rule',
          role: 'system',
          content: 'Persist me as full-library JSON.',
          enabled: true,
          marker: false,
          injectAsSystemPrompt: true,
          injectionPosition: 'before',
          injectionDepth: null,
          injectionOrder: 100,
          injectionTrigger: ['rewrite'],
          forbidOverrides: false,
          condition: null,
          passthrough: {},
        },
      ],
      promptOrderLists: {
        rewrite: ['raw-blob-rule'],
        future_jump: ['raw-blob-rule'],
        roleplay: ['raw-blob-rule'],
      },
      embeddedRegexes: [],
      attachedStandaloneRegexIds: [],
      runtimeSampler: {
        temperature: 1,
        topP: 1,
        topK: 0,
        topA: null,
        minP: null,
        presencePenalty: null,
        frequencyPenalty: null,
        repetitionPenalty: null,
        openaiMaxContext: 200000,
        maxTokens: 8000,
        seed: 999,
        candidateCount: 1,
      },
      promptTemplate: {
        namesBehavior: 0,
        sendIfEmpty: '',
        impersonationPrompt: '',
        newChatPrompt: '',
        newGroupChatPrompt: '',
        newExampleChatPrompt: '',
        continueNudgePrompt: '',
        wiFormat: '',
        scenarioFormat: '',
        personalityFormat: '',
        groupNudgePrompt: '',
        assistantPrefill: '',
        assistantImpersonation: '',
        continuePostfix: ' ',
        legacyMainPrompt: 'legacy root prompt',
        legacyNsfwPrompt: null,
        legacyJailbreakPrompt: null,
      },
      transport: {
        maxContextUnlocked: true,
        streamOpenAI: true,
        useSysprompt: true,
        squashSystemMessages: false,
        mediaInlining: false,
        inlineImageQuality: 'low',
        continuePrefill: false,
        functionCalling: false,
        showThoughts: true,
        reasoningEffort: 'medium',
        verbosity: 'auto',
        enableWebSearch: false,
        requestImages: false,
        requestImageAspectRatio: '',
        requestImageResolution: '',
      },
      preservedFields: {
        biasPresetSelected: 'Default (none)',
      },
      passthrough: {
        root: {
          main_prompt: 'legacy root prompt',
        },
        extensions: {
          instruct: {
            template: 'template body',
          },
        },
        unknownPromptFields: {},
        legacyFlatPrompts: {
          main: 'main_prompt',
        },
      },
      importWarnings: [],
      createdAt: '2026-05-18T00:00:00.000Z',
      updatedAt: '2026-05-18T00:00:01.000Z',
    }

    const saved = await saveStoredPresetCompatLibrary(library)
    const storedRow = readAppSetting(database, 'PRESET_COMPAT_LIBRARY_V1')

    expect(storedRow?.value).toBe(JSON.stringify(saved))
    expect(JSON.parse(storedRow?.value ?? 'null')).toEqual(saved)
    expect(loadStoredPresetCompatLibrary()).toEqual(saved)
    expect(loadStoredPresetCompatLibrary().presets['raw-blob-preset']).toMatchObject({
      id: 'raw-blob-preset',
      promptTemplate: {
        legacyMainPrompt: 'legacy root prompt',
      },
      passthrough: {
        root: {
          main_prompt: 'legacy root prompt',
        },
      },
    })
  })

  it('round-trips preserved passthrough payloads unchanged after json persistence', async () => {
    const database = await createTestDatabase('retale-preset-compat-library-passthrough')
    deleteAppSetting(database, 'PRESET_COMPAT_LIBRARY_V1')
    vi.resetModules()
    const {
      loadStoredPresetCompatLibrary,
      saveStoredPresetCompatLibrary,
    } = await import('@/lib/server/preset-compat-library')

    const library = createDefaultPresetCompatLibrary()
    const passthroughPayload = {
      extensions: {
        regex_scripts: [
          {
            id: '51b3f4a5-ee72-4980-abda-8d8fb67479be',
            scriptName: '【云瑾】包裹最新指示',
            findRegex: '^([\\s\\S]*)$',
            replaceString: '<最新互动>\\n$1\\n</最新互动>',
            trimStrings: [],
            placement: [1],
            disabled: false,
            markdownOnly: false,
            promptOnly: true,
            runOnEdit: true,
            substituteRegex: 0,
            minDepth: null,
            maxDepth: 1,
          },
          {
            id: 'd0939a86-4170-44d8-8968-b6148a5c2ed6',
            scriptName: '【云瑾】移除额外tag_1.5',
            findRegex: '/^[\\s\\S]*?<\\/thinking>/g',
            replaceString: '',
            trimStrings: ['<正文>', '</正文>'],
            placement: [2, 3],
            disabled: false,
            markdownOnly: false,
            promptOnly: false,
            runOnEdit: false,
            substituteRegex: 0,
            minDepth: null,
            maxDepth: 2,
          },
        ],
      },
      nested: {
        labels: ['alpha', 'beta'],
        metadata: {
          untouched: true,
        },
      },
    }

    library.presets['preset-001'] = {
      id: 'preset-001',
      name: 'Imported preset',
      sourceApiId: 'openai',
      promptRules: [
        {
          id: 'rule-001',
          name: 'Imported rule',
          role: 'assistant',
          content: 'Preserve imported metadata.',
          enabled: true,
          marker: false,
          injectAsSystemPrompt: false,
          injectionPosition: 'none',
          injectionDepth: null,
          injectionOrder: null,
          injectionTrigger: [],
          forbidOverrides: false,
          condition: null,
          passthrough: {
            sourcePrompt: passthroughPayload,
          },
        },
      ],
      promptOrderLists: {
        rewrite: ['rule-001'],
      },
      embeddedRegexes: [
        {
          id: 'regex-001',
          name: 'Imported regex',
          pattern: 'foo',
          replacement: 'bar',
          flags: 'g',
          disabled: false,
          placements: ['assistant_output'],
          trimStrings: [],
          promptOnly: false,
          markdownOnly: false,
          minDepth: null,
          maxDepth: null,
          substituteRegex: null,
          runOnEdit: true,
          passthrough: {
            regexSource: passthroughPayload,
          },
        },
      ],
      attachedStandaloneRegexIds: ['standalone-001'],
      runtimeSampler: {
        temperature: 0.8,
        topP: 0.95,
        topK: null,
        topA: 0.42,
        minP: null,
        presencePenalty: null,
        frequencyPenalty: null,
        repetitionPenalty: null,
        openaiMaxContext: 65536,
        maxTokens: 2048,
        seed: 777,
        candidateCount: 3,
      },
      promptTemplate: {
        namesBehavior: 1,
        sendIfEmpty: 'reuse last',
        impersonationPrompt: 'impersonate',
        newChatPrompt: 'start fresh',
        newGroupChatPrompt: 'start group',
        newExampleChatPrompt: 'start example',
        continueNudgePrompt: 'continue here',
        wiFormat: '<wi>{{text}}</wi>',
        scenarioFormat: '<scenario>{{text}}</scenario>',
        personalityFormat: '<persona>{{text}}</persona>',
        groupNudgePrompt: 'group nudge',
        assistantPrefill: 'prefill',
        assistantImpersonation: 'assistant mode',
        continuePostfix: '...',
        legacyMainPrompt: 'legacy main',
        legacyNsfwPrompt: 'legacy nsfw',
        legacyJailbreakPrompt: 'legacy jailbreak',
      },
      transport: {
        maxContextUnlocked: true,
        streamOpenAI: false,
        useSysprompt: true,
        squashSystemMessages: false,
        mediaInlining: true,
        inlineImageQuality: 'high',
        continuePrefill: true,
        functionCalling: true,
        showThoughts: false,
        reasoningEffort: 'medium',
        verbosity: 'low',
        enableWebSearch: false,
        requestImages: true,
        requestImageAspectRatio: '1:1',
        requestImageResolution: '1024x1024',
      },
      preservedFields: {
        biasPresetSelected: 'Default (none)',
      },
      passthrough: {
        root: {
          presetSource: passthroughPayload,
          main_prompt: 'Legacy main prompt content',
          use_sysprompt: true,
          post_history: 'Keep post_history verbatim',
        },
        extensions: {
          SPreset: {
            RegexBinding: {
              regexes: [{ preserved: true }],
            },
          },
          tavern_helper: {
            helper: 'keep',
          },
        },
        unknownPromptFields: {
          'rule-001': {
            sourcePrompt: passthroughPayload,
          },
        },
        legacyFlatPrompts: {
          main: 'main_prompt',
        },
      },
      importWarnings: [],
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    }

    library.standaloneRegexes['standalone-001'] = {
      id: 'standalone-001',
      name: 'Standalone imported regex',
      pattern: 'baz',
      replacement: 'qux',
      flags: 'g',
      disabled: false,
      placements: ['user_input', 'md_display'],
      trimStrings: [],
      promptOnly: true,
      markdownOnly: true,
      minDepth: 1,
      maxDepth: null,
      substituteRegex: '(?:baz)',
      runOnEdit: false,
      passthrough: {
        standaloneSource: passthroughPayload,
      },
    }

    library.surfaceBindings.rewrite = {
      ...library.surfaceBindings.rewrite,
      presetId: 'preset-001',
    }
    library.lastImportedAt = '2026-05-15T12:34:56.000Z'

    const saved = await saveStoredPresetCompatLibrary(library)
    const reloaded = loadStoredPresetCompatLibrary()

    expect(saved.revision).toBe(1)
    expect(reloaded).toEqual(saved)
    expect(reloaded.presets['preset-001']?.passthrough).toEqual({
      root: {
        presetSource: passthroughPayload,
        main_prompt: 'Legacy main prompt content',
        use_sysprompt: true,
        post_history: 'Keep post_history verbatim',
      },
      extensions: {
        SPreset: {
          RegexBinding: {
            regexes: [{ preserved: true }],
          },
        },
        tavern_helper: {
          helper: 'keep',
        },
      },
      unknownPromptFields: {
        'rule-001': {
          sourcePrompt: passthroughPayload,
        },
      },
      legacyFlatPrompts: {
        main: 'main_prompt',
      },
    })
    expect(reloaded.presets['preset-001']?.runtimeSampler).toMatchObject({
      topA: 0.42,
      openaiMaxContext: 65536,
      seed: 777,
      candidateCount: 3,
    })
    expect(reloaded.presets['preset-001']?.promptTemplate).toMatchObject({
      namesBehavior: 1,
      sendIfEmpty: 'reuse last',
      assistantPrefill: 'prefill',
      legacyMainPrompt: 'legacy main',
      legacyNsfwPrompt: 'legacy nsfw',
      legacyJailbreakPrompt: 'legacy jailbreak',
    })
    expect(reloaded.presets['preset-001']?.transport).toMatchObject({
      maxContextUnlocked: true,
      useSysprompt: true,
      mediaInlining: true,
      requestImages: true,
    })
    expect(reloaded.presets['preset-001']?.preservedFields).toEqual({
      biasPresetSelected: 'Default (none)',
    })
    expect(reloaded.presets['preset-001']?.promptRules[0]?.passthrough).toEqual({
      sourcePrompt: passthroughPayload,
    })
    expect(reloaded.presets['preset-001']?.embeddedRegexes[0]?.passthrough).toEqual({
      regexSource: passthroughPayload,
    })
    expect(reloaded.standaloneRegexes['standalone-001']?.passthrough).toEqual({
      standaloneSource: passthroughPayload,
    })
  })

  it('uses preset-level passthrough normalization only for presets and keeps prompt-rule passthrough plain', async () => {
    const database = await createTestDatabase('retale-preset-compat-library-normalizer-split')
    deleteAppSetting(database, 'PRESET_COMPAT_LIBRARY_V1')
    writeAppSetting(database, 'PRESET_COMPAT_LIBRARY_V1', JSON.stringify({
      revision: 0,
      presets: {
        'preset-split': {
          id: 'preset-split',
          name: 'Split normalization preset',
          sourceApiId: 'openai',
          promptRules: [
            {
              id: 'rule-split',
              name: 'Prompt passthrough stays plain',
              role: 'system',
              content: 'Keep prompt passthrough untouched.',
              enabled: true,
              marker: false,
              injectAsSystemPrompt: true,
              injectionPosition: 'before',
              injectionDepth: null,
              injectionOrder: null,
              injectionTrigger: 'rewrite',
              forbidOverrides: false,
              condition: null,
              passthrough: {
                unknownPromptFields: ['keep-array-shape'],
              },
            },
          ],
          promptOrderLists: {
            rewrite: ['rule-split'],
          },
          embeddedRegexes: [],
          attachedStandaloneRegexIds: [],
          runtimeSampler: {},
          promptTemplate: {},
          transport: {},
          preservedFields: {},
          passthrough: {
            root: ['not-a-record'],
            extensions: 'not-a-record',
            unknownPromptFields: {
              'rule-split': ['drop-invalid-entry'],
            },
            legacyFlatPrompts: {
              main: 'main_prompt',
              broken: 'not_a_legacy_key',
            },
            keepTopLevel: true,
          },
          importWarnings: [],
          createdAt: '2026-05-16T00:00:00.000Z',
          updatedAt: '2026-05-16T00:00:00.000Z',
        },
      },
      standaloneRegexes: {},
      surfaceBindings: {},
      lastImportedAt: null,
      lastExportedAt: null,
    }))
    vi.resetModules()

    const { loadStoredPresetCompatLibrary } = await import('@/lib/server/preset-compat-library')
    const reloaded = loadStoredPresetCompatLibrary()

    expect(reloaded.presets['preset-split']?.passthrough).toEqual({
      root: {},
      extensions: {},
      unknownPromptFields: {},
      legacyFlatPrompts: {
        main: 'main_prompt',
      },
      keepTopLevel: true,
    })
    expect(reloaded.presets['preset-split']?.promptRules[0]?.injectionTrigger).toEqual(['rewrite'])
    expect(reloaded.presets['preset-split']?.promptRules[0]?.passthrough).toEqual({
      unknownPromptFields: ['keep-array-shape'],
    })
  })
})
