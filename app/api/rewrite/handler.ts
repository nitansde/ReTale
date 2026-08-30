import { after, NextResponse } from 'next/server'
import { noStoreJson } from '@/lib/server/api-route'
import { buildGenerationContext } from '@/lib/server/context-builder'
import { loadGenerationContextSnapshot } from '@/lib/server/generation-context-snapshot'
import { loadStoredAISettings } from '@/lib/server/ai-settings'
import { createNovelDatabaseAccess, runWithNovelDatabaseAccess } from '@/lib/server/database-access'
import { applyPresetCompatCreativeRuntime } from '@/lib/preset-compat/apply-runtime'
import {
  deserializePresetCompatResponseMetadata,
  resolveCreativeRoutePresetCompatMetadata,
  serializePresetCompatResponseMetadata,
} from '@/lib/preset-compat/runtime-integration'
import { bufferAndTransformTextStream } from '@/lib/preset-compat/stream-buffer'
import {
  generateRewriteWithOpenAICompatible,
  streamRewriteWithOpenAICompatible,
} from '@/lib/server/openai-compatible'
import { writeLlmDebugLog } from '@/lib/server/llm-debug-log'
import { generateRewriteWithOllama, streamRewriteWithOllama } from '@/lib/server/ollama-local'
import {
  abortRecoverableRewriteJob,
  claimRecoverableRewriteJob,
  clearRecoverableRewriteAbortController,
  createRecoverableRewriteAbortController,
  isRecoverableRewriteJobAborted,
  isRecoverableRewriteJobRestorable,
  normalizeRecoverableRewriteJobPayload,
  RECOVERABLE_REWRITE_JOB_TYPE,
  readRecoverableRewriteJob,
  runRecoverableRewriteJobWithAttempt,
  serializeRecoverableRewriteJob,
  type RecoverableRewriteJobPayload,
  type RecoverableRewriteJobRow,
  updateRecoverableRewriteJob,
} from '@/lib/server/recoverable-rewrite-jobs'
import { safeParseJsonObject } from '@/lib/server/json-parse'
import { buildRewriteTaskPromptLines, CONTINUATION_SOURCE_BLOCK_LABEL, isContinuationRewriteTask } from '@/lib/server/rewrite-task-prompt'
import { reconcileKnowledgeJobWatchdog } from '@/lib/server/knowledge-job-watchdog'
import { uid } from '@/lib/utils'
import type { PresetCompatPromptRuleRuntimeContext, PresetCompatRuntimeContextBlock } from '@/lib/preset-compat/types'
import type { GenerationContextBlock, RoleplayContextMessage } from '@/lib/server/context-builder'
import { PRODUCT_SURFACE_IDS, type ProductSurfaceId } from '@/lib/types'
import { createWritingSkillRandomSeed } from '@/lib/server/writing-skill-distillation-agent'
import { resolveWritingSkillRuntimes } from '@/lib/server/writing-skill-runtime'
import type { WritingSkillRuntimeRecord } from '@/lib/writing-skill-types'
import {
  isWritingSkillPromptBlockId,
  normalizeWritingSkillCardIds,
  readWritingSkillCardIdFromPromptBlockId,
} from '@/lib/writing-skill-selection'

export const maxDuration = 3600

const INVALID_OPERATION_TYPE_ERROR = `Invalid operationType. Expected one of: ${PRODUCT_SURFACE_IDS.join(', ')}`
const PARTIAL_REWRITE_PERSIST_MIN_CHARS = 120
const PARTIAL_REWRITE_PERSIST_MIN_MS = 500
const MAX_PARTIAL_REWRITE_RESULT_CHARS = 200_000
const MAX_PRESET_COMPAT_RESPONSE_HEADER_BYTES = 16_000

function getNovelRouteDb(novelId: string) {
  return createNovelDatabaseAccess(novelId)
}

type RewriteResultPayload = {
  provider: string
  title: string
  summary: string
  content: string
  inputTokens: number | null
  outputTokens: number | null
  metadata: unknown
  presetCompat: unknown
}

type RewriteErrorCode = 'provider_not_configured' | 'provider_request_failed'

type RewriteErrorResponseBody = {
  ok: false
  error: string
  code: RewriteErrorCode
  provider: string
  guidance: string
  presetCompat: unknown
}

function mapSurfaceContextBlocks(promptBlocks: readonly GenerationContextBlock[] | null): PresetCompatRuntimeContextBlock[] {
  if (!promptBlocks) {
    return []
  }

  return promptBlocks.flatMap((block) => {
    const abstraction = block.id === 'worldbuilding'
      ? 'world_info'
      : block.id === 'characters'
        ? 'personality'
        : block.id === 'current-summary'
          || block.id === 'recent-summaries'
          || block.id === 'chapter-state'
          || block.id === 'authored-branch-context'
          || block.id === 'graph-context'
          || block.id === 'facts'
          || block.id === 'events'
            ? 'scenario'
            : null

    if (!abstraction) {
      return []
    }

    return [{
      id: block.id,
      label: block.label,
      content: block.content,
      abstraction,
    } satisfies PresetCompatRuntimeContextBlock]
  })
}

function normalizePresetCompatRuntimeContext(
  body: Record<string, unknown>,
  operationType: ProductSurfaceId,
  promptBlocks: readonly GenerationContextBlock[] | null
): PresetCompatPromptRuleRuntimeContext {
  const rawContext = body.presetCompatRuntimeContext
  const runtimeContext = rawContext && typeof rawContext === 'object' && !Array.isArray(rawContext)
    ? rawContext as Record<string, unknown>
    : {}
  const sessionPhase = typeof runtimeContext.sessionPhase === 'string'
    ? runtimeContext.sessionPhase
    : null
  const namedTranscript = runtimeContext.namedTranscript && typeof runtimeContext.namedTranscript === 'object' && !Array.isArray(runtimeContext.namedTranscript)
    ? runtimeContext.namedTranscript as Record<string, unknown>
    : null
  const explicitProtagonistName = typeof runtimeContext.protagonistName === 'string'
    ? runtimeContext.protagonistName.trim()
    : typeof runtimeContext.macroUserName === 'string'
      ? runtimeContext.macroUserName.trim()
      : ''

  return {
    sessionPhase: sessionPhase === 'new_chat'
      || sessionPhase === 'new_group_chat'
      || sessionPhase === 'new_example_chat'
      || sessionPhase === 'continue'
      ? sessionPhase
      : null,
    hasGroupContext: runtimeContext.hasGroupContext === true,
    hasExampleContext: runtimeContext.hasExampleContext === true,
    hasImpersonationContext: runtimeContext.hasImpersonationContext === true,
    supportsVirtualDepth: false,
    surfaceContextBlocks: mapSurfaceContextBlocks(promptBlocks),
    namedTranscript: namedTranscript
      ? {
          kind: namedTranscript.kind === 'roleplay' ? 'roleplay' : 'chat',
          userName: typeof namedTranscript.userName === 'string' ? namedTranscript.userName : null,
          assistantName: typeof namedTranscript.assistantName === 'string' ? namedTranscript.assistantName : null,
        }
      : null,
    protagonistName: explicitProtagonistName || inferProtagonistNameFromPromptBlocks(promptBlocks),
  }
}

