import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import type { PresetCompatLibrary } from '@/lib/preset-compat/types'
import { createTempDatabaseCopy, hashFile } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const globalForSqlite = globalThis as { sqlite?: DatabaseSync }
const ENV_PATH = path.join(process.cwd(), '.env')

async function createTestDatabase(prefix: string) {
  const tempDatabase = createTempDatabaseCopy(prefix)
  cleanups.push(tempDatabase.cleanup)
  const database = new DatabaseSync(tempDatabase.dbPath)
  globalForSqlite.sqlite = database
  vi.resetModules()
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

function seedBusinessData(database: DatabaseSync) {
  database.prepare('DELETE FROM WorkspaceState WHERE id = ?').run('singleton')
  database.prepare('INSERT INTO WorkspaceState (id, payload) VALUES (?, ?)').run('singleton', JSON.stringify({ currentNovelId: 'novel_reset' }))
  database.prepare('INSERT INTO NovelRecord (id, title, sourceType) VALUES (?, ?, ?)').run('novel_reset', 'Reset Novel', 'txt')
  database.prepare('INSERT INTO StoryBranch (id, novelId, name) VALUES (?, ?, ?)').run('novel_reset:main', 'novel_reset', 'main')
  database.prepare(
    `
      INSERT INTO KnowledgeChapter (
        id, novelId, branchId, chapterNo, title, rawText, summary, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    'chapter_reset_1',
    'novel_reset',
    'novel_reset:main',
    1,
    '第1章',
    '正文',
    null,
    1,
    0,
    null,
    'hash-reset-1',
    'ready'
  )
}

function seedProtectedSettings(database: DatabaseSync) {
  const library = createDefaultPresetCompatLibrary()
  library.revision = 7
  library.lastImportedAt = '2026-05-18T00:00:00.000Z'
  library.lastExportedAt = '2026-05-18T00:00:01.000Z'
  library.presets['reset-protected-preset'] = {
    id: 'reset-protected-preset',
    name: 'Protected reset preset',
    sourceApiId: 'openai',
    promptRules: [
      {
        id: 'reset-rule-1',
        name: 'Reset Rule 1',
        role: 'system',
        content: 'Keep this preset content exactly.',
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
      rewrite: ['reset-rule-1'],
      future_jump: ['reset-rule-1'],
      roleplay: ['reset-rule-1'],
    },
    embeddedRegexes: [],
    attachedStandaloneRegexIds: [],
    runtimeSampler: {
      temperature: 0.75,
      topP: 0.9,
      topK: null,
      topA: null,
      minP: null,
      presencePenalty: null,
      frequencyPenalty: null,
      repetitionPenalty: null,
      openaiMaxContext: 64000,
      maxTokens: 4096,
      seed: 123,
      candidateCount: 2,
    },
    promptTemplate: {
      namesBehavior: 0,
      sendIfEmpty: null,
      impersonationPrompt: null,
      newChatPrompt: null,
      newGroupChatPrompt: null,
      newExampleChatPrompt: null,
      continueNudgePrompt: null,
      wiFormat: null,
      scenarioFormat: null,
      personalityFormat: null,
      groupNudgePrompt: null,
      assistantPrefill: null,
      assistantImpersonation: null,
      continuePostfix: null,
      legacyMainPrompt: 'Legacy main survives reset',
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
      verbosity: 'low',
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
        main_prompt: 'Legacy main survives reset',
      },
      extensions: {
        instruct: {
          template: 'Template preserved after reset',
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
  const presetBlob = JSON.stringify(library)
  const aiSettingsBlob = JSON.stringify({
    rewrite: {
      provider: 'openai-compatible',
      openAICompatible: {
        baseUrl: 'https://example.invalid/v1',
        apiKey: 'secret-token',
        model: 'gpt-test',
      },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'llama3',
      },
    },
  }, null, 2)

  writeAppSetting(database, 'PRESET_COMPAT_LIBRARY_V1', presetBlob)
  writeAppSetting(database, 'AI_SETTINGS_V2', aiSettingsBlob)
  writeAppSetting(database, 'OLLAMA_TIMEOUT_MS', '120000')
  writeAppSetting(database, 'LEGACY_REWRITE_MODE', 'expand')

  return {
    library,
    presetBlob,
    aiSettingsBlob,
    ollamaTimeoutMs: '120000',
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  closeTestDatabase()

  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('protected settings reset utility', () => {
  it('preserves only the protected app-setting blobs across a destructive reset', async () => {
    const database = await createTestDatabase('chatbook-protected-settings-reset-success')
    const { resetBusinessDataPreservingProtectedSettings } = await import('@/lib/server/persistence')
    const { loadStoredAISettings } = await import('@/lib/server/ai-settings')
    const { loadStoredPresetCompatLibrary } = await import('@/lib/server/preset-compat-library')
    const { queryAll, queryOne } = await import('@/lib/server/sqlite')
    const envHashBefore = fs.existsSync(ENV_PATH) ? hashFile(ENV_PATH) : null
    const envMtimeBefore = fs.existsSync(ENV_PATH) ? fs.statSync(ENV_PATH).mtimeMs : null
    const protectedValues = seedProtectedSettings(database)
    seedBusinessData(database)

    const snapshot = await resetBusinessDataPreservingProtectedSettings()

    expect(snapshot).toEqual({
      presetCompatLibraryV1: protectedValues.presetBlob,
      aiSettingsV2: protectedValues.aiSettingsBlob,
      ollamaTimeoutMs: protectedValues.ollamaTimeoutMs,
    })
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM WorkspaceState')).toEqual({ count: 0 })
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM NovelRecord')).toEqual({ count: 0 })
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM StoryBranch')).toEqual({ count: 0 })
    expect(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM KnowledgeChapter')).toEqual({ count: 0 })

    const appSettings = queryAll<{ key: string; value: string }>('SELECT key, value FROM AppSetting ORDER BY key ASC')
    expect(appSettings).toEqual([
      { key: 'AI_SETTINGS_V2', value: protectedValues.aiSettingsBlob },
      { key: 'OLLAMA_TIMEOUT_MS', value: protectedValues.ollamaTimeoutMs },
      { key: 'PRESET_COMPAT_LIBRARY_V1', value: protectedValues.presetBlob },
    ])

    expect(queryOne<{ value: string }>('SELECT value FROM AppSetting WHERE key = ?', 'AI_SETTINGS_V2')).toEqual({
      value: protectedValues.aiSettingsBlob,
    })
    expect(queryOne<{ value: string }>('SELECT value FROM AppSetting WHERE key = ?', 'OLLAMA_TIMEOUT_MS')).toEqual({
      value: protectedValues.ollamaTimeoutMs,
    })
    expect(JSON.parse(queryOne<{ value: string }>('SELECT value FROM AppSetting WHERE key = ?', 'PRESET_COMPAT_LIBRARY_V1')!.value) as PresetCompatLibrary).toEqual(protectedValues.library)
    expect(loadStoredPresetCompatLibrary()).toEqual(protectedValues.library)
    expect(loadStoredPresetCompatLibrary().presets['reset-protected-preset']).toMatchObject({
      id: 'reset-protected-preset',
      promptTemplate: {
        legacyMainPrompt: 'Legacy main survives reset',
      },
      passthrough: {
        root: {
          main_prompt: 'Legacy main survives reset',
        },
      },
    })
    expect(loadStoredAISettings()).toMatchObject({
      rewrite: {
        provider: 'openai-compatible',
        openAICompatible: {
          baseUrl: 'https://example.invalid/v1',
          apiKey: 'secret-token',
          model: 'gpt-test',
        },
      },
    })

    const envHashAfter = fs.existsSync(ENV_PATH) ? hashFile(ENV_PATH) : null
    const envMtimeAfter = fs.existsSync(ENV_PATH) ? fs.statSync(ENV_PATH).mtimeMs : null
    expect(envHashAfter).toBe(envHashBefore)
    expect(envMtimeAfter).toBe(envMtimeBefore)
  })

  it('aborts before destructive cleanup when protected snapshot validation fails', async () => {
    const database = await createTestDatabase('chatbook-protected-settings-reset-invalid-snapshot')
    const { resetBusinessDataPreservingProtectedSettings } = await import('@/lib/server/persistence')
    const { queryOne } = await import('@/lib/server/sqlite')
    seedBusinessData(database)
    writeAppSetting(database, 'PRESET_COMPAT_LIBRARY_V1', '{invalid json')
    writeAppSetting(database, 'AI_SETTINGS_V2', JSON.stringify({ rewriteProvider: 'ollama' }))
    writeAppSetting(database, 'OLLAMA_TIMEOUT_MS', '45000')
    writeAppSetting(database, 'LEGACY_REWRITE_MODE', 'continue')

    await expect(resetBusinessDataPreservingProtectedSettings()).rejects.toThrow(
      'Protected reset snapshot for PRESET_COMPAT_LIBRARY_V1 is invalid'
    )

    expect(queryOne<{ id: string; payload: string }>('SELECT id, payload FROM WorkspaceState WHERE id = ?', 'singleton')).toEqual({
      id: 'singleton',
      payload: JSON.stringify({ currentNovelId: 'novel_reset' }),
    })
    expect(queryOne<{ id: string }>('SELECT id FROM NovelRecord WHERE id = ?', 'novel_reset')).toEqual({ id: 'novel_reset' })
    expect(queryOne<{ id: string }>('SELECT id FROM StoryBranch WHERE id = ?', 'novel_reset:main')).toEqual({ id: 'novel_reset:main' })
    expect(queryOne<{ id: string }>('SELECT id FROM KnowledgeChapter WHERE id = ?', 'chapter_reset_1')).toEqual({ id: 'chapter_reset_1' })
    expect(queryOne<{ value: string }>('SELECT value FROM AppSetting WHERE key = ?', 'PRESET_COMPAT_LIBRARY_V1')).toEqual({ value: '{invalid json' })
    expect(queryOne<{ value: string }>('SELECT value FROM AppSetting WHERE key = ?', 'AI_SETTINGS_V2')).toEqual({ value: JSON.stringify({ rewriteProvider: 'ollama' }) })
    expect(queryOne<{ value: string }>('SELECT value FROM AppSetting WHERE key = ?', 'OLLAMA_TIMEOUT_MS')).toEqual({ value: '45000' })
    expect(queryOne<{ value: string }>('SELECT value FROM AppSetting WHERE key = ?', 'LEGACY_REWRITE_MODE')).toEqual({ value: 'continue' })
  })
})
