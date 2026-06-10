import { normalizeAISettings } from '@/lib/ai-settings'
import {
  fetchPresetCompatLibrary,
  importPresetCompatPayload,
  savePresetCompatLibrary as savePresetCompatLibraryToBackend,
} from '@/lib/preset-compat/client'
import { normalizeWorkspaceState } from '@/lib/workspace-state'
import type { PersistedNovelState } from '@/lib/types'
import type { NovelStore, NovelStoreGet, NovelStoreSet, PresetCompatImportResult } from '@/store/novel-store-types'
import { fetchKnowledgeProjection, normalizeKnowledgeProjection, resolveCurrentChapterOrder } from '@/store/novel-store-knowledge'

const WORKSPACE_RESTORE_TIMEOUT_MS = 15_000

export function getWorkspaceRestoreErrorMessage(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'Workspace restore timed out'
  }

  return error instanceof Error ? error.message : 'Failed to restore workspace'
}

export function serializeState(state: NovelStore): PersistedNovelState {
  return {
    currentNovelId: state.currentNovelId,
    currentChapterId: state.currentChapterId,
    currentTab: state.currentTab,
    helperTab: state.helperTab,
    expandedVolumeIds: state.expandedVolumeIds,
    localNovels: state.localNovels,
    localVolumes: state.localVolumes,
    localChapters: state.localChapters,
    localOutlines: state.localOutlines,
    localCharacters: state.localCharacters,
    localCharacterRelations: state.localCharacterRelations,
    localWorldEntries: state.localWorldEntries,
    localTimelineEvents: state.localTimelineEvents,
    rewriteCandidates: state.rewriteCandidates,
    rewriteHistory: state.rewriteHistory,
    trajectories: state.trajectories,
    rewriteMode: state.rewriteMode,
    rewriteTone: state.rewriteTone,
    rewriteOutput: state.rewriteOutput,
    rewriteScope: state.rewriteScope,
    selectionText: state.selectionText,
    selectedParagraphIndex: state.selectedParagraphIndex,
    thinkingLevel: state.thinkingLevel,
    autoContinue: state.autoContinue,
    keepCanon: state.keepCanon,
    promptText: state.promptText,
    selectedPresetId: state.selectedPresetId,
    presets: state.presets,
    constraints: state.constraints,
    focusMode: state.focusMode,
    presetCompatSessionState: state.presetCompatSessionState,
    aiSettings: state.aiSettings,
  }
}

export function createPersistenceActions(
  set: NovelStoreSet,
  get: NovelStoreGet,
  initialState: PersistedNovelState
): Pick<NovelStore,
  'loadPresetCompatLibrary'
  | 'loadFromBackend'
  | 'saveToBackend'
  | 'savePresetCompatLibrary'
  | 'importPresetCompatPreset'
  | 'importPresetCompatRegexBundle'
