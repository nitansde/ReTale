"use client"

import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  Globe,
  LoaderCircle,
  MapPin,
  MessageCircleMore,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Users,
  Wand2,
  X,
} from 'lucide-react'
import type { FutureJumpContinueContext } from '@/components/future-jump/FutureJumpView'
import {
  getVisibleAdvancedContextPromptBlocks,
  resolveActiveGenerationContextTokenEstimate,
} from '@/components/graph/context-prompt-block-visibility'
import { WorkspaceCenterPane } from '@/components/workspace/WorkspaceCenterPane'
import { WorkspaceChapterNav } from '@/components/workspace/WorkspaceChapterNav'
import { WorkspaceHeader } from '@/components/workspace/WorkspaceHeader'
import { WorkspaceWorldEntriesPanel } from '@/components/workspace/WorkspaceWorldEntriesPanel'
import { WorkspaceReferencePanel } from '@/components/workspace/WorkspaceReferencePanel'
import { WorkspaceKnowledgeControls } from '@/components/workspace/WorkspaceKnowledgeControls'
import { WorkspaceSelectionActions } from '@/components/workspace/WorkspaceSelectionActions'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { Notice } from '@/components/ui/Notice'
import { useSelectionNovelStudioActions } from '@/components/workspace/use-selection-novel-studio-actions'
import { useSelectionNovelStudioCore } from '@/components/workspace/use-selection-novel-studio-core'
import { useSelectionNovelStudioViewModel } from '@/components/workspace/use-selection-novel-studio-view-model'
import {
  type PendingSourceJump,
  WORKSPACE_CHAPTER_ACTION_ENTRY_MODES,
  useWorkspaceChapterSelection,
  type WorkspaceActionMode,
  type WorkspaceFloatingPosition,
} from '@/components/workspace/use-workspace-chapter-selection'
import { type WorkspaceRefTab, useWorkspacePaneState } from '@/components/workspace/use-workspace-pane-state'
import {
  readWorkspaceSelectionFromSearchParams,
  resolveSelectionAfterDeletedBranchNode,
  resolveWorkspaceSelection,
  toBranchTimelineSelection,
  toChapterTimelineSelection,
  writeWorkspaceSelectionToSearchParams,
} from '@/components/workspace/workspace-selection'
import { normalizeAISettings } from '@/lib/ai-settings'
import { useI18n } from '@/lib/i18n/provider'
import type { PresetCompatSurfaceId } from '@/lib/preset-compat/types'
import { formatStoryBranchInstructionPreview } from '@/lib/story-branch-labels'
import { WRITING_SKILL_RUNTIME_EXAMPLE_COUNTS } from '@/lib/writing-skill-defaults'
import { createPresetCompatSessionStateKey } from '@/lib/workspace-state'
import {
  ACTION_META,
  AI_SCENARIO_META,
  buildChapterLineExcerpt,
  buildContinueBlockLineageRequestContext,
  callAbortRecoverableRewriteJobApi,
  callChapterGraphContextApi,
  callCreateContinueBlockApi,
  callCreateRecoverableRewriteJobApi,
  callCreateRoleplaySessionApi,
  callCreateWhatIfSessionApi,
  callDeleteStoryTimelineNodeApi,
  callGenerationContextApi,
  callGetRecoverableRewriteJobApi,
  callGraphEdgeConfirmApi,
  callGraphEdgeEditApi,
  callGraphEdgeRejectApi,
  callGraphSubgraphApi,
  callRegenerateContinueBlockApi,
  CHAPTER_ACTION_ENTRY_TEST_IDS,
  CHAPTER_PAGE_SIZE,
  CONTINUE_BLOCK_ACTION_TEST_IDS,
  createOptimisticContinueBlockTimelineNode,
  DEFAULT_GRAPH_REVIEW_CONTROLS,
  DEFAULT_REWRITE_PROMPT,
  extractSelection,
  filterWorkspaceVisibleCharacters,
  formatStageDuration,
  findSourceBlock,
  formatEmbeddingProviderLabel,
  formatKnowledgeEtaLabel,
  formatKnowledgeJobStatusLabel,
  formatKnowledgeRebuildChapterRangeLabel,
  formatRetrievalIndexDetail,
  GenerationState,
  getConnectedGraphEdgeIds,
  groupWorldEntriesForWorkspaceRail,
  HANLP_BOOTSTRAP_STAGE_KEY,
  HANLP_CACHE_STATUS_LABELS,
  HanlpCacheSnapshot,
  isKnowledgeJobBusy,
  KnowledgeActionLoading,
  KnowledgeRebuildRangeMode,
  KnowledgeRebuildStatus,
  KnowledgeStatusOverview,
  KNOWLEDGE_STEP_STATUS_LABELS,
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
  removeDeletedStoryTimelineNode,
  resolveCacheDeleteState,
  resolveContinueBlockSelectionAfterSave,
  resolveCurrentNodeMetrics,
  resolveGraphSelection,
  resolveHanlpCacheDeleteState,
  resolveKnowledgeJobPhaseLabel,
  resolveKnowledgeRebuildFailureMessage,
  resolveKnowledgeStepDisplayStatus,
  resolveRetrievalTaskControlsState,
  RewriteApiCandidate,
  RewriteFlowState,
  RewriteLaunchSource,
  shouldLoadWorkspaceFromBackendOnMount,
  sortCharactersForWorkspaceRail,
  toContinueBranchSelection,
  toGenerationContextOperationType,
  toPresetCompatSessionSurfaceId,
  toProgressPercent,
  toRewriteCandidateFromRecoverableResult,
  TOOLBAR_EDGE_PADDING,
  TOOLBAR_OFFSET_Y,
  upsertOptimisticContinueBlockTimelineNode,
  WORLD_TYPE_LABELS,
  WorkspaceCharacterReferenceCard,
  WorkspaceStatusState,
  type FutureMapLaunchState,
} from '@/components/workspace/selection-novel-studio-helpers'
import type {
  ChapterGraphContextData,
  GraphEdgeEditDraft,
  ChapterGraphContextResponse,
  GenerationContextBuildData,
  GenerationContextResponse,
  GraphReviewControls,
  GraphSelection,
  GraphSubgraphResponse,
} from '@/components/graph/types'
import type { GraphEdge } from '@/lib/server/graph-types'
import { useNovelStore } from '@/store/novel-store'
import type { NovelStore } from '@/store/novel-store-types'
import { useShallow } from 'zustand/react/shallow'
import { cn, countChineseFriendlyWords, htmlToPlainText, plainTextToHtml } from '@/lib/utils'
import type {
  ChapterTimelineItem,
  ContinueBlockMutationResponse,
  FutureJumpMutationResponse,
  FutureJumpSourceContext,
  FutureJumpRunDetail,
  StoryTimelineBranchNode,
  StoryTimelineResponse,
  TimelineSelection,
  WhatIfCreateResponse,
  WhatIfSessionDetail,
} from '@/lib/story-branch-types'
import type {
  AIProvider,
  AISettings,
  AIScenarioKey,
  Chapter,
  Character,
  CharacterRoleCardFacet,
  KnowledgeRebuildChapterRange,
  OutlineType,
  WorldEntry,
  WorldEntryType,
} from '@/lib/types'

const ChapterGraphBrowser = dynamic(() => import('@/components/graph/chapter-graph-browser').then((module) => module.ChapterGraphBrowser))
const ContinueBlockDetailView = dynamic(() => import('@/components/workspace/ContinueBlockDetailView').then((module) => module.ContinueBlockDetailView))
const FutureJumpView = dynamic(() => import('@/components/future-jump/FutureJumpView').then((module) => module.FutureJumpView))
const FutureMapOverlay = dynamic(() => import('@/components/what-if/FutureMapOverlay').then((module) => module.FutureMapOverlay))
const GraphReviewPanel = dynamic(() => import('@/components/graph/graph-review-panel').then((module) => module.GraphReviewPanel))
const PresetCompatLibraryModal = dynamic(() => import('@/components/workspace/PresetCompatLibraryModal').then((module) => module.PresetCompatLibraryModal))
const RoleplaySessionView = dynamic(() => import('@/components/workspace/RoleplaySessionView').then((module) => module.RoleplaySessionView))
const WhatIfSessionView = dynamic(() => import('@/components/what-if/WhatIfSessionView').then((module) => module.WhatIfSessionView))
const WorkspaceAISettingsModal = dynamic(() => import('@/components/workspace/WorkspaceAISettingsModal').then((module) => module.WorkspaceAISettingsModal))

