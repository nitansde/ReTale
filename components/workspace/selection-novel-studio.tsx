"use client"

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  ArrowLeft,
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
  ScrollText,
  Sparkles,
  Settings2,
  Trash2,
  Users,
  Wand2,
  X,
} from 'lucide-react'
import { FutureJumpView, type FutureJumpContinueContext } from '@/components/future-jump/FutureJumpView'
import { ChapterGraphBrowser } from '@/components/graph/chapter-graph-browser'
import { getVisibleAdvancedContextPromptBlocks, GraphReviewPanel } from '@/components/graph/graph-review-panel'
import { FutureMapOverlay } from '@/components/what-if/FutureMapOverlay'
import { WhatIfSessionView } from '@/components/what-if/WhatIfSessionView'
import { ContinueBlockDetailView } from '@/components/workspace/ContinueBlockDetailView'
import { PresetCompatLibraryModal } from '@/components/workspace/PresetCompatLibraryModal'
import { RoleplaySessionView } from '@/components/workspace/RoleplaySessionView'
import { WorkspaceCenterPane } from '@/components/workspace/WorkspaceCenterPane'
import { WorkspaceChapterNav } from '@/components/workspace/WorkspaceChapterNav'
import { WorkspaceReferencePanel } from '@/components/workspace/WorkspaceReferencePanel'
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
import type { PresetCompatSurfaceId } from '@/lib/preset-compat/types'
import { formatStoryBranchInstructionPreview } from '@/lib/story-branch-labels'
import { createPresetCompatSessionStateKey } from '@/lib/workspace-state'
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

const TOOLBAR_EDGE_PADDING = 12
const TOOLBAR_OFFSET_Y = 56
export const DEFAULT_REWRITE_PROMPT = '保留核心剧情，围绕选中部分做更大胆、更有戏剧张力的整章重写。'

type GenerationState = {
  loading: boolean
  result: string
  error: string
}

type RewriteApiCandidate = {
  title: string
  summary: string
  content: string
  inputTokens?: number | null
  outputTokens?: number | null
}

type RecoverableRewriteResult = RewriteApiCandidate & {
  provider: string
  metadata?: unknown
  presetCompat?: unknown
}

type RecoverableRewriteJob = {
  jobId: string
  status: string
  progress: number
  currentStep: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  panel: {
    novelId: string
    branchId: string
    chapterId: string
    selectedText: string
    sourceText: string
    sourceTextOverride: string | null
    userInstruction: string
    rewriteLaunchSource: string | null
    createdAt: string
  }
  result: RecoverableRewriteResult | null
}

type RewriteFlowState = {
  loading: boolean
  error: string
  provider: string
  candidates: RewriteApiCandidate[]
  selectedIndex: number
  jobId: string | null
  jobStatus: string | null
  jobCurrentStep: string | null
}

type PendingWhatIfRewriteLaunch = {
  detail: WhatIfSessionDetail
  targetChapterId: string
  variant: 'regenerate' | 'continue'
}

type PendingFutureJumpRewriteLaunch = {
  detail: FutureJumpRunDetail
  targetChapterId: string
  targetTitle: string
  parentTimelineNodeId: string | null
  selectedText: string
  originalText: string
  userInstruction: string
  inputTokens?: number | null
  outputTokens?: number | null
}

type PendingContinueBlockRewriteLaunch = {
  continueBlockId: string
  nodeId: string
  anchorChapterNo: number
  latestText: string
  userInstruction: string
  selectedText: string
  originalText: string
  title: string
  subtitle: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  targetChapterId: string
  variant: 'continue' | 'regenerate'
}

type RewriteLaunchSource = 'chapter' | 'what_if' | 'future_jump' | 'continue_block'

type BranchContextPreviewOptions = {
  branchContextNodeId?: string
  branchContextInclusion?: 'ancestors_only' | 'include_selected'
  omitSelectedText?: boolean
}

type FutureMapLaunchState = {
  novelId: string
  branchId: string
  sourceContext: FutureJumpSourceContext
  title: string
  parentTimelineNodeId: string | null
}

type KnowledgeRebuildStatus = {
  jobId: string
  novelId: string
  status: string
  errorMessage?: string | null
  progress: number
  currentStep: string | null
  createdAt: string
  updatedAt: string
  etaMinutes: number | null
  steps: Array<{
    key: 'hanlp-bootstrap' | 'extract' | 'batch-sync' | 'cleanup' | 'write' | 'raw-embedding' | 'index'
    label: string
    status: 'pending' | 'running' | 'paused' | 'completed'
    progress: number
    etaMinutes: number | null
    detail: string | null
  }>
  chapterRange?: KnowledgeRebuildChapterRange
  rawTextEmbeddingProgress?: number
  rawTextEmbeddingCacheHitRate?: number
  hanlpCacheStatus?: 'queued' | 'running' | 'paused' | 'ready' | 'empty'
  hanlpCacheHitRate?: number
  hanlpBootstrapProgress?: number
  hanlpBootstrapCompletedChapterCount?: number
  hanlpBootstrapTotalChapterCount?: number
  hanlpBootstrapCacheHitCount?: number
  hanlpBootstrapCacheMissCount?: number
  hanlpBootstrapInitializedCharacterEntities?: boolean
  hanlpSettingsSnapshot?: {
    hanlpScriptVersionHash: string
    hanlpModelOrConfigHash: string
    outputSchemaVersion: string
    pipelineVersion: string
  }
  stageTimingsMs?: Record<string, number>
  embeddingSettingsSnapshot?: {
    provider: string
    model: string
    embeddingBatchSize: number
  }
}

type HanlpCacheSnapshot = {
  status: NonNullable<KnowledgeRebuildStatus['hanlpCacheStatus']>
  settingsSnapshot?: NonNullable<KnowledgeRebuildStatus['hanlpSettingsSnapshot']>
}

export function resolveCurrentNodeMetrics(params: {
  selection: TimelineSelection
  chapterText: string
  selectedNode: StoryTimelineBranchNode | null
  override?: { currentText: string; inputTokens: number | null; outputTokens: number | null } | null
}) {
  const override = params.override ?? null
  const visibleText = params.selection.kind === 'chapter'
    ? params.chapterText
    : override?.currentText ?? params.selectedNode?.currentText ?? params.selectedNode?.latestText ?? ''

  return {
    wordCount: countChineseFriendlyWords(visibleText),
    inputTokens: params.selection.kind === 'chapter'
      ? null
      : override
        ? override.inputTokens
        : params.selectedNode?.inputTokens ?? null,
    outputTokens: params.selection.kind === 'chapter'
      ? null
      : override
        ? override.outputTokens
        : params.selectedNode?.outputTokens ?? null,
  }
}

export function shouldLoadWorkspaceFromBackendOnMount(backendLoaded: boolean) {
  return !backendLoaded
}

function buildContinueBlockLineageRequestContext(context: PendingContinueBlockRewriteLaunch | null): BranchContextPreviewOptions {
  if (!context) return {}
  const nodeId = context.nodeId.trim()
  if (!nodeId) return {}

  return {
    branchContextNodeId: nodeId,
    branchContextInclusion: 'include_selected',
    omitSelectedText: context.variant === 'continue',
  }
}

type OllamaModelOption = {
  id: string
  label: string
  family?: string
  parameterSize?: string
  quantization?: string
}

type OpenAICompatibleModelOption = {
  id: string
  label: string
}

const AI_SCENARIO_META: Record<AIScenarioKey, {
  eyebrow: string
  title: string
  description: string
  shortLabel: string
  ollamaPurpose: 'text' | 'embedding'
  openAIPlaceholder: string
  ollamaPlaceholder: string
}> = {
  rewrite: {
    eyebrow: 'Rewrite',
    title: '改写模型场景',
    description: '用于魔改、扩写和角色扮演生成。可以走在线 OpenAI-compatible API，也可以切到本地 Ollama。',
    shortLabel: '改写',
    ollamaPurpose: 'text',
    openAIPlaceholder: 'deepseek-v4-flash',
    ollamaPlaceholder: 'qwen3:8b',
  },
  knowledgeExtraction: {
    eyebrow: 'Knowledge extraction',
    title: '知识抽取场景',
    description: '用于知识视图与图谱抽取。这里会按当前场景独立保存 provider、模型和连接信息。',
    shortLabel: '知识',
    ollamaPurpose: 'text',
    openAIPlaceholder: 'gpt-4.1-mini',
    ollamaPlaceholder: 'llama3.1:8b',
  },
  embeddings: {
    eyebrow: 'Embeddings',
    title: 'Embedding 场景',
    description: '用于向量化与检索相关能力。支持 OpenAI-compatible embedding 模型，也支持本地 Ollama embedding 模型。',
    shortLabel: '向量',
    ollamaPurpose: 'embedding',
    openAIPlaceholder: 'text-embedding-3-large',
    ollamaPlaceholder: 'nomic-embed-text',
  },
}

function WorkspaceStatusState(props: {
  icon: typeof LoaderCircle
  title: string
  description: string
  ctaLabel?: string
}) {
  const Icon = props.icon

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(129,140,248,0.12),_transparent_30%),#0a0c12] text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-[1600px] items-center justify-center px-3 py-8 sm:px-5 lg:px-6">
        <section className="w-full max-w-2xl rounded-[30px] border border-white/10 bg-[#11141d] p-6 shadow-[0_28px_90px_rgba(0,0,0,0.35)] sm:p-8">
          <div className="rounded-[24px] border border-white/8 bg-[#0b0d12] p-6 sm:p-7">
            <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-[20px] border border-white/10 bg-white/[0.04] text-zinc-200">
              <Icon className={cn('h-6 w-6', props.icon === LoaderCircle && 'animate-spin')} />
            </div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Workspace</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">{props.title}</h1>
            <p className="mt-3 max-w-xl text-sm leading-7 text-zinc-400">{props.description}</p>
            {props.ctaLabel ? (
              <div className="mt-6">
                <Link
                  href="/library"
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-zinc-100 transition hover:bg-white/[0.08]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {props.ctaLabel}
                </Link>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  )
}

const OUTLINE_TYPE_LABELS: Record<OutlineType, string> = {
  main: '主线',
  side: '支线',
  foreshadow: '伏笔',
  conflict: '冲突',
  climax: '高潮',
}

const WORLD_TYPE_LABELS: Record<WorldEntryType, string> = {
  location: '地点',
  scene: '场景',
  organization: '组织',
  rule: '规则',
  item: '物件',
  history: '历史',
}

const KNOWLEDGE_STEP_STATUS_LABELS: Record<KnowledgeRebuildStatus['steps'][number]['status'], string> = {
  pending: '待处理',
  running: '进行中',
  paused: '已暂停',
  completed: '已完成',
}

const HANLP_CACHE_STATUS_LABELS: Record<NonNullable<KnowledgeRebuildStatus['hanlpCacheStatus']>, string> = {
  queued: '排队中',
  running: '扫描中',
  paused: '已暂停',
  ready: '缓存就绪',
  empty: '暂无缓存',
}

const CHARACTER_CLASSIFICATION_DISPLAY_LABELS: Record<NonNullable<Character['classificationKey']>, string> = {
  tier0: 'Tier 0 主角',
  tier1: 'Tier 1 重要配角',
  tier2: 'Tier 2 篇章配角',
  candidate: 'Candidate',
  ignored: 'Ignored',
}

const RAW_TEXT_PRECOMPUTE_STAGE_KEY = 'raw_text_precompute'
const HANLP_BOOTSTRAP_STAGE_KEY = 'hanlp-bootstrap'

type KnowledgeStepDisplayStatus = KnowledgeRebuildStatus['steps'][number]['status']

type KnowledgeRebuildRangeMode = 'all' | 'first' | 'custom'

function toProgressPercent(value: number | null | undefined) {
  return Math.max(0, Math.min(100, Math.round((value ?? 0) * 100)))
}

function formatStageDuration(ms: number) {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`

  const totalSeconds = ms / 1000
  if (totalSeconds < 60) {
    return `${totalSeconds >= 10 ? Math.round(totalSeconds) : totalSeconds.toFixed(1)} 秒`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`
}

function formatEmbeddingProviderLabel(provider: string) {
  if (provider === 'openai-compatible') return 'OpenAI-compatible'
  if (provider === 'ollama') return 'Ollama'
  return provider
}

function parsePositiveChapterInput(value: string) {
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : null
}

export function normalizeKnowledgeRebuildChapterRangeInput(params: {
  mode: KnowledgeRebuildRangeMode
  firstChapterCount: string
  startChapter: string
  endChapter: string
  maxChapterCount: number
}): KnowledgeRebuildChapterRange | undefined {
  const maxChapterCount = Math.max(0, Math.floor(params.maxChapterCount))
  if (params.mode === 'all' || maxChapterCount <= 0) return undefined

  if (params.mode === 'first') {
    const requestedEnd = parsePositiveChapterInput(params.firstChapterCount) ?? maxChapterCount
    return { startChapter: 1, endChapter: Math.min(maxChapterCount, requestedEnd) }
  }

  const requestedStart = parsePositiveChapterInput(params.startChapter) ?? 1
  const requestedEnd = parsePositiveChapterInput(params.endChapter) ?? maxChapterCount
  const startChapter = Math.min(maxChapterCount, requestedStart)
  const endChapter = Math.min(maxChapterCount, requestedEnd)
  return startChapter <= endChapter
    ? { startChapter, endChapter }
    : { startChapter: endChapter, endChapter: startChapter }
}

function formatKnowledgeRebuildChapterRangeLabel(range: KnowledgeRebuildChapterRange | null | undefined) {
  if (!range?.startChapter && !range?.endChapter) return '全部章节'
  if ((range.startChapter ?? 1) <= 1 && range.endChapter) return `前 ${range.endChapter} 章`
  if (range.startChapter && range.endChapter) return `第 ${range.startChapter}-${range.endChapter} 章`
  if (range.startChapter) return `第 ${range.startChapter} 章起`
  return `前 ${range.endChapter} 章`
}

export function getCharacterClassificationBadgeLabel(character: Pick<Character, 'classificationKey' | 'classificationLabel' | 'importanceTier'>) {
  if (character.classificationKey && character.classificationKey in CHARACTER_CLASSIFICATION_DISPLAY_LABELS) {
    return CHARACTER_CLASSIFICATION_DISPLAY_LABELS[character.classificationKey]
  }

  if (character.importanceTier === 'candidate') return 'Candidate'
  if (character.importanceTier === 'ignored') return 'Ignored'

  return character.classificationLabel?.trim() || null
}

type WorkspaceWorldEntryGroups = {
  organizations: WorldEntry[]
  locations: WorldEntry[]
  worldbuilding: WorldEntry[]
}

function getWorkspaceCharacterImportanceRank(importanceTier: Character['importanceTier']) {
  switch (importanceTier) {
    case 'protagonist':
      return 0
    case 'important':
      return 1
    case 'arc':
      return 2
    case 'candidate':
      return 3
    case 'ignored':
      return 4
    default:
      return 5
  }
}

export function sortCharactersForWorkspaceRail(characters: Character[]) {
  return characters.slice().sort((left, right) => {
    const leftRank = getWorkspaceCharacterImportanceRank(left.importanceTier)
    const rightRank = getWorkspaceCharacterImportanceRank(right.importanceTier)
    if (leftRank !== rightRank) return leftRank - rightRank

    const nameOrder = left.name.localeCompare(right.name, 'zh-Hans-CN')
    if (nameOrder !== 0) return nameOrder

    return left.id.localeCompare(right.id)
  })
}

export function groupWorldEntriesForWorkspaceRail(entries: WorldEntry[]): WorkspaceWorldEntryGroups {
  return entries.reduce<WorkspaceWorldEntryGroups>((groups, entry) => {
    if (entry.type === 'organization') {
      groups.organizations.push(entry)
    } else if (entry.type === 'location') {
      groups.locations.push(entry)
    } else {
      groups.worldbuilding.push(entry)
    }

    return groups
  }, {
    organizations: [],
    locations: [],
    worldbuilding: [],
  })
}

function formatKnowledgeEtaLabel(params: {
  etaMinutes: number | null | undefined
  isPaused: boolean
  isFailed: boolean
  hasTelemetry: boolean
}) {
  if (params.isFailed) return '已失败'
  if (params.isPaused) return '已暂停'
  if (typeof params.etaMinutes === 'number' && Number.isFinite(params.etaMinutes) && params.etaMinutes > 0) {
    return `约 ${params.etaMinutes} 分钟`
  }
  return params.hasTelemetry ? '计算中' : '等待进度'
}

function resolveKnowledgeStepDisplayStatus(params: {
  step: KnowledgeRebuildStatus['steps'][number]
  isCurrentRunningStep: boolean
}) {
  const stepProgress = toProgressPercent(params.step.progress)
  const isSaturated = stepProgress >= 100

  if (params.step.status === 'completed') return 'completed' satisfies KnowledgeStepDisplayStatus
  if (!params.isCurrentRunningStep && isSaturated) return 'completed' satisfies KnowledgeStepDisplayStatus
  return params.step.status
}

export function resolveKnowledgeRebuildFailureMessage(status: Pick<KnowledgeRebuildStatus, 'status' | 'errorMessage'> | null) {
  if (status?.status !== 'failed') return null
  return status.errorMessage?.trim() || '知识视图重建失败，请重新发起重建。'
}

type KnowledgeActionLoading =
  | 'pause'
  | 'abort'
  | 'delete'
  | 'delete-hanlp-cache'
  | 'delete-extraction-cache'
  | 'delete-embedding-cache'
  | null

export function resolveCacheDeleteState(params: {
  knowledgeRebuildStatus: Pick<KnowledgeRebuildStatus, 'status'> | null
  knowledgeActionLoading: KnowledgeActionLoading
  idleHelperText: string
}) {
  const blockedByActiveRebuild = params.knowledgeRebuildStatus?.status === 'queued'
    || params.knowledgeRebuildStatus?.status === 'running'
    || params.knowledgeRebuildStatus?.status === 'paused'

  return {
    disabled: blockedByActiveRebuild || Boolean(params.knowledgeActionLoading),
    helperText: blockedByActiveRebuild
      ? '当前知识重建任务仍在进行中或已暂停，需先终止或完成当前重建后才能删除缓存。'
      : params.idleHelperText,
  }
}

export function resolveHanlpCacheDeleteState(params: {
  knowledgeRebuildStatus: Pick<KnowledgeRebuildStatus, 'status'> | null
  knowledgeActionLoading: KnowledgeActionLoading
}) {
  return resolveCacheDeleteState({
    ...params,
    idleHelperText: '只会删除当前小说主分支的 HanLP 缓存，不会影响正文或原文 Embedding 缓存。',
  })
}

const ACTION_META: Record<WorkspaceActionMode, { label: string; title: string; description: string; icon: typeof Wand2 }> = {
  rewrite: {
    label: '魔改',
    title: '魔改 · 全章重写',
    description: '围绕选中片段与额外要求，产出一个完整章节重写版本。',
    icon: Wand2,
  },
  future_jump: {
    label: '未来跳转',
    title: 'Future Jump · 目标节点改写',
    description: '围绕 what-if 分歧与桥接上下文，生成目标未来节点的改写结果。',
    icon: Sparkles,
  },
  roleplay: {
    label: '角色扮演',
    title: '角色扮演 · 剧情推进',
    description: '像聊天一样输入角色台词或行动，让故事围绕当前选区继续推进。',
    icon: MessageCircleMore,
  },
}

const CHAPTER_ACTION_ENTRY_TEST_IDS = {
  rewrite: 'workspace-chapter-rewrite-entry',
  roleplay: 'workspace-chapter-roleplay-entry',
} as const

const CONTINUE_BLOCK_ACTION_TEST_IDS = {
  continue: 'workspace-continue-block-continue-entry',
  regenerate: 'workspace-continue-block-regenerate-entry',
  futureJump: 'workspace-continue-block-future-jump-entry',
} as const

const CHARACTER_PROFILE_LABELS = {
  personality: '性格',
  gender: '性别',
  identity: '身份 / 背景',
  capability: '能力 / 战力',
  appearance: '外形',
  body: '体态',
  clothing: '衣着',
  speakingStyle: '说话风格',
  likes: '偏好',
} as const

const CHARACTER_PROFILE_ORDER = [
  'identity',
  'capability',
  'personality',
  'gender',
  'appearance',
  'body',
  'clothing',
  'speakingStyle',
  'likes',
] as const

const WORKSPACE_CHARACTER_PLACEHOLDER_ROLES = new Set(['角色', '主要人物'])
const WORKSPACE_CHARACTER_PLACEHOLDER_TEXT = new Set(['待补充'])

export function getCharacterFacetContent(facet?: CharacterRoleCardFacet | null) {
  return facet?.content?.trim() || facet?.summary?.trim() || ''
}

export function hasCharacterProfile(profile: Character['profile']) {
  return CHARACTER_PROFILE_ORDER.some((key) => Boolean(getCharacterFacetContent(profile?.[key])))
}

function isWorkspaceCharacterPlaceholderText(value: string) {
  return WORKSPACE_CHARACTER_PLACEHOLDER_TEXT.has(value)
}

export function isWorkspaceCharacterVisible(character: Character) {
  const aliases = (character.aliases ?? []).map((alias) => alias.trim()).filter(Boolean)
  if (aliases.length > 0) return true
  if (hasCharacterProfile(character.profile)) return true

  const role = character.role.trim()
  if (role && !WORKSPACE_CHARACTER_PLACEHOLDER_ROLES.has(role)) return true

  const goal = character.goal.trim()
  if (goal && !isWorkspaceCharacterPlaceholderText(goal)) return true

  const trait = character.trait.trim()
  if (trait && !isWorkspaceCharacterPlaceholderText(trait)) return true

  const note = character.note.trim()
  if (note && !isWorkspaceCharacterPlaceholderText(note)) return true

  return false
}

export function filterWorkspaceVisibleCharacters(characters: Character[]) {
  return characters.filter(isWorkspaceCharacterVisible)
}

export function buildCharacterProfileSections(profile: Character['profile']) {
  return CHARACTER_PROFILE_ORDER.flatMap((key) => {
    const facet = profile?.[key]
    const content = getCharacterFacetContent(facet)
    if (!content) return []
    return [{
      key,
      label: CHARACTER_PROFILE_LABELS[key],
      summary: content,
      note: facet?.note?.trim() || '',
      evidence: facet?.evidence?.trim() || '',
    }]
  })
}

export function characterCardNeedsExpansion(params: {
  profileSections: ReturnType<typeof buildCharacterProfileSections>
  note: string
}) {
  const { profileSections, note } = params
  if (profileSections.length > 3) return true
  if (note.length > 120) return true
  return profileSections.some((section) => section.note.length > 72 || section.evidence.length > 96 || section.summary.length > 140)
}

