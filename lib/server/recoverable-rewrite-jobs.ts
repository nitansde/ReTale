import { safeParseJsonObject } from '@/lib/server/json-parse'
import { execute, queryAll, queryOne } from '@/lib/server/sqlite'

export const RECOVERABLE_REWRITE_JOB_TYPE = 'rewrite_generation'

export const RECOVERABLE_REWRITE_ABORTED_STATUS = 'aborted'

const ACTIVE_REWRITE_JOB_STATUSES = new Set(['queued', 'running'])
const TERMINAL_REWRITE_JOB_STATUSES = new Set(['succeeded', 'failed', RECOVERABLE_REWRITE_ABORTED_STATUS])

export type RewriteResultPayload = {
  provider: string
  title: string
  summary: string
  content: string
  inputTokens: number | null
  outputTokens: number | null
  metadata: unknown
  presetCompat: unknown
}

export type RecoverableRewriteJobPayload = {
  request: Record<string, unknown>
  panel: {
    novelId: string
    branchId: string
    chapterId: string
    selectedText: string
    sourceText: string
    sourceTextOverride: string | null
    userInstruction: string
    rewriteLaunchSource: string | null
    branchContextNodeId: string | null
    branchContextInclusion: string | null
    continueBlockId: string | null
    createdAt: string
  }
  stream?: boolean
  result?: RewriteResultPayload
  error?: string
}

