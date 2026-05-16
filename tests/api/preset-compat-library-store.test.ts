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
    const database = await createTestDatabase('chatbook-preset-compat-library-defaults')
    deleteAppSetting(database, 'PRESET_COMPAT_LIBRARY_V1')
    vi.resetModules()
    const { loadStoredPresetCompatLibrary } = await import('@/lib/server/preset-compat-library')

    expect(loadStoredPresetCompatLibrary()).toEqual(createDefaultPresetCompatLibrary())

    writeAppSetting(database, 'PRESET_COMPAT_LIBRARY_V1', '{not valid json')
    expect(loadStoredPresetCompatLibrary()).toEqual(createDefaultPresetCompatLibrary())

    writeAppSetting(database, 'PRESET_COMPAT_LIBRARY_V1', JSON.stringify(['wrong-shape']))
    expect(loadStoredPresetCompatLibrary()).toEqual(createDefaultPresetCompatLibrary())
  })

  it('stores under PRESET_COMPAT_LIBRARY_V1, keeps AI settings isolated, and bumps revision on every write', async () => {
    const database = await createTestDatabase('chatbook-preset-compat-library-key-isolation')
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

  it('round-trips preserved passthrough payloads unchanged after json persistence', async () => {
    const database = await createTestDatabase('chatbook-preset-compat-library-passthrough')
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
          injectionTrigger: null,
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
        minP: null,
        presencePenalty: null,
        frequencyPenalty: null,
        repetitionPenalty: null,
        maxTokens: 2048,
      },
      passthrough: {
        presetSource: passthroughPayload,
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
      presetSource: passthroughPayload,
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
})