function inferProtagonistNameFromPromptBlocks(promptBlocks: readonly GenerationContextBlock[] | null) {
  const charactersBlock = promptBlocks?.find((block) => block.id === 'characters')
  if (!charactersBlock) return null

  const match = charactersBlock.content.match(/^\s*-\s*([^｜|\n]+)[｜|]/m)
  const name = match?.[1]?.trim() ?? ''
  if (!name || name.startsWith('未命中')) return null
  return name
}

function parseJsonRecord(value: string | null) {
  return safeParseJsonObject(value)
}

function normalizeTokenValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeRewriteResultPayload(value: unknown): RewriteResultPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const content = typeof record.content === 'string' ? record.content.trim() : ''
  if (!content) return null

  return {
    provider: typeof record.provider === 'string' ? record.provider : '',
    title: typeof record.title === 'string' ? record.title : '生成版本',
    summary: typeof record.summary === 'string' ? record.summary : '已保存版本。',
    content,
    inputTokens: normalizeTokenValue(record.inputTokens),
    outputTokens: normalizeTokenValue(record.outputTokens),
    metadata: record.metadata ?? null,
    presetCompat: record.presetCompat ?? null,
  }
}


function buildPresetCompatResponseHeaders(serializedMetadata: string): Record<string, string> {
  if (Buffer.byteLength(serializedMetadata, 'utf8') <= MAX_PRESET_COMPAT_RESPONSE_HEADER_BYTES) {
    return { 'X-ReTale-Preset-Compat': serializedMetadata }
  }

  return { 'X-ReTale-Preset-Metadata-Omitted': 'size-limit' }
}

function buildRewriteSetupGuidance(provider: string) {
  return provider === 'ollama'
    ? 'Open AI Settings, choose an available Ollama rewrite model, and confirm the local Ollama server is reachable.'
    : 'Open AI Settings, configure the OpenAI-compatible rewrite base URL, API key, and model, then try again.'
}

function buildRewriteErrorBody(params: {
  provider: string
  code: RewriteErrorCode
  error: string
  presetCompat: unknown
}): RewriteErrorResponseBody {
  return {
    ok: false,
    error: params.error,
    code: params.code,
    provider: params.provider,
    guidance: buildRewriteSetupGuidance(params.provider),
    presetCompat: params.presetCompat,
  }
}

function buildRewriteErrorResponse(params: {
  provider: string
  code: RewriteErrorCode
  error: string
  status: number
  presetCompat: unknown
  presetCompatHeader: string
}) {
  return NextResponse.json(buildRewriteErrorBody(params), {
    status: params.status,
    headers: buildPresetCompatResponseHeaders(params.presetCompatHeader),
  })
}

async function readRewriteErrorResponse(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null) as Partial<RewriteErrorResponseBody> | null
    return payload?.error?.trim() || `Rewrite job failed with status ${response.status}`
  }

  const text = await response.text().catch(() => '')
  return text.trim() || `Rewrite job failed with status ${response.status}`
}


function recoverableRewritePanelScopeExists(panel: RecoverableRewriteJobPayload['panel']) {
  const db = getNovelRouteDb(panel.novelId)
  return Boolean(db.queryOne<{ id: string }>(
    `SELECT KnowledgeChapter.id
     FROM KnowledgeChapter
     INNER JOIN StoryBranch ON StoryBranch.id = KnowledgeChapter.branchId
     INNER JOIN NovelRecord ON NovelRecord.id = KnowledgeChapter.novelId
     WHERE KnowledgeChapter.id = ?
       AND KnowledgeChapter.novelId = ?
       AND KnowledgeChapter.branchId = ?
       AND StoryBranch.novelId = KnowledgeChapter.novelId
     LIMIT 1`,
    panel.chapterId,
    panel.novelId,
    panel.branchId,
  ))
}


function findLatestRecoverableRewriteJob(params: {
  novelId: string
  branchId?: string | null
  chapterId?: string | null
  rewriteLaunchSource?: string | null
  branchContextNodeId?: string | null
  continueBlockId?: string | null
  writingSkillCardIds?: string[]
}) {
  const db = getNovelRouteDb(params.novelId)
  const rows = db.queryAll<RecoverableRewriteJobRow>(
    `SELECT id, novelId, branchId, status, progress, currentStep, payloadJson, errorMessage, createdAt, updatedAt
     FROM KnowledgeJob
     WHERE novelId = ? AND jobType = ?
     ORDER BY updatedAt DESC, createdAt DESC
     LIMIT 20`,
    params.novelId,
    RECOVERABLE_REWRITE_JOB_TYPE,
  )

  return rows.find((row) => {
    if (!isRecoverableRewriteJobRestorable(row.status)) return false
    const payload = normalizeRecoverableRewriteJobPayload(row.payloadJson)
    if (!payload) return false
    if (params.branchId && payload.panel.branchId !== params.branchId) return false
    if (params.chapterId && payload.panel.chapterId !== params.chapterId) return false
    if (params.rewriteLaunchSource && payload.panel.rewriteLaunchSource !== params.rewriteLaunchSource) return false
    if (params.branchContextNodeId && payload.panel.branchContextNodeId !== params.branchContextNodeId) return false
    if (params.continueBlockId && payload.panel.continueBlockId !== params.continueBlockId) return false
    if (Object.prototype.hasOwnProperty.call(params, 'writingSkillCardIds')) {
      const expectedCardIds = params.writingSkillCardIds ?? []
      const actualCardIds = payload.panel.writingSkillCardIds ?? normalizeWritingSkillCardIds({
        writingSkillCardId: payload.panel.writingSkillCardId,
      })
      if (
        expectedCardIds.length !== actualCardIds.length
        || expectedCardIds.some((cardId, index) => cardId !== actualCardIds[index])
      ) return false
    }
    return true
  }) ?? null
}

