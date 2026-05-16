"use client"

import { create } from 'zustand'
import { normalizeAISettings } from '@/lib/ai-settings'
import {
  exportPresetCompatPresetJson,
  exportPresetCompatStandaloneRegexJson,
  fetchPresetCompatLibrary,
  importPresetCompatPayload,
  savePresetCompatLibrary as savePresetCompatLibraryToBackend,
} from '@/lib/preset-compat/client'
import type { ImportPresetCompatPayloadParams } from '@/lib/preset-compat/client'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import type {
  PresetCompatLibrary,
  PresetCompatPromptRule,
  PresetCompatRegexRecord,
  PresetCompatSurfaceId,
} from '@/lib/preset-compat/types'
import {
  countChineseFriendlyWords,
  formatNowLabel,
  getParagraphsFromHtml,
  htmlToPlainText,
  plainTextToHtml,
  uid,
} from '@/lib/utils'
import { buildGenerationContext } from '@/lib/story-knowledge'
import type {
  AISettings,
  Chapter,
  Character,
  CharacterRelation,
  HelperTab,
  OutlineItem,
  OutlineType,
  PersistedNovelState,
  RewriteCandidate,
  RewriteConstraint,
  RewriteHistoryEntry,
  RewriteMode,
  RewriteOutput,
  RewritePreset,
  RewriteScope,
  RewriteTone,
  ThoughtLevel,
  TimelineEvent,
  WorldEntry,
  WorldEntryType,
  WorkspaceTab,
} from '@/lib/types'
import { createEmptyWorkspaceState, normalizeWorkspaceState } from '@/lib/workspace-state'

type GenerateRewriteParams = {
  prompt?: string
}

type ImportPayload = Partial<PersistedNovelState>

type KnowledgeProjectionPayload = Pick<
  PersistedNovelState,
  'localOutlines' | 'localCharacters' | 'localCharacterRelations' | 'localWorldEntries' | 'localTimelineEvents'
>

type KnowledgeRebuildStatus = {
  jobId: string
  novelId: string
  status: string
  progress: number
  currentStep: string | null
  createdAt: string
  updatedAt: string
  etaMinutes: number | null
  steps: Array<{
    key: 'extract' | 'cleanup' | 'write' | 'index'
    label: string
    status: 'pending' | 'running' | 'paused' | 'completed'
    progress: number
    etaMinutes: number | null
    detail: string | null
  }>
}

type KnowledgeActionOutcome = 'completed' | 'paused' | 'aborted' | 'deleted' | 'idle'

type PresetCompatImportResult = {
  importedIds: string[]
  warnings: string[]
}

type KnowledgeProjectionResult = KnowledgeProjectionPayload & {
  knowledgeRebuildStatus: KnowledgeRebuildStatus | null
  jobOutcome: KnowledgeActionOutcome | null
}

function normalizeKnowledgeProjection(data: Partial<KnowledgeProjectionPayload>): KnowledgeProjectionPayload {
  return {
    localOutlines: data.localOutlines ?? [],
    localCharacters: data.localCharacters ?? [],
    localCharacterRelations: data.localCharacterRelations ?? [],
    localWorldEntries: data.localWorldEntries ?? [],
    localTimelineEvents: data.localTimelineEvents ?? [],
  }
}

function normalizeKnowledgeProjectionResult(data: Partial<KnowledgeProjectionResult>): KnowledgeProjectionResult {
  return {
    ...normalizeKnowledgeProjection(data),
    knowledgeRebuildStatus: data.knowledgeRebuildStatus ?? null,
    jobOutcome: data.jobOutcome ?? null,
  }
}

async function fetchKnowledgeProjection(options?: {
  novelId?: string
  asOfChapter?: number
  method?: 'GET' | 'POST'
  action?: 'rebuild' | 'pause' | 'abort' | 'delete-knowledge'
}): Promise<KnowledgeProjectionResult> {
  const novelId = options?.novelId
  const asOfChapter = options?.asOfChapter
  const method = options?.method ?? 'GET'
  const action = options?.action ?? 'rebuild'

  if (method === 'POST') {
    const response = await fetch('/api/knowledge-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ novelId, action }),
    })
    const data = (await response.json()) as Partial<KnowledgeProjectionResult> & { ok?: boolean; error?: string }
    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Failed to update knowledge projection')
    }

    return normalizeKnowledgeProjectionResult(data)
  }

  const searchParams = new URLSearchParams()
  if (novelId) searchParams.set('novelId', novelId)
  if (typeof asOfChapter === 'number' && Number.isFinite(asOfChapter) && asOfChapter >= 1) {
    searchParams.set('asOfChapter', String(asOfChapter))
  }
  const search = searchParams.size ? `?${searchParams.toString()}` : ''
  const response = await fetch(`/api/knowledge-view${search}`, { cache: 'no-store' })
  const data = (await response.json()) as Partial<KnowledgeProjectionResult> & { ok?: boolean; error?: string }
  if (!response.ok || !data.ok) {
    throw new Error(data.error || 'Failed to load knowledge projection')
  }

  return normalizeKnowledgeProjectionResult(data)
}

function mergeKnowledgeProjection(state: PersistedNovelState, projection: KnowledgeProjectionPayload, novelId?: string): KnowledgeProjectionPayload {
  if (!novelId) {
    return projection
  }

  return {
    localOutlines: [...state.localOutlines.filter((item) => item.novelId !== novelId), ...projection.localOutlines],
    localCharacters: [...state.localCharacters.filter((item) => item.novelId !== novelId), ...projection.localCharacters],
    localCharacterRelations: [
      ...state.localCharacterRelations.filter((item) => item.novelId !== novelId),
      ...projection.localCharacterRelations,
    ],
    localWorldEntries: [...state.localWorldEntries.filter((item) => item.novelId !== novelId), ...projection.localWorldEntries],
    localTimelineEvents: [...state.localTimelineEvents.filter((item) => item.novelId !== novelId), ...projection.localTimelineEvents],
  }
}

function resolveCurrentChapterOrder(state: Pick<PersistedNovelState, 'currentNovelId' | 'currentChapterId' | 'localChapters'>, novelId?: string) {
  const targetNovelId = novelId ?? state.currentNovelId
  if (!targetNovelId) return undefined

  const activeChapter = state.localChapters.find((chapter) => chapter.id === state.currentChapterId && chapter.novelId === targetNovelId)
  if (activeChapter) return activeChapter.order

  return state.localChapters
    .filter((chapter) => chapter.novelId === targetNovelId && !chapter.parentChapterId)
    .slice()
    .sort((left, right) => left.order - right.order)[0]?.order
}

