import { defaultConstraints, defaultPresets } from '@/lib/data'
import type { PersistedNovelState } from '@/lib/types'

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
    aiSettings: {
      rewriteProvider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4.1-mini',
      configured: false,
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      ollamaRewriteModel: '',
      ollamaModel: '',
      ollamaEmbeddingModel: '',
    },
  }
}

export function normalizeWorkspaceState(input?: Partial<PersistedNovelState> | null): PersistedNovelState {
  const base = createEmptyWorkspaceState()
  if (!input) return base

  const baseAISettings = base.aiSettings
  if (!baseAISettings) {
    return base
  }

  return {
    ...base,
    ...input,
    expandedVolumeIds: input.expandedVolumeIds ?? base.expandedVolumeIds,
    localNovels: input.localNovels ?? base.localNovels,
    localVolumes: input.localVolumes ?? base.localVolumes,
    localChapters: input.localChapters ?? base.localChapters,
    localOutlines: input.localOutlines ?? base.localOutlines,
    localCharacters: input.localCharacters ?? base.localCharacters,
    localCharacterRelations: input.localCharacterRelations ?? base.localCharacterRelations,
    localWorldEntries: input.localWorldEntries ?? base.localWorldEntries,
    localTimelineEvents: input.localTimelineEvents ?? base.localTimelineEvents,
    rewriteCandidates: input.rewriteCandidates ?? base.rewriteCandidates,
    rewriteHistory: input.rewriteHistory ?? base.rewriteHistory,
    trajectories: input.trajectories ?? base.trajectories,
    presets: input.presets ?? base.presets,
    constraints: input.constraints ?? base.constraints,
    aiSettings: {
      rewriteProvider: input.aiSettings?.rewriteProvider ?? baseAISettings.rewriteProvider,
      baseUrl: input.aiSettings?.baseUrl ?? baseAISettings.baseUrl,
      apiKey: input.aiSettings?.apiKey ?? baseAISettings.apiKey,
      model: input.aiSettings?.model ?? baseAISettings.model,
      configured: input.aiSettings?.configured ?? baseAISettings.configured,
      ollamaBaseUrl: input.aiSettings?.ollamaBaseUrl ?? baseAISettings.ollamaBaseUrl,
      ollamaRewriteModel: input.aiSettings?.ollamaRewriteModel ?? baseAISettings.ollamaRewriteModel,
      ollamaModel: input.aiSettings?.ollamaModel ?? baseAISettings.ollamaModel,
      ollamaEmbeddingModel: input.aiSettings?.ollamaEmbeddingModel ?? baseAISettings.ollamaEmbeddingModel,
    },
  }
}