function buildRecoverableRewritePanel(body: Record<string, unknown>) {
  const novelId = String(body.novelId ?? '').trim()
  const chapterId = String(body.chapterId ?? '').trim()
  const branchId = String(body.branchId ?? `${novelId}:main`).trim()
  if (!novelId || !chapterId || !branchId) return null
  const writingSkillCardIds = normalizeWritingSkillCardIds(body)

  return {
    novelId,
    branchId,
    chapterId,
    selectedText: String(body.selectedText ?? body.sourceText ?? ''),
    sourceText: String(body.sourceText ?? ''),
    sourceTextOverride: String(body.rewriteSourceTextOverride ?? '').trim() || null,
    userInstruction: String(body.userInstruction ?? body.prompt ?? ''),
    rewriteLaunchSource: String(body.rewriteLaunchSource ?? '').trim() || null,
    branchContextNodeId: String(body.branchContextNodeId ?? '').trim() || null,
    branchContextInclusion: String(body.branchContextInclusion ?? '').trim() || null,
    continueBlockId: String(body.continueBlockId ?? '').trim() || null,
    writingSkillCardIds,
    writingSkillCardId: writingSkillCardIds[0] ?? null,
    writingSkillExampleCount: typeof body.writingSkillExampleCount === 'number' && Number.isFinite(body.writingSkillExampleCount)
      ? Math.floor(body.writingSkillExampleCount)
      : null,
    writingSkillSeed: typeof body.writingSkillSeed === 'number' && Number.isFinite(body.writingSkillSeed)
      ? Math.floor(body.writingSkillSeed)
      : null,
    createdAt: new Date().toISOString(),
  } satisfies RecoverableRewriteJobPayload['panel']
}

function createResultPayload(params: {
  provider: string
  title?: string
  summary?: string
  content: string
  inputTokens?: unknown
  outputTokens?: unknown
  metadata?: unknown
  presetCompat?: unknown
}) {
  return {
    provider: params.provider,
    title: params.title ?? '生成版本',
    summary: params.summary ?? '已保存版本。',
    content: params.content,
    inputTokens: normalizeTokenValue(params.inputTokens),
    outputTokens: normalizeTokenValue(params.outputTokens),
    metadata: params.metadata ?? null,
    presetCompat: params.presetCompat ?? null,
  } satisfies RewriteResultPayload
}

function readStreamResponseMetadata(response: Response) {
  const presetCompatHeader = response.headers.get('x-retale-preset-compat')
  if (!presetCompatHeader) return null

  try {
    return deserializePresetCompatResponseMetadata(presetCompatHeader)
  } catch {
    return null
  }
}

function normalizeWritingSkillRuntimeRecord(value: unknown): WritingSkillRuntimeRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Partial<WritingSkillRuntimeRecord>
  if (
    typeof record.skillCardId !== 'string'
    || typeof record.exampleCount !== 'number'
    || typeof record.seed !== 'number'
    || !Array.isArray(record.selectedExampleRefs)
  ) return null
  return {
    skillCardId: record.skillCardId,
    exampleCount: record.exampleCount,
    seed: record.seed,
    selectedExampleRefs: record.selectedExampleRefs.map(String),
  }
}

function buildWritingSkillResponseHeaders(records: readonly WritingSkillRuntimeRecord[]): Record<string, string> {
  const firstRecord = records[0]
  if (!firstRecord) return {}
  return {
    'X-ReTale-Writing-Skill': encodeURIComponent(JSON.stringify(firstRecord)),
    'X-ReTale-Writing-Skills': encodeURIComponent(JSON.stringify(records)),
  }
}

function buildWritingSkillMetadata(records: readonly WritingSkillRuntimeRecord[]) {
  const firstRecord = records[0]
  return firstRecord
    ? { writingSkill: firstRecord, writingSkills: records }
    : null
}

function readStreamWritingSkillMetadata(response: Response): WritingSkillRuntimeRecord[] {
  const pluralHeader = response.headers.get('x-retale-writing-skills')
  if (pluralHeader) {
    try {
      const parsed = JSON.parse(decodeURIComponent(pluralHeader)) as unknown
      if (Array.isArray(parsed)) {
        return parsed.flatMap((value) => {
          const record = normalizeWritingSkillRuntimeRecord(value)
          return record ? [record] : []
        })
      }
    } catch {
    }
  }

  const legacyHeader = response.headers.get('x-retale-writing-skill')
  if (!legacyHeader) return []
  try {
    const record = normalizeWritingSkillRuntimeRecord(JSON.parse(decodeURIComponent(legacyHeader)))
    return record ? [record] : []
  } catch {
    return []
  }
}

function normalizeStreamedRewriteText(value: string) {
  const content = value.trim()
  const parsedContent = parseJsonRecord(content)
  if (typeof parsedContent?.result === 'string' && parsedContent.result.trim()) {
    return parsedContent.result.trim()
  }
  return content
}