function collectChapterSubtreeIds(chapters: Chapter[], rootChapterId: string) {
  const collected = new Set<string>([rootChapterId])
  let added = true

  while (added) {
    added = false
    for (const chapter of chapters) {
      if (chapter.parentChapterId && collected.has(chapter.parentChapterId) && !collected.has(chapter.id)) {
        collected.add(chapter.id)
        added = true
      }
    }
  }

  return collected
}

function pickNextAvailableChapter(chapters: Chapter[], preferredNovelId?: string) {
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

function buildStateAfterNovelDeletion(state: PersistedNovelState, novelId: string) {
  const remainingChapters = state.localChapters.filter((chapter) => chapter.novelId !== novelId)
  const remainingChapterIds = new Set(remainingChapters.map((chapter) => chapter.id))
  const nextCurrentChapter = state.currentNovelId === novelId
    ? pickNextAvailableChapter(remainingChapters)
    : remainingChapters.find((chapter) => chapter.id === state.currentChapterId) ?? pickNextAvailableChapter(remainingChapters, state.currentNovelId)
  const shouldResetChapterScopedState = !nextCurrentChapter || !remainingChapterIds.has(state.currentChapterId)

  return {
    currentNovelId: nextCurrentChapter?.novelId ?? '',
    currentChapterId: nextCurrentChapter?.id ?? '',
    localNovels: state.localNovels.filter((item) => item.id !== novelId),
    localVolumes: state.localVolumes.filter((item) => item.novelId !== novelId),
    localChapters: remainingChapters,
    localOutlines: state.localOutlines.filter((item) => item.novelId !== novelId),
    localCharacters: state.localCharacters.filter((item) => item.novelId !== novelId),
    localCharacterRelations: state.localCharacterRelations.filter((item) => item.novelId !== novelId),
    localWorldEntries: state.localWorldEntries.filter((item) => item.novelId !== novelId),
    localTimelineEvents: state.localTimelineEvents.filter((item) => item.novelId !== novelId),
    rewriteCandidates: shouldResetChapterScopedState ? [] : state.rewriteCandidates,
    rewriteHistory: state.rewriteHistory.filter((item) => remainingChapterIds.has(item.chapterId)),
    trajectories: state.trajectories.filter((item) => remainingChapterIds.has(item.chapterId)),
    selectionText: shouldResetChapterScopedState ? '' : state.selectionText,
    selectedParagraphIndex: shouldResetChapterScopedState ? null : state.selectedParagraphIndex,
  }
}

function buildStateAfterChapterDeletion(state: PersistedNovelState, chapterId: string) {
  const targetChapter = state.localChapters.find((chapter) => chapter.id === chapterId)
  if (!targetChapter) {
    return state
  }

  const removedChapterIds = collectChapterSubtreeIds(state.localChapters, chapterId)
  const remainingChapters = state.localChapters.filter((chapter) => !removedChapterIds.has(chapter.id))

  if (!remainingChapters.some((chapter) => chapter.novelId === targetChapter.novelId)) {
    return {
      ...state,
      ...buildStateAfterNovelDeletion(state, targetChapter.novelId),
    }
  }

  const remainingChapterIds = new Set(remainingChapters.map((chapter) => chapter.id))
  const remainingVolumeIds = new Set(remainingChapters.map((chapter) => chapter.volumeId))
  const currentChapterRemoved = removedChapterIds.has(state.currentChapterId)
  const nextCurrentChapter = currentChapterRemoved
    ? pickNextAvailableChapter(remainingChapters, targetChapter.novelId)
    : remainingChapters.find((chapter) => chapter.id === state.currentChapterId) ?? pickNextAvailableChapter(remainingChapters, state.currentNovelId)

  return {
    currentNovelId: nextCurrentChapter?.novelId ?? '',
    currentChapterId: nextCurrentChapter?.id ?? '',
    localNovels: state.localNovels,
    localVolumes: state.localVolumes.filter((volume) => volume.novelId !== targetChapter.novelId || remainingVolumeIds.has(volume.id)),
    localChapters: remainingChapters,
    localOutlines: state.localOutlines.map((item) => item.novelId === targetChapter.novelId
      ? { ...item, relatedChapterIds: item.relatedChapterIds.filter((id) => !removedChapterIds.has(id)) }
      : item),
    localCharacters: state.localCharacters,
    localCharacterRelations: state.localCharacterRelations.map((item) => item.novelId === targetChapter.novelId
      ? { ...item, chapterIds: item.chapterIds.filter((id) => !removedChapterIds.has(id)) }
      : item),
    localWorldEntries: state.localWorldEntries,
    localTimelineEvents: state.localTimelineEvents.map((item) => item.novelId === targetChapter.novelId
      ? { ...item, chapterIds: item.chapterIds.filter((id) => !removedChapterIds.has(id)) }
      : item),
    rewriteCandidates: currentChapterRemoved ? [] : state.rewriteCandidates,
    rewriteHistory: state.rewriteHistory.filter((item) => remainingChapterIds.has(item.chapterId)),
    trajectories: state.trajectories.filter((item) => remainingChapterIds.has(item.chapterId)),
    selectionText: currentChapterRemoved ? '' : state.selectionText,
    selectedParagraphIndex: currentChapterRemoved ? null : state.selectedParagraphIndex,
  }
}

type NovelStore = PersistedNovelState & {
  isHydrated: boolean
  isSaving: boolean
  backendLoaded: boolean
  backendLoadError: string
  presetCompatLibrary: PresetCompatLibrary
  presetCompatLibraryLoading: boolean
  presetCompatLibraryError: string

  getNovels: () => Array<{ id: string; title: string; summary: string; tags: string[]; updatedAt: string; wordCount: number; chapterCount: number }>
  importNovelFromText: (input: { title: string; text: string; summary?: string }) => string | null
  setCurrentNovelId: (id: string) => void
  setCurrentChapterId: (id: string) => void
  setCurrentTab: (tab: WorkspaceTab) => void
  setHelperTab: (tab: HelperTab) => void
  toggleVolume: (id: string) => void
  updateChapterContent: (id: string, html: string) => void
  reorderChaptersInVolume: (volumeId: string, orderedIds: string[]) => void
  setRewriteMode: (mode: RewriteMode) => void
  setRewriteTone: (tone: RewriteTone) => void
  setRewriteOutput: (output: RewriteOutput) => void
  setRewriteScope: (scope: RewriteScope) => void
  setThinkingLevel: (level: ThoughtLevel) => void
  toggleAutoContinue: () => void
  toggleKeepCanon: () => void
  selectRewriteCandidate: (id: string) => void
  applyRewriteCandidate: (id: string) => void
  insertRewriteCandidate: (id: string) => void
  branchRewriteCandidate: (id: string) => void
  continueRewriteCandidate: (id: string) => void
  setSelectionText: (text: string) => void
  setSelectedParagraphIndex: (index: number | null) => void
  setPromptText: (text: string) => void
  addPreset: () => void
  selectPreset: (id: string) => void
  updatePresetPrompt: (id: string, prompt: string) => void
  updatePresetName: (id: string, name: string) => void
  toggleConstraint: (id: string) => void
  cycleConstraintStrength: (id: string) => void
  generateRewriteBatch: (params?: GenerateRewriteParams) => Promise<void>
  addChapterBranch: (sourceChapterId: string, title?: string, content?: string) => void
  createNewChapter: () => void
  toggleFocusMode: () => void
  exportWorkspace: () => string
  importWorkspace: (payload: ImportPayload) => void
  resetWorkspace: () => void
  setHydrated: (value: boolean) => void
  loadFromBackend: () => Promise<void>
  saveToBackend: () => Promise<void>
  loadPresetCompatLibrary: () => Promise<void>
  savePresetCompatLibrary: () => Promise<void>
  importPresetCompatPreset: (params: Omit<ImportPresetCompatPayloadParams, 'kind'>) => Promise<PresetCompatImportResult>
  importPresetCompatRegexBundle: (params: Omit<ImportPresetCompatPayloadParams, 'kind'>) => Promise<PresetCompatImportResult>
  bindPresetCompatPresetToSurface: (surfaceId: PresetCompatSurfaceId, presetId: string | null) => void
  deletePresetCompatPreset: (presetId: string) => void
  attachPresetCompatStandaloneRegex: (presetId: string, regexId: string) => void
  detachPresetCompatStandaloneRegex: (presetId: string, regexId: string) => void
  updatePresetCompatPromptRule: (presetId: string, promptRuleId: string, updates: Partial<PresetCompatPromptRule>) => void
  updatePresetCompatEmbeddedRegex: (presetId: string, regexId: string, updates: Partial<PresetCompatRegexRecord>) => void
  updatePresetCompatStandaloneRegex: (regexId: string, updates: Partial<PresetCompatRegexRecord>) => void
  exportPresetCompatPreset: (presetId: string) => string | null
  exportPresetCompatStandaloneRegexBundle: (regexIds?: string[]) => string
  addCharacter: (novelId: string, fields: { name: string; role: string; goal: string; trait: string; note: string }) => void
  updateCharacter: (id: string, fields: Partial<Omit<Character, 'id' | 'novelId'>>) => void
  deleteCharacter: (id: string) => void
  addOutlineItem: (novelId: string, fields: { title: string; type: OutlineType; summary: string; relatedChapterIds?: string[] }) => void
  updateOutlineItem: (id: string, fields: Partial<Omit<OutlineItem, 'id' | 'novelId'>>) => void
  deleteOutlineItem: (id: string) => void
  addCharacterRelation: (novelId: string, fields: Omit<CharacterRelation, 'id' | 'novelId'>) => void
  updateCharacterRelation: (id: string, fields: Partial<Omit<CharacterRelation, 'id' | 'novelId'>>) => void
  deleteCharacterRelation: (id: string) => void
  addWorldEntry: (novelId: string, fields: { title: string; type: WorldEntryType; content: string }) => void
  updateWorldEntry: (id: string, fields: Partial<Omit<WorldEntry, 'id' | 'novelId'>>) => void
  deleteWorldEntry: (id: string) => void
  addTimelineEvent: (novelId: string, fields: Omit<TimelineEvent, 'id' | 'novelId'>) => void
  updateTimelineEvent: (id: string, fields: Partial<Omit<TimelineEvent, 'id' | 'novelId'>>) => void
  deleteTimelineEvent: (id: string) => void
  deleteChapter: (chapterId: string) => void
  deleteNovel: (novelId: string) => void
  rebuildStoryKnowledge: (novelId?: string) => Promise<KnowledgeProjectionResult | null>
  pauseStoryKnowledgeRebuild: (novelId?: string) => Promise<KnowledgeProjectionResult | null>
  abortStoryKnowledgeRebuild: (novelId?: string) => Promise<KnowledgeProjectionResult | null>
  deleteStoryKnowledgeGraph: (novelId?: string) => Promise<KnowledgeProjectionResult | null>
  refreshKnowledgeProjection: (novelId?: string, asOfChapter?: number) => Promise<void>

  setAISettings: (settings: AISettings) => void
  saveAISettings: () => Promise<void>
}

const initialState: PersistedNovelState = createEmptyWorkspaceState()

function serializeState(state: NovelStore): PersistedNovelState {
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
    aiSettings: state.aiSettings,
  }
}