export function selectSelectionNovelStudioStore(state: NovelStore) {
  return {
    loadFromBackend: state.loadFromBackend,
    saveToBackend: state.saveToBackend,
    deleteNovelFromBackend: state.deleteNovelFromBackend,
    reconcileNovelDeletionFromBackend: state.reconcileNovelDeletionFromBackend,
    isNovelDeletionPending: state.isNovelDeletionPending,
    beginNovelDeletion: state.beginNovelDeletion,
    rollbackNovelDeletion: state.rollbackNovelDeletion,
    setNovelDeletionPending: state.setNovelDeletionPending,
    reconcileNovelDeletion: state.reconcileNovelDeletion,
    backendLoaded: state.backendLoaded,
    currentNovelId: state.currentNovelId,
    localNovels: state.localNovels,
    localChapters: state.localChapters,
    currentChapterId: state.currentChapterId,
    setCurrentChapterId: state.setCurrentChapterId,
    updateChapterContent: state.updateChapterContent,
    createNewChapter: state.createNewChapter,
    deleteChapter: state.deleteChapter,
    deleteNovel: state.deleteNovel,
    aiSettings: state.aiSettings,
    setAISettings: state.setAISettings,
    saveAISettings: state.saveAISettings,
    loadPresetCompatLibrary: state.loadPresetCompatLibrary,
    savePresetCompatLibrary: state.savePresetCompatLibrary,
    rebuildStoryKnowledge: state.rebuildStoryKnowledge,
    rebuildStoryRetrievalIndex: state.rebuildStoryRetrievalIndex,
    pauseStoryKnowledgeRebuild: state.pauseStoryKnowledgeRebuild,
    abortStoryKnowledgeRebuild: state.abortStoryKnowledgeRebuild,
    deleteStoryKnowledgeGraph: state.deleteStoryKnowledgeGraph,
    deleteStoryHanlpCache: state.deleteStoryHanlpCache,
    deleteStoryExtractionCache: state.deleteStoryExtractionCache,
    deleteStoryEmbeddingCache: state.deleteStoryEmbeddingCache,
    refreshKnowledgeProjection: state.refreshKnowledgeProjection,
    setPresetCompatSessionPhase: state.setPresetCompatSessionPhase,
    clearPresetCompatSessionStateForSelection: state.clearPresetCompatSessionStateForSelection,
    resetPresetCompatSessionStateForSelection: state.resetPresetCompatSessionStateForSelection,
    presetCompatSessionState: state.presetCompatSessionState,
    localCharacters: state.localCharacters,
    localWorldEntries: state.localWorldEntries,
    localTimelineEvents: state.localTimelineEvents,
    localOutlines: state.localOutlines,
    persistRevision: state.persistRevision,
    workspaceSaveFeedback: state.workspaceSaveFeedback,
  }
}


