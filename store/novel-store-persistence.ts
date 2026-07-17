import { normalizeAISettings } from '@/lib/ai-settings'
import {
  fetchPresetCompatLibrary,
  importPresetCompatPayload,
  savePresetCompatLibrary as savePresetCompatLibraryToBackend,
} from '@/lib/preset-compat/client'
import { normalizeWorkspaceState } from '@/lib/workspace-state'
import type { PersistedNovelState } from '@/lib/types'
import type {
  DeleteNovelFromBackendResult,
  DeleteNovelOutcome,
  NovelDeletionStatusObservation,
  NovelDeletionStatusResult,
  NovelStore,
  NovelStoreGet,
  NovelStoreSet,
  PresetCompatImportResult,
} from '@/store/novel-store-types'
import { fetchKnowledgeProjection, normalizeKnowledgeProjectionResult, resolveCurrentChapterOrder } from '@/store/novel-store-knowledge'

const WORKSPACE_RESTORE_TIMEOUT_MS = 15_000
const NOVEL_DELETE_TIMEOUT_MS = 15_000
const NOVEL_DELETION_STATUS_RETRY_DELAYS_MS = [100, 250, 500] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWorkspaceResponse(value: unknown): value is Partial<PersistedNovelState> {
  if (!isRecord(value)) return false

  return typeof value.currentNovelId === 'string'
    && typeof value.currentChapterId === 'string'
    && Array.isArray(value.localNovels)
    && Array.isArray(value.localVolumes)
    && Array.isArray(value.localChapters)
    && Array.isArray(value.localOutlines)
    && Array.isArray(value.localCharacters)
    && Array.isArray(value.localCharacterRelations)
    && Array.isArray(value.localWorldEntries)
    && Array.isArray(value.localTimelineEvents)
    && Array.isArray(value.rewriteCandidates)
    && Array.isArray(value.rewriteHistory)
    && Array.isArray(value.trajectories)
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]) {
  const actualKeys = Object.keys(value)
  return actualKeys.length === expectedKeys.length && expectedKeys.every((key) => key in value)
}

function parseDeletionStatusSuccess(value: unknown, novelId: string): NovelDeletionStatusObservation | null {
  if (!isRecord(value) || !hasExactKeys(value, ['ok', 'novelId', 'deletionState'])) return null
  if (value.ok !== true || value.novelId !== novelId) return null
  if (value.deletionState !== 'ready' && value.deletionState !== 'deleting' && value.deletionState !== 'deleted') return null

  return {
    ok: true,
    novelId,
    deletionState: value.deletionState,
  }
}

function parseErrorResponse(value: unknown): string | null {
  if (!isRecord(value) || !hasExactKeys(value, ['ok', 'error'])) return null
  return value.ok === false && typeof value.error === 'string' ? value.error : null
}

async function fetchWithWorkspaceTimeout(url: string, timeoutMessage: string) {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), WORKSPACE_RESTORE_TIMEOUT_MS)

  try {
    return await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(timeoutMessage)
    }
    throw error
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

async function fetchNovelDeletionStatus(novelId: string): Promise<NovelDeletionStatusObservation> {
  const query = new URLSearchParams({ novelId, deletionStatus: '1' })
  const response = await fetchWithWorkspaceTimeout(
    `/api/workspace?${query.toString()}`,
    'Novel deletion status request timed out'
  )
  const payload: unknown = await response.json().catch(() => {
    throw new Error('Workspace deletion status endpoint returned invalid JSON')
  })

  if (!response.ok) {
    const message = parseErrorResponse(payload)
    if (message) throw new Error(message)
    throw new Error('Workspace deletion status endpoint returned an invalid error response')
  }

  const result = response.status === 200 ? parseDeletionStatusSuccess(payload, novelId) : null
  if (!result) {
    throw new Error('Workspace deletion status endpoint returned an invalid status response')
  }
  return result
}