function getScopeSource(chapter: Chapter, scope: RewriteScope, selectedParagraphIndex: number | null, selectionText: string) {
  const chapterText = htmlToPlainText(chapter.content)
  if (scope === 'selection' && selectionText.trim()) return selectionText.trim()
  const paragraphs = getParagraphsFromHtml(chapter.content)
  if (scope === 'paragraph' && paragraphs.length) {
    const index = selectedParagraphIndex ?? 0
    return paragraphs[Math.max(0, Math.min(index, paragraphs.length - 1))]
  }
  return chapterText
}

function buildFallbackCandidates(source: string, mode: RewriteMode, tone: RewriteTone, prompt: string): RewriteCandidate[] {
  const batchId = uid('batch')
  const variants = [
    `${source} 空气里的湿冷像一把迟迟没有落下的刀。`,
    `${source} 她没有再让自己停在原地，几乎在下一秒就被逼着向前。`,
    `${source} 她决定偏离原本更安全的做法，而这个念头本身就像命运在推她一把。`,
  ]
  return variants.map((content, index) => ({
    id: uid(`cand${index + 1}`),
    batchId,
    title: `候选 ${String.fromCharCode(65 + index)}`,
    summary: `${prompt || '默认提示词'} · ${mode} / ${tone}`,
    content,
    mode,
    tone,
    selected: index === 0,
    createdAt: formatNowLabel(),
    prompt,
    sourceExcerpt: source.slice(0, 120),
    actions: ['apply', 'insert', 'branch', 'continue'],
  }))
}

