import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import type { PresetCompatLibrary } from '@/lib/preset-compat/types'
import { createTempDatabaseCopy, hashFile } from '@/tests/helpers/temp-db'

const cleanups: Array<() => void> = []
const ENV_PATH = path.join(process.cwd(), '.env')
const originalDataDir = process.env.RETALE_DATA_DIR

function restoreDataDir() {
  if (originalDataDir === undefined) {
    delete process.env.RETALE_DATA_DIR
    return
  }

  process.env.RETALE_DATA_DIR = originalDataDir
}

async function createTestDatabase(prefix: string) {
  const tempDatabase = createTempDatabaseCopy(prefix)
  cleanups.push(tempDatabase.cleanup)
  process.env.RETALE_DATA_DIR = path.join(tempDatabase.directory, 'data')
  vi.resetModules()

  const { getControlDb, getNovelDb } = await import('@/lib/server/db-resolver')
  return {
    controlDb: getControlDb(),
    novelDb: getNovelDb('novel_reset'),
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
  library.novelRewritePresetIds = { novel_reset: 'reset-protected-preset' }
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

function seedNovelSettingDecoys(database: DatabaseSync) {
  const library = createDefaultPresetCompatLibrary()
  library.revision = 99
  writeAppSetting(database, 'PRESET_COMPAT_LIBRARY_V1', JSON.stringify(library))
  writeAppSetting(database, 'AI_SETTINGS_V2', JSON.stringify({ rewriteProvider: 'novel-decoy' }))
  writeAppSetting(database, 'OLLAMA_TIMEOUT_MS', '999999')
  writeAppSetting(database, 'LEGACY_REWRITE_MODE', 'novel-decoy')

  return {
    presetCompatLibraryV1: JSON.stringify(library),
    aiSettingsV2: JSON.stringify({ rewriteProvider: 'novel-decoy' }),
    ollamaTimeoutMs: '999999',
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  const resolver = await import('@/lib/server/db-resolver')
  resolver.resetResolvedDatabasesForTests()
  restoreDataDir()
  vi.resetModules()

  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('protected settings reset utility', () => {
  it('preserves only the protected app-setting blobs across a destructive reset', async () => {
    const { controlDb, novelDb } = await createTestDatabase('retale-protected-settings-reset-success')
    const { resetBusinessDataPreservingProtectedSettings } = await import('@/lib/server/persistence')
    const { loadStoredAISettings } = await import('@/lib/server/ai-settings')
    const { loadStoredPresetCompatLibrary } = await import('@/lib/server/preset-compat-library')
    const { runWithNovelDatabaseAccess } = await import('@/lib/server/database-access')
    const envHashBefore = fs.existsSync(ENV_PATH) ? hashFile(ENV_PATH) : null
    const envMtimeBefore = fs.existsSync(ENV_PATH) ? fs.statSync(ENV_PATH).mtimeMs : null
    const protectedValues = seedProtectedSettings(controlDb)
    const novelDecoys = seedNovelSettingDecoys(novelDb)
    seedBusinessData(novelDb)

    const snapshot = await runWithNovelDatabaseAccess('novel_reset', () => resetBusinessDataPreservingProtectedSettings())

    expect(snapshot).toEqual({
      presetCompatLibraryV1: protectedValues.presetBlob,
      aiSettingsV2: protectedValues.aiSettingsBlob,
      ollamaTimeoutMs: protectedValues.ollamaTimeoutMs,
    })
    expect(novelDb.prepare('SELECT COUNT(*) AS count FROM WorkspaceState').get()).toEqual({ count: 0 })
    expect(novelDb.prepare('SELECT COUNT(*) AS count FROM NovelRecord').get()).toEqual({ count: 0 })
    expect(novelDb.prepare('SELECT COUNT(*) AS count FROM StoryBranch').get()).toEqual({ count: 0 })
    expect(novelDb.prepare('SELECT COUNT(*) AS count FROM KnowledgeChapter').get()).toEqual({ count: 0 })

    const appSettings = controlDb.prepare('SELECT key, value FROM AppSetting ORDER BY key ASC').all()
    expect(appSettings).toEqual([
      { key: 'AI_SETTINGS_V2', value: protectedValues.aiSettingsBlob },
      { key: 'OLLAMA_TIMEOUT_MS', value: protectedValues.ollamaTimeoutMs },
      { key: 'PRESET_COMPAT_LIBRARY_V1', value: protectedValues.presetBlob },
    ])

    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('AI_SETTINGS_V2')).toEqual({
      value: protectedValues.aiSettingsBlob,
    })
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('OLLAMA_TIMEOUT_MS')).toEqual({
      value: protectedValues.ollamaTimeoutMs,
    })
    expect(JSON.parse((controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('PRESET_COMPAT_LIBRARY_V1') as { value: string }).value) as PresetCompatLibrary).toEqual(protectedValues.library)
    expect(novelDb.prepare('SELECT key, value FROM AppSetting ORDER BY key ASC').all()).toEqual([
      { key: 'AI_SETTINGS_V2', value: novelDecoys.aiSettingsV2 },
      { key: 'LEGACY_REWRITE_MODE', value: 'novel-decoy' },
      { key: 'OLLAMA_TIMEOUT_MS', value: novelDecoys.ollamaTimeoutMs },
      { key: 'PRESET_COMPAT_LIBRARY_V1', value: novelDecoys.presetCompatLibraryV1 },
    ])
    expect(runWithNovelDatabaseAccess('novel_reset', () => loadStoredPresetCompatLibrary())).toEqual(protectedValues.library)
    expect(runWithNovelDatabaseAccess('novel_reset', () => loadStoredPresetCompatLibrary()).presets['reset-protected-preset']).toMatchObject({
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
    expect(runWithNovelDatabaseAccess('novel_reset', () => loadStoredAISettings())).toMatchObject({
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
    const { controlDb, novelDb } = await createTestDatabase('retale-protected-settings-reset-invalid-snapshot')
    const { resetBusinessDataPreservingProtectedSettings } = await import('@/lib/server/persistence')
    const { runWithNovelDatabaseAccess } = await import('@/lib/server/database-access')
    seedBusinessData(novelDb)
    const novelDecoys = seedNovelSettingDecoys(novelDb)
    writeAppSetting(controlDb, 'PRESET_COMPAT_LIBRARY_V1', '{invalid json')
    writeAppSetting(controlDb, 'AI_SETTINGS_V2', JSON.stringify({ rewriteProvider: 'ollama' }))
    writeAppSetting(controlDb, 'OLLAMA_TIMEOUT_MS', '45000')
    writeAppSetting(controlDb, 'LEGACY_REWRITE_MODE', 'continue')

    await expect(runWithNovelDatabaseAccess('novel_reset', () => resetBusinessDataPreservingProtectedSettings())).rejects.toThrow(
      'Protected reset snapshot for PRESET_COMPAT_LIBRARY_V1 is invalid'
    )

    expect(novelDb.prepare('SELECT id, payload FROM WorkspaceState WHERE id = ?').get('singleton')).toEqual({
      id: 'singleton',
      payload: JSON.stringify({ currentNovelId: 'novel_reset' }),
    })
    expect(novelDb.prepare('SELECT id FROM NovelRecord WHERE id = ?').get('novel_reset')).toEqual({ id: 'novel_reset' })
    expect(novelDb.prepare('SELECT id FROM StoryBranch WHERE id = ?').get('novel_reset:main')).toEqual({ id: 'novel_reset:main' })
    expect(novelDb.prepare('SELECT id FROM KnowledgeChapter WHERE id = ?').get('chapter_reset_1')).toEqual({ id: 'chapter_reset_1' })
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('PRESET_COMPAT_LIBRARY_V1')).toEqual({ value: '{invalid json' })
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('AI_SETTINGS_V2')).toEqual({ value: JSON.stringify({ rewriteProvider: 'ollama' }) })
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('OLLAMA_TIMEOUT_MS')).toEqual({ value: '45000' })
    expect(controlDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('LEGACY_REWRITE_MODE')).toEqual({ value: 'continue' })
    expect(novelDb.prepare('SELECT value FROM AppSetting WHERE key = ?').get('PRESET_COMPAT_LIBRARY_V1')).toEqual({ value: novelDecoys.presetCompatLibraryV1 })
  })

  it('restores every control setting exactly when the later novel reset transaction fails', async () => {
    const { controlDb, novelDb } = await createTestDatabase('retale-protected-settings-reset-compensation')
    const { resetBusinessDataPreservingProtectedSettings } = await import('@/lib/server/persistence')
    const { runWithNovelDatabaseAccess } = await import('@/lib/server/database-access')
    seedProtectedSettings(controlDb)
    seedNovelSettingDecoys(novelDb)
    seedBusinessData(novelDb)
    controlDb.prepare(
      `UPDATE AppSetting
       SET createdAt = ?, updatedAt = ?
       WHERE key = ?`,
    ).run('2024-01-02 03:04:05', '2025-06-07 08:09:10', 'LEGACY_REWRITE_MODE')
    const controlRowsBefore = controlDb.prepare(
      'SELECT id, key, value, createdAt, updatedAt FROM AppSetting ORDER BY key ASC',
    ).all()
    const novelSettingsBefore = novelDb.prepare(
      'SELECT id, key, value, createdAt, updatedAt FROM AppSetting ORDER BY key ASC',
    ).all()
    const workspaceBefore = novelDb.prepare('SELECT id, payload, createdAt, updatedAt FROM WorkspaceState ORDER BY id').all()
    const novelsBefore = novelDb.prepare('SELECT id, title, sourceType, createdAt, updatedAt FROM NovelRecord ORDER BY id').all()
    const branchesBefore = novelDb.prepare('SELECT id, novelId, name, createdAt, updatedAt FROM StoryBranch ORDER BY id').all()
    const chaptersBefore = novelDb.prepare(
      'SELECT id, novelId, branchId, chapterNo, rawText, sourceHash, createdAt, updatedAt FROM KnowledgeChapter ORDER BY id',
    ).all()
    novelDb.exec(
      `CREATE TRIGGER fail_workspace_reset
       BEFORE DELETE ON WorkspaceState
       BEGIN
         SELECT RAISE(ABORT, 'simulated novel reset failure');
       END;`,
    )

    await expect(runWithNovelDatabaseAccess('novel_reset', () => resetBusinessDataPreservingProtectedSettings()))
      .rejects.toThrow('simulated novel reset failure')

    expect(controlDb.prepare('SELECT id, key, value, createdAt, updatedAt FROM AppSetting ORDER BY key ASC').all()).toEqual(controlRowsBefore)
    expect(novelDb.prepare('SELECT id, key, value, createdAt, updatedAt FROM AppSetting ORDER BY key ASC').all()).toEqual(novelSettingsBefore)
    expect(novelDb.prepare('SELECT id, payload, createdAt, updatedAt FROM WorkspaceState ORDER BY id').all()).toEqual(workspaceBefore)
    expect(novelDb.prepare('SELECT id, title, sourceType, createdAt, updatedAt FROM NovelRecord ORDER BY id').all()).toEqual(novelsBefore)
    expect(novelDb.prepare('SELECT id, novelId, name, createdAt, updatedAt FROM StoryBranch ORDER BY id').all()).toEqual(branchesBefore)
    expect(novelDb.prepare(
      'SELECT id, novelId, branchId, chapterNo, rawText, sourceHash, createdAt, updatedAt FROM KnowledgeChapter ORDER BY id',
    ).all()).toEqual(chaptersBefore)
  })
})