export function WorkspaceCharacterReferenceCard({
  char,
  knowledgePanelReadOnly,
  onEdit,
  onDelete,
}: {
  char: Character
  knowledgePanelReadOnly: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const profileSections = buildCharacterProfileSections(char.profile)
  const showProfile = hasCharacterProfile(char.profile)
  const classificationBadgeLabel = getCharacterClassificationBadgeLabel(char)
  const aliasBadges = (char.aliases ?? []).map((alias) => alias.trim()).filter(Boolean)
  const identitySummary = getCharacterFacetContent(char.profile?.identity)
  const genderSummary = getCharacterFacetContent(char.profile?.gender)
  const capabilitySummary = getCharacterFacetContent(char.profile?.capability)
  const speakingStyleSummary = getCharacterFacetContent(char.profile?.speakingStyle)
  const supplementalNote = char.note.trim()
  const noteMatchesIdentity = supplementalNote && supplementalNote === identitySummary
  const cardCanExpand = characterCardNeedsExpansion({
    profileSections,
    note: noteMatchesIdentity ? '' : supplementalNote,
  })
  const collapsedPrioritySections = profileSections.filter((section) => ['identity', 'capability', 'personality'].includes(section.key))
  const visibleProfileSections = !cardCanExpand || isExpanded
    ? profileSections
    : (collapsedPrioritySections.length > 0 ? collapsedPrioritySections : profileSections).slice(0, 3)

  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <p className="text-sm font-medium text-zinc-100">{char.name}</p>
          <p className="text-xs text-violet-300">{showProfile ? (identitySummary || char.role) : char.role}</p>
        </div>
        {!knowledgePanelReadOnly ? (
          <div className="flex gap-1">
            <button onClick={onEdit} className="rounded-lg border border-white/10 p-1.5 text-zinc-400 hover:text-zinc-200"><Pencil className="h-3 w-3" /></button>
            <button onClick={onDelete} className="rounded-lg border border-white/10 p-1.5 text-rose-400 hover:text-rose-300"><Trash2 className="h-3 w-3" /></button>
          </div>
        ) : null}
      </div>
      {(classificationBadgeLabel || aliasBadges.length > 0 || genderSummary || capabilitySummary || speakingStyleSummary) ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {classificationBadgeLabel ? (
            <span
              data-testid={`workspace-character-tier-${char.classificationKey ?? char.importanceTier ?? 'unknown'}`}
              className="rounded-full border border-emerald-300/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-100"
            >
              {classificationBadgeLabel}
            </span>
          ) : null}
          {aliasBadges.map((alias) => (
            <span key={`${char.id}-${alias}`} className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">
              别名 · {alias}
            </span>
          ))}
          {genderSummary ? <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">{genderSummary}</span> : null}
          {capabilitySummary ? <span className="rounded-full border border-violet-300/20 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-200">{capabilitySummary}</span> : null}
          {speakingStyleSummary ? <span className="rounded-full border border-sky-300/20 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-200">{speakingStyleSummary}</span> : null}
        </div>
      ) : null}
      {showProfile ? (
        <div className="space-y-2">
          <div id={`workspace-character-profile-${char.id}`} className="space-y-2 text-xs leading-5 text-zinc-300">
            {visibleProfileSections.map((section) => (
              <div key={section.key} className="rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{section.label}</p>
                <p className="mt-1 text-zinc-200">{section.summary}</p>
                {section.note ? <p className={cn('mt-1 text-zinc-400', !isExpanded && cardCanExpand && 'line-clamp-2')}>注：{section.note}</p> : null}
                {section.evidence ? <p className={cn('mt-1 text-zinc-500', !isExpanded && cardCanExpand && 'line-clamp-2')}>证：{section.evidence}</p> : null}
              </div>
            ))}
          </div>
          {supplementalNote && !noteMatchesIdentity ? (
            <p className={cn('text-xs leading-5 text-zinc-500', !isExpanded && cardCanExpand && 'line-clamp-2')}>补充：{supplementalNote}</p>
          ) : null}
          {cardCanExpand ? (
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-controls={`workspace-character-profile-${char.id}`}
              onClick={() => setIsExpanded((current) => !current)}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-zinc-400 transition hover:border-white/20 hover:text-zinc-200"
            >
              <ChevronDown className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-180')} />
              {isExpanded ? '收起详情' : '展开详情'}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-1 text-xs leading-5 text-zinc-400">
          <p><span className="text-zinc-500">目标</span> {char.goal}</p>
          <p><span className="text-zinc-500">性格</span> {char.trait}</p>
          {char.note && <p className="line-clamp-2"><span className="text-zinc-500">备注</span> {char.note}</p>}
        </div>
      )}
    </>
  )
}

const CHAPTER_PAGE_SIZE = 80

const DEFAULT_GRAPH_REVIEW_CONTROLS: GraphReviewControls = {
  maxHops: 1,
  hideLowConfidence: true,
  confirmedOnly: false,
  showPotentiallyStale: true,
}

function normalizeSourceSearchText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function buildChapterLineExcerpt(chapter: Chapter, lineStart: number | null, lineEnd: number | null) {
  if (lineStart === null || lineStart < 1) return ''

  const lines = htmlToPlainText(chapter.content)
    .split('\n')
    .map((line) => line.trim())

  const startIndex = Math.max(0, lineStart - 1)
  const endIndex = Math.max(startIndex, (lineEnd ?? lineStart) - 1)
  return lines.slice(startIndex, endIndex + 1).join(' ').trim()
}

function findSourceBlock(root: HTMLElement, searchText: string) {
  const normalizedSearchText = normalizeSourceSearchText(searchText)
  if (!normalizedSearchText) return null

  const blocks = Array.from(root.querySelectorAll<HTMLElement>('p, li, blockquote, h1, h2, h3, h4, h5, h6'))
  const probes = [120, 80, 48, 24]

  for (const length of probes) {
    const probe = normalizedSearchText.slice(0, Math.min(length, normalizedSearchText.length))
    if (!probe) continue

    const match = blocks.find((block) => {
      const text = normalizeSourceSearchText(block.textContent ?? '')
      return text.includes(probe) || probe.includes(text)
    })

    if (match) return match
  }

  return null
}

function extractSelection(root: HTMLElement | null) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !root) return null
  const range = selection.getRangeAt(0)
  const text = selection.toString().trim()
  if (!text) return null
  const common = range.commonAncestorContainer
  const isInside = root.contains(common.nodeType === Node.TEXT_NODE ? common.parentNode : common)
  if (!isInside) return null
  const rect = range.getBoundingClientRect()
  return {
    text,
    rect,
  }
}

async function callGenerationContextApi(payload: Record<string, unknown>): Promise<GenerationContextResponse> {
  const response = await fetch('/api/rag/build-generation-context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return response.json()
}

async function callGraphSubgraphApi(url: string): Promise<GraphSubgraphResponse> {
  const response = await fetch(url, { cache: 'no-store' })
  return response.json()
}

async function callChapterGraphContextApi(url: string): Promise<ChapterGraphContextResponse> {
  const response = await fetch(url, { cache: 'no-store' })
  return response.json()
}

async function callGraphEdgeConfirmApi(edgeId: string) {
  const response = await fetch(`/api/graph/edge/${edgeId}/confirm`, { method: 'POST' })
  return response.json()
}

async function callGraphEdgeRejectApi(edgeId: string) {
  const response = await fetch(`/api/graph/edge/${edgeId}/reject`, { method: 'POST' })
  return response.json()
}

async function callGraphEdgeEditApi(edgeId: string, payload: Record<string, unknown>) {
  const response = await fetch(`/api/graph/edge/${edgeId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return response.json()
}

function resolveGraphSelection(graph: GenerationContextBuildData['graphContext'], selection: GraphSelection) {
  if (selection?.type === 'node') {
    const nextNode = graph.nodes.find((node) => node.id === selection.node.id) ?? graph.seedEntities.find((node) => node.id === selection.node.id)
    if (nextNode) return { type: 'node', node: nextNode } satisfies GraphSelection
  }

  if (selection?.type === 'edge') {
    const nextEdge = graph.edges.find((edge) => edge.id === selection.edge.id)
    if (nextEdge) return { type: 'edge', edge: nextEdge } satisfies GraphSelection
  }

  const defaultNode = graph.seedEntities[0] ?? graph.nodes[0] ?? null
  return defaultNode ? ({ type: 'node', node: defaultNode } satisfies GraphSelection) : null
}

function getConnectedGraphEdgeIds(nodeId: string, edges: GraphEdge[]) {
  return edges.filter((edge) => edge.source === nodeId || edge.target === nodeId).map((edge) => edge.id)
}

function toRewriteCandidateFromRecoverableResult(result: RecoverableRewriteResult): RewriteApiCandidate {
  return {
    title: result.title,
    summary: result.summary,
    content: result.content,
    inputTokens: result.inputTokens ?? null,
    outputTokens: result.outputTokens ?? null,
  }
}

async function callCreateRecoverableRewriteJobApi(payload: Record<string, unknown>) {
  const response = await fetch('/api/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, recoverableRewriteJob: true }),
  })

  const data = await response.json() as { ok?: boolean; job?: RecoverableRewriteJob | null; error?: string }
  if (!response.ok || !data.ok) {
    throw new Error(data.error || '创建可恢复改写任务失败')
  }

  if (!data.job) {
    throw new Error('可恢复改写任务未返回任务信息')
  }

  return data.job
}

async function callGetRecoverableRewriteJobApi(params: {
  jobId?: string
  novelId?: string
  branchId?: string
  chapterId?: string
}) {
  const searchParams = new URLSearchParams()
  if (params.jobId) {
    searchParams.set('jobId', params.jobId)
  } else {
    if (params.novelId) searchParams.set('novelId', params.novelId)
    if (params.branchId) searchParams.set('branchId', params.branchId)
    if (params.chapterId) searchParams.set('chapterId', params.chapterId)
  }

  const response = await fetch(`/api/rewrite?${searchParams.toString()}`, {
    cache: 'no-store',
  })

  const data = await response.json() as { ok?: boolean; job?: RecoverableRewriteJob | null; error?: string }
  if (!response.ok || !data.ok) {
    throw new Error(data.error || '读取可恢复改写任务失败')
  }

  return data.job ?? null
}

async function callCreateWhatIfSessionApi(payload: Record<string, unknown>): Promise<WhatIfCreateResponse> {
  const response = await fetch('/api/what-if/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = await response.json() as WhatIfCreateResponse & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || '创建 What-if 失败')
  }

  return data
}

async function callCreateRoleplaySessionApi(payload: Record<string, unknown>): Promise<{
  sessionId: string
  timelineNodeId: string
}> {
  const response = await fetch('/api/roleplay/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = await response.json() as { sessionId?: string; timelineNodeId?: string; error?: string }
  if (!response.ok || !data.sessionId || !data.timelineNodeId) {
    throw new Error(data.error || '创建角色扮演会话失败')
  }

  return {
    sessionId: data.sessionId,
    timelineNodeId: data.timelineNodeId,
  }
}

async function callCreateContinueBlockApi(payload: Record<string, unknown>): Promise<{
  continueBlockId: string
  timelineNodeId: string
  nodeType: 'rewrite' | 'continue_block'
  generatedText: string
  inputTokens?: number | null
  outputTokens?: number | null
  title: string
  subtitle: string | null
  latestRevisionNo: number
}> {
  const response = await fetch('/api/continue-blocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = await response.json() as {
    continueBlockId: string
    timelineNodeId: string
    nodeType: 'rewrite' | 'continue_block'
    generatedText: string
    title: string
    subtitle: string | null
    latestRevisionNo: number
    error?: string
  }
  if (!response.ok) {
    throw new Error(data.error || '保存续写块失败')
  }

  return data
}

async function callRegenerateContinueBlockApi(payload: Record<string, unknown>): Promise<{
  continueBlockId: string
  timelineNodeId: string
  nodeType: 'rewrite' | 'continue_block'
  generatedText: string
  inputTokens?: number | null
  outputTokens?: number | null
  title: string
  subtitle: string | null
  latestRevisionNo: number
}> {
  const response = await fetch('/api/continue-blocks', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = await response.json() as {
    continueBlockId: string
    timelineNodeId: string
    nodeType: 'rewrite' | 'continue_block'
    generatedText: string
    title: string
    subtitle: string | null
    latestRevisionNo: number
    error?: string
  }
  if (!response.ok) {
    throw new Error(data.error || '重生续写块失败')
  }

  return data
}

async function callDeleteStoryTimelineNodeApi(nodeId: string, novelId: string, branchId: string) {
  const searchParams = new URLSearchParams({ novelId, branchId })
  const response = await fetch(`/api/story-timeline?${searchParams.toString()}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId }),
  })

  const data = await response.json() as { ok?: boolean; error?: string }
  if (!response.ok || !data.ok) {
    throw new Error(data.error || '删除时间线节点失败')
  }
}

function toContinueBranchSelection(selection: Extract<TimelineSelection, { kind: 'rewrite' | 'continue_block' }>) {
  return {
    kind: selection.kind,
    nodeId: selection.nodeId,
    continueBlockId: selection.continueBlockId,
    anchorChapterNo: selection.anchorChapterNo,
  } satisfies Extract<TimelineSelection, { kind: 'rewrite' | 'continue_block' }>
}

export function resolveContinueBlockSelectionAfterSave(params: {
  matchingNode: StoryTimelineBranchNode | null | undefined
  result: Pick<ContinueBlockMutationResponse, 'timelineNodeId' | 'continueBlockId' | 'nodeType'>
  fallbackAnchorChapterNo: number
  parentTimelineNodeId: string | null
}) {
  const { matchingNode, result, fallbackAnchorChapterNo } = params

  if (matchingNode) {
    const selection = toBranchTimelineSelection(matchingNode)
    if (selection?.kind === 'rewrite' || selection?.kind === 'continue_block') {
      return selection
    }
  }

  return {
    kind: result.nodeType,
    nodeId: result.timelineNodeId,
    continueBlockId: result.continueBlockId,
    anchorChapterNo: fallbackAnchorChapterNo,
  } satisfies Extract<TimelineSelection, { kind: 'rewrite' | 'continue_block' }>
}

function toPresetCompatSessionSurfaceId(mode: WorkspaceActionMode): PresetCompatSurfaceId {
  return mode === 'roleplay' ? 'roleplay' : 'rewrite'
}

function toGenerationContextOperationType(mode: WorkspaceActionMode): WorkspaceActionMode {
  return mode === 'roleplay' ? 'roleplay' : 'rewrite'
}