export async function pollNovelDeletionStatus(novelId: string): Promise<NovelDeletionStatusResult> {
  let result = await fetchNovelDeletionStatus(novelId)
  if (result.deletionState !== 'deleting') {
    return {
      ok: true,
      novelId: result.novelId,
      deletionState: result.deletionState,
    }
  }

  for (const delayMs of NOVEL_DELETION_STATUS_RETRY_DELAYS_MS) {
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs))
    result = await fetchNovelDeletionStatus(novelId)
    if (result.deletionState !== 'deleting') {
      return {
        ok: true,
        novelId: result.novelId,
        deletionState: result.deletionState,
      }
    }
  }

  throw new Error('Novel deletion status remained deleting after all reconciliation attempts')
}

export async function fetchAuthoritativeWorkspace(novelId: string): Promise<PersistedNovelState> {
  const query = new URLSearchParams({ novelId })
  const response = await fetchWithWorkspaceTimeout(
    `/api/workspace?${query.toString()}`,
    'Workspace reconciliation timed out'
  )
  const payload: unknown = await response.json().catch(() => {
    throw new Error('Workspace endpoint returned invalid JSON')
  })

  if (!response.ok) {
    const message = parseErrorResponse(payload)
    if (message) throw new Error(message)
    throw new Error('Workspace endpoint returned an invalid error response')
  }
  if (response.status !== 200 || !isWorkspaceResponse(payload)) {
    throw new Error('Workspace endpoint returned an invalid workspace')
  }

  const workspace = normalizeWorkspaceState(payload)
  const targetPresent = workspace.localNovels.some((item) => item.id === novelId)
    || workspace.localChapters.some((item) => item.novelId === novelId)
  if (!targetPresent) {
    throw new Error('Targeted workspace did not represent the requested novel')
  }
  return workspace
}

function parseDeleteRejection(status: number, payload: unknown): DeleteNovelOutcome | null {
  if (status !== 400 && status !== 404 && status !== 409) return null
  if (!isRecord(payload) || payload.ok !== false || typeof payload.error !== 'string') return null
  if (Object.keys(payload).some((key) => key !== 'ok' && key !== 'error')) return null
  return { status: 'rejected', error: payload.error }
}

function validateDeleteSuccess(status: number, payload: unknown, novelId: string): DeleteNovelFromBackendResult | null {
  if ((status !== 200 && status !== 202) || !isRecord(payload) || payload.ok !== true) return null
  if (payload.deletedNovelId !== novelId) return null
  if (payload.activeNovelId !== null && typeof payload.activeNovelId !== 'string') return null
  if (payload.deletionState !== 'deleted' || typeof payload.cleanupPending !== 'boolean') return null
  if ((status === 202) !== payload.cleanupPending) return null

  return {
    ok: true,
    deletedNovelId: novelId,
    activeNovelId: payload.activeNovelId,
    deletionState: 'deleted',
    cleanupPending: payload.cleanupPending,
  }
}

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
  | 'deleteNovelFromBackend'
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
        Object.assign(nextState, normalizeKnowledgeProjectionResult(projectionResult.value))
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
    deleteNovelFromBackend: async (novelId) => {
      const query = new URLSearchParams({ novelId })
      const nextNovelId = get().currentNovelId
      if (nextNovelId) {
        query.set('nextNovelId', nextNovelId)
      }

      const controller = new AbortController()
      const timeoutId = globalThis.setTimeout(() => controller.abort(), NOVEL_DELETE_TIMEOUT_MS)

      try {
        const response = await fetch(`/api/workspace?${query.toString()}`, {
          method: 'DELETE',
          signal: controller.signal,
        })
        const rawBody = await response.text()
        let payload: unknown
        try {
          payload = JSON.parse(rawBody)
        } catch {
          return { status: 'indeterminate', error: 'Workspace endpoint returned invalid JSON' }
        }

        const rejection = parseDeleteRejection(response.status, payload)
        if (rejection) return rejection

        const result = validateDeleteSuccess(response.status, payload, novelId)
        if (result) return { status: 'committed', result }

        return { status: 'indeterminate', error: 'Workspace endpoint returned an invalid deletion response' }
      } catch (error) {
        const message = error instanceof Error && error.name === 'AbortError'
          ? 'Novel deletion timed out'
          : error instanceof Error
            ? error.message
            : 'Novel deletion failed before its result could be confirmed'
        return { status: 'indeterminate', error: message }
      } finally {
        globalThis.clearTimeout(timeoutId)
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
