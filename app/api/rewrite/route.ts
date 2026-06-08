import { after, NextResponse } from 'next/server'
import { buildGenerationContext } from '@/lib/server/context-builder'
import { loadStoredAISettings } from '@/lib/server/ai-settings'
import { execute, queryAll, queryOne } from '@/lib/server/sqlite'
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

export const maxDuration = 3600

const INVALID_OPERATION_TYPE_ERROR = `Invalid operationType. Expected one of: ${PRODUCT_SURFACE_IDS.join(', ')}`
const PARTIAL_REWRITE_PERSIST_MIN_CHARS = 120
const PARTIAL_REWRITE_PERSIST_MIN_MS = 500
const MAX_PARTIAL_REWRITE_RESULT_CHARS = 200_000
const MAX_PRESET_COMPAT_RESPONSE_HEADER_BYTES = 16_000

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
    summary: typeof record.summary === 'string' ? record.summary : '基于当前章节知识状态与证据装配生成。',
    content,
    inputTokens: normalizeTokenValue(record.inputTokens),
    outputTokens: normalizeTokenValue(record.outputTokens),
    metadata: record.metadata ?? null,
    presetCompat: record.presetCompat ?? null,
  }
}


function buildPresetCompatResponseHeaders(serializedMetadata: string): Record<string, string> {
  if (Buffer.byteLength(serializedMetadata, 'utf8') <= MAX_PRESET_COMPAT_RESPONSE_HEADER_BYTES) {
    return { 'X-ChatBook-Preset-Compat': serializedMetadata }
  }

  return { 'X-ChatBook-Preset-Metadata-Omitted': 'size-limit' }
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
  return Boolean(queryOne<{ id: string }>(
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
}) {
  const rows = queryAll<RecoverableRewriteJobRow>(
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
    return true
  }) ?? null
}

function buildRecoverableRewritePanel(body: Record<string, unknown>) {
  const novelId = String(body.novelId ?? '').trim()
  const chapterId = String(body.chapterId ?? '').trim()
  const branchId = String(body.branchId ?? `${novelId}:main`).trim()
  if (!novelId || !chapterId || !branchId) return null

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
    summary: params.summary ?? '基于当前章节知识状态与证据装配生成。',
    content: params.content,
    inputTokens: normalizeTokenValue(params.inputTokens),
    outputTokens: normalizeTokenValue(params.outputTokens),
    metadata: params.metadata ?? null,
    presetCompat: params.presetCompat ?? null,
  } satisfies RewriteResultPayload
}

function readStreamResponseMetadata(response: Response) {
  const presetCompatHeader = response.headers.get('x-chatbook-preset-compat')
  if (!presetCompatHeader) return null

  try {
    return deserializePresetCompatResponseMetadata(presetCompatHeader)
  } catch {
    return null
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
): Promise<RewriteResultPayload> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json') || !response.body || !contentType.includes('text/plain')) {
    return readRewriteResponseResult(response)
  }

  const fallbackResponse = response.clone()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const provider = response.headers.get('x-chatbook-provider') ?? 'context-stream'
  const presetCompat = readStreamResponseMetadata(response)
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
          presetCompat,
        }),
      },
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
    presetCompat,
  })
}

function scheduleRecoverableRewriteJob(jobId: string) {
  try {
    after(async () => {
      await runRecoverableRewriteJob(jobId)
    })
  } catch (error) {
    if (error instanceof Error && !error.message.includes('outside a request scope')) {
      console.warn('Falling back to timer-based rewrite job scheduling', error)
    }
    setTimeout(() => {
      void runRecoverableRewriteJob(jobId)
    }, 0)
  }
}