export type RecoverableRewriteJobRow = {
  id: string
  novelId: string
  branchId: string | null
  status: string
  progress: number
  currentStep: string | null
  payloadJson: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

const activeRewriteJobControllers = new Map<string, AbortController>()

function parseJsonRecord(value: string | null) {
  return safeParseJsonObject(value)
}

function normalizeTokenValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function normalizeRewriteResultPayload(value: unknown): RewriteResultPayload | null {
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

export function normalizeRecoverableRewriteJobPayload(payloadJson: string | null): RecoverableRewriteJobPayload | null {
  const record = parseJsonRecord(payloadJson)
  if (!record) return null

  const request = record.request && typeof record.request === 'object' && !Array.isArray(record.request)
    ? record.request as Record<string, unknown>
    : null
  const panelRecord = record.panel && typeof record.panel === 'object' && !Array.isArray(record.panel)
    ? record.panel as Record<string, unknown>
    : null
  if (!request || !panelRecord) return null

  return {
    request,
    panel: {
      novelId: String(panelRecord.novelId ?? ''),
      branchId: String(panelRecord.branchId ?? ''),
      chapterId: String(panelRecord.chapterId ?? ''),
      selectedText: String(panelRecord.selectedText ?? ''),
      sourceText: String(panelRecord.sourceText ?? ''),
      sourceTextOverride: typeof panelRecord.sourceTextOverride === 'string' ? panelRecord.sourceTextOverride : null,
      userInstruction: String(panelRecord.userInstruction ?? ''),
      rewriteLaunchSource: typeof panelRecord.rewriteLaunchSource === 'string' ? panelRecord.rewriteLaunchSource : null,
      branchContextNodeId: typeof panelRecord.branchContextNodeId === 'string' ? panelRecord.branchContextNodeId : null,
      branchContextInclusion: typeof panelRecord.branchContextInclusion === 'string' ? panelRecord.branchContextInclusion : null,
      continueBlockId: typeof panelRecord.continueBlockId === 'string' ? panelRecord.continueBlockId : null,
      createdAt: String(panelRecord.createdAt ?? ''),
    },
    stream: record.stream === true,
    result: normalizeRewriteResultPayload(record.result) ?? undefined,
    error: typeof record.error === 'string' ? record.error : undefined,
  }
}

export function readRecoverableRewriteJob(jobId: string) {
  return queryOne<RecoverableRewriteJobRow>(
    `SELECT id, novelId, branchId, status, progress, currentStep, payloadJson, errorMessage, createdAt, updatedAt
     FROM KnowledgeJob
     WHERE id = ? AND jobType = ?`,
    jobId,
    RECOVERABLE_REWRITE_JOB_TYPE,
  )
}

export function serializeRecoverableRewriteJob(row: RecoverableRewriteJobRow | null) {
  if (!row) return null
  const payload = normalizeRecoverableRewriteJobPayload(row.payloadJson)
  if (!payload) return null

  return {
    jobId: row.id,
    status: row.status,
    progress: row.progress,
    currentStep: row.currentStep,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    panel: payload.panel,
    result: payload.result ?? null,
  }
}

export function updateRecoverableRewriteJob(jobId: string, params: {
  status: string
  progress: number
  currentStep: string | null
  payload: RecoverableRewriteJobPayload
  errorMessage?: string | null
}) {
  execute(
    `UPDATE KnowledgeJob
     SET status = ?, progress = ?, currentStep = ?, payloadJson = ?, errorMessage = ?, updatedAt = CURRENT_TIMESTAMP
     WHERE id = ? AND jobType = ?`,
    params.status,
    params.progress,
    params.currentStep,
    JSON.stringify(params.payload),
    params.errorMessage ?? null,
    jobId,
    RECOVERABLE_REWRITE_JOB_TYPE,
  )
}

export function findLatestRecoverableRewriteJob(params: { novelId: string; branchId?: string | null; chapterId?: string | null }) {
  const rows = queryAll<RecoverableRewriteJobRow>(
    `SELECT id, novelId, branchId, status, progress, currentStep, payloadJson, errorMessage, createdAt, updatedAt
     FROM KnowledgeJob
     WHERE novelId = ? AND jobType = ? AND status != ?
     ORDER BY updatedAt DESC, createdAt DESC
     LIMIT 20`,
    params.novelId,
    RECOVERABLE_REWRITE_JOB_TYPE,
    RECOVERABLE_REWRITE_ABORTED_STATUS,
  )

  return rows.find((row) => {
    const payload = normalizeRecoverableRewriteJobPayload(row.payloadJson)
    if (!payload) return false
    if (params.branchId && payload.panel.branchId !== params.branchId) return false
    if (params.chapterId && payload.panel.chapterId !== params.chapterId) return false
    return true
  }) ?? null
}

export function isRecoverableRewriteJobActive(status: string) {
  return ACTIVE_REWRITE_JOB_STATUSES.has(status)
}

export function isRecoverableRewriteJobRestorable(status: string) {
  return status !== RECOVERABLE_REWRITE_ABORTED_STATUS && status !== 'failed'
}

export function isRecoverableRewriteJobAborted(jobId: string) {
  return readRecoverableRewriteJob(jobId)?.status === RECOVERABLE_REWRITE_ABORTED_STATUS
}

export function isRecoverableRewriteJobTerminal(status: string) {
  return TERMINAL_REWRITE_JOB_STATUSES.has(status)
}

export function createRecoverableRewriteAbortController(jobId: string) {
  const controller = new AbortController()
  activeRewriteJobControllers.set(jobId, controller)
  return controller
}

export function clearRecoverableRewriteAbortController(jobId: string, controller: AbortController) {
  if (activeRewriteJobControllers.get(jobId) === controller) {
    activeRewriteJobControllers.delete(jobId)
  }
}

export function abortRecoverableRewriteJob(jobId: string, message = '已中止生成') {
  const row = readRecoverableRewriteJob(jobId)
  if (!row) return null

  const controller = activeRewriteJobControllers.get(jobId)
  controller?.abort()

  if (isRecoverableRewriteJobTerminal(row.status)) {
    return serializeRecoverableRewriteJob(row)
  }

  const payload = normalizeRecoverableRewriteJobPayload(row.payloadJson)
  if (!payload) return serializeRecoverableRewriteJob(row)

  updateRecoverableRewriteJob(jobId, {
    status: RECOVERABLE_REWRITE_ABORTED_STATUS,
    progress: 0,
    currentStep: message,
    payload: { ...payload, error: message },
    errorMessage: message,
  })

  return serializeRecoverableRewriteJob(readRecoverableRewriteJob(jobId))
}

function valueMatches(value: unknown, candidates: Set<string>) {
  return typeof value === 'string' && candidates.has(value)
}

function recoverableRewriteJobMatchesDeletedSource(payload: RecoverableRewriteJobPayload, params: {
  novelId: string
  branchId: string
  nodeId: string
  continueBlockId?: string | null
}) {
  if (payload.panel.novelId !== params.novelId || payload.panel.branchId !== params.branchId) return false
  const nodeIds = new Set([params.nodeId].filter(Boolean))
  const continueBlockIds = new Set([params.continueBlockId ?? ''].filter(Boolean))

  if (valueMatches(payload.panel.branchContextNodeId, nodeIds)) return true
  if (valueMatches(payload.request.branchContextNodeId, nodeIds)) return true
  if (valueMatches(payload.panel.continueBlockId, continueBlockIds)) return true
  if (valueMatches(payload.request.continueBlockId, continueBlockIds)) return true

  return false
}

export function abortRecoverableRewriteJobsForDeletedTimelineNode(params: {
  novelId: string
  branchId: string
  nodeId: string
  continueBlockId?: string | null
}) {
  const rows = queryAll<RecoverableRewriteJobRow>(
    `SELECT id, novelId, branchId, status, progress, currentStep, payloadJson, errorMessage, createdAt, updatedAt
     FROM KnowledgeJob
     WHERE novelId = ? AND branchId = ? AND jobType = ? AND status IN ('queued', 'running')
     ORDER BY updatedAt DESC, createdAt DESC
     LIMIT 100`,
    params.novelId,
    params.branchId,
    RECOVERABLE_REWRITE_JOB_TYPE,
  )

  const abortedJobIds: string[] = []
  for (const row of rows) {
    const payload = normalizeRecoverableRewriteJobPayload(row.payloadJson)
    if (!payload || !recoverableRewriteJobMatchesDeletedSource(payload, params)) continue
    abortRecoverableRewriteJob(row.id, '源续写块已删除，已自动清理孤儿生成任务')
    abortedJobIds.push(row.id)
  }

  return abortedJobIds
}