export function SelectionNovelStudio() {
  const { t } = useI18n()
  const router = useRouter()
  const {
    loadFromBackend, saveToBackend, deleteNovelFromBackend, reconcileNovelDeletionFromBackend, isNovelDeletionPending, beginNovelDeletion, rollbackNovelDeletion, setNovelDeletionPending, reconcileNovelDeletion, backendLoaded, currentNovelId, localNovels, localChapters, currentChapterId,
    setCurrentChapterId, updateChapterContent, createNewChapter, deleteChapter, deleteNovel, aiSettings, setAISettings,
    saveAISettings, loadPresetCompatLibrary, savePresetCompatLibrary, rebuildStoryKnowledge, rebuildStoryRetrievalIndex,
    pauseStoryKnowledgeRebuild, abortStoryKnowledgeRebuild, deleteStoryKnowledgeGraph, deleteStoryHanlpCache,
    deleteStoryExtractionCache, deleteStoryEmbeddingCache, refreshKnowledgeProjection, setPresetCompatSessionPhase,
    clearPresetCompatSessionStateForSelection, resetPresetCompatSessionStateForSelection, presetCompatSessionState,
    localCharacters, localWorldEntries, localTimelineEvents, localOutlines,
    persistRevision, workspaceSaveFeedback,
  } = useNovelStore(useShallow(selectSelectionNovelStudioStore))
  const autosaveTarget = `${currentNovelId}\u0000${persistRevision}`
  const readAutosaveTarget = useCallback(() => {
    const state = useNovelStore.getState()
    return `${state.currentNovelId}\u0000${state.persistRevision}`
  }, [])
  const core = useSelectionNovelStudioCore({ loadFromBackend, saveToBackend, isNovelDeletionPending, backendLoaded, currentNovelId, localNovels, localChapters, currentChapterId, setCurrentChapterId, updateChapterContent, aiSettings, setAISettings, refreshKnowledgeProjection, clearPresetCompatSessionStateForSelection, resetPresetCompatSessionStateForSelection, presetCompatSessionState, localCharacters, localWorldEntries, localTimelineEvents, localOutlines, autosaveTarget, readAutosaveTarget, workspaceSaveFeedback })
  const {
    leftPanelOpen, setLeftPanelOpen, referencePanelOpen, setReferencePanelOpen, knowledgePanelOpen, setKnowledgePanelOpen, centerPaneView, setCenterPaneView, refTab, setRefTab, settingsOpen, setSettingsOpen,
    selectionText, lockedSelectionText, toolbarPos, activeMode, rewritePrompt, rewriteState, rewriteFlow, generationContext,
    writingSkillCards, writingSkillCardsLoading, writingSkillCardsError, selectedWritingSkillCardIds,
    writingSkillExampleCount,
    graphContext, contextPreviewLoading, contextPreviewError, graphReviewLoading, graphReviewControls, contextPanelOpen,
    setContextPanelOpen, graphSelection, setGraphSelection, evidenceDrawerOpen, setEvidenceDrawerOpen, disabledContextBlockIds, setDisabledContextBlockIds, excludedGraphEdgeIds, excludedEvidenceIds, graphMutationPendingId, graphMutationError, chapterGraphData,
    chapterGraphLoading, chapterGraphError, chapterGraphControls, chapterGraphSelection, setChapterGraphSelection, copied, setCopied, toast, toastVariant,
    saveContinueBlockPending, saveContinueBlockError, roleplaySessionStarting, rewriteLaunchSource, activeContinueBlockRewriteContext, futureMapLaunch, setFutureMapLaunch,
    presetCompatLibraryOpen, setPresetCompatLibraryOpen, ollamaModelsByScenario, ollamaModelsLoading, ollamaModelsError,
    openAICompatibleModelsByScenario, openAICompatibleModelsLoading, editState, setEditState, knowledgePanelReadOnly,
    editor, editorRef, toolbarRef, resolvedAISettings, updateScenarioProvider, updateScenarioOpenAIField,
    updateScenarioOllamaField, updateKnowledgeExtractionParallelism, updateEmbeddingBatchSize, applyLocalEmbeddingSettings, sortedChapters,
    currentChapter, parentChapter, graphSourceMeta, selectChapter, jumpToGraphSource, hasWorkspaceContent, branchChaptersByParentId, storyTimelineBranchId, resolvedStoryTimeline,
    timelineChapterById, timelineNodeById, storyTimelineError, currentNovelMeta, chapterText,
    mainKnowledgeRebuildStatus, knowledgeRebuildActive, knowledgeRebuildPaused, knowledgeRebuildFailed, knowledgeRebuildRangeMode,
    knowledgeRebuildFirstChapterCount, knowledgeRebuildStartChapter, knowledgeRebuildEndChapter, selectedKnowledgeRebuildChapterRangeLabel,
    knowledgeStatusOverview, currentKnowledgeJobBusy, knowledgeGraphOverview, extractionCacheOverview, embeddingCacheOverview, retrievalIndexOverview,
    retrievalIndexStatusLine, retrievalTaskStatus, retrievalTaskStatusLabel, retrievalTaskPhaseLabel,
    retrievalControlsState, knowledgeRebuildFailureMessage, knowledgeRebuildEtaMinutes,
    hanlpBootstrapStatusLine, hanlpBootstrapCompletedChapterCount, hanlpBootstrapTotalChapterCount, hanlpCacheStatusLabel,
    hanlpBootstrapCacheHitRatePercent, hanlpBootstrapPhaseLabel, hanlpBootstrapEtaLabel, hanlpBootstrapTimingLabel,
    hanlpSettingsLine, rawTextEmbeddingStatusLine, rawTextEmbeddingActive, rawTextEmbeddingPhaseBadge,
    rawTextEmbeddingCacheHitRatePercent, rawTextEmbeddingTimingLabel, rawTextEmbeddingSettingsLine, knowledgeRebuildSteps,
    currentKnowledgeRunningStepKey, confirmDeleteHanlpCache, confirmDeleteExtractionCache, confirmDeleteEmbeddingCache,
    confirmDeleteKnowledge, hanlpCacheDeleteState, extractionCacheDeleteState, embeddingCacheDeleteState,
    currentKnowledgeJobActive, knowledgeRebuildBusy, currentNovelVisibleCharacterCount, currentNovelOutlines,
    currentNovelTimelineEvents, currentNovelCharactersSorted, currentNovelWorldEntryGroups, workspaceKnowledgeTabs,
    loadChapterGraph, resolveEdgeSourceJumpTarget, resolveEvidenceSourceJumpTarget, handleChapterGraphControlChange, handleWhatIfMetricsChange, handleContinueBlockMetricsChange, handleFutureJumpMetricsChange,
    selectedRewriteCandidate, previewRewriteContent, activeGraphContext, activePromptBlockCount, activeSeedEntityCount,
    activeGraphEdgeCount, activeEvidenceCount, scenarioStatusLabels, providerLabel, workspaceSelection, handleTimelineSelection, deletingBranchNodeId, closePanel, saveWorkspaceBeforeNavigation,
  } = core
  const selectionView = useSelectionNovelStudioViewModel({ currentChapter, workspaceSelection, timelineNodeById, resolveSourceChapter: ({ chapterId, chapterNo }) => core.resolveSourceChapter({ chapterId, chapterNo: chapterNo ?? null }), currentNovelId, storyTimelineBranchId: core.storyTimelineBranchId, chapterText, currentBranchMetricsOverride: core.currentBranchMetricsOverride, graphSourceMeta: graphSourceMeta ?? null, continueBlockMetricsNodeIdRef: core.continueBlockMetricsNodeIdRef, whatIfMetricsNodeIdRef: core.whatIfMetricsNodeIdRef, futureJumpMetricsNodeIdRef: core.futureJumpMetricsNodeIdRef, selectionText, lockedSelectionText: core.lockedSelectionText })
  const {
    activeWorkspaceSelection, selectedTimelineNode, selectedContinueBlockNode, selectedContinueBlockFutureMapLaunch,
    selectedTimelineDisplayLabel, selectedTimelineInstructionText, workspaceHeaderTitle, currentNodeMetrics,
    chapterSelectionSummary, chapterGraphSummary,
  } = selectionView
  const actions = useSelectionNovelStudioActions({ core, viewModel: { activeWorkspaceSelection, selectedTimelineNode, selectedContinueBlockNode, selectedContinueBlockFutureMapLaunch, selectedTimelineDisplayLabel, selectedTimelineInstructionText }, loadFromBackend, saveToBackend, deleteNovelFromBackend, reconcileNovelDeletionFromBackend, isNovelDeletionPending, beginNovelDeletion, rollbackNovelDeletion, setNovelDeletionPending, reconcileNovelDeletion, localChapters, deleteChapter, deleteNovel, saveAISettings, savePresetCompatLibrary, rebuildStoryKnowledge, rebuildStoryRetrievalIndex, pauseStoryKnowledgeRebuild, abortStoryKnowledgeRebuild, deleteStoryKnowledgeGraph, deleteStoryHanlpCache, deleteStoryExtractionCache, deleteStoryEmbeddingCache, setPresetCompatSessionPhase, setCurrentChapterId, updateChapterContent })
  const {
    openActionMode, handleRefreshContextReview, handleExcludedGenerationContextChange, handleConfirmGraphEdge, handleRejectGraphEdge,
    handleSaveGraphEdgeEdit, handleGraphControlChange, copyText, applyFullChapter, saveSettings, loadOllamaModels,
    loadOpenAICompatibleModels, handleDeleteNovel, handleDeleteChapter, handleTimelineDeleteChapter,
    handleDeleteBranchNode, handleRewritePromptChange, handleWritingSkillSelectionChange, handleWritingSkillExampleCountChange, handleRewrite, handleAbortRewriteGeneration, handleSaveContinueBlock,
    handleCreateWhatIf, launchFutureMapFromWhatIf, handleFutureJumpCreated, reopenWhatIfRewriteFlow,
    reopenFutureJumpRewriteFlow, selectionActions, knowledgeControls,
  } = actions
  const isContinueBlockContinuation = rewriteLaunchSource === 'continue_block'
    && activeContinueBlockRewriteContext?.variant === 'continue'
  const activeContextTokenEstimate = useMemo(() => generationContext
    ? resolveActiveGenerationContextTokenEstimate({
        blocks: generationContext.promptBlocks,
        disabledBlockIds: disabledContextBlockIds,
        fallbackTokenEstimate: generationContext.tokenEstimate,
        userInstruction: rewritePrompt,
      })
    : null, [disabledContextBlockIds, generationContext, rewritePrompt])
  const contextLabel = activeWorkspaceSelection.kind === 'chapter'
    ? t('workspace.context.chapter')
    : activeWorkspaceSelection.kind === 'rewrite'
      ? t('workspace.context.rewrite')
      : activeWorkspaceSelection.kind === 'continue_block'
        ? t('workspace.context.continueBlock')
        : activeWorkspaceSelection.kind === 'what_if'
          ? t('workspace.context.whatIf')
          : activeWorkspaceSelection.kind === 'roleplay_session'
            ? t('workspace.context.roleplay')
            : t('workspace.context.futureJump')

  if (!backendLoaded) {
    return (
      <WorkspaceStatusState
        icon={LoaderCircle}
        title={t('workspace.loadingTitle')}
        description={t('workspace.loadingDescription')}
      />
    )
  }

  if (!hasWorkspaceContent) {
    return (
      <WorkspaceStatusState
        icon={BookOpen}
        title={t('workspace.emptyTitle')}
        description={t('workspace.emptyDescription')}
        ctaLabel={t('workspace.backToLibraryImport')}
      />
    )
  }

  if (!currentChapter) {
    return (
      <WorkspaceStatusState
        icon={LoaderCircle}
        title={t('workspace.repairTitle')}
        description={t('workspace.repairDescription')}
        ctaLabel={t('workspace.backToLibrary')}
      />
    )
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(129,140,248,0.12),_transparent_30%),#0a0c12] text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-[1720px] flex-col px-0 pb-10 pt-0 sm:px-5 sm:pt-3 lg:px-6">
        <WorkspaceHeader
          title={workspaceHeaderTitle}
          metrics={{
            wordCount: t('workspace.wordCount', { count: currentNodeMetrics.wordCount.toLocaleString() }),
            inputTokens: t('workspace.inputTokens', { count: currentNodeMetrics.inputTokens?.toLocaleString() ?? '—' }),
            outputTokens: t('workspace.outputTokens', { count: currentNodeMetrics.outputTokens?.toLocaleString() ?? '—' }),
          }}
          providerLabel={providerLabel}
          deletionPending={isNovelDeletionPending}
          onOpenChapters={() => setLeftPanelOpen(true)}
          onOpenContext={() => setReferencePanelOpen(true)}
          onOpenKnowledge={() => setKnowledgePanelOpen(true)}
          onOpenPresets={() => {
            setPresetCompatLibraryOpen(true)
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onDeleteNovel={() => { void handleDeleteNovel() }}
          onBackToLibrary={async () => {
            if (await saveWorkspaceBeforeNavigation()) router.push('/library')
          }}
        />

        <div className="grid flex-1 gap-0 sm:gap-4 lg:grid-cols-[264px_minmax(0,1.28fr)_376px] 2xl:grid-cols-[280px_minmax(0,1.32fr)_392px]">
          <WorkspaceChapterNav
            leftPanelOpen={leftPanelOpen}
            onClose={() => setLeftPanelOpen(false)}
            onCreateChapter={createNewChapter}
            sortedChapters={sortedChapters}
            currentNovelId={currentNovelId}
            storyTimelineError={storyTimelineError}
            branchNodes={resolvedStoryTimeline.branchNodes}
            edges={resolvedStoryTimeline.edges}
            timelineChapterById={timelineChapterById}
            currentChapterId={currentChapter.id}
            activeSelection={activeWorkspaceSelection}
            branchChaptersByParentId={branchChaptersByParentId}
            onSelectionChange={handleTimelineSelection}
            onDeleteChapter={handleTimelineDeleteChapter}
            deletingBranchNodeId={deletingBranchNodeId}
            onDeleteBranchNode={handleDeleteBranchNode}
          />

          <div className="min-w-0">
            <WorkspaceCenterPane
            selection={activeWorkspaceSelection}
            chapterTitle={currentChapter.title}
            centerPaneView={centerPaneView}
            onCenterPaneViewChange={setCenterPaneView}
            chapterSelectionSummary={chapterSelectionSummary}
            chapterGraphSummary={chapterGraphSummary}
            selectionActions={activeWorkspaceSelection.kind === 'chapter' ? null : selectionActions}
            branchReadableLabel={selectedTimelineDisplayLabel || null}
            branchInstructionText={selectedTimelineInstructionText || null}
            chapterBodyView={
              <div className="px-0 py-0 sm:px-7 sm:py-6" data-testid="workspace-chapter-body-view">
                {selectionActions}
                <div className="min-h-[62vh] bg-transparent shadow-none sm:rounded-[28px] sm:border sm:border-white/8 sm:bg-[#0b0d12] sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                  <EditorContent editor={editor} />
                </div>
              </div>
            }
            chapterGraphView={centerPaneView === 'graph' ? (
              <ChapterGraphBrowser
                chapter={currentChapter}
                parentChapter={parentChapter}
                data={chapterGraphData}
                sourceMeta={graphSourceMeta}
                controls={chapterGraphControls}
                selection={chapterGraphSelection}
                loading={chapterGraphLoading}
                error={chapterGraphError}
                onSelectNode={(node) => setChapterGraphSelection({ type: 'node', node })}
                onSelectEdge={(edge) => setChapterGraphSelection({ type: 'edge', edge })}
                onClearSelection={() => setChapterGraphSelection(null)}
                onChangeControls={(controls) => {
                  void handleChapterGraphControlChange(controls)
                }}
                onRefresh={() => {
                  void loadChapterGraph(currentChapter, chapterGraphControls, true)
                }}
                onJumpToEdgeSource={(edge) => {
                  const target = resolveEdgeSourceJumpTarget(edge)
                  if (target) jumpToGraphSource(target)
                }}
                canJumpToEdgeSource={(edge) => Boolean(resolveEdgeSourceJumpTarget(edge))}
                onJumpToEvidenceSource={(item) => {
                  const target = resolveEvidenceSourceJumpTarget(item)
                  if (target) jumpToGraphSource(target)
                }}
                canJumpToEvidenceSource={(item) => Boolean(resolveEvidenceSourceJumpTarget(item))}
                onJumpToParent={
                  parentChapter
                    ? () => {
                        selectChapter(parentChapter)
                      }
                    : undefined
                }
              />
            ) : null}
            continueBlockView={
              activeWorkspaceSelection.kind === 'rewrite' || activeWorkspaceSelection.kind === 'continue_block' ? (
                selectedContinueBlockNode?.continueBlockId ? (
                  <ContinueBlockDetailView
                    novelId={currentNovelId ?? ''}
                    branchId={storyTimelineBranchId}
                    continueBlockId={selectedContinueBlockNode.continueBlockId}
                    latestRevisionNo={selectedContinueBlockNode.latestRevisionNo ?? null}
                    anchorChapterNo={activeWorkspaceSelection.anchorChapterNo}
                    nodeTitle={selectedContinueBlockNode.title}
                    nodeSubtitle={selectedContinueBlockNode.subtitle ?? null}
                    fallbackDetail={{
                      latestText: selectedContinueBlockNode.latestText?.trim() || '',
                      latestRevisionNo: selectedContinueBlockNode.latestRevisionNo ?? 1,
                      title: selectedContinueBlockNode.title,
                      subtitle: selectedContinueBlockNode.subtitle ?? null,
                      userInstruction: selectedContinueBlockNode.userInstruction?.trim() || '',
                      inputTokens: selectedContinueBlockNode.inputTokens ?? null,
                      outputTokens: selectedContinueBlockNode.outputTokens ?? null,
                    }}
                    readableLineageLabel={selectedTimelineDisplayLabel || null}
                    onMetricsChange={handleContinueBlockMetricsChange}
                  />
                ) : null
              ) : null
            }
            whatIfView={
              activeWorkspaceSelection.kind === 'what_if' ? (
                <WhatIfSessionView
                  novelId={currentNovelId ?? ''}
                  branchId={storyTimelineBranchId}
                  sessionId={activeWorkspaceSelection.sessionId}
                  anchorChapterNo={activeWorkspaceSelection.anchorChapterNo}
                  nodeTitle={selectedTimelineNode?.title ?? null}
                  nodeSubtitle={selectedTimelineNode?.subtitle ?? null}
                  readableLineageLabel={selectedTimelineDisplayLabel || null}
                  onMetricsChange={handleWhatIfMetricsChange}
                  onJumpToFuture={launchFutureMapFromWhatIf}
                  onRegenerateWhatIf={(detail) => reopenWhatIfRewriteFlow(detail, 'regenerate')}
                  onContinueInBranch={(detail) => reopenWhatIfRewriteFlow(detail, 'continue')}
                />
              ) : null
            }
            futureJumpView={
              activeWorkspaceSelection.kind === 'future_jump' ? (
                <FutureJumpView
                  novelId={currentNovelId ?? ''}
                  branchId={storyTimelineBranchId}
                  runId={activeWorkspaceSelection.runId}
                  sourceChapterNo={activeWorkspaceSelection.sourceChapterNo}
                  targetChapterNo={activeWorkspaceSelection.targetChapterNo}
                  nodeTitle={selectedTimelineNode?.title ?? null}
                  readableLineageLabel={selectedTimelineDisplayLabel || null}
                  nodeSubtitle={selectedTimelineNode?.subtitle ?? null}
                  onMetricsChange={handleFutureJumpMetricsChange}
                  onContinueInFuture={reopenFutureJumpRewriteFlow}
                />
              ) : null
            }
            roleplayView={
              activeWorkspaceSelection.kind === 'roleplay_session' ? (
                <RoleplaySessionView
                  novelId={currentNovelId ?? ''}
                  branchId={storyTimelineBranchId}
                  sessionId={activeWorkspaceSelection.roleplaySessionId}
                  anchorChapterNo={activeWorkspaceSelection.anchorChapterNo}
                  nodeTitle={selectedTimelineNode?.title ?? null}
                  nodeSubtitle={selectedTimelineNode?.subtitle ?? null}
                  readableLineageLabel={selectedTimelineDisplayLabel || null}
                />
              ) : null
            }
          />
          </div>

          <WorkspaceReferencePanel
            open={referencePanelOpen}
            onClose={() => setReferencePanelOpen(false)}
            knowledgeOpen={knowledgePanelOpen}
            onKnowledgeClose={() => setKnowledgePanelOpen(false)}
            contextLabel={contextLabel}
            selectionActions={null}
            knowledgeControls={knowledgeControls}
            references={(
              <>

            <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
              <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">{t('workspace.shell.charactersCount', { count: currentNovelVisibleCharacterCount })}</div>
              <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">{t('workspace.shell.organizationsCount', { count: currentNovelWorldEntryGroups.organizations.length })}</div>
              <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">{t('workspace.shell.locationsCount', { count: currentNovelWorldEntryGroups.locations.length })}</div>
              <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">{t('workspace.shell.worldbuildingCount', { count: currentNovelWorldEntryGroups.worldbuilding.length })}</div>
              <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">{t('workspace.shell.timelineCount', { count: currentNovelTimelineEvents.length })}</div>
            </div>

            <div className="grid grid-cols-3 gap-1 rounded-2xl bg-black/30 p-1 mb-4">
              {workspaceKnowledgeTabs.map(({ tab, label, icon: TabIcon }) => {
                return (
                  <button
                    key={tab}
                    onClick={() => { setRefTab(tab); setEditState({ type: null, id: null, form: {} }) }}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition justify-center',
                      refTab === tab ? 'bg-white/10 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
                    )}
                  >
                    <TabIcon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                )
              })}
            </div>

            <div className="space-y-2 lg:max-h-[calc(100vh-28rem)] lg:overflow-y-auto">
              {refTab === 'characters' && (
                <>
                  {currentNovelVisibleCharacterCount === 0 && (
                    <p className="text-xs text-zinc-500 text-center py-4">{t('workspace.shell.noCharacterProjection')}</p>
                  )}
                  {currentNovelCharactersSorted.map((char) => {
                     const isEditing = editState.type === 'char' && editState.id === char.id
                     const ef = editState.form
                     const setF = (key: string, val: string) => setEditState((s) => ({ ...s, form: { ...s.form, [key]: val } }))
                     return (
                       <div key={char.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                        {isEditing ? (
                          <>
                            <input value={ef.name ?? ''} onChange={(e) => setF('name', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.namePlaceholder')} />
                            <input value={ef.role ?? ''} onChange={(e) => setF('role', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.rolePlaceholder')} />
                            <input value={ef.goal ?? ''} onChange={(e) => setF('goal', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.goalPlaceholder')} />
                            <input value={ef.trait ?? ''} onChange={(e) => setF('trait', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.traitPlaceholder')} />
                            <textarea value={ef.note ?? ''} onChange={(e) => setF('note', e.target.value)} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.notePlaceholder')} />
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => {
                                useNovelStore.getState().updateCharacter(char.id, { name: ef.name ?? '', role: ef.role ?? '', goal: ef.goal ?? '', trait: ef.trait ?? '', note: ef.note ?? '' })
                                setEditState({ type: null, id: null, form: {} })
                              }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">{t('workspace.shell.save')}</button>
                              <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">{t('workspace.shell.cancel')}</button>
                            </div>
                          </>
                        ) : (
                          <WorkspaceCharacterReferenceCard
                            char={char}
                            knowledgePanelReadOnly={knowledgePanelReadOnly}
                            onEdit={() => setEditState({ type: 'char', id: char.id, form: { name: char.name, role: char.role, goal: char.goal, trait: char.trait, note: char.note } })}
                            onDelete={() => { useNovelStore.getState().deleteCharacter(char.id) }}
                          />
                        )}
                      </div>
                    )
                  })}
                  {!knowledgePanelReadOnly ? (
                    <button onClick={() => setEditState({ type: 'char', id: '__new__', form: { name: '', role: '', goal: '', trait: '', note: '' } })} className="w-full rounded-2xl border border-dashed border-white/10 px-3 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]">
                      <Plus className="h-3.5 w-3.5 inline mr-1" /> {t('workspace.shell.addCharacter')}
                    </button>
                  ) : null}
                  {!knowledgePanelReadOnly && editState.type === 'char' && editState.id === '__new__' && (
                    <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                      <input value={editState.form.name ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, name: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.namePlaceholder')} />
                      <input value={editState.form.role ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, role: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.rolePlaceholder')} />
                      <input value={editState.form.goal ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, goal: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.goalPlaceholder')} />
                      <input value={editState.form.trait ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, trait: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.traitPlaceholder')} />
                      <textarea value={editState.form.note ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, note: e.target.value } }))} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.notePlaceholder')} />
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => {
                          useNovelStore.getState().addCharacter(currentNovelId, { name: editState.form.name ?? '', role: editState.form.role ?? '', goal: editState.form.goal ?? '', trait: editState.form.trait ?? '', note: editState.form.note ?? '' })
                          setEditState({ type: null, id: null, form: {} })
                        }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">{t('workspace.shell.create')}</button>
                        <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">{t('workspace.shell.cancel')}</button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {refTab === 'outline' && (
                <>
                  {currentNovelOutlines.length === 0 && (
                    <p className="text-xs text-zinc-500 text-center py-4">{t('workspace.shell.noOutlineProjection')}</p>
                  )}
                  {currentNovelOutlines.map((item) => {
                    const isEditing = editState.type === 'outline' && editState.id === item.id
                    const ef = editState.form
                    const setF = (key: string, val: string) => setEditState((s) => ({ ...s, form: { ...s.form, [key]: val } }))
                    return (
                      <div key={item.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                        {isEditing ? (
                          <>
                            <input value={ef.title ?? ''} onChange={(e) => setF('title', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.titlePlaceholder')} />
                            <select value={ef.type ?? 'main'} onChange={(e) => setF('type', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none">
                              <option value="main">{OUTLINE_TYPE_LABELS.main}</option>
                              <option value="side">{OUTLINE_TYPE_LABELS.side}</option>
                              <option value="foreshadow">{OUTLINE_TYPE_LABELS.foreshadow}</option>
                              <option value="conflict">{OUTLINE_TYPE_LABELS.conflict}</option>
                              <option value="climax">{OUTLINE_TYPE_LABELS.climax}</option>
                            </select>
                            <textarea value={ef.summary ?? ''} onChange={(e) => setF('summary', e.target.value)} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.summaryPlaceholder')} />
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => {
                                useNovelStore.getState().updateOutlineItem(item.id, { title: ef.title ?? '', type: (ef.type ?? 'main') as OutlineType, summary: ef.summary ?? '' })
                                setEditState({ type: null, id: null, form: {} })
                              }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">{t('workspace.shell.save')}</button>
                              <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">{t('workspace.shell.cancel')}</button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-zinc-100">{item.title}</p>
                                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-500">
                                  {OUTLINE_TYPE_LABELS[item.type]}
                                </span>
                              </div>
                              {!knowledgePanelReadOnly ? (
                                <div className="flex gap-1">
                                  <button onClick={() => setEditState({ type: 'outline', id: item.id, form: { title: item.title, type: item.type, summary: item.summary } })} className="rounded-lg border border-white/10 p-1.5 text-zinc-400 hover:text-zinc-200"><Pencil className="h-3 w-3" /></button>
                                  <button onClick={() => { useNovelStore.getState().deleteOutlineItem(item.id) }} className="rounded-lg border border-white/10 p-1.5 text-rose-400 hover:text-rose-300"><Trash2 className="h-3 w-3" /></button>
                                </div>
                              ) : null}
                            </div>
                            <p className="text-xs leading-6 text-zinc-400 line-clamp-3">{item.summary}</p>
                            {item.relatedChapterIds.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {item.relatedChapterIds.map((chId) => (
                                  <span key={chId} className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-zinc-500">{localChapters.find((ch) => ch.id === chId)?.title ?? chId}</span>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                  {!knowledgePanelReadOnly ? (
                    <button onClick={() => setEditState({ type: 'outline', id: '__new__', form: { title: '', type: 'main', summary: '' } })} className="w-full rounded-2xl border border-dashed border-white/10 px-3 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]">
                      <Plus className="h-3.5 w-3.5 inline mr-1" /> {t('workspace.shell.addOutlineItem')}
                    </button>
                  ) : null}
                  {!knowledgePanelReadOnly && editState.type === 'outline' && editState.id === '__new__' && (
                    <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                      <input value={editState.form.title ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, title: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.titlePlaceholder')} />
                      <select value={editState.form.type ?? 'main'} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, type: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none">
                        <option value="main">{OUTLINE_TYPE_LABELS.main}</option>
                        <option value="side">{OUTLINE_TYPE_LABELS.side}</option>
                        <option value="foreshadow">{OUTLINE_TYPE_LABELS.foreshadow}</option>
                        <option value="conflict">{OUTLINE_TYPE_LABELS.conflict}</option>
                        <option value="climax">{OUTLINE_TYPE_LABELS.climax}</option>
                      </select>
                      <textarea value={editState.form.summary ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, summary: e.target.value } }))} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.summaryPlaceholder')} />
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => {
                          useNovelStore.getState().addOutlineItem(currentNovelId, { title: editState.form.title ?? '', type: (editState.form.type ?? 'main') as OutlineType, summary: editState.form.summary ?? '' })
                          setEditState({ type: null, id: null, form: {} })
                        }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">{t('workspace.shell.create')}</button>
                        <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">{t('workspace.shell.cancel')}</button>
                      </div>
                    </div>
                  )}
                </>
              )}

              <WorkspaceWorldEntriesPanel refTab={refTab} tab="organizations" entries={currentNovelWorldEntryGroups.organizations} emptyMessage={t('workspace.shell.noOrganizationProjection')} addLabel={t('workspace.shell.addOrganizationEntry')} defaultType="organization" currentNovelId={currentNovelId} editState={editState} setEditState={setEditState} knowledgePanelReadOnly={knowledgePanelReadOnly} />

              <WorkspaceWorldEntriesPanel refTab={refTab} tab="locations" entries={currentNovelWorldEntryGroups.locations} emptyMessage={t('workspace.shell.noLocationProjection')} addLabel={t('workspace.shell.addLocationEntry')} defaultType="location" currentNovelId={currentNovelId} editState={editState} setEditState={setEditState} knowledgePanelReadOnly={knowledgePanelReadOnly} />

              <WorkspaceWorldEntriesPanel refTab={refTab} tab="worldbuilding" entries={currentNovelWorldEntryGroups.worldbuilding} emptyMessage={t('workspace.shell.noWorldbuildingProjection')} addLabel={t('workspace.shell.addWorldbuildingEntry')} defaultType="scene" currentNovelId={currentNovelId} editState={editState} setEditState={setEditState} knowledgePanelReadOnly={knowledgePanelReadOnly} />

              {refTab === 'timeline' && (
                <>
                  {currentNovelTimelineEvents.length === 0 && (
                    <p className="text-xs text-zinc-500 text-center py-4">{t('workspace.shell.noTimelineProjection')}</p>
                  )}
                  {currentNovelTimelineEvents.map((event) => {
                    const isEditing = editState.type === 'timeline' && editState.id === event.id
                    const ef = editState.form
                    const setF = (key: string, val: string) => setEditState((s) => ({ ...s, form: { ...s.form, [key]: val } }))
                    return (
                      <div key={event.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                        {isEditing ? (
                          <>
                            <input value={ef.title ?? event.title} onChange={(e) => setF('title', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.eventTitlePlaceholder')} />
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <input value={ef.phase ?? event.phase} onChange={(e) => setF('phase', e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.phasePlaceholder')} />
                              <input value={ef.worldline ?? event.worldline} onChange={(e) => setF('worldline', e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.worldlinePlaceholder')} />
                            </div>
                            <textarea value={ef.summary ?? event.summary} onChange={(e) => setF('summary', e.target.value)} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.eventSummaryPlaceholder')} />
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => {
                                useNovelStore.getState().updateTimelineEvent(event.id, {
                                  title: ef.title ?? event.title,
                                  phase: ef.phase ?? event.phase,
                                  worldline: ef.worldline ?? event.worldline,
                                  summary: ef.summary ?? event.summary,
                                })
                                setEditState({ type: null, id: null, form: {} })
                              }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">{t('workspace.shell.save')}</button>
                              <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">{t('workspace.shell.cancel')}</button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium text-zinc-100">{event.order}. {event.title}</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">{event.phase}</span>
                                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">{event.worldline}</span>
                                </div>
                              </div>
                              {!knowledgePanelReadOnly ? (
                                <div className="flex gap-1">
                                  <button onClick={() => setEditState({ type: 'timeline', id: event.id, form: { title: event.title, phase: event.phase, worldline: event.worldline, summary: event.summary } })} className="rounded-lg border border-white/10 p-1.5 text-zinc-400 hover:text-zinc-200"><Pencil className="h-3 w-3" /></button>
                                  <button onClick={() => useNovelStore.getState().deleteTimelineEvent(event.id)} className="rounded-lg border border-white/10 p-1.5 text-rose-400 hover:text-rose-300"><Trash2 className="h-3 w-3" /></button>
                                </div>
                              ) : null}
                            </div>
                            <p className="mt-3 text-xs leading-6 text-zinc-400">{event.summary}</p>
                            {event.chapterIds.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {event.chapterIds.map((chId) => (
                                  <span key={chId} className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-zinc-500">{localChapters.find((ch) => ch.id === chId)?.title ?? chId}</span>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                  {!knowledgePanelReadOnly ? (
                    <button
                      onClick={() => useNovelStore.getState().addTimelineEvent(currentNovelId, {
                        title: t('workspace.shell.newEventTitle'),
                        phase: t('workspace.shell.pendingPhase'),
                        worldline: t('workspace.shell.mainline'),
                        summary: '',
                        order: currentNovelTimelineEvents.length + 1,
                        chapterIds: currentChapter ? [currentChapter.id] : [],
                      })}
                      className="w-full rounded-2xl border border-dashed border-white/10 px-3 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
                    >
                      <Plus className="h-3.5 w-3.5 inline mr-1" /> {t('workspace.shell.addTimelineEvent')}
                    </button>
                  ) : null}
                </>
              )}
            </div>
              </>
            )}
          />
        </div>
      </div>

      {activeWorkspaceSelection.kind === 'chapter' && centerPaneView === 'body' && toolbarPos && selectionText && !activeMode ? (
        <div
          ref={toolbarRef}
          className="pointer-events-none fixed z-40"
          style={{ top: toolbarPos.top, left: toolbarPos.left, transform: 'translateX(-50%)' }}
        >
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-[#090b10]/96 p-1 shadow-[0_18px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            {WORKSPACE_CHAPTER_ACTION_ENTRY_MODES.map((mode) => {
              const meta = ACTION_META[mode]
              const Icon = meta.icon
              return (
                <button
                  key={mode}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    void openActionMode(mode)
                  }}
                  disabled={mode === 'roleplay' && roleplaySessionStarting}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs transition',
                    activeMode === mode ? 'bg-violet-500 text-white' : 'text-zinc-300 hover:bg-white/[0.08]',
                    mode === 'roleplay' && roleplaySessionStarting && 'cursor-not-allowed opacity-60'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {meta.label}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[80] sm:left-auto sm:right-4 sm:w-full sm:max-w-sm">
          <Notice variant={toastVariant} className="shadow-[0_12px_50px_rgba(0,0,0,0.35)]">
            {toast}
          </Notice>
        </div>
      ) : null}

      {settingsOpen ? (
        <WorkspaceAISettingsModal
          open
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
          scenarioStatusLabels={scenarioStatusLabels}
          resolvedAISettings={resolvedAISettings}
          ollamaModelsByScenario={ollamaModelsByScenario}
          ollamaModelsLoading={ollamaModelsLoading}
          ollamaModelsError={ollamaModelsError}
          openAICompatibleModelsByScenario={openAICompatibleModelsByScenario}
          openAICompatibleModelsLoading={openAICompatibleModelsLoading}
          updateScenarioProvider={updateScenarioProvider}
          updateScenarioOpenAIField={updateScenarioOpenAIField}
          updateScenarioOllamaField={updateScenarioOllamaField}
          updateKnowledgeExtractionParallelism={updateKnowledgeExtractionParallelism}
          updateEmbeddingBatchSize={updateEmbeddingBatchSize}
          applyLocalEmbeddingSettings={applyLocalEmbeddingSettings}
          loadOpenAICompatibleModels={(scenario, baseUrl, apiKey) => {
            void loadOpenAICompatibleModels(scenario, baseUrl, apiKey)
          }}
          loadOllamaModels={(scenario, baseUrl) => {
            void loadOllamaModels(scenario, baseUrl)
          }}
        />
      ) : null}

      {presetCompatLibraryOpen ? (
        <PresetCompatLibraryModal
          activeSurfaceId={activeMode ? toPresetCompatSessionSurfaceId(activeMode) : null}
          activeSelection={activeWorkspaceSelection}
          open
          onLoad={loadPresetCompatLibrary}
          onClose={() => setPresetCompatLibraryOpen(false)}
        />
      ) : null}

      {futureMapLaunch ? (
        <FutureMapOverlay
          novelId={futureMapLaunch.novelId}
          branchId={futureMapLaunch.branchId}
          sourceContext={futureMapLaunch.sourceContext}
          title={futureMapLaunch.title}
          parentTimelineNodeId={futureMapLaunch.parentTimelineNodeId}
          onClose={() => setFutureMapLaunch(null)}
          onCreated={handleFutureJumpCreated}
        />
      ) : null}

      {activeMode ? (
        <DialogSurface
          open
          onClose={closePanel}
          closeLabel={t('common.close')}
          title={(
            <span className="block">
              {!isContinueBlockContinuation ? (
                <span aria-hidden="true" className="block text-[11px] font-normal uppercase tracking-[0.22em] text-zinc-500">{t('workspace.shell.selectedText')}</span>
              ) : null}
              <span className="mt-1 block text-xl font-semibold text-zinc-100">{ACTION_META[activeMode].title}</span>
            </span>
          )}
          description={ACTION_META[activeMode].description}
          placement="bottom"
          backdropTestId="workspace-action-overlay"
          backdropClassName="z-50 bg-black/55"
          className="max-w-3xl bg-[#0d1017] p-4 shadow-[0_-20px_80px_rgba(0,0,0,0.5)] sm:mb-6 sm:rounded-[32px] sm:p-5"
        >
            {!isContinueBlockContinuation ? (
              <div className="mb-4 rounded-[24px] border border-white/8 bg-black/20 p-4" data-testid="workspace-selected-excerpt">
                <p className="mb-2 text-xs uppercase tracking-[0.16em] text-zinc-500">{t('workspace.shell.selectedExcerpt')}</p>
                <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-300">{lockedSelectionText || selectionText}</p>
              </div>
            ) : null}

            {contextPreviewLoading && !generationContext ? (
              <div className="mb-4 rounded-[24px] border border-white/8 bg-black/20 p-4 text-sm text-zinc-400">{t('workspace.shell.loadingContextEvidence')}</div>
            ) : null}

            {!contextPreviewLoading && !generationContext && contextPreviewError ? (
              <div className="mb-4 rounded-[24px] border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-200">{contextPreviewError}</div>
            ) : null}

            {activeMode === 'rewrite' ? (
              <div className="space-y-4">
                <div className="rounded-[26px] border border-violet-400/20 bg-violet-500/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-violet-200/70">{t('workspace.shell.rewriteStudio')}</p>
                      <p className="mt-1 text-sm text-zinc-300">
                        {rewriteLaunchSource === 'future_jump'
                          ? t('workspace.shell.rewriteFutureJumpDescription')
                          : rewriteLaunchSource === 'continue_block'
                            ? t('workspace.shell.rewriteContinueBlockDescription')
                          : t('workspace.shell.rewriteDefaultDescription')}
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {activeContextTokenEstimate !== null ? (
                        <span className="rounded-full border border-amber-300/20 bg-amber-500/10 px-3 py-1 text-xs text-amber-100" data-testid="workspace-context-token-estimate">
                          {t('workspace.shell.contextApproxTokens', { count: activeContextTokenEstimate.toLocaleString() })}
                        </span>
                      ) : null}
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-zinc-300">{rewriteFlow.provider || providerLabel}</span>
                    </div>
                  </div>
                </div>

                {rewriteLaunchSource === 'future_jump' ? (
                  <div className="rounded-[22px] border border-amber-300/18 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
                    {t('workspace.shell.futureJumpNotice')}
                  </div>
                ) : null}

                <label className="block">
                  <span className="mb-2 block text-sm text-zinc-300">{t('workspace.shell.rewriteInstructionLabel')}</span>
                  <textarea value={rewritePrompt} onChange={(event) => handleRewritePromptChange(event.target.value)} className="h-28 w-full rounded-[24px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none" placeholder={t('workspace.shell.rewriteInstructionPlaceholder')} />
                </label>

                <div className="grid gap-3 rounded-[24px] border border-white/8 bg-black/20 p-4 sm:grid-cols-[1fr_auto]">
                  <fieldset className="min-w-0">
                    <legend className="mb-2 block text-sm text-zinc-300">{t('workspace.shell.writingSkillLabel')}</legend>
                    <div className="max-h-44 space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-[#0b0d12] p-2.5">
                      {writingSkillCardsLoading ? (
                        <p className="px-1 py-1 text-sm text-zinc-500">{t('workspace.shell.writingSkillLoading')}</p>
                      ) : writingSkillCards.length ? writingSkillCards.map((card) => {
                        const checked = selectedWritingSkillCardIds.includes(card.id)
                        return (
                          <label
                            key={card.id}
                            className={cn(
                              'flex min-w-0 cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 text-sm transition',
                              checked
                                ? 'border-violet-300/25 bg-violet-500/12 text-violet-50'
                                : 'border-transparent text-zinc-300 hover:border-white/10 hover:bg-white/[0.04]',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => handleWritingSkillSelectionChange(
                                event.target.checked
                                  ? [...selectedWritingSkillCardIds, card.id]
                                  : selectedWritingSkillCardIds.filter((cardId) => cardId !== card.id),
                              )}
                              className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-black/20 text-violet-400"
                            />
                            <span className="min-w-0 break-words leading-5">{card.title}</span>
                          </label>
                        )
                      }) : (
                        <p className="px-1 py-1 text-sm text-zinc-500">{t('workspace.shell.writingSkillNone')}</p>
                      )}
                    </div>
                    {writingSkillCardsError ? <p className="mt-2 text-xs text-rose-300">{writingSkillCardsError}</p> : null}
                  </fieldset>
                  <label className="block sm:w-36">
                    <span className="mb-2 block text-sm text-zinc-300">{t('workspace.shell.writingSkillExampleCount')}</span>
                    <select
                      value={writingSkillExampleCount}
                      onChange={(event) => handleWritingSkillExampleCountChange(Number(event.target.value))}
                      disabled={!selectedWritingSkillCardIds.length}
                      className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-3 py-2.5 text-sm text-zinc-100 outline-none disabled:opacity-40"
                    >
                      {WRITING_SKILL_RUNTIME_EXAMPLE_COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}
                    </select>
                  </label>
                </div>

                {generationContext && activeGraphContext ? (
                  <div className="rounded-[24px] border border-amber-400/18 bg-amber-500/[0.08] p-3">
                    <button
                      type="button"
                      data-testid="workspace-context-panel-toggle"
                      aria-expanded={contextPanelOpen}
                      onClick={() => setContextPanelOpen((current) => !current)}
                      className="flex w-full items-start justify-between gap-3 rounded-[20px] border border-white/10 bg-black/20 px-4 py-3 text-left transition hover:bg-white/[0.05]"
                    >
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-amber-200/70">{t('workspace.shell.advancedContext')}</p>
                        <p className="mt-1 text-sm text-zinc-200">
                          {t(isContinueBlockContinuation
                            ? 'workspace.shell.advancedContinuationContextDescription'
                            : 'workspace.shell.advancedContextDescription')}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-400">
                          <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1">{t('workspace.shell.seedEntitiesCount', { count: activeSeedEntityCount })}</span>
                          <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1">{t('workspace.shell.relationsCount', { count: activeGraphEdgeCount })}</span>
                          <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1">{t('workspace.shell.evidenceCount', { count: activeEvidenceCount })}</span>
                          <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1">{t('workspace.shell.promptBlocksCount', { count: activePromptBlockCount })}</span>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-zinc-300">
                        {contextPanelOpen ? t('workspace.shell.collapse') : t('workspace.shell.expand')}
                        <ChevronDown className={cn('h-4 w-4 transition', contextPanelOpen && 'rotate-180')} />
                      </span>
                    </button>

                    {contextPanelOpen ? (
                      <div className="pt-3" data-testid="workspace-context-panel">
                        <GraphReviewPanel
                          context={{
                            ...generationContext,
                            tokenEstimate: activeContextTokenEstimate ?? generationContext.tokenEstimate,
                            graphContext: activeGraphContext,
                          }}
                          graphNodes={activeGraphContext.nodes}
                          graphEdges={activeGraphContext.edges}
                          controls={graphReviewControls}
                          loading={contextPreviewLoading || graphReviewLoading}
                          error={contextPreviewError}
                          selection={graphSelection}
                          evidenceDrawerOpen={evidenceDrawerOpen}
                          disabledBlockIds={disabledContextBlockIds}
                          excludedEdgeIds={excludedGraphEdgeIds}
                          excludedEvidenceIds={excludedEvidenceIds}
                          edgeMutationPending={Boolean(graphMutationPendingId && graphSelection?.type === 'edge' && graphSelection.edge.id === graphMutationPendingId)}
                          edgeMutationError={graphMutationError}
                          onTogglePromptBlock={(blockId, enabled) => {
                            setDisabledContextBlockIds((current) => (enabled ? current.filter((item) => item !== blockId) : [...current, blockId]))
                          }}
                          onToggleEvidenceDrawer={() => setEvidenceDrawerOpen((current) => !current)}
                          onSelectNode={(node) => setGraphSelection({ type: 'node', node })}
                          onSelectEdge={(edge) => {
                            setGraphSelection({ type: 'edge', edge })
                            if (edge.evidenceQuote || edge.evidenceLocation) {
                              setEvidenceDrawerOpen(true)
                            }
                          }}
                          onClearSelection={() => setGraphSelection(null)}
                          onConfirmEdge={(edge) => {
                            void handleConfirmGraphEdge(edge.id)
                          }}
                          onRejectEdge={(edge) => {
                            void handleRejectGraphEdge(edge.id)
                          }}
                          onSaveEdgeEdit={(edge, draft) => {
                            void handleSaveGraphEdgeEdit(edge.id, draft)
                          }}
                          onToggleNodeExcluded={(node, excluded) => {
                            const connectedEdgeIds = getConnectedGraphEdgeIds(node.id, activeGraphContext.edges)
                            if (!connectedEdgeIds.length) return
                            const nextExcludedGraphEdgeIds = excluded
                              ? Array.from(new Set([...excludedGraphEdgeIds, ...connectedEdgeIds]))
                              : excludedGraphEdgeIds.filter((item) => !connectedEdgeIds.includes(item))
                            void handleExcludedGenerationContextChange({
                              excludedGraphEdgeIds: nextExcludedGraphEdgeIds,
                              excludedEvidenceIds,
                            })
                          }}
                          onToggleEdgeExcluded={(edge, excluded) => {
                            const nextExcludedGraphEdgeIds = excluded
                              ? Array.from(new Set([...excludedGraphEdgeIds, edge.id]))
                              : excludedGraphEdgeIds.filter((item) => item !== edge.id)
                            void handleExcludedGenerationContextChange({
                              excludedGraphEdgeIds: nextExcludedGraphEdgeIds,
                              excludedEvidenceIds,
                            })
                          }}
                          onToggleEvidenceExcluded={(itemId, excluded) => {
                            const nextExcludedEvidenceIds = excluded
                              ? Array.from(new Set([...excludedEvidenceIds, itemId]))
                              : excludedEvidenceIds.filter((item) => item !== itemId)
                            void handleExcludedGenerationContextChange({
                              excludedGraphEdgeIds,
                              excludedEvidenceIds: nextExcludedEvidenceIds,
                            })
                          }}
                          onChangeControls={(controls) => {
                            void handleGraphControlChange(controls)
                          }}
                          onJumpToEdgeSource={(edge) => {
                            const target = resolveEdgeSourceJumpTarget(edge)
                            if (target) jumpToGraphSource(target)
                          }}
                          canJumpToEdgeSource={(edge) => Boolean(resolveEdgeSourceJumpTarget(edge))}
                          onJumpToEvidenceSource={(item) => {
                            const target = resolveEvidenceSourceJumpTarget(item)
                            if (target) jumpToGraphSource(target)
                          }}
                          canJumpToEvidenceSource={(item) => Boolean(resolveEvidenceSourceJumpTarget(item))}
                          onRefresh={() => {
                            void handleRefreshContextReview()
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <button onClick={handleRewrite} disabled={rewriteFlow.loading} className="inline-flex items-center gap-2 rounded-2xl bg-violet-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-violet-400 disabled:opacity-60">
                    {rewriteFlow.loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} {t('workspace.shell.generateVersion')}
                  </button>
                  {rewriteFlow.loading && rewriteFlow.jobId ? (
                    <button onClick={handleAbortRewriteGeneration} className="inline-flex items-center gap-2 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100 transition hover:bg-rose-500/20">
                      <X className="h-4 w-4" /> {t('workspace.action.rewriteAbortedToast')}
                    </button>
                  ) : null}
                  <button onClick={handleSaveContinueBlock} disabled={!selectedRewriteCandidate || saveContinueBlockPending} className="rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/10 px-4 py-3 text-sm text-fuchsia-100 transition hover:bg-fuchsia-500/20 disabled:opacity-40">
                    {saveContinueBlockPending ? <span className="inline-flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin" /> {t('workspace.shell.savePending')}</span> : t('workspace.shell.saveAsContinueBlock')}
                  </button>
                  <button onClick={handleCreateWhatIf} disabled={!selectedRewriteCandidate || saveContinueBlockPending} className="rounded-2xl border border-violet-400/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-100 transition hover:bg-violet-500/20 disabled:opacity-40">
                    {t('workspace.shell.createWhatIf')}
                  </button>
                  <button onClick={() => selectedRewriteCandidate && applyFullChapter(selectedRewriteCandidate.content)} disabled={!selectedRewriteCandidate || rewriteLaunchSource === 'future_jump'} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-40">
                    {rewriteLaunchSource === 'future_jump' ? t('workspace.shell.keepBodyUnchanged') : t('workspace.shell.replaceBody')}
                  </button>
                  <button onClick={() => selectedRewriteCandidate && copyText('rewrite', selectedRewriteCandidate.content)} disabled={!selectedRewriteCandidate} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-40">
                    {copied === 'rewrite' ? <span className="inline-flex items-center gap-2"><Check className="h-4 w-4" /> {t('workspace.shell.copied')}</span> : t('workspace.shell.copyResult')}
                  </button>
                  <button onClick={() => selectedRewriteCandidate && handleRewritePromptChange((current) => `${current}\n\n${t('workspace.shell.continueRewritePromptAppend')}`)} disabled={!selectedRewriteCandidate} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-40">
                    {t('workspace.shell.continueRewrite')}
                  </button>
                </div>

                {saveContinueBlockError ? <p data-testid="continue-block-save-error" className="text-sm text-rose-300">{saveContinueBlockError}</p> : null}
                {rewriteFlow.error ? <p data-testid="rewrite-flow-error" className="text-sm text-rose-300">{rewriteFlow.error}</p> : null}

                <div className="grid gap-3 lg:grid-cols-[0.9fr_1.4fr]">
                  <div className="space-y-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">{t('workspace.shell.generateVersion')}</p>
                    {rewriteFlow.loading ? (
                      <div className="rounded-[24px] border border-white/8 bg-black/20 p-4 text-sm text-zinc-400">
                        <p>{rewriteFlow.jobCurrentStep?.trim() || t('workspace.shell.generatingVersion')}</p>
                        {rewriteFlow.jobId ? (
                          <button onClick={handleAbortRewriteGeneration} className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-rose-400/25 px-3 py-1.5 text-xs text-rose-100 transition hover:bg-rose-500/10">
                            <X className="h-3.5 w-3.5" /> {t('workspace.action.rewriteAbortedToast')}
                          </button>
                        ) : null}
                        {previewRewriteContent ? (
                          <p className="mt-3 line-clamp-4 text-xs leading-6 text-zinc-500">{previewRewriteContent}</p>
                        ) : null}
                      </div>
                    ) : selectedRewriteCandidate ? (
                      <div className="w-full rounded-[24px] border border-violet-400/30 bg-violet-500/12 px-4 py-4 text-left">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-zinc-100">{selectedRewriteCandidate.title}</p>
                          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">{t('workspace.shell.generatedBadge')}</span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-400">{selectedRewriteCandidate.summary}</p>
                        <p className="mt-3 line-clamp-4 text-xs leading-6 text-zinc-500">{selectedRewriteCandidate.content}</p>
                      </div>
                    ) : (
                      <div className="rounded-[24px] border border-white/8 bg-black/20 p-4 text-sm text-zinc-400">{t('workspace.shell.generatedEmpty')}</div>
                    )}
                  </div>

                  <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">{t('workspace.shell.previewResult')}</p>
                      {selectedRewriteCandidate ? <span className="text-xs text-zinc-500">{selectedRewriteCandidate.title}</span> : null}
                    </div>
                    <p className="min-h-72 whitespace-pre-wrap text-sm leading-7 text-zinc-300">{previewRewriteContent || t('workspace.shell.previewEmpty')}</p>
                  </div>
                </div>
              </div>
            ) : null}

        </DialogSurface>
      ) : null}
    </main>
  )
}
