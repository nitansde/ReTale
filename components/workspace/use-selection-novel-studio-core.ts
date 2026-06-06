"use client"

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { getVisibleAdvancedContextPromptBlocks } from '@/components/graph/graph-review-panel'
import { Building2, Globe, LoaderCircle, MapPin, ScrollText, Users } from 'lucide-react'
import {
  type PendingSourceJump,
  useWorkspaceChapterSelection,
  type WorkspaceActionMode,
  type WorkspaceFloatingPosition,
} from '@/components/workspace/use-workspace-chapter-selection'
import { type WorkspaceRefTab, useWorkspacePaneState } from '@/components/workspace/use-workspace-pane-state'
import {
  readWorkspaceSelectionFromSearchParams,
  resolveWorkspaceSelection,
  toChapterTimelineSelection,
  writeWorkspaceSelectionToSearchParams,
} from '@/components/workspace/workspace-selection'
import { normalizeAISettings } from '@/lib/ai-settings'
import { useI18n } from '@/lib/i18n/provider'
import type { PresetCompatSurfaceId } from '@/lib/preset-compat/types'
import { formatStoryBranchInstructionPreview } from '@/lib/story-branch-labels'
import { createPresetCompatSessionStateKey } from '@/lib/workspace-state'
import {
  AI_SCENARIO_META,
  getAIScenarioMeta,
  buildChapterLineExcerpt,
  callChapterGraphContextApi,
  CHAPTER_PAGE_SIZE,
  DEFAULT_GRAPH_REVIEW_CONTROLS,
  DEFAULT_REWRITE_PROMPT,
  extractSelection,
  filterWorkspaceVisibleCharacters,
  findSourceBlock,
  formatEmbeddingProviderLabel,
  formatKnowledgeEtaLabel,
  formatKnowledgeJobStatusLabel,
  formatKnowledgeRebuildChapterRangeLabel,
  formatStageDuration,
  formatRetrievalIndexDetail,
  GenerationState,
  groupWorldEntriesForWorkspaceRail,
  HANLP_BOOTSTRAP_STAGE_KEY,
  HANLP_CACHE_STATUS_LABELS,
  HanlpCacheSnapshot,
  KnowledgeActionLoading,
  KnowledgeRebuildRangeMode,
  KnowledgeRebuildStatus,
  KnowledgeStatusOverview,
  normalizeKnowledgeRebuildChapterRangeInput,
  normalizeSourceSearchText,
  OllamaModelOption,
  OpenAICompatibleModelOption,
  OUTLINE_TYPE_LABELS,
  PendingContinueBlockRewriteLaunch,
  PendingFutureJumpRewriteLaunch,
  PendingWhatIfRewriteLaunch,
  RAW_TEXT_PRECOMPUTE_STAGE_KEY,
  RecoverableRewriteJob,
  resolveCacheDeleteState,
  resolveCurrentNodeMetrics,
  resolveGraphSelection,
  resolveHanlpCacheDeleteState,
  resolveKnowledgeJobPhaseLabel,
  resolveKnowledgeRebuildFailureMessage,
  resolveRetrievalTaskControlsState,
  RewriteFlowState,
  RewriteLaunchSource,
  shouldLoadWorkspaceFromBackendOnMount,
  sortCharactersForWorkspaceRail,
  FutureMapLaunchState,
  TOOLBAR_EDGE_PADDING,
  TOOLBAR_OFFSET_Y,
  toPresetCompatSessionSurfaceId,
  toProgressPercent,
  toRewriteCandidateFromRecoverableResult,
} from '@/components/workspace/selection-novel-studio-helpers'
import type {
  ChapterGraphContextData,
  GenerationContextBuildData,
  GraphReviewControls,
  GraphSelection,
} from '@/components/graph/types'
import type { GraphEdge } from '@/lib/server/graph-types'
import { htmlToPlainText } from '@/lib/utils'
import type {
  ChapterTimelineItem,
  StoryTimelineResponse,
  TimelineSelection,
} from '@/lib/story-branch-types'
import type {
  AIProvider,
  AISettings,
  AIScenarioKey,
  Chapter,
  Character,
  OutlineItem,
  TimelineEvent,
  Volume,
  WorldEntry,
} from '@/lib/types'

type SelectionNovelStudioCoreParams = {
  loadFromBackend: () => Promise<unknown>
  saveToBackend: () => Promise<unknown>
  backendLoaded: boolean
  currentNovelId: string
  localNovels: Array<{ id: string; title: string }>
  localVolumes: Volume[]
  localChapters: Chapter[]
  currentChapterId: string
  setCurrentChapterId: (chapterId: string) => void
  updateChapterContent: (chapterId: string, content: string) => void
  aiSettings: AISettings | undefined
  setAISettings: (settings: AISettings) => void
  refreshKnowledgeProjection: (novelId: string, asOfChapter?: number) => Promise<unknown>
  clearPresetCompatSessionStateForSelection: (selection: TimelineSelection, surfaces?: PresetCompatSurfaceId[], phase?: string) => void
  resetPresetCompatSessionStateForSelection: (selection: TimelineSelection, surfaces?: PresetCompatSurfaceId[], phase?: string) => void
  presetCompatSessionState: Record<string, { phase?: string | null } | undefined>
  localCharacters: Character[]
  localWorldEntries: WorldEntry[]
  localTimelineEvents: TimelineEvent[]
  localOutlines: OutlineItem[]
  autosaveSignature: string
}

