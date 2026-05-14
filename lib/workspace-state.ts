import { defaultConstraints, defaultPresets } from '@/lib/data'
import { createDefaultAISettings, normalizeAISettings } from '@/lib/ai-settings'
import { normalizeCharacterRoleCardProfile } from '@/lib/story-knowledge'
import type { PersistedNovelState } from '@/lib/types'
import { normalizeLegacySingleParagraphHtml } from '@/lib/utils'

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
    aiSettings: normalizeAISettings(input.aiSettings ?? input),
  }

  return {
    ...normalizedState,
    ...repairCurrentWorkspaceSelection(normalizedState),
  }
}