export const useNovelStore = create<NovelStore>((set, get) => ({
  ...initialState,
  isHydrated: false,
  isSaving: false,
  backendLoaded: false,
  backendLoadError: '',
  presetCompatLibrary: createDefaultPresetCompatLibrary(),
  presetCompatLibraryLoading: false,
  presetCompatLibraryError: '',

  getNovels: () => {
    const state = get()
    const novelIds = Array.from(new Set([
      ...state.localNovels.map((novel) => novel.id),
      ...state.localChapters.map((chapter) => chapter.novelId),
    ]))

    return novelIds.map((novelId) => {
      const chapters = state.localChapters
        .filter((chapter) => chapter.novelId === novelId && !chapter.parentChapterId)
        .slice()
        .sort((a, b) => a.order - b.order)
      const chapterCount = chapters.length
      const wordCount = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0)
      const updatedAt = chapters[0]?.updatedAt ?? formatNowLabel()
      const novelMeta = state.localNovels.find((item) => item.id === novelId)
      const firstChapterText = chapters[0] ? htmlToPlainText(chapters[0].content).replace(/\s+/g, ' ').trim() : ''
      const inferredTitle = novelMeta?.title ?? chapters[0]?.title?.replace(/^第\s*[0-9一二三四五六七八九十百千零两]+\s*章\s*/, '') ?? `小说 ${novelId.slice(-4)}`
      const inferredSummary = novelMeta?.summary ?? (firstChapterText.slice(0, 120) || '你创建的新小说。')
      return {
        id: novelId,
        title: inferredTitle,
        summary: inferredSummary,
        tags: novelMeta?.tags ?? ['导入', 'TXT'],
        updatedAt,
        wordCount,
        chapterCount,
      }
    })
  },
  importNovelFromText: ({ title, text, summary }) => {
    const state = get()
    const cleanTitle = title.trim() || `导入小说 ${state.localVolumes.length + 1}`
    const cleanText = text.trim()
    if (!cleanText) return null

    const novelId = uid('novel')
    const volumeId = uid('vol')
    const chapterRegex = /(第\s*[0-9一二三四五六七八九十百千零两]+\s*章[^\n]*)/g
    const parts = cleanText.split(chapterRegex).map((item) => item.trim()).filter(Boolean)

    const newVolume = {
      id: volumeId,
      novelId,
      title: '卷一：导入正文',
      order: 1,
    }

    const importedChapters: Chapter[] = []

    if (parts.length >= 2) {
      for (let i = 0; i < parts.length; i += 2) {
        const heading = parts[i]
        const body = parts[i + 1] ?? ''
        if (!heading) continue
        const contentText = body.trim() || '（本章暂无正文）'
        importedChapters.push({
          id: uid('ch'),
          novelId,
          volumeId,
          title: heading,
          order: importedChapters.length + 1,
          content: plainTextToHtml(contentText),
          originalContent: plainTextToHtml(contentText),
          status: 'draft',
          wordCount: countChineseFriendlyWords(contentText),
          updatedAt: `${formatNowLabel()} · 导入`,
          trajectory: ['从 TXT 导入'],
        })
      }
    }

    if (!importedChapters.length) {
      importedChapters.push({
        id: uid('ch'),
        novelId,
        volumeId,
        title: '第1章 导入正文',
        order: 1,
        content: plainTextToHtml(cleanText),
        originalContent: plainTextToHtml(cleanText),
        status: 'draft',
        wordCount: countChineseFriendlyWords(cleanText),
        updatedAt: `${formatNowLabel()} · 导入`,
        trajectory: ['从 TXT 导入'],
      })
    }

    set({
      currentNovelId: novelId,
      currentChapterId: importedChapters[0].id,
      currentTab: 'editor',
      localNovels: [
        ...state.localNovels,
        {
          id: novelId,
          title: cleanTitle,
          summary: summary?.trim() || `从 TXT 导入，共 ${importedChapters.length} 章。`,
          tags: ['导入', 'TXT'],
        },
      ],
      localVolumes: [...state.localVolumes, newVolume],
      localChapters: [...state.localChapters, ...importedChapters],
      trajectories: [
        {
          id: uid('traj'),
          chapterId: importedChapters[0].id,
          type: 'note',
          title: `导入小说《${cleanTitle}》`,
          detail: summary?.trim() || `共导入 ${importedChapters.length} 章。`,
          createdAt: formatNowLabel(),
        },
        ...state.trajectories,
      ],
    })

    return novelId
  },
  setHydrated: (value) => set({ isHydrated: value }),
  setCurrentNovelId: (id) => set((state) => {
    const sortedChapters = state.localChapters
      .filter((chapter) => chapter.novelId === id && !chapter.parentChapterId)
      .slice()
      .sort((left, right) => left.order - right.order)
    const currentChapterBelongsToNovel = sortedChapters.some((chapter) => chapter.id === state.currentChapterId)
    return {
      currentNovelId: id,
      currentChapterId: currentChapterBelongsToNovel ? state.currentChapterId : (sortedChapters[0]?.id ?? ''),
    }
  }),
  setCurrentChapterId: (id) => set({ currentChapterId: id }),
  setCurrentTab: (tab) => set({ currentTab: tab }),
  setHelperTab: (tab) => set({ helperTab: tab }),
  toggleVolume: (id) =>
    set((state) => ({
      expandedVolumeIds: state.expandedVolumeIds.includes(id)
        ? state.expandedVolumeIds.filter((volumeId) => volumeId !== id)
        : [...state.expandedVolumeIds, id],
    })),
  updateChapterContent: (id, html) =>
    set((state) => ({
      localChapters: state.localChapters.map((chapter) =>
        chapter.id === id
          ? {
              ...chapter,
              content: html,
              wordCount: countChineseFriendlyWords(htmlToPlainText(html)),
              updatedAt: `${formatNowLabel()} · 已编辑`,
            }
          : chapter
      ),
    })),
  reorderChaptersInVolume: (volumeId, orderedIds) =>
    set((state) => {
      const targetMap = new Map(orderedIds.map((id, index) => [id, index + 1]))
      return {
        localChapters: state.localChapters.map((chapter) =>
          chapter.volumeId === volumeId && targetMap.has(chapter.id)
            ? { ...chapter, order: targetMap.get(chapter.id)! }
            : chapter
        ),
      }
    }),
  setRewriteMode: (mode) => set({ rewriteMode: mode }),
  setRewriteTone: (tone) => set({ rewriteTone: tone }),
  setRewriteOutput: (output) => set({ rewriteOutput: output }),
  setRewriteScope: (scope) => set({ rewriteScope: scope }),
  setThinkingLevel: (level) => set({ thinkingLevel: level }),
  toggleAutoContinue: () => set((state) => ({ autoContinue: !state.autoContinue })),
  toggleKeepCanon: () => set((state) => ({ keepCanon: !state.keepCanon })),
  setSelectionText: (text) => set({ selectionText: text }),
  setSelectedParagraphIndex: (index) => set({ selectedParagraphIndex: index }),
  setPromptText: (text) => set({ promptText: text }),
  toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),
  addCharacter: (novelId, fields) =>
    set((state) => ({
      localCharacters: [...state.localCharacters, { ...fields, id: uid('char'), novelId }],
    })),
  updateCharacter: (id, fields) =>
    set((state) => ({
      localCharacters: state.localCharacters.map((item) => (item.id === id ? { ...item, ...fields } : item)),
    })),
  deleteCharacter: (id) =>
    set((state) => ({
      localCharacters: state.localCharacters.filter((item) => item.id !== id),
    })),
  addOutlineItem: (novelId, { relatedChapterIds, ...fields }) =>
    set((state) => ({
      localOutlines: [...state.localOutlines, { ...fields, relatedChapterIds: relatedChapterIds ?? [], id: uid('outline'), novelId }],
    })),
  updateOutlineItem: (id, fields) =>
    set((state) => ({
      localOutlines: state.localOutlines.map((item) => (item.id === id ? { ...item, ...fields } : item)),
    })),
  deleteOutlineItem: (id) =>
    set((state) => ({
      localOutlines: state.localOutlines.filter((item) => item.id !== id),
    })),
  addCharacterRelation: (novelId, fields) =>
    set((state) => ({
      localCharacterRelations: [...state.localCharacterRelations, { ...fields, id: uid('rel'), novelId }],
    })),
  updateCharacterRelation: (id, fields) =>
    set((state) => ({
      localCharacterRelations: state.localCharacterRelations.map((item) => (item.id === id ? { ...item, ...fields } : item)),
    })),
  deleteCharacterRelation: (id) =>
    set((state) => ({
      localCharacterRelations: state.localCharacterRelations.filter((item) => item.id !== id),
    })),
  addWorldEntry: (novelId, fields) =>
    set((state) => ({
      localWorldEntries: [...state.localWorldEntries, { ...fields, id: uid('wld'), novelId }],
    })),
  updateWorldEntry: (id, fields) =>
    set((state) => ({
      localWorldEntries: state.localWorldEntries.map((item) => (item.id === id ? { ...item, ...fields } : item)),
    })),
  deleteWorldEntry: (id) =>
    set((state) => ({
      localWorldEntries: state.localWorldEntries.filter((item) => item.id !== id),
    })),
  addTimelineEvent: (novelId, fields) =>
    set((state) => ({
      localTimelineEvents: [...state.localTimelineEvents, { ...fields, id: uid('timeline'), novelId }],
    })),
  updateTimelineEvent: (id, fields) =>
    set((state) => ({
      localTimelineEvents: state.localTimelineEvents.map((item) => (item.id === id ? { ...item, ...fields } : item)),
    })),
  deleteTimelineEvent: (id) =>
    set((state) => ({
      localTimelineEvents: state.localTimelineEvents.filter((item) => item.id !== id),
    })),
  deleteChapter: (chapterId) =>
    set((state) => buildStateAfterChapterDeletion(state, chapterId)),
  deleteNovel: (novelId) =>
    set((state) => buildStateAfterNovelDeletion(state, novelId)),
  rebuildStoryKnowledge: async (novelId) => {
    const state = get()
    const targetNovelId = novelId ?? state.currentNovelId
    const chaptersForNovel = state.localChapters.filter((chapter) => chapter.novelId === targetNovelId && !chapter.parentChapterId)
    if (!targetNovelId || !chaptersForNovel.length) return null

    const result = await fetchKnowledgeProjection({ novelId: targetNovelId, method: 'POST' })
    const projection = normalizeKnowledgeProjection(result)

    set((current) => ({
      ...mergeKnowledgeProjection(current, projection, targetNovelId),
      trajectories: result.jobOutcome === 'completed'
        ? [
            {
              id: uid('traj'),
              chapterId: chaptersForNovel[0].id,
              type: 'note',
              title: '重建知识视图',
              detail: `已基于本地知识库重建《${chaptersForNovel[0].title}》所在小说的人物、关系、设定与时间线视图。`,
              createdAt: formatNowLabel(),
            },
            ...current.trajectories,
          ]
        : current.trajectories,
    }))

    return result
  },
  pauseStoryKnowledgeRebuild: async (novelId) => {
    const state = get()
    const targetNovelId = novelId ?? state.currentNovelId
    if (!targetNovelId) return null

    const result = await fetchKnowledgeProjection({ novelId: targetNovelId, method: 'POST', action: 'pause' })
    const projection = normalizeKnowledgeProjection(result)
    set((current) => ({
      ...mergeKnowledgeProjection(current, projection, targetNovelId),
    }))
    return result
  },
  abortStoryKnowledgeRebuild: async (novelId) => {
    const state = get()
    const targetNovelId = novelId ?? state.currentNovelId
    if (!targetNovelId) return null

    const result = await fetchKnowledgeProjection({ novelId: targetNovelId, method: 'POST', action: 'abort' })
    const projection = normalizeKnowledgeProjection(result)
    set((current) => ({
      ...mergeKnowledgeProjection(current, projection, targetNovelId),
    }))
    return result
  },
  deleteStoryKnowledgeGraph: async (novelId) => {
    const state = get()
    const targetNovelId = novelId ?? state.currentNovelId
    if (!targetNovelId) return null

    const result = await fetchKnowledgeProjection({ novelId: targetNovelId, method: 'POST', action: 'delete-knowledge' })
    const projection = normalizeKnowledgeProjection(result)
    set((current) => ({
      ...mergeKnowledgeProjection(current, projection, targetNovelId),
    }))
    return result
  },
  refreshKnowledgeProjection: async (novelId, asOfChapter) => {
    const result = await fetchKnowledgeProjection({ novelId, asOfChapter, method: 'GET' })
    set((current) => ({
      ...mergeKnowledgeProjection(current, normalizeKnowledgeProjection(result), novelId),
    }))
  },
  setAISettings: (settings) =>
    set({ aiSettings: normalizeAISettings(settings) }),
  selectRewriteCandidate: (id) =>
    set((state) => ({
      rewriteCandidates: state.rewriteCandidates.map((item) => ({ ...item, selected: item.id === id })),
    })),
  applyRewriteCandidate: (id) =>
    set((state) => {
      const candidate = state.rewriteCandidates.find((item) => item.id === id)
      const chapter = state.localChapters.find((item) => item.id === state.currentChapterId)
      if (!candidate || !chapter) return state
      return {
        currentTab: 'editor',
        trajectories: [
          { id: uid('traj'), chapterId: chapter.id, type: 'apply', title: `应用 ${candidate.title}`, detail: `把当前${state.rewriteScope === 'chapter' ? '章节' : '片段'}替换为候选结果。`, createdAt: formatNowLabel() },
          ...state.trajectories,
        ],
        localChapters: state.localChapters.map((item) =>
          item.id === chapter.id
            ? { ...item, originalContent: item.originalContent ?? item.content, content: plainTextToHtml(candidate.content), wordCount: countChineseFriendlyWords(candidate.content), updatedAt: `${formatNowLabel()} · 已应用改写` }
            : item
        ),
        rewriteCandidates: state.rewriteCandidates.map((item) => ({ ...item, selected: item.id === id })),
      }
    }),
  insertRewriteCandidate: (id) =>
    set((state) => {
      const candidate = state.rewriteCandidates.find((item) => item.id === id)
      const chapter = state.localChapters.find((item) => item.id === state.currentChapterId)
      if (!candidate || !chapter) return state
      const nextText = `${htmlToPlainText(chapter.content)}\n\n${candidate.content}`
      return {
        currentTab: 'editor',
        trajectories: [
          { id: uid('traj'), chapterId: chapter.id, type: 'insert', title: `插入 ${candidate.title}`, detail: '将候选结果追加到当前章节末尾，保留原文。', createdAt: formatNowLabel() },
          ...state.trajectories,
        ],
        localChapters: state.localChapters.map((item) =>
          item.id === chapter.id ? { ...item, content: plainTextToHtml(nextText), wordCount: countChineseFriendlyWords(nextText), updatedAt: `${formatNowLabel()} · 已插入候选` } : item
        ),
      }
    }),
  branchRewriteCandidate: (id) => {
    const state = get()
    const candidate = state.rewriteCandidates.find((item) => item.id === id)
    if (!candidate) return
    get().addChapterBranch(state.currentChapterId, `${candidate.title} 分支`, candidate.content)
  },
  continueRewriteCandidate: (id) =>
    set((state) => {
      const candidate = state.rewriteCandidates.find((item) => item.id === id)
      const chapter = state.localChapters.find((item) => item.id === state.currentChapterId)
      if (!candidate || !chapter) return state
      const continued: RewriteCandidate = { ...candidate, id: uid('cand-cont'), title: `${candidate.title} · 继续推进`, summary: '沿着当前候选继续续写一段。', content: `${candidate.content}\n\n广播在下一秒响起，像一把看不见的尺，把所有人重新按回座位。林砚这才意识到，她刚刚做出的选择，已经让整节车厢开始注意她。`, createdAt: formatNowLabel(), selected: true }
      return {
        rewriteCandidates: [continued, ...state.rewriteCandidates.map((item) => ({ ...item, selected: item.id === continued.id }))],
        trajectories: [
          { id: uid('traj'), chapterId: chapter.id, type: 'continue', title: `续写 ${candidate.title}`, detail: '基于当前候选向后推进一段。', createdAt: formatNowLabel() },
          ...state.trajectories,
        ],
      }
    }),
  addPreset: () => set((state) => {
    const preset: RewritePreset = { id: uid('preset'), name: `自定义预设 ${state.presets.length + 1}`, mode: state.rewriteMode, tone: state.rewriteTone, prompt: state.promptText }
    return { presets: [preset, ...state.presets], selectedPresetId: preset.id }
  }),
  selectPreset: (id) => set((state) => {
    const preset = state.presets.find((item) => item.id === id)
    if (!preset) return state
    return { selectedPresetId: id, rewriteMode: preset.mode, rewriteTone: preset.tone, promptText: preset.prompt }
  }),
  updatePresetPrompt: (id, prompt) => set((state) => ({ presets: state.presets.map((preset) => (preset.id === id ? { ...preset, prompt } : preset)) })),
  updatePresetName: (id, name) => set((state) => ({ presets: state.presets.map((preset) => (preset.id === id ? { ...preset, name } : preset)) })),
  toggleConstraint: (id) => set((state) => ({ constraints: state.constraints.map((constraint) => constraint.id === id ? { ...constraint, enabled: !constraint.enabled } : constraint) })),
  cycleConstraintStrength: (id) => set((state) => ({ constraints: state.constraints.map((constraint) => {
    if (constraint.id !== id) return constraint
    const next: Record<RewriteConstraint['strength'], RewriteConstraint['strength']> = { off: 'soft', soft: 'strict', strict: 'off' }
    return { ...constraint, strength: next[constraint.strength] }
  }) })),
  generateRewriteBatch: async ({ prompt } = {}) => {
    const state = get()
    const chapter = state.localChapters.find((item) => item.id === state.currentChapterId)
    if (!chapter) return
    const mergedPrompt = prompt ?? state.promptText
    const source = getScopeSource(chapter, state.rewriteScope, state.selectedParagraphIndex, state.selectionText)
    const currentNovelCharacters = state.localCharacters.filter((item) => item.novelId === state.currentNovelId)
    const currentNovelRelations = state.localCharacterRelations.filter((item) => item.novelId === state.currentNovelId)
    const currentNovelWorldEntries = state.localWorldEntries.filter((item) => item.novelId === state.currentNovelId)
    const currentNovelTimelineEvents = state.localTimelineEvents.filter((item) => item.novelId === state.currentNovelId)
    const currentNovelOutlines = state.localOutlines.filter((item) => item.novelId === state.currentNovelId)
    const generationContext = buildGenerationContext({
      currentChapter: chapter,
      chapters: state.localChapters.filter((item) => item.novelId === state.currentNovelId && !item.parentChapterId),
      selectionText: state.selectionText,
      characters: currentNovelCharacters,
      relations: currentNovelRelations,
      worldEntries: currentNovelWorldEntries,
      timelineEvents: currentNovelTimelineEvents,
      outlines: currentNovelOutlines,
      recentChapterCount: 3,
    })

    try {
      const response = await fetch('/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceText: source,
          mode: state.rewriteMode,
          tone: state.rewriteTone,
          scope: state.rewriteScope,
          prompt: `${mergedPrompt}\n\n${generationContext}`,
          keepCanon: state.keepCanon,
          autoContinue: state.autoContinue,
          thoughtLevel: state.thinkingLevel,
        }),
      })
      const data = await response.json()
      const batchId = uid('batch')
      const nextCandidates: RewriteCandidate[] = (data.candidates ?? []).map((item: { title: string; summary: string; content: string }, index: number) => ({
        id: uid(`cand${index + 1}`),
        batchId,
        title: item.title,
        summary: `${item.summary}${data.provider ? ` · ${data.provider}` : ''}`,
        content: item.content,
        mode: state.rewriteMode,
        tone: state.rewriteTone,
        selected: index === 0,
        createdAt: formatNowLabel(),
        prompt: mergedPrompt,
        sourceExcerpt: source.slice(0, 120),
        actions: ['apply', 'insert', 'branch', 'continue'],
      }))
      const historyEntry: RewriteHistoryEntry = { id: uid('hist'), batchId, chapterId: chapter.id, scope: state.rewriteScope, sourceExcerpt: source.slice(0, 120), mode: state.rewriteMode, tone: state.rewriteTone, createdAt: formatNowLabel(), candidateIds: nextCandidates.map((item) => item.id) }
      set((current) => ({
        currentTab: 'rewrite',
        helperTab: 'trajectory',
        rewriteCandidates: nextCandidates.length ? nextCandidates : buildFallbackCandidates(source, current.rewriteMode, current.rewriteTone, mergedPrompt),
        rewriteHistory: [historyEntry, ...current.rewriteHistory],
        trajectories: [{ id: uid('traj'), chapterId: chapter.id, type: 'rewrite', title: `生成 ${nextCandidates.length || 3} 个候选`, detail: `范围：${current.rewriteScope} · 模式：${current.rewriteMode} · 风格：${current.rewriteTone}`, createdAt: formatNowLabel() }, ...current.trajectories],
      }))
    } catch {
      const nextCandidates = buildFallbackCandidates(source, state.rewriteMode, state.rewriteTone, mergedPrompt)
      const historyEntry: RewriteHistoryEntry = { id: uid('hist'), batchId: nextCandidates[0].batchId, chapterId: chapter.id, scope: state.rewriteScope, sourceExcerpt: source.slice(0, 120), mode: state.rewriteMode, tone: state.rewriteTone, createdAt: formatNowLabel(), candidateIds: nextCandidates.map((item) => item.id) }
      set((current) => ({ currentTab: 'rewrite', helperTab: 'trajectory', rewriteCandidates: nextCandidates, rewriteHistory: [historyEntry, ...current.rewriteHistory] }))
    }
  },
  addChapterBranch: (sourceChapterId, title, content) => set((state) => {
    const sourceChapter = state.localChapters.find((chapter) => chapter.id === sourceChapterId)
    if (!sourceChapter) return state
    const branchId = uid('branch')
    const branchNumber = state.localChapters.filter((chapter) => chapter.parentChapterId === sourceChapterId).length + 1
    const nextText = content ?? htmlToPlainText(sourceChapter.content)
    const nextChapter: Chapter = { ...sourceChapter, id: branchId, title: title ?? `${sourceChapter.title} · 分支 ${branchNumber}`, content: plainTextToHtml(nextText), originalContent: sourceChapter.content, kind: 'branch', parentChapterId: sourceChapterId, branchLabel: `B${branchNumber}`, order: sourceChapter.order + branchNumber / 10, status: 'draft', updatedAt: `${formatNowLabel()} · 新分支`, wordCount: countChineseFriendlyWords(nextText), trajectory: [...(sourceChapter.trajectory ?? []), '从父章节派生分支'] }
    return { currentChapterId: branchId, currentTab: 'editor', localChapters: [...state.localChapters, nextChapter], trajectories: [{ id: uid('traj'), chapterId: branchId, type: 'branch', title: `创建分支 ${nextChapter.branchLabel}`, detail: `从《${sourceChapter.title}》派生出新的改写支线。`, createdAt: formatNowLabel() }, ...state.trajectories] }
  }),
  createNewChapter: () => set((state) => {
    const volumeId = state.localVolumes[0]?.id
    if (!volumeId) return state
    const sameVolume = state.localChapters.filter((chapter) => chapter.volumeId === volumeId && !chapter.parentChapterId)
    const nextChapter: Chapter = { id: uid('ch'), novelId: state.currentNovelId, volumeId, title: `第${sameVolume.length + 1}章 新章节`, order: sameVolume.length + 1, content: '<p>在这里开始新的章节。</p>', originalContent: '<p>在这里开始新的章节。</p>', status: 'draft', wordCount: 10, updatedAt: `${formatNowLabel()} · 新建`, trajectory: ['新建章节'] }
    return { currentChapterId: nextChapter.id, currentTab: 'editor', localChapters: [...state.localChapters, nextChapter] }
  }),
  exportWorkspace: () => JSON.stringify(serializeState(get()), null, 2),
  importWorkspace: (payload) => set((state) => normalizeWorkspaceState({
    ...serializeState(state),
    ...payload,
  })),
  resetWorkspace: () => set((state) => ({
    ...initialState,
    presetCompatLibrary: state.presetCompatLibrary,
    presetCompatLibraryLoading: state.presetCompatLibraryLoading,
    presetCompatLibraryError: state.presetCompatLibraryError,
  })),
  loadPresetCompatLibrary: async () => {
    set({ presetCompatLibraryLoading: true, presetCompatLibraryError: '' })
    try {
      const library = await fetchPresetCompatLibrary()
      set({
        presetCompatLibrary: library,
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

    try {
      const workspaceResponse = await fetch('/api/workspace', { cache: 'no-store' })
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
      const message = error instanceof Error ? error.message : 'Failed to restore workspace'
      console.error('Workspace restore failed:', error)
      set({
        backendLoaded: true,
        isHydrated: true,
        backendLoadError: message,
        presetCompatLibraryLoading: false,
      })
      return
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
      await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serializeState(state)),
      })
      await get().savePresetCompatLibrary()
      try {
        const projection = await fetchKnowledgeProjection({
          novelId: state.currentNovelId || undefined,
          asOfChapter: resolveCurrentChapterOrder(state, state.currentNovelId || undefined),
        })
        set(() => ({
          ...normalizeKnowledgeProjection(projection),
        }))
      } catch (error) {
        console.error('Knowledge projection refresh failed after save:', error)
      }
    } finally {
      set({ isSaving: false })
    }
  },
  savePresetCompatLibrary: async () => {
    const { presetCompatLibrary } = get()
    set({ presetCompatLibraryLoading: true, presetCompatLibraryError: '' })
    try {
      const result = await savePresetCompatLibraryToBackend(presetCompatLibrary)
      set({
        presetCompatLibrary: result.library,
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
  importPresetCompatPreset: async (params) => {
    set({ presetCompatLibraryLoading: true, presetCompatLibraryError: '' })
    try {
      const result = await importPresetCompatPayload({ ...params, kind: 'preset' })
      set({
        presetCompatLibrary: result.library,
        presetCompatLibraryLoading: false,
        presetCompatLibraryError: '',
      })
      return {
        importedIds: result.importedIds,
        warnings: result.warnings,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import preset compat preset'
      set({
        presetCompatLibraryLoading: false,
        presetCompatLibraryError: message,
      })
      throw error
    }
  },
  importPresetCompatRegexBundle: async (params) => {
    set({ presetCompatLibraryLoading: true, presetCompatLibraryError: '' })
    try {
      const result = await importPresetCompatPayload({ ...params, kind: 'regex' })
      set({
        presetCompatLibrary: result.library,
        presetCompatLibraryLoading: false,
        presetCompatLibraryError: '',
      })
      return {
        importedIds: result.importedIds,
        warnings: result.warnings,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import preset compat regex bundle'
      set({
        presetCompatLibraryLoading: false,
        presetCompatLibraryError: message,
      })
      throw error
    }
  },
  bindPresetCompatPresetToSurface: (surfaceId, presetId) => set((state) => {
    const binding = state.presetCompatLibrary.surfaceBindings[surfaceId]
    if (!binding) {
      return state
    }

    if (presetId !== null && !state.presetCompatLibrary.presets[presetId]) {
      return {
        presetCompatLibraryError: 'preset_not_found',
      }
    }

    return {
      presetCompatLibrary: {
        ...state.presetCompatLibrary,
        surfaceBindings: {
          ...state.presetCompatLibrary.surfaceBindings,
          [surfaceId]: {
            ...binding,
            presetId,
            enabled: presetId === null ? binding.enabled : true,
          },
        },
      },
      presetCompatLibraryError: '',
    }
  }),
  deletePresetCompatPreset: (presetId) => set((state) => {
    const preset = state.presetCompatLibrary.presets[presetId]
    if (!preset) {
      return {
        presetCompatLibraryError: 'preset_not_found',
      }
    }

    const nextPresets = { ...state.presetCompatLibrary.presets }
    delete nextPresets[presetId]

    const nextSurfaceBindings = Object.fromEntries(
      Object.entries(state.presetCompatLibrary.surfaceBindings).map(([surfaceId, binding]) => [
        surfaceId,
        binding.presetId === presetId
          ? {
              ...binding,
              presetId: null,
              enabled: false,
            }
          : binding,
      ])
    ) as typeof state.presetCompatLibrary.surfaceBindings

    return {
      presetCompatLibrary: {
        ...state.presetCompatLibrary,
        presets: nextPresets,
        surfaceBindings: nextSurfaceBindings,
      },
      presetCompatLibraryError: '',
    }
  }),
  attachPresetCompatStandaloneRegex: (presetId, regexId) => set((state) => {
    const preset = state.presetCompatLibrary.presets[presetId]
    const regexRecord = state.presetCompatLibrary.standaloneRegexes[regexId]
    if (!preset || !regexRecord) {
      return {
        presetCompatLibraryError: !preset ? 'preset_not_found' : 'standalone_regex_not_found',
      }
    }

    if (preset.attachedStandaloneRegexIds.includes(regexId)) {
      return {
        presetCompatLibraryError: '',
      }
    }

    return {
      presetCompatLibrary: {
        ...state.presetCompatLibrary,
        presets: {
          ...state.presetCompatLibrary.presets,
          [presetId]: {
            ...preset,
            attachedStandaloneRegexIds: [...preset.attachedStandaloneRegexIds, regexId],
            updatedAt: new Date().toISOString(),
          },
        },
      },
      presetCompatLibraryError: '',
    }
  }),
  detachPresetCompatStandaloneRegex: (presetId, regexId) => set((state) => {
    const preset = state.presetCompatLibrary.presets[presetId]
    if (!preset) {
      return {
        presetCompatLibraryError: 'preset_not_found',
      }
    }

    return {
      presetCompatLibrary: {
        ...state.presetCompatLibrary,
        presets: {
          ...state.presetCompatLibrary.presets,
          [presetId]: {
            ...preset,
            attachedStandaloneRegexIds: preset.attachedStandaloneRegexIds.filter((id) => id !== regexId),
            updatedAt: new Date().toISOString(),
          },
        },
      },
      presetCompatLibraryError: '',
    }
  }),
  updatePresetCompatPromptRule: (presetId, promptRuleId, updates) => set((state) => {
    const preset = state.presetCompatLibrary.presets[presetId]
    if (!preset) {
      return {
        presetCompatLibraryError: 'preset_not_found',
      }
    }

    return {
      presetCompatLibrary: {
        ...state.presetCompatLibrary,
        presets: {
          ...state.presetCompatLibrary.presets,
          [presetId]: {
            ...preset,
            promptRules: preset.promptRules.map((promptRule) =>
              promptRule.id === promptRuleId ? { ...promptRule, ...updates } : promptRule
            ),
            updatedAt: new Date().toISOString(),
          },
        },
      },
      presetCompatLibraryError: '',
    }
  }),
  updatePresetCompatEmbeddedRegex: (presetId, regexId, updates) => set((state) => {
    const preset = state.presetCompatLibrary.presets[presetId]
    if (!preset) {
      return {
        presetCompatLibraryError: 'preset_not_found',
      }
    }

    return {
      presetCompatLibrary: {
        ...state.presetCompatLibrary,
        presets: {
          ...state.presetCompatLibrary.presets,
          [presetId]: {
            ...preset,
            embeddedRegexes: preset.embeddedRegexes.map((regexRecord) =>
              regexRecord.id === regexId ? { ...regexRecord, ...updates } : regexRecord
            ),
            updatedAt: new Date().toISOString(),
          },
        },
      },
      presetCompatLibraryError: '',
    }
  }),
  updatePresetCompatStandaloneRegex: (regexId, updates) => set((state) => {
    const regexRecord = state.presetCompatLibrary.standaloneRegexes[regexId]
    if (!regexRecord) {
      return {
        presetCompatLibraryError: 'standalone_regex_not_found',
      }
    }

    return {
      presetCompatLibrary: {
        ...state.presetCompatLibrary,
        standaloneRegexes: {
          ...state.presetCompatLibrary.standaloneRegexes,
          [regexId]: {
            ...regexRecord,
            ...updates,
          },
        },
      },
      presetCompatLibraryError: '',
    }
  }),
  exportPresetCompatPreset: (presetId) => {
    const preset = get().presetCompatLibrary.presets[presetId]
    return preset ? exportPresetCompatPresetJson(get().presetCompatLibrary, presetId) : null
  },
  exportPresetCompatStandaloneRegexBundle: (regexIds) => exportPresetCompatStandaloneRegexJson(get().presetCompatLibrary, regexIds),
  saveAISettings: async () => {
    const { aiSettings } = get()
    if (!aiSettings) return
    const response = await fetch('/api/settings/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(aiSettings),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { error?: string } | null
      throw new Error(error?.error || 'Failed to save AI settings')
    }
    const latest = await fetch('/api/settings/ai', { cache: 'no-store' }).then((res) => res.json())
    set({ aiSettings: normalizeAISettings(latest) })
  },
}))