async function readRewriteResponseResultWithProgress(
  jobId: string,
  payload: RecoverableRewriteJobPayload,
  response: Response,
  novelId: string,
): Promise<RewriteResultPayload> {
  const db = getNovelRouteDb(novelId)
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json') || !response.body || !contentType.includes('text/plain')) {
    return readRewriteResponseResult(response)
  }

  const fallbackResponse = response.clone()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const provider = response.headers.get('x-retale-provider') ?? 'context-stream'
  const presetCompat = readStreamResponseMetadata(response)
  const writingSkills = readStreamWritingSkillMetadata(response)
  const writingSkillMetadata = buildWritingSkillMetadata(writingSkills)
  let content = ''
  let lastPersistedLength = 0
  let lastPersistedAt = 0
  let hasPersistedPartial = false

  const persistPartial = (force = false) => {
    const visibleContent = normalizeStreamedRewriteText(content)
    if (!visibleContent) return
    const now = Date.now()
    const shouldPersist = force
      || !hasPersistedPartial
      || visibleContent.length - lastPersistedLength >= PARTIAL_REWRITE_PERSIST_MIN_CHARS
      || now - lastPersistedAt >= PARTIAL_REWRITE_PERSIST_MIN_MS
    if (!shouldPersist) return

    const persistedContent = visibleContent.length > MAX_PARTIAL_REWRITE_RESULT_CHARS
      ? visibleContent.slice(0, MAX_PARTIAL_REWRITE_RESULT_CHARS)
      : visibleContent

    updateRecoverableRewriteJob(jobId, {
      status: 'running',
      progress: 0.65,
      currentStep: `正在流式生成改写版本（已输出 ${visibleContent.length} 字）`,
      payload: {
        ...payload,
        result: createResultPayload({
          provider,
          title: '生成版本',
          summary: '正在流式生成，结果会持续更新。',
          content: persistedContent,
          metadata: writingSkillMetadata,
          presetCompat,
        }),
      },
      db,
    })
    lastPersistedLength = visibleContent.length
    lastPersistedAt = now
    hasPersistedPartial = true
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    if (!chunk) continue
    content += chunk
    persistPartial()
  }

  const finalChunk = decoder.decode()
  if (finalChunk) {
    content += finalChunk
    persistPartial(true)
  }

  const finalContent = normalizeStreamedRewriteText(content)
  if (!finalContent) {
    return readRewriteResponseResult(fallbackResponse)
  }

  return createResultPayload({
    provider,
    title: '生成版本',
    content: finalContent,
    metadata: writingSkillMetadata,
    presetCompat,
  })
}

function scheduleRecoverableRewriteJob(jobId: string, novelId: string) {
  try {
    after(async () => {
      await runRecoverableRewriteJobInNovel(jobId, novelId)
    })
  } catch (error) {
    if (error instanceof Error && !error.message.includes('outside a request scope')) {
      console.warn('Falling back to timer-based rewrite job scheduling', error)
    }
    setTimeout(() => {
      void runRecoverableRewriteJobInNovel(jobId, novelId)
    }, 0)
  }
}

function scheduleRecoverableRewriteJobIfQueued(row: RecoverableRewriteJobRow | null) {
  if (row?.status === 'queued') {
    scheduleRecoverableRewriteJob(row.id, row.novelId)
  }
}

function parseOperationType(value: unknown): ProductSurfaceId | null {
  const operationType = String(value ?? '').trim()
  return PRODUCT_SURFACE_IDS.includes(operationType as ProductSurfaceId)
    ? operationType as ProductSurfaceId
    : null
}

function resolveRewriteRouteSurfaceId(operationType: ProductSurfaceId): ProductSurfaceId {
  return operationType === 'roleplay' ? 'roleplay' : 'rewrite'
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)))
}

function normalizeBranchContextInclusion(value: unknown) {
  return value === 'include_selected' || value === 'ancestors_only'
    ? value
    : undefined
}

export function buildUserPrompt(params: {
  operationType: string
  userInstruction: string
  chapterNo?: number
  selectedLineStart?: number | null
  selectedLineEnd?: number | null
  sourceText: string
  selectedText: string
  assembledContext: string
  writingSkillPrompt?: string
}) {
  const roleplayContract = params.operationType === 'roleplay'
    ? [
        '',
        '# 角色扮演回复契约',
        '- 你正在继续一段角色扮演对话。',
        '- 只回复当前这一轮的聊天内容。',
        '- 保持与上方角色扮演历史连续。',
        '- 不要把回复写成小说正文、章节改写、剧情大纲或说明。',
        '- 不要自动应用、改写或续写 chapter 正文。',
      ].join('\n')
    : ''

  const sourceText = params.sourceText.trim()
  const selectedText = params.selectedText.trim()
  const isContinuationBody = isContinuationRewriteTask({
    selectedText,
    hasContinuationSource: Boolean(sourceText),
  })
  const sourceBlock = selectedText
    ? ['# 选中文本', selectedText, '']
    : sourceText
      ? [`# ${CONTINUATION_SOURCE_BLOCK_LABEL}`, sourceText, '']
      : []
  const selectedLineText = params.selectedLineStart && params.selectedLineEnd
    ? `选中行：${params.selectedLineStart} - ${params.selectedLineEnd}`
    : '选中行：未知'

  if (params.writingSkillPrompt?.trim()) {
    return [
      '# 当前章节',
      params.chapterNo ? `当前章节：第 ${params.chapterNo} 章` : '当前章节：未知',
      '',
      roleplayContract,
      params.assembledContext,
      selectedLineText,
      '# 任务',
      ...buildRewriteTaskPromptLines({
        operationType: params.operationType,
        userInstruction: params.userInstruction,
        continuation: isContinuationBody,
      }),
      '',
      params.writingSkillPrompt.trim(),
      '',
      ...sourceBlock,
      '# 输出要求',
      '严格遵守当前魔改输出契约，只返回本次任务要求的结果。',
    ].join('\n')
  }

  return [
    '# 当前章节',
    params.chapterNo ? `当前章节：第 ${params.chapterNo} 章` : '当前章节：未知',
    '',
    roleplayContract,
    params.assembledContext,
    selectedLineText,
    ...sourceBlock,
    '# 任务',
    ...buildRewriteTaskPromptLines({
      operationType: params.operationType,
      userInstruction: params.userInstruction,
      continuation: isContinuationBody,
    }),
  ].join('\n')
}

function orderPromptBlocksForLlmRequest(promptBlocks: readonly GenerationContextBlock[]) {
  const stableBlocks: GenerationContextBlock[] = []
  const tailBlocks: GenerationContextBlock[] = []

  for (const block of promptBlocks) {
    if (block.id === 'user-instruction' || block.id === 'selected-text') {
      continue
    }

    if (block.id === 'branch-lineage-full-text') {
      tailBlocks.push(block)
      continue
    }

    stableBlocks.push(block)
  }

  return [...stableBlocks, ...tailBlocks]
}

function assemblePromptBlockContents(promptBlocks: readonly GenerationContextBlock[] | null) {
  return promptBlocks ? promptBlocks.map((block) => block.content).join('\n\n') : null
}

function normalizeRoleplayMessages(value: unknown) {
  if (!Array.isArray(value)) return [] as RoleplayContextMessage[]

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }

    const record = item as Record<string, unknown>
    const role = record.role
    const content = typeof record.content === 'string' ? record.content.trim() : ''
    if ((role !== 'user' && role !== 'assistant') || !content) {
      return []
    }

    return [{ role, content } satisfies RoleplayContextMessage]
  })
}

