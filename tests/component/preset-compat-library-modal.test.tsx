// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PresetCompatLibraryModal } from '@/components/workspace/PresetCompatLibraryModal'
import * as creativeRuntimePreview from '@/lib/preset-compat/creative-runtime-preview'
import { normalizePresetCompatPresetImport, normalizePresetCompatStandaloneRegexImport } from '@/lib/preset-compat/normalize'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import { createPresetCompatSessionStateKey } from '@/lib/workspace-state'
import type {
  PresetCompatLibrary,
  PresetCompatPresetRecord,
  PresetCompatRegexRecord,
} from '@/lib/preset-compat/types'
import type { PresetCompatSessionWorkspaceSelection } from '@/lib/types'
import { useNovelStore } from '@/store/novel-store'

const chapterSelection: PresetCompatSessionWorkspaceSelection = {
  kind: 'chapter',
  chapterId: 'chapter-001',
}

function createPreset(id: string, overrides: Partial<PresetCompatPresetRecord> = {}): PresetCompatPresetRecord {
  return {
    id,
    name: `Preset ${id}`,
    sourceApiId: 'openai',
    promptRules: [
      {
        id: `${id}-rule-1`,
        name: 'Narration rule',
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
      {
        id: `${id}-rule-2`,
        name: 'Marker rule',
        role: 'assistant',
        content: 'Preserve me.',
        enabled: true,
        marker: true,
        injectAsSystemPrompt: false,
        injectionPosition: 'after',
        injectionDepth: 2,
        injectionOrder: 2,
        injectionTrigger: ['manual'],
        forbidOverrides: true,
        condition: null,
        passthrough: {},
      },
    ],
    promptOrderLists: {
      rewrite: [`${id}-rule-1`, `${id}-rule-2`],
      expand: [`${id}-rule-1`],
      roleplay: [`${id}-rule-1`],
      polish: [`${id}-rule-1`],
      continue: [`${id}-rule-1`],
      future_jump_rewrite: [`${id}-rule-1`],
    },
    embeddedRegexes: [
      {
        id: `${id}-embedded-1`,
        name: 'Embedded regex',
        pattern: 'foo',
        replacement: 'bar',
        flags: 'g',
        disabled: false,
        placements: ['assistant_output', 'md_display'],
        trimStrings: [],
        promptOnly: false,
        markdownOnly: true,
        minDepth: 1,
        maxDepth: null,
        substituteRegex: '0',
        runOnEdit: true,
        passthrough: {},
      },
    ],
    attachedStandaloneRegexIds: [],
      runtimeSampler: {
        temperature: 1,
        topP: 1,
        topK: 40,
        topA: 0.1,
        minP: null,
        presencePenalty: null,
        frequencyPenalty: null,
        repetitionPenalty: null,
        openaiMaxContext: 8192,
        maxTokens: null,
        seed: null,
        candidateCount: null,
      },
      promptTemplate: {
        namesBehavior: null,
        sendIfEmpty: null,
        impersonationPrompt: null,
        newChatPrompt: 'NEW CHAT TEMPLATE',
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
      maxContextUnlocked: true,
      streamOpenAI: false,
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
      root: {
        top_a: 0.1,
        show_thoughts: true,
      },
      extensions: {},
      unknownPromptFields: {},
    },
    importWarnings: ['Imported field `show_thoughts` is preserved-only.'],
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
    ...overrides,
  }
}

function createRegex(id: string, overrides: Partial<PresetCompatRegexRecord> = {}): PresetCompatRegexRecord {
  return {
    id,
    name: `Regex ${id}`,
    pattern: 'hello',
    replacement: 'world',
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

function readFixtureText(name: string) {
  const worktreePath = resolve(process.cwd(), 'external', name)
  const fallbackPath = resolve(process.cwd(), 'external', name)
  const fixturePath = existsSync(worktreePath) ? worktreePath : fallbackPath
  return readFileSync(fixturePath, 'utf8')
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

describe('PresetCompatLibraryModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetStore()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  })

  it('renders binding controls first, editable generation settings, preview cards, standalone attachment, and export actions', async () => {
    useNovelStore.setState({
      presetCompatLibrary: createLibrary(),
      presetCompatSessionState: {
        [createPresetCompatSessionStateKey(chapterSelection, 'rewrite')]: {
          surfaceId: 'rewrite',
          phase: 'continue',
          resetPending: false,
        },
        [createPresetCompatSessionStateKey(chapterSelection, 'expand')]: {
          surfaceId: 'expand',
          phase: 'continue',
          resetPending: false,
        },
        [createPresetCompatSessionStateKey(chapterSelection, 'continue')]: {
          surfaceId: 'continue',
          phase: 'continue',
          resetPending: false,
        },
      },
    })

    render(<PresetCompatLibraryModal activeSelection={chapterSelection} activeSurfaceId="rewrite" open onClose={vi.fn()} />)

    expect(screen.getByTestId('preset-compat-library-modal')).toBeInTheDocument()
    expect(screen.getByText('全局预设兼容库')).toBeInTheDocument()
    expect(screen.getByText('预设列表')).toBeInTheDocument()
    expect(screen.getByTestId('preset-compat-binding-rewrite')).toBeInTheDocument()
    expect(screen.getByTestId('preset-compat-binding-future_jump_rewrite')).toBeInTheDocument()
    expect(screen.getByText('当前创作界面：Rewrite')).toBeInTheDocument()
    expect(screen.getByTestId('preset-compat-rule-content-preset-1-rule-1')).toBeInTheDocument()
    expect(screen.queryByTestId('preset-compat-preview-surface-rewrite')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('preset-compat-preview-generate'))
    const rewritePreviewCard = await screen.findByTestId('preset-compat-preview-surface-rewrite')
    expect(rewritePreviewCard).toBeInTheDocument()
    expect(screen.getByTestId('preset-compat-session-state-rewrite')).toHaveTextContent('会话阶段：continue · 正常')
    expect(within(rewritePreviewCard).getByTestId('preset-compat-preview-system-rewrite')).toBeInTheDocument()
    expect(within(rewritePreviewCard).getByTestId('preset-compat-preview-user-rewrite')).toBeInTheDocument()
    expect(screen.queryByText('导入备注')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('preset-compat-session-reset-rewrite'))
    expect(useNovelStore.getState().presetCompatSessionState[createPresetCompatSessionStateKey(chapterSelection, 'rewrite')]).toEqual({
      surfaceId: 'rewrite',
      phase: 'new_chat',
      resetPending: true,
    })
    expect(screen.queryByTestId('preset-compat-session-reset-expand')).not.toBeInTheDocument()
    expect(screen.queryByTestId('preset-compat-session-reset-roleplay')).not.toBeInTheDocument()
    expect(screen.queryByTestId('preset-compat-session-reset-future_jump_bridge')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('preset-compat-preview-generate'))
    expect(await screen.findByTestId('preset-compat-session-state-rewrite')).toHaveTextContent('会话阶段：new_chat · 待重置')
    expect(await screen.findByTestId('preset-compat-session-state-expand')).toHaveTextContent('会话阶段：continue · 正常')
    expect(await screen.findByTestId('preset-compat-session-state-continue')).toHaveTextContent('会话阶段：continue · 正常')

    fireEvent.change(screen.getByTestId('preset-compat-binding-rewrite'), { target: { value: 'preset-1' } })
    expect(useNovelStore.getState().presetCompatLibrary.surfaceBindings.rewrite.presetId).toBe('preset-1')

    fireEvent.change(screen.getByTestId('preset-compat-runtime-openai-max-context'), { target: { value: '16384' } })
    fireEvent.change(screen.getByTestId('preset-compat-runtime-max-tokens'), { target: { value: '2048' } })
    fireEvent.change(screen.getByTestId('preset-compat-runtime-temperature'), { target: { value: '0.55' } })
    fireEvent.change(screen.getByTestId('preset-compat-runtime-frequency-penalty'), { target: { value: '0.2' } })
    fireEvent.change(screen.getByTestId('preset-compat-runtime-presence-penalty'), { target: { value: '0.1' } })
    fireEvent.change(screen.getByTestId('preset-compat-runtime-top-p'), { target: { value: '0.85' } })
    fireEvent.change(screen.getByTestId('preset-compat-transport-stream-openai'), { target: { value: 'true' } })

    expect(useNovelStore.getState().presetCompatLibrary.presets['preset-1']?.runtimeSampler.openaiMaxContext).toBe(16384)
    expect(useNovelStore.getState().presetCompatLibrary.presets['preset-1']?.runtimeSampler.maxTokens).toBe(2048)
    expect(useNovelStore.getState().presetCompatLibrary.presets['preset-1']?.runtimeSampler.temperature).toBe(0.55)
    expect(useNovelStore.getState().presetCompatLibrary.presets['preset-1']?.runtimeSampler.frequencyPenalty).toBe(0.2)
    expect(useNovelStore.getState().presetCompatLibrary.presets['preset-1']?.runtimeSampler.presencePenalty).toBe(0.1)
    expect(useNovelStore.getState().presetCompatLibrary.presets['preset-1']?.runtimeSampler.topP).toBe(0.85)
    expect(useNovelStore.getState().presetCompatLibrary.presets['preset-1']?.transport.streamOpenAI).toBe(true)

    fireEvent.click(screen.getByTestId('preset-compat-rule-toggle-preset-1-rule-1'))
    expect(useNovelStore.getState().presetCompatLibrary.presets['preset-1']?.promptRules[0]?.enabled).toBe(false)

    fireEvent.change(screen.getByTestId('preset-compat-rule-content-preset-1-rule-1'), {
      target: { value: 'Updated narrative instruction.' },
    })
    expect(useNovelStore.getState().presetCompatLibrary.presets['preset-1']?.promptRules[0]?.content).toBe('Updated narrative instruction.')

    const lockedRuleContent = await screen.findByTestId('preset-compat-rule-content-preset-1-rule-2')
    expect(lockedRuleContent).toBeDisabled()
    fireEvent.change(lockedRuleContent, {
      target: { value: 'Attempted locked edit.' },
    })
    expect(useNovelStore.getState().presetCompatLibrary.presets['preset-1']?.promptRules[1]?.content).toBe('Preserve me.')

    fireEvent.click(screen.getByTestId('preset-compat-standalone-regex-attach-regex-1'))
    expect(useNovelStore.getState().presetCompatLibrary.presets['preset-1']?.attachedStandaloneRegexIds).toEqual(['regex-1'])

    fireEvent.click(screen.getByTestId('preset-compat-preset-export-preset-1'))
    await waitFor(() => {
      expect(URL.createObjectURL).toHaveBeenCalled()
    })

    expect(screen.getByText('Preserved-only placements: md_display')).toBeInTheDocument()
    expect(screen.queryByText('Runtime warnings')).not.toBeInTheDocument()
    expect(screen.queryByText('Macro diagnostics')).not.toBeInTheDocument()
    expect(screen.queryByText('`markdownOnly` is preserved for export and not applied in MVP runtime.')).not.toBeInTheDocument()
    expect(screen.queryByText('Depth gates are preserved-only in MVP runtime.')).not.toBeInTheDocument()
    expect(screen.queryByText('`substituteRegex` metadata is preserved-only in MVP runtime.')).not.toBeInTheDocument()
  })

  it('deletes and saves the selected preset, clears matching surface bindings, and keeps standalone regexes intact', async () => {
    const initialLibrary = createLibrary({
      presets: {
        'preset-1': createPreset('preset-1', { updatedAt: '2026-05-15T00:00:01.000Z' }),
        'preset-2': createPreset('preset-2', { updatedAt: '2026-05-15T00:00:00.000Z' }),
      },
      surfaceBindings: {
        ...createDefaultPresetCompatLibrary().surfaceBindings,
        rewrite: {
          ...createDefaultPresetCompatLibrary().surfaceBindings.rewrite,
          presetId: 'preset-1',
          enabled: true,
        },
        future_jump_rewrite: {
          ...createDefaultPresetCompatLibrary().surfaceBindings.future_jump_rewrite,
          presetId: 'preset-1',
          enabled: true,
        },
      },
    })

    useNovelStore.setState({
      presetCompatLibrary: initialLibrary,
    })
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url !== '/api/settings/preset-compat' || init?.method !== 'POST') {
        throw new Error(`Unexpected fetch: ${url}`)
      }

      const body = JSON.parse(String(init.body)) as { library: PresetCompatLibrary }
      expect(body.library.presets['preset-1']).toBeUndefined()
      expect(body.library.surfaceBindings.rewrite.presetId).toBeNull()
      expect(body.library.surfaceBindings.future_jump_rewrite.presetId).toBeNull()
      return new Response(JSON.stringify({
        ok: true,
        library: {
          ...body.library,
          revision: body.library.revision + 1,
        },
      }), { status: 200 })
    })

    render(<PresetCompatLibraryModal activeSelection={chapterSelection} open onClose={vi.fn()} />)

    fireEvent.click(screen.getByTestId('preset-compat-preset-delete-preset-1'))

    await waitFor(() => {
      expect(screen.getByText('已删除预设“Preset preset-1”，并已保存。')).toBeInTheDocument()
    })
    expect(fetch).toHaveBeenCalledWith('/api/settings/preset-compat', expect.objectContaining({ method: 'POST' }))
    expect(useNovelStore.getState().presetCompatLibrary.presets['preset-1']).toBeUndefined()
    expect(useNovelStore.getState().presetCompatLibrary.surfaceBindings.rewrite.presetId).toBeNull()
    expect(useNovelStore.getState().presetCompatLibrary.surfaceBindings.future_jump_rewrite.presetId).toBeNull()
    expect(useNovelStore.getState().presetCompatLibrary.surfaceBindings.rewrite.enabled).toBe(false)
    expect(useNovelStore.getState().presetCompatLibrary.standaloneRegexes['regex-1']).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Preset preset-2' })).toBeInTheDocument()
  })

  it('shows macro-expanded runtime preview parity while preserving raw stored preset text', async () => {
    useNovelStore.setState({
      presetCompatLibrary: createLibrary({
        presets: {
          'preset-1': createPreset('preset-1', {
            promptRules: [
              {
                id: 'preset-1-rule-1',
                name: 'Macro preview rule',
                role: 'system',
                content: 'Speaker pair: {{user}} / {{char}} / {{input}}',
                enabled: true,
                marker: false,
                injectAsSystemPrompt: true,
                injectionPosition: 'before',
                injectionDepth: null,
                injectionOrder: 0,
                injectionTrigger: null,
                forbidOverrides: false,
                condition: null,
                passthrough: {},
              },
            ],
            promptOrderLists: {
              rewrite: ['preset-1-rule-1'],
              expand: ['preset-1-rule-1'],
              roleplay: ['preset-1-rule-1'],
              polish: ['preset-1-rule-1'],
              continue: ['preset-1-rule-1'],
              future_jump_rewrite: ['preset-1-rule-1'],
            },
            promptTemplate: {
              namesBehavior: 1,
            },
          }),
        },
      }),
    })

    render(<PresetCompatLibraryModal open onClose={vi.fn()} />)

    fireEvent.change(screen.getByTestId('preset-compat-binding-rewrite'), { target: { value: 'preset-1' } })
    fireEvent.click(screen.getByTestId('preset-compat-preview-generate'))

    await waitFor(() => {
      expect(screen.getByTestId('preset-compat-preview-system-rewrite')).toHaveTextContent('Speaker pair: Alice / Bob /')
    })

    expect(screen.getByTestId('preset-compat-rule-content-preset-1-rule-1')).toHaveValue('Speaker pair: {{user}} / {{char}} / {{input}}')
    expect(screen.queryByText('UNSUPPORTED_MACRO')).not.toBeInTheDocument()
    expect(screen.queryByText('Macro is not supported on rewrite: input')).not.toBeInTheDocument()
  })

  it('imports the golden fixture, keeps malformed regex imports non-destructive, and leaves existing library data visible', async () => {
    const fixtureText = readFixtureText('resets_example.json')
    let currentLibrary = createDefaultPresetCompatLibrary()
    const previewSpy = vi.spyOn(creativeRuntimePreview, 'buildPresetCompatCreativeRuntimePreview').mockReturnValue({
      systemPrompt: 'Mocked system preview',
      userPrompt: 'Mocked user preview',
      warnings: [],
      metadata: { macroDiagnostics: [] },
    })
    const presetFile = new File([fixtureText], 'resets_example.json', { type: 'application/json' })
    Object.defineProperty(presetFile, 'text', { value: () => Promise.resolve(fixtureText) })
    const malformedRegexText = JSON.stringify({ regex_scripts: [null, { scriptName: 'Broken regex', replaceString: 'x' }] })
    const malformedRegexFile = new File([malformedRegexText], 'broken-regex.json', { type: 'application/json' })
    Object.defineProperty(malformedRegexFile, 'text', { value: () => Promise.resolve(malformedRegexText) })

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url !== '/api/settings/preset-compat/import') {
        throw new Error(`Unexpected fetch: ${url}`)
      }

      const body = JSON.parse(String(init?.body)) as { kind: 'preset' | 'regex'; jsonText: string; nameHint?: string }
      if (body.kind === 'preset') {
        const { preset, warnings } = normalizePresetCompatPresetImport(JSON.parse(body.jsonText), {
          nameHint: body.nameHint,
          existingNames: Object.values(currentLibrary.presets).map((entry) => entry.name),
          now: '2026-05-15T00:00:00.000Z',
          idFactory: () => 'preset-import-001',
        })
        currentLibrary = {
          ...currentLibrary,
          presets: {
            ...currentLibrary.presets,
            [preset.id]: preset,
          },
          lastImportedAt: '2026-05-15T00:00:00.000Z',
        }
        return new Response(JSON.stringify({ ok: true, library: currentLibrary, importedIds: [preset.id], warnings }), { status: 200 })
      }

      const { regexes, warnings } = normalizePresetCompatStandaloneRegexImport(JSON.parse(body.jsonText), {
        existingNames: Object.values(currentLibrary.standaloneRegexes).map((entry) => entry.name),
      })
      for (const regexRecord of regexes) {
        currentLibrary = {
          ...currentLibrary,
          standaloneRegexes: {
            ...currentLibrary.standaloneRegexes,
            [regexRecord.id]: regexRecord,
          },
          lastImportedAt: '2026-05-15T00:00:00.000Z',
        }
      }
      return new Response(JSON.stringify({ ok: true, library: currentLibrary, importedIds: regexes.map((entry) => entry.id), warnings }), { status: 200 })
    }))

    render(<PresetCompatLibraryModal activeSelection={chapterSelection} open onClose={vi.fn()} />)

    fireEvent.change(screen.getByTestId('preset-compat-preset-import-input'), {
      target: { files: [presetFile] },
    })

    await waitFor(() => {
      expect(screen.getAllByText('resets_example').length).toBeGreaterThan(0)
    })
    expect(previewSpy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('preset-compat-preview-generate'))
    await waitFor(() => {
      expect(previewSpy).toHaveBeenCalled()
    })

    fireEvent.change(screen.getByTestId('preset-compat-regex-import-input'), {
      target: { files: [malformedRegexFile] },
    })

    await waitFor(() => {
      expect(screen.getByText('没有导入任何正则条目。')).toBeInTheDocument()
    })

    expect(screen.getAllByText('resets_example').length).toBeGreaterThan(0)
    expect(Object.keys(useNovelStore.getState().presetCompatLibrary.presets)).toContain('preset-import-001')
  }, 30000)
})
