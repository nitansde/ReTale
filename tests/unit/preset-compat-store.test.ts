import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import type {
  PresetCompatLibrary,
  PresetCompatPresetRecord,
  PresetCompatRegexRecord,
} from '@/lib/preset-compat/types'
import { useNovelStore } from '@/store/novel-store'

function createPreset(id: string, overrides: Partial<PresetCompatPresetRecord> = {}): PresetCompatPresetRecord {
  return {
    id,
    name: `Preset ${id}`,
    sourceApiId: 'openai',
    promptRules: [
      {
        id: `${id}-prompt-1`,
        name: 'Prompt 1',
        role: 'system',
        content: 'Stay consistent.',
        enabled: true,
        marker: false,
        injectAsSystemPrompt: true,
        injectionPosition: 'before',
        injectionDepth: null,
        injectionOrder: 0,
        injectionTrigger: [],
        forbidOverrides: false,
        condition: null,
        passthrough: {},
      },
    ],
    promptOrderLists: {
      rewrite: [`${id}-prompt-1`],
    },
    embeddedRegexes: [],
    attachedStandaloneRegexIds: [],
    runtimeSampler: {
      temperature: 1,
      topP: 1,
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
    passthrough: {
      root: {},
      extensions: {},
      unknownPromptFields: {},
    },
    importWarnings: [],
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
    ...overrides,
  }
}

function createRegex(id: string, overrides: Partial<PresetCompatRegexRecord> = {}): PresetCompatRegexRecord {
  return {
    id,
    name: `Regex ${id}`,
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
    runOnEdit: false,
    passthrough: {},
    ...overrides,
  }
}

function createLibrary(overrides: Partial<PresetCompatLibrary> = {}): PresetCompatLibrary {
  const library = createDefaultPresetCompatLibrary()
  return {
    ...library,
    presets: {
      'preset-1': createPreset('preset-1'),
    },
    standaloneRegexes: {
      'regex-1': createRegex('regex-1'),
    },
    ...overrides,
  }
}

function resetStore() {
  useNovelStore.getState().resetWorkspace()
  useNovelStore.setState({
    isHydrated: false,
    isSaving: false,
    backendLoaded: false,
    backendLoadError: '',
    presetCompatLibrary: createDefaultPresetCompatLibrary(),
    presetCompatLibraryLoading: false,
    presetCompatLibraryError: '',
  })
}

describe('preset compat store lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hydrates the global library during backend load and keeps workspace export/import isolated', async () => {
    const workspacePayload = {
      currentNovelId: 'novel-1',
      currentChapterId: 'chapter-1',
      localNovels: [{ id: 'novel-1', title: 'Novel', summary: 'Summary', tags: [] }],
      localVolumes: [{ id: 'volume-1', novelId: 'novel-1', title: 'Volume', order: 1 }],
      localChapters: [{
        id: 'chapter-1',
        novelId: 'novel-1',
        volumeId: 'volume-1',
        title: 'Chapter 1',
        order: 1,
        content: '<p>Body</p>',
        originalContent: '<p>Body</p>',
        status: 'draft',
        wordCount: 1,
        updatedAt: 'now',
        trajectory: [],
      }],
    }
    const presetCompatLibrary = createLibrary({ revision: 3 })

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/workspace') {
        return new Response(JSON.stringify(workspacePayload), { status: 200 })
      }
      if (url === '/api/settings/ai') {
        return new Response(JSON.stringify({ provider: 'openai-compatible', model: 'gpt-4.1-mini' }), { status: 200 })
      }
      if (url === '/api/settings/preset-compat') {
        return new Response(JSON.stringify(presetCompatLibrary), { status: 200 })
      }
      if (url === '/api/knowledge-view?novelId=novel-1&asOfChapter=1') {
        return new Response(JSON.stringify({
          ok: true,
          localOutlines: [],
          localCharacters: [],
          localCharacterRelations: [],
          localWorldEntries: [],
          localTimelineEvents: [],
          knowledgeRebuildStatus: null,
          jobOutcome: null,
        }), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await useNovelStore.getState().loadFromBackend()

    const state = useNovelStore.getState()
    expect(state.presetCompatLibrary.revision).toBe(3)
    expect(state.presetCompatLibraryLoading).toBe(false)
    expect(state.presetCompatLibraryError).toBe('')

    const exportedWorkspace = JSON.parse(state.exportWorkspace()) as Record<string, unknown>
    expect(exportedWorkspace).not.toHaveProperty('presetCompatLibrary')
    expect(exportedWorkspace).not.toHaveProperty('presetCompatLibraryLoading')
    expect(exportedWorkspace).not.toHaveProperty('presetCompatLibraryError')

    state.importWorkspace({ currentNovelId: 'novel-2' })
    expect(useNovelStore.getState().presetCompatLibrary.revision).toBe(3)
  })

  it('fails open when the initial workspace restore request stalls', async () => {
    vi.useFakeTimers()

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url !== '/api/workspace') {
        throw new Error(`Unexpected fetch: ${url}`)
      }

      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('Aborted')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    }))

    const restore = useNovelStore.getState().loadFromBackend()
    await vi.advanceTimersByTimeAsync(15_000)
    await restore

    const state = useNovelStore.getState()
    expect(state.backendLoaded).toBe(true)
    expect(state.isHydrated).toBe(true)
    expect(state.presetCompatLibraryLoading).toBe(false)
    expect(state.backendLoadError).toBe('Workspace restore timed out')
  })

  it('loads, saves, imports, binds, edits, and exports through the dedicated preset compat slice', async () => {
    const savedLibrary = createLibrary({
      revision: 3,
      presets: {
        'preset-1': createPreset('preset-1', {
          embeddedRegexes: [createRegex('embedded-1')],
        }),
      },
      standaloneRegexes: {
        'regex-1': createRegex('regex-1'),
        'regex-2': createRegex('regex-2', { name: 'Regex 2' }),
      },
    })
    const importedLibrary = createLibrary({
      revision: 4,
      presets: {
        ...savedLibrary.presets,
        'preset-2': createPreset('preset-2', { name: 'Imported preset' }),
      },
      standaloneRegexes: {
        ...savedLibrary.standaloneRegexes,
        'regex-3': createRegex('regex-3', { name: 'Imported regex' }),
      },
    })

    useNovelStore.setState({
      presetCompatLibrary: createLibrary({ revision: 2 }),
    })

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/settings/preset-compat' && !init?.method) {
        return new Response(JSON.stringify(savedLibrary), { status: 200 })
      }
      if (url === '/api/settings/preset-compat' && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true, library: savedLibrary }), { status: 200 })
      }
      if (url === '/api/settings/preset-compat/import') {
        const body = JSON.parse(String(init?.body)) as { kind: 'preset' | 'regex' }
        if (body.kind === 'preset') {
          return new Response(JSON.stringify({ ok: true, library: importedLibrary, importedIds: ['preset-2'], warnings: ['preset warning'] }), { status: 200 })
        }
        return new Response(JSON.stringify({ ok: true, library: importedLibrary, importedIds: ['regex-3'], warnings: ['regex warning'] }), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await useNovelStore.getState().loadPresetCompatLibrary()
    expect(useNovelStore.getState().presetCompatLibrary.revision).toBe(3)

    await useNovelStore.getState().savePresetCompatLibrary()
    expect(useNovelStore.getState().presetCompatLibrary.revision).toBe(3)

    await expect(useNovelStore.getState().importPresetCompatPreset({ jsonText: '{"name":"preset"}' })).resolves.toEqual({
      importedIds: ['preset-2'],
      warnings: ['preset warning'],
    })
    await expect(useNovelStore.getState().importPresetCompatRegexBundle({ jsonText: '[]' })).resolves.toEqual({
      importedIds: ['regex-3'],
      warnings: ['regex warning'],
    })

    useNovelStore.getState().bindPresetCompatPresetToSurface('rewrite', 'preset-2')
    useNovelStore.getState().attachPresetCompatStandaloneRegex('preset-2', 'regex-3')
    useNovelStore.getState().updatePresetCompatPromptRule('preset-2', 'preset-2-prompt-1', { content: 'Updated prompt' })
    useNovelStore.getState().updatePresetCompatRuntimeSampler('preset-2', {
      openaiMaxContext: 32768,
      maxTokens: 4096,
      temperature: 0.45,
      frequencyPenalty: 0.25,
      presencePenalty: 0.15,
      topP: 0.8,
    })
    useNovelStore.getState().updatePresetCompatTransport('preset-2', { streamOpenAI: true })
    useNovelStore.getState().updatePresetCompatBuiltinSystemPrompt('rewrite', {
      enabled: false,
      content: 'Edited ChatBook built-in prompt',
    })
    useNovelStore.getState().updatePresetCompatStandaloneRegex('regex-3', { replacement: 'updated replacement' })
    useNovelStore.getState().detachPresetCompatStandaloneRegex('preset-2', 'regex-3')

    const state = useNovelStore.getState()
    expect(state.presetCompatLibrary.surfaceBindings.rewrite.presetId).toBe('preset-2')
    expect(state.presetCompatLibrary.presets['preset-2']?.promptRules[0]?.content).toBe('Updated prompt')
    expect(state.presetCompatLibrary.presets['preset-2']?.runtimeSampler.openaiMaxContext).toBe(32768)
    expect(state.presetCompatLibrary.presets['preset-2']?.runtimeSampler.maxTokens).toBe(4096)
    expect(state.presetCompatLibrary.presets['preset-2']?.runtimeSampler.temperature).toBe(0.45)
    expect(state.presetCompatLibrary.presets['preset-2']?.runtimeSampler.frequencyPenalty).toBe(0.25)
    expect(state.presetCompatLibrary.presets['preset-2']?.runtimeSampler.presencePenalty).toBe(0.15)
    expect(state.presetCompatLibrary.presets['preset-2']?.runtimeSampler.topP).toBe(0.8)
    expect(state.presetCompatLibrary.presets['preset-2']?.transport.streamOpenAI).toBe(true)
    expect(state.presetCompatLibrary.builtinSystemPrompts.rewrite).toMatchObject({
      enabled: false,
      content: 'Edited ChatBook built-in prompt',
    })
    expect(state.presetCompatLibrary.presets['preset-2']?.attachedStandaloneRegexIds).toEqual([])
    expect(state.presetCompatLibrary.standaloneRegexes['regex-3']?.replacement).toBe('updated replacement')

    const exportedPreset = state.exportPresetCompatPreset('preset-2')
    const exportedRegexBundle = state.exportPresetCompatStandaloneRegexBundle(['regex-3'])
    expect(exportedPreset).toContain('Updated prompt')
    expect(exportedPreset).toContain('32768')
    expect(exportedPreset).toContain('4096')
    expect(exportedPreset).toContain('0.45')
    expect(exportedPreset).toContain('0.8')
    expect(exportedPreset).toContain('true')
    expect(exportedPreset).not.toContain('Edited ChatBook built-in prompt')
    expect(exportedRegexBundle).toContain('regex_scripts')
  })

  it('keeps workspace autosave isolated from the global preset-compatible library payload', async () => {
    const initialLibrary = createLibrary({ revision: 5 })
    const requestBodies: Array<{ url: string; body: unknown }> = []

    useNovelStore.setState({
      presetCompatLibrary: initialLibrary,
    })

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/workspace' && init?.method === 'POST') {
        requestBodies.push({
          url,
          body: JSON.parse(String(init.body)),
        })
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      if (url === '/api/knowledge-view') {
        return new Response(JSON.stringify({
          ok: true,
          localOutlines: [],
          localCharacters: [],
          localCharacterRelations: [],
          localWorldEntries: [],
          localTimelineEvents: [],
          knowledgeRebuildStatus: null,
          jobOutcome: null,
        }), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await useNovelStore.getState().saveToBackend()

    expect(requestBodies).toHaveLength(1)
    expect(requestBodies[0]?.url).toBe('/api/workspace')
    expect(requestBodies[0]?.body).not.toHaveProperty('presetCompatLibrary')
    expect(useNovelStore.getState().presetCompatLibrary.revision).toBe(5)
  })

  it('retains the last good library when load, save, or import fails and records explicit errors', async () => {
    useNovelStore.setState({
      presetCompatLibrary: createLibrary({ revision: 7 }),
    })

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/settings/preset-compat' && !init?.method) {
        return new Response(JSON.stringify({ ok: false, error: 'load_failed' }), { status: 500 })
      }
      if (url === '/api/settings/preset-compat' && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: false, error: 'revision_mismatch' }), { status: 409 })
      }
      if (url === '/api/settings/preset-compat/import') {
        return new Response(JSON.stringify({ ok: false, error: 'invalid_import_kind' }), { status: 400 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }))

    await expect(useNovelStore.getState().loadPresetCompatLibrary()).rejects.toThrow('load_failed')
    expect(useNovelStore.getState().presetCompatLibrary.revision).toBe(7)
    expect(useNovelStore.getState().presetCompatLibraryError).toBe('load_failed')

    await expect(useNovelStore.getState().savePresetCompatLibrary()).rejects.toThrow('revision_mismatch')
    expect(useNovelStore.getState().presetCompatLibrary.revision).toBe(7)
    expect(useNovelStore.getState().presetCompatLibraryError).toBe('revision_mismatch')

    await expect(useNovelStore.getState().importPresetCompatPreset({ jsonText: '{}' })).rejects.toThrow('invalid_import_kind')
    expect(useNovelStore.getState().presetCompatLibrary.revision).toBe(7)
    expect(useNovelStore.getState().presetCompatLibraryError).toBe('invalid_import_kind')
    expect(useNovelStore.getState().presetCompatLibraryLoading).toBe(false)
  })
})