export function useSelectionNovelStudioCore(params: SelectionNovelStudioCoreParams) {
  const { locale, t } = useI18n()
  const scenarioMeta = getAIScenarioMeta(locale)
  const router = useRouter()
  const {
    leftPanelOpen,
    setLeftPanelOpen,
    chapterListState,
    setChapterListState,
    centerPaneView,
    setCenterPaneView,
    refTab,
    setRefTab,
    settingsOpen,
    setSettingsOpen,
    confirmDeleteKnowledge,
    setConfirmDeleteKnowledge,
  } = useWorkspacePaneState()
  const [selectionText, setSelectionText] = useState('')
  const [lockedSelectionText, setLockedSelectionText] = useState('')
  const [toolbarPos, setToolbarPos] = useState<WorkspaceFloatingPosition | null>(null)
  const [activeMode, setActiveMode] = useState<WorkspaceActionMode | null>(null)
  const [rewritePrompt, setRewritePrompt] = useState(t('workspace.rewrite.defaultPrompt'))
  const [rewriteState, setRewriteState] = useState<GenerationState>({ loading: false, result: '', error: '' })
  const [rewriteFlow, setRewriteFlow] = useState<RewriteFlowState>({
    loading: false,
    error: '',
    provider: '',
    candidates: [],
    selectedIndex: 0,
    jobId: null,
    jobStatus: null,
    jobCurrentStep: null,
  })
  const [generationContext, setGenerationContext] = useState<GenerationContextBuildData | null>(null)
  const [graphContext, setGraphContext] = useState<GenerationContextBuildData['graphContext'] | null>(null)
  const [contextPreviewLoading, setContextPreviewLoading] = useState(false)
  const [contextPreviewError, setContextPreviewError] = useState('')
  const [graphReviewLoading, setGraphReviewLoading] = useState(false)
  const [currentBranchMetricsOverride, setCurrentBranchMetricsOverride] = useState<{
    nodeId: string
    currentText: string
    inputTokens: number | null
    outputTokens: number | null
  } | null>(null)
  const continueBlockMetricsNodeIdRef = useRef<string | null>(null)
  const whatIfMetricsNodeIdRef = useRef<string | null>(null)
  const futureJumpMetricsNodeIdRef = useRef<string | null>(null)
  const updateBranchMetricsOverride = useCallback((nodeId: string, metrics: {
    currentText: string
    inputTokens: number | null
    outputTokens: number | null
  }) => {
    setCurrentBranchMetricsOverride((current) => {
      if (
        current?.nodeId === nodeId
        && current.currentText === metrics.currentText
        && current.inputTokens === metrics.inputTokens
        && current.outputTokens === metrics.outputTokens
      ) {
        return current
      }

      return { nodeId, ...metrics }
    })
  }, [])
  const handleWhatIfMetricsChange = useCallback((metrics: { currentText: string; inputTokens: number | null; outputTokens: number | null }) => {
    const nodeId = whatIfMetricsNodeIdRef.current
    if (!nodeId) return
    updateBranchMetricsOverride(nodeId, metrics)
  }, [updateBranchMetricsOverride])
  const handleContinueBlockMetricsChange = useCallback((metrics: { currentText: string; inputTokens: number | null; outputTokens: number | null }) => {
    const nodeId = continueBlockMetricsNodeIdRef.current
    if (!nodeId) return
    updateBranchMetricsOverride(nodeId, metrics)
  }, [updateBranchMetricsOverride])
  const handleFutureJumpMetricsChange = useCallback((metrics: { currentText: string; inputTokens: number | null; outputTokens: number | null }) => {
    const nodeId = futureJumpMetricsNodeIdRef.current
    if (!nodeId) return
    updateBranchMetricsOverride(nodeId, metrics)
  }, [updateBranchMetricsOverride])
  const [graphReviewControls, setGraphReviewControls] = useState<GraphReviewControls>(DEFAULT_GRAPH_REVIEW_CONTROLS)
  const [contextPanelOpen, setContextPanelOpen] = useState(false)
  const [graphSelection, setGraphSelection] = useState<GraphSelection>(null)
  const [evidenceDrawerOpen, setEvidenceDrawerOpen] = useState(false)
  const [disabledContextBlockIds, setDisabledContextBlockIds] = useState<string[]>([])
  const [excludedGraphEdgeIds, setExcludedGraphEdgeIds] = useState<string[]>([])
  const [excludedEvidenceIds, setExcludedEvidenceIds] = useState<string[]>([])
  const [graphMutationPendingId, setGraphMutationPendingId] = useState<string | null>(null)
  const [graphMutationError, setGraphMutationError] = useState('')
  const [chapterGraphData, setChapterGraphData] = useState<ChapterGraphContextData | null>(null)
  const [chapterGraphLoading, setChapterGraphLoading] = useState(false)
  const [chapterGraphError, setChapterGraphError] = useState('')
  const [chapterGraphControls, setChapterGraphControls] = useState<GraphReviewControls>(DEFAULT_GRAPH_REVIEW_CONTROLS)
  const [chapterGraphSelection, setChapterGraphSelection] = useState<GraphSelection>(null)
  const [pendingSourceJump, setPendingSourceJump] = useState<PendingSourceJump | null>(null)
  const [workspaceSelection, setWorkspaceSelection] = useState<TimelineSelection | null>(null)
  const [storyTimelineData, setStoryTimelineData] = useState<StoryTimelineResponse | null>(null)
  const [storyTimelineError, setStoryTimelineError] = useState('')
  const [copied, setCopied] = useState<'rewrite' | 'roleplay' | null>(null)
  const [toast, setToast] = useState('')
  const [saveContinueBlockPending, setSaveContinueBlockPending] = useState(false)
  const [saveContinueBlockError, setSaveContinueBlockError] = useState('')
  const [roleplaySessionStarting, setRoleplaySessionStarting] = useState(false)
  const [deletingBranchNodeId, setDeletingBranchNodeId] = useState<string | null>(null)
  const [pendingWhatIfRewriteLaunch, setPendingWhatIfRewriteLaunch] = useState<PendingWhatIfRewriteLaunch | null>(null)
  const [pendingFutureJumpRewriteLaunch, setPendingFutureJumpRewriteLaunch] = useState<PendingFutureJumpRewriteLaunch | null>(null)
  const [pendingContinueBlockRewriteLaunch, setPendingContinueBlockRewriteLaunch] = useState<PendingContinueBlockRewriteLaunch | null>(null)
  const [activeFutureJumpRewriteContext, setActiveFutureJumpRewriteContext] = useState<PendingFutureJumpRewriteLaunch | null>(null)
  const [activeContinueBlockRewriteContext, setActiveContinueBlockRewriteContext] = useState<PendingContinueBlockRewriteLaunch | null>(null)
  const [rewriteLaunchSource, setRewriteLaunchSource] = useState<RewriteLaunchSource>('chapter')
  const [rewriteSourceTextOverride, setRewriteSourceTextOverride] = useState('')
  const [futureMapLaunch, setFutureMapLaunch] = useState<FutureMapLaunchState | null>(null)
  const [knowledgeRebuilding, setKnowledgeRebuilding] = useState(false)
  const [presetCompatLibraryOpen, setPresetCompatLibraryOpen] = useState(false)
  const [knowledgeRebuildStatus, setKnowledgeRebuildStatus] = useState<KnowledgeRebuildStatus | null>(null)
  const [hanlpCacheSnapshot, setHanlpCacheSnapshot] = useState<HanlpCacheSnapshot | null>(null)
  const [knowledgeStatusOverview, setKnowledgeStatusOverview] = useState<KnowledgeStatusOverview | null>(null)
  const [knowledgeActionLoading, setKnowledgeActionLoading] = useState<KnowledgeActionLoading>(null)
  const [confirmDeleteHanlpCache, setConfirmDeleteHanlpCache] = useState(false)
  const [confirmDeleteExtractionCache, setConfirmDeleteExtractionCache] = useState(false)
  const [confirmDeleteEmbeddingCache, setConfirmDeleteEmbeddingCache] = useState(false)
  const [knowledgeRebuildRangeMode, setKnowledgeRebuildRangeMode] = useState<KnowledgeRebuildRangeMode>('all')
  const [knowledgeRebuildFirstChapterCount, setKnowledgeRebuildFirstChapterCount] = useState('5')
  const [knowledgeRebuildStartChapter, setKnowledgeRebuildStartChapter] = useState('1')
  const [knowledgeRebuildEndChapter, setKnowledgeRebuildEndChapter] = useState('5')
  const [ollamaModelsByScenario, setOllamaModelsByScenario] = useState<Record<AIScenarioKey, OllamaModelOption[]>>({ rewrite: [], knowledgeExtraction: [], embeddings: [] })
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState<Record<AIScenarioKey, boolean>>({ rewrite: false, knowledgeExtraction: false, embeddings: false })
  const [ollamaModelsError, setOllamaModelsError] = useState<Record<AIScenarioKey, string>>({ rewrite: '', knowledgeExtraction: '', embeddings: '' })
  const [openAICompatibleModelsByScenario, setOpenAICompatibleModelsByScenario] = useState<Record<AIScenarioKey, OpenAICompatibleModelOption[]>>({ rewrite: [], knowledgeExtraction: [], embeddings: [] })
  const [openAICompatibleModelsLoading, setOpenAICompatibleModelsLoading] = useState<Record<AIScenarioKey, boolean>>({ rewrite: false, knowledgeExtraction: false, embeddings: false })
  const [editState, setEditState] = useState<{ type: 'char' | 'outline' | 'world' | 'relation' | 'timeline' | null; id: string | null; form: Record<string, string> }>({ type: null, id: null, form: {} })
  const knowledgePanelReadOnly = true

  const editorRef = useRef<HTMLDivElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autosaveLatestSignatureRef = useRef(params.autosaveSignature)
  const autosaveLastSavedSignatureRef = useRef<string | null>(null)
  const autosaveInFlightRef = useRef(false)
  const hydratedRef = useRef(false)
  const workspaceSelectionHydratedRef = useRef(false)
  const lastActiveKnowledgeJobIdRef = useRef<string | null>(null)
  const openAICompatibleModelsRequestRef = useRef<Record<AIScenarioKey, number>>({ rewrite: 0, knowledgeExtraction: 0, embeddings: 0 })
  const chapterGraphRequestRef = useRef(0)
  const storyTimelineRequestRef = useRef(0)
  const resolvedAISettings = useMemo(() => normalizeAISettings(params.aiSettings), [params.aiSettings])

  const updateAISettings = useCallback((updater: (current: AISettings) => AISettings) => {
    params.setAISettings(normalizeAISettings(updater(resolvedAISettings)))
  }, [params.setAISettings, resolvedAISettings])

  const updateScenarioProvider = useCallback((scenario: AIScenarioKey, provider: AIProvider) => {
    updateAISettings((current) => ({ ...current, [scenario]: { ...current[scenario], provider } }))
  }, [updateAISettings])

  const updateScenarioOpenAIField = useCallback((scenario: AIScenarioKey, field: 'baseUrl' | 'apiKey' | 'model', value: string) => {
    updateAISettings((current) => ({
      ...current,
      [scenario]: {
        ...current[scenario],
        openAICompatible: {
          ...current[scenario].openAICompatible,
          [field]: value,
          ...(field === 'apiKey' && value.trim() ? { apiKeyConfigured: true } : {}),
        },
      },
    }))
  }, [updateAISettings])

  const updateScenarioOllamaField = useCallback((scenario: AIScenarioKey, field: 'baseUrl' | 'model', value: string) => {
    updateAISettings((current) => ({
      ...current,
      [scenario]: {
        ...current[scenario],
        ollama: { ...current[scenario].ollama, [field]: value },
      },
    }))
  }, [updateAISettings])

  const updateKnowledgeExtractionParallelism = useCallback((provider: AIProvider, value: string) => {
    updateAISettings((current) => {
      const parsed = Number.parseInt(value, 10)
      const nextParallelism = Number.isFinite(parsed) ? Math.max(1, Math.min(20, parsed)) : provider === 'openai-compatible' ? 5 : 1
      return {
        ...current,
        knowledgeExtraction: {
          ...current.knowledgeExtraction,
          [provider === 'openai-compatible' ? 'openAICompatible' : 'ollama']: {
            ...current.knowledgeExtraction[provider === 'openai-compatible' ? 'openAICompatible' : 'ollama'],
            parallelism: nextParallelism,
          },
        },
      }
    })
  }, [updateAISettings])

  const updateEmbeddingBatchSize = useCallback((value: string) => {
    updateAISettings((current) => {
      const parsed = Number.parseInt(value, 10)
      const nextEmbeddingBatchSize = Number.isFinite(parsed) ? Math.max(1, Math.min(128, parsed)) : 16
      return { ...current, embeddings: { ...current.embeddings, embeddingBatchSize: nextEmbeddingBatchSize } }
    })
  }, [updateAISettings])

  const showKnowledgeToast = useCallback((message: string, duration = 1800) => {
    setToast(message)
    window.setTimeout(() => setToast(''), duration)
  }, [])

  useEffect(() => {
    autosaveLatestSignatureRef.current = params.autosaveSignature
  }, [params.autosaveSignature])

  useEffect(() => {
    if (!shouldLoadWorkspaceFromBackendOnMount(params.backendLoaded)) return
    params.loadFromBackend().catch(() => undefined)
  }, [params.backendLoaded, params.loadFromBackend])

  useEffect(() => {
    if (params.backendLoaded && params.localChapters.length === 0) {
      router.push('/library')
    }
  }, [params.backendLoaded, params.localChapters.length, router])

  const selectedKnowledgeStatusChapterOrder = useMemo(() => {
    return params.localChapters.find((chapter) => chapter.id === params.currentChapterId)?.order
  }, [params.currentChapterId, params.localChapters])

  useEffect(() => {
    if (!params.backendLoaded) return
    if (!hydratedRef.current) {
      hydratedRef.current = true
      autosaveLastSavedSignatureRef.current = params.autosaveSignature
      return
    }
    if (params.autosaveSignature === autosaveLastSavedSignatureRef.current) return
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      if (autosaveInFlightRef.current) return
      const targetSignature = autosaveLatestSignatureRef.current
      if (targetSignature === autosaveLastSavedSignatureRef.current) return
      autosaveInFlightRef.current = true
      params.saveToBackend()
        .then(() => {
          autosaveLastSavedSignatureRef.current = targetSignature
        })
        .catch(() => undefined)
        .finally(() => {
          autosaveInFlightRef.current = false
          const latestSignature = autosaveLatestSignatureRef.current
          if (latestSignature === autosaveLastSavedSignatureRef.current) return
          if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
          autosaveTimerRef.current = setTimeout(() => {
            const followUpSignature = autosaveLatestSignatureRef.current
            if (autosaveInFlightRef.current || followUpSignature === autosaveLastSavedSignatureRef.current) return
            autosaveInFlightRef.current = true
            params.saveToBackend()
              .then(() => {
                autosaveLastSavedSignatureRef.current = followUpSignature
              })
              .catch(() => undefined)
              .finally(() => {
                autosaveInFlightRef.current = false
              })
          }, 400)
        })
    }, 1200)
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    }
  }, [params.autosaveSignature, params.backendLoaded, params.saveToBackend])

  const getKnowledgePollDelay = useCallback((status: KnowledgeRebuildStatus | null, actionLoading: KnowledgeActionLoading) => {
    if (actionLoading) return 1_200
    if (status?.status === 'queued' || status?.status === 'running') return 1_500
    if (status?.status === 'paused') return 3_500
    return null
  }, [])

  useEffect(() => {
    if (!params.currentNovelId) {
      setConfirmDeleteKnowledge(false)
      setConfirmDeleteHanlpCache(false)
      setConfirmDeleteExtractionCache(false)
      setConfirmDeleteEmbeddingCache(false)
      const resetTimer = window.setTimeout(() => {
        setKnowledgeRebuildStatus(null)
        setHanlpCacheSnapshot(null)
        setKnowledgeStatusOverview(null)
      }, 0)
      lastActiveKnowledgeJobIdRef.current = null
      return () => {
        window.clearTimeout(resetTimer)
      }
    }

    const confirmResetTimer = window.setTimeout(() => {
      setConfirmDeleteKnowledge(false)
      setConfirmDeleteHanlpCache(false)
      setConfirmDeleteExtractionCache(false)
      setConfirmDeleteEmbeddingCache(false)
    }, 0)

    let cancelled = false
    let pollTimerId: number | null = null

    const scheduleNextPoll = (delay: number | null) => {
      if (cancelled || delay === null) return
      pollTimerId = window.setTimeout(() => {
        void syncRebuildStatus()
      }, delay)
    }

    const syncRebuildStatus = async () => {
      try {
        const searchParams = new URLSearchParams({ novelId: params.currentNovelId })
        searchParams.set('statusOnly', '1')
        const selectedChapterOrder = selectedKnowledgeStatusChapterOrder
        if (typeof selectedChapterOrder === 'number' && Number.isFinite(selectedChapterOrder) && selectedChapterOrder >= 1) {
          searchParams.set('asOfChapter', String(selectedChapterOrder))
        }

        const response = await fetch(`/api/knowledge-view?${searchParams.toString()}`, { cache: 'no-store' })
        const data = (await response.json()) as {
          ok?: boolean
          knowledgeRebuildStatus?: KnowledgeRebuildStatus | null
          hanlpCacheSnapshot?: HanlpCacheSnapshot | null
          knowledgeStatusOverview?: KnowledgeStatusOverview | null
        }

        if (cancelled || !response.ok || !data.ok) return

        const nextStatus = data.knowledgeRebuildStatus ?? null
        setHanlpCacheSnapshot(data.hanlpCacheSnapshot ?? null)
        setKnowledgeStatusOverview(data.knowledgeStatusOverview ?? null)
        const hadActiveJob = Boolean(lastActiveKnowledgeJobIdRef.current)
        const failureMessage = resolveKnowledgeRebuildFailureMessage(nextStatus)

        setKnowledgeRebuildStatus(nextStatus)

        if (nextStatus?.jobId && (nextStatus.status === 'queued' || nextStatus.status === 'running' || nextStatus.status === 'paused')) {
          lastActiveKnowledgeJobIdRef.current = nextStatus.jobId
          scheduleNextPoll(getKnowledgePollDelay(nextStatus, knowledgeActionLoading))
          return
        }

        if (nextStatus?.status === 'failed') {
          lastActiveKnowledgeJobIdRef.current = null
          if (hadActiveJob && !cancelled) {
      showKnowledgeToast(failureMessage ?? t('workspace.knowledge.failedDefault'), 2600)
          }
          return
        }

        if (hadActiveJob) {
          lastActiveKnowledgeJobIdRef.current = null
          await params.refreshKnowledgeProjection(params.currentNovelId, selectedChapterOrder)
          if (!cancelled && !knowledgeRebuilding && !knowledgeActionLoading) {
    showKnowledgeToast(t('workspace.knowledge.updated'))
          }
          return
        }

        const idleDelay = getKnowledgePollDelay(nextStatus, knowledgeActionLoading)
        if (idleDelay !== null) {
          scheduleNextPoll(idleDelay)
        }
      } catch {
        scheduleNextPoll(getKnowledgePollDelay(knowledgeRebuildStatus, knowledgeActionLoading))
      }
    }

    void syncRebuildStatus()

    return () => {
      cancelled = true
      window.clearTimeout(confirmResetTimer)
      if (pollTimerId !== null) {
        window.clearTimeout(pollTimerId)
      }
    }
  }, [getKnowledgePollDelay, params.currentNovelId, knowledgeActionLoading, knowledgeRebuildStatus, knowledgeRebuilding, params.refreshKnowledgeProjection, selectedKnowledgeStatusChapterOrder, setConfirmDeleteKnowledge, showKnowledgeToast])

  const novelVolumes = useMemo(() => params.localVolumes.filter((volume) => volume.novelId === params.currentNovelId).slice().sort((a, b) => a.order - b.order), [params.localVolumes, params.currentNovelId])
  const currentNovelMeta = useMemo(() => params.localNovels.find((novel) => novel.id === params.currentNovelId) ?? null, [params.localNovels, params.currentNovelId])

  const {
    sortedChapters,
    currentChapter,
    parentChapter,
    graphSourceMeta,
    selectChapter,
    resolveSourceChapter,
    jumpToGraphSource,
  } = useWorkspaceChapterSelection({
    localChapters: params.localChapters,
    currentNovelId: params.currentNovelId,
    currentChapterId: params.currentChapterId,
    setCurrentChapterId: params.setCurrentChapterId,
    setCenterPaneView,
    setPendingSourceJump,
    setLeftPanelOpen,
    resetControls: {
      defaultGraphReviewControls: DEFAULT_GRAPH_REVIEW_CONTROLS,
      resetPresetCompatSessionStateForChapter: (chapter) => {
        params.resetPresetCompatSessionStateForSelection(toChapterTimelineSelection(chapter), ['rewrite', 'future_jump', 'roleplay'])
      },
      setSelectionText,
      setLockedSelectionText,
      setGenerationContext,
      setGraphContext,
      setContextPreviewError,
      setGraphReviewControls,
      setGraphSelection,
      setEvidenceDrawerOpen,
      setDisabledContextBlockIds,
      setExcludedGraphEdgeIds,
      setExcludedEvidenceIds,
      setGraphMutationPendingId,
      setGraphMutationError,
      setToolbarPos,
      setActiveMode,
    },
  })
  const hasWorkspaceContent = params.localChapters.length > 0
  const mainlineChapters = useMemo(() => sortedChapters.filter((chapter) => !chapter.parentChapterId), [sortedChapters])
  const selectedKnowledgeRebuildChapterRange = useMemo(() => normalizeKnowledgeRebuildChapterRangeInput({
    mode: knowledgeRebuildRangeMode,
    firstChapterCount: knowledgeRebuildFirstChapterCount,
    startChapter: knowledgeRebuildStartChapter,
    endChapter: knowledgeRebuildEndChapter,
    maxChapterCount: mainlineChapters.length,
  }), [knowledgeRebuildEndChapter, knowledgeRebuildFirstChapterCount, knowledgeRebuildRangeMode, knowledgeRebuildStartChapter, mainlineChapters.length])
  const selectedKnowledgeRebuildChapterRangeLabel = useMemo(() => formatKnowledgeRebuildChapterRangeLabel(selectedKnowledgeRebuildChapterRange), [selectedKnowledgeRebuildChapterRange])
  const branchChaptersByParentId = useMemo(() => {
    const grouped = new Map<string, Chapter[]>()
    for (const chapter of sortedChapters) {
      if (!chapter.parentChapterId) continue
      const current = grouped.get(chapter.parentChapterId) ?? []
      current.push(chapter)
      grouped.set(chapter.parentChapterId, current)
    }
    return grouped
  }, [sortedChapters])
  const storyTimelineBranchId = params.currentNovelId ? `${params.currentNovelId}:main` : ''
  const fallbackStoryTimeline = useMemo<StoryTimelineResponse>(() => ({
    novelId: params.currentNovelId,
    branchId: storyTimelineBranchId,
    chapters: mainlineChapters.map<ChapterTimelineItem>((chapter) => ({ type: 'chapter', chapterNo: chapter.order, chapterId: chapter.id, title: chapter.title, wordCount: chapter.wordCount })),
    branchNodes: [],
    edges: [],
  }), [params.currentNovelId, mainlineChapters, storyTimelineBranchId])
  const resolvedStoryTimeline = storyTimelineData?.novelId === params.currentNovelId ? storyTimelineData : fallbackStoryTimeline
  const timelineChapterById = useMemo(() => new Map(resolvedStoryTimeline.chapters.map((chapter) => [chapter.chapterId, chapter] as const)), [resolvedStoryTimeline.chapters])
  const timelineNodeById = useMemo(() => new Map(resolvedStoryTimeline.branchNodes.map((node) => [node.id, node] as const)), [resolvedStoryTimeline.branchNodes])

  const handleTimelineSelection = useCallback((selection: TimelineSelection) => {
    if (currentChapter) {
      params.clearPresetCompatSessionStateForSelection(workspaceSelection ?? toChapterTimelineSelection(currentChapter))
    }
    setLeftPanelOpen(false)
    setWorkspaceSelection(selection)
    setActiveMode(null)
    setToolbarPos(null)
    if (selection.kind === 'chapter') {
      const selectedChapter = sortedChapters.find((chapter) => chapter.id === selection.chapterId)
      if (selectedChapter) {
        selectChapter(selectedChapter)
        return
      }
    }
  }, [currentChapter, params.clearPresetCompatSessionStateForSelection, selectChapter, sortedChapters, workspaceSelection])

  useEffect(() => {
    if (!params.backendLoaded || !params.currentNovelId || !currentChapter) return
    const timer = window.setTimeout(() => {
      void params.refreshKnowledgeProjection(params.currentNovelId, currentChapter.order).catch(() => undefined)
    }, 0)
    return () => {
      window.clearTimeout(timer)
    }
  }, [params.backendLoaded, currentChapter, params.currentNovelId, params.refreshKnowledgeProjection])

  useEffect(() => {
    workspaceSelectionHydratedRef.current = false
  }, [params.currentNovelId])

  useEffect(() => {
    if (!params.backendLoaded || !currentChapter || workspaceSelectionHydratedRef.current) return
    const requestedSelection = readWorkspaceSelectionFromSearchParams(new URLSearchParams(window.location.search))
    if (requestedSelection && requestedSelection.kind !== 'chapter' && !storyTimelineData) return
    setWorkspaceSelection(resolveWorkspaceSelection({ currentSelection: requestedSelection, currentChapter, branchNodes: resolvedStoryTimeline.branchNodes }))
    workspaceSelectionHydratedRef.current = true
  }, [params.backendLoaded, currentChapter, resolvedStoryTimeline.branchNodes, storyTimelineData])

  useEffect(() => {
    if (!params.backendLoaded || !currentChapter || !workspaceSelectionHydratedRef.current) return
    const currentUrl = new URL(window.location.href)
    const currentSearch = currentUrl.searchParams.toString()
    const nextSearchParams = writeWorkspaceSelectionToSearchParams(currentUrl.searchParams, workspaceSelection ?? toChapterTimelineSelection(currentChapter))
    const nextSearch = nextSearchParams.toString()
    if (nextSearch === currentSearch) return
    const nextUrl = `${currentUrl.pathname}${nextSearch ? `?${nextSearch}` : ''}${currentUrl.hash}`
    window.history.replaceState(window.history.state, '', nextUrl)
  }, [params.backendLoaded, currentChapter, workspaceSelection])

  useEffect(() => {
    setWorkspaceSelection((current) => resolveWorkspaceSelection({ currentSelection: current, currentChapter, branchNodes: resolvedStoryTimeline.branchNodes }))
  }, [currentChapter, resolvedStoryTimeline.branchNodes])

  const loadStoryTimeline = useCallback(async () => {
    if (!params.currentNovelId) {
      setStoryTimelineData(null)
      setStoryTimelineError('')
      return null
    }
    const requestId = storyTimelineRequestRef.current + 1
    storyTimelineRequestRef.current = requestId
    try {
      const searchParams = new URLSearchParams({ novelId: params.currentNovelId, branchId: storyTimelineBranchId })
      const response = await fetch(`/api/story-timeline?${searchParams.toString()}`, { cache: 'no-store' })
      const data = await response.json().catch(() => null) as (StoryTimelineResponse & { error?: string }) | null
      if (storyTimelineRequestRef.current !== requestId) return null
      if (!response.ok || !data) {
        setStoryTimelineData(null)
        setStoryTimelineError(data?.error ?? t('workspace.storyTimeline.loadFailed'))
        return null
      }
      setStoryTimelineData(data)
      setStoryTimelineError('')
      return data
    } catch {
      if (storyTimelineRequestRef.current !== requestId) return null
      setStoryTimelineData(null)
        setStoryTimelineError(t('workspace.storyTimeline.loadFailed'))
      return null
    }
  }, [params.currentNovelId, storyTimelineBranchId])

  useEffect(() => {
    void loadStoryTimeline()
  }, [loadStoryTimeline])

  const chapterListLimit = chapterListState[params.currentNovelId] ?? CHAPTER_PAGE_SIZE
  const chapterIndex = useMemo(() => (currentChapter ? sortedChapters.findIndex((chapter) => chapter.id === currentChapter.id) : -1), [currentChapter, sortedChapters])
  const chapterListTarget = useMemo(() => {
    if (chapterListLimit > CHAPTER_PAGE_SIZE) return chapterListLimit
    if (chapterIndex < 0) return CHAPTER_PAGE_SIZE
    if (chapterIndex >= CHAPTER_PAGE_SIZE - 10) {
      return Math.min(sortedChapters.length, Math.max(CHAPTER_PAGE_SIZE, chapterIndex + 20))
    }
    return CHAPTER_PAGE_SIZE
  }, [chapterIndex, chapterListLimit, sortedChapters.length])
  const chapterText = currentChapter ? htmlToPlainText(currentChapter.content) : ''
  const resolveEdgeSourceJumpTarget = (edge: GraphEdge) => {
    const location = edge.evidenceLocation
    if (!location) return null
    const targetChapter = resolveSourceChapter({ chapterNo: location.chapterNo })
    if (!targetChapter) return null
    return {
      chapterId: targetChapter.id,
      chapterNo: targetChapter.order,
      lineStart: location.lineStart ?? null,
      lineEnd: location.lineEnd ?? null,
      searchText: normalizeSourceSearchText(edge.evidenceQuote ?? buildChapterLineExcerpt(targetChapter, location.lineStart ?? null, location.lineEnd ?? null)),
    } satisfies PendingSourceJump
  }
  const resolveEvidenceSourceJumpTarget = (item: GenerationContextBuildData['lanceEvidence'][number]) => {
    const targetChapter = resolveSourceChapter({ chapterId: item.chapterId, chapterNo: item.chapterNo })
    if (!targetChapter) return null
    return { chapterId: targetChapter.id, chapterNo: targetChapter.order, lineStart: item.lineStart, lineEnd: item.lineEnd, searchText: normalizeSourceSearchText(item.text || buildChapterLineExcerpt(targetChapter, item.lineStart, item.lineEnd)) } satisfies PendingSourceJump
  }
  const mainKnowledgeRebuildStatus = useMemo(() => knowledgeRebuildStatus?.jobType === 'extract_chapter_knowledge' ? knowledgeRebuildStatus : null, [knowledgeRebuildStatus])
  const currentKnowledgeJobActive = knowledgeRebuildStatus?.status === 'running' || knowledgeRebuildStatus?.status === 'queued'
  const currentKnowledgeJobBusy = currentKnowledgeJobActive || knowledgeRebuildStatus?.status === 'paused'
  const knowledgeRebuildEtaMinutes = useMemo(() => mainKnowledgeRebuildStatus?.etaMinutes ?? null, [mainKnowledgeRebuildStatus])
  const knowledgeRebuildSteps = useMemo(() => mainKnowledgeRebuildStatus?.steps ?? [], [mainKnowledgeRebuildStatus])
  const knowledgeRebuildFailed = mainKnowledgeRebuildStatus?.status === 'failed'
  const knowledgeRebuildPaused = mainKnowledgeRebuildStatus?.status === 'paused'
  const knowledgeRebuildActive = mainKnowledgeRebuildStatus?.status === 'running' || mainKnowledgeRebuildStatus?.status === 'queued'
  const knowledgeRebuildBusy = knowledgeRebuildActive || knowledgeRebuildPaused
  const knowledgeRebuildFailureMessage = useMemo(() => resolveKnowledgeRebuildFailureMessage(mainKnowledgeRebuildStatus), [mainKnowledgeRebuildStatus])
  const knowledgeRebuildOverallPercent = useMemo(() => toProgressPercent(mainKnowledgeRebuildStatus?.progress), [mainKnowledgeRebuildStatus])
  const hanlpBootstrapStep = useMemo(() => knowledgeRebuildSteps.find((step) => step.key === HANLP_BOOTSTRAP_STAGE_KEY) ?? null, [knowledgeRebuildSteps])
  const rawEmbeddingStep = useMemo(() => knowledgeRebuildSteps.find((step) => step.key === 'raw-embedding') ?? null, [knowledgeRebuildSteps])
  const hanlpBootstrapCompletedChapterCount = mainKnowledgeRebuildStatus?.hanlpBootstrapCompletedChapterCount ?? null
  const hanlpBootstrapTotalChapterCount = mainKnowledgeRebuildStatus?.hanlpBootstrapTotalChapterCount ?? null
  const hanlpBootstrapProgress = mainKnowledgeRebuildStatus?.hanlpBootstrapProgress ?? hanlpBootstrapStep?.progress ?? null
  const hanlpBootstrapPercent = useMemo(() => hanlpBootstrapProgress === null ? null : toProgressPercent(hanlpBootstrapProgress), [hanlpBootstrapProgress])
  const hanlpBootstrapHasProgressTelemetry = Boolean(hanlpBootstrapPercent !== null || hanlpBootstrapCompletedChapterCount !== null || hanlpBootstrapTotalChapterCount !== null)
  const hanlpBootstrapCacheHitRatePercent = useMemo(() => {
    if (mainKnowledgeRebuildStatus?.hanlpCacheHitRate !== undefined) return toProgressPercent(mainKnowledgeRebuildStatus.hanlpCacheHitRate)
    const hitCount = mainKnowledgeRebuildStatus?.hanlpBootstrapCacheHitCount ?? 0
    const missCount = mainKnowledgeRebuildStatus?.hanlpBootstrapCacheMissCount ?? 0
    const total = hitCount + missCount
    return total > 0 ? toProgressPercent(hitCount / total) : null
  }, [mainKnowledgeRebuildStatus])
  const hanlpBootstrapTimingLabel = useMemo(() => {
    const duration = mainKnowledgeRebuildStatus?.stageTimingsMs?.[HANLP_BOOTSTRAP_STAGE_KEY]
    return typeof duration === 'number' && Number.isFinite(duration) ? formatStageDuration(duration) : null
  }, [mainKnowledgeRebuildStatus])
  const hanlpBootstrapPhaseLabel = useMemo(() => {
    const detail = hanlpBootstrapStep?.detail?.trim()
    if (detail) return detail
    const currentStep = mainKnowledgeRebuildStatus?.currentStep?.trim()
    if (knowledgeRebuildFailed) return t('workspace.knowledge.bootstrapFailed')
    if (currentStep) return currentStep
    if (knowledgeRebuildPaused) return t('workspace.knowledge.bootstrapWaitingContinue')
    return hanlpBootstrapHasProgressTelemetry ? t('workspace.knowledge.bootstrapCalculating') : t('workspace.knowledge.waitingProgress')
  }, [hanlpBootstrapHasProgressTelemetry, hanlpBootstrapStep, knowledgeRebuildFailed, knowledgeRebuildPaused, mainKnowledgeRebuildStatus, t])
  const hanlpBootstrapEtaLabel = useMemo(() => formatKnowledgeEtaLabel({ etaMinutes: hanlpBootstrapStep?.etaMinutes ?? knowledgeRebuildEtaMinutes, isPaused: knowledgeRebuildPaused, isFailed: knowledgeRebuildFailed, hasTelemetry: hanlpBootstrapHasProgressTelemetry }), [hanlpBootstrapHasProgressTelemetry, hanlpBootstrapStep, knowledgeRebuildEtaMinutes, knowledgeRebuildFailed, knowledgeRebuildPaused])
  const hanlpBootstrapStatusLine = useMemo(() => {
    const completed = hanlpBootstrapCompletedChapterCount
    const total = hanlpBootstrapTotalChapterCount
    if (typeof completed === 'number' && typeof total === 'number' && total > 0) {
        return completed >= total
          ? t('workspace.knowledge.bootstrapReadyStatus', { completed, total })
          : t('workspace.knowledge.bootstrapUpdatingStatus', { completed, total })
      }
    if (knowledgeRebuildFailed) return t('workspace.knowledge.bootstrapStoppedFailed')
    if (knowledgeRebuildPaused) return t('workspace.knowledge.bootstrapPausedStatus')
    if (knowledgeRebuildBusy) return hanlpBootstrapHasProgressTelemetry ? t('workspace.knowledge.bootstrapTelemetryRunning') : t('workspace.knowledge.bootstrapWaitingTelemetry')
    if (hanlpCacheSnapshot?.status === 'ready') return t('workspace.knowledge.bootstrapCacheReady')
    return t('workspace.knowledge.bootstrapNoProgress')
  }, [hanlpBootstrapCompletedChapterCount, hanlpBootstrapHasProgressTelemetry, hanlpBootstrapTotalChapterCount, hanlpCacheSnapshot, knowledgeRebuildBusy, knowledgeRebuildFailed, knowledgeRebuildPaused, t])
  const hanlpCacheStatus = mainKnowledgeRebuildStatus?.hanlpCacheStatus ?? hanlpCacheSnapshot?.status ?? 'empty'
  const hanlpCacheStatusLabel = HANLP_CACHE_STATUS_LABELS[hanlpCacheStatus]
  const hanlpSettingsLine = useMemo(() => {
    const snapshot = mainKnowledgeRebuildStatus?.hanlpSettingsSnapshot ?? hanlpCacheSnapshot?.settingsSnapshot
    if (!snapshot) return null
    return `script ${snapshot.hanlpScriptVersionHash.slice(0, 8)} · config ${snapshot.hanlpModelOrConfigHash.slice(0, 8)} · schema ${snapshot.outputSchemaVersion} · pipeline ${snapshot.pipelineVersion}`
  }, [hanlpCacheSnapshot, mainKnowledgeRebuildStatus])
  const hanlpCacheDeleteState = useMemo(() => resolveHanlpCacheDeleteState({ knowledgeRebuildStatus, knowledgeActionLoading }), [knowledgeActionLoading, knowledgeRebuildStatus])
  const extractionCacheDeleteState = useMemo(() => resolveCacheDeleteState({ knowledgeRebuildStatus, knowledgeActionLoading, idleHelperText: t('workspace.knowledge.extractionDeleteIdleHelper') }), [knowledgeActionLoading, knowledgeRebuildStatus, t])
  const embeddingCacheDeleteState = useMemo(() => resolveCacheDeleteState({ knowledgeRebuildStatus, knowledgeActionLoading, idleHelperText: t('workspace.knowledge.embeddingDeleteIdleHelper') }), [knowledgeActionLoading, knowledgeRebuildStatus, t])
  const rawTextEmbeddingProgress = mainKnowledgeRebuildStatus?.rawTextEmbeddingProgress
  const rawTextEmbeddingPercent = useMemo(() => rawTextEmbeddingProgress === undefined ? null : toProgressPercent(rawTextEmbeddingProgress), [rawTextEmbeddingProgress])
  const rawEmbeddingCurrentStep = useMemo(() => {
    const currentStep = mainKnowledgeRebuildStatus?.currentStep?.trim().toLowerCase() ?? ''
    return currentStep.includes('raw') && currentStep.includes('embedding')
  }, [mainKnowledgeRebuildStatus])
  const rawEmbeddingWaitingFinalization = Boolean(rawEmbeddingStep && rawEmbeddingStep.status === 'running')
  const rawEmbeddingRunningInParallel = knowledgeRebuildActive && !rawEmbeddingWaitingFinalization && ((rawTextEmbeddingPercent !== null && rawTextEmbeddingPercent < 100) || rawEmbeddingCurrentStep)
  const rawEmbeddingCompleted = rawTextEmbeddingPercent !== null && rawTextEmbeddingPercent >= 100
  const rawTextEmbeddingCacheHitRatePercent = useMemo(() => mainKnowledgeRebuildStatus?.rawTextEmbeddingCacheHitRate === undefined ? null : toProgressPercent(mainKnowledgeRebuildStatus.rawTextEmbeddingCacheHitRate), [mainKnowledgeRebuildStatus])
  const rawTextEmbeddingTimingLabel = useMemo(() => {
    const duration = mainKnowledgeRebuildStatus?.stageTimingsMs?.[RAW_TEXT_PRECOMPUTE_STAGE_KEY]
    return typeof duration === 'number' && Number.isFinite(duration) ? formatStageDuration(duration) : null
  }, [mainKnowledgeRebuildStatus])
  const rawTextEmbeddingSettingsLine = useMemo(() => {
    const snapshot = mainKnowledgeRebuildStatus?.embeddingSettingsSnapshot
    if (!snapshot) return null
    return `${formatEmbeddingProviderLabel(snapshot.provider)} · ${snapshot.model} · batch ${snapshot.embeddingBatchSize}`
  }, [mainKnowledgeRebuildStatus])
  const rawTextEmbeddingPhaseBadge = useMemo(() => {
    if (knowledgeRebuildFailed) return t('workspace.knowledge.bootstrapFailed')
    if (knowledgeRebuildPaused) return t('workspace.knowledge.etaPaused')
    if (rawEmbeddingWaitingFinalization) return t('workspace.knowledge.rawEmbeddingWaitingFinalization')
    if (rawEmbeddingRunningInParallel) return t('workspace.knowledge.rawEmbeddingParallel')
    if (rawEmbeddingCompleted) return t('workspace.knowledge.rawEmbeddingCompleted')
    return t('workspace.knowledge.rawEmbeddingNotStarted')
  }, [knowledgeRebuildFailed, knowledgeRebuildPaused, rawEmbeddingCompleted, rawEmbeddingRunningInParallel, rawEmbeddingWaitingFinalization, t])
  const rawTextEmbeddingStatusLine = useMemo(() => {
    if (knowledgeRebuildFailed) return rawTextEmbeddingPercent !== null ? t('workspace.knowledge.rawEmbeddingFailedPartial') : t('workspace.knowledge.rawEmbeddingFailed')
    if (knowledgeRebuildPaused) return rawTextEmbeddingPercent !== null ? t('workspace.knowledge.rawEmbeddingPausedPartial') : t('workspace.knowledge.rawEmbeddingPausedNoTelemetry')
    if (rawEmbeddingWaitingFinalization) return rawEmbeddingCompleted ? t('workspace.knowledge.rawEmbeddingWaitingIndexReady') : t('workspace.knowledge.rawEmbeddingWaitingIndex')
    if (rawEmbeddingRunningInParallel) return rawTextEmbeddingPercent !== null ? t('workspace.knowledge.rawEmbeddingParallelWithPercent') : t('workspace.knowledge.rawEmbeddingParallelWaiting')
    if (rawEmbeddingCompleted) return t('workspace.knowledge.rawEmbeddingDone')
    return t('workspace.knowledge.rawEmbeddingPending')
  }, [knowledgeRebuildFailed, knowledgeRebuildPaused, rawEmbeddingCompleted, rawEmbeddingRunningInParallel, rawEmbeddingWaitingFinalization, rawTextEmbeddingPercent, t])
  const retrievalIndexStep = useMemo(() => knowledgeRebuildSteps.find((step) => step.key === 'index') ?? null, [knowledgeRebuildSteps])
  const retrievalIndexOverview = knowledgeStatusOverview?.retrievalIndex ?? null
  const retrievalTaskStatus = useMemo(() => retrievalIndexOverview?.task ?? (knowledgeRebuildStatus?.jobType === 'rebuild_retrieval_index' ? knowledgeRebuildStatus : null), [knowledgeRebuildStatus, retrievalIndexOverview])
  const retrievalTaskPercent = useMemo(() => toProgressPercent(retrievalTaskStatus?.progress ?? 0), [retrievalTaskStatus])
  const retrievalTaskPhaseLabel = useMemo(() => resolveKnowledgeJobPhaseLabel(retrievalTaskStatus), [retrievalTaskStatus])
  const retrievalTaskStatusLabel = useMemo(() => formatKnowledgeJobStatusLabel(retrievalTaskStatus?.status), [retrievalTaskStatus])
  const retrievalControlsState = useMemo(() => resolveRetrievalTaskControlsState({ retrievalTask: retrievalTaskStatus, retrievalIndexOverview, knowledgeRebuildStatus, knowledgeActionLoading, knowledgeRebuilding }), [knowledgeActionLoading, knowledgeRebuildStatus, knowledgeRebuilding, retrievalIndexOverview, retrievalTaskStatus])
  const retrievalIndexStatusLine = useMemo(() => {
    if (retrievalTaskStatus?.status === 'failed') return resolveKnowledgeRebuildFailureMessage(retrievalTaskStatus) ?? t('workspace.knowledge.retrievalRefreshFailed')
    if (retrievalTaskStatus?.status === 'paused') return t('workspace.knowledge.retrievalPaused')
    if (retrievalTaskStatus?.status === 'queued') return t('workspace.knowledge.retrievalQueued')
    if (rawEmbeddingStep?.status === 'running' && mainKnowledgeRebuildStatus) return t('workspace.knowledge.retrievalWaitingEmbedding')
    if (retrievalTaskStatus?.status === 'running') return t('workspace.knowledge.retrievalRunning')
    return formatRetrievalIndexDetail(retrievalIndexOverview)
  }, [mainKnowledgeRebuildStatus, rawEmbeddingStep, retrievalIndexOverview, retrievalTaskStatus, t])
  const knowledgeGraphOverview = knowledgeStatusOverview?.knowledgeGraph ?? null
  const embeddingCacheOverview = knowledgeStatusOverview?.embeddingCache ?? null
  const currentKnowledgeRunningStepKey = useMemo(() => {
    const runningSteps = knowledgeRebuildSteps.filter((step) => step.status === 'running')
    if (runningSteps.length === 0) return null
    const unsaturatedStep = runningSteps.find((step) => toProgressPercent(step.progress) < 100)
    return (unsaturatedStep ?? rawEmbeddingStep ?? runningSteps[0]).key
  }, [knowledgeRebuildSteps, rawEmbeddingStep])

  const editor = useEditor({
    extensions: [StarterKit],
    content: currentChapter?.content ?? '',
    immediatelyRender: false,
    editorProps: { attributes: { class: 'px-5 py-6 sm:px-8 sm:py-8 font-[family:var(--font-noto-serif-sc)] text-[1.05rem] leading-9 text-zinc-200 outline-none min-h-[62vh]' } },
    onUpdate({ editor }) {
      if (currentChapter) {
        params.updateChapterContent(currentChapter.id, editor.getHTML())
      }
    },
  })

  useEffect(() => {
    if (editor && currentChapter && editor.getHTML() !== currentChapter.content) {
      editor.commands.setContent(currentChapter.content, { emitUpdate: false })
    }
  }, [editor, currentChapter])

  useEffect(() => {
    if (centerPaneView !== 'body' || !currentChapter || !pendingSourceJump) return
    if (pendingSourceJump.chapterId !== currentChapter.id) return
    const timer = window.setTimeout(() => {
      const root = editorRef.current
      const target = root ? findSourceBlock(root, pendingSourceJump.searchText) : null
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } else {
        const lineLabel = pendingSourceJump.lineStart !== null
          ? pendingSourceJump.lineEnd !== null && pendingSourceJump.lineEnd !== pendingSourceJump.lineStart
            ? t('workspace.knowledge.jumpSourceLineRange', { start: pendingSourceJump.lineStart, end: pendingSourceJump.lineEnd })
            : t('workspace.knowledge.jumpSourceLineSingle', { line: pendingSourceJump.lineStart })
          : t('workspace.knowledge.jumpSourceLocation')
        showKnowledgeToast(t('workspace.knowledge.jumpSourceToast', { chapter: pendingSourceJump.chapterNo, lineLabel }))
      }
      setPendingSourceJump(null)
    }, 120)
    return () => {
      window.clearTimeout(timer)
    }
  }, [centerPaneView, currentChapter, pendingSourceJump, showKnowledgeToast])

  const closePanel = useCallback(() => {
    if (activeMode && currentChapter) {
      params.resetPresetCompatSessionStateForSelection(workspaceSelection ?? toChapterTimelineSelection(currentChapter), [toPresetCompatSessionSurfaceId(activeMode)])
    }
    setActiveMode(null)
    setLockedSelectionText('')
    setSaveContinueBlockError('')
    setRewriteLaunchSource('chapter')
    setRewriteSourceTextOverride('')
    setActiveFutureJumpRewriteContext(null)
    setActiveContinueBlockRewriteContext(null)
    setPendingFutureJumpRewriteLaunch(null)
    setPendingContinueBlockRewriteLaunch(null)
    setGenerationContext(null)
    setGraphContext(null)
    setContextPreviewError('')
    setGraphReviewControls(DEFAULT_GRAPH_REVIEW_CONTROLS)
    setContextPanelOpen(false)
    setGraphSelection(null)
    setEvidenceDrawerOpen(false)
    setDisabledContextBlockIds([])
    setExcludedGraphEdgeIds([])
    setExcludedEvidenceIds([])
    setGraphMutationPendingId(null)
    setGraphMutationError('')
    setRewriteState((current) => ({ ...current, error: '' }))
  }, [activeMode, currentChapter, params, workspaceSelection])

  useEffect(() => {
    if (centerPaneView === 'body') return
    const timer = window.setTimeout(() => {
      setToolbarPos(null)
      setSelectionText('')
      setLockedSelectionText('')
      if (activeMode) closePanel()
    }, 0)
    return () => {
      window.clearTimeout(timer)
    }
  }, [activeMode, centerPaneView, closePanel])

  useEffect(() => {
    if (editor) {
      editorRef.current = editor.view.dom as HTMLDivElement
    }
  }, [editor])

  const currentNovelCharacters = params.localCharacters.filter((item) => item.novelId === params.currentNovelId)
  const currentNovelVisibleCharacters = useMemo(() => filterWorkspaceVisibleCharacters(currentNovelCharacters), [currentNovelCharacters])
  const currentNovelVisibleCharacterCount = currentNovelVisibleCharacters.length
  const currentNovelWorldEntries = params.localWorldEntries.filter((item) => item.novelId === params.currentNovelId)
  const currentNovelOutlines = params.localOutlines.filter((item) => item.novelId === params.currentNovelId)
  const currentNovelTimelineEvents = params.localTimelineEvents.filter((item) => item.novelId === params.currentNovelId).slice().sort((a, b) => a.order - b.order)
  const currentNovelCharactersSorted = useMemo(() => sortCharactersForWorkspaceRail(currentNovelVisibleCharacters), [currentNovelVisibleCharacters])
  const currentNovelWorldEntryGroups = useMemo(() => groupWorldEntriesForWorkspaceRail(currentNovelWorldEntries), [currentNovelWorldEntries])
  const workspaceKnowledgeTabs: Array<{ tab: WorkspaceRefTab; label: string; icon: typeof Users }> = [
    { tab: 'characters', label: t('workspace.referenceTab.characters'), icon: Users },
    { tab: 'organizations', label: t('workspace.referenceTab.organizations'), icon: Building2 },
    { tab: 'locations', label: t('workspace.referenceTab.locations'), icon: MapPin },
    { tab: 'worldbuilding', label: t('workspace.referenceTab.worldbuilding'), icon: Globe },
    { tab: 'outline', label: t('workspace.referenceTab.outline'), icon: ScrollText },
    { tab: 'timeline', label: t('workspace.referenceTab.timeline'), icon: ScrollText },
  ]

  useEffect(() => {
    const handler = () => {
      if (centerPaneView !== 'body') {
        setSelectionText('')
        setToolbarPos(null)
        return
      }
      const selection = extractSelection(editorRef.current)
      if (!selection) {
        if (activeMode) {
          setToolbarPos(null)
          return
        }
        setSelectionText('')
        setToolbarPos(null)
        return
      }
      setSelectionText(selection.text)
      setToolbarPos({ top: selection.rect.top - TOOLBAR_OFFSET_Y, left: selection.rect.left + selection.rect.width / 2 })
    }
    document.addEventListener('selectionchange', handler)
    window.addEventListener('resize', handler)
    window.addEventListener('scroll', handler, true)
    return () => {
      document.removeEventListener('selectionchange', handler)
      window.removeEventListener('resize', handler)
      window.removeEventListener('scroll', handler, true)
    }
  }, [activeMode, centerPaneView])

  useEffect(() => {
    if (!toolbarPos || activeMode || !toolbarRef.current) return
    const toolbarRect = toolbarRef.current.getBoundingClientRect()
    const nextTop = Math.min(Math.max(toolbarPos.top, TOOLBAR_EDGE_PADDING), window.innerHeight - toolbarRect.height - TOOLBAR_EDGE_PADDING)
    const nextLeft = Math.min(Math.max(toolbarPos.left, toolbarRect.width / 2 + TOOLBAR_EDGE_PADDING), window.innerWidth - toolbarRect.width / 2 - TOOLBAR_EDGE_PADDING)
    if (nextTop !== toolbarPos.top || nextLeft !== toolbarPos.left) {
      setToolbarPos({ top: nextTop, left: nextLeft })
    }
  }, [activeMode, toolbarPos])

  const loadChapterGraph = useCallback(async (chapter: Chapter, controls = chapterGraphControls, preserveData = false) => {
    const requestId = chapterGraphRequestRef.current + 1
    chapterGraphRequestRef.current = requestId
    const sourceChapter = chapter.parentChapterId ? parentChapter ?? null : chapter
    if (!params.currentNovelId || !sourceChapter) {
      setChapterGraphData(null)
      setChapterGraphSelection(null)
      setChapterGraphError('')
      setChapterGraphLoading(false)
      return
    }
    const novelId = params.currentNovelId
    if (!preserveData) {
      setChapterGraphData(null)
      setChapterGraphSelection(null)
    }
    setChapterGraphLoading(true)
    setChapterGraphError('')
    try {
      const paramsQuery = new URLSearchParams({
        novelId,
        chapterId: sourceChapter.id,
        hops: String(controls.maxHops),
        includeLowConfidence: String(!controls.hideLowConfidence),
        confirmedOnly: String(controls.confirmedOnly),
      })
      const data = await callChapterGraphContextApi(`/api/rag/graph-context?${paramsQuery.toString()}`)
      if (chapterGraphRequestRef.current !== requestId) return
      if (!data.ok || !data.graphContext || !data.chapterId || !data.branchId || !data.chapterTitle || !data.chapterNo || !data.novelId) {
          throw new Error(data.error || t('workspace.chapterGraph.loadFailed'))
      }
      const nextData = {
        ...(data as ChapterGraphContextData),
        sourceMeta: chapter.parentChapterId
          ? { mode: 'inherited-parent', chapterId: sourceChapter.id, chapterNo: sourceChapter.order, chapterTitle: sourceChapter.title }
          : { mode: 'direct', chapterId: sourceChapter.id, chapterNo: sourceChapter.order, chapterTitle: sourceChapter.title },
      } satisfies ChapterGraphContextData
      setChapterGraphData(nextData)
      const defaultNode = nextData.graphContext.seedEntities[0] ?? nextData.graphContext.nodes[0] ?? null
      setChapterGraphSelection(defaultNode ? { type: 'node', node: defaultNode } : null)
    } catch (error) {
      if (chapterGraphRequestRef.current !== requestId) return
      setChapterGraphError(error instanceof Error ? error.message : t('workspace.chapterGraph.loadFailed'))
      if (!preserveData) {
        setChapterGraphData(null)
        setChapterGraphSelection(null)
      }
    } finally {
      if (chapterGraphRequestRef.current === requestId) {
        setChapterGraphLoading(false)
      }
    }
  }, [chapterGraphControls, params.currentNovelId, parentChapter])

  useEffect(() => {
    if (centerPaneView !== 'graph' || !currentChapter) return
    if (currentChapter.parentChapterId && !parentChapter) {
      chapterGraphRequestRef.current += 1
      const timer = window.setTimeout(() => {
        setChapterGraphData(null)
        setChapterGraphSelection(null)
        setChapterGraphError(t('workspace.chapterGraph.noInheritedParent'))
        setChapterGraphLoading(false)
      }, 0)
      return () => {
        window.clearTimeout(timer)
      }
    }
    const timer = window.setTimeout(() => {
      void loadChapterGraph(currentChapter, chapterGraphControls)
    }, 0)
    return () => {
      window.clearTimeout(timer)
    }
  }, [centerPaneView, chapterGraphControls, currentChapter, loadChapterGraph, parentChapter])

  const handleChapterGraphControlChange = async (nextControls: GraphReviewControls) => {
    const requiresReload = nextControls.maxHops !== chapterGraphControls.maxHops || nextControls.hideLowConfidence !== chapterGraphControls.hideLowConfidence || nextControls.confirmedOnly !== chapterGraphControls.confirmedOnly
    setChapterGraphControls(nextControls)
    if (!requiresReload || centerPaneView !== 'graph' || !currentChapter) return
    await loadChapterGraph(currentChapter, nextControls, true)
  }

  const selectedRewriteCandidate = rewriteFlow.candidates[rewriteFlow.selectedIndex] ?? rewriteFlow.candidates[0]
  const previewRewriteContent = selectedRewriteCandidate?.content || rewriteState.result
  const activeGraphContext = graphContext ?? generationContext?.graphContext ?? null
  const activePromptBlockCount = generationContext ? getVisibleAdvancedContextPromptBlocks(generationContext.promptBlocks).length : 0
  const activeSeedEntityCount = activeGraphContext?.seedEntities.length ?? 0
  const activeGraphEdgeCount = activeGraphContext?.edges.length ?? 0
  const activeEvidenceCount = generationContext?.lanceEvidence.length ?? 0
  const scenarioStatusLabels = (Object.keys(AI_SCENARIO_META) as AIScenarioKey[]).map((scenario) => {
    const meta = scenarioMeta[scenario]
    const settings = resolvedAISettings[scenario]
    if (settings.provider === 'openai-compatible') {
      return settings.openAICompatible.configured && settings.openAICompatible.model
        ? `${meta.shortLabel} ${settings.openAICompatible.model} · ${t('workspace.aiStatus.online')}`
        : `${meta.shortLabel} OpenAI ${t('workspace.aiStatus.notConfigured')}`
    }
    return settings.ollama.configured && settings.ollama.model
      ? `${meta.shortLabel} ${settings.ollama.model} · ${t('workspace.aiStatus.local')}`
      : `${meta.shortLabel} Ollama ${t('workspace.aiStatus.notConfigured')}`
  })
  const providerLabel = scenarioStatusLabels[0] ?? `${scenarioMeta.rewrite.shortLabel} OpenAI ${t('workspace.aiStatus.notConfigured')}`
  const getInstructionForMode = useCallback((mode: WorkspaceActionMode) => {
    if (mode === 'rewrite') return rewritePrompt
    return t('workspace.rewrite.defaultContinueInstruction')
  }, [rewritePrompt, t])
  const buildPresetCompatRuntimeContext = useCallback((surfaceId: PresetCompatSurfaceId) => {
    if (!currentChapter) return {}
    const selection = workspaceSelection ?? toChapterTimelineSelection(currentChapter)
    const sessionEntry = params.presetCompatSessionState[createPresetCompatSessionStateKey(selection, surfaceId)]
    return { sessionPhase: sessionEntry?.phase ?? null, hasImpersonationContext: surfaceId === 'roleplay' }
  }, [currentChapter, params.presetCompatSessionState, workspaceSelection])
  const syncRewriteFlowFromRecoverableJob = useCallback((job: RecoverableRewriteJob, options?: { restorePanelState?: boolean }) => {
    const nextCandidate = job.result ? toRewriteCandidateFromRecoverableResult(job.result) : null
    const isPending = job.status === 'queued' || job.status === 'running'
    const nextError = job.status === 'failed' ? (job.errorMessage?.trim() || t('workspace.actionError.createRecoverableRewriteJobFailed')) : ''
    if (options?.restorePanelState) {
      const restoredSelection = job.panel.selectedText.trim()
      if (restoredSelection) {
        setSelectionText(restoredSelection)
        setLockedSelectionText(restoredSelection)
      }
        setRewritePrompt(job.panel.userInstruction || t('workspace.rewrite.defaultPrompt'))
      setRewriteSourceTextOverride(job.panel.sourceTextOverride ?? '')
      if (job.panel.rewriteLaunchSource === 'chapter' || job.panel.rewriteLaunchSource === 'what_if' || job.panel.rewriteLaunchSource === 'future_jump' || job.panel.rewriteLaunchSource === 'continue_block') {
        setRewriteLaunchSource(job.panel.rewriteLaunchSource)
      }
    }
    setRewriteFlow({ loading: isPending, error: nextError, provider: job.result?.provider || 'recoverable-rewrite-job', candidates: nextCandidate ? [nextCandidate] : [], selectedIndex: 0, jobId: job.jobId, jobStatus: job.status, jobCurrentStep: job.currentStep })
    setRewriteState((current) => ({ loading: isPending, error: nextError, result: nextCandidate?.content || current.result }))
  }, [])

  return {
    currentNovelId: params.currentNovelId,
    leftPanelOpen,
    setLeftPanelOpen,
    chapterListState,
    setChapterListState,
    centerPaneView,
    setCenterPaneView,
    refTab,
    setRefTab,
    settingsOpen,
    setSettingsOpen,
    confirmDeleteKnowledge,
    setConfirmDeleteKnowledge,
    selectionText,
    setSelectionText,
    lockedSelectionText,
    setLockedSelectionText,
    toolbarPos,
    setToolbarPos,
    activeMode,
    setActiveMode,
    rewritePrompt,
    setRewritePrompt,
    rewriteState,
    setRewriteState,
    rewriteFlow,
    setRewriteFlow,
    generationContext,
    setGenerationContext,
    graphContext,
    setGraphContext,
    contextPreviewLoading,
    setContextPreviewLoading,
    contextPreviewError,
    setContextPreviewError,
    graphReviewLoading,
    setGraphReviewLoading,
    currentBranchMetricsOverride,
    setCurrentBranchMetricsOverride,
    continueBlockMetricsNodeIdRef,
    whatIfMetricsNodeIdRef,
    futureJumpMetricsNodeIdRef,
    handleWhatIfMetricsChange,
    handleContinueBlockMetricsChange,
    handleFutureJumpMetricsChange,
    graphReviewControls,
    setGraphReviewControls,
    contextPanelOpen,
    setContextPanelOpen,
    graphSelection,
    setGraphSelection,
    evidenceDrawerOpen,
    setEvidenceDrawerOpen,
    disabledContextBlockIds,
    setDisabledContextBlockIds,
    excludedGraphEdgeIds,
    setExcludedGraphEdgeIds,
    excludedEvidenceIds,
    setExcludedEvidenceIds,
    graphMutationPendingId,
    setGraphMutationPendingId,
    graphMutationError,
    setGraphMutationError,
    chapterGraphData,
    setChapterGraphData,
    chapterGraphLoading,
    setChapterGraphLoading,
    chapterGraphError,
    setChapterGraphError,
    chapterGraphControls,
    setChapterGraphControls,
    chapterGraphSelection,
    setChapterGraphSelection,
    pendingSourceJump,
    setPendingSourceJump,
    workspaceSelection,
    setWorkspaceSelection,
    storyTimelineData,
    setStoryTimelineData,
    storyTimelineError,
    copied,
    setCopied,
    toast,
    setToast,
    saveContinueBlockPending,
    setSaveContinueBlockPending,
    saveContinueBlockError,
    setSaveContinueBlockError,
    roleplaySessionStarting,
    setRoleplaySessionStarting,
    deletingBranchNodeId,
    setDeletingBranchNodeId,
    pendingWhatIfRewriteLaunch,
    setPendingWhatIfRewriteLaunch,
    pendingFutureJumpRewriteLaunch,
    setPendingFutureJumpRewriteLaunch,
    pendingContinueBlockRewriteLaunch,
    setPendingContinueBlockRewriteLaunch,
    activeFutureJumpRewriteContext,
    setActiveFutureJumpRewriteContext,
    activeContinueBlockRewriteContext,
    setActiveContinueBlockRewriteContext,
    rewriteLaunchSource,
    setRewriteLaunchSource,
    rewriteSourceTextOverride,
    setRewriteSourceTextOverride,
    futureMapLaunch,
    setFutureMapLaunch,
    knowledgeRebuilding,
    setKnowledgeRebuilding,
    presetCompatLibraryOpen,
    setPresetCompatLibraryOpen,
    knowledgeRebuildStatus,
    setKnowledgeRebuildStatus,
    hanlpCacheSnapshot,
    setHanlpCacheSnapshot,
    knowledgeStatusOverview,
    setKnowledgeStatusOverview,
    knowledgeActionLoading,
    setKnowledgeActionLoading,
    confirmDeleteHanlpCache,
    setConfirmDeleteHanlpCache,
    confirmDeleteExtractionCache,
    setConfirmDeleteExtractionCache,
    confirmDeleteEmbeddingCache,
    setConfirmDeleteEmbeddingCache,
    knowledgeRebuildRangeMode,
    setKnowledgeRebuildRangeMode,
    knowledgeRebuildFirstChapterCount,
    setKnowledgeRebuildFirstChapterCount,
    knowledgeRebuildStartChapter,
    setKnowledgeRebuildStartChapter,
    knowledgeRebuildEndChapter,
    setKnowledgeRebuildEndChapter,
    ollamaModelsByScenario,
    setOllamaModelsByScenario,
    ollamaModelsLoading,
    setOllamaModelsLoading,
    ollamaModelsError,
    setOllamaModelsError,
    openAICompatibleModelsByScenario,
    setOpenAICompatibleModelsByScenario,
    openAICompatibleModelsLoading,
    setOpenAICompatibleModelsLoading,
    openAICompatibleModelsRequestRef,
    editState,
    setEditState,
    knowledgePanelReadOnly,
    editor,
    editorRef,
    toolbarRef,
    lastActiveKnowledgeJobIdRef,
    resolvedAISettings,
    updateScenarioProvider,
    updateScenarioOpenAIField,
    updateScenarioOllamaField,
    updateKnowledgeExtractionParallelism,
    updateEmbeddingBatchSize,
    showKnowledgeToast,
    novelVolumes,
    currentNovelMeta,
    sortedChapters,
    currentChapter,
    parentChapter,
    graphSourceMeta,
    selectChapter,
    resolveSourceChapter,
    jumpToGraphSource,
    hasWorkspaceContent,
    mainlineChapters,
    selectedKnowledgeRebuildChapterRange,
    selectedKnowledgeRebuildChapterRangeLabel,
    branchChaptersByParentId,
    storyTimelineBranchId,
    resolvedStoryTimeline,
    timelineChapterById,
    timelineNodeById,
    handleTimelineSelection,
    loadStoryTimeline,
    chapterListTarget,
    chapterText,
    resolveEdgeSourceJumpTarget,
    resolveEvidenceSourceJumpTarget,
    mainKnowledgeRebuildStatus,
    currentKnowledgeJobActive,
    currentKnowledgeJobBusy,
    knowledgeRebuildEtaMinutes,
    knowledgeRebuildSteps,
    knowledgeRebuildFailed,
    knowledgeRebuildPaused,
    knowledgeRebuildActive,
    knowledgeRebuildBusy,
    knowledgeRebuildFailureMessage,
    knowledgeRebuildOverallPercent,
    hanlpBootstrapCompletedChapterCount,
    hanlpBootstrapTotalChapterCount,
    hanlpBootstrapPercent,
    hanlpBootstrapCacheHitRatePercent,
    hanlpBootstrapTimingLabel,
    hanlpBootstrapPhaseLabel,
    hanlpBootstrapEtaLabel,
    hanlpBootstrapStatusLine,
    hanlpCacheStatusLabel,
    hanlpSettingsLine,
    hanlpCacheDeleteState,
    extractionCacheDeleteState,
    embeddingCacheDeleteState,
    rawTextEmbeddingPercent,
    rawTextEmbeddingCacheHitRatePercent,
    rawTextEmbeddingTimingLabel,
    rawTextEmbeddingSettingsLine,
    rawTextEmbeddingPhaseBadge,
    rawTextEmbeddingStatusLine,
    retrievalIndexOverview,
    retrievalTaskStatus,
    retrievalTaskPercent,
    retrievalTaskPhaseLabel,
    retrievalTaskStatusLabel,
    retrievalControlsState,
    retrievalIndexStatusLine,
    knowledgeGraphOverview,
    embeddingCacheOverview,
    currentKnowledgeRunningStepKey,
    currentNovelVisibleCharacterCount,
    currentNovelOutlines,
    currentNovelTimelineEvents,
    currentNovelCharactersSorted,
    currentNovelWorldEntryGroups,
    workspaceKnowledgeTabs,
    loadChapterGraph,
    handleChapterGraphControlChange,
    selectedRewriteCandidate,
    previewRewriteContent,
    activeGraphContext,
    activePromptBlockCount,
    activeSeedEntityCount,
    activeGraphEdgeCount,
    activeEvidenceCount,
    scenarioStatusLabels,
    providerLabel,
    getInstructionForMode,
    buildPresetCompatRuntimeContext,
    syncRewriteFlowFromRecoverableJob,
    closePanel,
  }
}

export type SelectionNovelStudioCoreState = ReturnType<typeof useSelectionNovelStudioCore>