export function SelectionNovelStudio() {
  const router = useRouter()
  const loadFromBackend = useNovelStore((state) => state.loadFromBackend)
  const saveToBackend = useNovelStore((state) => state.saveToBackend)
  const backendLoaded = useNovelStore((state) => state.backendLoaded)
  const currentNovelId = useNovelStore((state) => state.currentNovelId)
  const localNovels = useNovelStore((state) => state.localNovels)
  const localVolumes = useNovelStore((state) => state.localVolumes)
  const localChapters = useNovelStore((state) => state.localChapters)
  const currentChapterId = useNovelStore((state) => state.currentChapterId)
  const setCurrentChapterId = useNovelStore((state) => state.setCurrentChapterId)
  const updateChapterContent = useNovelStore((state) => state.updateChapterContent)
  const createNewChapter = useNovelStore((state) => state.createNewChapter)
  const deleteChapter = useNovelStore((state) => state.deleteChapter)
  const deleteNovel = useNovelStore((state) => state.deleteNovel)
  const aiSettings = useNovelStore((state) => state.aiSettings)
  const setAISettings = useNovelStore((state) => state.setAISettings)
  const saveAISettings = useNovelStore((state) => state.saveAISettings)
  const loadPresetCompatLibrary = useNovelStore((state) => state.loadPresetCompatLibrary)
  const savePresetCompatLibrary = useNovelStore((state) => state.savePresetCompatLibrary)
  const rebuildStoryKnowledge = useNovelStore((state) => state.rebuildStoryKnowledge)
  const pauseStoryKnowledgeRebuild = useNovelStore((state) => state.pauseStoryKnowledgeRebuild)
  const abortStoryKnowledgeRebuild = useNovelStore((state) => state.abortStoryKnowledgeRebuild)
  const deleteStoryKnowledgeGraph = useNovelStore((state) => state.deleteStoryKnowledgeGraph)
  const deleteStoryHanlpCache = useNovelStore((state) => state.deleteStoryHanlpCache)
  const deleteStoryExtractionCache = useNovelStore((state) => state.deleteStoryExtractionCache)
  const deleteStoryEmbeddingCache = useNovelStore((state) => state.deleteStoryEmbeddingCache)
  const refreshKnowledgeProjection = useNovelStore((state) => state.refreshKnowledgeProjection)
  const setPresetCompatSessionPhase = useNovelStore((state) => state.setPresetCompatSessionPhase)
  const clearPresetCompatSessionStateForSelection = useNovelStore((state) => state.clearPresetCompatSessionStateForSelection)
  const resetPresetCompatSessionStateForSelection = useNovelStore((state) => state.resetPresetCompatSessionStateForSelection)
  const presetCompatSessionState = useNovelStore((state) => state.presetCompatSessionState)
  const localCharacters = useNovelStore((state) => state.localCharacters)
  const localWorldEntries = useNovelStore((state) => state.localWorldEntries)
  const localTimelineEvents = useNovelStore((state) => state.localTimelineEvents)
  const localOutlines = useNovelStore((state) => state.localOutlines)
  const autosaveSignature = useNovelStore((state) =>
    JSON.stringify({
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
    })
  )

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
  const [rewritePrompt, setRewritePrompt] = useState(DEFAULT_REWRITE_PROMPT)
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
  const handleWhatIfMetricsChange = useCallback((metrics: {
    currentText: string
    inputTokens: number | null
    outputTokens: number | null
  }) => {
    const nodeId = whatIfMetricsNodeIdRef.current
    if (!nodeId) return
    updateBranchMetricsOverride(nodeId, metrics)
  }, [updateBranchMetricsOverride])
  const handleContinueBlockMetricsChange = useCallback((metrics: {
    currentText: string
    inputTokens: number | null
    outputTokens: number | null
  }) => {
    const nodeId = continueBlockMetricsNodeIdRef.current
    if (!nodeId) return
    updateBranchMetricsOverride(nodeId, metrics)
  }, [updateBranchMetricsOverride])
  const handleFutureJumpMetricsChange = useCallback((metrics: {
    currentText: string
    inputTokens: number | null
    outputTokens: number | null
  }) => {
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
  const [knowledgeActionLoading, setKnowledgeActionLoading] = useState<KnowledgeActionLoading>(null)
  const [confirmDeleteHanlpCache, setConfirmDeleteHanlpCache] = useState(false)
  const [confirmDeleteExtractionCache, setConfirmDeleteExtractionCache] = useState(false)
  const [confirmDeleteEmbeddingCache, setConfirmDeleteEmbeddingCache] = useState(false)
  const [knowledgeRebuildRangeMode, setKnowledgeRebuildRangeMode] = useState<KnowledgeRebuildRangeMode>('all')
  const [knowledgeRebuildFirstChapterCount, setKnowledgeRebuildFirstChapterCount] = useState('5')
  const [knowledgeRebuildStartChapter, setKnowledgeRebuildStartChapter] = useState('1')
  const [knowledgeRebuildEndChapter, setKnowledgeRebuildEndChapter] = useState('5')
  const [ollamaModelsByScenario, setOllamaModelsByScenario] = useState<Record<AIScenarioKey, OllamaModelOption[]>>({
    rewrite: [],
    knowledgeExtraction: [],
    embeddings: [],
  })
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState<Record<AIScenarioKey, boolean>>({
    rewrite: false,
    knowledgeExtraction: false,
    embeddings: false,
  })
  const [ollamaModelsError, setOllamaModelsError] = useState<Record<AIScenarioKey, string>>({
    rewrite: '',
    knowledgeExtraction: '',
    embeddings: '',
  })
  const [openAICompatibleModelsByScenario, setOpenAICompatibleModelsByScenario] = useState<Record<AIScenarioKey, OpenAICompatibleModelOption[]>>({
    rewrite: [],
    knowledgeExtraction: [],
    embeddings: [],
  })
  const [openAICompatibleModelsLoading, setOpenAICompatibleModelsLoading] = useState<Record<AIScenarioKey, boolean>>({
    rewrite: false,
    knowledgeExtraction: false,
    embeddings: false,
  })
  const [editState, setEditState] = useState<{
    type: 'char' | 'outline' | 'world' | 'relation' | 'timeline' | null
    id: string | null
    form: Record<string, string>
  }>({ type: null, id: null, form: {} })
  const knowledgePanelReadOnly = true

  const editorRef = useRef<HTMLDivElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hydratedRef = useRef(false)
  const workspaceSelectionHydratedRef = useRef(false)
  const lastActiveKnowledgeJobIdRef = useRef<string | null>(null)
  const openAICompatibleModelsRequestRef = useRef<Record<AIScenarioKey, number>>({
    rewrite: 0,
    knowledgeExtraction: 0,
    embeddings: 0,
  })
  const chapterGraphRequestRef = useRef(0)
  const storyTimelineRequestRef = useRef(0)
  const resolvedAISettings = useMemo(() => normalizeAISettings(aiSettings), [aiSettings])

  const updateAISettings = useCallback((updater: (current: AISettings) => AISettings) => {
    setAISettings(normalizeAISettings(updater(resolvedAISettings)))
  }, [resolvedAISettings, setAISettings])

  const updateScenarioProvider = useCallback((scenario: AIScenarioKey, provider: AIProvider) => {
    updateAISettings((current) => ({
      ...current,
      [scenario]: {
        ...current[scenario],
        provider,
      },
    }))
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
        ollama: {
          ...current[scenario].ollama,
          [field]: value,
        },
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

      return {
        ...current,
        embeddings: {
          ...current.embeddings,
          embeddingBatchSize: nextEmbeddingBatchSize,
        },
      }
    })
  }, [updateAISettings])

  const showKnowledgeToast = (message: string, duration = 1800) => {
    setToast(message)
    window.setTimeout(() => setToast(''), duration)
  }

  useEffect(() => {
    if (!shouldLoadWorkspaceFromBackendOnMount(backendLoaded)) return
    loadFromBackend().catch(() => undefined)
  }, [backendLoaded, loadFromBackend])

  useEffect(() => {
    if (backendLoaded && localChapters.length === 0) {
      router.push('/library')
    }
  }, [backendLoaded, localChapters.length, router])

  useEffect(() => {
    if (!backendLoaded) return
    if (!hydratedRef.current) {
      hydratedRef.current = true
      return
    }
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      saveToBackend().catch(() => undefined)
    }, 700)
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    }
  }, [autosaveSignature, backendLoaded, saveToBackend])

  useEffect(() => {
    if (!currentNovelId) {
      setConfirmDeleteKnowledge(false)
      setConfirmDeleteHanlpCache(false)
      setConfirmDeleteExtractionCache(false)
      setConfirmDeleteEmbeddingCache(false)
      const resetTimer = window.setTimeout(() => {
        setKnowledgeRebuildStatus(null)
        setHanlpCacheSnapshot(null)
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

    const syncRebuildStatus = async () => {
      try {
        const searchParams = new URLSearchParams({ novelId: currentNovelId })
        const selectedChapterOrder = localChapters.find((chapter) => chapter.id === currentChapterId)?.order
        if (typeof selectedChapterOrder === 'number' && Number.isFinite(selectedChapterOrder) && selectedChapterOrder >= 1) {
          searchParams.set('asOfChapter', String(selectedChapterOrder))
        }

        const response = await fetch(`/api/knowledge-view?${searchParams.toString()}`, { cache: 'no-store' })
        const data = (await response.json()) as {
          ok?: boolean
          knowledgeRebuildStatus?: KnowledgeRebuildStatus | null
          hanlpCacheSnapshot?: HanlpCacheSnapshot | null
        }

        if (cancelled || !response.ok || !data.ok) return

        const nextStatus = data.knowledgeRebuildStatus ?? null
        setHanlpCacheSnapshot(data.hanlpCacheSnapshot ?? null)
        const hadActiveJob = Boolean(lastActiveKnowledgeJobIdRef.current)
        const failureMessage = resolveKnowledgeRebuildFailureMessage(nextStatus)

        setKnowledgeRebuildStatus(nextStatus)

        if (
          nextStatus?.jobId
          && (nextStatus.status === 'queued' || nextStatus.status === 'running' || nextStatus.status === 'paused')
        ) {
          lastActiveKnowledgeJobIdRef.current = nextStatus.jobId
          return
        }

        if (nextStatus?.status === 'failed') {
          lastActiveKnowledgeJobIdRef.current = null
          if (hadActiveJob && !cancelled) {
            showKnowledgeToast(failureMessage ?? '知识视图重建失败，请重新发起重建。', 2600)
          }
          return
        }

        if (hadActiveJob) {
          lastActiveKnowledgeJobIdRef.current = null
          await refreshKnowledgeProjection(currentNovelId, selectedChapterOrder)
          if (!cancelled && !knowledgeRebuilding && !knowledgeActionLoading) {
            showKnowledgeToast('知识视图已更新')
          }
        }
      } catch {
      }
    }

    void syncRebuildStatus()
    const timer = window.setInterval(() => {
      void syncRebuildStatus()
    }, 1500)

    return () => {
      cancelled = true
      window.clearTimeout(confirmResetTimer)
      window.clearInterval(timer)
    }
  }, [currentChapterId, currentNovelId, knowledgeActionLoading, knowledgeRebuilding, localChapters, refreshKnowledgeProjection, setConfirmDeleteKnowledge])

  useEffect(() => {
    if (!settingsOpen || resolvedAISettings.rewrite.provider !== 'ollama') return
    void loadOllamaModels('rewrite', resolvedAISettings.rewrite.ollama.baseUrl)
  }, [resolvedAISettings.rewrite.ollama.baseUrl, resolvedAISettings.rewrite.provider, settingsOpen])

  useEffect(() => {
    if (!settingsOpen || resolvedAISettings.knowledgeExtraction.provider !== 'ollama') return
    void loadOllamaModels('knowledgeExtraction', resolvedAISettings.knowledgeExtraction.ollama.baseUrl)
  }, [resolvedAISettings.knowledgeExtraction.ollama.baseUrl, resolvedAISettings.knowledgeExtraction.provider, settingsOpen])

  useEffect(() => {
    if (!settingsOpen || resolvedAISettings.embeddings.provider !== 'ollama') return
    void loadOllamaModels('embeddings', resolvedAISettings.embeddings.ollama.baseUrl)
  }, [resolvedAISettings.embeddings.ollama.baseUrl, resolvedAISettings.embeddings.provider, settingsOpen])

  useEffect(() => {
    if (!settingsOpen || resolvedAISettings.rewrite.provider !== 'openai-compatible') return

    const timer = window.setTimeout(() => {
      void loadOpenAICompatibleModels('rewrite', resolvedAISettings.rewrite.openAICompatible.baseUrl, resolvedAISettings.rewrite.openAICompatible.apiKey)
    }, 250)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    resolvedAISettings.rewrite.openAICompatible.apiKey,
    resolvedAISettings.rewrite.openAICompatible.baseUrl,
    resolvedAISettings.rewrite.provider,
    settingsOpen,
  ])

  useEffect(() => {
    if (!settingsOpen || resolvedAISettings.knowledgeExtraction.provider !== 'openai-compatible') return

    const timer = window.setTimeout(() => {
      void loadOpenAICompatibleModels(
        'knowledgeExtraction',
        resolvedAISettings.knowledgeExtraction.openAICompatible.baseUrl,
        resolvedAISettings.knowledgeExtraction.openAICompatible.apiKey
      )
    }, 250)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    resolvedAISettings.knowledgeExtraction.openAICompatible.apiKey,
    resolvedAISettings.knowledgeExtraction.openAICompatible.baseUrl,
    resolvedAISettings.knowledgeExtraction.provider,
    settingsOpen,
  ])

  useEffect(() => {
    if (!settingsOpen || resolvedAISettings.embeddings.provider !== 'openai-compatible') return

    const timer = window.setTimeout(() => {
      void loadOpenAICompatibleModels(
        'embeddings',
        resolvedAISettings.embeddings.openAICompatible.baseUrl,
        resolvedAISettings.embeddings.openAICompatible.apiKey
      )
    }, 250)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    resolvedAISettings.embeddings.openAICompatible.apiKey,
    resolvedAISettings.embeddings.openAICompatible.baseUrl,
    resolvedAISettings.embeddings.provider,
    settingsOpen,
  ])

  const novelVolumes = useMemo(
    () => localVolumes.filter((volume) => volume.novelId === currentNovelId).slice().sort((a, b) => a.order - b.order),
    [localVolumes, currentNovelId]
  )
  const currentNovelMeta = useMemo(
    () => localNovels.find((novel) => novel.id === currentNovelId) ?? null,
    [localNovels, currentNovelId]
  )

  const {
    sortedChapters,
    currentChapter,
    parentChapter,
    graphSourceMeta,
    selectChapter,
    resolveSourceChapter,
    jumpToGraphSource,
  } = useWorkspaceChapterSelection({
    localChapters,
    currentNovelId,
    currentChapterId,
    setCurrentChapterId,
    setCenterPaneView,
    setPendingSourceJump,
    setLeftPanelOpen,
    htmlToPlainText,
    resetControls: {
      defaultGraphReviewControls: DEFAULT_GRAPH_REVIEW_CONTROLS,
      resetPresetCompatSessionStateForChapter: (chapter) => {
        resetPresetCompatSessionStateForSelection(
          toChapterTimelineSelection(chapter),
          ['rewrite', 'future_jump', 'roleplay']
        )
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
  const hasWorkspaceContent = localChapters.length > 0
  const mainlineChapters = useMemo(
    () => sortedChapters.filter((chapter) => !chapter.parentChapterId),
    [sortedChapters]
  )
  const selectedKnowledgeRebuildChapterRange = useMemo(
    () => normalizeKnowledgeRebuildChapterRangeInput({
      mode: knowledgeRebuildRangeMode,
      firstChapterCount: knowledgeRebuildFirstChapterCount,
      startChapter: knowledgeRebuildStartChapter,
      endChapter: knowledgeRebuildEndChapter,
      maxChapterCount: mainlineChapters.length,
    }),
    [knowledgeRebuildEndChapter, knowledgeRebuildFirstChapterCount, knowledgeRebuildRangeMode, knowledgeRebuildStartChapter, mainlineChapters.length]
  )
  const selectedKnowledgeRebuildChapterRangeLabel = useMemo(
    () => formatKnowledgeRebuildChapterRangeLabel(selectedKnowledgeRebuildChapterRange),
    [selectedKnowledgeRebuildChapterRange]
  )
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
  const storyTimelineBranchId = currentNovelId ? `${currentNovelId}:main` : ''
  const fallbackStoryTimeline = useMemo<StoryTimelineResponse>(() => ({
    novelId: currentNovelId,
    branchId: storyTimelineBranchId,
    chapters: mainlineChapters.map<ChapterTimelineItem>((chapter) => ({
      type: 'chapter',
      chapterNo: chapter.order,
      chapterId: chapter.id,
      title: chapter.title,
      wordCount: chapter.wordCount,
    })),
    branchNodes: [],
    edges: [],
  }), [currentNovelId, mainlineChapters, storyTimelineBranchId])
  const resolvedStoryTimeline = storyTimelineData?.novelId === currentNovelId ? storyTimelineData : fallbackStoryTimeline
  const timelineChapterById = useMemo(
    () => new Map(resolvedStoryTimeline.chapters.map((chapter) => [chapter.chapterId, chapter] as const)),
    [resolvedStoryTimeline.chapters]
  )
  const timelineNodeById = useMemo(
    () => new Map(resolvedStoryTimeline.branchNodes.map((node) => [node.id, node] as const)),
    [resolvedStoryTimeline.branchNodes]
  )

  const handleTimelineSelection = useCallback((selection: TimelineSelection) => {
    if (currentChapter) {
      clearPresetCompatSessionStateForSelection(workspaceSelection ?? toChapterTimelineSelection(currentChapter))
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
  }, [clearPresetCompatSessionStateForSelection, currentChapter, selectChapter, setActiveMode, setLeftPanelOpen, setToolbarPos, sortedChapters, workspaceSelection])

  useEffect(() => {
    if (!backendLoaded || !currentNovelId || !currentChapter) return
    const timer = window.setTimeout(() => {
      void refreshKnowledgeProjection(currentNovelId, currentChapter.order).catch(() => undefined)
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [backendLoaded, currentChapter, currentNovelId, refreshKnowledgeProjection])

  useEffect(() => {
    workspaceSelectionHydratedRef.current = false
  }, [currentNovelId])

  useEffect(() => {
    if (!backendLoaded || !currentChapter || workspaceSelectionHydratedRef.current) return

    const requestedSelection = readWorkspaceSelectionFromSearchParams(new URLSearchParams(window.location.search))
    if (requestedSelection && requestedSelection.kind !== 'chapter' && !storyTimelineData) return

    setWorkspaceSelection(resolveWorkspaceSelection({
      currentSelection: requestedSelection,
      currentChapter,
      branchNodes: resolvedStoryTimeline.branchNodes,
    }))
    workspaceSelectionHydratedRef.current = true
  }, [backendLoaded, currentChapter, resolvedStoryTimeline.branchNodes, storyTimelineData])

  useEffect(() => {
    if (!backendLoaded || !currentChapter || !workspaceSelectionHydratedRef.current) return

    const currentUrl = new URL(window.location.href)
    const currentSearch = currentUrl.searchParams.toString()
    const nextSearchParams = writeWorkspaceSelectionToSearchParams(
      currentUrl.searchParams,
      workspaceSelection ?? toChapterTimelineSelection(currentChapter)
    )
    const nextSearch = nextSearchParams.toString()
    if (nextSearch === currentSearch) return

    const nextUrl = `${currentUrl.pathname}${nextSearch ? `?${nextSearch}` : ''}${currentUrl.hash}`
    window.history.replaceState(window.history.state, '', nextUrl)
  }, [backendLoaded, currentChapter, workspaceSelection])

  useEffect(() => {
    setWorkspaceSelection((current) => resolveWorkspaceSelection({
      currentSelection: current,
      currentChapter,
      branchNodes: resolvedStoryTimeline.branchNodes,
    }))
  }, [currentChapter, resolvedStoryTimeline.branchNodes])

  const loadStoryTimeline = useCallback(async () => {
    if (!currentNovelId) {
      setStoryTimelineData(null)
      setStoryTimelineError('')
      return null
    }

    const requestId = storyTimelineRequestRef.current + 1
    storyTimelineRequestRef.current = requestId

    try {
      const searchParams = new URLSearchParams({
        novelId: currentNovelId,
        branchId: storyTimelineBranchId,
      })
      const response = await fetch(`/api/story-timeline?${searchParams.toString()}`, { cache: 'no-store' })
      const data = await response.json().catch(() => null) as (StoryTimelineResponse & { error?: string }) | null

      if (storyTimelineRequestRef.current !== requestId) return null
      if (!response.ok || !data) {
        setStoryTimelineData(null)
        setStoryTimelineError(data?.error ?? '故事时间线加载失败')
        return null
      }

      setStoryTimelineData(data)
      setStoryTimelineError('')
      return data
    } catch {
      if (storyTimelineRequestRef.current !== requestId) return null
      setStoryTimelineData(null)
      setStoryTimelineError('故事时间线加载失败')
      return null
    }
  }, [currentNovelId, storyTimelineBranchId])

  useEffect(() => {
    void loadStoryTimeline()
  }, [loadStoryTimeline])

  const chapterListLimit = chapterListState[currentNovelId] ?? CHAPTER_PAGE_SIZE

  const chapterIndex = useMemo(
    () => (currentChapter ? sortedChapters.findIndex((chapter) => chapter.id === currentChapter.id) : -1),
    [currentChapter, sortedChapters]
  )

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

    return {
      chapterId: targetChapter.id,
      chapterNo: targetChapter.order,
      lineStart: item.lineStart,
      lineEnd: item.lineEnd,
      searchText: normalizeSourceSearchText(item.text || buildChapterLineExcerpt(targetChapter, item.lineStart, item.lineEnd)),
    } satisfies PendingSourceJump
  }
  const knowledgeRebuildEtaMinutes = useMemo(() => {
    return knowledgeRebuildStatus?.etaMinutes ?? null
  }, [knowledgeRebuildStatus])
  const knowledgeRebuildSteps = useMemo(() => knowledgeRebuildStatus?.steps ?? [], [knowledgeRebuildStatus])
  const knowledgeRebuildFailed = knowledgeRebuildStatus?.status === 'failed'
  const knowledgeRebuildPaused = knowledgeRebuildStatus?.status === 'paused'
  const knowledgeRebuildActive = knowledgeRebuildStatus?.status === 'running' || knowledgeRebuildStatus?.status === 'queued'
  const knowledgeRebuildBusy = knowledgeRebuildActive || knowledgeRebuildPaused
  const knowledgeRebuildFailureMessage = useMemo(
    () => resolveKnowledgeRebuildFailureMessage(knowledgeRebuildStatus),
    [knowledgeRebuildStatus]
  )
  const knowledgeRebuildOverallPercent = useMemo(
    () => toProgressPercent(knowledgeRebuildStatus?.progress),
    [knowledgeRebuildStatus]
  )
  const hanlpBootstrapStep = useMemo(
    () => knowledgeRebuildSteps.find((step) => step.key === HANLP_BOOTSTRAP_STAGE_KEY) ?? null,
    [knowledgeRebuildSteps]
  )
  const rawEmbeddingStep = useMemo(
    () => knowledgeRebuildSteps.find((step) => step.key === 'raw-embedding') ?? null,
    [knowledgeRebuildSteps]
  )
  const hanlpBootstrapCompletedChapterCount = knowledgeRebuildStatus?.hanlpBootstrapCompletedChapterCount ?? null
  const hanlpBootstrapTotalChapterCount = knowledgeRebuildStatus?.hanlpBootstrapTotalChapterCount ?? null
  const hanlpBootstrapProgress = knowledgeRebuildStatus?.hanlpBootstrapProgress ?? hanlpBootstrapStep?.progress ?? null
  const hanlpBootstrapPercent = useMemo(
    () => hanlpBootstrapProgress === null ? null : toProgressPercent(hanlpBootstrapProgress),
    [hanlpBootstrapProgress]
  )
  const hanlpBootstrapHasProgressTelemetry = Boolean(
    hanlpBootstrapPercent !== null
    || hanlpBootstrapCompletedChapterCount !== null
    || hanlpBootstrapTotalChapterCount !== null
  )
  const hanlpBootstrapCacheHitRatePercent = useMemo(() => {
    if (knowledgeRebuildStatus?.hanlpCacheHitRate !== undefined) {
      return toProgressPercent(knowledgeRebuildStatus.hanlpCacheHitRate)
    }

    const hitCount = knowledgeRebuildStatus?.hanlpBootstrapCacheHitCount ?? 0
    const missCount = knowledgeRebuildStatus?.hanlpBootstrapCacheMissCount ?? 0
    const total = hitCount + missCount
    return total > 0 ? toProgressPercent(hitCount / total) : null
  }, [knowledgeRebuildStatus])
  const hanlpBootstrapTimingLabel = useMemo(() => {
    const duration = knowledgeRebuildStatus?.stageTimingsMs?.[HANLP_BOOTSTRAP_STAGE_KEY]
    return typeof duration === 'number' && Number.isFinite(duration) ? formatStageDuration(duration) : null
  }, [knowledgeRebuildStatus])
  const hanlpBootstrapPhaseLabel = useMemo(() => {
    const detail = hanlpBootstrapStep?.detail?.trim()
    if (detail) return detail

    const currentStep = knowledgeRebuildStatus?.currentStep?.trim()
    if (knowledgeRebuildFailed) return '已失败'
    if (currentStep) return currentStep

    if (knowledgeRebuildPaused) return '等待继续'
    return hanlpBootstrapHasProgressTelemetry ? '计算中' : '等待进度'
  }, [hanlpBootstrapHasProgressTelemetry, hanlpBootstrapStep, knowledgeRebuildFailed, knowledgeRebuildPaused, knowledgeRebuildStatus])
  const hanlpBootstrapEtaLabel = useMemo(() => formatKnowledgeEtaLabel({
    etaMinutes: hanlpBootstrapStep?.etaMinutes ?? knowledgeRebuildEtaMinutes,
    isPaused: knowledgeRebuildPaused,
    isFailed: knowledgeRebuildFailed,
    hasTelemetry: hanlpBootstrapHasProgressTelemetry,
  }), [hanlpBootstrapHasProgressTelemetry, hanlpBootstrapStep, knowledgeRebuildEtaMinutes, knowledgeRebuildFailed, knowledgeRebuildPaused])
  const hanlpBootstrapStatusLine = useMemo(() => {
    const completed = hanlpBootstrapCompletedChapterCount
    const total = hanlpBootstrapTotalChapterCount

    if (typeof completed === 'number' && typeof total === 'number' && total > 0) {
      return completed >= total
        ? `已完成 ${completed} / ${total} 章，HanLP Bootstrap 已就绪。`
        : `已完成 ${completed} / ${total} 章，继续更新 HanLP 引导结果。`
    }

    if (knowledgeRebuildFailed) return 'HanLP Bootstrap 已随本次知识重建失败而停止。'
    if (knowledgeRebuildPaused) return 'HanLP Bootstrap 已暂停，等待继续。'
    if (knowledgeRebuildBusy) return hanlpBootstrapHasProgressTelemetry ? 'HanLP Bootstrap 正在持续回传章节遥测。' : 'HanLP Bootstrap 已启动，正在等待章节进度。'
    if (hanlpCacheSnapshot?.status === 'ready') return 'HanLP Bootstrap 缓存已就绪，可直接复用已有扫描结果。'
    return '当前还没有可展示的 HanLP Bootstrap 进度。'
  }, [hanlpBootstrapCompletedChapterCount, hanlpBootstrapHasProgressTelemetry, hanlpBootstrapTotalChapterCount, hanlpCacheSnapshot, knowledgeRebuildBusy, knowledgeRebuildFailed, knowledgeRebuildPaused])
  const hanlpCacheStatus = knowledgeRebuildStatus?.hanlpCacheStatus ?? hanlpCacheSnapshot?.status ?? 'empty'
  const hanlpCacheStatusLabel = HANLP_CACHE_STATUS_LABELS[hanlpCacheStatus]
  const hanlpSettingsLine = useMemo(() => {
    const snapshot = knowledgeRebuildStatus?.hanlpSettingsSnapshot ?? hanlpCacheSnapshot?.settingsSnapshot
    if (!snapshot) return null
    return `script ${snapshot.hanlpScriptVersionHash.slice(0, 8)} · config ${snapshot.hanlpModelOrConfigHash.slice(0, 8)} · schema ${snapshot.outputSchemaVersion} · pipeline ${snapshot.pipelineVersion}`
  }, [hanlpCacheSnapshot, knowledgeRebuildStatus])
  const hanlpCacheDeleteState = useMemo(() => resolveHanlpCacheDeleteState({
    knowledgeRebuildStatus,
    knowledgeActionLoading,
  }), [knowledgeActionLoading, knowledgeRebuildStatus])
  const extractionCacheDeleteState = useMemo(() => resolveCacheDeleteState({
    knowledgeRebuildStatus,
    knowledgeActionLoading,
    idleHelperText: '只会删除当前小说主分支的 LLM 抽取缓存，不会影响 HanLP 缓存或原文 Embedding 缓存。',
  }), [knowledgeActionLoading, knowledgeRebuildStatus])
  const embeddingCacheDeleteState = useMemo(() => resolveCacheDeleteState({
    knowledgeRebuildStatus,
    knowledgeActionLoading,
    idleHelperText: '只会删除当前小说主分支的原文 Embedding 缓存，不会影响 HanLP 缓存或 LLM 抽取缓存。',
  }), [knowledgeActionLoading, knowledgeRebuildStatus])
  const rawTextEmbeddingProgress = knowledgeRebuildStatus?.rawTextEmbeddingProgress
  const rawTextEmbeddingPercent = useMemo(
    () => rawTextEmbeddingProgress === undefined ? null : toProgressPercent(rawTextEmbeddingProgress),
    [rawTextEmbeddingProgress]
  )
  const rawEmbeddingCurrentStep = useMemo(() => {
    const currentStep = knowledgeRebuildStatus?.currentStep?.trim().toLowerCase() ?? ''
    return currentStep.includes('raw') && currentStep.includes('embedding')
  }, [knowledgeRebuildStatus])
  const rawEmbeddingWaitingFinalization = Boolean(rawEmbeddingStep && rawEmbeddingStep.status === 'running')
  const rawEmbeddingRunningInParallel = knowledgeRebuildActive
    && !rawEmbeddingWaitingFinalization
    && ((rawTextEmbeddingPercent !== null && rawTextEmbeddingPercent < 100) || rawEmbeddingCurrentStep)
  const rawEmbeddingCompleted = rawTextEmbeddingPercent !== null && rawTextEmbeddingPercent >= 100
  const rawTextEmbeddingCacheHitRatePercent = useMemo(
    () => knowledgeRebuildStatus?.rawTextEmbeddingCacheHitRate === undefined
      ? null
      : toProgressPercent(knowledgeRebuildStatus.rawTextEmbeddingCacheHitRate),
    [knowledgeRebuildStatus]
  )
  const rawTextEmbeddingTimingLabel = useMemo(() => {
    const duration = knowledgeRebuildStatus?.stageTimingsMs?.[RAW_TEXT_PRECOMPUTE_STAGE_KEY]
    return typeof duration === 'number' && Number.isFinite(duration) ? formatStageDuration(duration) : null
  }, [knowledgeRebuildStatus])
  const rawTextEmbeddingSettingsLine = useMemo(() => {
    const snapshot = knowledgeRebuildStatus?.embeddingSettingsSnapshot
    if (!snapshot) return null
    return `${formatEmbeddingProviderLabel(snapshot.provider)} · ${snapshot.model} · batch ${snapshot.embeddingBatchSize}`
  }, [knowledgeRebuildStatus])
  const rawTextEmbeddingPhaseBadge = useMemo(() => {
    if (knowledgeRebuildFailed) return '已失败'
    if (knowledgeRebuildPaused) return '已暂停'
    if (rawEmbeddingWaitingFinalization) return '等待收尾'
    if (rawEmbeddingRunningInParallel) return '与抽取并行'
    if (rawEmbeddingCompleted) return '已完成'
    return '未开始'
  }, [knowledgeRebuildFailed, knowledgeRebuildPaused, rawEmbeddingCompleted, rawEmbeddingRunningInParallel, rawEmbeddingWaitingFinalization])
  const rawTextEmbeddingStatusLine = useMemo(() => {
    if (knowledgeRebuildFailed) {
      return rawTextEmbeddingPercent !== null ? '原文预计算在任务失败前已回传部分进度。' : '原文预计算随本次知识重建一并失败。'
    }

    if (knowledgeRebuildPaused) {
      return rawTextEmbeddingPercent !== null ? '原文预计算已暂停，等待继续。' : '原文预计算已暂停，尚未收到进度遥测。'
    }

    if (rawEmbeddingWaitingFinalization) {
      return rawEmbeddingCompleted
        ? '原文向量已预热完成，正在等待进入索引阶段。'
        : '章节知识已经写入完成，当前正在等待原文向量预热收尾后再进入索引。'
    }

    if (rawEmbeddingRunningInParallel) {
      if (rawTextEmbeddingPercent !== null) {
        return '与章节抽取并行进行，优先预热原文向量缓存。'
      }
      return '会与章节抽取并行启动；当前还在等待进度遥测。'
    }

    if (rawEmbeddingCompleted) {
      return '原文向量预计算已完成。'
    }

    return '原文向量预计算尚未开始。'
  }, [knowledgeRebuildFailed, knowledgeRebuildPaused, rawEmbeddingCompleted, rawEmbeddingRunningInParallel, rawEmbeddingWaitingFinalization, rawTextEmbeddingPercent])
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
    editorProps: {
      attributes: {
        class:
          'px-5 py-6 sm:px-8 sm:py-8 font-[family:var(--font-noto-serif-sc)] text-[1.05rem] leading-9 text-zinc-200 outline-none min-h-[62vh]',
      },
    },
    onUpdate({ editor }) {
      if (currentChapter) {
        updateChapterContent(currentChapter.id, editor.getHTML())
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
            ? `第 ${pendingSourceJump.lineStart}-${pendingSourceJump.lineEnd} 行`
            : `第 ${pendingSourceJump.lineStart} 行`
          : '对应原文位置'
        showKnowledgeToast(`已跳到第 ${pendingSourceJump.chapterNo} 章，请查看${lineLabel}`)
      }

      setPendingSourceJump(null)
    }, 120)

    return () => {
      window.clearTimeout(timer)
    }
  }, [centerPaneView, currentChapter, pendingSourceJump])

  const closePanel = useCallback(() => {
    if (activeMode && currentChapter) {
      resetPresetCompatSessionStateForSelection(
        workspaceSelection ?? toChapterTimelineSelection(currentChapter),
        [toPresetCompatSessionSurfaceId(activeMode)]
      )
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
  }, [activeMode, currentChapter, resetPresetCompatSessionStateForSelection, workspaceSelection])

  useEffect(() => {
    if (centerPaneView === 'body') return
    const timer = window.setTimeout(() => {
      setToolbarPos(null)
      setSelectionText('')
      setLockedSelectionText('')
      if (activeMode) {
        closePanel()
      }
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

  const currentNovelCharacters = localCharacters.filter((item) => item.novelId === currentNovelId)
  const currentNovelVisibleCharacters = useMemo(
    () => filterWorkspaceVisibleCharacters(currentNovelCharacters),
    [currentNovelCharacters]
  )
  const currentNovelVisibleCharacterCount = currentNovelVisibleCharacters.length
  const currentNovelWorldEntries = localWorldEntries.filter((item) => item.novelId === currentNovelId)
  const currentNovelOutlines = localOutlines.filter((item) => item.novelId === currentNovelId)
  const currentNovelTimelineEvents = localTimelineEvents
    .filter((item) => item.novelId === currentNovelId)
    .slice()
    .sort((a, b) => a.order - b.order)
  const currentNovelCharactersSorted = useMemo(
    () => sortCharactersForWorkspaceRail(currentNovelVisibleCharacters),
    [currentNovelVisibleCharacters]
  )
  const currentNovelWorldEntryGroups = useMemo(
    () => groupWorldEntriesForWorkspaceRail(currentNovelWorldEntries),
    [currentNovelWorldEntries]
  )
  const workspaceKnowledgeTabs: Array<{ tab: WorkspaceRefTab; label: string; icon: typeof Users }> = [
    { tab: 'characters', label: '人物', icon: Users },
    { tab: 'organizations', label: '组织', icon: Building2 },
    { tab: 'locations', label: '地点', icon: MapPin },
    { tab: 'worldbuilding', label: '世界设定', icon: Globe },
    { tab: 'outline', label: '大纲', icon: ScrollText },
    { tab: 'timeline', label: '时间线', icon: ScrollText },
  ]

  const renderWorldEntriesPanel = (
    tab: WorkspaceRefTab,
    entries: WorldEntry[],
    emptyMessage: string,
    addLabel: string,
    defaultType: WorldEntryType,
  ) => {
    if (refTab !== tab) return null

    return (
      <>
        {entries.length === 0 && (
          <p className="text-xs text-zinc-500 text-center py-4">{emptyMessage}</p>
        )}
        {entries.map((entry) => {
          const isEditing = editState.type === 'world' && editState.id === entry.id
          const ef = editState.form
          const setF = (key: string, val: string) => setEditState((s) => ({ ...s, form: { ...s.form, [key]: val } }))
          return (
            <div key={entry.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
              {isEditing ? (
                <>
                  <input value={ef.title ?? ''} onChange={(e) => setF('title', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="标题" />
                  <select value={ef.type ?? entry.type} onChange={(e) => setF('type', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none">
                    <option value="location">地点</option>
                    <option value="scene">场景</option>
                    <option value="organization">组织</option>
                    <option value="rule">规则</option>
                    <option value="item">物件</option>
                    <option value="history">历史</option>
                  </select>
                  <textarea value={ef.content ?? ''} onChange={(e) => setF('content', e.target.value)} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="描述" />
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => {
                      useNovelStore.getState().updateWorldEntry(entry.id, { title: ef.title ?? '', type: (ef.type ?? entry.type) as WorldEntryType, content: ef.content ?? '' })
                      setEditState({ type: null, id: null, form: {} })
                    }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">保存</button>
                    <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">取消</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-zinc-100">{entry.title}</p>
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-500">
                        {WORLD_TYPE_LABELS[entry.type]}
                      </span>
                    </div>
                    {!knowledgePanelReadOnly ? (
                      <div className="flex gap-1">
                        <button onClick={() => setEditState({ type: 'world', id: entry.id, form: { title: entry.title, type: entry.type, content: entry.content } })} className="rounded-lg border border-white/10 p-1.5 text-zinc-400 hover:text-zinc-200"><Pencil className="h-3 w-3" /></button>
                        <button onClick={() => { useNovelStore.getState().deleteWorldEntry(entry.id) }} className="rounded-lg border border-white/10 p-1.5 text-rose-400 hover:text-rose-300"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    ) : null}
                  </div>
                  <p className="text-xs leading-6 text-zinc-400 line-clamp-3">{entry.content}</p>
                </>
              )}
            </div>
          )
        })}
        {!knowledgePanelReadOnly ? (
          <button onClick={() => setEditState({ type: 'world', id: '__new__', form: { title: '', type: defaultType, content: '' } })} className="w-full rounded-2xl border border-dashed border-white/10 px-3 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]">
            <Plus className="h-3.5 w-3.5 inline mr-1" /> {addLabel}
          </button>
        ) : null}
        {!knowledgePanelReadOnly && editState.type === 'world' && editState.id === '__new__' && (
          <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
            <input value={editState.form.title ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, title: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="标题" />
            <select value={editState.form.type ?? defaultType} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, type: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none">
              <option value="location">地点</option>
              <option value="scene">场景</option>
              <option value="organization">组织</option>
              <option value="rule">规则</option>
              <option value="item">物件</option>
              <option value="history">历史</option>
            </select>
            <textarea value={editState.form.content ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, content: e.target.value } }))} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="描述" />
            <div className="flex gap-2 mt-2">
              <button onClick={() => {
                useNovelStore.getState().addWorldEntry(currentNovelId, { title: editState.form.title ?? '', type: (editState.form.type ?? defaultType) as WorldEntryType, content: editState.form.content ?? '' })
                setEditState({ type: null, id: null, form: {} })
              }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">创建</button>
              <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">取消</button>
            </div>
          </div>
        )}
      </>
    )
  }

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
      setToolbarPos({
        top: selection.rect.top - TOOLBAR_OFFSET_Y,
        left: selection.rect.left + selection.rect.width / 2,
      })
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
    const nextTop = Math.min(
      Math.max(toolbarPos.top, TOOLBAR_EDGE_PADDING),
      window.innerHeight - toolbarRect.height - TOOLBAR_EDGE_PADDING
    )
    const nextLeft = Math.min(
      Math.max(toolbarPos.left, toolbarRect.width / 2 + TOOLBAR_EDGE_PADDING),
      window.innerWidth - toolbarRect.width / 2 - TOOLBAR_EDGE_PADDING
    )

    if (nextTop !== toolbarPos.top || nextLeft !== toolbarPos.left) {
      setToolbarPos({ top: nextTop, left: nextLeft })
    }
  }, [activeMode, toolbarPos])

  const loadChapterGraph = useCallback(async (chapter: Chapter, controls = chapterGraphControls, preserveData = false) => {
    const requestId = chapterGraphRequestRef.current + 1
    chapterGraphRequestRef.current = requestId

    const sourceChapter = chapter.parentChapterId ? parentChapter ?? null : chapter

    if (!currentNovelId || !sourceChapter) {
      setChapterGraphData(null)
      setChapterGraphSelection(null)
      setChapterGraphError('')
      setChapterGraphLoading(false)
      return
    }

    const novelId = currentNovelId

    if (!preserveData) {
      setChapterGraphData(null)
      setChapterGraphSelection(null)
    }

    setChapterGraphLoading(true)
    setChapterGraphError('')

    try {
      const params = new URLSearchParams({
        novelId,
        chapterId: sourceChapter.id,
        hops: String(controls.maxHops),
        includeLowConfidence: String(!controls.hideLowConfidence),
        confirmedOnly: String(controls.confirmedOnly),
      })
      const data = await callChapterGraphContextApi(`/api/rag/graph-context?${params.toString()}`)

      if (chapterGraphRequestRef.current !== requestId) {
        return
      }

      if (
        !data.ok ||
        !data.graphContext ||
        !data.chapterId ||
        !data.branchId ||
        !data.chapterTitle ||
        !data.chapterNo ||
        !data.novelId
      ) {
        throw new Error(data.error || '章节图谱加载失败')
      }

      const nextData = {
        ...(data as ChapterGraphContextData),
        sourceMeta: chapter.parentChapterId
          ? {
              mode: 'inherited-parent',
              chapterId: sourceChapter.id,
              chapterNo: sourceChapter.order,
              chapterTitle: sourceChapter.title,
            }
          : {
              mode: 'direct',
              chapterId: sourceChapter.id,
              chapterNo: sourceChapter.order,
              chapterTitle: sourceChapter.title,
            },
      } satisfies ChapterGraphContextData
      setChapterGraphData(nextData)
      const defaultNode = nextData.graphContext.seedEntities[0] ?? nextData.graphContext.nodes[0] ?? null
      setChapterGraphSelection(defaultNode ? { type: 'node', node: defaultNode } : null)
    } catch (error) {
      if (chapterGraphRequestRef.current !== requestId) {
        return
      }

      setChapterGraphError(error instanceof Error ? error.message : '章节图谱加载失败')
      if (!preserveData) {
        setChapterGraphData(null)
        setChapterGraphSelection(null)
      }
    } finally {
      if (chapterGraphRequestRef.current === requestId) {
        setChapterGraphLoading(false)
      }
    }
  }, [chapterGraphControls, currentNovelId, parentChapter])

  useEffect(() => {
    if (centerPaneView !== 'graph' || !currentChapter) return
    if (currentChapter.parentChapterId && !parentChapter) {
      chapterGraphRequestRef.current += 1
      const timer = window.setTimeout(() => {
        setChapterGraphData(null)
        setChapterGraphSelection(null)
        setChapterGraphError('当前分支没有可继承的父章节图谱。')
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
    const requiresReload = nextControls.maxHops !== chapterGraphControls.maxHops
      || nextControls.hideLowConfidence !== chapterGraphControls.hideLowConfidence
      || nextControls.confirmedOnly !== chapterGraphControls.confirmedOnly
    setChapterGraphControls(nextControls)

    if (!requiresReload || centerPaneView !== 'graph' || !currentChapter) {
      return
    }

    await loadChapterGraph(currentChapter, nextControls, true)
  }

  const selectedRewriteCandidate = rewriteFlow.candidates[rewriteFlow.selectedIndex] ?? rewriteFlow.candidates[0]
  const activeGraphContext = graphContext ?? generationContext?.graphContext ?? null
  const activePromptBlockCount = generationContext
    ? getVisibleAdvancedContextPromptBlocks(generationContext.promptBlocks).length
    : 0
  const activeSeedEntityCount = activeGraphContext?.seedEntities.length ?? 0
  const activeGraphEdgeCount = activeGraphContext?.edges.length ?? 0
  const activeEvidenceCount = generationContext?.lanceEvidence.length ?? 0
  const scenarioStatusLabels = (Object.keys(AI_SCENARIO_META) as AIScenarioKey[]).map((scenario) => {
    const meta = AI_SCENARIO_META[scenario]
    const settings = resolvedAISettings[scenario]

    if (settings.provider === 'openai-compatible') {
      return settings.openAICompatible.configured && settings.openAICompatible.model
        ? `${meta.shortLabel} ${settings.openAICompatible.model} · 在线`
        : `${meta.shortLabel} OpenAI 未配置`
    }

    return settings.ollama.configured && settings.ollama.model
      ? `${meta.shortLabel} ${settings.ollama.model} · 本地`
      : `${meta.shortLabel} Ollama 未配置`
  })
  const providerLabel = scenarioStatusLabels[0] ?? '改写 OpenAI 未配置'

  const getInstructionForMode = useCallback((mode: WorkspaceActionMode) => {
    if (mode === 'rewrite') return rewritePrompt
    return '围绕当前选区继续推进剧情。'
  }, [rewritePrompt])

  const buildPresetCompatRuntimeContext = (surfaceId: PresetCompatSurfaceId) => {
    if (!currentChapter) return {}

    const selection = workspaceSelection ?? toChapterTimelineSelection(currentChapter)
    const sessionEntry = presetCompatSessionState[createPresetCompatSessionStateKey(selection, surfaceId)]

    return {
      sessionPhase: sessionEntry?.phase ?? null,
      hasImpersonationContext: surfaceId === 'roleplay',
    }
  }

  const syncRewriteFlowFromRecoverableJob = useCallback((job: RecoverableRewriteJob, options?: {
    restorePanelState?: boolean
  }) => {
    const nextCandidate = job.result ? toRewriteCandidateFromRecoverableResult(job.result) : null
    const isPending = job.status === 'queued' || job.status === 'running'
    const nextError = job.status === 'failed'
      ? (job.errorMessage?.trim() || '改写任务失败')
      : ''

    if (options?.restorePanelState) {
      const restoredSelection = job.panel.selectedText.trim()
      if (restoredSelection) {
        setSelectionText(restoredSelection)
        setLockedSelectionText(restoredSelection)
      }
      setRewritePrompt(job.panel.userInstruction || DEFAULT_REWRITE_PROMPT)
      setRewriteSourceTextOverride(job.panel.sourceTextOverride ?? '')
      if (
        job.panel.rewriteLaunchSource === 'chapter'
        || job.panel.rewriteLaunchSource === 'what_if'
        || job.panel.rewriteLaunchSource === 'future_jump'
        || job.panel.rewriteLaunchSource === 'continue_block'
      ) {
        setRewriteLaunchSource(job.panel.rewriteLaunchSource)
      }
    }

    setRewriteFlow({
      loading: isPending,
      error: nextError,
      provider: job.result?.provider || 'recoverable-rewrite-job',
      candidates: nextCandidate ? [nextCandidate] : [],
      selectedIndex: 0,
      jobId: job.jobId,
      jobStatus: job.status,
      jobCurrentStep: job.currentStep,
    })
    setRewriteState((current) => ({
      loading: isPending,
      error: nextError,
      result: nextCandidate?.content || current.result,
    }))
  }, [])

  const loadContextPreview = useCallback(async (
    mode: WorkspaceActionMode,
    instructionOverride?: string,
    selectionOverride?: string,
    options?: {
      preserveDisabledBlocks?: boolean
      excludedGraphEdgeIds?: string[]
      excludedEvidenceIds?: string[]
      branchContextNodeId?: string
      branchContextInclusion?: 'ancestors_only' | 'include_selected'
      omitSelectedText?: boolean
    }
  ) => {
    if (!currentChapter) return null
    const sourceChapter = currentChapter.parentChapterId ? parentChapter ?? null : currentChapter
    if (!sourceChapter) {
      setContextPreviewError('当前分支没有可继承的父章节图谱。')
      return null
    }
    const targetSelection = ((selectionOverride ?? lockedSelectionText) || selectionText).trim()
    if (!targetSelection) return null
    const selectedTextForContext = options?.omitSelectedText ? '' : targetSelection

    setContextPreviewLoading(true)
    setContextPreviewError('')
    try {
      const branchContext = mode === 'rewrite'
        ? {
            branchContextNodeId: options?.branchContextNodeId ?? buildContinueBlockLineageRequestContext(activeContinueBlockRewriteContext).branchContextNodeId,
            branchContextInclusion: options?.branchContextInclusion ?? buildContinueBlockLineageRequestContext(activeContinueBlockRewriteContext).branchContextInclusion,
          }
        : {}
      const data = await callGenerationContextApi({
        novelId: currentNovelId,
        chapterId: sourceChapter.id,
        selectedText: selectedTextForContext,
        operationType: toGenerationContextOperationType(mode),
        userInstruction: instructionOverride ?? getInstructionForMode(mode),
        excludedGraphEdgeIds: options?.excludedGraphEdgeIds ?? excludedGraphEdgeIds,
        excludedEvidenceIds: options?.excludedEvidenceIds ?? excludedEvidenceIds,
        ...branchContext,
      })

      if (!data.ok || !data.graphContext || !data.promptBlocks || !data.lanceEvidence) {
        throw new Error(data.error || '上下文预览生成失败')
      }

      const nextContext = {
        ...(data as GenerationContextBuildData),
        sourceMeta: currentChapter.parentChapterId
          ? {
              mode: 'inherited-parent',
              chapterId: sourceChapter.id,
              chapterNo: sourceChapter.order,
              chapterTitle: sourceChapter.title,
            }
          : {
              mode: 'direct',
              chapterId: sourceChapter.id,
              chapterNo: sourceChapter.order,
              chapterTitle: sourceChapter.title,
            },
      } satisfies GenerationContextBuildData
      setGenerationContext(nextContext)
      setGraphContext(nextContext.graphContext)
      setGraphSelection((current) => resolveGraphSelection(nextContext.graphContext, current))
      setEvidenceDrawerOpen(Boolean(nextContext.lanceEvidence.length))
      setDisabledContextBlockIds((current) => (options?.preserveDisabledBlocks ? current : []))
      setGraphMutationError('')
      return nextContext
    } catch (error) {
      setGenerationContext(null)
      setGraphContext(null)
      setGraphSelection(null)
      setContextPreviewError(error instanceof Error ? error.message : '上下文预览生成失败')
      return null
    } finally {
      setContextPreviewLoading(false)
    }
  }, [
    currentChapter,
    currentNovelId,
    activeContinueBlockRewriteContext,
    excludedEvidenceIds,
    excludedGraphEdgeIds,
    getInstructionForMode,
    lockedSelectionText,
    parentChapter,
    selectionText,
  ])

  useEffect(() => {
    if (!pendingWhatIfRewriteLaunch || !currentChapter || currentChapter.id !== pendingWhatIfRewriteLaunch.targetChapterId) return

    const { detail, variant } = pendingWhatIfRewriteLaunch
    const instruction = variant === 'continue'
      ? `${detail.premise.trim() || '沿着当前 What-if 前提继续推进。'}\n\n继续沿着这个 What-if 分支扩展新的整章版本，不要回写主线正文。`
      : detail.premise.trim() || '沿着当前 What-if 前提重新生成版本。'

    setSelectionText(detail.selectedText)
    setLockedSelectionText(detail.selectedText)
    setToolbarPos(null)
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
    setRewritePrompt(DEFAULT_REWRITE_PROMPT)
    setRewriteLaunchSource('what_if')
    setRewriteSourceTextOverride(detail.generatedText)
    setRewriteState({ loading: false, result: detail.generatedText, error: '' })
    setRewriteFlow({
      loading: false,
      error: '',
      provider: 'what-if-session',
      candidates: [
        {
          title: variant === 'continue' ? '当前分支版本' : '当前 What-if 版本',
          summary: variant === 'continue'
            ? '从已持久化的 What-if 会话继续衍生分支版本。'
            : '从已持久化的 What-if 会话重新进入改写流程。',
          content: detail.generatedText,
          inputTokens: detail.inputTokens ?? null,
          outputTokens: detail.outputTokens ?? null,
        },
      ],
      selectedIndex: 0,
      jobId: null,
      jobStatus: null,
      jobCurrentStep: null,
    })
    setActiveMode('rewrite')
    setPendingWhatIfRewriteLaunch(null)

    window.setTimeout(() => {
      void loadContextPreview('rewrite', instruction, detail.selectedText)
    }, 0)
  }, [currentChapter, pendingWhatIfRewriteLaunch, loadContextPreview])

  useEffect(() => {
    if (!pendingFutureJumpRewriteLaunch || !currentChapter || currentChapter.id !== pendingFutureJumpRewriteLaunch.targetChapterId) return

    const { detail, selectedText, originalText, userInstruction } = pendingFutureJumpRewriteLaunch

    setSelectionText(selectedText)
    setLockedSelectionText(selectedText)
    setToolbarPos(null)
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
    setRewritePrompt(DEFAULT_REWRITE_PROMPT)
    setRewriteLaunchSource('future_jump')
    setRewriteSourceTextOverride(originalText)
    setRewriteState({ loading: false, result: originalText, error: '' })
    setRewriteFlow({
      loading: false,
      error: '',
      provider: 'future-jump-run',
      candidates: [
        {
          title: '当前 Future 版本',
          summary: '从已持久化的 Future Jump 最新修订继续推进，不默认回写主线章节。',
          content: originalText,
          inputTokens: detail.inputTokens ?? null,
          outputTokens: detail.outputTokens ?? null,
        },
      ],
      selectedIndex: 0,
      jobId: null,
      jobStatus: null,
      jobCurrentStep: null,
    })
    setActiveFutureJumpRewriteContext(pendingFutureJumpRewriteLaunch)
    setActiveContinueBlockRewriteContext(null)
    setActiveMode('rewrite')
    setPendingFutureJumpRewriteLaunch(null)

    window.setTimeout(() => {
      void loadContextPreview('rewrite', userInstruction, selectedText)
    }, 0)
  }, [currentChapter, pendingFutureJumpRewriteLaunch, loadContextPreview])

  useEffect(() => {
    if (!pendingContinueBlockRewriteLaunch || !currentChapter || currentChapter.id !== pendingContinueBlockRewriteLaunch.targetChapterId) return

    const isContinue = pendingContinueBlockRewriteLaunch.variant === 'continue'
    const targetText = isContinue
      ? pendingContinueBlockRewriteLaunch.latestText.trim() || pendingContinueBlockRewriteLaunch.selectedText
      : pendingContinueBlockRewriteLaunch.selectedText
    const instruction = isContinue
      ? pendingContinueBlockRewriteLaunch.userInstruction.trim()
      : [
          pendingContinueBlockRewriteLaunch.userInstruction.trim() ? `前一版要求：${pendingContinueBlockRewriteLaunch.userInstruction.trim()}` : '',
          `当前续写块：${pendingContinueBlockRewriteLaunch.title}`,
          '重新生成当前续写块，并保留它的修订历史。',
        ].filter(Boolean).join('\n\n')

    setSelectionText(targetText)
    setLockedSelectionText(targetText)
    setToolbarPos(null)
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
    setRewritePrompt(instruction)
    setRewriteLaunchSource('continue_block')
    setRewriteSourceTextOverride(pendingContinueBlockRewriteLaunch.latestText)
    setRewriteState({ loading: false, result: pendingContinueBlockRewriteLaunch.latestText, error: '' })
    setRewriteFlow({
      loading: false,
      error: '',
      provider: 'continue-block-reader',
      candidates: [
        {
          title: pendingContinueBlockRewriteLaunch.variant === 'continue' ? '当前续写块版本' : '当前待重生版本',
          summary: pendingContinueBlockRewriteLaunch.variant === 'continue'
            ? '会复用 rewrite 工作台，但保存时创建新的子续写块。'
            : '会复用 rewrite 工作台，但保存时覆盖当前续写块并追加历史。',
          content: pendingContinueBlockRewriteLaunch.latestText,
          inputTokens: pendingContinueBlockRewriteLaunch.inputTokens ?? null,
          outputTokens: pendingContinueBlockRewriteLaunch.outputTokens ?? null,
        },
      ],
      selectedIndex: 0,
      jobId: null,
      jobStatus: null,
      jobCurrentStep: null,
    })
    setActiveFutureJumpRewriteContext(null)
    setActiveContinueBlockRewriteContext(pendingContinueBlockRewriteLaunch)
    setActiveMode('rewrite')
    setPendingContinueBlockRewriteLaunch(null)

    window.setTimeout(() => {
      void loadContextPreview('rewrite', instruction, targetText, {
        ...buildContinueBlockLineageRequestContext(pendingContinueBlockRewriteLaunch),
      })
    }, 0)
  }, [currentChapter, pendingContinueBlockRewriteLaunch, loadContextPreview])

  const syncGraphReview = async (nextControls: GraphReviewControls, fallbackContext?: GenerationContextBuildData | null) => {
    const sourceContext = fallbackContext ?? generationContext
    if (!sourceContext?.graphContext.seedEntities.length || !currentNovelId) {
      setGraphReviewControls(nextControls)
      return
    }

    const params = new URLSearchParams({
      novelId: currentNovelId,
      branchId: sourceContext.branchId,
      chapterNo: String(sourceContext.chapterNo),
      hops: String(nextControls.maxHops),
      includeLowConfidence: String(!nextControls.hideLowConfidence),
      confirmedOnly: String(nextControls.confirmedOnly),
      entityId: sourceContext.graphContext.seedEntities.map((node) => node.id).join(','),
    })

      setGraphReviewLoading(true)
      setContextPreviewError('')
      setGraphReviewControls(nextControls)

    try {
      const data = await callGraphSubgraphApi(`/api/graph/subgraph?${params.toString()}`)
      if (!data.ok || !data.nodes || !data.edges || !data.seedEntities || !data.status) {
        throw new Error(data.error || '图谱装配失败')
      }

      const nextGraphContext: GenerationContextBuildData['graphContext'] = {
        seedEntities: data.seedEntities,
        nodes: data.nodes,
        edges: data.edges,
        contextText: data.contextText ?? '',
        warnings: data.warnings ?? [],
        tokenEstimate: data.tokenEstimate ?? 0,
        status: data.status,
      }

      setGraphContext(nextGraphContext)
      setGraphSelection((current) => resolveGraphSelection(nextGraphContext, current))
    } catch (error) {
      setContextPreviewError(error instanceof Error ? error.message : '图谱装配失败')
    } finally {
      setGraphReviewLoading(false)
    }
  }

  const openActionMode = async (mode: WorkspaceActionMode) => {
    const nextSelection = selectionText.trim()
    if (!nextSelection) return
    if (!currentChapter) return

    if (mode === 'roleplay') {
      if (!currentNovelId) return
      const currentBranchId = storyTimelineData?.branchId ?? `${currentNovelId}:main`
      setRoleplaySessionStarting(true)
      setSaveContinueBlockError('')

      try {
        const selectionPreview = nextSelection.length > 48 ? `${nextSelection.slice(0, 48)}…` : nextSelection
        const result = await callCreateRoleplaySessionApi({
          novelId: currentNovelId,
          branchId: currentBranchId,
          title: `RP · ${currentChapter.title}`,
          subtitle: `围绕片段「${selectionPreview}」展开角色扮演`,
          sourceChapterId: currentChapter.id,
          sourceChapterNo: currentChapter.order,
          sourceChapterTitle: currentChapter.title,
          sourceTimelineNodeId: null,
          sourceTimelineNodeType: 'chapter',
          sourceSelectedText: nextSelection,
          sourceTextSnapshot: chapterText,
          sourceSelectedLineStart: null,
          sourceSelectedLineEnd: null,
        })

        const refreshed = await loadStoryTimeline()
        const matchingNode = refreshed?.branchNodes.find(
          (node) => node.id === result.timelineNodeId || node.roleplaySessionId === result.sessionId
        )

        setWorkspaceSelection(
          matchingNode?.roleplaySessionId
            ? {
                kind: 'roleplay_session',
                nodeId: matchingNode.id,
                roleplaySessionId: matchingNode.roleplaySessionId,
                anchorChapterNo: matchingNode.anchorChapterNo,
              }
            : {
                kind: 'roleplay_session',
                nodeId: result.timelineNodeId,
                roleplaySessionId: result.sessionId,
                anchorChapterNo: currentChapter.order,
              }
        )
        setCenterPaneView('body')
        setLeftPanelOpen(false)
        setToolbarPos(null)
        setSelectionText('')
        setLockedSelectionText('')
        window.scrollTo({ top: 0, behavior: 'auto' })
      } catch (error) {
        const message = error instanceof Error ? error.message : '创建角色扮演会话失败'
        setSaveContinueBlockError(message)
        setToast(message)
        window.setTimeout(() => setToast(''), 2400)
      } finally {
        setRoleplaySessionStarting(false)
      }

      return
    }

    setPresetCompatSessionPhase(
      workspaceSelection ?? toChapterTimelineSelection(currentChapter),
      toPresetCompatSessionSurfaceId(mode),
      'new_chat'
    )

    setLockedSelectionText(nextSelection)
    setToolbarPos(null)
    setGenerationContext(null)
    setGraphContext(null)
    setContextPreviewError('')
    setGraphReviewControls(DEFAULT_GRAPH_REVIEW_CONTROLS)
    setGraphSelection(null)
    setEvidenceDrawerOpen(false)
    setDisabledContextBlockIds([])
    setExcludedGraphEdgeIds([])
    setExcludedEvidenceIds([])
    setGraphMutationPendingId(null)
    setGraphMutationError('')
    if (mode === 'rewrite') {
      setRewriteLaunchSource('chapter')
      setRewriteSourceTextOverride('')
      setRewriteFlow({
        loading: false,
        error: '',
        provider: '',
        candidates: [],
        selectedIndex: 0,
        jobId: null,
        jobStatus: null,
        jobCurrentStep: null,
      })
    }
    setActiveMode(mode)
    window.setTimeout(() => {
      void loadContextPreview(mode)
    }, 0)
  }

  const handleRefreshContextReview = async (options?: {
    excludedGraphEdgeIds?: string[]
    excludedEvidenceIds?: string[]
    preserveDisabledBlocks?: boolean
  }) => {
    if (!activeMode) return
    const nextContext = await loadContextPreview(activeMode, undefined, undefined, {
      preserveDisabledBlocks: options?.preserveDisabledBlocks ?? true,
      excludedGraphEdgeIds: options?.excludedGraphEdgeIds,
      excludedEvidenceIds: options?.excludedEvidenceIds,
    })
    if (!nextContext) return
    if (
      graphReviewControls.maxHops !== DEFAULT_GRAPH_REVIEW_CONTROLS.maxHops ||
      graphReviewControls.hideLowConfidence !== DEFAULT_GRAPH_REVIEW_CONTROLS.hideLowConfidence ||
      graphReviewControls.confirmedOnly !== DEFAULT_GRAPH_REVIEW_CONTROLS.confirmedOnly
    ) {
      await syncGraphReview(graphReviewControls, nextContext)
    }
  }

  const handleExcludedGenerationContextChange = async (next: {
    excludedGraphEdgeIds: string[]
    excludedEvidenceIds: string[]
  }) => {
    setExcludedGraphEdgeIds(next.excludedGraphEdgeIds)
    setExcludedEvidenceIds(next.excludedEvidenceIds)
    await handleRefreshContextReview({
      excludedGraphEdgeIds: next.excludedGraphEdgeIds,
      excludedEvidenceIds: next.excludedEvidenceIds,
      preserveDisabledBlocks: true,
    })
  }

  const handleGraphEdgeMutation = async (edgeId: string, request: () => Promise<{ ok?: boolean; error?: string }>) => {
    setGraphMutationPendingId(edgeId)
    setGraphMutationError('')
    try {
      const result = await request()
      if (!result.ok) {
        throw new Error(result.error || '图谱关系更新失败')
      }

      await handleRefreshContextReview({ preserveDisabledBlocks: true })
    } catch (error) {
      setGraphMutationError(error instanceof Error ? error.message : '图谱关系更新失败')
    } finally {
      setGraphMutationPendingId(null)
    }
  }

  const handleConfirmGraphEdge = async (edgeId: string) => {
    await handleGraphEdgeMutation(edgeId, () => callGraphEdgeConfirmApi(edgeId))
  }

  const handleRejectGraphEdge = async (edgeId: string) => {
    await handleGraphEdgeMutation(edgeId, () => callGraphEdgeRejectApi(edgeId))
  }

  const handleSaveGraphEdgeEdit = async (edgeId: string, draft: GraphEdgeEditDraft) => {
    await handleGraphEdgeMutation(edgeId, () => callGraphEdgeEditApi(edgeId, {
      linkType: draft.linkType.trim(),
      label: draft.label.trim() || null,
      description: draft.description.trim() || null,
      polarity: draft.polarity || null,
      strength: draft.strength,
      validFromChapter: draft.validFromChapter,
      validUntilChapter: draft.validUntilChapter.trim() ? Number(draft.validUntilChapter.trim()) : null,
      includeByDefault: draft.includeByDefault,
    }))
  }

  const handleGraphControlChange = async (nextControls: GraphReviewControls) => {
    if (
      nextControls.maxHops === graphReviewControls.maxHops &&
      nextControls.hideLowConfidence === graphReviewControls.hideLowConfidence &&
      nextControls.confirmedOnly === graphReviewControls.confirmedOnly
    ) {
      setGraphReviewControls(nextControls)
      return
    }

    await syncGraphReview(nextControls)
  }

  const copyText = async (mode: 'rewrite' | 'roleplay', text: string) => {
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(mode)
    window.setTimeout(() => setCopied(null), 1500)
  }

  const applyFullChapter = (text: string) => {
    if (!currentChapter || !text.trim()) return
    updateChapterContent(currentChapter.id, plainTextToHtml(text.trim()))
    if (editorRef.current) {
      editorRef.current.innerText = text.trim()
    }
    setToast('已应用到正文')
    window.setTimeout(() => setToast(''), 1800)
    closePanel()
  }

  const saveSettings = async () => {
    await saveAISettings()
    setSettingsOpen(false)
  }

  async function loadOllamaModels(scenario: AIScenarioKey, baseUrl?: string) {
    const purpose = AI_SCENARIO_META[scenario].ollamaPurpose

    setOllamaModelsLoading((current) => ({ ...current, [scenario]: true }))
    setOllamaModelsError((current) => ({ ...current, [scenario]: '' }))
    try {
      const query = new URLSearchParams({ purpose })
      if (baseUrl?.trim()) {
        query.set('baseUrl', baseUrl.trim())
      }

      const response = await fetch(`/api/settings/ai/ollama-models?${query.toString()}`, { cache: 'no-store' })
      const data = (await response.json()) as {
        ok?: boolean
        error?: string
        models?: OllamaModelOption[]
      }

      if (!response.ok || !data.ok) {
        throw new Error(data.error || `无法读取本地 Ollama ${purpose === 'embedding' ? 'embedding' : '文本'}模型`)
      }

      setOllamaModelsByScenario((current) => ({ ...current, [scenario]: data.models ?? [] }))
    } catch (error) {
      setOllamaModelsByScenario((current) => ({ ...current, [scenario]: [] }))
      setOllamaModelsError((current) => ({
        ...current,
        [scenario]: error instanceof Error ? error.message : '无法读取本地 Ollama 模型',
      }))
    } finally {
      setOllamaModelsLoading((current) => ({ ...current, [scenario]: false }))
    }
  }

  async function loadOpenAICompatibleModels(scenario: AIScenarioKey, baseUrl?: string, apiKey?: string) {
    const requestId = openAICompatibleModelsRequestRef.current[scenario] + 1
    openAICompatibleModelsRequestRef.current[scenario] = requestId
    const trimmedBaseUrl = baseUrl?.trim() ?? ''

    if (!trimmedBaseUrl) {
      setOpenAICompatibleModelsByScenario((current) => ({ ...current, [scenario]: [] }))
      setOpenAICompatibleModelsLoading((current) => ({ ...current, [scenario]: false }))
      return
    }

    setOpenAICompatibleModelsLoading((current) => ({ ...current, [scenario]: true }))

    try {
      const response = await fetch('/api/settings/ai/openai-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: trimmedBaseUrl, apiKey: apiKey?.trim() ?? '', scenario }),
      })
      const data = (await response.json()) as {
        ok?: boolean
        models?: OpenAICompatibleModelOption[]
      }

      if (openAICompatibleModelsRequestRef.current[scenario] !== requestId) {
        return
      }

      if (!response.ok || !data.ok) {
        setOpenAICompatibleModelsByScenario((current) => ({ ...current, [scenario]: [] }))
        return
      }

      setOpenAICompatibleModelsByScenario((current) => ({ ...current, [scenario]: data.models ?? [] }))
    } catch {
      if (openAICompatibleModelsRequestRef.current[scenario] === requestId) {
        setOpenAICompatibleModelsByScenario((current) => ({ ...current, [scenario]: [] }))
      }
    } finally {
      if (openAICompatibleModelsRequestRef.current[scenario] === requestId) {
        setOpenAICompatibleModelsLoading((current) => ({ ...current, [scenario]: false }))
      }
    }
  }

  const renderOpenAICompatibleFields = (scenario: AIScenarioKey) => {
    const scenarioSettings = resolvedAISettings[scenario]
    const knowledgeExtractionSettings = scenario === 'knowledgeExtraction' ? resolvedAISettings.knowledgeExtraction : null
    const currentModels = openAICompatibleModelsByScenario[scenario]
    const loading = openAICompatibleModelsLoading[scenario]
    const selectedModel = currentModels.some((model) => model.id === scenarioSettings.openAICompatible.model)
      ? scenarioSettings.openAICompatible.model
      : ''

    return (
      <div className="mt-4 rounded-[22px] border border-white/8 bg-black/20 p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">OpenAI-compatible API</p>
            <p className="mt-1 text-sm text-zinc-300">当前场景会保存独立的 Base URL、API Key 与模型名。</p>
          </div>
          <button
            type="button"
            onClick={() => {
              void loadOpenAICompatibleModels(
                scenario,
                scenarioSettings.openAICompatible.baseUrl,
                scenarioSettings.openAICompatible.apiKey
              )
            }}
            className="shrink-0 rounded-2xl border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/[0.06]"
          >
            {loading ? '刷新中…' : '刷新模型'}
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm text-zinc-300">Base URL</span>
            <input
              value={scenarioSettings.openAICompatible.baseUrl}
              onChange={(event) => updateScenarioOpenAIField(scenario, 'baseUrl', event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
              placeholder="https://api.openai.com/v1"
            />
            <p className="mt-2 text-xs leading-5 text-zinc-500">
              模型发现会尝试读取当前 Base URL 下的 <code className="rounded bg-white/5 px-1 py-0.5 text-[11px] text-zinc-300">/models</code>；如果服务不支持，仍可继续手动填写 Model。
            </p>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-zinc-300">API Key</span>
            <input
              value={scenarioSettings.openAICompatible.apiKey}
              onChange={(event) => updateScenarioOpenAIField(scenario, 'apiKey', event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
              placeholder={scenarioSettings.openAICompatible.apiKeyMasked || 'sk-...'}
            />
            {scenarioSettings.openAICompatible.apiKeyConfigured && !scenarioSettings.openAICompatible.apiKey ? (
              <p className="mt-2 text-xs leading-5 text-zinc-500">当前已保存 API Key。留空保存会保持现有 key，不会自动清除。</p>
            ) : null}
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-zinc-300">Model</span>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs leading-5 text-zinc-500">
                {loading
                  ? '正在读取当前 Base URL 的可用模型…'
                  : currentModels.length > 0
                    ? `已发现 ${currentModels.length} 个可用模型，可直接选择，也可继续手动输入。`
                    : '可手动输入模型名；如果当前服务支持 /models，这里会自动补全建议。'}
              </p>
            </div>
            <select
              value={selectedModel}
              onChange={(event) => updateScenarioOpenAIField(scenario, 'model', event.target.value)}
              disabled={loading || currentModels.length === 0}
              className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">
                {loading
                  ? '正在读取可用模型…'
                  : currentModels.length > 0
                    ? '从已发现模型中选择'
                    : '当前没有可选模型，继续手动填写'}
              </option>
              {currentModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs leading-5 text-zinc-500">选择后会直接回填到下方 Model 输入框；如果列表为空，继续手动填写即可。</p>
            <input
              value={scenarioSettings.openAICompatible.model}
              onChange={(event) => updateScenarioOpenAIField(scenario, 'model', event.target.value)}
              className="mt-3 w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
              placeholder={AI_SCENARIO_META[scenario].openAIPlaceholder}
            />
          </label>

          {!loading && scenarioSettings.openAICompatible.baseUrl.trim() && currentModels.length === 0 ? (
            <p className="text-sm text-zinc-500">当前没有发现可用的 OpenAI-compatible 模型；你仍然可以继续手动填写 Model。</p>
          ) : null}

          {scenario === 'knowledgeExtraction' ? (
            <label className="block">
              <span className="mb-2 block text-sm text-zinc-300">并发请求数</span>
              <input
                type="number"
                min={1}
                max={20}
                value={knowledgeExtractionSettings?.openAICompatible.parallelism ?? 5}
                onChange={(event) => updateKnowledgeExtractionParallelism('openai-compatible', event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
              />
              <p className="mt-2 text-xs leading-5 text-zinc-500">知识抽取时最多同时发送多少个 API 请求。默认 5；遇到限流或空响应时会共享退避并串行重试。</p>
            </label>
          ) : null}
        </div>
      </div>
    )
  }

  const renderOllamaFields = (scenario: AIScenarioKey) => {
    const scenarioSettings = resolvedAISettings[scenario]
    const knowledgeExtractionSettings = scenario === 'knowledgeExtraction' ? resolvedAISettings.knowledgeExtraction : null
    const currentModels = ollamaModelsByScenario[scenario]
    const loading = ollamaModelsLoading[scenario]
    const error = ollamaModelsError[scenario]
    const purpose = AI_SCENARIO_META[scenario].ollamaPurpose

    return (
      <div className="mt-4 rounded-[22px] border border-white/8 bg-black/20 p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Ollama local</p>
            <p className="mt-1 text-sm text-zinc-300">
              {purpose === 'embedding'
                ? '当前场景会读取本地可用的 embedding 模型。'
                : '当前场景会读取本地可用的文本生成模型。'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void loadOllamaModels(scenario, scenarioSettings.ollama.baseUrl)
            }}
            className="rounded-2xl border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/[0.06]"
          >
            {loading ? '刷新中…' : '刷新本地模型'}
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm text-zinc-300">Ollama Base URL</span>
            <input
              value={scenarioSettings.ollama.baseUrl}
              onChange={(event) => updateScenarioOllamaField(scenario, 'baseUrl', event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
              placeholder="http://127.0.0.1:11434"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-zinc-300">Model</span>
            <select
              value={scenarioSettings.ollama.model}
              onChange={(event) => updateScenarioOllamaField(scenario, 'model', event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
            >
              <option value="">
                {purpose === 'embedding' ? '自动选择首个可用 embedding 模型' : '自动选择首个可用文本模型'}
              </option>
              {currentModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
            <input
              value={scenarioSettings.ollama.model}
              onChange={(event) => updateScenarioOllamaField(scenario, 'model', event.target.value)}
              className="mt-3 w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
              placeholder={AI_SCENARIO_META[scenario].ollamaPlaceholder}
            />
          </label>

          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          {!error && !loading && currentModels.length === 0 ? (
            <p className="text-sm text-zinc-500">
              {purpose === 'embedding'
                ? '当前没有发现可用于 embedding 的本地 Ollama 模型。'
                : '当前没有发现可用于文本生成的本地 Ollama 模型。'}
            </p>
          ) : null}

          {scenario === 'knowledgeExtraction' ? (
            <label className="block">
              <span className="mb-2 block text-sm text-zinc-300">并发请求数</span>
              <input
                type="number"
                min={1}
                max={20}
                value={knowledgeExtractionSettings?.ollama.parallelism ?? 1}
                onChange={(event) => updateKnowledgeExtractionParallelism('ollama', event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
              />
              <p className="mt-2 text-xs leading-5 text-zinc-500">知识抽取时最多同时发送多少个本地 Ollama 请求。默认 1；慢模型建议保持较低并发。</p>
            </label>
          ) : null}
        </div>
      </div>
    )
  }

  const handleDeleteChapter = useCallback(async (chapter: Chapter) => {
    const branchCount = localChapters.filter((item) => item.parentChapterId === chapter.id).length
    const prompt = chapter.parentChapterId
      ? `确认删除章节《${chapter.title}》吗？`
      : branchCount > 0
        ? `确认删除章节《${chapter.title}》及其 ${branchCount} 个分支吗？`
        : `确认删除章节《${chapter.title}》吗？`

    if (!window.confirm(prompt)) {
      return
    }

    deleteChapter(chapter.id)
    try {
      await saveToBackend()
      setToast(`已删除《${chapter.title}》`)
      window.setTimeout(() => setToast(''), 1800)
    } catch {
      await loadFromBackend()
      setToast(`删除《${chapter.title}》失败，已恢复本地状态。`)
      window.setTimeout(() => setToast(''), 2400)
    }
  }, [deleteChapter, loadFromBackend, localChapters, saveToBackend])

  const handleTimelineDeleteChapter = useCallback((chapterId: string) => {
    const targetChapter = sortedChapters.find((chapter) => chapter.id === chapterId)
    if (targetChapter) {
      void handleDeleteChapter(targetChapter)
    }
  }, [handleDeleteChapter, sortedChapters])

  const handleDeleteBranchNode = useCallback(async (targetNode: StoryTimelineBranchNode) => {
    if (!currentNovelId || deletingBranchNodeId || !currentChapter) return

    const directChildCount = resolvedStoryTimeline.branchNodes.filter((node) => node.parentNodeId === targetNode.id).length
    const promotedChildrenMessage = directChildCount > 0
      ? `它的 ${directChildCount} 个直属子节点会提升到上一级。`
      : '它不会影响其他分支节点。'
    const branchKindLabel = targetNode.nodeType === 'rewrite'
      ? 'Rewrite'
      : targetNode.nodeType === 'continue_block'
        ? 'Continue block'
        : targetNode.nodeType === 'what_if'
          ? 'What-if'
          : 'Future Jump'

    if (!window.confirm(`确认删除 ${branchKindLabel}《${targetNode.title}》吗？${promotedChildrenMessage}`)) {
      return
    }

    const previousSelection = workspaceSelection ?? toChapterTimelineSelection(currentChapter)
    setDeletingBranchNodeId(targetNode.id)
    try {
      await callDeleteStoryTimelineNodeApi(targetNode.id, currentNovelId, storyTimelineBranchId)
      const refreshed = await loadStoryTimeline()
      const nextSelection = resolveSelectionAfterDeletedBranchNode({
        deletedNode: targetNode,
        previousSelection,
        currentChapter,
        chapters: sortedChapters,
        branchNodes: refreshed?.branchNodes ?? [],
      }) ?? toChapterTimelineSelection(currentChapter)
      handleTimelineSelection(nextSelection)
      setToast(`已删除 ${targetNode.title}`)
      window.setTimeout(() => setToast(''), 2000)
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除时间线节点失败'
      setToast(message)
      window.setTimeout(() => setToast(''), 2400)
    } finally {
      setDeletingBranchNodeId(null)
    }
  }, [currentChapter, currentNovelId, deletingBranchNodeId, handleTimelineSelection, loadStoryTimeline, resolvedStoryTimeline.branchNodes, sortedChapters, storyTimelineBranchId, workspaceSelection])

  const handleDeleteNovel = async () => {
    if (!currentNovelId) return

    const title = currentNovelMeta?.title ?? '当前小说'
    if (!window.confirm(`确认删除小说《${title}》吗？这会同时删除全部章节和本地知识数据。`)) {
      return
    }

    deleteNovel(currentNovelId)
    try {
      await saveToBackend()
      setToast(`已删除《${title}》`)
      window.setTimeout(() => setToast(''), 1800)
    } catch {
      await loadFromBackend()
      setToast(`删除《${title}》失败，已恢复本地状态。`)
      window.setTimeout(() => setToast(''), 2400)
    }
  }

  const handleRebuildKnowledge = async () => {
    if (!currentNovelId || knowledgeRebuilding || knowledgeActionLoading) return
    setKnowledgeRebuilding(true)
    try {
      const result = await rebuildStoryKnowledge(currentNovelId, { chapterRange: selectedKnowledgeRebuildChapterRange })
      if (!result) return

      setKnowledgeRebuildStatus(result.knowledgeRebuildStatus)
      setHanlpCacheSnapshot(result.hanlpCacheSnapshot)

      if (
        result.knowledgeRebuildStatus?.jobId
        && (result.knowledgeRebuildStatus.status === 'queued'
          || result.knowledgeRebuildStatus.status === 'running'
          || result.knowledgeRebuildStatus.status === 'paused')
      ) {
        lastActiveKnowledgeJobIdRef.current = result.knowledgeRebuildStatus.jobId
      } else {
        lastActiveKnowledgeJobIdRef.current = null
      }

      if (result.jobOutcome === 'paused') {
        showKnowledgeToast('知识重建已暂停')
      } else if (result.jobOutcome === 'aborted') {
        lastActiveKnowledgeJobIdRef.current = null
        setKnowledgeRebuildStatus(null)
        showKnowledgeToast('知识重建已终止')
      } else if (result.jobOutcome === 'completed') {
        showKnowledgeToast(`知识视图已更新：${selectedKnowledgeRebuildChapterRangeLabel}`)
      } else if (result.knowledgeRebuildStatus?.status === 'failed') {
        showKnowledgeToast(resolveKnowledgeRebuildFailureMessage(result.knowledgeRebuildStatus) ?? '知识视图重建失败，请重新发起重建。', 2600)
      }
    } catch {
      showKnowledgeToast('知识视图重建失败', 2200)
    } finally {
      setKnowledgeRebuilding(false)
    }
  }

  const handlePauseKnowledge = async () => {
    if (!currentNovelId || !knowledgeRebuildActive || knowledgeActionLoading) return
    setKnowledgeActionLoading('pause')
    try {
      const result = await pauseStoryKnowledgeRebuild(currentNovelId)
      if (!result) return

      setKnowledgeRebuildStatus(result.knowledgeRebuildStatus)
      setHanlpCacheSnapshot(result.hanlpCacheSnapshot)
      if (
        result.knowledgeRebuildStatus?.jobId
        && (result.knowledgeRebuildStatus.status === 'queued'
          || result.knowledgeRebuildStatus.status === 'running'
          || result.knowledgeRebuildStatus.status === 'paused')
      ) {
        lastActiveKnowledgeJobIdRef.current = result.knowledgeRebuildStatus.jobId
      }

      showKnowledgeToast(result.jobOutcome === 'paused' ? '知识重建已暂停' : '当前没有进行中的知识重建任务')
    } catch {
      showKnowledgeToast('暂停知识重建失败', 2200)
    } finally {
      setKnowledgeActionLoading(null)
    }
  }

  const handleAbortKnowledge = async () => {
    if (!currentNovelId || (!knowledgeRebuildStatus && !knowledgeRebuilding) || knowledgeActionLoading) return
    setKnowledgeActionLoading('abort')
    try {
      const result = await abortStoryKnowledgeRebuild(currentNovelId)
      if (!result) return

      lastActiveKnowledgeJobIdRef.current = null
      setKnowledgeRebuildStatus(result.knowledgeRebuildStatus)
      setHanlpCacheSnapshot(result.hanlpCacheSnapshot)
      setKnowledgeRebuilding(false)
      showKnowledgeToast(result.jobOutcome === 'aborted' ? '知识重建已终止' : '当前没有可终止的知识重建任务')
    } catch {
      showKnowledgeToast('终止知识重建失败', 2200)
    } finally {
      setKnowledgeActionLoading(null)
    }
  }

  const handleDeleteKnowledgeGraph = async () => {
    if (!currentNovelId || knowledgeActionLoading) return
    setKnowledgeActionLoading('delete')
    try {
      const result = await deleteStoryKnowledgeGraph(currentNovelId)
      if (!result) return

      lastActiveKnowledgeJobIdRef.current = null
      setKnowledgeRebuildStatus(result.knowledgeRebuildStatus)
      setHanlpCacheSnapshot(result.hanlpCacheSnapshot)
      setKnowledgeRebuilding(false)
      setConfirmDeleteKnowledge(false)
      showKnowledgeToast(result.jobOutcome === 'deleted' ? '已清空当前小说的知识图谱数据' : '当前小说知识图谱未发生变化', 2000)
    } catch {
      showKnowledgeToast('删除知识图谱失败', 2200)
    } finally {
      setKnowledgeActionLoading(null)
    }
  }

  const handleDeleteHanlpCache = async () => {
    if (!currentNovelId || knowledgeActionLoading) return
    setKnowledgeActionLoading('delete-hanlp-cache')
    try {
      const result = await deleteStoryHanlpCache(currentNovelId)
      if (!result) return

      setKnowledgeRebuildStatus(result.knowledgeRebuildStatus)
      setHanlpCacheSnapshot(result.hanlpCacheSnapshot)
      setConfirmDeleteHanlpCache(false)

      if (result.actionError?.message) {
        showKnowledgeToast(result.actionError.message, 2600)
        return
      }

      showKnowledgeToast(result.jobOutcome === 'deleted' ? '已删除当前小说的 HanLP 缓存' : '当前小说没有可删除的 HanLP 缓存', 2200)
    } catch (error) {
      showKnowledgeToast(error instanceof Error ? error.message : '删除 HanLP 缓存失败', 2600)
    } finally {
      setKnowledgeActionLoading(null)
    }
  }

  const handleDeleteExtractionCache = async () => {
    if (!currentNovelId || knowledgeActionLoading) return
    setKnowledgeActionLoading('delete-extraction-cache')
    try {
      const result = await deleteStoryExtractionCache(currentNovelId)
      if (!result) return

      setKnowledgeRebuildStatus(result.knowledgeRebuildStatus)
      setHanlpCacheSnapshot(result.hanlpCacheSnapshot)
      setConfirmDeleteExtractionCache(false)

      if (result.actionError?.message) {
        showKnowledgeToast(result.actionError.message, 2600)
        return
      }

      showKnowledgeToast(result.jobOutcome === 'deleted' ? '已删除当前小说的 LLM 抽取缓存' : '当前小说没有可删除的 LLM 抽取缓存', 2200)
    } catch (error) {
      showKnowledgeToast(error instanceof Error ? error.message : '删除 LLM 抽取缓存失败', 2600)
    } finally {
      setKnowledgeActionLoading(null)
    }
  }

  const handleDeleteEmbeddingCache = async () => {
    if (!currentNovelId || knowledgeActionLoading) return
    setKnowledgeActionLoading('delete-embedding-cache')
    try {
      const result = await deleteStoryEmbeddingCache(currentNovelId)
      if (!result) return

      setKnowledgeRebuildStatus(result.knowledgeRebuildStatus)
      setHanlpCacheSnapshot(result.hanlpCacheSnapshot)
      setConfirmDeleteEmbeddingCache(false)

      if (result.actionError?.message) {
        showKnowledgeToast(result.actionError.message, 2600)
        return
      }

      showKnowledgeToast(result.jobOutcome === 'deleted' ? '已删除当前小说的原文 Embedding 缓存' : '当前小说没有可删除的原文 Embedding 缓存', 2200)
    } catch (error) {
      showKnowledgeToast(error instanceof Error ? error.message : '删除原文 Embedding 缓存失败', 2600)
    } finally {
      setKnowledgeActionLoading(null)
    }
  }

  const handleRewrite = async () => {
    const targetSelection = lockedSelectionText.trim() || selectionText.trim()
    if (!currentNovelId || !currentChapter || !targetSelection) return
    setRewriteState({ loading: true, result: '', error: '' })
    setRewriteFlow((current) => ({
      ...current,
      loading: true,
      error: '',
      provider: 'recoverable-rewrite-job',
      candidates: [],
      selectedIndex: 0,
      jobId: null,
      jobStatus: 'queued',
      jobCurrentStep: '正在创建可恢复改写任务…',
    }))
    try {
      await savePresetCompatLibrary()
      const continueBlockRequestContext = buildContinueBlockLineageRequestContext(activeContinueBlockRewriteContext)
      await loadContextPreview('rewrite', rewritePrompt, undefined, {
        ...continueBlockRequestContext,
      })
      const job = await callCreateRecoverableRewriteJobApi({
        novelId: currentNovelId,
        branchId: storyTimelineBranchId,
        chapterId: currentChapter.id,
        selectedText: continueBlockRequestContext.omitSelectedText ? '' : targetSelection,
        sourceText: rewriteSourceTextOverride.trim() || chapterText,
        operationType: 'rewrite',
        userInstruction: rewritePrompt,
        disabledBlockIds: disabledContextBlockIds,
        excludedGraphEdgeIds,
        excludedEvidenceIds,
        branchContextNodeId: continueBlockRequestContext.branchContextNodeId,
        branchContextInclusion: continueBlockRequestContext.branchContextInclusion,
        presetCompatRuntimeContext: buildPresetCompatRuntimeContext('rewrite'),
        scope: 'chapter',
        mode: 'heavy',
        tone: 'dramatic',
        rewriteLaunchSource,
        rewriteSourceTextOverride,
      })

      syncRewriteFlowFromRecoverableJob(job, { restorePanelState: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Rewrite failed.'
      setRewriteState({ loading: false, result: '', error: message })
      setRewriteFlow({
        loading: false,
        error: message,
        provider: '',
        candidates: [],
        selectedIndex: 0,
        jobId: null,
        jobStatus: null,
        jobCurrentStep: null,
      })
    }
  }

  useEffect(() => {
    if (!currentNovelId || !currentChapter) return

    let cancelled = false

    const restoreLatestRecoverableRewriteJob = async () => {
      try {
        const job = await callGetRecoverableRewriteJobApi({
          novelId: currentNovelId,
          branchId: storyTimelineBranchId,
          chapterId: currentChapter.id,
        })
        if (!job || cancelled) return
        const hasRecoverableResult = Boolean(job.result?.content?.trim())
        const shouldApply = job.status === 'queued'
          || job.status === 'running'
          || (job.status === 'succeeded' && hasRecoverableResult)
        if (!shouldApply) return
        setActiveMode('rewrite')
        syncRewriteFlowFromRecoverableJob(job, { restorePanelState: true })
      } catch {
        // Keep the current local panel state when restore fails.
      }
    }

    void restoreLatestRecoverableRewriteJob()

    return () => {
      cancelled = true
    }
  }, [currentChapter, currentNovelId, storyTimelineBranchId, syncRewriteFlowFromRecoverableJob])

  useEffect(() => {
    if (activeMode !== 'rewrite' || !rewriteFlow.jobId) return
    if (rewriteFlow.jobStatus !== 'queued' && rewriteFlow.jobStatus !== 'running') return

    const pollJob = () => {
      void (async () => {
        try {
          const job = await callGetRecoverableRewriteJobApi({ jobId: rewriteFlow.jobId ?? undefined })
          if (!job) return
          syncRewriteFlowFromRecoverableJob(job)
        } catch {
          // Keep polling state quiet unless the backend explicitly returns a failed job.
        }
      })()
    }

    const intervalId = window.setInterval(pollJob, 1500)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [activeMode, rewriteFlow.jobId, rewriteFlow.jobStatus, syncRewriteFlowFromRecoverableJob])

  const handleSaveContinueBlock = async () => {
    const targetSelection = lockedSelectionText.trim() || selectionText.trim()
    const selectedCandidate = selectedRewriteCandidate?.content?.trim() || ''
    const originalText = activeContinueBlockRewriteContext?.originalText?.trim()
      || activeFutureJumpRewriteContext?.originalText.trim()
      || rewriteSourceTextOverride.trim()
      || chapterText
    if (!currentNovelId || !currentChapter || !targetSelection || !selectedCandidate || saveContinueBlockPending) return

    const parentTimelineNodeId = rewriteLaunchSource === 'continue_block'
      ? activeContinueBlockRewriteContext?.nodeId ?? (activeWorkspaceSelection.kind === 'chapter' ? null : activeWorkspaceSelection.nodeId)
      : rewriteLaunchSource === 'future_jump'
        ? activeFutureJumpRewriteContext?.parentTimelineNodeId ?? (activeWorkspaceSelection.kind === 'chapter' ? null : activeWorkspaceSelection.nodeId)
        : activeWorkspaceSelection.kind === 'chapter'
          ? null
          : activeWorkspaceSelection.nodeId

    setSaveContinueBlockPending(true)
    setSaveContinueBlockError('')
    try {
      const isContinueBlockRegenerate = rewriteLaunchSource === 'continue_block' && activeContinueBlockRewriteContext?.variant === 'regenerate'
      const result = isContinueBlockRegenerate
        ? await callRegenerateContinueBlockApi({
            continueBlockId: activeContinueBlockRewriteContext.continueBlockId,
            selectedText: targetSelection,
            originalText,
            generatedText: selectedCandidate,
            inputTokens: selectedRewriteCandidate?.inputTokens ?? null,
            outputTokens: selectedRewriteCandidate?.outputTokens ?? null,
            userInstruction: rewritePrompt.trim() || activeContinueBlockRewriteContext.userInstruction.trim() || '重新生成当前续写块',
            titleHint: selectedRewriteCandidate?.title?.trim() || rewritePrompt.trim().slice(0, 24),
            subtitleHint: selectedRewriteCandidate?.summary?.trim() || null,
          })
        : await callCreateContinueBlockApi({
            novelId: currentNovelId,
            branchId: storyTimelineBranchId,
            sourceChapterNo: currentChapter.order,
            parentTimelineNodeId,
            selectedText: targetSelection,
            originalText,
            generatedText: selectedCandidate,
            inputTokens: selectedRewriteCandidate?.inputTokens ?? null,
            outputTokens: selectedRewriteCandidate?.outputTokens ?? null,
            userInstruction: rewritePrompt.trim() || activeFutureJumpRewriteContext?.userInstruction.trim() || '保存当前改写结果',
            titleHint: selectedRewriteCandidate?.title?.trim() || rewritePrompt.trim().slice(0, 24),
            subtitleHint: selectedRewriteCandidate?.summary?.trim() || null,
          })

      const refreshed = await loadStoryTimeline()
      const matchingNode = refreshed?.branchNodes.find(
        (node) => node.id === result.timelineNodeId || node.continueBlockId === result.continueBlockId
      )

      closePanel()
      setCenterPaneView('body')
      setWorkspaceSelection(resolveContinueBlockSelectionAfterSave({
        matchingNode,
        result,
        fallbackAnchorChapterNo: currentChapter.order,
        parentTimelineNodeId,
      }))
      setLeftPanelOpen(false)

      setToast(`${isContinueBlockRegenerate ? '已更新' : '已创建'} ${result.title}`)
      window.setTimeout(() => setToast(''), 2200)
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存续写块失败'
      setSaveContinueBlockError(message)
      setToast(message)
      window.setTimeout(() => setToast(''), 2400)
    } finally {
      setSaveContinueBlockPending(false)
    }
  }

  const handleCreateWhatIf = async () => {
    const targetSelection = lockedSelectionText.trim() || selectionText.trim()
    const selectedCandidate = selectedRewriteCandidate?.content?.trim() || ''
    if (!currentNovelId || !currentChapter || !targetSelection || !selectedCandidate || saveContinueBlockPending) return

    setSaveContinueBlockError('')
    try {
      const result = await callCreateWhatIfSessionApi({
        novelId: currentNovelId,
        branchId: generationContext?.branchId ?? `${currentNovelId}:main`,
        sourceChapterNo: currentChapter.order,
        selectedText: targetSelection,
        originalText: chapterText,
        generatedText: selectedCandidate,
        inputTokens: selectedRewriteCandidate?.inputTokens ?? null,
        outputTokens: selectedRewriteCandidate?.outputTokens ?? null,
        userInstruction: rewritePrompt.trim(),
        titleHint: rewritePrompt.trim().slice(0, 24),
      })

      const refreshed = await loadStoryTimeline()
      const matchingNode = refreshed?.branchNodes.find(
        (node) => node.id === result.timelineNodeId || node.whatIfSessionId === result.sessionId
      )

      closePanel()
      setWorkspaceSelection(
        matchingNode?.whatIfSessionId
          ? {
              kind: 'what_if',
              nodeId: matchingNode.id,
              sessionId: matchingNode.whatIfSessionId,
              anchorChapterNo: matchingNode.anchorChapterNo,
            }
          : {
              kind: 'what_if',
              nodeId: result.timelineNodeId,
              sessionId: result.sessionId,
              anchorChapterNo: currentChapter.order,
            }
      )
      setLeftPanelOpen(false)

      setToast(`已创建 ${result.title}`)
      window.setTimeout(() => setToast(''), 2200)
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建 What-if 失败'
      setSaveContinueBlockError(message)
      setToast(message)
      window.setTimeout(() => setToast(''), 2400)
    }
  }

  if (!backendLoaded) {
    return (
      <WorkspaceStatusState
        icon={LoaderCircle}
        title="正在恢复工作区"
        description="正在读取你上次的章节与工作区选择。加载完成后，会自动打开一个有效章节；如果当前没有可用内容，也会带你回到书库继续导入。"
      />
    )
  }

  if (!hasWorkspaceContent) {
    return (
      <WorkspaceStatusState
        icon={BookOpen}
        title="工作区里还没有可用章节"
        description="当前持久化状态里没有可恢复的小说章节，所以这个工作区暂时无法打开。你可以回到书库选择已有小说，或先导入新的 TXT 内容再继续写作。"
        ctaLabel="返回书库并导入"
      />
    )
  }

  if (!currentChapter) {
    return (
      <WorkspaceStatusState
        icon={LoaderCircle}
        title="正在修复章节选择"
        description="检测到当前章节指向不可用，系统正在回退到一个有效章节。这个过程不会清空你的工作区内容，只会重新对齐当前选择。"
        ctaLabel="返回书库"
      />
    )
  }

  const activeWorkspaceSelection = workspaceSelection ?? toChapterTimelineSelection(currentChapter)
  const selectedTimelineNode = activeWorkspaceSelection.kind === 'chapter'
    ? null
    : timelineNodeById.get(activeWorkspaceSelection.nodeId) ?? null
  const selectedContinueBlockNode = activeWorkspaceSelection.kind === 'rewrite' || activeWorkspaceSelection.kind === 'continue_block'
    ? selectedTimelineNode
    : null
  const selectedContinueBlockFutureMapLaunch = (() => {
    if (
      (activeWorkspaceSelection.kind !== 'rewrite' && activeWorkspaceSelection.kind !== 'continue_block')
      || !selectedContinueBlockNode
      || !currentNovelId
    ) {
      return null
    }

    const sourceChapterNo = selectedContinueBlockNode.sourceChapterNo ?? selectedContinueBlockNode.anchorChapterNo
    const sourceChapter = resolveSourceChapter({ chapterId: null, chapterNo: sourceChapterNo })

    return {
      novelId: currentNovelId,
      branchId: storyTimelineBranchId,
      sourceContext: {
        nodeId: activeWorkspaceSelection.nodeId,
        nodeType: activeWorkspaceSelection.kind,
        chapterId: sourceChapter?.id ?? null,
        chapterNo: sourceChapterNo,
        whatIfSessionId: selectedContinueBlockNode.whatIfSessionId ?? null,
      },
      title: selectedContinueBlockNode.title,
      parentTimelineNodeId: activeWorkspaceSelection.nodeId,
    }
  })()
  const selectedTimelineLineageLabel = selectedTimelineNode?.readableLineageLabel?.trim() || selectedTimelineNode?.readableLabel?.trim() || selectedTimelineNode?.title?.trim() || ''
  const selectedTimelineDisplayLabel = selectedTimelineNode?.readableLabel?.trim() || selectedTimelineLineageLabel || selectedTimelineNode?.title?.trim() || ''
  const selectedTimelineInstructionText = selectedTimelineNode?.userInstruction?.trim() || selectedTimelineNode?.subtitle?.trim() || ''
  const selectedTimelineInstructionPreview = formatStoryBranchInstructionPreview(selectedTimelineInstructionText)
  const workspaceHeaderTitle = activeWorkspaceSelection.kind === 'chapter'
    ? currentChapter.title
    : selectedTimelineDisplayLabel || selectedTimelineNode?.title || currentChapter.title
  const currentNodeMetrics = resolveCurrentNodeMetrics({
    selection: activeWorkspaceSelection,
    chapterText,
    selectedNode: selectedTimelineNode,
    override: activeWorkspaceSelection.kind !== 'chapter' && currentBranchMetricsOverride?.nodeId === activeWorkspaceSelection.nodeId
      ? currentBranchMetricsOverride
      : null,
  })
  continueBlockMetricsNodeIdRef.current = activeWorkspaceSelection.kind === 'rewrite' || activeWorkspaceSelection.kind === 'continue_block'
    ? activeWorkspaceSelection.nodeId
    : null
  whatIfMetricsNodeIdRef.current = activeWorkspaceSelection.kind === 'what_if' ? activeWorkspaceSelection.nodeId : null
  futureJumpMetricsNodeIdRef.current = activeWorkspaceSelection.kind === 'future_jump' ? activeWorkspaceSelection.nodeId : null
  const chapterSelectionSummary = (lockedSelectionText || selectionText)
    ? `当前选区：${(lockedSelectionText || selectionText).slice(0, 24)}${(lockedSelectionText || selectionText).length > 24 ? '…' : ''}`
    : '当前选区：未选择'
  const chapterGraphSummary = `当前浏览：${graphSourceMeta?.mode === 'inherited-parent' ? `分支图谱（继承主线第 ${graphSourceMeta.chapterNo} 章）` : '章节图谱'}`
  const mobileRoleplayFocus = activeWorkspaceSelection.kind === 'roleplay_session'
  const openChapterWorkspace = (chapter: Chapter) => {
    setWorkspaceSelection(toChapterTimelineSelection(chapter))
    setCenterPaneView('body')
    selectChapter(chapter)
  }
  function reopenWhatIfRewriteFlow(detail: WhatIfSessionDetail, variant: 'regenerate' | 'continue') {
    const sourceChapter = resolveSourceChapter({ chapterId: null, chapterNo: detail.sourceChapterNo })
    if (!sourceChapter) {
      setToast(`找不到第 ${detail.sourceChapterNo} 章，无法重新打开 What-if 改写流`)
      window.setTimeout(() => setToast(''), 2400)
      return
    }

    setCenterPaneView('body')
    setLeftPanelOpen(false)
    setPresetCompatSessionPhase(
      {
        kind: 'what_if',
        nodeId: activeWorkspaceSelection.kind === 'what_if' ? activeWorkspaceSelection.nodeId : `what-if:${detail.id}`,
        sessionId: detail.id,
        anchorChapterNo: detail.sourceChapterNo,
      },
      'rewrite',
      variant === 'continue' ? 'continue' : 'new_chat',
      variant !== 'continue'
    )
    setPendingWhatIfRewriteLaunch({ detail, targetChapterId: sourceChapter.id, variant })
    setCurrentChapterId(sourceChapter.id)
  }

  function launchFutureMapFromWhatIf(detail: WhatIfSessionDetail) {
    const sourceChapter = resolveSourceChapter({ chapterId: null, chapterNo: detail.sourceChapterNo })
    setFutureMapLaunch({
      novelId: detail.novelId,
      branchId: detail.baseBranchId,
      sourceContext: {
        nodeId: activeWorkspaceSelection.kind === 'what_if' ? activeWorkspaceSelection.nodeId : null,
        nodeType: 'what_if',
        chapterId: sourceChapter?.id ?? null,
        chapterNo: detail.sourceChapterNo,
        whatIfSessionId: detail.id,
      },
      title: detail.title,
      parentTimelineNodeId: activeWorkspaceSelection.kind === 'what_if' ? activeWorkspaceSelection.nodeId : null,
    })
  }

  async function handleFutureJumpCreated(
    result: FutureJumpMutationResponse,
    context: { sourceChapterNo: number; targetChapterNo: number }
  ) {
    if (!result.timelineNodeId) {
      throw new Error('Future jump created without timeline node')
    }

    setFutureMapLaunch(null)

    const refreshed = await loadStoryTimeline()
    const matchingNode = refreshed?.branchNodes.find(
      (node) => node.id === result.timelineNodeId || node.futureJumpRunId === result.runId
    )

    setWorkspaceSelection(
      matchingNode?.futureJumpRunId && matchingNode.sourceChapterNo !== null && matchingNode.targetChapterNo !== null
        ? {
            kind: 'future_jump',
            nodeId: matchingNode.id,
            runId: matchingNode.futureJumpRunId,
            sourceChapterNo: matchingNode.sourceChapterNo,
            targetChapterNo: matchingNode.targetChapterNo,
          }
        : {
            kind: 'future_jump',
            nodeId: result.timelineNodeId,
            runId: result.runId,
            sourceChapterNo: context.sourceChapterNo,
            targetChapterNo: context.targetChapterNo,
          }
    )
    setLeftPanelOpen(false)
  }

  function reopenFutureJumpRewriteFlow(context: FutureJumpContinueContext) {
    const targetChapter = resolveSourceChapter({
      chapterId: context.targetChapter?.chapterId ?? null,
      chapterNo: context.targetChapter?.chapterNo ?? context.detail.targetChapterNo,
    })
    if (!targetChapter) {
      setToast(`找不到第 ${context.detail.targetChapterNo} 章，无法继续这条 Future Jump 改写流`)
      window.setTimeout(() => setToast(''), 2400)
      return
    }

    const targetTitle = context.targetChapter?.chapterTitle?.trim() || context.targetEvent?.title?.trim() || `第 ${context.detail.targetChapterNo} 章未来版本`
    const selectedText = context.detail.generatedTargetText.trim()
    const userInstruction = [
      context.detail.userDirection.trim() ? `原始方向：${context.detail.userDirection.trim()}` : '',
      `目标未来节点：${targetTitle}`,
      `最新桥接摘要：${context.detail.bridgeSummary}`,
      '继续沿着这个 Future Jump 的最新版本扩展新的整章候选；保存时创建子续写块，不要覆盖当前 Future Jump run，也不要默认回写主线正文。',
    ].filter(Boolean).join('\n\n')

    setCenterPaneView('body')
    setLeftPanelOpen(false)
    setPresetCompatSessionPhase(
      {
        kind: 'future_jump',
        nodeId: activeWorkspaceSelection.kind === 'future_jump' ? activeWorkspaceSelection.nodeId : `future-jump:${context.detail.id}`,
        runId: context.detail.id,
        sourceChapterNo: context.detail.sourceChapterNo,
        targetChapterNo: context.detail.targetChapterNo,
      },
      'rewrite',
      'continue'
    )
    setPendingFutureJumpRewriteLaunch({
      detail: context.detail,
      targetChapterId: targetChapter.id,
      targetTitle,
      parentTimelineNodeId: context.detail.timelineNodeId,
      selectedText,
      originalText: selectedText,
      userInstruction,
      inputTokens: context.detail.inputTokens ?? null,
      outputTokens: context.detail.outputTokens ?? null,
    })
    setCurrentChapterId(targetChapter.id)
  }

  function reopenContinueBlockRewriteFlow(variant: 'continue' | 'regenerate') {
    if (
      (activeWorkspaceSelection.kind !== 'rewrite' && activeWorkspaceSelection.kind !== 'continue_block')
      || !selectedContinueBlockNode?.continueBlockId
    ) {
      return
    }

    const anchorChapter = resolveSourceChapter({ chapterId: null, chapterNo: activeWorkspaceSelection.anchorChapterNo })
    if (!anchorChapter) {
      setToast(`找不到第 ${activeWorkspaceSelection.anchorChapterNo} 章，无法重新打开续写块改写流`)
      window.setTimeout(() => setToast(''), 2400)
      return
    }

    setCenterPaneView('body')
    setLeftPanelOpen(false)
    setPresetCompatSessionPhase(
      toContinueBranchSelection(activeWorkspaceSelection),
      'rewrite',
      variant === 'continue' ? 'continue' : 'new_chat',
      variant !== 'continue'
    )
    setPendingContinueBlockRewriteLaunch({
      continueBlockId: activeWorkspaceSelection.continueBlockId,
      nodeId: activeWorkspaceSelection.nodeId,
      anchorChapterNo: activeWorkspaceSelection.anchorChapterNo,
      latestText: selectedContinueBlockNode.latestText?.trim() || '',
      userInstruction: selectedContinueBlockNode.userInstruction?.trim() || '',
      selectedText: selectedContinueBlockNode.selectedText?.trim() || selectedContinueBlockNode.latestText?.trim() || '',
      originalText: selectedContinueBlockNode.originalText?.trim() || selectedContinueBlockNode.latestText?.trim() || '',
      title: selectedContinueBlockNode.title,
      subtitle: selectedContinueBlockNode.subtitle ?? null,
      inputTokens: selectedContinueBlockNode.inputTokens ?? null,
      outputTokens: selectedContinueBlockNode.outputTokens ?? null,
      targetChapterId: anchorChapter.id,
      variant,
    })
    setCurrentChapterId(anchorChapter.id)
  }

  const selectionActions = activeWorkspaceSelection.kind === 'chapter' ? (
    <div className="mb-4 rounded-[24px] border border-violet-400/20 bg-violet-500/10 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-violet-200/70">Chapter actions</p>
          <p className="mt-1 text-sm text-zinc-300">正文与图谱浏览继续沿用原来的章节工作流；这里仍然只在章节模式下暴露选区操作。</p>
        </div>
        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] text-zinc-300">第 {currentChapter.order} 章</span>
      </div>
      <div className="mt-3 grid gap-2">
        {WORKSPACE_CHAPTER_ACTION_ENTRY_MODES.map((mode) => {
          const meta = ACTION_META[mode]
          const Icon = meta.icon
          return (
            <button
              key={mode}
              type="button"
              data-testid={CHAPTER_ACTION_ENTRY_TEST_IDS[mode]}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (!selectionText.trim()) return
                void openActionMode(mode)
              }}
              className={cn(
                'flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition',
                activeMode === mode
                  ? 'border-violet-300/30 bg-white/[0.08]'
                  : 'border-white/8 bg-black/20 hover:bg-white/[0.06]',
                (!selectionText.trim() || (mode === 'roleplay' && roleplaySessionStarting)) && 'cursor-not-allowed opacity-50'
              )}
              disabled={!selectionText.trim() || (mode === 'roleplay' && roleplaySessionStarting)}
            >
              <div className="rounded-xl bg-white/10 p-2 text-violet-200"><Icon className="h-4 w-4" /></div>
              <div>
                <p className="text-sm font-medium text-zinc-100">{meta.label}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-400">{meta.description}</p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  ) : activeWorkspaceSelection.kind === 'rewrite' || activeWorkspaceSelection.kind === 'continue_block' ? (
    <div className="mb-4 rounded-[24px] border border-fuchsia-400/20 bg-fuchsia-500/10 p-4" data-testid="workspace-continue-block-actions">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-fuchsia-200/70">续写块动作</p>
          <h3 className="mt-1 text-sm font-medium text-zinc-100">{selectedTimelineDisplayLabel || selectedTimelineNode?.title || '续写块'}</h3>
          {selectedTimelineInstructionPreview ? <p className="mt-2 text-xs leading-6 text-fuchsia-100">指令预览 · {selectedTimelineInstructionPreview}</p> : null}
          <p className="mt-2 text-xs leading-6 text-zinc-300">续写块保存后会直接落到这个 reader 视图，并继续保留续写、重生与 Future Jump 三个稳定节点动作入口。</p>
        </div>
         <span className="rounded-full border border-fuchsia-300/20 bg-black/20 px-3 py-1 text-[11px] text-fuchsia-100">{selectedTimelineDisplayLabel || '续写块'}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => reopenContinueBlockRewriteFlow('continue')}
          data-testid={CONTINUE_BLOCK_ACTION_TEST_IDS.continue}
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 transition hover:bg-white/[0.08]"
        >
          继续续写
        </button>
        <button
          type="button"
          onClick={() => reopenContinueBlockRewriteFlow('regenerate')}
          data-testid={CONTINUE_BLOCK_ACTION_TEST_IDS.regenerate}
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 transition hover:bg-white/[0.08]"
        >
          重生当前节点
        </button>
        <button
          type="button"
          disabled={!selectedContinueBlockFutureMapLaunch}
          onClick={() => {
            if (!selectedContinueBlockFutureMapLaunch) return
            setFutureMapLaunch(selectedContinueBlockFutureMapLaunch)
          }}
          data-testid={CONTINUE_BLOCK_ACTION_TEST_IDS.futureJump}
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 transition hover:bg-white/[0.08] disabled:opacity-60"
        >
          Future Jump
        </button>
        <button
          type="button"
          onClick={() => {
            const anchorChapter = resolveSourceChapter({ chapterId: null, chapterNo: activeWorkspaceSelection.anchorChapterNo })
            if (anchorChapter) openChapterWorkspace(anchorChapter)
          }}
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 transition hover:bg-white/[0.08]"
        >
          返回锚点章节
        </button>
      </div>
    </div>
  ) : activeWorkspaceSelection.kind === 'what_if' ? (
    <div className="mb-4 rounded-[24px] border border-fuchsia-400/20 bg-fuchsia-500/10 p-4" data-testid="workspace-what-if-actions">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-fuchsia-200/70">What-if actions</p>
          <h3 className="mt-1 text-sm font-medium text-zinc-100">{selectedTimelineDisplayLabel || selectedTimelineNode?.title || 'What-if session'}</h3>
          {selectedTimelineInstructionPreview ? <p className="mt-2 text-xs leading-6 text-fuchsia-100">指令预览 · {selectedTimelineInstructionPreview}</p> : null}
          <p className="mt-2 text-xs leading-6 text-zinc-300">当前会话详情已经在中心面板按持久化结果加载。这里保留回到锚点章节的快捷入口，避免在 IF / 主章节之间来回迷路。</p>
        </div>
         <span className="rounded-full border border-fuchsia-300/20 bg-black/20 px-3 py-1 text-[11px] text-fuchsia-100">{selectedTimelineDisplayLabel || 'What-if session'}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            const anchorChapter = resolveSourceChapter({ chapterId: null, chapterNo: activeWorkspaceSelection.anchorChapterNo })
            if (anchorChapter) openChapterWorkspace(anchorChapter)
          }}
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 transition hover:bg-white/[0.08]"
        >
          返回锚点章节
        </button>
      </div>
    </div>
  ) : activeWorkspaceSelection.kind === 'future_jump' ? (
    <div className="mb-4 rounded-[24px] border border-sky-400/20 bg-sky-500/10 p-4" data-testid="workspace-future-jump-actions">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-sky-200/70">Future jump actions</p>
          <h3 className="mt-1 text-sm font-medium text-zinc-100">{selectedTimelineDisplayLabel || selectedTimelineNode?.title || 'Future jump run'}</h3>
          {selectedTimelineInstructionPreview ? <p className="mt-2 text-xs leading-6 text-sky-100">指令预览 · {selectedTimelineInstructionPreview}</p> : null}
          <p className="mt-2 text-xs leading-6 text-zinc-300">中心面板会直接读取持久化的 run 详情、最新修订与继续改写入口；右侧保留源/目标章节跳转，方便在主线与未来节点之间对照。</p>
        </div>
         <span className="rounded-full border border-sky-300/20 bg-black/20 px-3 py-1 text-[11px] text-sky-100">{selectedTimelineDisplayLabel || 'Future jump'}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            const sourceChapter = resolveSourceChapter({ chapterId: null, chapterNo: activeWorkspaceSelection.sourceChapterNo })
            if (sourceChapter) openChapterWorkspace(sourceChapter)
          }}
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 transition hover:bg-white/[0.08]"
        >
          打开源章节
        </button>
        <button
          type="button"
          onClick={() => {
            const targetChapter = resolveSourceChapter({ chapterId: null, chapterNo: activeWorkspaceSelection.targetChapterNo })
            if (targetChapter) openChapterWorkspace(targetChapter)
          }}
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 transition hover:bg-white/[0.08]"
        >
          打开目标章节
        </button>
      </div>
    </div>
  ) : activeWorkspaceSelection.kind === 'roleplay_session' ? (
    <div className="mb-4 rounded-[24px] border border-emerald-400/20 bg-emerald-500/10 p-4" data-testid="workspace-roleplay-session-actions">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-200/70">Roleplay actions</p>
          <h3 className="mt-1 text-sm font-medium text-zinc-100">{selectedTimelineDisplayLabel || selectedTimelineNode?.title || 'Roleplay session'}</h3>
          {selectedTimelineInstructionPreview ? <p className="mt-2 text-xs leading-6 text-emerald-100">首条消息预览 · {selectedTimelineInstructionPreview}</p> : null}
          <p className="mt-2 text-xs leading-6 text-zinc-300">中心面板会直接读取持久化的角色扮演会话与消息历史；这里保留回到锚点章节的快捷入口。</p>
        </div>
         <span className="rounded-full border border-emerald-300/20 bg-black/20 px-3 py-1 text-[11px] text-emerald-100">{selectedTimelineDisplayLabel || 'Roleplay session'}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            const anchorChapter = resolveSourceChapter({ chapterId: null, chapterNo: activeWorkspaceSelection.anchorChapterNo })
            if (anchorChapter) openChapterWorkspace(anchorChapter)
          }}
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 transition hover:bg-white/[0.08]"
        >
          返回锚点章节
        </button>
      </div>
    </div>
  ) : null

  const knowledgeControls = (
    <div className="mb-4 rounded-[24px] border border-violet-400/20 bg-violet-500/10 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-violet-200/70">Knowledge controls</p>
        <button
          onClick={() => {
            void handleRebuildKnowledge()
          }}
          disabled={knowledgeRebuilding || knowledgeRebuildActive || Boolean(knowledgeActionLoading)}
          className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] text-zinc-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {knowledgeRebuilding ? '处理中…' : knowledgeRebuildPaused ? '继续知识视图重建' : knowledgeRebuildFailed ? '重新重建知识视图' : '重建知识视图'}
        </button>
      </div>
      <div className="mt-3 rounded-2xl border border-violet-300/15 bg-black/20 p-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-300">
          <span className="text-zinc-500">章节范围</span>
          <button
            type="button"
            onClick={() => setKnowledgeRebuildRangeMode('all')}
            disabled={knowledgeRebuildActive || knowledgeRebuilding || Boolean(knowledgeActionLoading)}
            className={cn('rounded-full border px-3 py-1 transition disabled:cursor-not-allowed disabled:opacity-50', knowledgeRebuildRangeMode === 'all' ? 'border-violet-300/40 bg-violet-400/15 text-violet-50' : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]')}
          >
            全部
          </button>
          <button
            type="button"
            onClick={() => setKnowledgeRebuildRangeMode('first')}
            disabled={knowledgeRebuildActive || knowledgeRebuilding || Boolean(knowledgeActionLoading)}
            className={cn('rounded-full border px-3 py-1 transition disabled:cursor-not-allowed disabled:opacity-50', knowledgeRebuildRangeMode === 'first' ? 'border-violet-300/40 bg-violet-400/15 text-violet-50' : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]')}
          >
            前 N 章
          </button>
          <button
            type="button"
            onClick={() => setKnowledgeRebuildRangeMode('custom')}
            disabled={knowledgeRebuildActive || knowledgeRebuilding || Boolean(knowledgeActionLoading)}
            className={cn('rounded-full border px-3 py-1 transition disabled:cursor-not-allowed disabled:opacity-50', knowledgeRebuildRangeMode === 'custom' ? 'border-violet-300/40 bg-violet-400/15 text-violet-50' : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]')}
          >
            指定范围
          </button>
        </div>
        {knowledgeRebuildRangeMode === 'first' ? (
          <label className="mt-3 flex items-center gap-2 text-[11px] text-zinc-400">
            处理前
            <input
              value={knowledgeRebuildFirstChapterCount}
              onChange={(event) => setKnowledgeRebuildFirstChapterCount(event.target.value)}
              disabled={knowledgeRebuildActive || knowledgeRebuilding || Boolean(knowledgeActionLoading)}
              inputMode="numeric"
              className="w-20 rounded-xl border border-white/10 bg-black/25 px-2 py-1.5 text-zinc-100 outline-none transition focus:border-violet-300/50 disabled:cursor-not-allowed disabled:opacity-50"
            />
            章
          </label>
        ) : null}
        {knowledgeRebuildRangeMode === 'custom' ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
            <span>从第</span>
            <input
              value={knowledgeRebuildStartChapter}
              onChange={(event) => setKnowledgeRebuildStartChapter(event.target.value)}
              disabled={knowledgeRebuildActive || knowledgeRebuilding || Boolean(knowledgeActionLoading)}
              inputMode="numeric"
              className="w-20 rounded-xl border border-white/10 bg-black/25 px-2 py-1.5 text-zinc-100 outline-none transition focus:border-violet-300/50 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span>章到第</span>
            <input
              value={knowledgeRebuildEndChapter}
              onChange={(event) => setKnowledgeRebuildEndChapter(event.target.value)}
              disabled={knowledgeRebuildActive || knowledgeRebuilding || Boolean(knowledgeActionLoading)}
              inputMode="numeric"
              className="w-20 rounded-xl border border-white/10 bg-black/25 px-2 py-1.5 text-zinc-100 outline-none transition focus:border-violet-300/50 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span>章</span>
          </div>
        ) : null}
        <p className="mt-2 text-[10px] leading-4 text-zinc-500">
          本次将处理：{selectedKnowledgeRebuildChapterRangeLabel}。范围外知识会保留。
        </p>
      </div>
      {knowledgeRebuildStatus ? (
        <div className={cn(
          'mt-3 rounded-2xl px-3 py-3 text-xs',
          knowledgeRebuildFailed
            ? 'border border-rose-300/20 bg-rose-500/[0.08] text-rose-50'
            : 'border border-violet-300/15 bg-black/20 text-zinc-300'
        )}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <span>{knowledgeRebuildFailed ? '本地知识图谱重建失败' : knowledgeRebuildPaused ? '本地知识图谱已暂停' : '本地知识图谱重建中'}</span>
            <span>{knowledgeRebuildFailed ? '失败' : `${knowledgeRebuildOverallPercent}%`}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className={cn('h-full rounded-full transition-all', knowledgeRebuildFailed ? 'bg-rose-300' : 'bg-violet-400')}
              style={{ width: `${Math.max(6, Math.min(100, knowledgeRebuildOverallPercent))}%` }}
            />
          </div>
          <p className={cn('mt-2 text-[11px] leading-5', knowledgeRebuildFailed ? 'text-rose-100/90' : 'text-zinc-400')}>
            {knowledgeRebuildFailed
              ? knowledgeRebuildFailureMessage
              : knowledgeRebuildStatus.currentStep || (knowledgeRebuildPaused ? '等待继续重建…' : '正在准备知识重建…')}
          </p>
          <p className={cn('mt-1 text-[11px] leading-5', knowledgeRebuildFailed ? 'text-rose-100/70' : 'text-zinc-500')}>
            {knowledgeRebuildFailed
              ? '本次重建未完成，可重新发起知识重建。'
              : `预估剩余：${knowledgeRebuildPaused ? '已暂停' : knowledgeRebuildEtaMinutes ? `约 ${knowledgeRebuildEtaMinutes} 分钟` : '计算中'}`}
          </p>
          {knowledgeRebuildStatus.chapterRange ? (
            <p className="mt-1 text-[11px] leading-5 text-violet-100/75">任务范围：{formatKnowledgeRebuildChapterRangeLabel(knowledgeRebuildStatus.chapterRange)}</p>
          ) : null}
          <div className="mt-3 rounded-xl border border-violet-300/15 bg-violet-500/[0.08] px-3 py-3" data-testid="workspace-hanlp-bootstrap-card">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-medium text-violet-100">HanLP Bootstrap</p>
                <p className="mt-1 text-[10px] leading-4 text-violet-100/75">{hanlpBootstrapStatusLine}</p>
              </div>
              <span className="rounded-full border border-violet-300/20 bg-black/20 px-2.5 py-1 text-[10px] text-violet-100/85">
                {typeof hanlpBootstrapCompletedChapterCount === 'number' && typeof hanlpBootstrapTotalChapterCount === 'number'
                  ? `${hanlpBootstrapCompletedChapterCount} / ${hanlpBootstrapTotalChapterCount} 章`
                  : hanlpCacheStatusLabel}
              </span>
            </div>
            {hanlpBootstrapPercent !== null ? (
              <>
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-zinc-300">
                  <span>章节进度</span>
                  <span className="text-violet-100">{hanlpBootstrapPercent}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-violet-300 transition-all"
                    style={{ width: `${Math.max(hanlpBootstrapPercent > 0 ? 8 : 0, Math.min(100, hanlpBootstrapPercent))}%` }}
                  />
                </div>
              </>
            ) : null}
            <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[10px] leading-4 text-zinc-400 sm:grid-cols-2">
              <span>
                完成章节：{typeof hanlpBootstrapCompletedChapterCount === 'number' && typeof hanlpBootstrapTotalChapterCount === 'number'
                  ? `${hanlpBootstrapCompletedChapterCount} / ${hanlpBootstrapTotalChapterCount}`
                  : '等待进度'}
              </span>
              <span>缓存命中率：{hanlpBootstrapCacheHitRatePercent !== null ? `${hanlpBootstrapCacheHitRatePercent}%` : '等待进度'}</span>
              <span>当前阶段：{hanlpBootstrapPhaseLabel}</span>
              <span>预估剩余：{hanlpBootstrapEtaLabel}</span>
              <span>阶段耗时：{hanlpBootstrapTimingLabel ?? '等待进度'}</span>
            </div>
            {hanlpSettingsLine ? (
              <p className="mt-1 truncate text-[10px] leading-4 text-zinc-500">{hanlpSettingsLine}</p>
            ) : null}
          </div>
          <div className="mt-3 rounded-xl border border-violet-300/15 bg-violet-500/[0.08] px-3 py-3" data-testid="workspace-raw-embedding-card">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-medium text-violet-100">原文 Embedding 预计算</p>
                <p className="mt-1 text-[10px] leading-4 text-violet-100/75">{rawTextEmbeddingStatusLine}</p>
              </div>
              <span className="rounded-full border border-violet-300/20 bg-black/20 px-2.5 py-1 text-[10px] text-violet-100/85">
                {rawTextEmbeddingPhaseBadge}
              </span>
            </div>
            {rawTextEmbeddingPercent !== null ? (
              <>
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-zinc-300">
                  <span>缓存预热进度</span>
                  <span className="text-violet-100">{rawTextEmbeddingPercent}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-violet-300 transition-all"
                    style={{ width: `${Math.max(rawTextEmbeddingPercent > 0 ? 8 : 0, Math.min(100, rawTextEmbeddingPercent))}%` }}
                  />
                </div>
              </>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] leading-4 text-zinc-400">
              <span>
                缓存命中率：{rawTextEmbeddingCacheHitRatePercent !== null ? `${rawTextEmbeddingCacheHitRatePercent}%` : '暂未返回'}
              </span>
              {rawTextEmbeddingTimingLabel ? <span>阶段耗时：{rawTextEmbeddingTimingLabel}</span> : null}
            </div>
            {rawTextEmbeddingSettingsLine ? (
              <p className="mt-1 truncate text-[10px] leading-4 text-zinc-500">{rawTextEmbeddingSettingsLine}</p>
            ) : null}
          </div>
          {knowledgeRebuildSteps.length > 0 ? (
            <div className="mt-3 space-y-2">
              {knowledgeRebuildSteps.map((step) => {
                const stepProgress = toProgressPercent(step.progress)
                const displayStatus = resolveKnowledgeStepDisplayStatus({
                  step,
                  isCurrentRunningStep: currentKnowledgeRunningStepKey === step.key,
                })
                const isActive = displayStatus === 'running' || displayStatus === 'paused'

                return (
                  <div key={step.key} className="rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-zinc-200">{step.label}</span>
                      <span className="text-zinc-500">{KNOWLEDGE_STEP_STATUS_LABELS[displayStatus]}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          displayStatus === 'completed'
                            ? 'bg-emerald-400'
                            : isActive
                              ? 'bg-violet-400'
                              : 'bg-white/20'
                        )}
                        style={{ width: `${displayStatus === 'pending' ? 0 : Math.max(isActive ? 8 : 0, stepProgress)}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] leading-4 text-zinc-500">
                      <span className="truncate">{step.detail ?? `${stepProgress}%`}</span>
                      <span>{displayStatus === 'running' && step.etaMinutes ? `约 ${step.etaMinutes} 分钟` : displayStatus === 'paused' ? '已暂停' : `${stepProgress}%`}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : null}
          <div className={cn('mt-3 grid gap-2', knowledgeRebuildFailed ? 'grid-cols-1' : 'grid-cols-2')}>
            {knowledgeRebuildPaused || knowledgeRebuildFailed ? (
              <button
                onClick={() => {
                  void handleRebuildKnowledge()
                }}
                disabled={Boolean(knowledgeActionLoading) || knowledgeRebuilding}
                className={cn(
                  'rounded-xl px-3 py-2 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
                  knowledgeRebuildFailed
                    ? 'border border-rose-300/30 bg-rose-500/15 text-rose-50 hover:bg-rose-500/25'
                    : 'border border-violet-400/30 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25'
                )}
              >
                {knowledgeRebuilding ? (knowledgeRebuildFailed ? '重新发起中…' : '继续中…') : knowledgeRebuildFailed ? '重新重建' : '继续重建'}
              </button>
            ) : (
              <button
                onClick={() => {
                  void handlePauseKnowledge()
                }}
                disabled={!knowledgeRebuildActive || Boolean(knowledgeActionLoading)}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-zinc-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {knowledgeActionLoading === 'pause' ? '暂停中…' : '暂停重建'}
              </button>
            )}
            {knowledgeRebuildFailed ? null : (
              <button
                onClick={() => {
                  void handleAbortKnowledge()
                }}
                disabled={Boolean(knowledgeActionLoading)}
                className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {knowledgeActionLoading === 'abort' ? '终止中…' : '终止当前任务'}
              </button>
            )}
          </div>
        </div>
      ) : null}
      <div className="mt-3 rounded-2xl border border-sky-400/15 bg-sky-500/[0.06] px-3 py-3 text-xs text-zinc-300" data-testid="workspace-hanlp-cache-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-sky-200/70">HanLP cache</p>
            <p className="mt-1 leading-5 text-zinc-300">当前状态：{hanlpCacheStatusLabel}</p>
            <p className="mt-1 leading-5 text-zinc-400">{hanlpCacheDeleteState.helperText}</p>
          </div>
          <button
            onClick={() => setConfirmDeleteHanlpCache((current) => !current)}
            disabled={hanlpCacheDeleteState.disabled}
            data-testid="workspace-delete-hanlp-cache"
            aria-label="删除 HanLP 缓存"
            className="rounded-full border border-sky-400/20 bg-black/20 px-3 py-1.5 text-[11px] text-sky-100 transition hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            删除 HanLP 缓存
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] leading-4 text-zinc-400">
          <span>缓存状态：{hanlpCacheStatusLabel}</span>
          <span>命中率：{hanlpBootstrapCacheHitRatePercent !== null ? `${hanlpBootstrapCacheHitRatePercent}%` : '等待进度'}</span>
          <span>阶段耗时：{hanlpBootstrapTimingLabel ?? '等待进度'}</span>
        </div>
        {hanlpSettingsLine ? (
          <p className="mt-1 truncate text-[10px] leading-4 text-zinc-500">{hanlpSettingsLine}</p>
        ) : null}
        {confirmDeleteHanlpCache ? (
          <div className="mt-3 rounded-xl border border-sky-400/15 bg-black/20 p-3">
            <p className="text-[11px] leading-5 text-sky-100">请再次确认：这会删除当前小说主分支的 HanLP Bootstrap 缓存与聚合结果，下次重建时会重新扫描章节。</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  void handleDeleteHanlpCache()
                }}
                disabled={hanlpCacheDeleteState.disabled}
                className="flex-1 rounded-xl border border-sky-400/20 bg-sky-500/15 px-3 py-2 text-[11px] text-sky-100 transition hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {knowledgeActionLoading === 'delete-hanlp-cache' ? '删除中…' : '确认删除 HanLP 缓存'}
              </button>
              <button
                onClick={() => setConfirmDeleteHanlpCache(false)}
                disabled={knowledgeActionLoading === 'delete-hanlp-cache'}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-zinc-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="mt-3 rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.06] px-3 py-3 text-xs text-zinc-300">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">LLM extraction cache</p>
            <p className="mt-1 leading-5 text-zinc-300">用于章节抽取阶段的中间缓存。</p>
            <p className="mt-1 leading-5 text-zinc-400">{extractionCacheDeleteState.helperText}</p>
          </div>
          <button
            onClick={() => setConfirmDeleteExtractionCache((current) => !current)}
            disabled={extractionCacheDeleteState.disabled}
            data-testid="workspace-delete-extraction-cache"
            aria-label="删除 LLM 抽取缓存"
            className="rounded-full border border-emerald-400/20 bg-black/20 px-3 py-1.5 text-[11px] text-emerald-100 transition hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            删除 LLM 抽取缓存
          </button>
        </div>
        <div className="mt-2 text-[10px] leading-4 text-zinc-400">
          删除后，下次知识重建会重新请求当前小说主分支的抽取结果。
        </div>
        {confirmDeleteExtractionCache ? (
          <div className="mt-3 rounded-xl border border-emerald-400/15 bg-black/20 p-3">
            <p className="text-[11px] leading-5 text-emerald-100">请再次确认：这会删除当前小说主分支的 LLM 抽取缓存，下次重建时会重新发起章节抽取。</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  void handleDeleteExtractionCache()
                }}
                disabled={extractionCacheDeleteState.disabled}
                className="flex-1 rounded-xl border border-emerald-400/20 bg-emerald-500/15 px-3 py-2 text-[11px] text-emerald-100 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {knowledgeActionLoading === 'delete-extraction-cache' ? '删除中…' : '确认删除 LLM 抽取缓存'}
              </button>
              <button
                onClick={() => setConfirmDeleteExtractionCache(false)}
                disabled={knowledgeActionLoading === 'delete-extraction-cache'}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-zinc-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="mt-3 rounded-2xl border border-amber-400/15 bg-amber-500/[0.06] px-3 py-3 text-xs text-zinc-300">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-amber-200/70">Raw embedding cache</p>
            <p className="mt-1 leading-5 text-zinc-300">当前状态：{rawTextEmbeddingPercent !== null ? `${rawTextEmbeddingPercent}%` : '等待进度'}</p>
            <p className="mt-1 leading-5 text-zinc-400">{embeddingCacheDeleteState.helperText}</p>
          </div>
          <button
            onClick={() => setConfirmDeleteEmbeddingCache((current) => !current)}
            disabled={embeddingCacheDeleteState.disabled}
            data-testid="workspace-delete-embedding-cache"
            aria-label="删除原文 Embedding 缓存"
            className="rounded-full border border-amber-400/20 bg-black/20 px-3 py-1.5 text-[11px] text-amber-100 transition hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            删除原文 Embedding 缓存
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] leading-4 text-zinc-400">
          <span>预热进度：{rawTextEmbeddingPercent !== null ? `${rawTextEmbeddingPercent}%` : '等待进度'}</span>
          <span>命中率：{rawTextEmbeddingCacheHitRatePercent !== null ? `${rawTextEmbeddingCacheHitRatePercent}%` : '暂未返回'}</span>
          <span>阶段耗时：{rawTextEmbeddingTimingLabel ?? '等待进度'}</span>
        </div>
        {rawTextEmbeddingSettingsLine ? (
          <p className="mt-1 truncate text-[10px] leading-4 text-zinc-500">{rawTextEmbeddingSettingsLine}</p>
        ) : null}
        {confirmDeleteEmbeddingCache ? (
          <div className="mt-3 rounded-xl border border-amber-400/15 bg-black/20 p-3">
            <p className="text-[11px] leading-5 text-amber-100">请再次确认：这会删除当前小说主分支的原文 Embedding 缓存，下次重建时会重新预热向量结果。</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  void handleDeleteEmbeddingCache()
                }}
                disabled={embeddingCacheDeleteState.disabled}
                className="flex-1 rounded-xl border border-amber-400/20 bg-amber-500/15 px-3 py-2 text-[11px] text-amber-100 transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {knowledgeActionLoading === 'delete-embedding-cache' ? '删除中…' : '确认删除原文 Embedding 缓存'}
              </button>
              <button
                onClick={() => setConfirmDeleteEmbeddingCache(false)}
                disabled={knowledgeActionLoading === 'delete-embedding-cache'}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-zinc-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="mt-3 rounded-2xl border border-rose-400/15 bg-rose-500/[0.06] px-3 py-3 text-xs text-zinc-300">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-rose-200/70">Danger zone</p>
            <p className="mt-1 leading-5 text-zinc-400">只清空当前小说在 SQLite 中投影出的知识图谱数据，不会删除正文章节。</p>
          </div>
          <button
            onClick={() => setConfirmDeleteKnowledge((current) => !current)}
            disabled={knowledgeActionLoading === 'delete'}
            className="rounded-full border border-rose-400/20 bg-black/20 px-3 py-1.5 text-[11px] text-rose-100 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            删除知识图谱
          </button>
        </div>
        {confirmDeleteKnowledge ? (
          <div className="mt-3 rounded-xl border border-rose-400/15 bg-black/20 p-3">
            <p className="text-[11px] leading-5 text-rose-100">请再次确认：这会清空当前小说的人物、关系、设定、时间线与章节态知识投影数据。</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  void handleDeleteKnowledgeGraph()
                }}
                disabled={Boolean(knowledgeActionLoading)}
                className="flex-1 rounded-xl border border-rose-400/20 bg-rose-500/15 px-3 py-2 text-[11px] text-rose-100 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {knowledgeActionLoading === 'delete' ? '删除中…' : '确认删除当前小说知识图谱'}
              </button>
              <button
                onClick={() => setConfirmDeleteKnowledge(false)}
                disabled={knowledgeActionLoading === 'delete'}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-zinc-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <p className="mt-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-xs leading-5 text-zinc-400">
        右侧内容现在来自 SQLite 知识库投影，当前阶段先保持只读，避免把本地临时编辑误认为已写回 authoritative KB。
      </p>
    </div>
  )

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(129,140,248,0.12),_transparent_30%),#0a0c12] text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-[1720px] flex-col px-3 pb-10 pt-3 sm:px-5 lg:px-6">
        <header className="sticky top-0 z-30 mb-4 rounded-[28px] border border-white/10 bg-[#0d1017]/92 px-4 py-3 shadow-[0_20px_70px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link href="/library" className="rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-zinc-300 transition hover:bg-white/[0.08]">
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <button
                onClick={() => setLeftPanelOpen((current) => !current)}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.08] lg:hidden"
              >
                章节
              </button>
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Selection-first novel flow</p>
                <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-100">{workspaceHeaderTitle}</h1>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5" data-testid="workspace-current-word-count">{currentNodeMetrics.wordCount.toLocaleString()} 字</span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5" data-testid="workspace-current-input-tokens">输入 {currentNodeMetrics.inputTokens?.toLocaleString() ?? '—'} tokens</span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5" data-testid="workspace-current-output-tokens">输出 {currentNodeMetrics.outputTokens?.toLocaleString() ?? '—'} tokens</span>
              <button
                onClick={() => {
                  void handleDeleteNovel()
                }}
                className="inline-flex items-center gap-2 rounded-full border border-rose-400/20 bg-rose-500/10 px-3 py-1.5 text-rose-100 transition hover:bg-rose-500/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除小说
              </button>
              <button
                type="button"
                data-testid="preset-compat-library-open"
                onClick={() => {
                  setPresetCompatLibraryOpen(true)
                  void loadPresetCompatLibrary().catch(() => undefined)
                }}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 transition hover:bg-white/[0.08]"
              >
                <ScrollText className="h-3.5 w-3.5" />
                预设
              </button>
              <button
                onClick={() => setSettingsOpen(true)}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 transition hover:bg-white/[0.08]"
              >
                <Settings2 className="h-3.5 w-3.5" />
                {providerLabel}
              </button>
            </div>
          </div>
        </header>

        <div className="grid flex-1 gap-4 lg:grid-cols-[264px_minmax(0,1.28fr)_376px] 2xl:grid-cols-[280px_minmax(0,1.32fr)_392px]">
          <div className={cn(mobileRoleplayFocus && 'order-2 lg:order-none')}>
            <WorkspaceChapterNav
            leftPanelOpen={leftPanelOpen}
            onClose={() => setLeftPanelOpen(false)}
            onCreateChapter={() => {
              createNewChapter()
              setLeftPanelOpen(false)
            }}
            novelVolumes={novelVolumes}
            sortedChapters={sortedChapters}
            chapterListTarget={chapterListTarget}
            currentNovelId={currentNovelId}
            setChapterListState={setChapterListState}
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
          </div>

          <div className={cn('min-w-0', mobileRoleplayFocus && 'order-1')}>
            <WorkspaceCenterPane
            selection={activeWorkspaceSelection}
            chapterTitle={currentChapter.title}
            centerPaneView={centerPaneView}
            onCenterPaneViewChange={setCenterPaneView}
            chapterSelectionSummary={chapterSelectionSummary}
            chapterGraphSummary={chapterGraphSummary}
            branchReadableLabel={selectedTimelineDisplayLabel || null}
            branchInstructionText={selectedTimelineInstructionText || null}
            chapterBodyView={
              <div className="px-4 py-4 sm:px-7 sm:py-6" data-testid="workspace-chapter-body-view">
                <div className="min-h-[62vh] rounded-[28px] border border-white/8 bg-[#0b0d12] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                  <EditorContent editor={editor} />
                </div>
              </div>
            }
            chapterGraphView={
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
            }
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

          <div className={cn('min-w-0', mobileRoleplayFocus && 'order-3')}>
            <WorkspaceReferencePanel
            selection={activeWorkspaceSelection}
            selectionActions={selectionActions}
            knowledgeControls={knowledgeControls}
            references={(
              <>

            <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
              <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">人物 {currentNovelVisibleCharacterCount}</div>
              <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">组织 {currentNovelWorldEntryGroups.organizations.length}</div>
              <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">地点 {currentNovelWorldEntryGroups.locations.length}</div>
              <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">世界设定 {currentNovelWorldEntryGroups.worldbuilding.length}</div>
              <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">时间线 {currentNovelTimelineEvents.length}</div>
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

            <div className="overflow-y-auto max-h-[calc(100vh-28rem)] space-y-2">
              {refTab === 'characters' && (
                <>
                  {currentNovelVisibleCharacterCount === 0 && (
                    <p className="text-xs text-zinc-500 text-center py-4">暂无人物投影，重建知识视图后会显示。</p>
                  )}
                  {currentNovelCharactersSorted.map((char) => {
                     const isEditing = editState.type === 'char' && editState.id === char.id
                     const ef = editState.form
                     const setF = (key: string, val: string) => setEditState((s) => ({ ...s, form: { ...s.form, [key]: val } }))
                     return (
                       <div key={char.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                        {isEditing ? (
                          <>
                            <input value={ef.name ?? ''} onChange={(e) => setF('name', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="姓名" />
                            <input value={ef.role ?? ''} onChange={(e) => setF('role', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="角色" />
                            <input value={ef.goal ?? ''} onChange={(e) => setF('goal', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="目标" />
                            <input value={ef.trait ?? ''} onChange={(e) => setF('trait', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="性格" />
                            <textarea value={ef.note ?? ''} onChange={(e) => setF('note', e.target.value)} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="备注" />
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => {
                                useNovelStore.getState().updateCharacter(char.id, { name: ef.name ?? '', role: ef.role ?? '', goal: ef.goal ?? '', trait: ef.trait ?? '', note: ef.note ?? '' })
                                setEditState({ type: null, id: null, form: {} })
                              }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">保存</button>
                              <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">取消</button>
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
                      <Plus className="h-3.5 w-3.5 inline mr-1" /> 添加人物
                    </button>
                  ) : null}
                  {!knowledgePanelReadOnly && editState.type === 'char' && editState.id === '__new__' && (
                    <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                      <input value={editState.form.name ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, name: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="姓名" />
                      <input value={editState.form.role ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, role: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="角色" />
                      <input value={editState.form.goal ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, goal: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="目标" />
                      <input value={editState.form.trait ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, trait: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="性格" />
                      <textarea value={editState.form.note ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, note: e.target.value } }))} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="备注" />
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => {
                          useNovelStore.getState().addCharacter(currentNovelId, { name: editState.form.name ?? '', role: editState.form.role ?? '', goal: editState.form.goal ?? '', trait: editState.form.trait ?? '', note: editState.form.note ?? '' })
                          setEditState({ type: null, id: null, form: {} })
                        }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">创建</button>
                        <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">取消</button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {refTab === 'outline' && (
                <>
                  {currentNovelOutlines.length === 0 && (
                    <p className="text-xs text-zinc-500 text-center py-4">暂无大纲投影，重建知识视图后会显示。</p>
                  )}
                  {currentNovelOutlines.map((item) => {
                    const isEditing = editState.type === 'outline' && editState.id === item.id
                    const ef = editState.form
                    const setF = (key: string, val: string) => setEditState((s) => ({ ...s, form: { ...s.form, [key]: val } }))
                    return (
                      <div key={item.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                        {isEditing ? (
                          <>
                            <input value={ef.title ?? ''} onChange={(e) => setF('title', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="标题" />
                            <select value={ef.type ?? 'main'} onChange={(e) => setF('type', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none">
                              <option value="main">主线</option>
                              <option value="side">支线</option>
                              <option value="foreshadow">伏笔</option>
                              <option value="conflict">冲突</option>
                              <option value="climax">高潮</option>
                            </select>
                            <textarea value={ef.summary ?? ''} onChange={(e) => setF('summary', e.target.value)} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="摘要" />
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => {
                                useNovelStore.getState().updateOutlineItem(item.id, { title: ef.title ?? '', type: (ef.type ?? 'main') as OutlineType, summary: ef.summary ?? '' })
                                setEditState({ type: null, id: null, form: {} })
                              }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">保存</button>
                              <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">取消</button>
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
                      <Plus className="h-3.5 w-3.5 inline mr-1" /> 添加大纲条目
                    </button>
                  ) : null}
                  {!knowledgePanelReadOnly && editState.type === 'outline' && editState.id === '__new__' && (
                    <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                      <input value={editState.form.title ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, title: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="标题" />
                      <select value={editState.form.type ?? 'main'} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, type: e.target.value } }))} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none">
                        <option value="main">主线</option>
                        <option value="side">支线</option>
                        <option value="foreshadow">伏笔</option>
                        <option value="conflict">冲突</option>
                        <option value="climax">高潮</option>
                      </select>
                      <textarea value={editState.form.summary ?? ''} onChange={(e) => setEditState((s) => ({ ...s, form: { ...s.form, summary: e.target.value } }))} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="摘要" />
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => {
                          useNovelStore.getState().addOutlineItem(currentNovelId, { title: editState.form.title ?? '', type: (editState.form.type ?? 'main') as OutlineType, summary: editState.form.summary ?? '' })
                          setEditState({ type: null, id: null, form: {} })
                        }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">创建</button>
                        <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">取消</button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {renderWorldEntriesPanel('organizations', currentNovelWorldEntryGroups.organizations, '暂无组织投影，重建知识视图后会显示。', '添加组织条目', 'organization')}

              {renderWorldEntriesPanel('locations', currentNovelWorldEntryGroups.locations, '暂无地点投影，重建知识视图后会显示。', '添加地点条目', 'location')}

              {renderWorldEntriesPanel('worldbuilding', currentNovelWorldEntryGroups.worldbuilding, '暂无世界设定投影，重建知识视图后会显示。', '添加世界设定条目', 'scene')}

              {refTab === 'timeline' && (
                <>
                  {currentNovelTimelineEvents.length === 0 && (
                    <p className="text-xs text-zinc-500 text-center py-4">暂无时间线投影，重建知识视图后会显示。</p>
                  )}
                  {currentNovelTimelineEvents.map((event) => {
                    const isEditing = editState.type === 'timeline' && editState.id === event.id
                    const ef = editState.form
                    const setF = (key: string, val: string) => setEditState((s) => ({ ...s, form: { ...s.form, [key]: val } }))
                    return (
                      <div key={event.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                        {isEditing ? (
                          <>
                            <input value={ef.title ?? event.title} onChange={(e) => setF('title', e.target.value)} className="w-full mb-2 rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="事件标题" />
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <input value={ef.phase ?? event.phase} onChange={(e) => setF('phase', e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="阶段" />
                              <input value={ef.worldline ?? event.worldline} onChange={(e) => setF('worldline', e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="世界线" />
                            </div>
                            <textarea value={ef.summary ?? event.summary} onChange={(e) => setF('summary', e.target.value)} className="w-full min-h-[60px] rounded-xl border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm text-zinc-100 outline-none" placeholder="事件摘要" />
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => {
                                useNovelStore.getState().updateTimelineEvent(event.id, {
                                  title: ef.title ?? event.title,
                                  phase: ef.phase ?? event.phase,
                                  worldline: ef.worldline ?? event.worldline,
                                  summary: ef.summary ?? event.summary,
                                })
                                setEditState({ type: null, id: null, form: {} })
                              }} className="flex-1 rounded-xl bg-emerald-500/20 text-emerald-200 px-3 py-1.5 text-xs">保存</button>
                              <button onClick={() => setEditState({ type: null, id: null, form: {} })} className="flex-1 rounded-xl border border-white/10 text-zinc-400 px-3 py-1.5 text-xs">取消</button>
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
                        title: '新事件',
                        phase: '待定阶段',
                        worldline: '主线',
                        summary: '',
                        order: currentNovelTimelineEvents.length + 1,
                        chapterIds: currentChapter ? [currentChapter.id] : [],
                      })}
                      className="w-full rounded-2xl border border-dashed border-white/10 px-3 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
                    >
                      <Plus className="h-3.5 w-3.5 inline mr-1" /> 添加时间线事件
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
        <div className="fixed right-4 top-4 z-[80] rounded-2xl border border-emerald-400/20 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-100 shadow-[0_12px_50px_rgba(0,0,0,0.35)]">
          {toast}
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" onClick={() => setSettingsOpen(false)}>
          <div className="absolute inset-x-0 top-[8vh] mx-auto max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-[32px] border border-white/10 bg-[#0d1017] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.5)]" onClick={(event) => event.stopPropagation()}>
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">AI settings</p>
                <h3 className="mt-1 text-xl font-semibold text-zinc-100">模型服务配置</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">这里会分别配置改写、知识抽取和 embeddings 三个场景，各自保存 provider、连接信息与模型。</p>
              </div>
              <button onClick={() => setSettingsOpen(false)} className="rounded-2xl border border-white/10 p-2 text-zinc-300 hover:bg-white/[0.06]"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-6">
              {(Object.keys(AI_SCENARIO_META) as AIScenarioKey[]).map((scenario) => {
                const meta = AI_SCENARIO_META[scenario]
                const scenarioSettings = resolvedAISettings[scenario]
                const scenarioStatus = scenarioStatusLabels.find((label) => label.startsWith(meta.shortLabel)) ?? ''

                return (
                  <div key={scenario} className="rounded-[24px] border border-white/10 bg-[#0b0d12] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="max-w-2xl">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{meta.eyebrow}</p>
                        <h4 className="mt-2 text-sm font-medium text-zinc-100">{meta.title}</h4>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{meta.description}</p>
                      </div>
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-300">
                        {scenarioStatus}
                      </span>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {([
                        ['openai-compatible', 'OpenAI-compatible API'],
                        ['ollama', 'Ollama'],
                      ] as Array<[AIProvider, string]>).map(([provider, label]) => {
                        const active = scenarioSettings.provider === provider
                        return (
                          <button
                            key={provider}
                            type="button"
                            onClick={() => updateScenarioProvider(scenario, provider)}
                            className={cn(
                              'rounded-full border px-3 py-2 text-xs transition',
                              active
                                ? 'border-violet-300/30 bg-violet-500/15 text-violet-100'
                                : 'border-white/10 bg-black/20 text-zinc-300 hover:bg-white/[0.06]'
                            )}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>

                     {scenarioSettings.provider === 'openai-compatible'
                       ? renderOpenAICompatibleFields(scenario)
                       : renderOllamaFields(scenario)}

                    {scenario === 'embeddings' ? (
                      <div className="mt-4 rounded-[22px] border border-white/8 bg-black/20 p-4">
                        <label className="block">
                          <span className="mb-2 block text-sm text-zinc-300">Embedding 批处理数量</span>
                          <input
                            type="number"
                            min={1}
                            max={128}
                            value={resolvedAISettings.embeddings.embeddingBatchSize}
                            onChange={(event) => updateEmbeddingBatchSize(event.target.value)}
                            className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
                          />
                          <p className="mt-2 text-xs leading-5 text-zinc-500">默认 16；16GB Mac 推荐优先从 16 或 32 开始，避免本地 embedding 时占用过高内存。</p>
                        </label>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>

            <div className="mt-6 flex items-center justify-between gap-3">
              <p className="text-sm text-zinc-500">当前状态：{scenarioStatusLabels.join(' / ')}</p>
              <div className="flex gap-2">
                <button onClick={() => setSettingsOpen(false)} className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-zinc-300 hover:bg-white/[0.06]">取消</button>
                <button onClick={saveSettings} className="rounded-2xl bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400">保存设置</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <PresetCompatLibraryModal
        activeSurfaceId={activeMode ? toPresetCompatSessionSurfaceId(activeMode) : null}
        activeSelection={activeWorkspaceSelection}
        open={presetCompatLibraryOpen}
        onClose={() => setPresetCompatLibraryOpen(false)}
      />

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
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm" data-testid="workspace-action-overlay" onClick={closePanel}>
          <div className="absolute inset-x-0 bottom-0 mx-auto max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-t-[32px] border border-white/10 bg-[#0d1017] p-4 shadow-[0_-20px_80px_rgba(0,0,0,0.5)] sm:bottom-6 sm:rounded-[32px] sm:p-5" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Selected text</p>
                <h3 className="mt-1 text-xl font-semibold text-zinc-100">{ACTION_META[activeMode].title}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{ACTION_META[activeMode].description}</p>
              </div>
              <button onClick={closePanel} className="rounded-2xl border border-white/10 p-2 text-zinc-300 hover:bg-white/[0.06]"><X className="h-4 w-4" /></button>
            </div>

            <div className="mb-4 rounded-[24px] border border-white/8 bg-black/20 p-4">
              <p className="mb-2 text-xs uppercase tracking-[0.16em] text-zinc-500">选中片段</p>
              <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-300">{lockedSelectionText || selectionText}</p>
            </div>

            {contextPreviewLoading && !generationContext ? (
              <div className="mb-4 rounded-[24px] border border-white/8 bg-black/20 p-4 text-sm text-zinc-400">正在装配图谱上下文与证据…</div>
            ) : null}

            {!contextPreviewLoading && !generationContext && contextPreviewError ? (
              <div className="mb-4 rounded-[24px] border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-200">{contextPreviewError}</div>
            ) : null}

            {activeMode === 'rewrite' ? (
              <div className="space-y-4">
                <div className="rounded-[26px] border border-violet-400/20 bg-violet-500/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-violet-200/70">魔改工作台</p>
                      <p className="mt-1 text-sm text-zinc-300">
                        {rewriteLaunchSource === 'future_jump'
                          ? '当前是从已持久化的 Future Jump 最新版本继续改写：生成时走 rewrite，保存时会落成当前 Future Jump 节点下的子续写块，不会默认开放主线正文替换。'
                          : rewriteLaunchSource === 'continue_block'
                            ? '当前是从已持久化的续写块 reader 重新打开改写：保存时会按续写 / 重生语义写回时间线。'
                          : '先描述你想怎么改，再生成一个完整章节版本。'}
                      </p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-zinc-300">{rewriteFlow.provider || providerLabel}</span>
                  </div>
                </div>

                {rewriteLaunchSource === 'future_jump' ? (
                  <div className="rounded-[22px] border border-amber-300/18 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
                    这轮改写以最新 Future Jump 输出作为 source material 与初始候选，继续生成时只走 rewrite surface；保存结果会创建当前 Future Jump 节点下的子续写块，而不是新建 Future Jump run，也不会默认把结果直接写回当前主线章节。
                  </div>
                ) : null}

                <label className="block">
                  <span className="mb-2 block text-sm text-zinc-300">魔改要求</span>
                  <textarea value={rewritePrompt} onChange={(event) => setRewritePrompt(event.target.value)} className="h-28 w-full rounded-[24px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none" placeholder="例如：保留剧情走向，但把这段写得更压迫、更像命运在逼近。" />
                </label>

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
                        <p className="text-[11px] uppercase tracking-[0.18em] text-amber-200/70">高级上下文</p>
                        <p className="mt-1 text-sm text-zinc-200">默认收起的图谱/人物/关系覆写面板。展开后会直接显示当前自动选出的上下文，而不是空白配置。</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-400">
                          <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1">种子人物 {activeSeedEntityCount}</span>
                          <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1">关系 {activeGraphEdgeCount}</span>
                          <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1">证据 {activeEvidenceCount}</span>
                          <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1">Prompt 块 {activePromptBlockCount}</span>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-zinc-300">
                        {contextPanelOpen ? '收起' : '展开'}
                        <ChevronDown className={cn('h-4 w-4 transition', contextPanelOpen && 'rotate-180')} />
                      </span>
                    </button>

                    {contextPanelOpen ? (
                      <div className="pt-3" data-testid="workspace-context-panel">
                        <GraphReviewPanel
                          context={{ ...generationContext, graphContext: activeGraphContext }}
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
                    {rewriteFlow.loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} 生成版本
                  </button>
                  <button onClick={handleSaveContinueBlock} disabled={!selectedRewriteCandidate || saveContinueBlockPending} className="rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/10 px-4 py-3 text-sm text-fuchsia-100 transition hover:bg-fuchsia-500/20 disabled:opacity-40">
                    {saveContinueBlockPending ? <span className="inline-flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin" /> 保存中</span> : '保存为续写块'}
                  </button>
                  <button onClick={handleCreateWhatIf} disabled={!selectedRewriteCandidate || saveContinueBlockPending} className="rounded-2xl border border-violet-400/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-100 transition hover:bg-violet-500/20 disabled:opacity-40">
                    创建 What-if
                  </button>
                  <button onClick={() => selectedRewriteCandidate && applyFullChapter(selectedRewriteCandidate.content)} disabled={!selectedRewriteCandidate || rewriteLaunchSource === 'future_jump'} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-40">
                    {rewriteLaunchSource === 'future_jump' ? '默认不替换正文' : '替换正文'}
                  </button>
                  <button onClick={() => selectedRewriteCandidate && copyText('rewrite', selectedRewriteCandidate.content)} disabled={!selectedRewriteCandidate} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-40">
                    {copied === 'rewrite' ? <span className="inline-flex items-center gap-2"><Check className="h-4 w-4" /> 已复制</span> : '复制结果'}
                  </button>
                  <button onClick={() => selectedRewriteCandidate && setRewritePrompt((current) => `${current}\n\n继续在当前版本的基础上增强张力和戏剧性，但保持逻辑自洽。`)} disabled={!selectedRewriteCandidate} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-40">
                    继续魔改
                  </button>
                </div>

                {saveContinueBlockError ? <p data-testid="continue-block-save-error" className="text-sm text-rose-300">{saveContinueBlockError}</p> : null}
                {rewriteFlow.error ? <p className="text-sm text-rose-300">{rewriteFlow.error}</p> : null}

                <div className="grid gap-3 lg:grid-cols-[0.9fr_1.4fr]">
                  <div className="space-y-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">生成版本</p>
                    {rewriteFlow.loading ? (
                      <div className="rounded-[24px] border border-white/8 bg-black/20 p-4 text-sm text-zinc-400">
                        {rewriteFlow.jobCurrentStep?.trim() || '正在生成版本…'}
                      </div>
                    ) : selectedRewriteCandidate ? (
                      <div className="w-full rounded-[24px] border border-violet-400/30 bg-violet-500/12 px-4 py-4 text-left">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-zinc-100">{selectedRewriteCandidate.title}</p>
                          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">已生成</span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-400">{selectedRewriteCandidate.summary}</p>
                        <p className="mt-3 line-clamp-4 text-xs leading-6 text-zinc-500">{selectedRewriteCandidate.content}</p>
                      </div>
                    ) : (
                      <div className="rounded-[24px] border border-white/8 bg-black/20 p-4 text-sm text-zinc-400">生成后会在这里显示最新版本。</div>
                    )}
                  </div>

                  <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">预览结果</p>
                      {selectedRewriteCandidate ? <span className="text-xs text-zinc-500">{selectedRewriteCandidate.title}</span> : null}
                    </div>
                    <p className="min-h-72 whitespace-pre-wrap text-sm leading-7 text-zinc-300">{selectedRewriteCandidate?.content || rewriteState.result || '选择文本并生成后，完整章节版本会显示在这里。'}</p>
                  </div>
                </div>
              </div>
            ) : null}

          </div>
        </div>
      ) : null}
    </main>
  )
}