function getExplicitStreamOverride(body: Record<string, unknown>) {
  return Object.prototype.hasOwnProperty.call(body, 'stream')
    ? { present: true, value: body.stream === true }
    : { present: false, value: null }
}

function buildRouteContextBlocks(promptBlocks: readonly GenerationContextBlock[] | null) {
  return promptBlocks
    ? promptBlocks.map((block) => ({
        id: block.id,
        priority: block.priority,
        content: block.content,
      }))
    : null
}

async function writeRewriteOutputRuntimeDebugArtifact(params: {
  request: Request
  body: unknown
  runtime: ReturnType<typeof applyPresetCompatCreativeRuntime>
  streamed: boolean
  presetCompatMetadata: unknown
  outputTransform: {
    preRegexText?: string
    postRegexText?: string
    candidates?: Array<{
      preRegexText: string
      postRegexText: string
    }>
  }
}) {
  await writeLlmDebugLog({
    folder: 'rewrite',
    provider: params.runtime.resolvedRuntime.providerRuntime.provider,
    model: params.runtime.resolvedRuntime.providerRuntime.config.model ?? 'unknown',
    streamed: params.streamed,
    stage: 'output-runtime',
    presetCompat: params.presetCompatMetadata,
    request: {
      url: params.request.url,
      body: params.body,
    },
    response: {
      outputTransform: params.outputTransform,
    },
  })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')?.trim()
  const novelId = searchParams.get('novelId')?.trim()
  const branchId = searchParams.get('branchId')?.trim()
  const chapterId = searchParams.get('chapterId')?.trim()
  if (!novelId) {
    return noStoreJson({ ok: false, error: 'novelId is required' }, { status: 400 })
  }
  let novelDb
  try {
    novelDb = getNovelRouteDb(novelId)
  } catch (error) {
    return noStoreJson({ ok: false, error: error instanceof Error ? error.message : 'Invalid novelId' }, { status: 400 })
  }

  if (jobId) {
    reconcileKnowledgeJobWatchdog({ jobId, novelId, jobTypes: [RECOVERABLE_REWRITE_JOB_TYPE], db: novelDb })
  } else {
    reconcileKnowledgeJobWatchdog({
      novelId,
      branchId: branchId ?? undefined,
      jobTypes: [RECOVERABLE_REWRITE_JOB_TYPE],
      db: novelDb,
    })
  }

  const row = jobId
    ? readRecoverableRewriteJob(jobId, novelDb)
    : findLatestRecoverableRewriteJob({ novelId, branchId, chapterId })

  scheduleRecoverableRewriteJobIfQueued(row)

  return noStoreJson({ ok: true, job: serializeRecoverableRewriteJob(row) })
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')?.trim()
  const novelId = searchParams.get('novelId')?.trim()
  const branchId = searchParams.get('branchId')?.trim()
  const chapterId = searchParams.get('chapterId')?.trim()
  if (!jobId) {
    return NextResponse.json({ ok: false, error: 'jobId is required' }, { status: 400 })
  }
  if (!novelId || !branchId) {
    return NextResponse.json({ ok: false, error: 'novelId and branchId are required' }, { status: 400 })
  }

  let db
  try {
    db = getNovelRouteDb(novelId)
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Invalid novelId' }, { status: 400 })
  }
  const row = readRecoverableRewriteJob(jobId, db)
  const payload = normalizeRecoverableRewriteJobPayload(row?.payloadJson ?? null)
  const inScope = row
    && payload
    && row.novelId === novelId
    && row.branchId === branchId
    && payload.panel.novelId === novelId
    && payload.panel.branchId === branchId
    && (!chapterId || payload.panel.chapterId === chapterId)
  if (!inScope) {
    return NextResponse.json({ ok: false, error: 'Recoverable rewrite job not found' }, { status: 404 })
  }

  const job = abortRecoverableRewriteJob(jobId, '已中止生成', db)
  if (!job) {
    return NextResponse.json({ ok: false, error: 'Recoverable rewrite job not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, job }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

async function createRecoverableRewriteJob(body: Record<string, unknown>) {
  const preparedBody = { ...body }
  const writingSkillCardIds = normalizeWritingSkillCardIds(preparedBody)
  preparedBody.writingSkillCardIds = writingSkillCardIds
  preparedBody.writingSkillCardId = writingSkillCardIds[0] ?? null
  if (writingSkillCardIds.length) {
    const rawSeed = preparedBody.writingSkillSeed
    preparedBody.writingSkillSeed = typeof rawSeed === 'number' && Number.isFinite(rawSeed)
      ? Math.floor(rawSeed) & 0x7fffffff
      : createWritingSkillRandomSeed()
  }
  const panel = buildRecoverableRewritePanel(preparedBody)
  if (!panel) {
    return NextResponse.json({ ok: false, error: 'novelId, branchId, and chapterId are required for recoverable rewrite jobs' }, { status: 400 })
  }
  if (!recoverableRewritePanelScopeExists(panel)) {
    return NextResponse.json({ ok: false, error: 'Recoverable rewrite job scope not found' }, { status: 404 })
  }
  const db = getNovelRouteDb(panel.novelId)

  reconcileKnowledgeJobWatchdog({
    novelId: panel.novelId,
    branchId: panel.branchId,
    jobTypes: [RECOVERABLE_REWRITE_JOB_TYPE],
    db,
  })

  const activeJob = findLatestRecoverableRewriteJob({
    novelId: panel.novelId,
    branchId: panel.branchId,
    chapterId: panel.chapterId,
    rewriteLaunchSource: panel.rewriteLaunchSource,
    branchContextNodeId: panel.branchContextNodeId,
    continueBlockId: panel.continueBlockId,
    writingSkillCardIds: panel.writingSkillCardIds,
  })
  if (activeJob?.status === 'queued' || activeJob?.status === 'running') {
    scheduleRecoverableRewriteJobIfQueued(activeJob)
    return NextResponse.json({ ok: true, job: serializeRecoverableRewriteJob(activeJob) }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const requestPayload = { ...preparedBody }
  delete requestPayload.recoverableRewriteJob
  delete requestPayload.stream

  const jobId = uid('rewrite-job')
  const payload = {
    request: requestPayload,
    panel,
    stream: body.stream === true,
  } satisfies RecoverableRewriteJobPayload
  try {
    db.execute(
      `INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, progress, currentStep, payloadJson)
       VALUES (?, ?, ?, ?, 'queued', 0.1, ?, ?)`,
      jobId,
      panel.novelId,
      panel.branchId,
      RECOVERABLE_REWRITE_JOB_TYPE,
      '已创建可恢复魔改任务',
      JSON.stringify(payload),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create recoverable rewrite job'
    const isMissingScope = message.includes('FOREIGN KEY') || message.includes('constraint failed')
    return NextResponse.json(
      { ok: false, error: isMissingScope ? 'Recoverable rewrite job scope not found' : message },
      { status: isMissingScope ? 404 : 500 },
    )
  }

  scheduleRecoverableRewriteJob(jobId, panel.novelId)

  return NextResponse.json({ ok: true, job: serializeRecoverableRewriteJob(readRecoverableRewriteJob(jobId, db)) }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

async function readRewriteResponseResult(response: Response): Promise<RewriteResultPayload> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const payload = await response.json() as Record<string, unknown>
    const directResult = normalizeRewriteResultPayload(payload.result)
    if (directResult) return directResult

    const firstCandidate = Array.isArray(payload.candidates) ? payload.candidates[0] : null
    const candidateResult = normalizeRewriteResultPayload({
      ...(firstCandidate && typeof firstCandidate === 'object' && !Array.isArray(firstCandidate) ? firstCandidate : {}),
      provider: payload.provider,
      metadata: payload.metadata,
      presetCompat: payload.presetCompat,
    })
    if (candidateResult) return candidateResult
    throw new Error('No result returned.')
  }

  const content = (await response.text()).trim()
  if (!content) throw new Error('No result returned.')
  const parsedContent = parseJsonRecord(content)
  if (typeof parsedContent?.result === 'string' && parsedContent.result.trim()) {
    return createResultPayload({ provider: 'context-stream', title: '生成版本', content: parsedContent.result.trim() })
  }
  return createResultPayload({ provider: 'context-stream', title: '生成版本', content })
}

async function runRecoverableRewriteJob(jobId: string) {
  throw new Error('runRecoverableRewriteJob requires novel-scoped routing')
}

async function runRecoverableRewriteJobInNovel(jobId: string, novelId: string) {
  const db = getNovelRouteDb(novelId)
  const row = readRecoverableRewriteJob(jobId, db)
  if (!row || row.status !== 'queued') return

  const payload = normalizeRecoverableRewriteJobPayload(row.payloadJson)
  if (!payload) {
    db.execute(
      `UPDATE KnowledgeJob SET status = 'failed', progress = 0, currentStep = ?, errorMessage = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND jobType = ?`,
      '魔改任务恢复数据损坏',
      'Recoverable rewrite job payload is invalid',
      jobId,
      RECOVERABLE_REWRITE_JOB_TYPE,
    )
    return
  }

  const claim = claimRecoverableRewriteJob(jobId, {
    progress: 0.35,
    currentStep: '正在生成改写版本',
    db,
  })
  if (!claim.claimed || !claim.attemptId) return

  const controller = createRecoverableRewriteAbortController(jobId)
  try {
    await runRecoverableRewriteJobWithAttempt(jobId, claim.attemptId, async () => {
      const response = await handleRewritePost(new Request('http://localhost/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload.stream ? { ...payload.request, stream: true } : payload.request),
        signal: controller.signal,
      }), { allowRecoverable: false, signal: controller.signal })
      if (isRecoverableRewriteJobAborted(jobId, db)) return
      if (!response.ok) {
        throw new Error(await readRewriteErrorResponse(response))
      }

      const result = payload.stream
        ? await readRewriteResponseResultWithProgress(jobId, payload, response, novelId)
        : await readRewriteResponseResult(response)
      if (isRecoverableRewriteJobAborted(jobId, db)) return
      updateRecoverableRewriteJob(jobId, {
        status: 'succeeded',
        progress: 1,
        currentStep: '完成',
        payload: { ...payload, result },
        db,
      })
    })
  } catch (error) {
    if (controller.signal.aborted || isRecoverableRewriteJobAborted(jobId, db)) {
      abortRecoverableRewriteJob(jobId, '已中止生成', db)
      return
    }
    const message = error instanceof Error ? error.message : 'Rewrite failed.'
    updateRecoverableRewriteJob(jobId, {
      status: 'failed',
      progress: 0,
      currentStep: '生成失败',
      payload: { ...payload, error: message },
      errorMessage: message,
      db,
    })
  } finally {
    clearRecoverableRewriteAbortController(jobId, controller)
  }
}

export async function runRecoverableRewriteJobForTesting(jobId: string, novelId: string) {
  await runRecoverableRewriteJobInNovel(jobId, novelId)
}

export async function POST(request: Request) {
  return handleRewritePost(request, { allowRecoverable: true })
}

async function handleRewritePost(request: Request, options: { allowRecoverable: boolean; signal?: AbortSignal }) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const novelId = String(body.novelId ?? '').trim()
  if (!novelId) {
    return NextResponse.json({ ok: false, error: 'novelId is required' }, { status: 400 })
  }

  try {
    return await runWithNovelDatabaseAccess(novelId, () => handleRewriteBody(request, body, options))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Rewrite failed.'
    const status = message.includes('Invalid novel ID') ? 400 : message.includes('not found') ? 404 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}

async function handleRewriteBody(
  request: Request,
  body: Record<string, unknown>,
  options: { allowRecoverable: boolean; signal?: AbortSignal },
) {
  if (
    options.allowRecoverable
    && body?.recoverableRewriteJob === true
  ) {
    return createRecoverableRewriteJob(body)
  }

  const rewriteSettings = loadStoredAISettings().rewrite
  const rewriteProvider = rewriteSettings.provider
  const userInstruction = String(body.userInstruction ?? body.prompt ?? '')

  const sourceText = String(body.sourceText ?? '')
  const selectedText = String(body.selectedText ?? '')
  const operationType = parseOperationType(body.operationType)
  if (!operationType) {
    return NextResponse.json({ ok: false, error: INVALID_OPERATION_TYPE_ERROR }, { status: 400 })
  }
  const runtimeSurfaceId = resolveRewriteRouteSurfaceId(operationType)
  const writingSkillCardIds = operationType === 'rewrite'
    ? normalizeWritingSkillCardIds(body)
    : []
  const rawWritingSkillSeed = body.writingSkillSeed
  const writingSkillSeed = typeof rawWritingSkillSeed === 'number' && Number.isFinite(rawWritingSkillSeed)
    ? Math.floor(rawWritingSkillSeed) & 0x7fffffff
    : createWritingSkillRandomSeed()
  const rawWritingSkillExampleCount = body.writingSkillExampleCount
  const writingSkillExampleCount = typeof rawWritingSkillExampleCount === 'number' && Number.isFinite(rawWritingSkillExampleCount)
    ? Math.floor(rawWritingSkillExampleCount)
    : undefined
  const disabledBlockIds = Array.isArray(body.disabledBlockIds) ? body.disabledBlockIds.map((item: unknown) => String(item)) : []
  const disabledBlockIdSet = new Set(disabledBlockIds)
  const enabledWritingSkillCardIds = writingSkillCardIds.filter((cardId) => !disabledBlockIdSet.has(`writing-skill:${cardId}`))
  const writingSkillBundle = enabledWritingSkillCardIds.length
    ? resolveWritingSkillRuntimes({
        cardIds: enabledWritingSkillCardIds,
        count: writingSkillExampleCount,
        seed: writingSkillSeed,
      })
    : null
  const excludedGraphEdgeIds = normalizeStringArray(body.excludedGraphEdgeIds)
  const excludedEvidenceIds = normalizeStringArray(body.excludedEvidenceIds)
  const roleplayMessages = operationType === 'roleplay'
    ? normalizeRoleplayMessages(body.roleplayMessages)
    : []
  const contextRequest = body.novelId && body.chapterId
    ? {
        novelId: String(body.novelId),
        branchId: body.branchId ? String(body.branchId) : undefined,
        chapterId: String(body.chapterId),
        selectedText,
        operationType: runtimeSurfaceId,
        userInstruction,
        roleplayMessages,
        excludedGraphEdgeIds,
        excludedEvidenceIds,
        whatIfSessionId: body.whatIfSessionId ? String(body.whatIfSessionId) : undefined,
        futureJumpRunId: body.futureJumpRunId ? String(body.futureJumpRunId) : undefined,
        branchContextNodeId: body.branchContextNodeId ? String(body.branchContextNodeId) : undefined,
        branchContextInclusion: normalizeBranchContextInclusion(body.branchContextInclusion),
        writingSkillCardIds,
        writingSkillExampleCount,
        writingSkillSeed,
      } as const
    : null
  const cachedRagArtifacts = contextRequest
    ? loadGenerationContextSnapshot({
        snapshotId: typeof body.contextSnapshotId === 'string' ? body.contextSnapshotId : null,
        request: contextRequest,
      })
    : null
  const context = contextRequest
    ? await buildGenerationContext({
        ...contextRequest,
        writingSkillCardIds: enabledWritingSkillCardIds,
      }, { cachedRagArtifacts })
    : null
  const activePromptBlocks = context
    ? context.promptBlocks.filter((block) => !disabledBlockIds.includes(block.id))
    : null
  const orderedActivePromptBlocks = activePromptBlocks
    ? orderPromptBlocksForLlmRequest(activePromptBlocks)
    : null
  const resolvePromptParts = (
    promptBlocks: readonly GenerationContextBlock[] | null,
    fallbackContext: string,
  ) => {
    if (!promptBlocks) {
      return {
        assembledContext: fallbackContext,
        writingSkillPrompt: writingSkillBundle?.prompt ?? '',
      }
    }

    const contextBlocks = promptBlocks.filter((block) => !isWritingSkillPromptBlockId(block.id))
    const writingSkillBlocks = promptBlocks.filter((block) => isWritingSkillPromptBlockId(block.id))
    return {
      assembledContext: assemblePromptBlockContents(contextBlocks) ?? '',
      writingSkillPrompt: assemblePromptBlockContents(writingSkillBlocks) ?? '',
    }
  }
  const buildRuntime = (
    promptParts: { assembledContext: string; writingSkillPrompt: string },
    promptBlocks: readonly GenerationContextBlock[] | null,
  ) => applyPresetCompatCreativeRuntime({
    surfaceId: runtimeSurfaceId,
    providerDefaults: {
      provider: rewriteProvider,
      openAICompatible: {
        config: rewriteSettings.openAICompatible,
        request: { temperature: body.tone === 'keep' ? 0.7 : 0.9 },
      },
      ollama: {
        config: rewriteSettings.ollama,
        request: { temperature: body.tone === 'keep' ? 0.7 : 0.9 },
      },
    },
    systemPrompt: '',
    userPrompt: buildUserPrompt({
      operationType: runtimeSurfaceId,
      userInstruction,
      chapterNo: context?.chapterNo,
      selectedLineStart: context?.selectedLineStart,
      selectedLineEnd: context?.selectedLineEnd,
      sourceText,
      selectedText,
      assembledContext: promptParts.assembledContext,
      writingSkillPrompt: promptParts.writingSkillPrompt,
    }),
    promptRuleRuntimeContext: normalizePresetCompatRuntimeContext(
      body as Record<string, unknown>,
      runtimeSurfaceId,
      promptBlocks,
    ),
  })
  const fallbackContext = String(body.prompt ?? '')
  const initialPromptParts = resolvePromptParts(orderedActivePromptBlocks, fallbackContext)
  const initialRuntime = buildRuntime(initialPromptParts, orderedActivePromptBlocks)
  const requestStreamOverride = getExplicitStreamOverride(body as Record<string, unknown>)
  const initialRouteMetadata = resolveCreativeRoutePresetCompatMetadata({
    runtime: initialRuntime,
    blocks: buildRouteContextBlocks(orderedActivePromptBlocks),
    requestOverride: requestStreamOverride,
    providerDefaultEnabled: false,
    streamSupported: true,
  })
  const trimmedPromptBlocks = orderedActivePromptBlocks
    ? orderedActivePromptBlocks.filter((block) => !initialRouteMetadata.contextWindow?.trimmedBlockIds.includes(block.id))
    : null
  const promptParts = resolvePromptParts(trimmedPromptBlocks, fallbackContext)
  const assembledContext = promptParts.assembledContext
  const runtime = buildRuntime(promptParts, trimmedPromptBlocks)
  const routeMetadata = resolveCreativeRoutePresetCompatMetadata({
    runtime,
    blocks: buildRouteContextBlocks(trimmedPromptBlocks),
    requestOverride: requestStreamOverride,
    providerDefaultEnabled: false,
    streamSupported: true,
  })
  const presetCompatMetadata = {
    ...routeMetadata.metadata,
    contextWindow: initialRouteMetadata.contextWindow,
  }
  const presetCompatHeader = serializePresetCompatResponseMetadata(presetCompatMetadata)
  const activeWritingSkillCardIds = new Set(
    trimmedPromptBlocks
      ? trimmedPromptBlocks.flatMap((block) => {
          const cardId = readWritingSkillCardIdFromPromptBlockId(block.id)
          return cardId ? [cardId] : []
        })
      : enabledWritingSkillCardIds,
  )
  const writingSkillRecords = writingSkillBundle?.records.filter((record) => activeWritingSkillCardIds.has(record.skillCardId)) ?? []
  const writingSkillMetadata = buildWritingSkillMetadata(writingSkillRecords)

  if (routeMetadata.streamPolicy?.effective) {
    const promptPayload = {
      systemPrompt: runtime.systemPrompt,
      userPrompt: runtime.userPrompt,
      temperature: body.tone === 'keep' ? 0.7 : 0.9,
      requestOptions: runtime.resolvedRuntime.providerRuntime.provider === 'openai-compatible'
        ? runtime.resolvedRuntime.providerRuntime.request
        : runtime.resolvedRuntime.providerRuntime.request.options,
      presetCompat: presetCompatMetadata,
      signal: options.signal,
    }
    const streamResult = runtime.resolvedRuntime.providerRuntime.provider === 'openai-compatible'
      ? await streamRewriteWithOpenAICompatible(promptPayload, runtime.resolvedRuntime.providerRuntime.config)
      : await streamRewriteWithOllama(promptPayload, runtime.resolvedRuntime.providerRuntime.config)

    if (streamResult.enabled && streamResult.stream) {
      if (runtime.hasActiveOutputRegex) {
        const transformedStream = await bufferAndTransformTextStream(streamResult.stream, (value) => runtime.applyOutputRuntime(value).value)

        await writeRewriteOutputRuntimeDebugArtifact({
          request,
          body,
          runtime,
          streamed: true,
          presetCompatMetadata,
          outputTransform: {
            preRegexText: transformedStream.rawText,
            postRegexText: transformedStream.transformedText,
          },
        })

        return new Response(transformedStream.stream, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-ReTale-Provider': runtime.resolvedRuntime.providerRuntime.provider,
            ...buildPresetCompatResponseHeaders(presetCompatHeader),
            ...buildWritingSkillResponseHeaders(writingSkillRecords),
          },
        })
      }

      return new Response(streamResult.stream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-ReTale-Provider': runtime.resolvedRuntime.providerRuntime.provider,
          ...buildPresetCompatResponseHeaders(presetCompatHeader),
          ...buildWritingSkillResponseHeaders(writingSkillRecords),
        },
      })
    }

    return buildRewriteErrorResponse({
      provider: runtime.resolvedRuntime.providerRuntime.provider,
      code: streamResult.enabled ? 'provider_request_failed' : 'provider_not_configured',
      error: streamResult.error || 'Rewrite provider did not return a stream.',
      status: streamResult.enabled ? 502 : 400,
      presetCompat: presetCompatMetadata,
      presetCompatHeader,
    })
  }

  const rewriteInput = { sourceText, mode: String(body.mode ?? ''), tone: String(body.tone ?? ''), scope: String(body.scope ?? ''), prompt: context ? [String(body.prompt ?? ''), assembledContext].filter(Boolean).join('\n\n') : String(body.prompt ?? ''), keepCanon: Boolean(body.keepCanon), autoContinue: Boolean(body.autoContinue), thoughtLevel: String(body.thoughtLevel ?? ''), systemPrompt: runtime.systemPrompt, userPrompt: runtime.userPrompt, requestOptions: runtime.resolvedRuntime.providerRuntime.provider === 'openai-compatible' ? runtime.resolvedRuntime.providerRuntime.request : runtime.resolvedRuntime.providerRuntime.request.options, presetCompat: presetCompatMetadata, signal: options.signal }
  const result = runtime.resolvedRuntime.providerRuntime.provider === 'openai-compatible'
    ? await generateRewriteWithOpenAICompatible(rewriteInput, runtime.resolvedRuntime.providerRuntime.config)
    : await generateRewriteWithOllama(rewriteInput, runtime.resolvedRuntime.providerRuntime.config)

  if (result.enabled && result.content?.length) {
    const transformedCandidates = result.content.map((content) => {
      const outputRuntime = runtime.applyOutputRuntime(content)
      return {
        preRegexText: content,
        postRegexText: outputRuntime.value,
      }
    })

    if (runtime.hasActiveOutputRegex) {
      await writeRewriteOutputRuntimeDebugArtifact({
        request,
        body,
        runtime,
        streamed: false,
        presetCompatMetadata,
        outputTransform: {
          candidates: transformedCandidates,
        },
      })
    }

    const firstResult = transformedCandidates[0]
    if (!firstResult) {
      return NextResponse.json({ ok: false, error: 'No result returned.' }, { status: 502 })
    }
    const rewriteResult = createResultPayload({
      provider: runtime.resolvedRuntime.providerRuntime.provider,
      title: '生成版本',
      summary: runtime.resolvedRuntime.providerRuntime.provider === 'openai-compatible' ? '来自 OpenAI-compatible API' : '来自 Ollama 本地模型',
      content: firstResult.postRegexText,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      metadata: writingSkillMetadata
        ? { runtime: runtime.metadata, ...writingSkillMetadata }
        : runtime.metadata,
      presetCompat: presetCompatMetadata,
    })

    return NextResponse.json({
      provider: runtime.resolvedRuntime.providerRuntime.provider,
      metadata: writingSkillMetadata
        ? { runtime: runtime.metadata, ...writingSkillMetadata }
        : runtime.metadata,
      result: rewriteResult,
      candidates: [rewriteResult],
      presetCompat: presetCompatMetadata,
    }, {
      headers: {
        ...buildPresetCompatResponseHeaders(presetCompatHeader),
        ...buildWritingSkillResponseHeaders(writingSkillRecords),
      },
    })
  }

  return buildRewriteErrorResponse({
    provider: runtime.resolvedRuntime.providerRuntime.provider,
    code: result.enabled ? 'provider_request_failed' : 'provider_not_configured',
    error: result.error || 'Rewrite provider returned no usable result.',
    status: result.enabled ? 502 : 400,
    presetCompat: presetCompatMetadata,
    presetCompatHeader,
  })
}
