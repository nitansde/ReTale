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

function createJsonRequest(url: string, payload: Record<string, unknown>) {
  return new Request(url, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  closeTestDatabase()

  while (cleanups.length) {
    cleanups.pop()?.()
  }
})

describe('preset compat library route', () => {
  it('returns the normalized stored library snapshot on GET', async () => {
    await createTestDatabase('chatbook-preset-compat-route-get')
    const { saveStoredPresetCompatLibrary } = await import('@/lib/server/preset-compat-library')

    const library = createDefaultPresetCompatLibrary()
    library.presets['preset-a'] = {
      id: 'preset-a',
      name: 'Route preset',
      sourceApiId: 'openai',
      promptRules: [],
      promptOrderLists: {},
      embeddedRegexes: [],
      attachedStandaloneRegexIds: [],
      runtimeSampler: {
        temperature: null,
        topP: null,
        topK: null,
        topA: null,
        minP: null,
        presencePenalty: null,
        frequencyPenalty: null,
        repetitionPenalty: null,
        openaiMaxContext: null,
        maxTokens: null,
        seed: null,
        candidateCount: null,
      },
      promptTemplate: {
        namesBehavior: null,
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
        legacyMainPrompt: null,
        legacyNsfwPrompt: null,
        legacyJailbreakPrompt: null,
      },
      transport: {
        maxContextUnlocked: null,
        streamOpenAI: null,
        useSysprompt: null,
        squashSystemMessages: null,
        mediaInlining: null,
        inlineImageQuality: null,
        continuePrefill: null,
        functionCalling: null,
        showThoughts: null,
        reasoningEffort: null,
        verbosity: null,
        enableWebSearch: null,
        requestImages: null,
        requestImageAspectRatio: null,
        requestImageResolution: null,
      },
      preservedFields: {
        biasPresetSelected: null,
      },
      passthrough: {},
      importWarnings: [],
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    }
    const saved = await saveStoredPresetCompatLibrary(library)

    vi.resetModules()
    const { GET } = await import('@/app/api/settings/preset-compat/route')
    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(saved)
  })

  it('saves a normalized library snapshot and bumps revision on POST', async () => {
    await createTestDatabase('chatbook-preset-compat-route-post-save')
    const { GET, POST } = await import('@/app/api/settings/preset-compat/route')
    const current = await (await GET()).json() as ReturnType<typeof createDefaultPresetCompatLibrary>

    const response = await POST(createJsonRequest('http://localhost/api/settings/preset-compat', {
      expectedRevision: current.revision,
      library: {
        revision: 999,
        presets: {
          alpha: {
            id: 'alpha',
            name: 'Imported alpha',
            sourceApiId: 'openai',
            promptRules: [],
            promptOrderLists: {
              rewrite: ['missing-rule'],
            },
            embeddedRegexes: [],
            attachedStandaloneRegexIds: [],
            runtimeSampler: {},
            passthrough: {
              preserved: true,
            },
            importWarnings: ['kept'],
            createdAt: '2026-05-15T00:00:00.000Z',
            updatedAt: '2026-05-15T00:00:00.000Z',
          },
        },
        standaloneRegexes: {},
        surfaceBindings: {
          rewrite: {
            surfaceId: 'rewrite',
            presetId: 'alpha',
            enabled: true,
            failClosed: false,
          },
        },
        lastImportedAt: '2026-05-15T12:00:00.000Z',
      },
    }))

    expect(response.status).toBe(200)
    const payload = await response.json() as { ok: boolean; library: ReturnType<typeof createDefaultPresetCompatLibrary> }
    expect(payload.ok).toBe(true)
    expect(payload.library.revision).toBe(current.revision + 1)
    expect(payload.library.presets.alpha?.passthrough).toEqual({ preserved: true })
    expect(payload.library.surfaceBindings.expand).toBeDefined()
    expect(payload.library.lastImportedAt).toBe('2026-05-15T12:00:00.000Z')
  })

  it('rejects stale optimistic revisions on POST', async () => {
    await createTestDatabase('chatbook-preset-compat-route-post-revision-mismatch')
    const { saveStoredPresetCompatLibrary } = await import('@/lib/server/preset-compat-library')
    await saveStoredPresetCompatLibrary(createDefaultPresetCompatLibrary())

    vi.resetModules()
    const { POST } = await import('@/app/api/settings/preset-compat/route')
    const response = await POST(createJsonRequest('http://localhost/api/settings/preset-compat', {
      expectedRevision: 0,
      library: createDefaultPresetCompatLibrary(),
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'revision_mismatch',
      library: {
        revision: 1,
      },
    })
  })

  it('imports presets, preserves passthrough warnings, and defaults display-name conflicts to copy', async () => {
    await createTestDatabase('chatbook-preset-compat-route-import-preset')
    const { saveStoredPresetCompatLibrary } = await import('@/lib/server/preset-compat-library')

    const library = createDefaultPresetCompatLibrary()
    library.presets['existing-preset'] = {
      id: 'existing-preset',
      name: 'Fixture Preset',
      sourceApiId: 'openai',
      promptRules: [],
      promptOrderLists: {},
      embeddedRegexes: [],
      attachedStandaloneRegexIds: [],
      runtimeSampler: {
        temperature: null,
        topP: null,
        topK: null,
        topA: null,
        minP: null,
        presencePenalty: null,
        frequencyPenalty: null,
        repetitionPenalty: null,
        openaiMaxContext: null,
        maxTokens: null,
        seed: null,
        candidateCount: null,
      },
      promptTemplate: {
        namesBehavior: null,
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
        legacyMainPrompt: null,
        legacyNsfwPrompt: null,
        legacyJailbreakPrompt: null,
      },
      transport: {
        maxContextUnlocked: null,
        streamOpenAI: null,
        useSysprompt: null,
        squashSystemMessages: null,
        mediaInlining: null,
        inlineImageQuality: null,
        continuePrefill: null,
        functionCalling: null,
        showThoughts: null,
        reasoningEffort: null,
        verbosity: null,
        enableWebSearch: null,
        requestImages: null,
        requestImageAspectRatio: null,
        requestImageResolution: null,
      },
      preservedFields: {
        biasPresetSelected: null,
      },
      passthrough: {},
      importWarnings: [],
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    }
    await saveStoredPresetCompatLibrary(library)

    vi.resetModules()
    const { POST } = await import('@/app/api/settings/preset-compat/import/route')
    const response = await POST(createJsonRequest('http://localhost/api/settings/preset-compat/import', {
      kind: 'preset',
      jsonText: JSON.stringify({
        name: 'Fixture Preset',
        prompts: [
          {
            identifier: 'prompt-1',
            name: 'System prompt',
            role: 'system',
            content: 'Use the imported preset.',
          },
        ],
        prompt_order: [
          {
            character_id: 100001,
            order: [
              { identifier: 'prompt-1', enabled: true },
            ],
          },
        ],
        extensions: {
          regex_scripts: [
            {
              scriptName: 'Broken regex',
              replaceString: 'x',
            },
          ],
          SPreset: {
            RegexBinding: {
              regexes: [{ untouched: true }],
            },
          },
        },
      }),
    }))

    expect(response.status).toBe(200)
    const payload = await response.json() as {
      ok: boolean
      importedIds: string[]
      warnings: string[]
      library: ReturnType<typeof createDefaultPresetCompatLibrary>
    }

    expect(payload.ok).toBe(true)
    expect(payload.importedIds).toHaveLength(1)
    const importedPreset = payload.library.presets[payload.importedIds[0] as string]
    expect(importedPreset?.name).toBe('Fixture Preset (copy)')
    expect(importedPreset?.passthrough.extensions).toMatchObject({
      SPreset: {
        RegexBinding: {
          regexes: [{ untouched: true }],
        },
      },
    })
    expect(payload.warnings).toEqual([
      'Preset embedded regex: Regex entry 1 was missing findRegex or replaceString and was skipped.',
    ])
  })

  it('rejects malformed import json text and invalid import kinds with 400 responses', async () => {
    await createTestDatabase('chatbook-preset-compat-route-import-errors')
    const { POST } = await import('@/app/api/settings/preset-compat/import/route')

    const malformedResponse = await POST(createJsonRequest('http://localhost/api/settings/preset-compat/import', {
      kind: 'preset',
      jsonText: '{not valid json',
    }))
    expect(malformedResponse.status).toBe(400)
    await expect(malformedResponse.json()).resolves.toEqual({ ok: false, error: 'invalid_json_text' })

    const invalidKindResponse = await POST(createJsonRequest('http://localhost/api/settings/preset-compat/import', {
      kind: 'unknown',
      jsonText: '{}',
    }))
    expect(invalidKindResponse.status).toBe(400)
    await expect(invalidKindResponse.json()).resolves.toEqual({ ok: false, error: 'invalid_import_kind' })
  })

  it('imports standalone regex payloads and supports replace only for resolvable ids', async () => {
    await createTestDatabase('chatbook-preset-compat-route-import-regex')
    const { saveStoredPresetCompatLibrary } = await import('@/lib/server/preset-compat-library')

    const library = createDefaultPresetCompatLibrary()
    library.standaloneRegexes['11111111-1111-4111-8111-111111111111'] = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Existing regex',
      pattern: 'old',
      replacement: 'value',
      flags: '',
      disabled: false,
      placements: ['assistant_output'],
      trimStrings: [],
      promptOnly: false,
      markdownOnly: false,
      minDepth: null,
      maxDepth: null,
      substituteRegex: null,
      runOnEdit: false,
      passthrough: {},
    }
    await saveStoredPresetCompatLibrary(library)

    vi.resetModules()
    const { POST } = await import('@/app/api/settings/preset-compat/import/route')

    const copyResponse = await POST(createJsonRequest('http://localhost/api/settings/preset-compat/import', {
      kind: 'regex',
      jsonText: JSON.stringify({
        regex_scripts: [
          {
            scriptName: 'Existing regex',
            findRegex: 'foo',
            replaceString: 'bar',
            placement: [2],
          },
        ],
      }),
    }))
    expect(copyResponse.status).toBe(200)
    const copyPayload = await copyResponse.json() as {
      importedIds: string[]
      library: ReturnType<typeof createDefaultPresetCompatLibrary>
    }
    expect(copyPayload.importedIds).toHaveLength(1)
    expect(copyPayload.library.standaloneRegexes[copyPayload.importedIds[0] as string]?.name).toBe('Existing regex (copy)')

    const copyWithExistingId = await POST(createJsonRequest('http://localhost/api/settings/preset-compat/import', {
      kind: 'regex',
      jsonText: JSON.stringify({
        regex_scripts: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            scriptName: 'Existing regex with id',
            findRegex: 'copied-pattern',
            replaceString: 'copied-value',
            placement: [2],
          },
        ],
      }),
    }))
    expect(copyWithExistingId.status).toBe(200)
    const copyWithExistingIdPayload = await copyWithExistingId.json() as {
      importedIds: string[]
      library: ReturnType<typeof createDefaultPresetCompatLibrary>
    }
    expect(copyWithExistingIdPayload.importedIds).toHaveLength(1)
    expect(copyWithExistingIdPayload.importedIds).not.toEqual(['11111111-1111-4111-8111-111111111111'])
    expect(copyWithExistingIdPayload.library.standaloneRegexes['11111111-1111-4111-8111-111111111111']).toMatchObject({
      pattern: 'old',
      replacement: 'value',
    })

    const replaceFailure = await POST(createJsonRequest('http://localhost/api/settings/preset-compat/import', {
      kind: 'regex',
      conflictPolicy: 'replace',
      jsonText: JSON.stringify({
        regex_scripts: [
          {
            scriptName: 'Unresolved regex',
            findRegex: 'x',
            replaceString: 'y',
          },
        ],
      }),
    }))
    expect(replaceFailure.status).toBe(400)
    await expect(replaceFailure.json()).resolves.toEqual({ ok: false, error: 'replace_requires_resolvable_id' })

    const replaceSuccess = await POST(createJsonRequest('http://localhost/api/settings/preset-compat/import', {
      kind: 'regex',
      conflictPolicy: 'replace',
      jsonText: JSON.stringify({
        regex_scripts: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            scriptName: 'Existing regex',
            findRegex: 'new-pattern',
            replaceString: 'new-value',
            placement: [1],
          },
        ],
      }),
    }))
    expect(replaceSuccess.status).toBe(200)
    const replacePayload = await replaceSuccess.json() as {
      importedIds: string[]
      warnings: string[]
      library: ReturnType<typeof createDefaultPresetCompatLibrary>
    }
    expect(replacePayload.importedIds).toEqual(['11111111-1111-4111-8111-111111111111'])
    expect(replacePayload.warnings).toEqual([])
    expect(replacePayload.library.standaloneRegexes['11111111-1111-4111-8111-111111111111']).toMatchObject({
      pattern: 'new-pattern',
      replacement: 'new-value',
      placements: ['user_input'],
    })
  })
})