function scheduleRecoverableRewriteJobIfQueued(row: RecoverableRewriteJobRow | null) {
  if (row?.status === 'queued') {
    scheduleRecoverableRewriteJob(row.id)
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

function buildUserPrompt(params: {
  operationType: string
  userInstruction: string
  chapterNo?: number
  selectedLineStart?: number | null
  selectedLineEnd?: number | null
  sourceText: string
  selectedText: string
  assembledContext: string
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

  if (jobId) {
    reconcileKnowledgeJobWatchdog({ jobId, jobTypes: [RECOVERABLE_REWRITE_JOB_TYPE] })
  } else if (novelId) {
    reconcileKnowledgeJobWatchdog({
      novelId,
      branchId: branchId ?? undefined,
      jobTypes: [RECOVERABLE_REWRITE_JOB_TYPE],
    })
  }

  const row = jobId
    ? readRecoverableRewriteJob(jobId)
    : novelId
      ? findLatestRecoverableRewriteJob({ novelId, branchId, chapterId })
      : null

  scheduleRecoverableRewriteJobIfQueued(row)

  return NextResponse.json({ ok: true, job: serializeRecoverableRewriteJob(row) }, {
    headers: { 'Cache-Control': 'no-store' },
  })
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

  const row = readRecoverableRewriteJob(jobId)
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

  const job = abortRecoverableRewriteJob(jobId)
  if (!job) {
    return NextResponse.json({ ok: false, error: 'Recoverable rewrite job not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, job }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

async function createRecoverableRewriteJob(body: Record<string, unknown>) {
  const panel = buildRecoverableRewritePanel(body)
  if (!panel) {
    return NextResponse.json({ ok: false, error: 'novelId, branchId, and chapterId are required for recoverable rewrite jobs' }, { status: 400 })
  }
  if (!recoverableRewritePanelScopeExists(panel)) {
    return NextResponse.json({ ok: false, error: 'Recoverable rewrite job scope not found' }, { status: 404 })
  }

  reconcileKnowledgeJobWatchdog({
    novelId: panel.novelId,
    branchId: panel.branchId,
    jobTypes: [RECOVERABLE_REWRITE_JOB_TYPE],
  })

  const activeJob = findLatestRecoverableRewriteJob({
    novelId: panel.novelId,
    branchId: panel.branchId,
    chapterId: panel.chapterId,
    rewriteLaunchSource: panel.rewriteLaunchSource,
    branchContextNodeId: panel.branchContextNodeId,
    continueBlockId: panel.continueBlockId,
  })
  if (activeJob?.status === 'queued' || activeJob?.status === 'running') {
    scheduleRecoverableRewriteJobIfQueued(activeJob)
    return NextResponse.json({ ok: true, job: serializeRecoverableRewriteJob(activeJob) }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const requestPayload = { ...body }
  delete requestPayload.recoverableRewriteJob
  delete requestPayload.stream

  const jobId = uid('rewrite-job')
  const payload = {
    request: requestPayload,
    panel,
    stream: body.stream === true,
  } satisfies RecoverableRewriteJobPayload
  try {
    execute(
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

  scheduleRecoverableRewriteJob(jobId)

  return NextResponse.json({ ok: true, job: serializeRecoverableRewriteJob(readRecoverableRewriteJob(jobId)) }, {
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
  const row = readRecoverableRewriteJob(jobId)
  if (!row || row.status !== 'queued') return

  const payload = normalizeRecoverableRewriteJobPayload(row.payloadJson)
  if (!payload) {
    execute(
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
      if (isRecoverableRewriteJobAborted(jobId)) return
      if (!response.ok) {
        throw new Error(await readRewriteErrorResponse(response))
      }

      const result = payload.stream
        ? await readRewriteResponseResultWithProgress(jobId, payload, response)
        : await readRewriteResponseResult(response)
      if (isRecoverableRewriteJobAborted(jobId)) return
      updateRecoverableRewriteJob(jobId, {
        status: 'succeeded',
        progress: 1,
        currentStep: '完成',
        payload: { ...payload, result },
      })
    })
  } catch (error) {
    if (controller.signal.aborted || isRecoverableRewriteJobAborted(jobId)) {
      abortRecoverableRewriteJob(jobId)
      return
    }
    const message = error instanceof Error ? error.message : 'Rewrite failed.'
    updateRecoverableRewriteJob(jobId, {
      status: 'failed',
      progress: 0,
      currentStep: '生成失败',
      payload: { ...payload, error: message },
      errorMessage: message,
    })
  } finally {
    clearRecoverableRewriteAbortController(jobId, controller)
  }
}

export async function runRecoverableRewriteJobForTesting(jobId: string) {
  await runRecoverableRewriteJob(jobId)
}

export async function POST(request: Request) {
  return handleRewritePost(request, { allowRecoverable: true })
}

async function handleRewritePost(request: Request, options: { allowRecoverable: boolean; signal?: AbortSignal }) {
  const body = await request.json()
  if (
    options.allowRecoverable
    && body?.recoverableRewriteJob === true
    && body
    && typeof body === 'object'
    && !Array.isArray(body)
  ) {
    return createRecoverableRewriteJob(body as Record<string, unknown>)
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
  const disabledBlockIds = Array.isArray(body.disabledBlockIds) ? body.disabledBlockIds.map((item: unknown) => String(item)) : []
  const excludedGraphEdgeIds = normalizeStringArray(body.excludedGraphEdgeIds)
  const excludedEvidenceIds = normalizeStringArray(body.excludedEvidenceIds)
  const roleplayMessages = operationType === 'roleplay'
    ? normalizeRoleplayMessages(body.roleplayMessages)
    : []
  const context = body.novelId && body.chapterId
    ? await buildGenerationContext({
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
      })
    : null
  const activePromptBlocks = context
    ? context.promptBlocks.filter((block) => !disabledBlockIds.includes(block.id))
    : null
  const orderedActivePromptBlocks = activePromptBlocks
    ? orderPromptBlocksForLlmRequest(activePromptBlocks)
    : null
  const buildRuntime = (
    assembledContext: string,
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
      assembledContext,
    }),
    promptRuleRuntimeContext: normalizePresetCompatRuntimeContext(
      body as Record<string, unknown>,
      runtimeSurfaceId,
      promptBlocks,
    ),
  })
  const initialAssembledContext = activePromptBlocks
    ? assemblePromptBlockContents(orderedActivePromptBlocks) ?? ''
    : String(body.prompt ?? '')
  const initialRuntime = buildRuntime(initialAssembledContext, orderedActivePromptBlocks)
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
  const assembledContext = activePromptBlocks
    ? assemblePromptBlockContents(trimmedPromptBlocks) ?? ''
    : String(body.prompt ?? '')
  const runtime = buildRuntime(assembledContext, trimmedPromptBlocks)
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
            'X-ChatBook-Provider': runtime.resolvedRuntime.providerRuntime.provider,
            ...buildPresetCompatResponseHeaders(presetCompatHeader),
          },
        })
      }

      return new Response(streamResult.stream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-ChatBook-Provider': runtime.resolvedRuntime.providerRuntime.provider,
          ...buildPresetCompatResponseHeaders(presetCompatHeader),
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

  const rewriteInput = {
    sourceText,
    mode: body.mode,
    tone: body.tone,
    scope: body.scope,
    prompt: context
      ? [String(body.prompt ?? ''), assembledContext].filter(Boolean).join('\n\n')
      : body.prompt,
    keepCanon: Boolean(body.keepCanon),
    autoContinue: Boolean(body.autoContinue),
    thoughtLevel: body.thoughtLevel,
    systemPrompt: runtime.systemPrompt,
    userPrompt: runtime.userPrompt,
    requestOptions: runtime.resolvedRuntime.providerRuntime.provider === 'openai-compatible'
      ? runtime.resolvedRuntime.providerRuntime.request
      : runtime.resolvedRuntime.providerRuntime.request.options,
    presetCompat: presetCompatMetadata,
    signal: options.signal,
  }
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
      metadata: runtime.metadata,
      presetCompat: presetCompatMetadata,
    })

    return NextResponse.json({
      provider: runtime.resolvedRuntime.providerRuntime.provider,
      metadata: runtime.metadata,
      result: rewriteResult,
      candidates: [rewriteResult],
      presetCompat: presetCompatMetadata,
    }, {
      headers: buildPresetCompatResponseHeaders(presetCompatHeader),
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