> {
  const importCompatPayload = async (
    kind: 'preset' | 'regex',
    params: Omit<Parameters<typeof importPresetCompatPayload>[0], 'kind'>
  ): Promise<PresetCompatImportResult> => {
    set({ presetCompatLibraryLoading: true, presetCompatLibraryError: '' })
    try {
      const result = await importPresetCompatPayload({ ...params, kind })
      set({
        presetCompatLibrary: result.library,
        presetCompatLibraryDirty: false,
        presetCompatLibraryLoading: false,
        presetCompatLibraryError: '',
      })
      return {
        importedIds: result.importedIds,
        warnings: result.warnings,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to import preset compat ${kind === 'preset' ? 'preset' : 'regex bundle'}`
      set({
        presetCompatLibraryLoading: false,
        presetCompatLibraryError: message,
      })
      throw error
    }
  }

  return {
    loadPresetCompatLibrary: async () => {
      set({ presetCompatLibraryLoading: true, presetCompatLibraryError: '' })
      try {
        const library = await fetchPresetCompatLibrary()
        set({
          presetCompatLibrary: library,
          presetCompatLibraryDirty: false,
          presetCompatLibraryLoading: false,
          presetCompatLibraryError: '',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load preset compat library'
        set({
          presetCompatLibraryLoading: false,
          presetCompatLibraryError: message,
        })
        throw error
      }
    },
    loadFromBackend: async () => {
      set({
        backendLoadError: '',
        presetCompatLibraryLoading: true,
        presetCompatLibraryError: '',
      })
      let restoredWorkspace = initialState
      const workspaceRestoreController = new AbortController()
      const workspaceRestoreTimeoutId = globalThis.setTimeout(() => {
        workspaceRestoreController.abort()
      }, WORKSPACE_RESTORE_TIMEOUT_MS)

      try {
        const workspaceResponse = await fetch('/api/workspace', {
          cache: 'no-store',
          signal: workspaceRestoreController.signal,
        })
        if (!workspaceResponse.ok) {
          const error = await workspaceResponse.json().catch(() => null) as { error?: string } | null
          throw new Error(error?.error || 'Failed to restore workspace')
        }

        const workspace = await workspaceResponse.json().catch(() => {
          throw new Error('Workspace endpoint returned invalid JSON')
        })
        const normalizedWorkspace = normalizeWorkspaceState(workspace)
        restoredWorkspace = normalizedWorkspace

        set({
          ...normalizedWorkspace,
          isHydrated: true,
          backendLoaded: true,
          backendLoadError: '',
        })
      } catch (error) {
        const message = getWorkspaceRestoreErrorMessage(error)
        console.error('Workspace restore failed:', error)
        set({
          backendLoaded: true,
          isHydrated: true,
          backendLoadError: message,
          presetCompatLibraryLoading: false,
        })
        return
      } finally {
        globalThis.clearTimeout(workspaceRestoreTimeoutId)
      }

      const [aiResult, presetCompatResult, projectionResult] = await Promise.allSettled([
        fetch('/api/settings/ai', { cache: 'no-store' }).then(async (response) => {
          if (!response.ok) {
            const error = await response.json().catch(() => null) as { error?: string } | null
            throw new Error(error?.error || 'Failed to load AI settings')
          }
          return response.json()
        }),
        fetchPresetCompatLibrary(),
        fetchKnowledgeProjection({
          novelId: restoredWorkspace.currentNovelId || undefined,
          asOfChapter: resolveCurrentChapterOrder(restoredWorkspace, restoredWorkspace.currentNovelId || undefined),
          statusOnly: true,
        }),
      ])

      const nextState: Partial<NovelStore> = {}
      if (aiResult.status === 'fulfilled') {
        nextState.aiSettings = normalizeAISettings(aiResult.value)
      } else {
        console.error('AI settings restore failed:', aiResult.reason)
      }

      if (presetCompatResult.status === 'fulfilled') {
        nextState.presetCompatLibrary = presetCompatResult.value
        nextState.presetCompatLibraryDirty = false
        nextState.presetCompatLibraryError = ''
      } else {
        const message = presetCompatResult.reason instanceof Error
          ? presetCompatResult.reason.message
          : 'Failed to load preset compat library'
        console.error('Preset compat library restore failed:', presetCompatResult.reason)
        nextState.presetCompatLibraryError = message
      }

      nextState.presetCompatLibraryLoading = false

      if (projectionResult.status === 'fulfilled') {
        Object.assign(nextState, normalizeKnowledgeProjection(projectionResult.value))
      } else {
        console.error('Knowledge projection restore failed:', projectionResult.reason)
      }

      if (Object.keys(nextState).length) {
        set(nextState)
      }
    },
    saveToBackend: async () => {
      const state = get()
      set({ isSaving: true })
      try {
        const response = await fetch('/api/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(serializeState(state)),
        })
        const data = (await response.json()) as { ok?: boolean; error?: string }
        if (!response.ok || data.ok === false) {
          throw new Error(data.error || 'Failed to save workspace')
        }
      } finally {
        set({ isSaving: false })
      }
    },
    savePresetCompatLibrary: async () => {
      const { presetCompatLibrary, presetCompatLibraryDirty } = get()
      if (!presetCompatLibraryDirty) return
      set({ presetCompatLibraryLoading: true, presetCompatLibraryError: '' })
      try {
        const result = await savePresetCompatLibraryToBackend(presetCompatLibrary)
        set({
          presetCompatLibrary: result.library,
          presetCompatLibraryDirty: false,
          presetCompatLibraryLoading: false,
          presetCompatLibraryError: '',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to save preset compat library'
        set({
          presetCompatLibraryLoading: false,
          presetCompatLibraryError: message,
        })
        throw error
      }
    },
    importPresetCompatPreset: async (params) => importCompatPayload('preset', params),
    importPresetCompatRegexBundle: async (params) => importCompatPayload('regex', params),
  }
}
