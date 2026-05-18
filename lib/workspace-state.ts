import { defaultConstraints, defaultPresets } from '@/lib/data'
import type { PresetCompatSurfaceId } from '@/lib/preset-compat/types'
import { createDefaultAISettings, normalizeAISettings } from '@/lib/ai-settings'
import { normalizeCharacterRoleCardProfile } from '@/lib/story-knowledge'
import type {
  PersistedNovelState,
  PresetCompatSessionEntry,
  PresetCompatSessionPhase,
  PresetCompatSessionState,
  PresetCompatSessionWorkspaceSelection,
} from '@/lib/types'
import { normalizeLegacySingleParagraphHtml } from '@/lib/utils'

const PRESET_COMPAT_SESSION_PHASE_SET = new Set<PresetCompatSessionPhase>([
  'new_chat',
  'new_group_chat',
  'new_example_chat',
  'continue',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createEmptyPresetCompatSessionState(): PresetCompatSessionState {
  return {}
}

function normalizePresetCompatSessionEntry(
  entryKey: string,
  input: unknown
): PresetCompatSessionEntry | null {
  if (!isRecord(input)) return null

  const phase = input.phase
  const surfaceId = input.surfaceId
  const resetPending = input.resetPending

  if (
    typeof surfaceId !== 'string'
    || typeof phase !== 'string'
    || !PRESET_COMPAT_SESSION_PHASE_SET.has(phase as PresetCompatSessionPhase)
    || typeof resetPending !== 'boolean'
  ) {
    return null
  }

  return {
    surfaceId: surfaceId as PresetCompatSurfaceId,
    phase: phase as PresetCompatSessionPhase,
    resetPending,
  }
}

export function normalizePresetCompatSessionState(input: unknown): PresetCompatSessionState {
  if (!isRecord(input)) return createEmptyPresetCompatSessionState()

  const normalizedEntries = Object.entries(input)
    .map(([entryKey, value]) => {
      const normalizedValue = normalizePresetCompatSessionEntry(entryKey, value)
      return normalizedValue ? [entryKey, normalizedValue] as const : null
    })
    .filter((entry): entry is readonly [string, PresetCompatSessionEntry] => entry !== null)

  return Object.fromEntries(normalizedEntries)
}

function encodePresetCompatSessionKeyPart(value: string | number) {
  return encodeURIComponent(String(value))
}

export function createPresetCompatSessionSelectionKey(selection: PresetCompatSessionWorkspaceSelection) {
  if (selection.kind === 'chapter') {
    return `chapter:${encodePresetCompatSessionKeyPart(selection.chapterId)}`
  }

  if (selection.kind === 'what_if') {
    return [
      'what_if',
      encodePresetCompatSessionKeyPart(selection.nodeId),
      encodePresetCompatSessionKeyPart(selection.sessionId),
      selection.anchorChapterNo,
    ].join(':')
  }

  if (selection.kind === 'continue_block') {
    return [
      'continue_block',
      encodePresetCompatSessionKeyPart(selection.nodeId),
      encodePresetCompatSessionKeyPart(selection.continueBlockId),
      selection.anchorChapterNo,
    ].join(':')
  }

  return [
    'future_jump',
    encodePresetCompatSessionKeyPart(selection.nodeId),
    encodePresetCompatSessionKeyPart(selection.runId),
    selection.sourceChapterNo,
    selection.targetChapterNo,
  ].join(':')
}

export function createPresetCompatSessionStateKey(
  selection: PresetCompatSessionWorkspaceSelection,
  surfaceId: PresetCompatSurfaceId
) {
  return `${createPresetCompatSessionSelectionKey(selection)}::${surfaceId}`
}

export function setPresetCompatSessionEntry(
  state: PresetCompatSessionState,
  selection: PresetCompatSessionWorkspaceSelection,
  surfaceId: PresetCompatSurfaceId,
  phase: PresetCompatSessionPhase,
  resetPending = false
): PresetCompatSessionState {
  const entryKey = createPresetCompatSessionStateKey(selection, surfaceId)

  return {
    ...state,
    [entryKey]: {
      surfaceId,
      phase,
      resetPending,
    },
  }
}

export function clearPresetCompatSessionStateForSelection(
  state: PresetCompatSessionState,
  selection: PresetCompatSessionWorkspaceSelection
): PresetCompatSessionState {
  const selectionPrefix = `${createPresetCompatSessionSelectionKey(selection)}::`
  return Object.fromEntries(
    Object.entries(state).filter(([entryKey]) => !entryKey.startsWith(selectionPrefix))
  )
}

export function resetPresetCompatSessionStateForSelection(
  state: PresetCompatSessionState,
  selection: PresetCompatSessionWorkspaceSelection,
  surfaceIds: PresetCompatSurfaceId[],
  phase: PresetCompatSessionPhase = 'new_chat'
): PresetCompatSessionState {
  return surfaceIds.reduce(
    (nextState, surfaceId) => setPresetCompatSessionEntry(nextState, selection, surfaceId, phase, true),
    state
  )
}

function pickDeterministicChapter(
  chapters: PersistedNovelState['localChapters'],
  preferredNovelId?: string
) {
  const sorted = chapters.slice().sort((left, right) => {
    const preferredDiff = Number(right.novelId === preferredNovelId) - Number(left.novelId === preferredNovelId)
    if (preferredDiff !== 0) return preferredDiff

    const mainDiff = Number(Boolean(left.parentChapterId)) - Number(Boolean(right.parentChapterId))
    if (mainDiff !== 0) return mainDiff

    if (left.novelId !== right.novelId) return left.novelId.localeCompare(right.novelId)
    if (left.order !== right.order) return left.order - right.order
    return left.id.localeCompare(right.id)
  })

  return sorted[0] ?? null
}

function repairCurrentWorkspaceSelection(state: PersistedNovelState) {
  if (!state.localChapters.length) {
    return {
      currentNovelId: '',
      currentChapterId: '',
    }
  }

  const selectedChapter = state.localChapters.find((chapter) => chapter.id === state.currentChapterId)
  if (selectedChapter) {
    return {
      currentNovelId: selectedChapter.novelId,
      currentChapterId: selectedChapter.id,
    }
  }

  const fallbackChapter = pickDeterministicChapter(state.localChapters, state.currentNovelId)

  return {
    currentNovelId: fallbackChapter?.novelId ?? '',
    currentChapterId: fallbackChapter?.id ?? '',
  }
}

function cloneDefaultPresets() {
  return defaultPresets.map((preset) => ({ ...preset }))
}

function cloneDefaultConstraints() {
  return defaultConstraints.map((constraint) => ({ ...constraint }))
}

export function createEmptyWorkspaceState(): PersistedNovelState {
  return {
    currentNovelId: '',
    currentChapterId: '',
    currentTab: 'editor',
    helperTab: 'ai',
    expandedVolumeIds: [],
    localNovels: [],
    localVolumes: [],
    localChapters: [],
    localOutlines: [],
    localCharacters: [],
    localCharacterRelations: [],
    localWorldEntries: [],
    localTimelineEvents: [],
    rewriteCandidates: [],
    rewriteHistory: [],
    trajectories: [],
    rewriteMode: 'medium',
    rewriteTone: 'keep',
    rewriteOutput: 'candidate',
    rewriteScope: 'paragraph',
    selectionText: '',
    selectedParagraphIndex: 0,
    thinkingLevel: 'medium',
    autoContinue: true,
    keepCanon: true,
    promptText: '保留世界观与人物关系，仅强化氛围、节奏与张力。',
    selectedPresetId: defaultPresets[0]?.id ?? '',
    presets: cloneDefaultPresets(),
    constraints: cloneDefaultConstraints(),
    focusMode: false,
    presetCompatSessionState: createEmptyPresetCompatSessionState(),
    aiSettings: createDefaultAISettings(),
  }
}

export function normalizeWorkspaceState(input?: Partial<PersistedNovelState> | null): PersistedNovelState {
  const base = createEmptyWorkspaceState()
  if (!input) return base

  const normalizedState = {
    ...base,
    ...input,
    expandedVolumeIds: input.expandedVolumeIds ?? base.expandedVolumeIds,
    localNovels: input.localNovels ?? base.localNovels,
    localVolumes: input.localVolumes ?? base.localVolumes,
    localChapters: (input.localChapters ?? base.localChapters).map((chapter) => ({
      ...chapter,
      content: normalizeLegacySingleParagraphHtml(chapter.content),
      originalContent: chapter.originalContent
        ? normalizeLegacySingleParagraphHtml(chapter.originalContent)
        : chapter.originalContent,
    })),
    localOutlines: input.localOutlines ?? base.localOutlines,
    localCharacters: (input.localCharacters ?? base.localCharacters).map((character) => ({
      ...character,
      profile: character.profile ? normalizeCharacterRoleCardProfile(character.profile) : undefined,
    })),
    localCharacterRelations: input.localCharacterRelations ?? base.localCharacterRelations,
    localWorldEntries: input.localWorldEntries ?? base.localWorldEntries,
    localTimelineEvents: input.localTimelineEvents ?? base.localTimelineEvents,
    rewriteCandidates: input.rewriteCandidates ?? base.rewriteCandidates,
    rewriteHistory: input.rewriteHistory ?? base.rewriteHistory,
    trajectories: input.trajectories ?? base.trajectories,
    presets: input.presets ?? base.presets,
    constraints: input.constraints ?? base.constraints,
    presetCompatSessionState: normalizePresetCompatSessionState(input.presetCompatSessionState),
    aiSettings: normalizeAISettings(input.aiSettings ?? input),
  }

  return {
    ...normalizedState,
    ...repairCurrentWorkspaceSelection(normalizedState),
  }
}
